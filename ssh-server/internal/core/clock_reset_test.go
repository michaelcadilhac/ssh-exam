package core

import (
	"sync"
	"syscall"
	"testing"
	"time"
)

func resetRequest(a *Attempt) Request {
	return Request{ID: a.ID, ResetID: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", Actor: "instructor", RequestedAt: Millis(), RemainingSeconds: 5400, ClockRevision: a.ClockRevision, Deadline: a.Deadline}
}
func TestClockResetLivePreservesSSHAndOriginalIntervalAcrossRestart(t *testing.T) {
	e, c, _ := finalFixture(t, "ACTIVE", Millis()+600000)
	a := inspectFinal(t, e)
	r := resetRequest(a)
	oldStart, oldLease := a.Start, a.Lease
	if _, err := e.Call("reset-clock", r); err != nil {
		t.Fatal(err)
	}
	changed := inspectFinal(t, e)
	if changed.Start != oldStart || changed.Lease != oldLease || changed.State != "ACTIVE" || changed.Generation != 0 || changed.Deadline != r.RequestedAt+5400000 || changed.OriginalDeadline != r.Deadline {
		t.Fatalf("reset interrupted session or lost original interval: %+v", changed)
	}
	restarted, _ := New(c)
	before := changed.Deadline
	if _, err := restarted.Call("reset-clock", r); err != nil {
		t.Fatal("idempotent retry failed", err)
	}
	changed = inspectFinal(t, restarted)
	if changed.Deadline != before || changed.ClockRevision != 1 || len(changed.ClockResets) != 1 {
		t.Fatal("retry restarted clock")
	}
	r.RemainingSeconds = 600
	if _, err := restarted.Call("reset-clock", r); err == nil {
		t.Fatal("conflicting reset retry accepted")
	}
}
func TestConcurrentClockResetsCompareRevisions(t *testing.T) {
	e, c, _ := finalFixture(t, "ACTIVE", Millis()+5400000)
	other, _ := New(c)
	a := inspectFinal(t, e)
	r1 := resetRequest(a)
	r2 := r1
	r2.ResetID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
	var wg sync.WaitGroup
	wg.Add(2)
	results := make(chan error, 2)
	for i, engine := range []*Engine{e, other} {
		go func(i int, engine *Engine) {
			defer wg.Done()
			r := r1
			if i == 1 {
				r = r2
			}
			_, err := engine.Call("reset-clock", r)
			results <- err
		}(i, engine)
	}
	wg.Wait()
	close(results)
	successes := 0
	for err := range results {
		if err == nil {
			successes++
		}
	}
	if successes != 1 || inspectFinal(t, e).ClockRevision != 1 {
		t.Fatal("concurrent resets overwrote each other")
	}
}
func TestClockExtensionPreventsCollectionAtPriorDeadline(t *testing.T) {
	e, _, _ := finalFixture(t, "ACTIVE", Millis()+300)
	if _, err := e.Call("renew-execution-lease", Request{ID: finalID}); err != nil {
		t.Fatal(err)
	}
	r := resetRequest(inspectFinal(t, e))
	r.RemainingSeconds = 60
	if _, err := e.Call("reset-clock", r); err != nil {
		t.Fatal(err)
	}
	time.Sleep(350 * time.Millisecond)
	if err := e.Tick(); err != nil {
		t.Fatal(err)
	}
	a := inspectFinal(t, e)
	if a.State != "ACTIVE" || a.Protected || a.OriginalDeadline >= Millis() || a.Deadline <= Millis() {
		t.Fatal("prior deadline collected extended exam")
	}
}
func TestShortenedClockNeverShortensOrdinaryAccessHold(t *testing.T) {
	e, _, _ := finalFixture(t, "ACTIVE", Millis()+5400000)
	r := resetRequest(inspectFinal(t, e))
	r.RemainingSeconds = 60
	if _, err := e.Call("reset-clock", r); err != nil {
		t.Fatal(err)
	}
	a := inspectFinal(t, e)
	a.Deadline = Millis() - 1
	a.UptimeDeadline = uptime() - 1
	if restrictionElapsed(a) {
		t.Fatal("shorter clock released original access hold")
	}
}
func TestClockResetCannotReopenCompletedOrExpiredAttempt(t *testing.T) {
	for _, state := range []string{"ACTIVE", "COMPLETED", "FINALIZING", "COLLECTION_FAILED"} {
		e, _, _ := finalFixture(t, state, Millis()-1)
		if _, err := e.Call("reset-clock", resetRequest(inspectFinal(t, e))); err == nil {
			t.Fatalf("reset reopened %s", state)
		}
	}
}

func TestCutoffCannotFreezeUsingADeadlineSupersededByReset(t *testing.T) {
	e, c, _ := finalFixture(t, "LOCKED", Millis()-1000)
	r := resetRequest(inspectFinal(t, e))
	r.RequestedAt = r.Deadline - 1000
	r.RemainingSeconds = 60
	guard, err := e.timingLock(syscall.LOCK_EX)
	if err != nil {
		t.Fatal(err)
	}
	other, _ := New(c)
	froze := false
	other.cutoff = func(*Attempt) error { froze = true; return nil }
	done := make(chan error, 1)
	go func() { done <- other.Cutoff() }()
	// Install an already authenticated outbound reset while holding the same
	// barrier the real reset uses; cutoff must read the newly committed deadline.
	if err := e.WithState(func() error {
		a := e.state.Attempts[finalID]
		a.OriginalDeadline = a.Deadline
		a.Deadline = r.RequestedAt + 60000
		a.UptimeDeadline = uptime() + 60
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	guard.Close()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if froze {
		t.Fatal("cutoff froze the superseded interval")
	}
}
