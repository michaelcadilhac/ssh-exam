package core

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

func workspaceFixture(t *testing.T) (*Engine, string) {
	t.Helper()
	c := Config{State: t.TempDir(), Work: t.TempDir(), Templates: t.TempDir(), Accounts: map[string]Account{"student": {UID: os.Getuid(), GID: os.Getgid()}}}
	e, err := New(c)
	if err != nil {
		t.Fatal(err)
	}
	e.terminate = func(*Attempt) error { return nil }
	template := filepath.Join(c.Templates, "v1", "work")
	if err := os.MkdirAll(filepath.Join(template, "src"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(template, "src", "main.c"), []byte("original starter\n"), 0751); err != nil {
		t.Fatal(err)
	}
	modified := time.Date(2024, 1, 2, 3, 4, 5, 123456789, time.UTC)
	if err := os.Chtimes(filepath.Join(template, "src", "main.c"), modified, modified); err != nil {
		t.Fatal(err)
	}
	if err := e.WithState(func() error {
		e.state.Attempts[finalID] = &Attempt{ID: finalID, Exam: "exam", Username: "student", UID: os.Getuid(), State: "PREPARING", Transport: "ssh-a", PreflightStartedAt: Millis(), Settings: Settings{ID: "exam", Duration: 5400, Template: "v1", Terminals: 4, Latest: Millis() + 600000}}
		e.state.Registrations["ssh-a"] = "student"
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return e, template
}

func assertUnstartedWorkspace(t *testing.T, e *Engine, id string) *Attempt {
	t.Helper()
	var a *Attempt
	if err := e.WithState(func() error { a = e.state.Attempts[id]; return nil }); err != nil {
		t.Fatal(err)
	}
	if a.Start != 0 || a.Deadline != 0 || a.OriginalDeadline != 0 || a.Lease != 0 {
		t.Fatalf("staging consumed an interval: %+v", a)
	}
	if _, err := os.Lstat(filepath.Join(e.Config.Work, id, "work")); !os.IsNotExist(err) {
		t.Fatal("preflight exposed live work", err)
	}
	return a
}

func TestWorkspaceRejectsReservedCollectionMetadataBeforeClock(t *testing.T) {
	for _, kind := range []string{"file", "directory"} {
		t.Run(kind, func(t *testing.T) {
			e, template := workspaceFixture(t)
			reserved := filepath.Join(template, "MANIFEST.json")
			if kind == "file" {
				if err := os.WriteFile(reserved, []byte("authored starter, do not discard"), 0600); err != nil {
					t.Fatal(err)
				}
			} else {
				if err := os.Mkdir(reserved, 0700); err != nil {
					t.Fatal(err)
				}
			}
			key := commandKeys(t, e)
			e.Config.Accounts["student"] = Account{UID: os.Getuid(), GID: os.Getgid()}
			cmd := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "prepare-workspace", Username: "student", Transport: "ssh-a", Body: Request{ID: finalID}}
			if _, err := e.Command(signedCommand(key, cmd), "student", "ssh-a"); err == nil || !strings.Contains(err.Error(), "MANIFEST.json") {
				t.Fatal("reserved starter was accepted or refusal was not actionable", err)
			}
			if a := assertUnstartedWorkspace(t, e, finalID); a.Workspace != nil {
				t.Fatal("invalid starter got an accepted receipt")
			}
			if _, err := os.Lstat(reserved); err != nil {
				t.Fatal("rejected source was modified", err)
			}
			// Explicit author repair in the synthetic fixture: nested names are not
			// reserved. Retry stages without consuming an interval or altering source.
			if err := os.Rename(reserved, filepath.Join(template, "src", "MANIFEST.json")); err != nil {
				t.Fatal(err)
			}
			cmd.Nonce = Token()
			if _, err := e.Command(signedCommand(key, cmd), "student", "ssh-a"); err != nil {
				t.Fatal(err)
			}
			if a := assertUnstartedWorkspace(t, e, finalID); a.Workspace == nil {
				t.Fatal("repaired preparation was not staged")
			}
		})
	}
}

func TestLegacyReservedPrivateStageCannotBeAdoptedOrBegun(t *testing.T) {
	e, _ := workspaceFixture(t)
	if _, err := e.Call("prepare-workspace", Request{ID: finalID}); err != nil {
		t.Fatal(err)
	}
	// Models retained pre-upgrade bytes permitted by the former copier; the
	// directory identity/receipt still matches, so Begin must inspect this name.
	reserved := filepath.Join(e.Config.Work, finalID, "workspace-ready", "work", "MANIFEST.json")
	if err := os.WriteFile(reserved, []byte("retained legacy starter"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Call("prepare-workspace", Request{ID: finalID}); err == nil || !strings.Contains(err.Error(), "MANIFEST.json") {
		t.Fatal("adopted uncollectable retained stage", err)
	}
	if err := e.WithState(func() error { return e.workspaceForBegin(e.state.Attempts[finalID]) }); err == nil || !strings.Contains(err.Error(), "MANIFEST.json") {
		t.Fatal("Begin accepted uncollectable retained stage", err)
	}
	assertUnstartedWorkspace(t, e, finalID)
	if data, err := os.ReadFile(reserved); err != nil || string(data) != "retained legacy starter" {
		t.Fatal("legacy staged bytes were replaced", err)
	}
}

func drainWorkspaceTask(t *testing.T, release chan struct{}, finished chan error, drained *bool) {
	t.Helper()
	if release != nil {
		select {
		case <-release:
		default:
			close(release)
		}
	}
	if !*drained {
		select {
		case <-finished:
		case <-time.After(5 * time.Second):
			t.Error("workspace task did not drain before fixture cleanup")
		}
	}
}

func TestSignedWorkspaceStagingPrivateIdempotentAndMetadata(t *testing.T) {
	e, template := workspaceFixture(t)
	key := commandKeys(t, e)
	e.Config.Accounts["student"] = Account{UID: os.Getuid(), GID: os.Getgid()}
	cmd := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "prepare-workspace", Username: "student", Transport: "ssh-a", Body: Request{ID: finalID}}
	if _, err := e.Command(signedCommand(key, cmd), "student", "other"); err == nil {
		t.Fatal("wrong SSH transport staged workspace")
	}
	cmd.Nonce = Token()
	frame := signedCommand(key, cmd)
	if _, err := e.Command(frame, "student", "ssh-a"); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Command(frame, "student", "ssh-a"); err == nil {
		t.Fatal("replayed staging command accepted")
	}
	a := assertUnstartedWorkspace(t, e, finalID)
	if a.Workspace == nil || len(a.Workspace.ContentHash) != 64 {
		t.Fatal("no verified private receipt")
	}
	prepared := *a.Workspace
	staged := filepath.Join(e.Config.Work, finalID, "workspace-ready", "work", "src", "main.c")
	i, err := os.Stat(staged)
	original, _ := os.Stat(filepath.Join(template, "src", "main.c"))
	if err != nil || i.Mode().Perm() != 0751 || !i.ModTime().Equal(original.ModTime()) {
		t.Fatal("starter metadata not preserved", i, err)
	}
	if err := os.WriteFile(filepath.Join(template, "src", "main.c"), []byte("later template edit"), 0600); err != nil {
		t.Fatal(err)
	}
	restarted, _ := New(e.Config)
	if _, err := restarted.Admin("workspace-prepare", finalID, ""); err != nil {
		t.Fatal(err)
	}
	a = assertUnstartedWorkspace(t, restarted, finalID)
	if *a.Workspace != prepared {
		t.Fatal("retry replaced frozen starter snapshot")
	}
	b, _ := os.ReadFile(staged)
	if string(b) != "original starter\n" {
		t.Fatal("retry recopied mutable template")
	}
	if err := restarted.WithState(func() error { return restarted.workspaceForBegin(restarted.state.Attempts[finalID]) }); err != nil {
		t.Fatal(err)
	}
}

func TestWorkspaceSavedCopyDoesNotConsumeGrantOrChangeSource(t *testing.T) {
	e, a, r := recoveryFixture(t)
	if err := e.WithState(func() error { a.PreflightStartedAt = Millis(); e.state.Attempts[a.ID] = a; return nil }); err != nil {
		t.Fatal(err)
	}
	archive := filepath.Join(e.Config.State, "submissions", r.SourceAttempt, "submission.tar.gz")
	before, _ := os.ReadFile(archive)
	if _, err := e.Call("prepare-workspace", Request{ID: a.ID}); err != nil {
		t.Fatal(err)
	}
	a = assertUnstartedWorkspace(t, e, a.ID)
	if a.Workspace.Source.Kind != "saved" || a.Workspace.Source.Checksum != r.Checksum {
		t.Fatal("saved source not fixed")
	}
	claim := filepath.Join(e.Config.State, recoveryName(a)+".consumed")
	if _, err := os.Stat(claim); !os.IsNotExist(err) {
		t.Fatal("preflight consumed saved-work allowance")
	}
	if err := e.WithState(func() error {
		a := e.state.Attempts[a.ID]
		if err := e.workspaceForBegin(a); err != nil {
			return err
		}
		commitStart(a, Millis(), uptime(), boot())
		a.State = "ACTIVATING"
		// Same durable interval fence used by actual Begin, before publication.
		if err := e.save(); err != nil {
			return err
		}
		return e.publishWorkspace(a)
	}); err != nil {
		t.Fatal(err)
	}
	claimBytes, _ := os.ReadFile(claim)
	if string(claimBytes) != a.ID {
		t.Fatal("Begin did not consume the exact allowance")
	}
	answer := filepath.Join(e.Config.Work, a.ID, "work", "answer.txt")
	if err := os.WriteFile(answer, []byte("student edits after publication"), 0600); err != nil {
		t.Fatal(err)
	}
	var interval Attempt
	if err := e.WithState(func() error { interval = *e.state.Attempts[a.ID]; return nil }); err != nil {
		t.Fatal(err)
	}
	restarted, _ := New(e.Config)
	if _, err := restarted.Admin("workspace-repair", a.ID, "Recover interrupted publication safely"); err != nil {
		t.Fatal(err)
	}
	var repaired *Attempt
	_ = restarted.WithState(func() error { repaired = restarted.state.Attempts[a.ID]; return nil })
	if repaired.Start != interval.Start || repaired.Deadline != interval.Deadline || repaired.OriginalDeadline != interval.OriginalDeadline || repaired.State != "COLLECTION_FAILED" || repaired.Lease != 0 {
		t.Fatal("repair reopened/reset the interval")
	}
	edits, _ := os.ReadFile(answer)
	after, _ := os.ReadFile(archive)
	if string(edits) != "student edits after publication" || !bytes.Equal(before, after) {
		t.Fatal("repair replaced edits or changed the protected source")
	}
	if _, err := restarted.Admin("workspace-prepare", a.ID, ""); err == nil {
		t.Fatal("started interval restaged")
	}
}

func TestWorkspaceStageFencesCancellationOwnerSettingsAndExpiry(t *testing.T) {
	for _, change := range []string{"cancel", "transport", "settings", "expiry"} {
		t.Run(change, func(t *testing.T) {
			e, _ := workspaceFixture(t)
			entered, release := make(chan struct{}), make(chan struct{})
			e.workspaceCheckpoint = func(phase string) error {
				if phase == "copied" {
					close(entered)
					<-release
				}
				return nil
			}
			finished := make(chan error, 1)
			drained := false
			defer drainWorkspaceTask(t, release, finished, &drained)
			go func() { _, err := e.Call("prepare-workspace", Request{ID: finalID}); finished <- err }()
			select {
			case <-entered:
			case <-time.After(2 * time.Second):
				t.Fatal("worker did not reach copy barrier")
			}
			at := time.Now()
			if _, err := e.Call("inspect-attempt", Request{ID: finalID}); err != nil {
				t.Fatal(err)
			}
			if change == "cancel" {
				if _, err := e.Call("cancel-attempt", Request{ID: finalID, Reason: "Synthetic abandoned preparation"}); err != nil {
					t.Fatal(err)
				}
			} else if err := e.WithState(func() error {
				a := e.state.Attempts[finalID]
				switch change {
				case "transport":
					a.Transport = "replacement"
				case "settings":
					a.Settings.Duration = 7200
				case "expiry":
					a.PreflightStartedAt = Millis() - PreflightTimeoutMillis
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			if time.Since(at) > time.Second {
				t.Error("staging blocked shared inspection/cancellation")
			}
			close(release)
			err := <-finished
			drained = true
			if err == nil {
				t.Fatal("superseded preparation accepted stage receipt")
			}
			a := assertUnstartedWorkspace(t, e, finalID)
			if a.Workspace != nil {
				t.Fatal("changed attempt got stale private receipt")
			}
		})
	}
}

func TestWorkspaceStageFailureNeverStartsAndRefusesUnsafeTemplates(t *testing.T) {
	for _, fault := range []string{"symlink", "hardlink", "fifo", "oversize", "depth", "copied-error", "private-publish-error", "existing-work", "damaged-receipt"} {
		t.Run(fault, func(t *testing.T) {
			e, template := workspaceFixture(t)
			p := filepath.Join(template, "unsafe")
			switch fault {
			case "symlink":
				if err := os.Symlink("/etc/passwd", p); err != nil {
					t.Fatal(err)
				}
			case "hardlink":
				if err := os.Link(filepath.Join(template, "src", "main.c"), p); err != nil {
					t.Fatal(err)
				}
			case "fifo":
				if err := syscall.Mkfifo(p, 0600); err != nil {
					t.Fatal(err)
				}
			case "oversize":
				f, err := os.Create(p)
				if err != nil {
					t.Fatal(err)
				}
				err = f.Truncate(32*1024*1024 + 1)
				f.Close()
				if err != nil {
					t.Fatal(err)
				}
			case "depth":
				if err := os.MkdirAll(filepath.Join(template, strings.Repeat("d/", 34)), 0700); err != nil {
					t.Fatal(err)
				}
			case "copied-error", "private-publish-error":
				e.workspaceCheckpoint = func(phase string) error {
					if (fault == "copied-error" && phase == "copied") || (fault == "private-publish-error" && phase == "published-private") {
						return errors.New("synthetic workspace IO failure")
					}
					return nil
				}
			case "existing-work":
				if err := os.MkdirAll(filepath.Join(e.Config.Work, finalID, "work"), 0700); err != nil {
					t.Fatal(err)
				}
			case "damaged-receipt":
				if _, err := e.Call("prepare-workspace", Request{ID: finalID}); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(e.Config.Work, finalID, "workspace-ready", "receipt.json"), []byte(`{}`), 0600); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := e.Call("prepare-workspace", Request{ID: finalID}); err == nil {
				t.Fatal("unsafe/failed stage succeeded")
			}
			if fault == "existing-work" {
				if err := os.Remove(filepath.Join(e.Config.Work, finalID, "work")); err != nil {
					t.Fatal(err)
				}
			}
			a := assertUnstartedWorkspace(t, e, finalID)
			if err := e.WithState(func() error { return e.workspaceForBegin(e.state.Attempts[finalID]) }); err == nil && fault != "private-publish-error" {
				t.Fatal("failed stage passed Begin", a)
			}
		})
	}
}

func TestWorkspaceWorkerDeathAdoptsPrivateSnapshotAndPreservesClock(t *testing.T) {
	e, template := workspaceFixture(t)
	childCollections(e, "workspace-kill-private")
	if _, err := e.Call("prepare-workspace", Request{ID: finalID}); err == nil || !strings.Contains(err.Error(), "signal: killed") {
		t.Fatal("expected real staging worker death", err)
	}
	a := assertUnstartedWorkspace(t, e, finalID)
	if a.Workspace != nil {
		t.Fatal("dead worker committed ready state")
	}
	if err := os.WriteFile(filepath.Join(template, "src", "main.c"), []byte("changed after crash"), 0600); err != nil {
		t.Fatal(err)
	}
	restarted, _ := New(e.Config)
	if _, err := restarted.Admin("workspace-prepare", finalID, ""); err != nil {
		t.Fatal(err)
	}
	a = assertUnstartedWorkspace(t, restarted, finalID)
	b, _ := os.ReadFile(filepath.Join(e.Config.Work, finalID, "workspace-ready", "work", "src", "main.c"))
	if a.Workspace == nil || string(b) != "original starter\n" {
		t.Fatal("restart recopied source or lost private snapshot")
	}
}

func TestWorkspaceDamagedSavedSourceCannotConsumeAllowance(t *testing.T) {
	e, a, r := recoveryFixture(t)
	if err := e.WithState(func() error { a.PreflightStartedAt = Millis(); e.state.Attempts[a.ID] = a; return nil }); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(e.Config.State, "submissions", r.SourceAttempt, "submission.tar.gz"), []byte("synthetic archive corruption"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Call("prepare-workspace", Request{ID: a.ID}); err == nil {
		t.Fatal("damaged source staged")
	}
	assertUnstartedWorkspace(t, e, a.ID)
	if _, err := os.Stat(filepath.Join(e.Config.State, recoveryName(a)+".consumed")); !os.IsNotExist(err) {
		t.Fatal("failed source consumed allowance")
	}
	if err := e.WithState(func() error {
		if len(e.state.ManifestReceipts[r.SourceAttempt]) != 0 || len(e.state.Attempts[r.SourceAttempt].Errors) == 0 {
			t.Fatal("damaged source retained a verified anchor or hid its error")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestWorkspaceNativeBeginStartsOnlyAfterGuardsAndIsIdempotent(t *testing.T) {
	e, _ := workspaceFixture(t)
	if _, err := e.Call("activate-attempt", Request{ID: finalID}); err == nil {
		t.Fatal("Begin without staged receipt started")
	}
	if _, err := e.Admin("workspace-prepare", finalID, ""); err != nil {
		t.Fatal(err)
	}
	entered, release := make(chan struct{}), make(chan struct{})
	e.activationPrepare = func(*Attempt) error { close(entered); <-release; return nil }
	finished := make(chan error, 1)
	drained := false
	defer drainWorkspaceTask(t, release, finished, &drained)
	var active *Attempt
	go func() {
		result, err := e.Call("activate-attempt", Request{ID: finalID})
		if err == nil {
			active = result.(*Attempt)
		}
		finished <- err
	}()
	<-entered
	assertUnstartedWorkspace(t, e, finalID)
	before := Millis()
	close(release)
	err := <-finished
	drained = true
	if err != nil {
		t.Fatal(err)
	}
	if active.State != "ACTIVE" || active.Start < before || active.Deadline-active.Start != 5400000 || active.OriginalDeadline != active.Deadline || active.AccessState != "HELD" {
		t.Fatalf("incorrect Begin receipt: %+v", active)
	}
	result, err := e.Call("activate-attempt", Request{ID: finalID})
	if err != nil || result.(*Attempt).Start != active.Start || result.(*Attempt).Deadline != active.Deadline {
		t.Fatal("Begin retry reset time", err)
	}
}

func TestWorkspaceBeginCancellationFencesOldPurgeFromNewPreparation(t *testing.T) {
	e, _ := workspaceFixture(t)
	if _, err := e.Call("prepare-workspace", Request{ID: finalID}); err != nil {
		t.Fatal(err)
	}
	entered, release := make(chan struct{}), make(chan struct{})
	e.activationPrepare = func(*Attempt) error { close(entered); <-release; return nil }
	finished := make(chan error, 1)
	drained := false
	defer drainWorkspaceTask(t, release, finished, &drained)
	go func() { _, err := e.Call("activate-attempt", Request{ID: finalID}); finished <- err }()
	<-entered
	if _, err := e.Call("cancel-attempt", Request{ID: finalID, Reason: "Abandoned during OS verification"}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Call("prepare-attempt", Request{ID: recoveryID, UID: os.Getuid(), Username: "student", Transport: "ssh-a"}); err == nil || !strings.Contains(err.Error(), "account workflow is changing") {
		t.Error("new preparation raced the old account purge", err)
	}
	close(release)
	err := <-finished
	drained = true
	if err == nil {
		t.Fatal("cancelled preparation started after OS checks")
	}
	a := assertUnstartedWorkspace(t, e, finalID)
	if a.State != "CANCELLED_BEFORE_START" {
		t.Fatal("cancelled preparation reopened")
	}
	lock, err := e.accountWorkLock(os.Getuid())
	if err != nil {
		t.Fatal("UID fence leaked", err)
	}
	lock.Close()
}

func TestWorkspaceBeginRechecksSignedExpiryAfterSlowGuards(t *testing.T) {
	e, _ := workspaceFixture(t)
	key := commandKeys(t, e)
	e.Config.Accounts["student"] = Account{UID: os.Getuid(), GID: os.Getgid()}
	if _, err := e.Call("prepare-workspace", Request{ID: finalID}); err != nil {
		t.Fatal(err)
	}
	cmd := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 500, Op: "activate-attempt", Username: "student", Transport: "ssh-a", Body: Request{ID: finalID}}
	e.activationPrepare = func(*Attempt) error { time.Sleep(time.Until(time.UnixMilli(cmd.Expires + 5))); return nil }
	if _, err := e.Command(signedCommand(key, cmd), "student", "ssh-a"); err == nil || !strings.Contains(err.Error(), "expired during setup") {
		t.Fatal("stale signed Begin started an interval", err)
	}
	assertUnstartedWorkspace(t, e, finalID)
}

func TestWorkspaceResourceFailureLeavesSharedControlAndRetryAvailable(t *testing.T) {
	for _, mode := range []string{"workspace-hang", "workspace-file-bound"} {
		t.Run(mode, func(t *testing.T) {
			e, _ := workspaceFixture(t)
			key := commandKeys(t, e)
			e.Config.Accounts["student"] = Account{UID: os.Getuid(), GID: os.Getgid()}
			e.Config.Accounts["healthy"] = Account{UID: 2001, GID: 2001}
			const healthyID = "98765432-1234-1234-1234-123456789abc"
			deadline := Millis() + 5400000
			if err := e.WithState(func() error {
				e.state.Attempts[healthyID] = &Attempt{ID: healthyID, Exam: "exam", Username: "healthy", UID: 2001, Transport: "ssh-healthy", State: "ACTIVE", Start: deadline - 5400000, Deadline: deadline, OriginalDeadline: deadline, Lease: Millis() + 15000, Boot: boot(), UptimeDeadline: uptime() + 5400, Generation: 3}
				e.state.Registrations["ssh-healthy"] = "healthy"
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			childCollections(e, mode)
			finished := make(chan error, 1)
			drained := false
			defer drainWorkspaceTask(t, nil, finished, &drained)
			go func() { _, err := e.Call("prepare-workspace", Request{ID: finalID}); finished <- err }()
			until := time.Now().Add(1500 * time.Millisecond)
			for {
				if _, err := os.Stat(filepath.Join(e.Config.State, "child-entered")); err == nil {
					break
				}
				if time.Now().After(until) {
					t.Fatal("worker never reached actual copy barrier")
				}
				time.Sleep(5 * time.Millisecond)
			}
			at := time.Now()
			assertUnstartedWorkspace(t, e, finalID)
			cmd := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "renew-execution-lease", Username: "healthy", Transport: "ssh-healthy", Body: Request{ID: healthyID}}
			if _, err := e.Command(signedCommand(key, cmd), "healthy", "ssh-healthy"); err != nil {
				t.Fatal("staging failure interrupted healthy signed monitoring", err)
			}
			if time.Since(at) > time.Second {
				t.Error("failed staging worker blocked shared state")
			}
			err := <-finished
			drained = true
			if err == nil || (mode == "workspace-file-bound" && !strings.Contains(err.Error(), "file too large")) || (mode == "workspace-hang" && !strings.Contains(err.Error(), "resource/time bound")) {
				t.Fatal("wrong staging resource failure", err)
			}
			restarted, _ := New(e.Config)
			if _, err := restarted.Admin("workspace-prepare", finalID, ""); err != nil {
				t.Fatal("resource failure prevented retry", err)
			}
			assertUnstartedWorkspace(t, restarted, finalID)
			if err := restarted.WithState(func() error {
				a := restarted.state.Attempts[healthyID]
				if a.State != "ACTIVE" || a.Deadline != deadline || a.OriginalDeadline != deadline || a.Generation != 3 {
					t.Fatal("staging failure changed healthy interval/generation")
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
		})
	}
}
