package core

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestSandboxBeginEnforcesSavedFiniteWindow(t *testing.T) {
	for _, route := range []string{"native", "signed"} {
		for _, window := range []string{"unconfigured", "legacy-unbounded", "future", "expired", "open"} {
			t.Run(route+"/"+window, func(t *testing.T) {
				e, _ := workspaceFixture(t)
				account := e.Config.Accounts["student"]
				key := commandKeys(t, e)
				e.Config.Accounts["student"] = account
				if err := e.WithState(func() error {
					a := e.state.Attempts[finalID]
					a.Exam, a.Settings.ID, a.Settings.Duration = SandboxExamID, SandboxExamID, SandboxDurationSeconds
					a.Settings.Earliest, a.Settings.Latest = Millis()-60000, Millis()+60000
					switch window {
					case "unconfigured":
						a.Settings.Earliest, a.Settings.Latest = 0, 1
					case "legacy-unbounded":
						a.Settings.Earliest, a.Settings.Latest = 0, 8640000000000000
					case "future":
						a.Settings.Earliest, a.Settings.Latest = Millis()+60000, Millis()+120000
					case "expired":
						a.Settings.Earliest, a.Settings.Latest = Millis()-120000, Millis()-60000
					}
					return nil
				}); err != nil {
					t.Fatal(err)
				}
				if _, err := e.Call("prepare-workspace", Request{ID: finalID}); err != nil {
					t.Fatal(err)
				}
				checks := 0
				e.activationPrepare = func(*Attempt) error { checks++; return nil }
				var result any
				var err error
				if route == "native" {
					result, err = e.Call("activate-attempt", Request{ID: finalID})
				} else {
					cmd := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "activate-attempt", Username: "student", Transport: "ssh-a", Body: Request{ID: finalID}}
					result, err = e.Command(signedCommand(key, cmd), "student", "ssh-a")
				}
				if window != "open" {
					if err == nil || !strings.Contains(err.Error(), "window") || checks != 0 {
						t.Fatalf("closed sandbox reached activation checks: result=%v checks=%d error=%v", result, checks, err)
					}
					assertUnstartedWorkspace(t, e, finalID)
					return
				}
				if err != nil || checks != 1 {
					t.Fatalf("open sandbox did not begin: %v checks=%d", err, checks)
				}
				a := inspectFinal(t, e)
				if a.State != "ACTIVE" || a.Deadline-a.Start != 300000 || a.OriginalDeadline != a.Deadline {
					t.Fatalf("sandbox clock changed: %+v", a)
				}
				before := *a
				// A saved window is Begin admission only. An exact retry after it
				// closes must return the original interval, not refuse or restart.
				if err := e.WithState(func() error { e.state.Attempts[finalID].Settings.Latest = Millis() - 1; return nil }); err != nil {
					t.Fatal(err)
				}
				again, err := e.Call("activate-attempt", Request{ID: finalID})
				if err != nil || again.(*Attempt).Start != before.Start || again.(*Attempt).Deadline != before.Deadline || again.(*Attempt).OriginalDeadline != before.OriginalDeadline {
					t.Fatal("closed window changed a started interval", err)
				}
			})
		}
	}
}

