package core

import (
	"encoding/json"
	"errors"
	"io"
	"net"
	"reflect"
	"time"
)

// A ready reply is provisional, not execution authority. Only the final locked
// transaction may consume the still-current capability and launch student code.
type paneLaunchAdmission struct {
	capability        Capability
	account           Account
	authority         Attempt
	supervisor        *paneBootstrapPeer
	supervisorUnit    string
	recordingOwner    string
	recordingPID      int
	recordingStart    uint64
	closedProof       *PaneInstance
	supervisorControl *net.UnixConn
}

func paneLaunchAuthority(a *Attempt) Attempt {
	v := *a
	// These observations can change without changing this pane's authority.
	// In particular a healthy independent renewal must not invalidate its ACK.
	v.Lease, v.Units, v.Errors, v.DeniedSSHTransports = 0, nil, nil, nil
	v.TimingNextCheck, v.TimingVerifiedAt = 0, 0
	v.TimingVerifiedDeadline, v.TimingVerifiedRevision = 0, 0
	return v
}

func paneRecorded(a *Attempt, pane string) bool {
	for _, unit := range a.Units {
		if id, _, _, ok := recordedPaneIdentity(a.ID, unit); ok && id == pane {
			return true
		}
	}
	return false
}

func (e *Engine) revokePaneAdmissions(id, pane string) {
	for hash, capability := range e.state.Caps {
		if capability.ID == id && capability.Pane == pane {
			delete(e.state.Caps, hash)
		}
	}
}

// Shared by signed student close and reviewed root close. The caller holds
// WithState; this changes only the target's admissions and recorded units.
func (e *Engine) closePaneLocked(a *Attempt, pane string) (any, error) {
	if !attemptID.MatchString(pane) {
		return nil, errors.New("invalid pane identity")
	}
	e.revokePaneAdmissions(a.ID, pane)
	closed := *a
	closed.Units = nil
	remaining := []string{}
	for _, unit := range a.Units {
		if id, _, _, ok := recordedPaneIdentity(a.ID, unit); ok && id == pane {
			closed.Units = append(closed.Units, unit)
		} else {
			remaining = append(remaining, unit)
		}
	}
	currentBoot := boot()
	for _, unit := range closed.Units {
		if paneInstanceClosed(e.state, a, unit, currentBoot) {
			proof := e.state.PaneInstances[unit]
			proof.Cancelled = true // Final release refuses even if cleanup fails.
			e.state.PaneInstances[unit] = proof
		} else if !paneInstanceReady(e.state, a, unit, currentBoot) {
			return nil, errors.New("pane startup/incarnation is unverified; admissions revoked and recorded scopes retained; inspect native state and matching versions, preserving work and tracking")
		}
	}
	if err := e.terminateWriters(&closed); err != nil {
		return nil, errors.New("recorded pane workload termination unconfirmed; admissions revoked and scopes retained")
	}
	a.Units = remaining
	for _, unit := range closed.Units {
		removePaneUnit(e.state.PaneInstances, a, unit)
	}
	return map[string]bool{"closed": true}, nil
}

