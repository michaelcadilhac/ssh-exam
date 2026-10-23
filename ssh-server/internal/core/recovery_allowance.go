package core

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"

	"golang.org/x/sys/unix"
)

type RecoveryPreflight struct {
	Version           int                    `json:"version"`
	Exam              string                 `json:"exam"`
	Username          string                 `json:"username"`
	UID               int                    `json:"uid"`
	Duration          int64                  `json:"duration"`
	SourceAttempt     string                 `json:"source_attempt"`
	Checksum          string                 `json:"checksum"`
	GrantHash         string                 `json:"grant_hash"`
	CreatedAt         int64                  `json:"created_at"`
	AllowanceRevision *RecoveryAllowanceEdit `json:"allowance_revision"`
}
type recoveryAllowanceReply struct {
	Version  int                `json:"version"`
	Recovery *RecoveryPreflight `json:"recovery"`
}

// Distinct signed Begin purpose: older native roles must refuse, not ignore
// an expected saved-work hash. Recheck before OS work and at the commit fence.
func recoveryBeginSettings(a *Attempt, r Request, recovery bool) error {
	if recovery {
		if a == nil || a.ExpectedRecovery == "" || a.ExpectedRecovery != r.ExpectedRecovery || a.Settings != r.Settings {
			return errors.New("saved-work grant or settings changed; inspect the existing preparation before retrying recovery-aware Begin; no new clock requested")
		}
	} else if r.ExpectedRecovery != "" || (a != nil && a.ExpectedRecovery != "") {
		return errors.New("saved-work preparation requires recovery-aware Begin; update matching gateway/native roles; no new clock requested")
	}
	return nil
}

func validRecoveryAllowanceEdit(r *RecoveryAllowanceEdit) bool {
	return r != nil && r.Revision > 0 && r.Revision <= 9007199254740991 && r.Duration >= 60 && r.Duration <= 21600 && r.Duration%60 == 0 && len(strings.TrimSpace(r.Actor)) > 0 && len(r.Actor) <= 128 && r.At > 0 && r.At <= 9007199254740991
}
func sameRecoveryAuthority(a, b *RecoveryPreparation) bool {
	if a == nil || b == nil {
		return false
	}
	x, y := *a, *b
	x.Duration, y.Duration, x.AllowanceRevision, y.AllowanceRevision = 0, 0, nil, nil
	return x == y
}

// Crash residue is unpublished metadata, never permission or a reservation.
// Catalog inspection and authenticated retry share the strict/source-bound read.
func pendingRecoveryAllowance(root *os.File, name string, current *RecoveryPreparation) (*RecoveryPreparation, error) {
	b, err := recoveryMetadataFile(root, name+".pending", 16384)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, errRecoveryMetadata
	}
	p, err := decodeRecoveryMetadata(b)
	if err != nil || p.AllowanceRevision == nil || !sameRecoveryAuthority(current, p) {
		return nil, errRecoveryMetadata
	}
	return p, nil
}

