package core

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"syscall"
)

// Separate from the collection flock: independent cutoffs stay fast while a
// collection is compressing, and never freeze against a superseded deadline.
func (e *Engine) timingLock(mode int) (*os.File, error) {
	f, err := os.OpenFile(filepath.Join(e.Config.State, "timing.lock"), os.O_CREATE|os.O_RDWR|syscall.O_NOFOLLOW, 0600)
	if err != nil {
		return nil, err
	}
	if err := syscall.Flock(int(f.Fd()), mode); err != nil {
		f.Close()
		return nil, err
	}
	return f, nil
}

func (e *Engine) resetClock(a *Attempt, r Request, offline bool) error {
	guard, err := e.timingLock(syscall.LOCK_EX)
	if err != nil {
		return err
	}
	defer guard.Close()
	if !attemptID.MatchString(r.ResetID) || len(strings.TrimSpace(r.Actor)) == 0 || len(r.Actor) > 128 || !validClockAdjustment(r) {
		return errors.New("invalid clock reset")
	}
	for _, previous := range a.ClockResets {
		if previous.ID == r.ResetID {
			if previous.Actor != r.Actor || previous.RequestedAt != r.RequestedAt || previous.RemainingSeconds != r.RemainingSeconds || previous.ExtendSeconds != r.ExtendSeconds || previous.PauseTimer != r.PauseTimer || previous.ResumeTimer != r.ResumeTimer || previous.Revision != r.ClockRevision+1 || previous.PreviousDeadline != r.Deadline {
				return errors.New("conflicting clock reset retry")
			}
			if a.MonitoringMode == "v1" && previous.Revision == a.ClockRevision && !a.Protected && (a.State == "ACTIVE" || a.State == "LOCKED") {
				return e.commitTerminalClock(a, previous)
			}
			return nil // Lost acknowledgments do not restart the clock again.
		}
	}
	now := Millis()
	if a.Start == 0 || a.Protected || (a.State != "ACTIVE" && a.State != "LOCKED") || (!offline && (expired(a) || (a.State == "ACTIVE" && ((a.MonitoringMode != "v1" && a.Lease <= now) || a.Boot != boot())))) {
		return errors.New("clock reset requires a live, unfinished exam")
	}
	if a.ClockRevision != r.ClockRevision || a.Deadline != r.Deadline {
		return errors.New("clock changed; refresh before resetting")
	}
	wasPaused := timerPaused(a)
	if (r.PauseTimer || r.ResumeTimer) && a.MonitoringMode != "v1" {
		return errors.New("timer controls require matching retained-monitoring roles; no clock changed")
	}
	if (r.PauseTimer && wasPaused) || (r.ResumeTimer && !wasPaused) {
		return errors.New("timer state changed; refresh before pausing or resuming the countdown")
	}
	if r.RequestedAt < a.Start || (!wasPaused && r.RequestedAt >= a.Deadline) || r.RequestedAt > now+1000 {
		return errors.New("clock reset request expired")
	}
	// Build the proposed interval without publishing it. Retained mode checks
	// current root authority, rather than a deliberately coalesced disk lease.
	proposed := *a
	a = &proposed
	if a.OriginalDeadline == 0 {
		a.OriginalDeadline = a.Deadline
		a.OriginalUptimeDeadline = a.UptimeDeadline
	}
	if a.Boot != boot() {
		a.OriginalUptimeDeadline = 0
		a.Boot = boot()
	}
	previous := a.Deadline
	appliedBoot := int64(0)
	if r.PauseTimer {
		a.TimerPausedAt, a.TimerRemainingMS = r.RequestedAt, previous-r.RequestedAt
	} else if r.ResumeTimer {
		a.Deadline = r.RequestedAt + a.TimerRemainingMS
		a.TimerPausedAt, a.TimerRemainingMS = 0, 0
		appliedBoot, err = monitoringBootMillis()
		if err != nil {
			return err
		}
	} else if wasPaused {
		if r.ExtendSeconds > 0 {
			a.TimerRemainingMS += r.ExtendSeconds * 1000
		} else {
			a.TimerRemainingMS = r.RemainingSeconds * 1000
		}
		a.Deadline = a.TimerPausedAt + a.TimerRemainingMS
	} else if r.ExtendSeconds > 0 {
		a.Deadline = previous + r.ExtendSeconds*1000
	} else {
		a.Deadline = r.RequestedAt + r.RemainingSeconds*1000
	}
	if r.ResumeTimer {
		a.UptimeDeadline = float64(appliedBoot+a.Deadline-now) / 1000
	} else if a.MonitoringMode == "v1" {
		a.UptimeDeadline += float64(a.Deadline-previous) / 1000
	} else {
		a.UptimeDeadline = uptime() + float64(a.Deadline-now)/1000
	}
	a.TimingPendingSince = 0
	a.TimingNextCheck = 0
	a.TimingVerifiedAt = 0
	a.TimingVerifiedDeadline = 0
	a.ClockRevision++
	refreshRegisteredOwnerClock(a)
	change := ClockReset{ID: r.ResetID, Actor: r.Actor, RequestedAt: r.RequestedAt, AppliedAt: now, PreviousDeadline: previous, Deadline: a.Deadline, RemainingSeconds: r.RemainingSeconds, ExtendSeconds: r.ExtendSeconds, Revision: a.ClockRevision, PauseTimer: r.PauseTimer, ResumeTimer: r.ResumeTimer, TimerPausedAt: a.TimerPausedAt, TimerRemainingMS: a.TimerRemainingMS, AppliedBootMS: appliedBoot}
	a.ClockResets = append(append([]ClockReset(nil), a.ClockResets...), change)
	a.ClockHandoverPending = a.MonitoringMode == "v1" && !clockWithoutRetainedWork(a)
	if a.ClockHandoverPending {
		q, err := e.terminalClockRequest(a, change)
		if err != nil {
			return err
		}
		if _, err := e.callTerminalAuthority(q, nil, false); err != nil {
			return err
		}
	}
	// Preserve the caller's canonical object/result while publishing only after
	// the nonpermitting check. A failed live check cannot consume the clock intent.
	*e.state.Attempts[a.ID] = *a
	a = e.state.Attempts[a.ID]
	// Persist before releasing the cutoff barrier, not just at the caller's final save.
	if err := e.save(); err != nil {
		return err
	}
	e.Audit("instructor-clock-reset", a.ID)
	if a.MonitoringMode == "v1" {
		if err := e.commitTerminalClock(a, change); err != nil {
			return fmt.Errorf("clock intent %s is durably recorded; %w", change.ID, err)
		}
	}
	return nil
}

func validClockAdjustment(r Request) bool {
	if r.PauseTimer || r.ResumeTimer {
		return r.PauseTimer != r.ResumeTimer && r.RemainingSeconds == 0 && r.ExtendSeconds == 0
	}
	if r.ExtendSeconds != 0 {
		return r.RemainingSeconds == 0 && r.ExtendSeconds >= 60 && r.ExtendSeconds <= 21600 && r.ExtendSeconds%60 == 0
	}
	return r.RemainingSeconds >= 60 && r.RemainingSeconds <= 21600 && r.RemainingSeconds%60 == 0
}
