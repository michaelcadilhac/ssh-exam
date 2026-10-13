package core

import "testing"

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
