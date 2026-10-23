package core

import "errors"

var errNativeHealthBusy = errors.New("native readiness verification already in progress; retry health/preflight after it settles; operators can inspect examctl agent status without restarting exams. This is unavailable observation, not a policy violation or new permission/clock change")

func (e *Engine) healthReadiness() (bool, []string) {
	if e.healthProbe != nil {
		return e.healthProbe()
	}
	return e.Ready()
}

// One no-wait probe per Engine, not a host-wide resource/timeout guarantee.
// It is never cached or reused as the separate actual admission/Begin guard.
func (e *Engine) observeNativeHealth() (map[string]any, error) {
	if !e.healthMu.TryLock() {
		return nil, errNativeHealthBusy
	}
	defer e.healthMu.Unlock()
	ready, missing := e.healthReadiness()
	return map[string]any{"ready": ready, "production_ready": ready && e.Config.FunctionalTestAccount == "", "functional_test": e.Config.FunctionalTestAccount != "", "host_filesystem": e.Config.HostFilesystem, "administrator_sandbox_accounts": e.sandboxAdministrators(), "missing": missing, "capabilities": []string{"single-sign-in-handoff", "read-only-home", "disposable-application-state", "temporary-account-policy", "browser-ssh-receipts", "agent-terminal-recording", "clock-reset", "clock-extend", "server-only-submissions", "deadline-timing-check", "private-workspace-staging", "collection-limits-v1", "sandbox-begin-window-v1", "immutable-template-versions-v1", "exact-template-begin-v1", "signed-pane-close", "signed-ssh-control", "durable-status-callbacks", "peer-verified-gate", "fixed-deadline", "interval-access-hold", "all-session-channel-gate", "cgroup-freeze", "isolated-filesystem", "private-network", "protected-collection", "unique-pane-incarnations-v1", "reviewed-native-pane-control-v1", "recovery-allowance-sync-v1", "unified-initial-grants-v1", "reviewed-initial-grants-v1", "ordered-template-grants-v1", "independent-workspace-grants-v1"}}, nil
}
