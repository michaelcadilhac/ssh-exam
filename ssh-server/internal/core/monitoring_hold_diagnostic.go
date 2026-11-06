package core

import (
	"encoding/json"
	"errors"
	"log"
)

// Existing Engine.Tick caller, at the actual ACTIVE -> LOCKED transition.
// No new state/authority/persistence protocol: append one richer existing audit.
func (e *Engine) auditMonitoringHold(a *Attempt, fact terminalCutoffFact) {
	d := map[string]any{"ssh_exited": fact.sshExited, "writers_held": fact.held, "observation": "available"}
	switch fact.observationStage {
	case "existing-hold", "cutoff-open", "clock-read", "authority-expiry":
		d["stage"] = fact.observationStage
	default:
		d["stage"] = "unknown"
	}
	if fact.error != nil {
		d["observation"] = "unavailable"
		switch {
		case errors.Is(fact.error, errMonitoringClock):
			d["error_class"] = "clock-unavailable"
		case errors.Is(fact.error, errMonitoringScope):
			d["error_class"] = "owner-mismatch"
		case errors.Is(fact.error, errMonitoringCutoff):
			d["error_class"] = "cutoff-unavailable"
		default:
			d["error_class"] = "observation-failed"
		}
	}
	if now, err := monitoringBootMillis(); err == nil {
		d["observed_boot_ms"] = now
	}
	if v := fact.view; v != nil {
		d["sequence"], d["revision"] = v.Sequence, v.Revision
		d["authority_until_boot_ms"], d["deadline_boot_ms"] = v.AuthorityUntilMS, v.DeadlineUptimeMS
		d["publication_pending"], d["publication_failure_observed"] = v.PublicationPending, v.PublicationFailureObserved
		d["execution_authorized"] = v.ExecutionAuthorized
		causes := []string{}
		for _, cause := range v.Causes {
			switch cause {
			case "technical-expiry", "deadline", "clock-unknown", "ownership-unknown", "recording-failure", "policy-condition", "operator-pause", "ssh-exited":
				if len(causes) < 8 {
					causes = append(causes, cause)
				}
			}
		}
		d["causes"] = causes
	} else {
		d["observation"] = "unavailable"
	}
	event := map[string]any{"at": Millis(), "action": "native-monitoring-hold", "attempt": a.ID, "reason": a.Reason, "generation": a.Generation, "clock_revision": a.ClockRevision, "diagnostic": d}
	_ = e.appendNativeManagementAudit(event)
	if encoded, err := json.Marshal(event); err == nil {
		log.Printf("monitoring hold diagnostic %s", encoded)
	}
}
