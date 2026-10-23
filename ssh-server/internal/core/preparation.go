package core

import (
	"errors"
	"fmt"
)

// The actual native/root and signed-SSH preparation entry points share this
// workflow. The per-UID fence excludes overlapping home/staging/Begin operations;
// readiness and configuration copying never own the shared state transaction.
// Nothing here starts a clock, grants a lease or admits a workload.
func (e *Engine) prepareAttempt(r Request, expires int64) (result any, err error) {
	if r.Grant != nil && (!validGrant(r.Grant) || r.ExpectedRecovery != "" || r.Settings.TemplateVersion == "" || r.Exam == SandboxExamID) {
		return nil, errors.New("invalid initial grant scope/source; preserve original settings and use grant-aware preflight")
	}
	lock, err := e.accountWorkLock(r.UID)
	if err != nil {
		return nil, err
	}
	defer lock.Close()
	var candidate *Attempt
	var account Account
	existing := false
	defer func() {
		if err == nil || candidate == nil || existing {
			return
		}
		// Preserve the durable cancellation/history if another request already
		// changed it. Failed checks must not leave an apparently ready preflight.
		retireErr := e.WithState(func() error {
			a := e.state.Attempts[r.ID]
			if !workspaceFence(a, candidate) || !a.PreparationPending {
				return nil
			}
			a.State, a.Reason, a.Ended = "CANCELLED_BEFORE_START", "Technical preflight checks did not complete; no exam clock started. Sign out and retry after repair.", Millis()
			a.PreparationPending, a.PreparationPendingSince = false, 0
			e.Audit("preparation-checks-failed", a.ID)
			return nil
		})
		if retireErr != nil {
			err = errors.Join(err, fmt.Errorf("preflight retirement unavailable; preserve state and inspect examctl info %s --read-only: %w", r.ID, retireErr))
		}
	}()
	err = e.WithState(func() error {
		if expires != 0 && expires <= Millis() {
			return errors.New("command expired; retry student preflight; no clock has started")
		}
		if !attemptID.MatchString(r.ID) {
			return errors.New("invalid attempt identifier")
		}
		if a := e.state.Attempts[r.ID]; a != nil {
			if a.Username != r.Username || a.UID != r.UID || e.state.Registrations[r.Transport] != r.Username {
				return errors.New("preparation ownership mismatch")
			}
			if a.State == "PREPARING" && a.ExpectedRecovery != r.ExpectedRecovery {
				return errors.New("saved-work grant binding differs from this preparation; preserve it and cancel only if confirmed unstarted before a fresh preflight")
			}
			if a.State == "PREPARING" && !sameGrant(a.Grant, r.Grant) {
				return errors.New("grant binding differs from the original preparation; positively cancel if unstarted before claiming again")
			}
			if a.PreparationPending && a.PreparationPendingSince == 0 {
				a.PreparationPendingSince = Millis()
			}
			e.expirePreflight(a, Millis())
			if a.State == "PREPARING" {
				a.PolicyRequired = e.temporaryPolicy(a)
				if a.Transport != r.Transport {
					// Existing replacement/termination policy is unchanged. Moving
					// OS launches/termination requires its own closed-admission gate.
					if err := e.terminateWriters(a); err != nil {
						return err
					}
					a.Units = nil
				}
				a.Transport, a.BrowserSSH = r.Transport, r.BrowserSSH
			}
			snapshot := *a
			candidate, existing = &snapshot, !a.PreparationPending || a.State != "PREPARING"
			if !existing {
				if a.Exam != r.Exam || a.Settings != r.Settings {
					return errors.New("pending preparation settings differ; preserve the original preparation and retry with its saved settings")
				}
				var ok bool
				account, ok = e.account(a.Username)
				if !ok || account.UID != a.UID {
					return errors.New("pending preparation account unavailable; preserve state and inspect the account")
				}
			}
			return nil
		}
		var err error
		account, err = e.newPreparationAccount(r)
		if err != nil {
			return err
		}
		candidate = &Attempt{ExpectedRecovery: r.ExpectedRecovery, PreparationPending: true, PreparationPendingSince: Millis(), BrowserSSH: r.BrowserSSH, ID: r.ID, Exam: r.Exam, Username: r.Username, UID: r.UID, Settings: r.Settings, State: "PREPARING", Transport: r.Transport, WorkPath: e.directory(), Units: []string{}, Errors: []string{}}
		if r.Grant != nil {
			grant := *r.Grant
			candidate.Grant = &grant
			for _, prior := range e.state.Attempts {
				if prior.Grant != nil && prior.Grant.ID == grant.ID && prior.Start > 0 {
					return errors.New("grant already consumed by an original native interval; inspect its attempt, no refund/reopening authorized")
				}
				if prior.Grant != nil && prior.Grant.ID == grant.ID && (prior.UID != r.UID || prior.Username != r.Username || prior.Exam != r.Exam) {
					return errors.New("grant identity changed after preparation, including cancelled claims; preserve original grant/UID history for explicit review")
				}
				if prior.Exam == r.Exam && (prior.UID == r.UID || prior.Username == r.Username) && prior.Start > 0 {
					return fmt.Errorf("initial grant conflicts with native attempt history %s; preserve the completed/original interval and obtain explicit additional-attempt authorization; no new preparation or clock", prior.ID)
				}
			}
		}
		candidate.PolicyRequired = e.temporaryPolicy(candidate)
		if sandboxAttempt(candidate) {
			if err := sandboxBeginWindow(candidate.Settings, Millis()); err != nil {
				candidate = nil
				return err
			}
			candidate.Settings.Duration = SandboxDurationSeconds
			candidate.Settings.Webcam = false
		}
		candidate.AdministratorSandbox = account.SandboxOnly && sandboxAttempt(candidate)
		candidate.FunctionalTest = e.functionalAccount(candidate)
		if _, err = e.recoveryReference(candidate); err != nil {
			return err
		}
		snapshot := *candidate
		e.state.Attempts[r.ID] = &snapshot
		e.Audit("preparation-checks-pending", r.ID)
		return nil
	})
	if err != nil || existing {
		return candidate, err
	}
	ready, missing := e.preparationReady()
	if !ready {
		return nil, fmt.Errorf("server guards unavailable: %v; no clock has started; retry preflight after repair, or inspect examctl health and examctl help collection", missing)
	}
	// Preserve the existing timer boundary: readiness precedes preflight timing,
	// while home snapshot work consumes the original preparation window.
	if err = e.WithState(func() error {
		a := e.state.Attempts[r.ID]
		if a != nil {
			e.expirePreflight(a, Millis())
		}
		if !workspaceFence(a, candidate) || !a.PreparationPending {
			return errors.New("preparation cancelled or changed during readiness checks; no clock has started")
		}
		if expires != 0 && expires <= Millis() {
			return errors.New("command expired during readiness verification; retry student preflight; no clock has started")
		}
		if a.PreflightStartedAt == 0 {
			a.PreflightStartedAt = Millis()
		}
		snapshot := *a
		candidate = &snapshot
		return nil
	}); err != nil {
		return nil, err
	}
	if err := e.preparationHome(candidate); err != nil {
		return nil, fmt.Errorf("home configuration snapshot unavailable; no clock has started; preserve private preparation data and retry preflight after repair: %w", err)
	}
	err = e.WithState(func() error {
		if expires != 0 && expires <= Millis() {
			return errors.New("command expired during home preparation; retry student preflight; no clock has started")
		}
		if preflightExpired(candidate, Millis()) {
			return errors.New("preflight window elapsed during home preparation; sign out and retry preflight; no clock has started")
		}
		a := e.state.Attempts[r.ID]
		if !workspaceFence(a, candidate) || !a.PreparationPending {
			return errors.New("preparation cancelled or changed during home checks; preserve state and inspect examctl info ATTEMPT --read-only")
		}
		current, err := e.newPreparationAccount(r)
		if err != nil {
			return err
		}
		if current != account || candidate.PolicyRequired != e.temporaryPolicy(candidate) {
			return errors.New("account changed during preflight checks; retry after administrator inspection; no clock has started")
		}
		if sandboxAttempt(candidate) {
			if err := sandboxBeginWindow(candidate.Settings, Millis()); err != nil {
				return err
			}
		}
		// Revalidate bounded grant/source metadata against current state. Home
		// copying confers no saved-source authority and consumes no allowance.
		if _, err := e.recoveryReference(candidate); err != nil {
			return err
		}
		a.PreparationPending, a.PreparationPendingSince = false, 0
		snapshot := *a
		candidate = &snapshot
		if candidate.AdministratorSandbox {
			e.Audit("administrator-sandbox-preparation", candidate.ID)
		}
		if candidate.FunctionalTest {
			e.Audit("trusted-functional-test-preparation", candidate.ID)
		}
		e.Audit("prepare-attempt", candidate.ID)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return candidate, nil
}

// Both calls run under WithState, before IO and immediately before publication.
func (e *Engine) newPreparationAccount(r Request) (Account, error) {
	account, ok := e.account(r.Username)
	if !ok || account.UID != r.UID || r.Transport == "" || e.state.Registrations[r.Transport] != r.Username {
		return account, errors.New("identity/transport not approved; reconnect through the supported student preflight")
	}
	if account.SandboxOnly && r.Exam != SandboxExamID {
		return account, errors.New("administrator account is approved only for sandbox")
	}
	for _, other := range e.state.Attempts {
		if other.UID == account.UID && other.ID != r.ID && accessHeld(other) {
			return account, errors.New("account already reserved; inspect existing attempts before retrying preflight")
		}
	}
	if !identifier.MatchString(r.Exam) || !validTemplateBinding(r.Settings) || r.Settings.Duration < 60 || r.Settings.Duration > 21600 || r.Settings.Terminals < 1 || r.Settings.Terminals > 4 {
		return account, errors.New("invalid exam settings")
	}
	if _, err := limitsForSettings(r.Settings); err != nil {
		return account, err
	}
	return account, nil
}
