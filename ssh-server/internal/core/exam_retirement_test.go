package core

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func retirementFixture(t *testing.T) (Config, State, func()) {
	t.Helper()
	c := Config{AgentID: "class", State: filepath.Join(t.TempDir(), "state"), Work: filepath.Join(t.TempDir(), "work")}
	for _, path := range []string{c.State, c.Work} {
		if err := os.Mkdir(path, 0700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(c.State, "initialized"), []byte("Synthetic initialized state\n"), 0600); err != nil {
		t.Fatal(err)
	}
	s := State{Attempts: map[string]*Attempt{}, Caps: map[string]Capability{}, Registrations: map[string]string{}}
	save := func() {
		t.Helper()
		b, err := json.Marshal(s)
		if err == nil {
			err = os.WriteFile(filepath.Join(c.State, "state.json"), b, 0600)
		}
		if err != nil {
			t.Fatal(err)
		}
	}
	save()
	return c, s, save
}

func TestNativeRetirementRefusesMissingAuthorityWithoutCreatingState(t *testing.T) {
	for _, existing := range []bool{false, true} {
		base := t.TempDir()
		c := Config{AgentID: "class", State: filepath.Join(base, "missing-state"), Work: base}
		if existing {
			if err := os.Mkdir(c.State, 0700); err != nil {
				t.Fatal(err)
			}
		}
		if _, err := ObserveExamRetirement(c, "old"); err == nil {
			t.Fatal("missing authority accepted")
		}
		if _, err := os.Lstat(filepath.Join(c.State, "collection-locks")); !os.IsNotExist(err) {
			t.Fatal("inspection initialized lock storage without valid initialized authority", err)
		}
		if !existing {
			if _, err := os.Lstat(c.State); !os.IsNotExist(err) {
				t.Fatal("inspection created missing state root", err)
			}
		}
	}
}

func TestNativeRetirementAcceptsSecuredCollectorHistoryWithoutClearingDiagnostics(t *testing.T) {
	e, _, _ := finalFixture(t, "LOCKED", Millis()-1000)
	e.Config.AgentID = "class"
	if err := e.WithState(func() error {
		e.state.Attempts[finalID].Errors = []string{"Historical collection retry diagnostic"}
		// The old shared test fixture omits this field. Author its known synthetic
		// original interval before collection; product code must never invent it.
		e.state.Attempts[finalID].OriginalDeadline = e.state.Attempts[finalID].Deadline
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	result, err := e.Call("finalize-attempt", Request{ID: finalID, Reason: "Synthetic protected completion before retirement"})
	if err != nil {
		t.Fatal(err)
	}
	public := result.(*Attempt)
	stored, err := e.recoveryRevocationState()
	if err != nil {
		t.Fatal(err)
	}
	a := stored.Attempts[finalID]
	if public.State != "COMPLETED" || !a.Protected || a.CollectionJob == "" || len(a.Errors) == 0 {
		t.Fatal("fixture missed real completed collector history", a)
	}
	// Explicitly synthetic prior release, not a real kernel/account-policy claim.
	if err := e.WithState(func() error { e.state.Attempts[finalID].AccessState = "RELEASED"; return nil }); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(filepath.Join(e.Config.State, "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	r, err := ObserveExamRetirement(e.Config, a.Exam)
	if err != nil || len(r.Attempts) != 1 || r.Attempts[0].Checksum != a.Checksum {
		current, readErr := e.recoveryRevocationState()
		if readErr != nil {
			t.Fatal(readErr)
		}
		v := current.Attempts[finalID]
		t.Fatalf("secured historical diagnostics falsely block retirement: %v; state=%s access=%s access_error=%q policy=%s policy_error=%q pending=%d start=%d deadline=%d original=%d ended=%d units=%d", err, v.State, v.AccessState, v.AccessError, v.PolicyState, v.PolicyError, v.TimingPendingSince, v.Start, v.Deadline, v.OriginalDeadline, v.Ended, len(v.Units))
	}
	after, err := os.ReadFile(filepath.Join(e.Config.State, "state.json"))
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("observation cleared historical diagnostics", err)
	}
}

func TestNativeRetirementObservesWithoutReconciliationOrStateWrites(t *testing.T) {
	c, s, save := retirementFixture(t)
	start := Millis() - 1200000
	s.Attempts[recoveryID] = &Attempt{ID: recoveryID, Exam: "old", Username: "student", UID: 10001, State: "COMPLETED", Start: start, Deadline: start + 600000, OriginalDeadline: start + 600000, Ended: start + 600000, Protected: true, Checksum: strings.Repeat("a", 64), AccessState: "RELEASED", PolicyState: "NORMAL"}
	save()
	before, err := os.ReadFile(filepath.Join(c.State, "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	r, err := ObserveExamRetirement(c, "old")
	if err != nil || len(r.Attempts) != 1 || r.Attempts[0].ID != recoveryID || r.StateHash != Hash(before) {
		t.Fatal("closed native history not positively observed", r, err)
	}
	after, err := os.ReadFile(filepath.Join(c.State, "state.json"))
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("observation changed native authority", err)
	}
	if r, err := ObserveExamRetirement(c, "unused"); err != nil || len(r.Attempts) != 0 {
		t.Fatal("empty exam inventory", r, err)
	}
	s.Attempts[retryRecoveryID] = &Attempt{ID: retryRecoveryID, Exam: "cancelled", Username: "student", UID: 10001, State: "CANCELLED_BEFORE_START", Ended: Millis(), PolicyState: "NORMAL", CancellationCleanupComplete: true}
	save()
	if r, err := ObserveExamRetirement(c, "cancelled"); err != nil || len(r.Attempts) != 1 || r.Attempts[0].Start != 0 {
		t.Fatal("positive no-start cancellation unavailable", r, err)
	}
	s.Attempts[retryRecoveryID].CancellationCleanupComplete = false
	save()
	if _, err := ObserveExamRetirement(c, "cancelled"); err == nil {
		t.Fatal("unconfirmed cancellation cleanup accepted")
	}
	e := &Engine{Config: c}
	lock, err := e.recoveryCatalogLock()
	if err != nil {
		t.Fatal(err)
	}
	_, err = ObserveExamRetirement(c, "old")
	lock.Close()
	if err == nil || !strings.Contains(err.Error(), "changing") {
		t.Fatal("busy inventory was not refused", err)
	}
}

func TestNativeRetirementRefusesDurableNoStartContradictions(t *testing.T) {
	for _, kind := range []string{"orphan-work", "orphan-submission", "published-work", "initialized-work", "cancelled-submission", "held", "policy", "pending", "unknown-field", "unsafe-state"} {
		t.Run(kind, func(t *testing.T) {
			c, s, save := retirementFixture(t)
			a := &Attempt{ID: recoveryID, Exam: "old", Username: "student", UID: 10001, State: "CANCELLED_BEFORE_START", Ended: Millis(), AccessState: "RELEASED", PolicyState: "NORMAL", CancellationCleanupComplete: true}
			s.Attempts[a.ID] = a
			parent := c.Work
			if kind == "orphan-submission" || kind == "cancelled-submission" {
				parent = filepath.Join(c.State, "submissions")
				if err := os.Mkdir(parent, 0700); err != nil {
					t.Fatal(err)
				}
			}
			if strings.Contains(kind, "work") || strings.Contains(kind, "submission") {
				path := filepath.Join(parent, a.ID)
				if err := os.Mkdir(path, 0700); err != nil {
					t.Fatal(err)
				}
				if strings.HasPrefix(kind, "orphan-") {
					delete(s.Attempts, a.ID)
				}
				if kind == "published-work" {
					if err := os.Mkdir(filepath.Join(path, "work"), 0700); err != nil {
						t.Fatal(err)
					}
				}
				if kind == "initialized-work" {
					if err := os.WriteFile(filepath.Join(path, "initialized"), []byte("published"), 0600); err != nil {
						t.Fatal(err)
					}
				}
			}
			switch kind {
			case "held":
				a.State = "LOCKED"
				a.Start = Millis() - 1000
				a.AccessState = "HELD"
			case "policy":
				a.PolicyGeneration = "original"
				a.PolicyState = "RESTORE_FAILED"
			case "pending":
				a.PreparationPending = true
			}
			save()
			path := filepath.Join(c.State, "state.json")
			if kind == "unknown-field" {
				b, _ := os.ReadFile(path)
				b = append([]byte(`{"future_authority":true,`), b[1:]...)
				if err := os.WriteFile(path, b, 0600); err != nil {
					t.Fatal(err)
				}
			}
			if kind == "unsafe-state" {
				if err := os.Chmod(path, 0644); err != nil {
					t.Fatal(err)
				}
			}
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if r, err := ObserveExamRetirement(c, "old"); err == nil {
				t.Fatal("unsafe authority became reconciliation evidence", kind, r)
			} else if strings.HasPrefix(kind, "orphan-") && !strings.Contains(err.Error(), "unknown workspace/submission") ||
				(kind == "published-work" || kind == "initialized-work") && !strings.Contains(err.Error(), "published work contradicts no-start") ||
				kind == "cancelled-submission" && !strings.Contains(err.Error(), "submission contradicts no-start") {
				t.Fatal("regression did not reach intended durable contradiction", kind, err)
			}
			after, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(before, after) {
				t.Fatal("refusal changed native history", kind, err)
			}
		})
	}
}

func TestNativeRetirementEvidenceRejectsAliasesDuplicatesAndUnclosedFacts(t *testing.T) {
	c, _, _ := retirementFixture(t)
	r, err := ObserveExamRetirement(c, "old")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(r)
	for _, data := range [][]byte{bytes.Replace(b, []byte(`"version":1`), []byte(`"Version":1`), 1), bytes.Replace(b, []byte(`"version":1`), []byte(`"version":1,"version":1`), 1), bytes.Replace(b, []byte(`"attempts":[]`), []byte(`"attempts":null`), 1), append(b, []byte(`{}`)...)} {
		if _, err := DecodeExamRetirementEvidence(data); err == nil {
			t.Fatal("ambiguous evidence accepted", string(data))
		}
	}
	r.Attempts = []ExamRetirementAttempt{{ID: recoveryID, Username: "student", UID: 10001, State: "COMPLETED", Start: 1, Deadline: 2, OriginalDeadline: 2, Protected: true, Checksum: strings.Repeat("a", 64), AccessState: "HELD"}}
	b, _ = json.Marshal(r)
	if _, err := DecodeExamRetirementEvidence(b); err == nil {
		t.Fatal("held account accepted")
	}
}
