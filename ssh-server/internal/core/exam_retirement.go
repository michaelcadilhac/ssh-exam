package core

// Offline root observation for web exams native-review. No Engine initialization,
// reconciliation, process action, account change or source verification/deletion.
import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
)

type ExamRetirementAttempt struct {
	ID               string `json:"id"`
	Username         string `json:"username"`
	UID              int    `json:"uid"`
	State            string `json:"state"`
	Start            int64  `json:"start"`
	Deadline         int64  `json:"deadline"`
	OriginalDeadline int64  `json:"original_deadline"`
	Protected        bool   `json:"protected"`
	Checksum         string `json:"checksum"`
	AccessState      string `json:"access_state"`
}
type ExamRetirementPermission struct {
	Username    string `json:"username"`
	UID         int    `json:"uid"`
	Source      string `json:"source_attempt"`
	Checksum    string `json:"checksum"`
	Disposition string `json:"disposition"`
}
type ExamRetirementEvidence struct {
	Version            int                        `json:"version"`
	Agent              string                     `json:"agent"`
	Exam               string                     `json:"exam"`
	ObservedAt         int64                      `json:"observed_at"`
	StateHash          string                     `json:"state_hash"`
	Attempts           []ExamRetirementAttempt    `json:"attempts"`
	Permissions        []ExamRetirementPermission `json:"permissions"`
	ReleasedRetentions int                        `json:"released_retentions"`
}

func closedRetirementAttempt(a *Attempt) bool {
	if a == nil || !attemptID.MatchString(a.ID) || !identifier.MatchString(a.Exam) || !identifier.MatchString(a.Username) || a.UID < 1000 ||
		a.PreparationPending || a.TimingPendingSince != 0 || len(a.Units) != 0 || a.AccessError != "" || a.PolicyError != "" ||
		(a.PolicyState != "" && a.PolicyState != "NORMAL") || (a.PolicyGeneration != "" && a.PolicyState != "NORMAL") {
		return false
	}
	if a.State == "CANCELLED_BEFORE_START" {
		return a.CancellationCleanupComplete && a.PolicyState == "NORMAL" && a.Start == 0 && a.Deadline == 0 && a.OriginalDeadline == 0 && !a.Protected && a.Checksum == "" && a.Ended > 0 &&
			(a.AccessState == "" || a.AccessState == "RELEASED" || a.AccessState == "OVERRIDDEN")
	}
	return a.State == "COMPLETED" && a.Start > 0 && a.Deadline > a.Start && a.OriginalDeadline > a.Start && a.Ended > 0 && a.Protected && templateDigest.MatchString(a.Checksum) &&
		(a.AccessState == "RELEASED" || a.AccessState == "OVERRIDDEN")
}

