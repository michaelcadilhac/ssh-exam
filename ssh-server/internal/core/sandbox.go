package core

import (
	"errors"
	"sort"
)

const SandboxExamID = "sandbox"
const SandboxDurationSeconds int64 = 300

func sandboxAttempt(a *Attempt) bool { return a.Exam == SandboxExamID }

// Begin admission only: never apply to continuation or an already committed
// interval. Legacy indefinite preparations need explicit cancellation/reissue.
func sandboxBeginWindow(s Settings, at int64) error {
	if s.Earliest <= 0 || s.Latest <= s.Earliest || s.Latest >= 8640000000000000 {
		return errors.New("sandbox requires an explicit finite Begin window; use examctl web exams show sandbox, then update sandbox --revision HASH --earliest RFC3339 --latest RFC3339; cancel/recreate legacy unstarted preparation, never rewrite a saved attempt")
	}
	if at < s.Earliest || at > s.Latest {
		return errors.New("outside sandbox Begin window; inspect saved attempt settings with examctl info ATTEMPT --read-only; existing started deadlines are unchanged")
	}
	return nil
}

// Explicit root approval of an administrator is scoped to the reserved sandbox.
// It never exempts a normal student attempt, even for the same UID.
func (e *Engine) administratorSandbox(a *Attempt) bool {
	account, ok := e.account(a.Username)
	return ok && account.SandboxOnly && account.UID == a.UID && sandboxAttempt(a) && a.AdministratorSandbox
}
func (e *Engine) hostAccess(a *Attempt) bool {
	return (e.Config.FunctionalHostAccess && e.functionalAccount(a)) || e.administratorSandbox(a)
}
func (e *Engine) trustedAdministratorAttempt(a *Attempt) bool {
	return e.functionalAccount(a) || e.administratorSandbox(a)
}
func (e *Engine) sandboxAdministrators() []string {
	names := []string{}
	for name, account := range e.Config.Accounts {
		if account.SandboxOnly {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	return names
}
