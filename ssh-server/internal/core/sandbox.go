package core

import "sort"

const SandboxExamID = "sandbox"
const SandboxDurationSeconds int64 = 300

func sandboxAttempt(a *Attempt) bool { return a.Exam == SandboxExamID }

// Explicit root approval of an administrator is scoped to the reserved sandbox.
// It never exempts a normal student attempt, even for the same UID.
func (e *Engine) administratorSandbox(a *Attempt) bool {
	account, ok := e.Config.Accounts[a.Username]
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