func (e *Engine) retirementObservation(exam string) (ExamRetirementEvidence, error) {
	result := ExamRetirementEvidence{Version: 1, Agent: e.Config.AgentID, Exam: exam, Attempts: []ExamRetirementAttempt{}, Permissions: []ExamRetirementPermission{}}
	root, err := readOnlyRoot(e.Config.State)
	if err != nil {
		return result, err
	}
	marker, err := readOnlyFile(root, "initialized", 4096)
	if err != nil || len(marker) == 0 {
		root.Close()
		return result, errors.New("initialized native authority unavailable; preserve state and inspect list --read-only; no reconciliation evidence issued")
	}
	_, stateBytes, err := readOnlyStateFile(root)
	root.Close()
	if err != nil {
		return result, err
	}
	// Unknown future authority fields cannot become evidence from an older reader.
	var state State
	if decodeWorkerFrame(bytes.NewReader(stateBytes), readOnlyStateMaxBytes, &state) != nil {
		return result, errors.New("native state contains unsupported authority fields; preserve history and use matching native readers before reconciliation")
	}
	if len(state.Attempts) > 20000 {
		return result, errors.New("native attempt inventory exceeds safe bound; preserve it for reviewed migration")
	}
	// Includes unknown UUID folders globally and published work/submissions for
	// every selected unstarted record, not merely absence of a canonical row.
	if err := e.recoveryNoStartFiles(state, &RecoveryPreparation{Exam: exam, UID: -1}); err != nil {
		return result, err
	}
	for id, a := range state.Attempts {
		if a == nil || a.ID != id || !attemptID.MatchString(id) {
			return result, errReadOnlySnapshot
		}
		if a.Exam != exam {
			continue
		}
		if !closedRetirementAttempt(a) {
			return result, fmt.Errorf("native attempt %s is not positively closed/protected/released; inspect examctl info %s --read-only; retirement changes no hold or clock", id, id)
		}
		if a.Start == 0 {
			if err := e.recoveryNoStartFiles(state, &RecoveryPreparation{Exam: exam, UID: a.UID}); err != nil {
				return result, err
			}
		}
		result.Attempts = append(result.Attempts, ExamRetirementAttempt{a.ID, a.Username, a.UID, a.State, a.Start, a.Deadline, a.OriginalDeadline, a.Protected, a.Checksum, a.AccessState})
	}
	rows, err := e.readRecoveryCatalog(state)
	if err != nil {
		return result, err
	}
	for _, row := range rows {
		if row.Exam != exam {
			continue
		}
		if row.Disposition != "revoked" && row.Disposition != "consumed" || row.PendingAllowanceRevision != nil {
			return result, fmt.Errorf("legacy permission %s/%s is unused, uncertain or pending; inspect recovery-grants and use reviewed cancellation only when unused", exam, row.Username)
		}
		if row.Disposition == "consumed" && !closedRetirementAttempt(state.Attempts[row.ConsumedBy]) {
			return result, errors.New("legacy consumption lacks closed native history; preserve markers and inspect recovery-grants")
		}
		result.Permissions = append(result.Permissions, ExamRetirementPermission{row.Username, row.UID, row.SourceAttempt, row.Checksum, row.Disposition})
	}
	retentions, err := e.readSourceRetentions()
	if err != nil {
		return result, err
	}
	root, err = readOnlyRoot(e.Config.State)
	if err != nil {
		return result, err
	}
	dir, dirErr := readOnlyOpenAt(root, "source-retentions", true)
	root.Close()
	if dirErr == nil {
		entries, scanErr := sourceRetentionEntries(dir, 10000)
		dir.Close()
		if scanErr != nil {
			return result, scanErr
		}
		for _, entry := range entries {
			if strings.HasPrefix(entry.Name(), ".pending-") {
				return result, errors.New("unpublished saved-source metadata remains; preserve it and inspect source-sync before native reconciliation")
			}
		}
	} else if !os.IsNotExist(dirErr) {
		return result, dirErr
	}
	for _, row := range retentions {
		if row.Plan.Exam != exam {
			continue
		}
		if row.Phase != "released" {
			return result, errors.New("saved-source retention remains retained/closing; inspect web grants source-show/source-sync before retirement; no source pin released")
		}
		for _, id := range row.Consumers {
			a := state.Attempts[id]
			if !closedRetirementAttempt(a) || a.Exam != exam {
				return result, errors.New("released source retention has missing or inconsistent consumer history; preserve all records and inspect source-show/native info")
			}
		}
		result.ReleasedRetentions++
	}
	if len(result.Attempts) > 1000 || len(result.Permissions) > 1000 || result.ReleasedRetentions > 1000 {
		return result, errors.New("exam inventory exceeds reconciliation bound; preserve history for bounded migration")
	}
	sort.Slice(result.Attempts, func(i, j int) bool { return result.Attempts[i].ID < result.Attempts[j].ID })
	sort.Slice(result.Permissions, func(i, j int) bool { return result.Permissions[i].Username < result.Permissions[j].Username })
	// Hash the complete state, including unrelated concurrent metadata changes.
	// A busy observation is retried, never interpreted as missing authority.
	result.StateHash = Hash(stateBytes)
	return result, nil
}

func ObserveExamRetirement(c Config, exam string) (ExamRetirementEvidence, error) {
	if !identifier.MatchString(exam) || !identifier.MatchString(c.AgentID) {
		return ExamRetirementEvidence{}, errors.New("choose exact native agent/exam; run examctl web help")
	}
	e := &Engine{Config: c}
	if _, err := e.recoveryRevocationState(); err != nil {
		return ExamRetirementEvidence{}, err
	}
	lock, err := e.recoveryCatalogLock()
	if err != nil {
		return ExamRetirementEvidence{}, err
	}
	defer lock.Close()
	first, err := e.retirementObservation(exam)
	if err != nil {
		return first, err
	}
	// A cancellation may have published just before its process crashed. Flush
	// the observed files and rename directories before acknowledging terminal
	// facts elsewhere; observing a visible envelope alone is not durability proof.
	if err := syncRetirementEvidence(c, exam); err != nil {
		return first, fmt.Errorf("native terminal evidence durability unconfirmed; preserve records and retry native-review: %w", err)
	}
	second, err := e.retirementObservation(exam)
	if err != nil {
		return second, err
	}
	a, _ := json.Marshal(first)
	b, _ := json.Marshal(second)
	if !bytes.Equal(a, b) {
		return first, errors.New("native dependencies changed during observation; preserve records and retry native-review, no reconciliation confirmed")
	}
	first.ObservedAt = Millis()
	data, err := json.Marshal(first)
	if err != nil {
		return first, err
	}
	if _, err := DecodeExamRetirementEvidence(data); err != nil {
		return first, err
	}
	return first, nil
}

