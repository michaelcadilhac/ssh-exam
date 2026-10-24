package core

// Root examctl source-sync is the runtime caller. Archive verification and
// durable publication run in that separate process, never the shared agent.
// Source deletion shares the existing catalog flock. Pins are data retention;
// they confer neither account reservation nor an execution interval.

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"syscall"
)

type SourceRetentionSource struct {
	Attempt  string `json:"attempt"`
	Checksum string `json:"checksum"`
}
type SourceRetentionPlan struct {
	Version         int                   `json:"version"`
	Agent           string                `json:"agent"`
	Grant           *GrantBinding         `json:"grant"`
	Exam            string                `json:"exam"`
	Username        string                `json:"username"`
	UID             int                   `json:"uid"`
	Settings        Settings              `json:"settings"`
	Source          SourceRetentionSource `json:"source"`
	Action          string                `json:"action"`
	CurrentRevision int64                 `json:"current_revision"`
	Status          string                `json:"status"`
}
type GrantSourceRetention struct {
	Version       int                  `json:"version"`
	Plan          SourceRetentionPlan  `json:"plan"`
	MetadataHash  string               `json:"metadata_hash"`
	RetentionHash string               `json:"retention_hash"`
	RetainedAt    int64                `json:"retained_at"`
	Phase         string               `json:"phase"`
	Consumers     []string             `json:"consumers"`
	Retirement    *SourceRetentionPlan `json:"retirement,omitempty"`
}

var errSourceRetention = errors.New("native saved-source retention is unavailable or unsafe; preserve source/catalog/consumer history; inspect examctl web grants source-show GRANT --revision N and retry source-sync only after repair; no fallback or clock authorized")

func ValidateSourceRetentionPlan(p SourceRetentionPlan, agent, id string, revision int64) error {
	if !validSourceRetentionPlan(p) || p.Agent != agent || p.Grant.ID != id || p.Grant.Revision != revision || p.Settings.Duration < 60 || p.Settings.Duration > 21600 || p.Settings.Earliest <= 0 || p.Settings.Latest <= p.Settings.Earliest || !validTemplateBinding(p.Settings) {
		return errSourceRetention
	}
	if _, err := limitsForSettings(p.Settings); err != nil {
		return err
	}
	return nil
}

func sourceRetentionName(id string, revision int64) string {
	return id + "-" + strconv.FormatInt(revision, 10) + ".json"
}
func sourceRetentionIdentity(p SourceRetentionPlan) string {
	p.Action, p.Status, p.CurrentRevision = "", "", 0
	b, _ := json.Marshal(p)
	return Hash(b)
}
func validSourceRetentionPlan(p SourceRetentionPlan) bool {
	return p.Version == 1 && identifier.MatchString(p.Agent) && validGrant(p.Grant) && p.Grant.Work != nil && p.Grant.Work.Kind == "saved" && identifier.MatchString(p.Exam) && p.Settings.ID == p.Exam && identifier.MatchString(p.Username) && p.UID >= 1000 && p.Grant.Work.Attempt == p.Source.Attempt && p.Grant.Work.Checksum == p.Source.Checksum && p.CurrentRevision >= p.Grant.Revision && p.CurrentRevision <= 9007199254740991 && (p.Action == "retain" || p.Action == "release") && (p.Status == "PENDING_NATIVE" || p.Status == "AVAILABLE" || p.Status == "REVOKED" || p.Status == "CONSUMED") && (p.Action != "retain" || (p.CurrentRevision == p.Grant.Revision && (p.Status == "PENDING_NATIVE" || p.Status == "AVAILABLE"))) && (p.Action != "release" || p.CurrentRevision > p.Grant.Revision || p.Status == "REVOKED" || p.Status == "CONSUMED")
}
func validSourceRetention(r GrantSourceRetention) bool {
	if r.Version != 1 || !validSourceRetentionPlan(r.Plan) || !templateDigest.MatchString(r.MetadataHash) || r.RetainedAt <= 0 || (r.Phase != "retained" && r.Phase != "closing" && r.Phase != "released") || r.Consumers == nil || len(r.Consumers) > 1000 {
		return false
	}
	expected := Hash([]byte(fmt.Sprintf("%s\x00%s\x00%d", sourceRetentionIdentity(r.Plan), r.MetadataHash, r.RetainedAt)))
	if r.RetentionHash != expected {
		return false
	}
	if r.Phase == "retained" && r.Retirement != nil {
		return false
	}
	if r.Phase != "retained" && (r.Retirement == nil || !validSourceRetentionPlan(*r.Retirement) || r.Retirement.Action != "release" || sourceRetentionIdentity(*r.Retirement) != sourceRetentionIdentity(r.Plan)) {
		return false
	}
	seen := map[string]bool{}
	for _, id := range r.Consumers {
		if !attemptID.MatchString(id) || seen[id] {
			return false
		}
		seen[id] = true
	}
	return true
}