// Called only inside WithState; no network IO or process launch occurs here.
func (e *Engine) paneAdmission(token, name, identity string, account Account) (Capability, *Attempt, error) {
	cap, ok := e.state.Caps[Hash([]byte(token))]
	if !ok || cap.Expires <= Millis() || cap.Username != name || !attemptID.MatchString(cap.ID) || !attemptID.MatchString(cap.Pane) {
		return cap, nil, errors.New("invalid, revoked or expired one-use admission; reopen this pane")
	}
	if cap.Transport != identity {
		return cap, nil, errors.New("capability transport mismatch")
	}
	a, err := e.Find(cap.ID)
	if err != nil {
		return cap, nil, err
	}
	if a.Transport != identity || a.Username != name || a.UID != account.UID || e.state.Registrations[identity] != name {
		return cap, nil, errors.New("attempt transport/account registration mismatch")
	}
	if err := workloadAllowed(a, cap.Purpose); err != nil {
		return cap, nil, err
	}
	if isFramedPanePurpose(cap.Purpose) != (cap.InputEpoch != "") || (cap.InputEpoch != "" && (!monitoringDigest.MatchString(cap.InputEpoch) || !currentRegisteredOwner(a) || !a.TerminalSupervised || !a.BrowserSSH)) || (a.MonitoringMode == "v1") != (cap.Purpose == monitoredPanePurpose) {
		return cap, nil, errors.New("framed pane binding is unavailable or changed; preserve the attempt and request a fresh explicit framed admission; no raw fallback")
	}
	if (a.RegisteredOwner == nil && cap.RegisteredOwner != (monitoringOwner{})) || (a.RegisteredOwner != nil && (!currentRegisteredOwner(a) || cap.RegisteredOwner != *a.RegisteredOwner)) {
		return cap, nil, errRegisteredOwner
	}
	if paneRecorded(a, cap.Pane) {
		return cap, nil, errors.New("pane already admitted; close it before opening a replacement")
	}
	if len(a.Units) >= a.Settings.Terminals {
		return cap, nil, errors.New("terminal limit; close an existing pane before opening another")
	}
	return cap, a, nil
}

func (p *paneLaunchAdmission) unchanged(cap Capability, a *Attempt, account Account) bool {
	return p.capability == cap && p.account == account && reflect.DeepEqual(p.authority, paneLaunchAuthority(a))
}

// identify must observe the actual SSH peer again, not reuse the preview's
// numeric ancestor observation. start reports whether it ever started a child;
// a started but unsuccessfully cleaned child must remain tracked.
func (e *Engine) launchAcknowledgedPane(p *paneLaunchAdmission, token, name, unit string, identify func(Account) (string, error), start func(*Attempt, Capability) (bool, error)) error {
	return e.WithState(func() error {
		cap, a, err := e.acknowledgedPaneLocked(p, token, name, unit, identify)
		if err != nil {
			return err
		}
		delete(e.state.Caps, Hash([]byte(token)))
		a.Units = append(a.Units, unit)
		started := false
		defer func() {
			if !started {
				// No child ever started; do not strand a terminal slot on a
				// failed save/expired commit/failed exec. Keep consumed tokens.
				a.Units = a.Units[:len(a.Units)-1]
			}
		}()
		if err := e.save(); err != nil {
			return err
		}
		if err := e.applyExecutionLease(a); err != nil {
			return err
		}
		if cap.Expires <= Millis() {
			return errors.New("pane admission expired during commit; reopen this pane")
		}
		if err := workloadAllowed(a, cap.Purpose); err != nil {
			return err
		}
		started, err = start(a, cap)
		if err == nil && !started {
			return errors.New("pane workload did not start; reopen this pane")
		}
		return err
	})
}

func (e *Engine) acknowledgedPaneLocked(p *paneLaunchAdmission, token, name, unit string, identify func(Account) (string, error)) (Capability, *Attempt, error) {
	account, ok := e.account(name)
	if !ok || account != p.account {
		return Capability{}, nil, errors.New("pane account changed during acknowledgement; reopen this pane")
	}
	identity, err := identify(account)
	if err != nil {
		return Capability{}, nil, err
	}
	cap, a, err := e.paneAdmission(token, name, identity, account)
	if err != nil {
		return cap, a, err
	}
	if !p.unchanged(cap, a, account) {
		return cap, a, errors.New("pane authority changed during acknowledgement; refresh and reopen this pane")
	}
	unitPane, _, instance, validUnit := recordedPaneIdentity(a.ID, unit)
	if !validUnit || unitPane != cap.Pane || instance == "" || !e.recordedUnitAllowed(a, unit) {
		return cap, a, errors.New("invalid pane workload unit")
	}
	return cap, a, nil
}

func paneInstanceClosed(state State, a *Attempt, unit, currentBoot string) bool {
	pane, kind, instance, ok := recordedPaneIdentity(a.ID, unit)
	proof, found := state.PaneInstances[unit]
	return ok && kind == "scope" && instance != "" && currentBoot != "" && found && proof.Attempt == a.ID && proof.Pane == pane && proof.ID == instance && proof.Boot == currentBoot && proof.ReadyAt == 0 && proof.ClosedUntil > 0 && proof.ClosedBootUntil > 0
}

