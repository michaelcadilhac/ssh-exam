package core

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

func (e *Engine) List(active bool, exam string) ([]*Attempt, error) {
	result := []*Attempt{}
	err := e.WithState(func() error {
		for _, a := range e.state.Attempts {
			if exam != "" && a.Exam != exam {
				continue
			}
			if active && (a.Start == 0 || a.State == "COMPLETED" || a.State == "CANCELLED_BEFORE_START") {
				continue
			}
			result = append(result, publicAttempt(a))
		}
		sort.Slice(result, func(i, j int) bool {
			return result[i].Start < result[j].Start || (result[i].Start == result[j].Start && result[i].ID < result[j].ID)
		})
		return nil
	})
	return result, err
}
func (e *Engine) Admin(op, id, reason string) (any, error) {
	if (op == "pause" || op == "stop" || op == "finish" || op == "start" || op == "cancel" || op == "retry" || op == "delete") && len(strings.TrimSpace(reason)) < 8 {
		return nil, errors.New("provide --reason with a concrete administrator reason (at least 8 characters)")
	}
	operations := map[string]string{"info": "inspect-attempt", "start": "activate-attempt", "pause": "lock-attempt", "stop": "finalize-attempt", "finish": "finalize-attempt", "cancel": "cancel-attempt", "retry": "finalize-attempt", "manifest": "submission-manifest", "delete": "delete-submission"}
	operation, ok := operations[op]
	if !ok {
		return nil, errors.New("unsupported administrator operation")
	}
	var result any
	err := e.WithState(func() error {
		if _, err := e.Find(id); err != nil {
			return err
		}
		if reason != "" {
			event, _ := json.Marshal(map[string]any{"at": Millis(), "action": "administrator-" + op, "attempt": id, "reason": reason, "actor_uid": os.Getuid(), "effective_uid": os.Geteuid(), "sudo_user": os.Getenv("SUDO_USER")})
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
		}
		var err error
		result, err = e.callLocked(operation, Request{ID: id, Reason: "administrator: " + reason})
		return err
	})
	return result, err
}

// An explicit local operator decision can retain a historical submission only on
// the class server. This is never recorded as a successful webserver transfer.
func (e *Engine) ExportDelivery(id string, paused *bool, reason string) (any, error) {
	var result any
	err := e.WithState(func() error {
		a, err := e.Find(id)
		if err != nil {
			return err
		}
		if !a.Protected {
			return errors.New("protected submission unavailable")
		}
		if _, err = ReadProtected(filepath.Join(e.Config.State, "submissions", id), a); err != nil {
			return err
		}
		if paused != nil {
			if len(strings.TrimSpace(reason)) < 8 {
				return errors.New("provide --reason with a concrete administrator reason (at least 8 characters)")
			}
			action := "resume-archive-export"
			if *paused {
				action = "pause-archive-export"
			}
			event, _ := json.Marshal(map[string]any{"at": Millis(), "action": action, "attempt": id, "reason": reason, "actor_uid": os.Getuid(), "effective_uid": os.Geteuid(), "sudo_user": os.Getenv("SUDO_USER")})
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
			if e.state.ExportPauses == nil {
				e.state.ExportPauses = map[string]string{}
			}
			if *paused {
				e.state.ExportPauses[id] = reason
			} else {
				delete(e.state.ExportPauses, id)
			}
		}
		result = map[string]any{"attempt": id, "protected": true, "webserver_transfer_verified": e.state.Exports[id], "export_paused_reason": e.state.ExportPauses[id]}
		return nil
	})
	return result, err
}
