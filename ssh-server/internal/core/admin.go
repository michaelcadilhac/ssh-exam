package core

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
)

func (e *Engine) List(active bool, exam string) ([]*Attempt, error) {
	if err := e.reconcileAccessOutside(""); err != nil {
		return nil, err
	}
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

// Verify in a bounded worker, then open/audit the same immutable receipt under
// the attempt + short state locks. Slow hashing/copying never holds shared state.
func (e *Engine) OpenExport(id string) (*os.File, error) {
	if err := e.collectionRun("manifest", id); err != nil {
		return nil, err
	}
	lock, err := e.attemptCollectionLock(id)
	if err != nil {
		return nil, err
	}
	defer lock.Close()
	var archive *os.File
	err = e.WithState(func() error {
		a, err := e.Find(id)
		if err != nil {
			return err
		}
		if !a.Protected || len(e.state.ManifestReceipts[id]) != 64 {
			return errors.New("protected submission unavailable")
		}
		dir := filepath.Join(e.Config.State, "submissions", id)
		archive, err = os.OpenFile(filepath.Join(dir, "submission.tar.gz"), os.O_RDONLY|syscall.O_NOFOLLOW, 0)
		if err != nil {
			return err
		}
		event, err := json.Marshal(map[string]any{"at": Millis(), "action": "administrator-export", "attempt": id, "checksum": a.Checksum, "actor_uid": os.Getuid(), "effective_uid": os.Geteuid(), "sudo_user": os.Getenv("SUDO_USER")})
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
		closeErr := f.Close()
		if err != nil {
			return err
		}
		return closeErr
	})
	if err != nil && archive != nil {
		archive.Close()
		archive = nil
	}
	return archive, err
}
func (e *Engine) Admin(op, id, reason string) (any, error) {
	if (op == "pause" || op == "stop" || op == "finish" || op == "start" || op == "cancel" || op == "retry" || op == "delete" || op == "workspace-repair") && len(strings.TrimSpace(reason)) < 8 {
		return nil, errors.New("provide --reason with a concrete administrator reason (at least 8 characters)")
	}
	operations := map[string]string{"info": "inspect-attempt", "start": "activate-attempt", "pause": "lock-attempt", "stop": "finalize-attempt", "finish": "finalize-attempt", "cancel": "cancel-attempt", "retry": "finalize-attempt", "manifest": "submission-manifest", "delete": "delete-submission", "workspace-prepare": "prepare-workspace", "workspace-repair": "workspace-repair"}
	operation, ok := operations[op]
	if !ok {
		return nil, errors.New("unsupported administrator operation")
	}
	if op == "info" || op == "delete" {
		if err := e.reconcileAccessOutside(id); err != nil {
			return nil, err
		}
	}
	if op == "delete" || op == "start" {
		lock, err := e.attemptCollectionLock(id)
		if err != nil {
			return nil, err
		}
		defer lock.Close()
	}
	if op == "delete" {
		lock, err := e.recoveryCatalogLock()
		if err != nil {
			return nil, err
		}
		defer lock.Close()
		if err := e.verifySubmissionDeletion(id); err != nil {
			return nil, err
		}
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
		if op != "workspace-repair" {
			result, err = e.callLocked(operation, Request{ID: id, Reason: "administrator: " + reason})
		}
		return err
	})
	if err == nil && operation == "activate-attempt" {
		result, err = e.activatePrepared(result.(*Attempt), 0)
	}
	if err == nil && operation == "prepare-workspace" {
		result, err = e.preparedWorkspace(id)
	}
	if err == nil && operation == "workspace-repair" {
		result, err = e.repairWorkspace(id)
	}
	if err == nil && operation == "finalize-attempt" {
		result, err = e.finishCollection(id)
	}
	if err == nil && operation == "submission-manifest" {
		result, err = e.verifiedManifest(id)
	}
	if err == nil && (op == "cancel" || op == "stop" || op == "finish") {
		err = e.reconcilePolicies(id)
		if err == nil {
			err = e.WithState(func() error { a, err := e.Find(id); result = a; return err })
		}
	}
	return result, err
}

// An explicit local operator decision can retain a historical submission only on
// the class server. This is never recorded as a successful webserver transfer.
func (e *Engine) ExportDelivery(id string, paused *bool, reason string) (any, error) {
	if paused != nil && !*paused {
		return nil, errors.New("archive exports are disabled; submissions remain on this SSH server")
	}
	if err := e.collectionRun("manifest", id); err != nil {
		return nil, err
	}
	lock, err := e.attemptCollectionLock(id)
	if err != nil {
		return nil, err
	}
	defer lock.Close()
	var result any
	err = e.WithState(func() error {
		a, err := e.Find(id)
		if err != nil {
			return err
		}
		if !a.Protected {
			return errors.New("protected submission unavailable")
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
		result = map[string]any{"attempt": id, "protected": true, "storage": "ssh-server", "webserver_transfer_verified": false, "historical_webserver_transfer_verified": e.state.Exports[id], "export_paused_reason": e.state.ExportPauses[id]}
		return nil
	})
	return result, err
}
