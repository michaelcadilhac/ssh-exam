package core

import "errors"

// Saved files survive pause; old shells/editor buffers do not. Always revoke
// the old transport's resume entitlement before cleanup, including watchdog locks.
func (e *Engine) disconnectPausedWorkload(a *Attempt) error {
	a.ResumeTransport = ""
	a.Lease = 0
	freezeErr := e.freeze(a, true)
	terminateErr := e.terminate(a)
	if terminateErr == nil {
		a.Units = []string{}
	}
	return errors.Join(freezeErr, terminateErr)
}
