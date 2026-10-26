package core

// Root CLI cancellation only; no student RPC, clock, account release or archive
// deletion. The original record survives inside a fail-closed versioned envelope.
import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"unicode/utf8"

	"golang.org/x/sys/unix"
)

const recoveryMetadataMaxBytes = 32768
const recoveryRevokedPurpose = "legacy-recovery-revoked/v1"

type RecoveryRevocation struct {
	Version      int    `json:"version"`
	OriginalHash string `json:"original_hash"`
	Review       string `json:"review"`
	At           int64  `json:"at"`
	Reason       string `json:"reason"`
	ActorUID     int    `json:"actor_uid"`
	EffectiveUID int    `json:"effective_uid"`
	original     []byte
}

type RecoveryRevocationPreview struct {
	Exam      string   `json:"exam"`
	Username  string   `json:"username"`
	UID       int      `json:"uid"`
	GrantHash string   `json:"grant_hash"`
	Review    string   `json:"review"`
	Eligible  bool     `json:"eligible"`
	Blockers  []string `json:"blockers"`
}

type RecoveryRevocationResult struct {
	RecoveryPreparation
	Disposition string `json:"disposition"`
}

func recoveryObject(data []byte, target any, names ...string) error {
	var fields map[string]json.RawMessage
	if !validReadOnlyJSON(data) || json.Unmarshal(data, &fields) != nil || len(fields) != len(names) {
		return errRecoveryMetadata
	}
	for _, name := range names {
		if value, ok := fields[name]; !ok || bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return errRecoveryMetadata
		}
	}
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if d.Decode(target) != nil || d.Decode(new(any)) != io.EOF {
		return errRecoveryMetadata
	}
	return nil
}

func decodeRevokedRecovery(data []byte) (*RecoveryPreparation, error) {
	var envelope struct {
		Purpose  string          `json:"purpose"`
		Original string          `json:"original"`
		Receipt  json.RawMessage `json:"receipt"`
	}
	if len(data) > recoveryMetadataMaxBytes || recoveryObject(data, &envelope, "purpose", "original", "receipt") != nil || envelope.Purpose != recoveryRevokedPurpose || len(envelope.Original) > base64.StdEncoding.EncodedLen(16384) {
		return nil, errRecoveryMetadata
	}
	original, err := base64.StdEncoding.DecodeString(envelope.Original)
	if err != nil || base64.StdEncoding.EncodeToString(original) != envelope.Original {
		return nil, errRecoveryMetadata
	}
	r, err := decodeLegacyRecoveryMetadata(original)
	if err != nil {
		return nil, err
	}
	var receipt RecoveryRevocation
	if recoveryObject(envelope.Receipt, &receipt, "version", "original_hash", "review", "at", "reason", "actor_uid", "effective_uid") != nil ||
		receipt.Version != 1 || receipt.OriginalHash != Hash(original) || !templateDigest.MatchString(receipt.Review) || receipt.At < r.CreatedAt || receipt.At > 9007199254740991 ||
		!validRecoveryRevocationReason(receipt.Reason) || receipt.ActorUID < 0 || receipt.EffectiveUID < 0 {
		return nil, errRecoveryMetadata
	}
	receipt.original = original
	r.Revocation = &receipt
	return r, nil
}

func encodeRecoveryMetadata(r *RecoveryPreparation) ([]byte, error) {
	if r == nil {
		return nil, errRecoveryMetadata
	}
	if r.Revocation == nil {
		return json.Marshal(r)
	}
	original, err := decodeLegacyRecoveryMetadata(r.Revocation.original)
	if err != nil {
		return nil, err
	}
	copy := *r
	copy.Revocation = nil
	a, _ := json.Marshal(copy)
	b, _ := json.Marshal(original)
	if !bytes.Equal(a, b) {
		return nil, errRecoveryMetadata
	}
	data, err := json.Marshal(struct {
		Purpose  string              `json:"purpose"`
		Original string              `json:"original"`
		Receipt  *RecoveryRevocation `json:"receipt"`
	}{recoveryRevokedPurpose, base64.StdEncoding.EncodeToString(r.Revocation.original), r.Revocation})
	if err != nil {
		return nil, err
	}
	if _, err := decodeRevokedRecovery(data); err != nil {
		return nil, err
	}
	return data, nil
}

