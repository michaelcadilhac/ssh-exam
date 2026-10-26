package core

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func recoveryCatalogFixture(t *testing.T) (*Engine, *Attempt, RecoveryPreparation) {
	t.Helper()
	e, a, r := recoveryFixture(t)
	a.Settings.Earliest, a.Settings.Latest, a.Settings.Terminals = Millis()-1000, Millis()+600000, 4
	// Synthetic eligibility only; no actual account access is released here.
	if err := e.WithState(func() error {
		source := e.state.Attempts[r.SourceAttempt]
		source.AccessState = "RELEASED"
		source.AccessReleasedAt = Millis()
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return e, a, r
}

func TestUnusedRecoveryGrantBlocksBothSubmissionDeletionInterfaces(t *testing.T) {
	for _, admin := range []bool{false, true} {
		t.Run(map[bool]string{false: "native-call", true: "examctl-admin"}[admin], func(t *testing.T) {
			e, _, r := recoveryCatalogFixture(t)
			path := filepath.Join(e.Config.State, "submissions", r.SourceAttempt, "submission.tar.gz")
			before, _ := os.ReadFile(path)
			var err error
			if admin {
				_, err = e.Admin("delete", r.SourceAttempt, "Approved synthetic retention inspection")
			} else {
				_, err = e.Call("delete-submission", Request{ID: r.SourceAttempt})
			}
			if err == nil || !strings.Contains(err.Error(), "unused saved-work authorization") || !strings.Contains(err.Error(), "examctl recovery-grants") {
				t.Fatal("pending source deletion did not refuse actionably", err)
			}
			after, _ := os.ReadFile(path)
			if !bytes.Equal(before, after) {
				t.Fatal("refusal changed source bytes")
			}
			if err := e.WithState(func() error {
				if !e.state.Attempts[r.SourceAttempt].Protected {
					t.Fatal("refusal unprotected source")
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestRecoveryCatalogInspectionIsReadOnlyAndLabelsMetadata(t *testing.T) {
	e, _, r := recoveryCatalogFixture(t)
	statePath := filepath.Join(e.Config.State, "state.json")
	before, _ := os.ReadFile(statePath)
	rows, err := e.RecoveryGrants(r.Exam)
	if err != nil || len(rows) != 1 || rows[0].Disposition != "unused" || !rows[0].SourceRecordedProtected || rows[0].ConsumedBy != "" {
		t.Fatal("wrong legacy catalog", rows, err)
	}
	after, _ := os.ReadFile(statePath)
	if !bytes.Equal(before, after) {
		t.Fatal("read-only catalog changed native history")
	}
	rows, err = e.RecoveryGrants("another-exam")
	if err != nil || len(rows) != 0 {
		t.Fatal("exam filter leaked unrelated authorizations", rows, err)
	}
}

func TestRecoveryCatalogRenamedUIDAgreesWithBeginFence(t *testing.T) {
	e, a, r := recoveryCatalogFixture(t)
	if err := e.WithState(func() error {
		a.PreflightStartedAt = Millis()
		e.state.Attempts[a.ID] = a
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Call("prepare-workspace", Request{ID: a.ID}); err != nil {
		t.Fatal("positive saved-work staging failed", err)
	}
	if err := e.WithState(func() error {
		e.state.Attempts[retryRecoveryID] = &Attempt{ID: retryRecoveryID, Exam: r.Exam, Username: "former-name", UID: r.UID,
			State: "COMPLETED", Start: r.CreatedAt + 1, Deadline: r.CreatedAt + 1 + r.Duration*1000,
			OriginalDeadline: r.CreatedAt + 1 + r.Duration*1000, Settings: Settings{ID: r.Exam, Duration: r.Duration},
			AccessState: "HELD", AccessHeldAt: r.CreatedAt + 1}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	paths := []string{filepath.Join(e.Config.State, "state.json"), filepath.Join(e.Config.State, recoveryName(a)),
		filepath.Join(e.Config.State, "submissions", r.SourceAttempt, "submission.tar.gz")}
	before := make([][]byte, len(paths))
	for i, path := range paths {
		var err error
		before[i], err = os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
	}
	for range 2 {
		rows, err := e.RecoveryGrants(r.Exam)
		if err != nil || len(rows) != 1 || rows[0].Disposition != "uncertain" || rows[0].ConsumedBy != "" {
			t.Errorf("renamed same-UID committed interval must not appear unused: %+v / %v", rows, err)
		}
		if _, err := e.Call("activate-attempt", Request{ID: a.ID}); err == nil || !strings.Contains(err.Error(), "already started") {
			t.Fatal("Begin did not reach the existing committed-UID refusal", err)
		}
		for i, path := range paths {
			after, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(before[i], after) {
				t.Fatal("inspection/refused Begin changed history, grant or source", path, err)
			}
		}
		if _, err := os.Stat(filepath.Join(e.Config.State, recoveryName(a)+".consumed")); !os.IsNotExist(err) {
			t.Fatal("refusal published consumption", err)
		}
		if _, err := os.Stat(filepath.Join(e.Config.Work, a.ID, "work")); !os.IsNotExist(err) {
			t.Fatal("refusal published live work", err)
		}
		e, err = New(e.Config)
		if err != nil {
			t.Fatal(err)
		}
	}
}

func TestCompletedRecoveryConsumptionClosesDependencyWithoutCascadingHistory(t *testing.T) {
	e, a, r := recoveryCatalogFixture(t)
	if err := e.WithState(func() error { a.PreflightStartedAt = Millis(); e.state.Attempts[a.ID] = a; return nil }); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Call("prepare-workspace", Request{ID: a.ID}); err != nil {
		t.Fatal(err)
	}
	e.activationPrepare = func(*Attempt) error { return nil } // Privileged OS guard fixture only.
	if _, err := e.Call("activate-attempt", Request{ID: a.ID}); err != nil {
		t.Fatal(err)
	}
	rows, err := e.RecoveryGrants(r.Exam)
	if err != nil || rows[0].Disposition != "consumed" || rows[0].ConsumedBy != a.ID {
		t.Fatal(rows, err)
	}
	if _, err := e.Admin("delete", r.SourceAttempt, "Synthetic source retention request"); err == nil || !strings.Contains(err.Error(), "unfinished") {
		t.Fatal("unfinished restored attempt lost its source", err)
	}
	if _, err := e.Call("finalize-attempt", Request{ID: a.ID, Reason: "Synthetic completed recovery"}); err != nil {
		t.Fatal(err)
	}
	childPath := filepath.Join(e.Config.State, "submissions", a.ID, "submission.tar.gz")
	childBefore, _ := os.ReadFile(childPath)
	claim := filepath.Join(e.Config.State, recoveryName(a)+".consumed")
	claimBefore, _ := os.ReadFile(claim)
	if _, err := e.Admin("delete", r.SourceAttempt, "Explicit synthetic source retention expiry"); err != nil {
		t.Fatal("completed consumed grant incorrectly blocks explicit retention", err)
	}
	if _, err := os.Stat(filepath.Join(e.Config.State, "submissions", r.SourceAttempt)); !os.IsNotExist(err) {
		t.Fatal("explicit source deletion did not remove exact bundle")
	}
	childAfter, _ := os.ReadFile(childPath)
	claimAfter, _ := os.ReadFile(claim)
	if !bytes.Equal(childBefore, childAfter) || !bytes.Equal(claimBefore, claimAfter) {
		t.Fatal("source deletion cascaded into child submission/consumption history")
	}
	if err := e.WithState(func() error {
		if e.state.Attempts[r.SourceAttempt] == nil || e.state.Attempts[a.ID] == nil || !e.state.Attempts[a.ID].Protected {
			t.Fatal("source deletion lost historical attempts")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	rows, err = e.RecoveryGrants(r.Exam)
	if err != nil || rows[0].Disposition != "consumed" || rows[0].SourceRecordedProtected {
		t.Fatal("deletion reopened grant or fabricated source protection", rows, err)
	}
}

func TestMalformedRecoveryCatalogFailsClosedForDeletion(t *testing.T) {
	for _, fault := range []string{"json", "unknown-field", "symlink", "hardlink", "oversize", "orphan-marker", "bad-marker", "wrong-consumer", "interrupted-marker", "unsafe-mode"} {
		t.Run(fault, func(t *testing.T) {
			e, a, r := recoveryCatalogFixture(t)
			path := filepath.Join(e.Config.State, recoveryName(a))
			switch fault {
			case "json":
				if err := os.WriteFile(path, []byte("{"), 0600); err != nil {
					t.Fatal(err)
				}
			case "unknown-field":
				b, _ := os.ReadFile(path)
				b = append([]byte(`{"unexpected":true,`), b[1:]...)
				if err := os.WriteFile(path, b, 0600); err != nil {
					t.Fatal(err)
				}
			case "symlink":
				if err := os.Rename(path, path+".hidden"); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(path+".hidden", path); err != nil {
					t.Fatal(err)
				}
			case "hardlink":
				if err := os.Link(path, path+".hidden"); err != nil {
					t.Fatal(err)
				}
			case "oversize":
				if err := os.WriteFile(path, bytes.Repeat([]byte("x"), 16385), 0600); err != nil {
					t.Fatal(err)
				}
			case "orphan-marker":
				if err := os.WriteFile(filepath.Join(filepath.Dir(path), "orphan.json.consumed"), []byte(a.ID), 0600); err != nil {
					t.Fatal(err)
				}
			case "bad-marker":
				if err := os.WriteFile(path+".consumed", []byte("not-an-attempt"), 0600); err != nil {
					t.Fatal(err)
				}
			case "wrong-consumer":
				if err := os.WriteFile(path+".consumed", []byte(r.SourceAttempt), 0600); err != nil {
					t.Fatal(err)
				}
			case "interrupted-marker":
				if err := e.WithState(func() error {
					commitStart(a, Millis(), uptime(), boot())
					a.State = "COLLECTION_FAILED"
					e.state.Attempts[a.ID] = a
					return nil
				}); err != nil {
					t.Fatal(err)
				}
			case "unsafe-mode":
				if err := os.Chmod(path, 0644); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := e.Admin("delete", r.SourceAttempt, "Synthetic dependency-blind deletion attempt"); err == nil {
				t.Fatal("unsafe/uncertain catalog permitted deletion")
			}
			if _, err := os.Stat(filepath.Join(e.Config.State, "submissions", r.SourceAttempt, "submission.tar.gz")); err != nil {
				t.Fatal("failed validation lost protected source", err)
			}
		})
	}
}

func TestRecoveryCatalogSerializesSavedBeginAndDeletion(t *testing.T) {
	e, a, r := recoveryCatalogFixture(t)
	if err := e.WithState(func() error { a.PreflightStartedAt = Millis(); e.state.Attempts[a.ID] = a; return nil }); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Call("prepare-workspace", Request{ID: a.ID}); err != nil {
		t.Fatal(err)
	}
	e.activationPrepare = func(*Attempt) error { return nil }
	lock, err := e.recoveryCatalogLock()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.Call("activate-attempt", Request{ID: a.ID}); err == nil || !strings.Contains(err.Error(), "catalog is changing") {
		t.Error("Begin bypassed catalog serialization", err)
	}
	assertUnstartedWorkspace(t, e, a.ID)
	if _, err := e.Admin("delete", r.SourceAttempt, "Concurrent synthetic source deletion"); err == nil || !strings.Contains(err.Error(), "catalog is changing") {
		t.Error("deletion bypassed catalog serialization", err)
	}
	lock.Close()
	if _, err := e.Call("activate-attempt", Request{ID: a.ID}); err != nil {
		t.Fatal("catalog fence leaked after release", err)
	}
}

func TestMalformedDeletionWorkerReplyCannotDeleteSource(t *testing.T) {
	e, _, r := recoveryCatalogFixture(t)
	// No dependency remains in this fixture, so refusal must be the real worker
	// protocol failure, not a conveniently early grant/hold refusal.
	if err := os.Remove(filepath.Join(e.Config.State, "recovery-preparations", r.Exam, "student.json")); err != nil {
		t.Fatal(err)
	}
	childCollections(e, "truncated")
	if _, err := e.Admin("delete", r.SourceAttempt, "Synthetic bad verifier reply"); err == nil || !strings.Contains(err.Error(), "invalid collection worker reply") {
		t.Fatal("unverified deletion result accepted", err)
	}
	if _, err := os.Stat(filepath.Join(e.Config.State, "submissions", r.SourceAttempt, "submission.tar.gz")); err != nil {
		t.Fatal("bad worker reply lost source", err)
	}
}