// Reserve only a CLOSED bootstrap, never a shell. The global transaction ends
// before systemd startup. The live parent and a fresh final transaction are both
// mandatory for exec; a persisted pending observation is never sufficient.
func (e *Engine) reserveClosedPane(p *paneLaunchAdmission, token, name, unit string, identify func(Account) (string, error)) (PaneInstance, error) {
	var proof PaneInstance
	err := e.WithState(func() error {
		cap, a, err := e.acknowledgedPaneLocked(p, token, name, unit, identify)
		if err != nil {
			return err
		}
		now, err := monitoringBootMillis()
		remaining := cap.Expires - Millis()
		if err != nil || now <= 0 || remaining <= 0 || remaining > 15000 {
			return errPaneBootstrap
		}
		_, kind, instance, _ := recordedPaneIdentity(a.ID, unit)
		if kind != "scope" {
			return errPaneBootstrap
		}
		proof = PaneInstance{Attempt: a.ID, Pane: cap.Pane, ID: instance, Boot: boot(), ClosedUntil: cap.Expires, ClosedBootUntil: now + remaining, InputEpoch: cap.InputEpoch}
		if a.TerminalSupervised && isTimedPanePurpose(cap.Purpose) {
			pending := 0
			for _, prior := range e.state.PaneInstances {
				if prior.Attempt == a.ID && prior.Recording != "" {
					if prior.Pane == cap.Pane {
						return errTerminalRecordingReport
					}
					pending++
				}
			}
			if pending >= terminalRecordingReportEntries {
				return errTerminalRecordingReport
			}
			proof.RecordingIdentity = recordingContext(*a, cap.Pane, unit)
			if !proof.RecordingIdentity.valid() {
				return errTerminalSupervisor
			}
			proof.Recording = proof.RecordingIdentity.hash()
		}
		if proof.Boot == "" {
			return errPaneBootstrap
		}
		delete(e.state.Caps, Hash([]byte(token)))
		a.Units = append(a.Units, unit)
		if e.state.PaneInstances == nil {
			e.state.PaneInstances = map[string]PaneInstance{}
		}
		e.state.PaneInstances[unit] = proof
		return nil
	})
	return proof, err
}

func (e *Engine) releaseClosedPane(p *paneLaunchAdmission, name, unit string, proof PaneInstance, identify func(Account) (string, error), current func() bool, permit func() error) error {
	return e.WithState(func() error {
		account, ok := e.account(name)
		if !ok || account != p.account {
			return errPaneBootstrap
		}
		identity, err := identify(account)
		if err != nil || identity != p.capability.Transport || e.state.Registrations[identity] != name {
			return errPaneBootstrap
		}
		a, err := e.Find(p.capability.ID)
		if err != nil || !p.unchanged(p.capability, a, account) || !paneRecorded(a, p.capability.Pane) || e.state.PaneInstances[unit] != proof || proof.Cancelled || !paneInstanceClosed(e.state, a, unit, boot()) {
			return errPaneBootstrap
		}
		allowed := func() bool {
			now, err := monitoringBootMillis()
			return err == nil && now < proof.ClosedBootUntil && Millis() < proof.ClosedUntil && workloadAllowed(a, p.capability.Purpose) == nil && len(a.Units) <= a.Settings.Terminals && current() && (p.supervisor == nil || p.supervisor.current())
		}
		if !allowed() {
			return errPaneBootstrap
		}
		ready := proof
		ready.ReadyAt, ready.ClosedUntil, ready.ClosedBootUntil = Millis(), 0, 0
		ready.Supervisor = p.supervisorUnit
		ready.RecordingOwner = p.recordingOwner
		ready.RecordingPID, ready.RecordingStart = p.recordingPID, p.recordingStart
		if proof.Recording != "" && (!nativeCapabilityHash.MatchString(ready.RecordingOwner) || p.supervisor == nil) {
			return errTerminalSupervisor
		}
		e.state.PaneInstances[unit] = ready
		// Do not release anything if durable tracking/activation fails. An
		// uncertain save remains inspectable, never reconstructible permission.
		if err := e.save(); err != nil {
			return err
		}
		if e.paneReleaseCheckpoint != nil {
			if err := e.paneReleaseCheckpoint(unit); err != nil {
				return err
			}
		}
		if !allowed() {
			return errPaneBootstrap
		}
		if err := permit(); err != nil {
			return errPaneBootstrap
		}
		e.Audit("pane-admitted", a.ID)
		return nil
	})
}

