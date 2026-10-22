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
	capability Capability
	account    Account
	authority  Attempt
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
		if !paneInstanceReady(e.state, a, unit, currentBoot) {
			return nil, errors.New("pane startup/incarnation is unverified; admissions revoked and recorded scopes retained; inspect native state and matching versions, preserving work and tracking")
		}
	}
	if err := e.terminateWriters(&closed); err != nil {
		return nil, errors.New("recorded pane workload termination unconfirmed; admissions revoked and scopes retained")
	}
	a.Units = remaining
	for _, unit := range closed.Units {
		delete(e.state.PaneInstances, unit)
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
		account, ok := e.account(name)
		if !ok || account != p.account {
			return errors.New("pane account changed during acknowledgement; reopen this pane")
		}
		identity, err := identify(account)
		if err != nil {
			return err
		}
		cap, a, err := e.paneAdmission(token, name, identity, account)
		if err != nil {
			return err
		}
		if !p.unchanged(cap, a, account) {
			return errors.New("pane authority changed during acknowledgement; refresh and reopen this pane")
		}
		unitPane, _, instance, validUnit := recordedPaneIdentity(a.ID, unit)
		if !validUnit || unitPane != cap.Pane || instance == "" || !e.recordedUnitAllowed(a, unit) {
			return errors.New("invalid pane workload unit")
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