func syncRetirementEvidence(c Config, exam string) error {
	root, err := readOnlyRoot(c.State)
	if err != nil {
		return err
	}
	defer root.Close()
	syncFile := func(parent *os.File, name string) error {
		f, err := readOnlyOpenAt(parent, name, false)
		if err != nil {
			return err
		}
		return errors.Join(f.Sync(), f.Close())
	}
	for _, name := range []string{"state.json", "initialized"} {
		if err := syncFile(root, name); err != nil {
			return err
		}
	}
	catalog, err := readOnlyOpenAt(root, "recovery-preparations", true)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	if catalog != nil {
		defer catalog.Close()
		dir, err := readOnlyOpenAt(catalog, exam, true)
		if err != nil && !os.IsNotExist(err) {
			return err
		}
		if dir != nil {
			defer dir.Close()
			entries, err := sourceRetentionEntries(dir, 20000)
			if err != nil {
				return err
			}
			for _, entry := range entries {
				if err := syncFile(dir, entry.Name()); err != nil {
					return err
				}
			}
			if err := dir.Sync(); err != nil {
				return err
			}
		}
		if err := catalog.Sync(); err != nil {
			return err
		}
	}
	retentions, err := readOnlyOpenAt(root, "source-retentions", true)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	if retentions != nil {
		defer retentions.Close()
		entries, err := sourceRetentionEntries(retentions, 10000)
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if err := syncFile(retentions, entry.Name()); err != nil {
				return err
			}
		}
		if err := retentions.Sync(); err != nil {
			return err
		}
	}
	return root.Sync()
}

func DecodeExamRetirementEvidence(data []byte) (ExamRetirementEvidence, error) {
	var r ExamRetirementEvidence
	if !validReadOnlyJSON(data) || decodeWorkerFrame(bytes.NewReader(data), 1024*1024, &r) != nil {
		return r, errors.New("invalid bounded native evidence; regenerate with web exams native-review, never edit its JSON")
	}
	canonical, _ := json.Marshal(r)
	var a, b any
	if json.Unmarshal(data, &a) != nil || json.Unmarshal(canonical, &b) != nil {
		return r, errReadOnlySnapshot
	}
	x, _ := json.Marshal(a)
	y, _ := json.Marshal(b)
	if !bytes.Equal(x, y) || r.Version != 1 || !identifier.MatchString(r.Agent) || !identifier.MatchString(r.Exam) || r.ObservedAt <= 0 || r.ObservedAt > 9007199254740991 || !templateDigest.MatchString(r.StateHash) || r.Attempts == nil || r.Permissions == nil || len(r.Attempts) > 1000 || len(r.Permissions) > 1000 || r.ReleasedRetentions < 0 || r.ReleasedRetentions > 1000 {
		return r, errReadOnlySnapshot
	}
	seen := map[string]bool{}
	for _, a := range r.Attempts {
		if seen[a.ID] || !attemptID.MatchString(a.ID) || !identifier.MatchString(a.Username) || a.UID < 1000 || a.UID > 2147483647 || a.Start < 0 || a.Start > 9007199254740991 || a.Deadline > 9007199254740991 || a.OriginalDeadline > 9007199254740991 {
			return r, errReadOnlySnapshot
		}
		seen[a.ID] = true
		if a.State == "CANCELLED_BEFORE_START" {
			if a.Start != 0 || a.Deadline != 0 || a.OriginalDeadline != 0 || a.Protected || a.Checksum != "" || (a.AccessState != "" && a.AccessState != "RELEASED" && a.AccessState != "OVERRIDDEN") {
				return r, errReadOnlySnapshot
			}
		} else if a.State != "COMPLETED" || a.Start <= 0 || a.Deadline <= a.Start || a.OriginalDeadline <= a.Start || !a.Protected || !templateDigest.MatchString(a.Checksum) || (a.AccessState != "RELEASED" && a.AccessState != "OVERRIDDEN") {
			return r, errReadOnlySnapshot
		}
	}
	seen = map[string]bool{}
	for _, p := range r.Permissions {
		if seen[p.Username] || !identifier.MatchString(p.Username) || p.UID < 1000 || p.UID > 2147483647 || !attemptID.MatchString(p.Source) || !templateDigest.MatchString(p.Checksum) || (p.Disposition != "revoked" && p.Disposition != "consumed") {
			return r, errReadOnlySnapshot
		}
		seen[p.Username] = true
	}
	return r, nil
}