func TestSandboxWindowExpiresDuringNativeBeginChecks(t *testing.T) {
	e, _ := workspaceFixture(t)
	latest := Millis() + 2000
	if err := e.WithState(func() error {
		a := e.state.Attempts[finalID]
		a.Exam, a.Settings.ID, a.Settings.Duration = SandboxExamID, SandboxExamID, SandboxDurationSeconds
		a.Settings.Earliest, a.Settings.Latest = latest-60000, latest
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Call("prepare-workspace", Request{ID: finalID}); err != nil {
		t.Fatal(err)
	}
	checks := false
	e.activationPrepare = func(*Attempt) error { checks = true; time.Sleep(time.Until(time.UnixMilli(latest + 5))); return nil }
	_, err := e.Call("activate-attempt", Request{ID: finalID})
	if !checks || err == nil || !strings.Contains(err.Error(), "window") {
		t.Fatalf("late setup started or fixture missed setup: checks=%v error=%v", checks, err)
	}
	assertUnstartedWorkspace(t, e, finalID)
}

func TestSandboxPreparationRefusesUnconfiguredWindowBeforeReadiness(t *testing.T) {
	e, _, r := preparationFixture(t)
	r.Exam, r.Settings.ID = SandboxExamID, SandboxExamID
	r.Settings.Earliest, r.Settings.Latest = 0, 8640000000000000
	called := false
	e.preparationReady = func() (bool, []string) { called = true; return false, []string{"synthetic readiness"} }
	_, err := e.Call("prepare-attempt", r)
	if err == nil || !strings.Contains(err.Error(), "window") || called {
		t.Fatalf("unconfigured preparation reached readiness: called=%v error=%v", called, err)
	}
	if err := e.WithState(func() error {
		if e.state.Attempts[r.ID] != nil {
			return errors.New("closed window reserved account")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestSandboxSecureFinishReleasesForRepeatButPreservesDeadline(t *testing.T) {
	e, _, _ := finalFixture(t, "ACTIVE", Millis()+300000)
	e.WithState(func() error { e.state.Attempts[finalID].Exam = SandboxExamID; return nil })
	before := inspectFinal(t, e).Deadline
	if _, err := e.Call("finalize-attempt", Request{ID: finalID, Reason: "finish"}); err != nil {
		t.Fatal(err)
	}
	a := inspectFinal(t, e)
	if !a.Protected || a.AccessState != "RELEASED" || a.Deadline != before {
		t.Fatalf("sandbox repeat release failed: %+v", a)
	}
	if e.Busy(a.UID) != nil {
		t.Fatal("secured sandbox prevents repeat")
	}
}

func TestSandboxFailureNeverUnlocksUnsecuredWork(t *testing.T) {
	a := &Attempt{Exam: SandboxExamID, State: "COLLECTION_FAILED", Start: Millis() - 1000, Deadline: Millis() + 300000, AccessState: "HELD"}
	if !accessHeld(a) {
		t.Fatal("failed sandbox unlocked")
	}
	a.Exam = "sandbox-copy"
	if sandboxAttempt(a) {
		t.Fatal("sandbox exception escaped reserved ID")
	}
}

func TestAdministratorSandboxExceptionIsScopedAndDoesNotReplaceStudentIsolation(t *testing.T) {
	e, _, _ := finalFixture(t, "ACTIVE", Millis()+300000)
	e.Config.Accounts = map[string]Account{"student": {UID: 1001, SandboxOnly: true}}
	a := &Attempt{Username: "student", UID: 1001, Exam: SandboxExamID, AdministratorSandbox: true}
	if !e.administratorSandbox(a) || !e.hostAccess(a) || !e.recordedUnitAllowed(a, "exam-test.service") {
		t.Fatal("approved administrator sandbox rejected")
	}
	for _, bad := range []*Attempt{
		{Username: "student", UID: 1001, Exam: "midterm", AdministratorSandbox: true},
		{Username: "student", UID: 1002, Exam: SandboxExamID, AdministratorSandbox: true},
		{Username: "other", UID: 1001, Exam: SandboxExamID, AdministratorSandbox: true},
		{Username: "student", UID: 1001, Exam: SandboxExamID},
	} {
		if e.administratorSandbox(bad) || e.hostAccess(bad) || e.recordedUnitAllowed(bad, "exam-test.service") {
			t.Fatal("administrator exception escaped reserved identity/exam")
		}
	}
	if _, err := e.Call("resolve-course-accounts", Request{Usernames: []string{"student"}, Exam: "midterm"}); err == nil {
		t.Fatal("sandbox administrator enrolled in ordinary exam")
	}
	if _, err := e.Call("resolve-course-accounts", Request{Usernames: []string{"student"}, Exam: SandboxExamID}); err != nil {
		t.Fatal(err)
	}
	e.Config.Accounts["student"] = Account{UID: 1001}
	if e.administratorSandbox(a) {
		t.Fatal("ordinary course account acquired administrator exception")
	}
}
