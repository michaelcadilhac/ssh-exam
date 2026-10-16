package core

import (
	"encoding/json"
	"errors"
	"log"
	"os"
	"path/filepath"
	"strings"
)

// Access authorization is independent of submission state. Unknown states fail closed.
func accessHeld(a *Attempt) bool {
	if a.State == "CANCELLED_BEFORE_START" && a.Start == 0 {
		return false
	}
	if a.Start == 0 {
		return a.State != "COMPLETED"
	}
	if a.State != "COMPLETED" {
		return true
	}
	return a.AccessState != "RELEASED" && a.AccessState != "OVERRIDDEN"
}

// Never release just because a wall clock jumps forward on the original boot.
func restrictionElapsed(a *Attempt) bool {
	deadline := max(a.Deadline, a.OriginalDeadline)
	monotonic := max(a.UptimeDeadline, a.OriginalUptimeDeadline)
	return deadline > 0 && Millis() >= deadline && (a.Boot != boot() || monotonic <= 0 || uptime() >= monotonic)
}
func (e *Engine) verifyRelease(a *Attempt) error {
	if a.State != "COMPLETED" || !a.Protected {
		return errors.New("submission and workload termination must be secured before access release")
	}
	if _, err := ReadProtected(filepath.Join(e.Config.State, "submissions", a.ID), a); err != nil {
		return err
	}
	return e.terminate(a)
}
func (e *Engine) reconcileAccess(a *Attempt) {
	if a.Start == 0 || !accessHeld(a) || (!sandboxAttempt(a) && !restrictionElapsed(a)) {
		return
	}
	if a.State != "COMPLETED" {
		return
	}
	if err := e.verifyRelease(a); err != nil {
		if a.AccessError != err.Error() {
			a.AccessError = err.Error()
			e.Audit("access-release-blocked", a.ID)
			log.Printf("account access release blocked for attempt %s: %v", a.ID, err)
		}
		return
	} // Collection/recovery failure keeps the hold.
	a.AccessState = "RELEASED"
	a.AccessError = ""
	a.AccessReleasedAt = Millis()
	e.Audit("ordinary-access-released", a.ID)
}
func (e *Engine) ordinaryAccess(uid int) error {
	if e.Busy(uid) != nil {
		return errors.New("exam account access restricted; finishing does not release ordinary access before the original deadline and secured collection")
	}
	return nil
}
func workloadAllowed(a *Attempt, purpose string) error {
	if purpose == "practice" && a.State == "PREPARING" && a.Start == 0 {
		return nil
	}
	if purpose == "exam" && a.State == "ACTIVE" && !expired(a) && a.Lease > Millis() && a.AccessState == "HELD" {
		return nil
	}
	return errors.New("workload not admitted; ended, locked or stale channel")
}
func (e *Engine) registrationAllowed(uid int) error {
	if a := e.Busy(uid); a != nil && a.State != "PREPARING" && !(a.State == "LOCKED" && !expired(a) && a.Authorization > Millis()) {
		return errors.New("account restricted; only an unfinished, instructor-authorized attempt can reconnect")
	}
	return nil
}

// This operation is deliberately absent from the HTTPS API and student socket protocol.
// The root-only CLI records the administrator's reason durably before releasing access.
func (e *Engine) OverrideAccess(id, reason string) (any, error) {
	if os.Geteuid() != 0 {
		return nil, errors.New("root-only emergency access override")
	}
	return e.overrideSecuredAccess(id, reason)
}

func (e *Engine) overrideSecuredAccess(id, reason string) (any, error) {
	reason = strings.TrimSpace(reason)
	if len(reason) < 8 || len(reason) > 1000 {
		return nil, errors.New("a concrete emergency reason (8–1000 characters) is required")
	}
	var result *Attempt
	err := e.WithState(func() error {
		a, err := e.Find(id)
		if err != nil {
			return err
		}
		if a.Start == 0 {
			return errors.New("only started attempts have an interval hold")
		}
		if err = e.verifyRelease(a); err != nil {
			return err
		}
		original := a.OriginalDeadline
		if original == 0 {
			original = a.Deadline
		}
		event, err := json.Marshal(map[string]any{"at": Millis(), "action": "emergency-access-override", "attempt": id, "actor_uid": os.Getuid(), "effective_uid": os.Geteuid(), "sudo_user": os.Getenv("SUDO_USER"), "reason": reason, "original_deadline": original, "current_deadline": a.Deadline})
		if err != nil {
			return err
		}
		f, err := os.OpenFile(filepath.Join(e.Config.State, "audit.ndjson"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
		if err != nil {
			return err
		}
		_, err = f.Write(append(event, '\n'))
		if err == nil {
			err = f.Sync()
		}
		f.Close()
		if err != nil {
			return err
		}
		a.AccessState = "OVERRIDDEN"
		a.AccessReleasedAt = Millis()
		a.AccessOverride = reason
		result = a
		return nil
	})
	return result, err
}