// No child ever started in this case. Do not strand a slot on failed exec; do
// not use this to erase an uncertain started bootstrap or a ready workload.
func (e *Engine) discardUnstartedPane(unit string, proof PaneInstance) error {
	return e.WithState(func() error {
		a := e.state.Attempts[proof.Attempt]
		if a != nil && e.state.PaneInstances[unit] == proof && proof.ReadyAt == 0 {
			removePaneUnit(e.state.PaneInstances, a, unit)
		}
		return nil
	})
}

func removePaneUnit(instances map[string]PaneInstance, a *Attempt, unit string) {
	units := a.Units[:0]
	for _, v := range a.Units {
		if v != unit {
			units = append(units, v)
		}
	}
	a.Units = units
	if proof := instances[unit]; proof.Recording == "" || (proof.ReadyAt == 0 && proof.RecordingOwner == "") {
		delete(instances, unit)
		// CLOSED/unbound setup never transferred descriptors: its verified
		// owner must be saved BEFORE handoff, and readiness BEFORE exec. This
		// caller already confirmed scope cleanup/no child start. No recording,
		// report, attempt, clock or protected data is deleted or called complete.
	} else if proof.ReadyAt == 0 {
		proof.Cancelled = true
		instances[unit] = proof
	} // An unacknowledged recording report survives targeted closure/restart.
}

// Called by Tick under state. A crashed parent cannot authorize from disk; its
// original bounded startup is revoked/reaped rather than reserving a pane slot
// forever. Failed kernel cleanup stays visible/tracked, never fake success.
func (e *Engine) reapClosedPaneStarts() {
	now, clockErr := monitoringBootMillis()
	currentBoot := boot()
	for unit, proof := range e.state.PaneInstances {
		if proof.ReadyAt != 0 || proof.ClosedUntil <= 0 || proof.ClosedBootUntil <= 0 {
			continue
		}
		a := e.state.Attempts[proof.Attempt]
		pane, kind, instance, valid := recordedPaneIdentity(proof.Attempt, unit)
		if a == nil || !valid || kind != "scope" || pane != proof.Pane || instance != proof.ID || !e.recordedUnitAllowed(a, unit) {
			continue // Preserve corrupt/foreign records; not authority or safe cleanup.
		}
		if !proof.Cancelled && proof.Boot == currentBoot && Millis() < proof.ClosedUntil && (clockErr != nil || now < proof.ClosedBootUntil) {
			continue
		}
		proof.Cancelled = true
		e.state.PaneInstances[unit] = proof
		closed := *a
		closed.Units = []string{unit}
		if err := e.terminateWriters(&closed); err != nil {
			a.Errors = appendError(a.Errors, "Closed terminal startup cleanup unconfirmed; inspect examctl panes list and preserve tracking/work")
			continue
		}
		removePaneUnit(e.state.PaneInstances, a, unit)
	}
}

func awaitPaneAcknowledgement(c net.Conn, result map[string]any, expires int64) error {
	if expires <= Millis() {
		return errors.New("pane admission expired before acknowledgement; reopen this pane")
	}
	// The capability's original expiry is never restarted by a reply or retry.
	if err := c.SetDeadline(time.UnixMilli(expires)); err != nil {
		return errors.New("pane acknowledgement deadline unavailable; reopen this pane")
	}
	if err := json.NewEncoder(c).Encode(result); err != nil {
		return errors.New("pane ready reply unavailable; reopen this pane")
	}
	var ack [1]byte
	if _, err := io.ReadFull(c, ack[:]); err != nil {
		return errors.New("pane acknowledgement unavailable or expired; reopen this pane")
	}
	if ack[0] != 1 {
		return errors.New("invalid pane acknowledgement; reopen this pane")
	}
	return nil
}