func validRecoveryRevocationReason(reason string) bool {
	return utf8.ValidString(reason) && len(strings.TrimSpace(reason)) >= 8 && len(reason) <= 1000
}

func (e *Engine) recoveryRevocationState() (State, error) {
	root, err := readOnlyRoot(e.Config.State)
	if err != nil {
		return State{}, err
	}
	defer root.Close()
	marker, err := readOnlyFile(root, "initialized", 4096)
	if err != nil || len(marker) == 0 {
		return State{}, errors.New("initialized native authority unavailable; preserve state/catalog and inspect examctl list --read-only --json; no permission cancelled")
	}
	state, _, err := readOnlyStateFile(root)
	return state, err
}

// Whole bounded inventories reject unknown crash residue, rather than inferring
// no start from the canonical row alone. They never traverse/delete orphan work.
func (e *Engine) recoveryNoStartFiles(state State, r *RecoveryPreparation) error {
	for _, directory := range []string{e.Config.Work, filepath.Join(e.Config.State, "submissions")} {
		root, err := os.OpenFile(directory, os.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
		if os.IsNotExist(err) && directory != e.Config.Work {
			continue
		}
		if err != nil {
			return errors.New("workspace/submission inventory unavailable; preserve folders and inspect native history before cancellation")
		}
		err = func() error {
			defer root.Close()
			info, err := root.Stat()
			if err != nil || info.Mode().Perm()&0022 != 0 || info.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) {
				return errReadOnlySnapshot
			}
			entries, err := root.ReadDir(20001)
			if (err != nil && err != io.EOF) || len(entries) > 20000 {
				return errors.New("workspace/submission inventory exceeds safe bounds; preserve records for reviewed migration")
			}
			for _, entry := range entries {
				a := state.Attempts[entry.Name()]
				if !attemptID.MatchString(entry.Name()) || !entry.IsDir() || a == nil || a.ID != entry.Name() {
					return errors.New("unknown workspace/submission crash residue; preserve it and reconcile consistent native history before cancellation")
				}
				if a.Exam != r.Exam || a.UID != r.UID || a.Start != 0 {
					continue
				}
				if directory != e.Config.Work {
					return fmt.Errorf("submission contradicts no-start history for %s; preserve all records and inspect examctl info %s --read-only", a.ID, a.ID)
				}
				base, err := readOnlyOpenAt(root, entry.Name(), true)
				if err != nil {
					return err
				}
				var failure error
				for _, name := range []string{"work", "initialized"} {
					var stat unix.Stat_t
					if err := unix.Fstatat(int(base.Fd()), name, &stat, unix.AT_SYMLINK_NOFOLLOW); err == nil || !errors.Is(err, unix.ENOENT) {
						failure = fmt.Errorf("published work contradicts no-start history for %s; preserve files and inspect examctl workspaces show %s", a.ID, a.ID)
					}
				}
				base.Close()
				if failure != nil {
					return failure
				}
			}
			return nil
		}()
		if err != nil {
			return err
		}
	}
	return nil
}