func decodeSourceRetention(data []byte) (*GrantSourceRetention, error) {
	var row GrantSourceRetention
	if !validReadOnlyJSON(data) || decodeWorkerFrame(bytes.NewReader(data), 65536, &row) != nil || !validSourceRetention(row) {
		return nil, errSourceRetention
	}
	// All v1 writers serialize this same complete shape. Exact recursively named
	// keys reject case aliases/omissions which Go's usual JSON decoder accepts.
	canonical, _ := json.Marshal(row)
	var rawShape, canonicalShape any
	if json.Unmarshal(data, &rawShape) != nil || json.Unmarshal(canonical, &canonicalShape) != nil || !reflect.DeepEqual(rawShape, canonicalShape) {
		return nil, errSourceRetention
	}
	return &row, nil
}

func (e *Engine) verifySourceRetentionArchive(a *Attempt) (*Manifest, error) {
	if a == nil || !attemptID.MatchString(a.ID) {
		return nil, errSourceRetention
	}
	root, err := readOnlyRoot(e.Config.State)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	submissions, err := readOnlyOpenAt(root, "submissions", true)
	if err != nil {
		return nil, err
	}
	defer submissions.Close()
	dir, err := readOnlyOpenAt(submissions, a.ID, true)
	if err != nil {
		return nil, err
	}
	defer dir.Close()
	limits, err := limitsForSettings(a.Settings)
	if err != nil {
		return nil, err
	}
	for name, bound := range map[string]int64{"manifest.json": 4 * 1024 * 1024, "archive.sha256": 4096, "submission.tar.gz": limits.Total + 64*mib} {
		file, err := readOnlyOpenAt(dir, name, false)
		if err != nil {
			return nil, err
		}
		metadata, statErr := file.Stat()
		file.Close()
		if statErr != nil || !metadata.Mode().IsRegular() || metadata.Mode().Perm()&0022 != 0 || metadata.Size() > bound || metadata.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) || metadata.Sys().(*syscall.Stat_t).Nlink != 1 {
			return nil, errSourceRetention
		}
	}
	// Preserve the pinned directory across full streaming hash/manifest checks.
	return ReadProtected(fmt.Sprintf("/proc/self/fd/%d/.", dir.Fd()), a)
}

func sourceRetentionEntries(dir *os.File, limit int) ([]os.DirEntry, error) {
	if err := readOnlyPrivateDir(dir); err != nil {
		return nil, err
	}
	entries, err := dir.ReadDir(limit + 1)
	if err != nil && err != io.EOF {
		return nil, err
	}
	if len(entries) > limit {
		return nil, errSourceRetention
	}
	return entries, nil
}

