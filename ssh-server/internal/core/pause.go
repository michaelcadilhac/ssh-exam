package core

import "errors"

// Saved files survive pause; old shells/editor buffers do not. Always revoke
// the old transport's resume entitlement before cleanup, including watchdog locks.
func (e *Engine) disconnectPausedWorkload(a *Attempt) error {
	a.ResumeTransport = ""
	a.Lease = 0
	if a.MonitoringMode == "v1" {
		a.RetainedHold = "pending"
		for hash, capability := range e.state.Caps {
			if capability.ID == a.ID {
				delete(e.state.Caps, hash)
			}
		}
		for unit, proof := range e.state.PaneInstances {
			if proof.Attempt == a.ID && proof.ReadyAt == 0 {
				proof.Cancelled = true
				e.state.PaneInstances[unit] = proof
			}
		}
		return nil // Actual stop/freeze/drain runs after this durable transaction.
	}
	freezeErr := e.freeze(a, true)
	terminateErr := e.terminate(a)
	if terminateErr == nil {
		a.Units = []string{}
	}
	return errors.Join(freezeErr, terminateErr)
}

// Public native Call/Admin/signed-command callers join the same actual hold
// after committing LOCKED/closed admission. Never wait for root IPC or kernel
// barriers while owning shared state. A stored "held" value grants no permission.
func (e *Engine) finishRetainedPause(id string) (any, error) {
	var snapshot Attempt
	if err := e.WithState(func() error {
		a, err := e.Find(id)
		if err != nil {
			return err
		}
		snapshot = *a
		if a.RegisteredOwner != nil {
			owner := *a.RegisteredOwner
			snapshot.RegisteredOwner = &owner
		}
		return nil
	}); err != nil {
		return nil, err
	}
	if snapshot.MonitoringMode != "v1" || snapshot.State != "LOCKED" {
		return &snapshot, nil
	}
	if snapshot.RegisteredOwner == nil {
		return &snapshot, errTerminalHold
	}
	op := "hold"
	if snapshot.MonitoringHoldKind == "technical" {
		op = "expire"
	}
	result, holdErr := e.callTerminalAuthority(terminalAuthorityRequest{Op: op, Attempt: id, Owner: *snapshot.RegisteredOwner, Cause: "operator-pause"}, nil, false)
	verified := holdErr == nil && result.Hold != nil && result.Hold.Phase == "held"
	var out *Attempt
	err := e.WithState(func() error {
		a, err := e.Find(id)
		if err != nil {
			return err
		}
		out = a
		if a.State != "LOCKED" || a.Generation != snapshot.Generation || a.RegisteredOwner == nil || *a.RegisteredOwner != *snapshot.RegisteredOwner {
			return errMonitoringScope
		}
		a.RetainedHold = "unverified"
		if verified {
			a.RetainedHold = "held"
			a.ResumeTransport = a.Transport
			if result.HeldOwner != nil && *result.HeldOwner != *a.RegisteredOwner {
				old, held := *a.RegisteredOwner, *result.HeldOwner
				old.Generation, held.Generation, old.InputEpoch, held.InputEpoch = 0, 0, "", ""
				if old != held || result.HeldOwner.Generation > a.Generation {
					return errMonitoringScope
				}
				owner := *result.HeldOwner
				a.RegisteredOwner, a.MonitoringResumeNonce = &owner, ""
				e.Audit("cancelled-unexecuted-retained-continuation", a.ID)
			}
		} else {
			a.Errors = appendError(a.Errors, errTerminalHold.Error())
		}
		return nil
	})
	if err != nil {
		return out, err
	}
	if !verified {
		return out, errors.Join(errTerminalHold, holdErr)
	}
	return out, nil
}
