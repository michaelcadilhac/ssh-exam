package core

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

func observeTestPane(t *testing.T, e *Engine, pane string) NativePane {
	t.Helper()
	view, err := ObserveNativePanes(e.Config.State, NativePaneQuery{Attempt: finalID, Pane: pane, Limit: 1})
	if err != nil || len(view.Panes) != 1 {
		t.Fatal("pane observation", err, view)
	}
	return view.Panes[0]
}

func TestNativePaneReadOnlyDoesNotWaitInitializeLeakSecretsOrFingerprintPrivateKeys(t *testing.T) {
	e, _, _, token, _ := paneAdmissionFixture(t)
	if err := e.WithState(func() error {
		e.state.Attempts[finalID].Handoff = &SSHHandoff{CertificateKey: "PRIVATE-KEY-ONE"}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	before := observeTestPane(t, e, finalID)
	stateBefore, err := os.ReadFile(filepath.Join(e.Config.State, "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	statBefore, err := os.Stat(filepath.Join(e.Config.State, "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	lock, err := os.OpenFile(filepath.Join(e.Config.State, "lock"), os.O_RDWR, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Close()
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		view, err := ObserveNativePanes(e.Config.State, NativePaneQuery{Attempt: finalID, Limit: 50})
		if err == nil {
			data, _ := json.Marshal(view)
			for _, private := range []string{token, Hash([]byte(token)), "PRIVATE-KEY-ONE", "ssh-a"} {
				if bytes.Contains(data, []byte(private)) {
					err = errReadOnlySnapshot
				}
			}
		}
		done <- err
	}()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("read-only pane query waited for native lock")
	}
	_ = syscall.Flock(int(lock.Fd()), syscall.LOCK_UN)
	statAfter, _ := os.Stat(filepath.Join(e.Config.State, "state.json"))
	stateAfter, _ := os.ReadFile(filepath.Join(e.Config.State, "state.json"))
	if !bytes.Equal(stateBefore, stateAfter) || statBefore.ModTime() != statAfter.ModTime() || statBefore.Sys().(*syscall.Stat_t).Ctim != statAfter.Sys().(*syscall.Stat_t).Ctim {
		t.Fatal("read-only query changed native bytes/metadata")
	}
	if err := e.WithState(func() error {
		a := e.state.Attempts[finalID]
		a.Handoff.CertificateKey = "PRIVATE-KEY-TWO"
		a.Lease += 1000
		a.Errors = []string{"diagnostic"}
		a.Units = []string{"exam-" + finalID + "-98765432-1234-4234-8234-123456789abc.scope"}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if after := observeTestPane(t, e, finalID); after.Revision != before.Revision {
		t.Fatal("private key/renewal/another pane changed scoped revision")
	}
}

func TestNativePaneReviewedPendingCloseIsAuditedScopedAndPreservesAuthority(t *testing.T) {
	e, _, _, token, _ := paneAdmissionFixture(t)
	other := "98765432-1234-4234-8234-123456789abc"
	var otherToken string
	if err := e.WithState(func() error {
		otherToken = e.issue(Capability{ID: finalID, Pane: other, Username: "student", Transport: "ssh-a", Expires: Millis() + 15000}).(map[string]string)["token"]
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	view := observeTestPane(t, e, finalID)
	before, _ := readStateSnapshot(e.Config.State)
	result, err := e.closeNativePaneReviewed(finalID, finalID, view.Revision, "Reviewed synthetic pending pane close")
	if err != nil || !result.RecordedTargetsQuiesced || result.ClockChanged || result.AccessReleased {
		t.Fatal(result, err)
	}
	after, _ := readStateSnapshot(e.Config.State)
	if _, ok := after.Caps[Hash([]byte(token))]; ok {
		t.Fatal("target cap retained")
	}
	if _, ok := after.Caps[Hash([]byte(otherToken))]; !ok {
		t.Fatal("other pane cap revoked")
	}
	a, b := after.Attempts[finalID], before.Attempts[finalID]
	if a.Deadline != b.Deadline || a.OriginalDeadline != b.OriginalDeadline || a.Start != b.Start || a.State != b.State || a.Generation != b.Generation || a.AccessState != b.AccessState || a.Protected != b.Protected {
		t.Fatal("targeted close changed attempt authority")
	}
	audit, err := os.ReadFile(filepath.Join(e.Config.State, "audit.ndjson"))
	if err != nil || !bytes.Contains(audit, []byte("administrator-pane-close-requested")) || !bytes.Contains(audit, []byte(view.Revision)) {
		t.Fatal("root close lacks durable intent", err)
	}
	if _, err := e.closeNativePaneReviewed(finalID, finalID, view.Revision, "Reviewed synthetic pending pane close"); err == nil {
		t.Fatal("old intent silently accepted after target changed")
	}
}

func TestNativePaneReplacementClonedStateAndOwnerChangesFenceOldClose(t *testing.T) {
	for _, change := range []string{"replacement-token", "owner", "generation", "clock", "source"} {
		t.Run(change, func(t *testing.T) {
			e, _, _, _, _ := paneAdmissionFixture(t)
			view := observeTestPane(t, e, finalID)
			if change == "source" {
				data, _ := os.ReadFile(filepath.Join(e.Config.State, "state.json"))
				clone := nativeFixtureDir(t)
				if err := os.WriteFile(filepath.Join(clone, "state.json"), data, 0600); err != nil {
					t.Fatal(err)
				}
				other, err := New(Config{State: clone})
				if err != nil {
					t.Fatal(err)
				}
				e = other
			} else if err := e.WithState(func() error {
				a := e.state.Attempts[finalID]
				switch change {
				case "replacement-token":
					e.revokePaneAdmissions(finalID, finalID)
					e.issue(Capability{ID: finalID, Pane: finalID, Username: a.Username, Transport: a.Transport, Expires: Millis() + 15000})
				case "owner":
					a.Transport = "other-owner"
				case "generation":
					a.Generation++
				case "clock":
					a.ClockRevision++
					a.Deadline += 1000
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			before, _ := readStateSnapshot(e.Config.State)
			if _, err := e.closeNativePaneReviewed(finalID, finalID, view.Revision, "Explicit stale root close rejected"); err == nil {
				t.Fatal("stale root intent accepted")
			}
			after, _ := readStateSnapshot(e.Config.State)
			if len(before.Caps) != len(after.Caps) {
				t.Fatal("stale close revoked replacement")
			}
		})
	}
}

func TestNativePaneIncarnationNeverAliasesLegacyUnreadyOrReplacementUnit(t *testing.T) {
	e, _, _, _, _ := paneAdmissionFixture(t)
	instance := ManagementID()
	unit := "exam-" + finalID + "-" + finalID + "-" + instance + ".scope"
	if err := e.WithState(func() error {
		e.state.Attempts[finalID].Units = []string{unit}
		e.state.PaneInstances = map[string]PaneInstance{unit: {Attempt: finalID, Pane: finalID, ID: instance, Boot: boot(), ReadyAt: Millis()}}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	first := observeTestPane(t, e, finalID)
	if first.Unsafe || first.Revision == "" {
		t.Fatal("confirmed unique unit not observable", first)
	}
	if err := e.WithState(func() error {
		a := e.state.Attempts[finalID]
		next := ManagementID()
		u := "exam-" + finalID + "-" + finalID + "-" + next + ".scope"
		a.Units = []string{u}
		e.state.PaneInstances = map[string]PaneInstance{u: {Attempt: finalID, Pane: finalID, ID: next, Boot: boot(), ReadyAt: Millis()}}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if second := observeTestPane(t, e, finalID); second.Unsafe || second.Revision == first.Revision {
		t.Fatal("same-UUID replacement aliases old revision")
	}
	// No manager/signal is invoked: old review refuses before any control.
	if _, err := e.closeNativePaneReviewed(finalID, finalID, first.Revision, "Do not close replacement incarnation"); err == nil {
		t.Fatal("old root close reached replacement")
	}
	for _, legacy := range []bool{false, true} {
		if err := e.WithState(func() error {
			delete(e.state.PaneInstances, e.state.Attempts[finalID].Units[0])
			if legacy {
				e.state.Attempts[finalID].Units = []string{"exam-" + finalID + "-" + finalID + ".scope"}
			}
			return nil
		}); err != nil {
			t.Fatal(err)
		}
		if view := observeTestPane(t, e, finalID); !view.Unsafe || view.Revision != "" {
			t.Fatal("unknown startup/legacy unit acquired close authority", view)
		}
	}
}

func TestNativePaneAuditFailureCannotRevokeAndPartialTailIsPreserved(t *testing.T) {
	for _, failure := range []string{"directory", "symlink", "public", "partial"} {
		t.Run(failure, func(t *testing.T) {
			e, _, _, token, _ := paneAdmissionFixture(t)
			view := observeTestPane(t, e, finalID)
			path := filepath.Join(e.Config.State, "audit.ndjson")
			_ = os.Remove(path) // Exact synthetic fixture audit only.
			switch failure {
			case "directory":
				if err := os.Mkdir(path, 0700); err != nil {
					t.Fatal(err)
				}
			case "symlink":
				if err := os.Symlink(filepath.Join(t.TempDir(), "absent"), path); err != nil {
					t.Fatal(err)
				}
			case "public":
				if err := os.WriteFile(path, []byte("preserve"), 0644); err != nil {
					t.Fatal(err)
				}
			case "partial":
				if err := os.WriteFile(path, []byte(`{"incomplete":`), 0600); err != nil {
					t.Fatal(err)
				}
			}
			_, err := e.closeNativePaneReviewed(finalID, finalID, view.Revision, "Audit must precede scoped revocation")
			state, _ := readStateSnapshot(e.Config.State)
			_, retained := state.Caps[Hash([]byte(token))]
			if failure == "partial" {
				data, _ := os.ReadFile(path)
				lines := bytes.Split(data, []byte{'\n'})
				if err != nil || retained || len(lines) < 3 || string(lines[0]) != `{"incomplete":` || !json.Valid(lines[1]) {
					t.Fatal("partial tail lost/joined or root intent not durable", err, string(data))
				}
			} else if err == nil || !retained {
				t.Fatal("failed audit permitted revocation", err)
			}
		})
	}
}

func TestNativePanePublicControlRequiresRealRootBeforeStateAccess(t *testing.T) {
	if os.Getuid() == 0 && os.Geteuid() == 0 {
		t.Skip("nonroot refusal fixture")
	}
	e := &Engine{Config: Config{State: "/must-not-be-opened"}}
	if _, err := e.CloseNativePane(finalID, finalID, "sha256:"+strings.Repeat("a", 64), "Explicit root authority required"); err == nil {
		t.Fatal("nonroot pane mutation accepted")
	}
}
