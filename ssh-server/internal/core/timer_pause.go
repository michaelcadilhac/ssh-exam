package core

// A paused countdown has no timed cutoff, but EVERY execution proof remains
// bounded by the ordinary 60s monitoring window. This exact internal ceiling is
// never a wall-clock deadline or permission reconstructed from saved state.
const pausedClockBootCeiling int64 = 1 << 52

func timerPaused(a *Attempt) bool {
	if a == nil || a.MonitoringMode != "v1" || a.TimerPausedAt <= 0 || a.TimerRemainingMS <= 0 || len(a.ClockResets) == 0 {
		return false
	}
	last := a.ClockResets[len(a.ClockResets)-1]
	return last.Revision == a.ClockRevision && last.TimerPausedAt == a.TimerPausedAt && last.TimerRemainingMS == a.TimerRemainingMS
}

func workDeadlineBootMS(a *Attempt) int64 {
	if timerPaused(a) {
		return pausedClockBootCeiling
	}
	return int64(a.UptimeDeadline * 1000)
}

func workDeadlineWallMS(a *Attempt) int64 {
	if timerPaused(a) {
		return pausedClockBootCeiling
	}
	return a.Deadline
}

func clockSnapshot(a *Attempt) *ClockReset {
	if len(a.ClockResets) == 0 {
		return nil
	}
	copy := a.ClockResets[len(a.ClockResets)-1]
	return &copy
}

func validAuthorityClockSnapshot(q terminalAuthorityRequest) bool {
	if q.Clock == nil {
		return q.Owner.ClockRevision == 0 && q.DeadlineBootMS != pausedClockBootCeiling
	}
	if q.Clock.Revision != q.Owner.ClockRevision || q.Clock.Deadline != q.Deadline {
		return false
	}
	if q.Clock.TimerPausedAt > 0 {
		return q.Clock.TimerRemainingMS > 0 && q.Clock.TimerRemainingMS <= int64(monitoringEvidenceMaxSequence) && q.DeadlineBootMS == pausedClockBootCeiling
	}
	return q.Clock.TimerRemainingMS == 0 && q.DeadlineBootMS != pausedClockBootCeiling
}

// Runtime caller: the existing atomic check-clock/commit-clock handover. A pause
// changes only the timed bound; it never refreshes coverage or thaws a hold.
func validClockHandover(q terminalAuthorityRequest, r *terminalAuthorityRuntime) bool {
	next := q.Clock
	oldPaused := r.clockReset != nil && r.clockReset.TimerPausedAt > 0
	newPaused := next.TimerPausedAt > 0
	if !oldPaused && !newPaused {
		drift := (q.DeadlineBootMS - r.deadlineBootMS) - (q.Deadline - r.deadline)
		return !next.PauseTimer && !next.ResumeTimer && next.TimerRemainingMS == 0 && drift >= -1 && drift <= 1
	}
	if newPaused {
		if q.DeadlineBootMS != pausedClockBootCeiling || next.TimerRemainingMS <= 0 || next.TimerRemainingMS > int64(monitoringEvidenceMaxSequence) || next.ResumeTimer {
			return false
		}
		if !oldPaused {
			return next.PauseTimer && next.RemainingSeconds == 0 && next.ExtendSeconds == 0 && next.TimerPausedAt == next.RequestedAt && next.RequestedAt >= r.start && next.RequestedAt < r.deadline && next.TimerRemainingMS == r.deadline-next.RequestedAt && q.Deadline == r.deadline
		}
		if next.PauseTimer || next.TimerPausedAt != r.clockReset.TimerPausedAt {
			return false
		}
		remaining := next.RemainingSeconds * 1000
		if next.ExtendSeconds > 0 {
			remaining = r.clockReset.TimerRemainingMS + next.ExtendSeconds*1000
		}
		return validClockAdjustment(Request{RemainingSeconds: next.RemainingSeconds, ExtendSeconds: next.ExtendSeconds}) && next.TimerRemainingMS == remaining && q.Deadline == next.TimerPausedAt+remaining
	}
	if !next.ResumeTimer || next.PauseTimer || next.TimerRemainingMS != 0 || next.RemainingSeconds != 0 || next.ExtendSeconds != 0 || next.AppliedBootMS <= 0 || q.Deadline != next.RequestedAt+r.clockReset.TimerRemainingMS {
		return false
	}
	// The native application instant binds wall and boot clocks. Exact retry
	// retains this original bound, rather than granting the allowance again.
	expected := next.AppliedBootMS + q.Deadline - next.AppliedAt
	return q.DeadlineBootMS >= expected-1 && q.DeadlineBootMS <= expected+1
}
