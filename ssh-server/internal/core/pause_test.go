package core

import "testing"

func TestPauseTerminatesRecordedWritersAndRevokesTransportWithoutChangingDeadline(t *testing.T) {
	e, _, _ := finalFixture(t, "ACTIVE", Millis()+5400000)
	deadline := inspectFinal(t, e).Deadline
	terminated := false
	e.terminate = func(a *Attempt) error { terminated = true; return nil }
	e.WithState(func() error {
		a := e.state.Attempts[finalID]
		a.Transport = "old"
		a.ResumeTransport = "old"
		a.Units = []string{"exam-old.scope"}
		return nil
	})
	if _, err := e.Call("lock-attempt", Request{ID: finalID, Reason: "focus lost"}); err != nil {
		t.Fatal(err)
	}
	a := inspectFinal(t, e)
	if !terminated || a.State != "LOCKED" || len(a.Units) != 0 || a.Lease != 0 || a.ResumeTransport != "" || a.Deadline != deadline {
		t.Fatalf("pause failed %+v", a)
	}
}

func TestWatchdogPauseAlsoRequiresNewTransportEvenWithoutOpenPanes(t *testing.T) {
	e, _, _ := finalFixture(t, "ACTIVE", Millis()+5400000)
	e.WithState(func() error {
		a := e.state.Attempts[finalID]
		a.Lease = Millis() - 1
		a.ResumeTransport = "old"
		return nil
	})
	if err := e.Tick(); err != nil {
		t.Fatal(err)
	}
	a := inspectFinal(t, e)
	if a.State != "LOCKED" || a.ResumeTransport != "" {
		t.Fatalf("watchdog retained old transport %+v", a)
	}
}
