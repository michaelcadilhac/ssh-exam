package core

const PreflightTimeoutMillis int64 = 15 * 60 * 1000
const PreflightExpiredReason = "Preflight expired after 15 minutes. Sign out and sign in again; your exam has not started."

func preflightExpired(a *Attempt, at int64) bool {
	return a.State == "PREPARING" && a.Start == 0 && a.Deadline == 0 && a.OriginalDeadline == 0 && a.PreflightStartedAt > 0 && at >= a.PreflightStartedAt+PreflightTimeoutMillis
}

// Called under the persistent state lock, including admission/activation paths.
// Tick then terminates every tracked practice scope and removes disposable data.
func (e *Engine) expirePreflight(a *Attempt, at int64) bool {
	if !preflightExpired(a, at) {
		return false
	}
	a.State = "CANCELLED_BEFORE_START"
	a.Reason = PreflightExpiredReason
	a.Ended = at
	a.Handoff = nil
	for hash, cap := range e.state.Caps {
		if cap.ID == a.ID {
			delete(e.state.Caps, hash)
		}
	}
	e.Audit("preflight-expired", a.ID)
	return true
}