func (e *Engine) readSourceRetentions() ([]GrantSourceRetention, error) {
	state, err := readOnlyRoot(e.Config.State)
	if err != nil {
		return nil, err
	}
	defer state.Close()
	entries, err := sourceRetentionEntries(state, 20000)
	if err != nil {
		return nil, err
	}
	known := map[string]bool{}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), "source-retention-known-") {
			known[strings.TrimPrefix(entry.Name(), "source-retention-known-")] = true
		}
	}
	dir, err := readOnlyOpenAt(state, "source-retentions", true)
	if os.IsNotExist(err) {
		initialized, markerErr := e.workspaceRetentionMarker("source-retentions-initialized", []byte("Saved-source retention catalog v1\n"), false)
		if markerErr != nil || initialized || len(known) > 0 {
			return nil, errSourceRetention
		}
		return []GrantSourceRetention{}, nil
	}
	if err != nil {
		return nil, errSourceRetention
	}
	defer dir.Close()
	names, err := sourceRetentionEntries(dir, 10000)
	if err != nil {
		return nil, err
	}
	rows := []GrantSourceRetention{}
	var total int
	for _, entry := range names {
		if strings.HasPrefix(entry.Name(), ".pending-") {
			continue
		} // Never acknowledged or positive authority.
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			return nil, errSourceRetention
		}
		data, err := privateControlFile(dir, entry.Name(), 65536)
		if err != nil {
			return nil, errSourceRetention
		}
		total += len(data)
		if total > 16*1024*1024 {
			return nil, errSourceRetention
		}
		decoded, err := decodeSourceRetention(data)
		if err != nil || entry.Name() != sourceRetentionName(decoded.Plan.Grant.ID, decoded.Plan.Grant.Revision) {
			return nil, errSourceRetention
		}
		row := *decoded
		if _, err := e.workspaceRetentionMarker("source-retention-known-"+entry.Name(), []byte(sourceRetentionIdentity(row.Plan)+"\n"), false); err != nil {
			return nil, errSourceRetention
		}
		delete(known, entry.Name())
		rows = append(rows, row)
	}
	if len(known) > 0 {
		return nil, errSourceRetention
	} // Missing known record is never absence.
	return rows, nil
}

func (e *Engine) publishSourceRetention(r GrantSourceRetention) error {
	if !validSourceRetention(r) {
		return errSourceRetention
	}
	parent := filepath.Join(e.Config.State, "source-retentions")
	if err := os.Mkdir(parent, 0700); err != nil && !os.IsExist(err) {
		return err
	}
	state, err := readOnlyRoot(e.Config.State)
	if err != nil {
		return err
	}
	defer state.Close()
	dir, err := readOnlyOpenAt(state, "source-retentions", true)
	if err != nil {
		return err
	}
	defer dir.Close()
	if _, err := sourceRetentionEntries(dir, 10000); err != nil {
		return err
	}
	data, _ := json.Marshal(r)
	file, err := os.CreateTemp(parent, ".pending-")
	if err != nil {
		return err
	}
	name := file.Name()
	defer os.Remove(name)
	if _, err = file.Write(data); err == nil {
		err = file.Sync()
	}
	closed := file.Close()
	if err == nil {
		err = closed
	}
	if err != nil {
		return err
	}
	if err = os.Rename(name, filepath.Join(parent, sourceRetentionName(r.Plan.Grant.ID, r.Plan.Grant.Revision))); err != nil {
		return err
	}
	directory, err := os.Open(parent)
	if err != nil {
		return err
	}
	err = directory.Sync()
	directory.Close()
	if err != nil {
		return err
	}
	if _, err = e.workspaceRetentionMarker("source-retentions-initialized", []byte("Saved-source retention catalog v1\n"), true); err != nil {
		return err
	}
	_, err = e.workspaceRetentionMarker("source-retention-known-"+sourceRetentionName(r.Plan.Grant.ID, r.Plan.Grant.Revision), []byte(sourceRetentionIdentity(r.Plan)+"\n"), true)
	return err
}

