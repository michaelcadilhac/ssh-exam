package core

import (
	"strings"
	"testing"
)

func TestSignedTimingExtensionAfterSSHExitNeedsNoDeadSupervisor(t *testing.T) {
	e, _, _ := finalFixture(t, "LOCKED", Millis()-1000)
	if err := e.WithState(func() error {
		a := e.state.Attempts[finalID]
		a.MonitoringMode, a.Transport, a.Boot = "v1", strings.Repeat("a", 64), boot()
		a.BrowserSSH, a.TerminalSupervised = true, true
		a.OriginalDeadline, a.OriginalUptimeDeadline = a.Deadline, a.UptimeDeadline
		a.Lease, a.Units = 0, nil
		a.RegisteredOwner = &monitoringOwner{Attempt: a.ID, Exam: a.Exam, Username: a.Username, UID: a.UID, TransportHash: a.Transport, Boot: a.Boot, PageEpoch: strings.Repeat("b", 64), InputEpoch: strings.Repeat("c", 64), ClockRevision: a.ClockRevision}
		owner := *a.RegisteredOwner
		a.SSHExitedOwner = &owner
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	original := inspectFinal(t, e)
	timingServer(t, e, func(a *Attempt, nonce string) (timingReply, int) {
		reply := timingDecision(a, nonce)
		r := resetRequest(a)
		r.RequestedAt, r.RemainingSeconds, r.ExtendSeconds = a.Deadline-1000, 0, 1800
		reply.Reset, reply.Collect = &r, false
		return reply, 200
	})
	if err := e.RefreshExpiredTiming(); err != nil {
		t.Fatal(err)
	}
	a := inspectFinal(t, e)
	if a.Deadline != original.Deadline+1800000 || a.ClockRevision != 1 || a.State != "LOCKED" || a.Lease != 0 || a.Protected || a.AccessState != "HELD" || a.OriginalDeadline != original.OriginalDeadline || a.Transport != original.Transport || a.Start != original.Start || a.Generation != original.Generation {
		t.Fatalf("clock update changed work authority or lost the interval: %+v", a)
	}
	if len(a.ClockResets) != 1 || a.ClockResets[0].ExtendSeconds != 1800 || !clockWithoutRetainedWork(a) {
		t.Fatal("clock result lost its exact adjustment/negative SSH scope")
	}
	restarted, err := New(e.Config)
	if err != nil {
		t.Fatal(err)
	}
	a = inspectFinal(t, restarted)
	if a.Deadline != original.Deadline+1800000 || a.State != "LOCKED" || a.Lease != 0 || a.Protected || a.AccessState != "HELD" {
		t.Fatal("restart recreated authority or lost the clock")
	}
}

func TestClockChangeStillRefusesUnsafeOrLiveRetainedOwnership(t *testing.T) {
	for _, mode := range []string{"no-exit", "wrong-exit", "recorded-work", "active", "not-supervised"} {
		t.Run(mode, func(t *testing.T) {
			e, _, _ := finalFixture(t, "LOCKED", Millis()+60000)
			if err := e.WithState(func() error {
				a := e.state.Attempts[finalID]
				a.MonitoringMode, a.Transport, a.Boot = "v1", strings.Repeat("a", 64), boot()
				a.BrowserSSH, a.TerminalSupervised = true, true
				a.RegisteredOwner = &monitoringOwner{Attempt: a.ID, Exam: a.Exam, Username: a.Username, UID: a.UID, TransportHash: a.Transport, Boot: a.Boot, PageEpoch: strings.Repeat("b", 64), InputEpoch: strings.Repeat("c", 64)}
				owner := *a.RegisteredOwner
				a.SSHExitedOwner = &owner
				switch mode {
				case "no-exit":
					a.SSHExitedOwner = nil
				case "wrong-exit":
					a.SSHExitedOwner.TransportHash = strings.Repeat("d", 64)
				case "recorded-work":
					a.Units = []string{"exam-" + a.ID + "-00000000-0000-4000-8000-000000000000-11111111-1111-4111-8111-111111111111.scope"}
				case "active":
					a.State = "ACTIVE"
				case "not-supervised":
					a.TerminalSupervised = false
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			before := inspectFinal(t, e)
			r := resetRequest(before)
			if _, err := e.Call("reset-clock", r); err == nil {
				t.Fatal("clock change bypassed missing live supervisor without exact no-work/SSH-exit evidence")
			}
			a := inspectFinal(t, e)
			if a.Deadline != before.Deadline || a.ClockRevision != before.ClockRevision || len(a.ClockResets) != 0 || a.State != before.State || a.AccessState != before.AccessState {
				t.Fatal("refusal changed clock or access authority")
			}
		})
	}
}
