package core

import "encoding/json"

// The recorder owner receives only this immutable pane identity. It carries no
// Engine, global configuration, SSH credential, signing key or execution permit.
// The canonical coordinator/watchdog makes the current-state fault decision.
type terminalRecordingContext struct {
	Attempt       string `json:"attempt"`
	Pane          string `json:"pane"`
	Unit          string `json:"unit"`
	Username      string `json:"username"`
	UID           int    `json:"uid"`
	Generation    int    `json:"generation"`
	Start         int64  `json:"start"`
	Boot          string `json:"boot"`
	TransportHash string `json:"transport_hash"`
}

func recordingContext(a Attempt, pane, unit string) terminalRecordingContext {
	return terminalRecordingContext{Attempt: a.ID, Pane: pane, Unit: unit,
		Username: a.Username, UID: a.UID, Generation: a.Generation, Start: a.Start,
		Boot: a.Boot, TransportHash: Hash([]byte(a.Transport))}
}

func (c terminalRecordingContext) hash() string {
	data, _ := json.Marshal(c)
	return Hash(data)
}

func (c terminalRecordingContext) authorityHash() string {
	c.Pane, c.Unit = "", ""
	return c.hash()
}

func (c terminalRecordingContext) valid() bool {
	pane, kind, instance, ok := recordedPaneIdentity(c.Attempt, c.Unit)
	return ok && kind == "scope" && instance != "" && pane == c.Pane &&
		attemptID.MatchString(c.Attempt) && attemptID.MatchString(c.Pane) &&
		c.Username != "" && len(c.Username) <= 64 && c.UID >= 0 && c.Generation >= 0 &&
		c.Start > 0 && c.Boot != "" && len(c.Boot) <= 128 && len(c.TransportHash) == 64
}

// Called only under WithState. Runtime callers: the current timed gate's
// recorder, and C12b's bounded scoped-report consumer in this same milestone.
// A clock extension or explicit same-pane retained Continue does not retire the
// current recorder. Unassociated generations/owners/native incarnations do.
// No missing record or fault association means execution permission.
func (e *Engine) recordingFaultLocked(context terminalRecordingContext) error {
	a := e.state.Attempts[context.Attempt]
	tracked := false
	generation := context.Generation
	if a != nil {
		for _, unit := range a.Units {
			tracked = tracked || unit == context.Unit
		}
		proof := e.state.PaneInstances[context.Unit]
		if a.MonitoringMode == "v1" && a.TerminalSupervised && a.BrowserSSH && currentRegisteredOwner(a) &&
			proof.RecordingIdentity == context && proof.Recording == context.hash() && proof.RecordingContinuedGeneration > context.Generation {
			generation = proof.RecordingContinuedGeneration
		}
	}
	if !tracked || a.State != "ACTIVE" || expired(a) ||
		a.Generation != generation || Hash([]byte(a.Transport)) != context.TransportHash ||
		a.Username != context.Username || a.UID != context.UID || a.Start != context.Start ||
		a.Boot != context.Boot || e.state.Registrations[a.Transport] != a.Username ||
		(!paneInstanceReady(e.state, a, context.Unit, boot()) && !paneInstanceClosed(e.state, a, context.Unit, boot())) {
		e.Audit("retired-terminal-recording-fault", context.Attempt, context.Pane, context.Unit)
		return nil
	}
	_, err := e.callLocked("lock-attempt", Request{ID: context.Attempt, Reason: "Class-server terminal recording failure"})
	return err
}
