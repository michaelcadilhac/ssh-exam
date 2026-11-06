package core

import (
	"crypto/ed25519"
	"testing"
	"time"
)

// Actual signed clock command, PTY input, independent supervisor and watchdog.
// Desktop native-role probing remains the parent fixture's declared seam.
func testActualTimerPause(t *testing.T, e *Engine, key ed25519.PrivateKey, original *Attempt, fd int, write func(uint64, byte, []byte)) {
	t.Helper()
	a := original
	apply := func(pause, resume bool, extra int64) {
		t.Helper()
		r := resetRequest(a)
		r.ResetID, r.RemainingSeconds, r.ExtendSeconds = ManagementID(), 0, extra
		r.PauseTimer, r.ResumeTimer = pause, resume
		cmd := Command{Audience: "class", Nonce: Token(), Expires: Millis() + operationTimeoutMS, Op: "reset-clock", Username: a.Username, Transport: a.Transport, Body: r}
		if _, err := e.Command(signedCommand(key, cmd), a.Username, a.Transport); err != nil {
			t.Fatal("signed timer control refused", err)
		}
		state, err := readStateSnapshot(e.Config.State)
		if err != nil {
			t.Fatal(err)
		}
		a = state.Attempts[a.ID]
		if a.Start != original.Start || a.OriginalDeadline != original.OriginalDeadline || a.AccessState != "HELD" || a.ClockHandoverPending {
			t.Fatal("timer control changed original interval, hold or lacks live confirmation", a)
		}
	}
	apply(true, false, 0)
	remaining := a.TimerRemainingMS
	if a.TimerPausedAt <= 0 || remaining <= 0 || remaining > 60000 || a.Deadline != original.Deadline {
		t.Fatal("pause failed to save remaining time without rewriting deadline", a)
	}
	for limit := time.Now().Add(70 * time.Second); Millis() <= original.Deadline+200; {
		view, err := e.callTerminalAuthority(terminalAuthorityRequest{Op: "view", Attempt: a.ID, Owner: *a.RegisteredOwner}, nil, false)
		if err != nil || view.View == nil || !view.View.ExecutionAuthorized {
			t.Fatalf("countdown pause interrupted verified monitored work: view=%+v hold=%+v error=%v", view.View, view.Hold, err)
		}
		if time.Now().After(limit) {
			t.Fatal("fixture never crossed its actual original one-minute deadline")
		}
		time.Sleep(250 * time.Millisecond)
	}
	if err := e.Tick(); err != nil {
		t.Fatal(err)
	}
	state, err := readStateSnapshot(e.Config.State)
	if err != nil || state.Attempts[a.ID].State != "ACTIVE" || state.Attempts[a.ID].TimerRemainingMS != remaining {
		t.Fatal("paused timer expired or lost saved remaining time", err)
	}
	write(2, 0, []byte("check\n"))
	if _, err := supervisionReadUntil(fd, "BUFFER:synthetic-buffer-not-on-disk:", time.Second); err != nil {
		t.Fatal("student could not keep working past old deadline while timer paused", err)
	}
	apply(false, false, 60)
	if a.TimerRemainingMS != remaining+60000 {
		t.Fatal("time increase was not immediate on paused timer", a)
	}
	before := Millis()
	apply(false, true, 0)
	if a.TimerPausedAt != 0 || a.TimerRemainingMS != 0 || a.Deadline < before+remaining+60000 || a.Deadline > Millis()+remaining+60000 {
		t.Fatal("timer resume lost remaining allowance or added pause twice", a)
	}
	write(3, 0, []byte("check\n"))
	if _, err := supervisionReadUntil(fd, "BUFFER:synthetic-buffer-not-on-disk:", time.Second); err != nil {
		t.Fatal("timer resume lost shell memory or input", err)
	}
	apply(true, false, 0)
	if _, err := e.callTerminalAuthority(terminalAuthorityRequest{Op: "revoke", Attempt: a.ID, Owner: *a.RegisteredOwner, Cause: "recording-failure"}, nil, false); err != nil {
		t.Fatal(err)
	}
	for limit := time.Now().Add(3 * time.Second); ; {
		if err := e.Tick(); err != nil {
			t.Fatal(err)
		}
		state, err := readStateSnapshot(e.Config.State)
		if err != nil {
			t.Fatal(err)
		}
		held := state.Attempts[a.ID]
		if held.State == "LOCKED" && held.RetainedHold == "held" {
			if !timerPaused(held) || held.TimerRemainingMS != a.TimerRemainingMS {
				t.Fatal("monitoring hold lost paused countdown", held)
			}
			break
		}
		if time.Now().After(limit) {
			t.Fatal("paused countdown bypassed a recording safety hold", held)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestPausedCountdownFinishProtectsSavedFilesAfterOldDeadline(t *testing.T) {
	e, config, _ := finalFixture(t, "ACTIVE", Millis()-1000)
	if err := e.WithState(func() error {
		a := e.state.Attempts[finalID]
		a.MonitoringMode, a.ClockRevision = "v1", 1
		a.TimerPausedAt, a.TimerRemainingMS = a.Deadline-60000, 60000
		a.OriginalDeadline = a.Deadline
		a.ClockResets = []ClockReset{{ID: ManagementID(), Revision: 1, PauseTimer: true, RequestedAt: a.TimerPausedAt, TimerPausedAt: a.TimerPausedAt, TimerRemainingMS: a.TimerRemainingMS, Deadline: a.Deadline}}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	before := Millis()
	result, err := e.Call("finalize-attempt", Request{ID: finalID, Reason: "student finish"})
	if err != nil {
		t.Fatal(err)
	}
	a := result.(*Attempt)
	if !a.Protected || a.State != "COMPLETED" || a.Reason != "student finish" || a.Ended < before || a.Ended <= a.Deadline || a.TimerRemainingMS != 60000 {
		t.Fatalf("paused Finish lost actual end time, policy or protected work: %+v", a)
	}
	restarted, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	r := resetRequest(inspectFinal(t, restarted))
	r.RemainingSeconds, r.ResumeTimer = 0, true
	if _, err := restarted.Call("reset-clock", r); err == nil {
		t.Fatal("timer Resume reopened a protected completed submission")
	}
}