func (e *Engine) SourceRetention(id string, revision int64) (*GrantSourceRetention, error) {
	if !attemptID.MatchString(id) || revision < 1 {
		return nil, errSourceRetention
	}
	lock, err := e.recoveryCatalogLock()
	if err != nil {
		return nil, err
	}
	defer lock.Close()
	rows, err := e.readSourceRetentions()
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		if row.Plan.Grant.ID == id && row.Plan.Grant.Revision == revision {
			return &row, nil
		}
	}
	return nil, errSourceRetention
}

func (e *Engine) RetainGrantSource(plan SourceRetentionPlan) (*GrantSourceRetention, error) {
	if !validSourceRetentionPlan(plan) || plan.Agent != e.Config.AgentID || plan.Action != "retain" {
		return nil, errSourceRetention
	}
	lock, err := e.recoveryCatalogLock()
	if err != nil {
		return nil, err
	}
	defer lock.Close()
	rows, err := e.readSourceRetentions()
	if err != nil {
		return nil, err
	}
	var previous *GrantSourceRetention
	for _, row := range rows {
		if row.Plan.Grant.ID == plan.Grant.ID && row.Plan.Grant.Revision == plan.Grant.Revision {
			copy := row
			previous = &copy
		}
	}
	if previous != nil && (sourceRetentionIdentity(previous.Plan) != sourceRetentionIdentity(plan) || previous.Phase != "retained") {
		return nil, errSourceRetention
	}
	state, err := readStateSnapshot(e.Config.State)
	if err != nil {
		return nil, err
	}
	source := state.Attempts[plan.Source.Attempt]
	if source == nil || source.State != "COMPLETED" || !source.Protected || source.Checksum != plan.Source.Checksum || source.Username != plan.Username || source.UID != plan.UID {
		return nil, errSourceRetention
	}
	manifest, err := e.verifySourceRetentionArchive(source)
	if err != nil {
		return nil, fmt.Errorf("%w: protected source verification: %v", errSourceRetention, err)
	}
	if previous != nil {
		if previous.MetadataHash != manifest.metadataHash {
			return nil, errSourceRetention
		}
		if err := e.publishSourceRetention(*previous); err != nil {
			return nil, err
		}
		return previous, nil // Original receipt/age survives a lost reply or restart.
	}
	r := GrantSourceRetention{Version: 1, Plan: plan, MetadataHash: manifest.metadataHash, RetainedAt: Millis(), Phase: "retained", Consumers: []string{}}
	r.RetentionHash = Hash([]byte(fmt.Sprintf("%s\x00%s\x00%d", sourceRetentionIdentity(plan), r.MetadataHash, r.RetainedAt)))
	if err := e.appendNativeManagementAudit(map[string]any{"action": "retain-grant-source", "grant": plan.Grant.ID, "revision": plan.Grant.Revision, "source": source.ID, "at": r.RetainedAt}); err != nil {
		return nil, err
	}
	if err := e.publishSourceRetention(r); err != nil {
		return nil, err
	}
	return &r, nil
}

func (e *Engine) checkGrantSourceDependencies(source string) error {
	rows, err := e.readSourceRetentions()
	if err != nil {
		return err
	}

	for _, row := range rows {
		if row.Plan.Source.Attempt == source && row.Phase != "released" {
			return fmt.Errorf("submission retained by saved-source grant %s revision %d (%s); inspect examctl web grants source-show and source-sync; a timeout never releases this dependency", row.Plan.Grant.ID, row.Plan.Grant.Revision, row.Phase)
		}
	}
	return nil
}