func (e *Engine) recoveryRevocationProof(exam, username string) (RecoveryRevocationPreview, *RecoveryGrantView, []byte, int64, error) {
	view := RecoveryRevocationPreview{Exam: exam, Username: username, Blockers: []string{}}
	state, err := e.recoveryRevocationState()
	if err != nil {
		return view, nil, nil, 0, err
	}
	rows, err := e.readRecoveryCatalog(state)
	if err != nil {
		return view, nil, nil, 0, err
	}
	var selected *RecoveryGrantView
	var catalogBytes int64
	for i := range rows {
		catalogBytes += rows[i].metadataBytes
		if rows[i].Exam == exam && rows[i].Username == username {
			selected = &rows[i]
		}
	}
	if selected == nil {
		return view, nil, nil, 0, errors.New("native legacy permission not found; inspect examctl recovery-grants and examctl web grants help; no cancellation inferred from absence")
	}
	root, err := e.openRecoveryExam(exam)
	if err != nil {
		return view, nil, nil, 0, err
	}
	defer root.Close()
	data, err := recoveryMetadataFile(root, username+".json", recoveryMetadataMaxBytes)
	if err != nil {
		return view, nil, nil, 0, err
	}
	view.UID, view.GrantHash = selected.UID, Hash(data)
	if selected.Revocation != nil {
		view.Review = selected.Revocation.Review
		view.Blockers = append(view.Blockers, "Permission is already cancelled; inspect its receipt or issue a reviewed NEW grant; it cannot reopen")
		return view, selected, data, catalogBytes, nil
	}
	if selected.Disposition != "unused" || selected.PendingAllowanceRevision != nil {
		view.Blockers = append(view.Blockers, "Permission is consumed, uncertain or has pending allowance publication; preserve catalog and inspect recovery-grants before cancellation")
	}
	type interval struct {
		ID, Username, State               string
		Start, Deadline, OriginalDeadline int64
	}
	relevant := []interval{}
	for _, a := range state.Attempts {
		if a.Exam != exam || a.UID != selected.UID {
			continue
		}
		relevant = append(relevant, interval{a.ID, a.Username, a.State, a.Start, a.Deadline, a.OriginalDeadline})
		if a.Start == 0 && (a.State != "CANCELLED_BEFORE_START" || a.Deadline != 0 || a.OriginalDeadline != 0) {
			view.Blockers = append(view.Blockers, fmt.Sprintf("Preparation %s is unresolved; inspect examctl info %s --read-only and positively cancel only if unstarted", a.ID, a.ID))
		}
	}
	sort.Slice(relevant, func(i, j int) bool { return relevant[i].ID < relevant[j].ID })
	if !selected.SourceRecordedProtected {
		view.Blockers = append(view.Blockers, "Original protected source history is unavailable or mismatched; preserve catalog/archive and restore consistent native history")
	}
	if err := e.recoveryNoStartFiles(state, &selected.RecoveryPreparation); err != nil {
		view.Blockers = append(view.Blockers, err.Error())
	}
	sort.Strings(view.Blockers)
	snapshot, _ := json.Marshal(struct {
		Hash            string
		Intervals       []interval
		SourceProtected bool
		Blockers        []string
	}{view.GrantHash, relevant, selected.SourceRecordedProtected, view.Blockers})
	view.Review, view.Eligible = Hash(snapshot), len(view.Blockers) == 0
	return view, selected, data, catalogBytes, nil
}

func (e *Engine) PreviewRecoveryRevocation(exam, username string) (RecoveryRevocationPreview, error) {
	if !identifier.MatchString(exam) || !identifier.MatchString(username) {
		return RecoveryRevocationPreview{}, errors.New("choose exact EXAM USER from examctl recovery-grants; inspect recovery-grants help")
	}
	if _, err := e.recoveryRevocationState(); err != nil {
		return RecoveryRevocationPreview{}, err
	}
	lock, err := e.recoveryCatalogLock()
	if err != nil {
		return RecoveryRevocationPreview{}, err
	}
	defer lock.Close()
	view, _, _, _, err := e.recoveryRevocationProof(exam, username)
	return view, err
}

