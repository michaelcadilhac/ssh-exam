package core

import (
	"errors"
	"os"
	"path/filepath"
)

const PreflightTimeoutMillis int64 = 15 * 60 * 1000
const PreflightExpiredReason = "Preflight expired after 15 minutes. Sign out and sign in again; your exam has not started."

// Called under WithState only after authenticated cancellation authorization.
// Absence alone is not a reusable receipt: persist a tombstone so an in-flight
// or later retried prepare for this UUID cannot publish readiness after cleanup.
// No attempt/policy/workspace ever existed, so do not run UID-wide termination.
func (e *Engine) cancelAbsentPreparation(r Request) (*Attempt, error) {
	account, ok := e.account(r.Username)
	if !attemptID.MatchString(r.ID) || !identifier.MatchString(r.Exam) || !identifier.MatchString(r.Username) || !ok || account.UID != r.UID {
		return nil, errors.New("absent preparation cancellation requires exact exam/account identity; use authenticated logout or examctl help cancel-absent, never infer cancellation from not-found")
	}
	if e.state.Attempts[r.ID] != nil {
		return nil, errors.New("preparation exists; use its normal cancellation checks")
	}
	// Canonical absence must not contradict surviving start/publication evidence
	// (for example after an incomplete restore). Preserve it for explicit review,
	// not a false no-start receipt. These are exact private targets, not cleanup.
	for _, p := range []string{filepath.Join(e.Config.Work, r.ID), filepath.Join(e.Config.State, "submissions", r.ID)} {
		if _, err := os.Lstat(p); !os.IsNotExist(err) {
			return nil, errors.New("native row absent but workspace/submission evidence exists or is unavailable; preserve history and inspect examctl info ATTEMPT --read-only; no cancellation proof issued")
		}
	}
	if _, err := e.readRecoveryConsumption(&Attempt{Exam: r.Exam, Username: r.Username}); !os.IsNotExist(err) {
		return nil, errors.New("saved-work consumption evidence exists or is unavailable; preserve grants/markers/history and inspect examctl recovery-grants --exam EXAM; no cancellation proof issued")
	}
	a := &Attempt{ID: r.ID, Exam: r.Exam, Username: r.Username, UID: r.UID, Settings: r.Settings, Transport: r.Transport, State: "CANCELLED_BEFORE_START", Ended: Millis(), Reason: r.Reason}
	a.PolicyRequired = e.temporaryPolicy(a)
	e.acknowledgeUnappliedCancellation(a)
	e.state.Attempts[r.ID] = a
	e.Audit("cancel-absent-preparation", a.ID)
	return a, nil
}

func preflightExpired(a *Attempt, at int64) bool {
	since := a.PreflightStartedAt
	if since == 0 && a.PreparationPending {
		since = a.PreparationPendingSince
	}
	return a.State == "PREPARING" && a.Start == 0 && a.Deadline == 0 && a.OriginalDeadline == 0 && since > 0 && at >= since+PreflightTimeoutMillis
}

// Called under the persistent state lock, including admission/activation paths.
// Tick then terminates every tracked practice scope and removes disposable data.
func (e *Engine) expirePreflight(a *Attempt, at int64) bool {
	if !preflightExpired(a, at) {
		return false
	}
	a.State = "CANCELLED_BEFORE_START"
	a.PreparationPending, a.PreparationPendingSince = false, 0
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