// Existing preparation caller registers the UUID BEFORE canonical allocation.
// A closing pin cannot gain another consumer; no account/clock is created here.
func (e *Engine) registerGrantSourceConsumer(r Request) error {
	if r.Grant == nil || r.Grant.Work == nil || r.Grant.Work.Kind != "saved" {
		return nil
	}
	lock, err := e.recoveryCatalogLock()
	if err != nil {
		return err
	}
	defer lock.Close()
	rows, err := e.readSourceRetentions()
	if err != nil {
		return err
	}
	state, err := readStateSnapshot(e.Config.State)
	if err != nil {
		return err
	}
	if existing := state.Attempts[r.ID]; existing != nil {
		if existing.Exam != r.Exam || existing.Username != r.Username || existing.UID != r.UID || !sameGrant(existing.Grant, r.Grant) {
			return errSourceRetention
		}
	} else {
		for _, path := range []string{e.workspaceBase(r.ID), filepath.Join(e.Config.State, "submissions", r.ID)} {
			if _, err := os.Lstat(path); !os.IsNotExist(err) {
				return errSourceRetention
			}
		}
	}
	for _, row := range rows {
		for _, id := range row.Consumers {
			if id == r.ID && !sameGrant(row.Plan.Grant, r.Grant) {
				return errSourceRetention
			}
		}
	}
	for _, row := range rows {
		if row.Plan.Grant.ID != r.Grant.ID || row.Plan.Grant.Revision != r.Grant.Revision {
			continue
		}
		if row.Phase != "retained" || !sameGrant(row.Plan.Grant, r.Grant) || row.Plan.Exam != r.Exam || row.Plan.Username != r.Username || row.Plan.UID != r.UID || row.Plan.Settings != r.Settings {
			return errSourceRetention
		}
		for _, id := range row.Consumers {
			if id == r.ID {
				return nil
			}
		}
		if !attemptID.MatchString(r.ID) || len(row.Consumers) >= 1000 {
			return errSourceRetention
		}
		row.Consumers = append(row.Consumers, r.ID)
		if err := e.appendNativeManagementAudit(map[string]any{"action": "register-grant-source-consumer", "grant": r.Grant.ID, "revision": r.Grant.Revision, "attempt": r.ID, "at": Millis()}); err != nil {
			return err
		}
		return e.publishSourceRetention(row)
	}
	return errSourceRetention
}

// Exact bounded private metadata only. Staging/Begin already hold their native
// fences; do not invert them by taking the catalog lock under shared state.
// A recorded consumer keeps the archive pinned throughout cancellation/repair.
func (e *Engine) grantSourceForAttempt(a *Attempt) (*GrantSourceRetention, error) {
	if a == nil || !validGrant(a.Grant) || a.Grant.Work == nil || a.Grant.Work.Kind != "saved" {
		return nil, errSourceRetention
	}
	root, err := readOnlyRoot(e.Config.State)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	dir, err := readOnlyOpenAt(root, "source-retentions", true)
	if err != nil {
		return nil, err
	}
	defer dir.Close()
	data, err := privateControlFile(dir, sourceRetentionName(a.Grant.ID, a.Grant.Revision), 65536)
	if err != nil {
		return nil, errSourceRetention
	}
	row, err := decodeSourceRetention(data)
	if err != nil || !sameGrant(row.Plan.Grant, a.Grant) || row.Plan.Exam != a.Exam || row.Plan.Username != a.Username || row.Plan.UID != a.UID || row.Plan.Settings != a.Settings || row.Phase == "released" || (row.Phase == "closing" && a.Start == 0) {
		return nil, errSourceRetention
	}
	known, err := e.workspaceRetentionMarker("source-retention-known-"+sourceRetentionName(a.Grant.ID, a.Grant.Revision), []byte(sourceRetentionIdentity(row.Plan)+"\n"), false)
	if err != nil || !known {
		return nil, errSourceRetention
	}
	initialized, err := e.workspaceRetentionMarker("source-retentions-initialized", []byte("Saved-source retention catalog v1\n"), false)
	if err != nil || !initialized {
		return nil, errSourceRetention
	}
	for _, id := range row.Consumers {
		if id == a.ID {
			return row, nil
		}
	}
	return nil, errSourceRetention
}

