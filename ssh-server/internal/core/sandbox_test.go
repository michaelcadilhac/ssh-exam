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