// Signed registered-student preflight only, under UID/catalog/state fences.
// Creates no attempt, policy, interval or consumption. Archive IO stays isolated.
func (e *Engine) reconcileRecoveryAllowance(r Request, expires int64) (any, error) {
	if !attemptID.MatchString(r.ID) || !identifier.MatchString(r.Exam) || !identifier.MatchString(r.Username) || (r.AllowanceEdit != nil && (!validRecoveryAllowanceEdit(r.AllowanceEdit) || r.AllowanceEdit.At > Millis()+1000)) {
		return nil, errors.New("invalid recovery allowance scope; retry authenticated preflight with the recorded explicit allowance edit")
	}
	accountLock, err := e.accountWorkLock(r.UID)
	if err != nil {
		return nil, err
	}
	defer accountLock.Close()
	catalogLock, err := e.recoveryCatalogLock()
	if err != nil {
		return nil, err
	}
	defer catalogLock.Close()
	result := recoveryAllowanceReply{Version: 1}
	err = e.WithState(func() error {
		account, ok := e.account(r.Username)
		if !ok || account.UID != r.UID || r.Transport == "" || e.state.Registrations[r.Transport] != r.Username || expires <= Millis() {
			return errors.New("recovery allowance authentication expired/changed; reconnect and retry preflight; no clock started")
		}
		root, err := e.openRecoveryExam(r.Exam)
		if os.IsNotExist(err) {
			return nil
		}
		if err != nil {
			return errRecoveryMetadata
		}
		defer root.Close()
		name := r.Username + ".json"
		b, err := recoveryMetadataFile(root, name, 16384)
		if os.IsNotExist(err) {
			for _, suffix := range []string{".consumed", ".pending"} {
				if _, err := recoveryMetadataFile(root, name+suffix, 16384); !os.IsNotExist(err) {
					return errRecoveryMetadata
				}
			}
			return nil
		}
		if err != nil {
			return errRecoveryMetadata
		}
		grant, err := decodeRecoveryMetadata(b)
		if err != nil {
			return errRecoveryMetadata
		}
		for _, a := range e.state.Attempts {
			if a.Exam == r.Exam && a.UID == r.UID && (a.State == "PREPARING" || a.Start >= grant.CreatedAt) {
				return fmt.Errorf("recovery grant already prepared or started; inspect examctl info %s --read-only; cancel only a confirmed unstarted preparation before revising its allowance; no refund or reopening is authorized", a.ID)
			}
		}
		if grant.Exam != r.Exam || grant.Username != r.Username || grant.UID != r.UID {
			return errors.New("recovery grant identity differs from authenticated account/exam; preserve grant and source before repair")
		}
		if _, err := recoveryMetadataFile(root, name+".consumed", 36); !os.IsNotExist(err) {
			return errors.New("saved-work recovery already consumed or consumption evidence unavailable; preserve markers and inspect examctl recovery-grants; no revision or refund authorized")
		}
		source := e.state.Attempts[grant.SourceAttempt]
		if source == nil || source.Username != r.Username || source.UID != r.UID || source.State != "COMPLETED" || !source.Protected || source.Checksum != grant.Checksum {
			return errors.New("secured recovery source unavailable; preserve the grant/archive/history before retrying")
		}
		pending, err := pendingRecoveryAllowance(root, name, grant)
		if err != nil {
			return errRecoveryMetadata
		}
		edit := r.AllowanceEdit
		if pending != nil && (edit == nil || edit.Revision < pending.AllowanceRevision.Revision || (edit.Revision == pending.AllowanceRevision.Revision && *edit != *pending.AllowanceRevision)) {
			return errors.New("newer unpublished allowance revision retained; preserve catalog/gateway edit history, inspect examctl recovery-grants, then retry the latest explicit edit")
		}
		if edit != nil && grant.AllowanceRevision != nil {
			prior := grant.AllowanceRevision
			if edit.Revision < prior.Revision || (edit.Revision == prior.Revision && *edit != *prior) {
				return errors.New("stale/conflicting recovery allowance revision; preserve gateway/native edit history and retry the latest explicit setting, never reset revision counters")
			}
		}
		change := edit != nil && (grant.AllowanceRevision == nil || edit.Revision > grant.AllowanceRevision.Revision)
		if change && edit.At < grant.CreatedAt {
			if edit.Duration != grant.Duration {
				return errors.New("allowance edit predates this recovery grant; explicitly save the intended student allowance again before preflight, preserving source/history")
			}
			change = false
		}
		if change {
			updated := *grant
			updated.Duration, updated.AllowanceRevision = edit.Duration, edit
			data, _ := json.Marshal(updated)
			if err := e.appendNativeManagementAudit(map[string]any{"at": Millis(), "action": "authorize-recovery-allowance-revision", "exam": r.Exam, "username": r.Username, "uid": r.UID, "previous_duration": grant.Duration, "edit": edit, "source_attempt": grant.SourceAttempt, "checksum": grant.Checksum}); err != nil {
				return err
			}
			if pending != nil {
				if err := unix.Unlinkat(int(root.Fd()), name+".pending", 0); err != nil {
					return err
				}
				if err := root.Sync(); err != nil {
					return err
				}
			}
			if err := publishPrivateMarkerNew(root, name+".pending", data, func(phase string) error { return e.workspaceBarrier("allowance-" + phase) }); err != nil {
				return err
			}
			if err := e.workspaceBarrier("allowance-published"); err != nil {
				return err
			}
			if err := unix.Renameat(int(root.Fd()), name+".pending", int(root.Fd()), name); err != nil {
				return err
			}
			grant = &updated
			if err := e.workspaceBarrier("allowance-replaced"); err != nil {
				return err
			}
		} else if pending != nil {
			return errors.New("unpublished recovery allowance metadata requires the latest explicit edit; inspect examctl recovery-grants and retry, preserving all markers")
		}
		if err := root.Sync(); err != nil {
			return err
		}
		result.Recovery = &RecoveryPreflight{Version: 1, Exam: grant.Exam, Username: grant.Username, UID: grant.UID, Duration: grant.Duration, SourceAttempt: grant.SourceAttempt, Checksum: grant.Checksum, GrantHash: recoveryReferenceHash(grant), CreatedAt: grant.CreatedAt, AllowanceRevision: grant.AllowanceRevision}
		return nil
	})
	return result, err
}