// Release is a separate positively authorized reconciliation, never expiry.
// An unresolved/missing consumer refuses; the existing cancel-absent workflow
// may establish its exact durable no-start tombstone after contradiction checks.
func (e *Engine) ReleaseGrantSource(plan SourceRetentionPlan) (*GrantSourceRetention, error) {
	if !validSourceRetentionPlan(plan) || plan.Agent != e.Config.AgentID || plan.Action != "release" {
		return nil, errSourceRetention
	}
	lock, err := e.recoveryCatalogLock()
	if err != nil {
		return nil, err
	}
	defer lock.Close()
	rows, err := e.readSourceRetentions()
	if err != nil {
		return nil, err
	}
	var row *GrantSourceRetention
	for _, candidate := range rows {
		if candidate.Plan.Grant.ID == plan.Grant.ID && candidate.Plan.Grant.Revision == plan.Grant.Revision {
			copy := candidate
			row = &copy
		}
	}
	if row == nil || sourceRetentionIdentity(row.Plan) != sourceRetentionIdentity(plan) {
		return nil, errSourceRetention
	}
	if row.Phase == "released" {
		if err := e.publishSourceRetention(*row); err != nil {
			return nil, err
		}
		return row, nil
	}
	row.Retirement = &plan
	row.Phase = "closing"
	if err := e.publishSourceRetention(*row); err != nil {
		return nil, err
	}
	state, err := readStateSnapshot(e.Config.State)
	if err != nil {
		return nil, err
	}
	known := map[string]bool{}
	for _, id := range row.Consumers {
		known[id] = true
	}
	for id, a := range state.Attempts {
		if a.Grant != nil && a.Grant.ID == plan.Grant.ID && a.Grant.Revision == plan.Grant.Revision && !known[id] {
			return nil, fmt.Errorf("%w: unregistered native consumer %s; preserve every workspace/submission and inspect the original grant", errSourceRetention, id)
		}
	}
	for _, id := range row.Consumers {
		a := state.Attempts[id]
		if a == nil || a.Username != plan.Username || a.UID != plan.UID || a.Exam != plan.Exam {
			return nil, fmt.Errorf("%w: consumer %s missing/mismatched; inspect original authority; absence alone is not no-start proof", errSourceRetention, id)
		}
		if a.State == "COMPLETED" && a.Protected && sameGrant(a.Grant, plan.Grant) {
			if _, err := e.verifySourceRetentionArchive(a); err != nil {
				return nil, fmt.Errorf("%w: consumer %s archive verification: %v", errSourceRetention, id, err)
			}
			continue
		}
		if a.State != "CANCELLED_BEFORE_START" || !a.CancellationCleanupComplete || a.Start != 0 || a.Deadline != 0 || a.OriginalDeadline != 0 || a.Protected || a.Checksum != "" || a.RegisteredOwner != nil || a.GrantBeginIntent != "" || len(a.ClockResets) > 0 || (a.Grant != nil && !sameGrant(a.Grant, plan.Grant)) {
			return nil, fmt.Errorf("%w: consumer %s has no verified finished/no-start outcome; complete its existing collection/cancellation workflow", errSourceRetention, id)
		}
		for _, path := range []string{e.workspaceBase(id), filepath.Join(e.Config.State, "submissions", id)} {
			if _, err := os.Lstat(path); !os.IsNotExist(err) {
				return nil, fmt.Errorf("%w: consumer %s retains contradictory work/submission evidence", errSourceRetention, id)
			}
		}
		if _, err := e.readRecoveryConsumption(&Attempt{Exam: a.Exam, Username: a.Username}); !os.IsNotExist(err) {
			return nil, fmt.Errorf("%w: consumer %s has contradictory saved-work consumption evidence", errSourceRetention, id)
		}
	}
	if err := e.appendNativeManagementAudit(map[string]any{"action": "release-grant-source", "grant": plan.Grant.ID, "revision": plan.Grant.Revision, "source": plan.Source.Attempt, "at": Millis()}); err != nil {
		return nil, err
	}
	row.Phase = "released"
	if err := e.publishSourceRetention(*row); err != nil {
		return nil, err
	}
	return row, nil
}