func (e *Engine) RevokeRecoveryPermission(exam, username, review, reason string) (RecoveryRevocationResult, error) {
	var result RecoveryRevocationResult
	if !identifier.MatchString(exam) || !identifier.MatchString(username) || !templateDigest.MatchString(review) || !validRecoveryRevocationReason(reason) {
		return result, errors.New("revoke requires exact EXAM USER, reviewed hash and 8..1000-byte reason; run recovery-grants revoke-preview first")
	}
	if _, err := e.recoveryRevocationState(); err != nil {
		return result, err
	}
	lock, err := e.recoveryCatalogLock()
	if err != nil {
		return result, err
	}
	defer lock.Close()
	view, row, data, total, err := e.recoveryRevocationProof(exam, username)
	if err != nil {
		return result, err
	}
	account, err := e.accountWorkLock(row.UID)
	if err != nil {
		return result, err
	}
	defer account.Close()
	view, row, data, total, err = e.recoveryRevocationProof(exam, username)
	if err != nil {
		return result, err
	}
	if row.Revocation != nil {
		if row.Disposition != "revoked" {
			return result, errors.New("cancellation receipt has contradictory legacy start/consumption evidence; preserve receipt, source and history and inspect recovery-grants before retry")
		}
		if row.Revocation.Review != review || row.Revocation.Reason != reason {
			return result, errors.New("permission already cancelled under a different reviewed intent; inspect recovery-grants, never reopen it")
		}
		root, err := e.openRecoveryExam(exam)
		if err != nil {
			return result, err
		}
		defer root.Close()
		if err := root.Sync(); err != nil {
			return result, err
		}
		if err := e.workspaceBarrier("revocation-before-state-sync"); err != nil {
			return result, err
		}
		if err := syncDirectory(e.Config.State); err != nil {
			return result, err
		}
		if err := e.workspaceBarrier("revocation-synced"); err != nil {
			return result, err
		}
		return RecoveryRevocationResult{row.RecoveryPreparation, "revoked"}, nil
	}
	if !view.Eligible || view.Review != review {
		return result, fmt.Errorf("permission/history changed or is ineligible: %v; run a fresh revoke-preview and review explicitly; no permission cancelled", view.Blockers)
	}
	receipt := &RecoveryRevocation{Version: 1, OriginalHash: Hash(data), Review: review, At: Millis(), Reason: reason, ActorUID: os.Getuid(), EffectiveUID: os.Geteuid(), original: data}
	record := row.RecoveryPreparation
	record.Revocation = receipt
	encoded, err := encodeRecoveryMetadata(&record)
	if err != nil {
		return result, err
	}
	if total+int64(len(encoded)-len(data)) > 16*1024*1024 {
		return result, errors.New("revocation would exceed bounded catalog metadata; preserve authority for reviewed bounded migration")
	}
	file, err := os.CreateTemp(e.Config.State, ".legacy-recovery-revoke-")
	if err != nil {
		return result, err
	}
	name := file.Name()
	defer os.Remove(name)
	_, err = file.Write(encoded)
	if err == nil {
		err = file.Sync()
	}
	closed := file.Close()
	if err == nil {
		err = closed
	}
	if err != nil {
		return result, err
	}
	if err := e.workspaceBarrier("revocation-staged"); err != nil {
		return result, err
	}
	if err := e.appendNativeManagementAudit(map[string]any{"at": receipt.At, "action": "revoke-unused-legacy-recovery-permission", "exam": exam, "username": username, "uid": row.UID, "actor_uid": receipt.ActorUID, "effective_uid": receipt.EffectiveUID, "receipt": receipt}); err != nil {
		return result, err
	}
	if err := e.workspaceBarrier("revocation-audited"); err != nil {
		return result, err
	}
	fresh, _, current, _, err := e.recoveryRevocationProof(exam, username)
	if err != nil {
		return result, err
	}
	if !fresh.Eligible || fresh.Review != review || !bytes.Equal(current, data) {
		return result, errors.New("permission/history changed before publication; inspect a fresh revoke-preview; original permission preserved")
	}
	root, err := e.openRecoveryExam(exam)
	if err != nil {
		return result, err
	}
	defer root.Close()
	if err := unix.Renameat(unix.AT_FDCWD, name, int(root.Fd()), username+".json"); err != nil {
		return result, err
	}
	if err := e.workspaceBarrier("revocation-published"); err != nil {
		return result, err
	}
	if err := root.Sync(); err != nil {
		return result, fmt.Errorf("cancellation durability unconfirmed; inspect recovery-grants and retry SAME review/reason: %w", err)
	}
	if err := e.workspaceBarrier("revocation-before-state-sync"); err != nil {
		return result, err
	}
	if err := syncDirectory(e.Config.State); err != nil {
		return result, err
	}
	if err := e.workspaceBarrier("revocation-synced"); err != nil {
		return result, err
	}
	return RecoveryRevocationResult{record, "revoked"}, nil
}
