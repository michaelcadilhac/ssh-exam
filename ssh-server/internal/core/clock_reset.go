package core

import (
	"errors"
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
			if previous.Actor != r.Actor || previous.RequestedAt != r.RequestedAt || previous.RemainingSeconds != r.RemainingSeconds || previous.ExtendSeconds != r.ExtendSeconds || previous.Revision != r.ClockRevision+1 || previous.PreviousDeadline != r.Deadline {
				return errors.New("conflicting clock reset retry")
			}
			return nil // Lost acknowledgments do not restart the clock again.
		}
	}
	now := Millis()
	if a.Start == 0 || a.Protected || (a.State != "ACTIVE" && a.State != "LOCKED") || (!offline && (expired(a) || (a.State == "ACTIVE" && (a.Lease <= now || a.Boot != boot())))) {
		return errors.New("clock reset requires a live, unfinished exam")
	}
	if a.ClockRevision != r.ClockRevision || a.Deadline != r.Deadline {
		return errors.New("clock changed; refresh before resetting")
	}
	if r.RequestedAt < a.Start || r.RequestedAt >= a.Deadline || r.RequestedAt > now+1000 {
		return errors.New("clock reset request expired")
	}
	if a.OriginalDeadline == 0 {
		a.OriginalDeadline = a.Deadline
		a.OriginalUptimeDeadline = a.UptimeDeadline
	}
	if a.Boot != boot() {
		a.OriginalUptimeDeadline = 0
		a.Boot = boot()
	}
	previous := a.Deadline
	if r.ExtendSeconds > 0 {
		a.Deadline = previous + r.ExtendSeconds*1000
	} else {
		a.Deadline = r.RequestedAt + r.RemainingSeconds*1000
	}
	a.UptimeDeadline = uptime() + float64(a.Deadline-now)/1000
	a.TimingPendingSince = 0
	a.TimingNextCheck = 0
	a.TimingVerifiedAt = 0
	a.TimingVerifiedDeadline = 0
	a.ClockRevision++
	a.ClockResets = append(a.ClockResets, ClockReset{ID: r.ResetID, Actor: r.Actor, RequestedAt: r.RequestedAt, AppliedAt: now, PreviousDeadline: previous, Deadline: a.Deadline, RemainingSeconds: r.RemainingSeconds, ExtendSeconds: r.ExtendSeconds, Revision: a.ClockRevision})
	// Persist before releasing the cutoff barrier, not just at the caller's final save.
	if err := e.save(); err != nil {
		return err
	}
	e.Audit("instructor-clock-reset", a.ID)
	return nil
}

func validClockAdjustment(r Request) bool {
	if r.ExtendSeconds != 0 {
		return r.RemainingSeconds == 0 && r.ExtendSeconds >= 60 && r.ExtendSeconds <= 21600 && r.ExtendSeconds%60 == 0
	}
	return r.RemainingSeconds >= 60 && r.RemainingSeconds <= 21600 && r.RemainingSeconds%60 == 0
}
