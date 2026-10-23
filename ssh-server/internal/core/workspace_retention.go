package core

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"unicode/utf8"

	"golang.org/x/sys/unix"
)

// Separate from state.json: an older native writer must not silently discard a
// new operator hold while saving an unrelated lease. No student/native RPC
// exposes these local root management operations.
type WorkspaceHold struct {
	Version      int    `json:"version"`
	Attempt      string `json:"attempt"`
	Exam         string `json:"exam"`
	Username     string `json:"username"`
	UID          int    `json:"uid"`
	Revision     int64  `json:"revision"`
	Held         bool   `json:"held"`
	Reason       string `json:"reason"`
	UpdatedAt    int64  `json:"updated_at"`
	ActorUID     int    `json:"actor_uid"`
	EffectiveUID int    `json:"effective_uid"`
}

type WorkspacePathIdentity struct {
	Exists    bool   `json:"exists"`
	Directory bool   `json:"directory"`
	Symlink   bool   `json:"symlink"`
	Device    string `json:"device,omitempty"`
	Inode     string `json:"inode,omitempty"`
	OwnerUID  uint32 `json:"owner_uid"`
	Mode      string `json:"mode,omitempty"`
}
type WorkspaceRetentionStatus struct {
	Attempt           string                `json:"attempt"`
	Exam              string                `json:"exam"`
	Username          string                `json:"username"`
	UID               int                   `json:"uid"`
	State             string                `json:"state"`
	Start             int64                 `json:"start"`
	Ended             int64                 `json:"ended"`
	Deadline          int64                 `json:"deadline"`
	OriginalDeadline  int64                 `json:"original_deadline"`
	AccessState       string                `json:"access_state"`
	PolicyState       string                `json:"policy_state"`
	PolicyError       string                `json:"policy_error"`
	AccessError       string                `json:"access_error"`
	RecordedProtected bool                  `json:"recorded_protected"`
	Checksum          string                `json:"checksum"`
	Path              string                `json:"path"`
	Base              WorkspacePathIdentity `json:"base"`
	Work              WorkspacePathIdentity `json:"work"`
	Hold              WorkspaceHold         `json:"hold"`
	Candidate         bool                  `json:"candidate"`
	Eligible          bool                  `json:"eligible"`
	ArchiveVerified   bool                  `json:"archive_verified"`
	Blockers          []string              `json:"blockers"`
	Note              string                `json:"note"`
}

func (e *Engine) workspaceRetentionDirectory() string {
	return filepath.Join(e.Config.State, "workspace-retention")
}

func (e *Engine) workspaceRetentionMarker(name string, expected []byte, create bool) (bool, error) {
	path := filepath.Join(e.Config.State, name)
	f, err := os.OpenFile(path, os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	if os.IsNotExist(err) && create {
		out, writeErr := os.CreateTemp(e.Config.State, ".workspace-retention-marker-")
		if writeErr != nil {
			return false, writeErr
		}
		defer os.Remove(out.Name()) // Exact unpublished marker created here only.
		_, writeErr = out.Write(expected)
		if writeErr == nil {
			writeErr = out.Sync()
		}
		closeErr := out.Close()
		if writeErr != nil {
			return false, writeErr
		}
		if closeErr != nil {
			return false, closeErr
		}
		if err := unix.Renameat2(unix.AT_FDCWD, out.Name(), unix.AT_FDCWD, path, unix.RENAME_NOREPLACE); err != nil {
			if errors.Is(err, syscall.EEXIST) {
				present, checkErr := e.workspaceRetentionMarker(name, expected, false)
				if checkErr != nil {
					return false, checkErr
				}
				if !present {
					return false, errors.New("retention marker changed during publication; retry without changing holds")
				}
			} else {
				return false, err
			}
		}
		if err := syncDirectory(e.Config.State); err != nil {
			return false, err
		}
		return true, nil
	}
	if os.IsNotExist(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 || info.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) || info.Sys().(*syscall.Stat_t).Nlink != 1 || info.Size() > 4096 {
		return false, errors.New("unsafe workspace retention loss-detection marker; preserve metadata and do not clear holds")
	}
	b, err := io.ReadAll(io.LimitReader(f, 4097))
	if err != nil {
		return false, err
	}
	if !bytes.Equal(b, expected) {
		return false, errors.New("workspace retention initialization/identity marker changed; preserve metadata and restore verified backup")
	}
	if create {
		if err := syncDirectory(e.Config.State); err != nil {
			return false, err
		}
	}
	return true, nil
}
func (e *Engine) workspaceRetentionGlobalMarker(create bool) (bool, error) {
	return e.workspaceRetentionMarker("workspace-retention.initialized", []byte("ssh-exam/workspace-retention/v1\n"), create)
}
func (e *Engine) workspaceRetentionKnownMarker(a *Attempt, create bool) (bool, error) {
	b, err := json.Marshal(struct {
		Version                 int
		Attempt, Exam, Username string
		UID                     int
	}{1, a.ID, a.Exam, a.Username, a.UID})
	if err != nil {
		return false, err
	}
	return e.workspaceRetentionMarker("workspace-retention-"+a.ID+".known", b, create)
}

func (e *Engine) readWorkspaceHold(a *Attempt) (WorkspaceHold, error) {
	h := WorkspaceHold{Version: 1, Attempt: a.ID, Exam: a.Exam, Username: a.Username, UID: a.UID}
	initialized, err := e.workspaceRetentionGlobalMarker(false)
	if err != nil {
		return h, err
	}
	known, err := e.workspaceRetentionKnownMarker(a, false)
	if err != nil {
		return h, err
	}
	parent := e.workspaceRetentionDirectory()
	if _, err := os.Lstat(parent); os.IsNotExist(err) {
		if initialized || known {
			return h, errors.New("workspace retention directory disappeared after initialization; all cleanup/hold changes refused until verified metadata is restored")
		}
		return h, nil
	} else if err != nil {
		return h, err
	}
	if err := privateWorkspaceDirectory(parent); err != nil {
		return h, fmt.Errorf("unsafe workspace retention metadata; preserve it and inspect the private backup: %w", err)
	}
	root, err := os.OpenRoot(parent)
	if err != nil {
		return h, err
	}
	defer root.Close()
	f, err := root.OpenFile(a.ID+".json", os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	if os.IsNotExist(err) {
		if known {
			return h, errors.New("known workspace hold record is missing; preserve the workspace and restore verified metadata, never assume the hold was released")
		}
		return h, nil
	}
	if err != nil {
		return h, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 || info.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) || info.Sys().(*syscall.Stat_t).Nlink != 1 || info.Size() > 16384 {
		return h, errors.New("unsafe workspace hold record; no cleanup or hold replacement is permitted")
	}
	var stored WorkspaceHold
	b, readErr := io.ReadAll(io.LimitReader(f, 16385))
	var fields map[string]json.RawMessage
	required := []string{"version", "attempt", "exam", "username", "uid", "revision", "held", "reason", "updated_at", "actor_uid", "effective_uid"}
	valid := readErr == nil && len(b) <= 16384 && utf8.Valid(b) && validReadOnlyJSON(b) && json.Unmarshal(b, &fields) == nil && len(fields) == len(required)
	if valid {
		for _, name := range required {
			value, present := fields[name]
			if !present || bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
				valid = false
				break
			}
		}
	}
	// Existing v1 writers serialize every field, including false/zero values.
	// Absence/null/duplicate/case aliases must never default a hold to released.
	if !valid || decodeWorkerFrame(bytes.NewReader(b), 16384, &stored) != nil {
		return h, errors.New("workspace hold record is malformed; preserve it and restore verified metadata before changing retention")
	}
	if stored.Version != 1 || stored.Attempt != a.ID || stored.Exam != a.Exam || stored.Username != a.Username || stored.UID != a.UID || stored.Revision <= 0 || stored.UpdatedAt <= 0 || len(stored.Reason) < 8 || len(stored.Reason) > 1000 || stored.ActorUID < 0 || stored.EffectiveUID < 0 {
		return h, errors.New("workspace hold record identity/revision is invalid; no cleanup or replacement is permitted")
	}
	return stored, nil
}

func workspacePathIdentity(root *os.Root, name string) (WorkspacePathIdentity, error) {
	var v WorkspacePathIdentity
	info, err := root.Lstat(name)
	if os.IsNotExist(err) {
		return v, nil
	}
	if err != nil {
		return v, err
	}
	s := info.Sys().(*syscall.Stat_t)
	v = WorkspacePathIdentity{Exists: true, Directory: info.IsDir(), Symlink: info.Mode()&os.ModeSymlink != 0,
		Device: strconv.FormatUint(uint64(s.Dev), 10), Inode: strconv.FormatUint(s.Ino, 10), OwnerUID: s.Uid, Mode: fmt.Sprintf("%04o", info.Mode().Perm())}
	return v, nil
}

// Metadata only. An apparent candidate is NEVER proof of cleanup eligibility.
// No archive hashing, recursive traversal, /proc scan, unit termination or delete.
func (e *Engine) workspaceRetentionStatus(a *Attempt) (WorkspaceRetentionStatus, error) {
	h, err := e.readWorkspaceHold(a)
	if err != nil {
		return WorkspaceRetentionStatus{}, err
	}
	v := WorkspaceRetentionStatus{Attempt: a.ID, Exam: a.Exam, Username: a.Username, UID: a.UID, State: a.State, Start: a.Start, Ended: a.Ended,
		Deadline: a.Deadline, OriginalDeadline: a.OriginalDeadline, AccessState: a.AccessState,
		PolicyState: a.PolicyState, PolicyError: a.PolicyError[:min(len(a.PolicyError), 1500)], AccessError: a.AccessError[:min(len(a.AccessError), 1500)],
		RecordedProtected: a.Protected, Checksum: a.Checksum, Path: e.workspaceBase(a.ID), Hold: h, Blockers: []string{},
		Note: "Recorded metadata only, not fresh protected-copy/writer/mount/process-use verification. No cleanup command is enabled. Holds never change deadlines/access; no automatic cleanup or grace period."}
	if h.Revision > 0 {
		initialized, err := e.workspaceRetentionGlobalMarker(false)
		if err != nil {
			return v, err
		}
		known, err := e.workspaceRetentionKnownMarker(a, false)
		if err != nil {
			return v, err
		}
		if !initialized || !known {
			v.Blockers = append(v.Blockers, "Retention loss-detection publication is incomplete; inspect/reaffirm the hold with its current revision before considering cleanup")
		}
	}
	if h.Held {
		v.Blockers = append(v.Blockers, "Administrator workspace hold is active; review its reason before an explicit revision-fenced release-hold")
	}
	if a.State != "COMPLETED" || a.Start <= 0 || a.Ended <= 0 || !a.Protected || len(a.Checksum) != 64 {
		v.Blockers = append(v.Blockers, "Requires COMPLETED, recorded start/end and a protected checksum; preserve active/paused/preparing/failed or historically uncertain work and inspect examctl info "+a.ID)
	}
	if len(a.Units) > 0 {
		v.Blockers = append(v.Blockers, "Recorded workload units remain; do not interrupt exams or treat an archive as termination proof")
	}
	if a.PolicyState == "RESTORE_FAILED" || a.PolicyError != "" || a.AccessError != "" {
		v.Blockers = append(v.Blockers, "Account restoration/access errors remain; inspect native info and repair without deleting recovery work")
	}
	if a.WorkPath != "" && filepath.Clean(a.WorkPath) != filepath.Join(e.Config.Work, a.ID, "work") {
		v.Blockers = append(v.Blockers, "Recorded work path differs from the exact configured attempt target; preserve it for investigation")
	}
	if !filepath.IsAbs(e.Config.Work) || filepath.Clean(e.Config.Work) != e.Config.Work || e.Config.Work == "/" {
		return v, errors.New("unsafe configured workspace root; preserve data and inspect configuration")
	}
	info, err := os.Lstat(e.Config.Work)
	if err != nil {
		v.Blockers = append(v.Blockers, "Workspace root unavailable: "+err.Error())
		return v, nil
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || info.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) || info.Mode().Perm()&0022 != 0 {
		return v, errors.New("workspace root must be a real agent-owned directory without group/world write access")
	}
	root, err := os.OpenRoot(e.Config.Work)
	if err != nil {
		return v, err
	}
	defer root.Close()
	v.Base, err = workspacePathIdentity(root, a.ID)
	if err != nil {
		return v, err
	}
	if !v.Base.Exists {
		v.Blockers = append(v.Blockers, "Attempt workspace is absent; this is not a verified cleanup receipt")
		return v, nil
	}
	if !v.Base.Directory || v.Base.Symlink || v.Base.OwnerUID != uint32(os.Geteuid()) {
		v.Blockers = append(v.Blockers, "Unsafe/non-agent-owned attempt directory; do not follow or delete it")
		return v, nil
	}
	// Do not traverse an unsafe parent, even when os.Root could contain a link.
	baseInfo, err := root.Lstat(a.ID)
	if err != nil {
		return v, err
	}
	if baseInfo.Mode().Perm()&0077 != 0 {
		v.Blockers = append(v.Blockers, "Attempt directory is not private; fresh ownership/use investigation is required")
		return v, nil
	}
	v.Work, err = workspacePathIdentity(root, filepath.Join(a.ID, "work"))
	if err != nil {
		return v, err
	}
	if !v.Work.Exists || !v.Work.Directory || v.Work.Symlink {
		v.Blockers = append(v.Blockers, "Published work directory is absent/unsafe; preserve private staging and investigate repair")
	}
	staged, err := workspacePathIdentity(root, filepath.Join(a.ID, "workspace-ready", "work"))
	if err != nil {
		return v, err
	}
	if staged.Exists {
		v.Blockers = append(v.Blockers, "Unpublished private work remains; preserve the staging receipt and investigate workspace repair")
	}
	v.Candidate = len(v.Blockers) == 0
	return v, nil
}

func (e *Engine) WorkspaceRetention(id string) (WorkspaceRetentionStatus, error) {
	if !attemptID.MatchString(id) {
		return WorkspaceRetentionStatus{}, errors.New("expected an exact attempt UUID from examctl list")
	}
	lock, err := e.attemptCollectionLock(id)
	if err != nil {
		if errors.Is(err, errCollectionPending) {
			return WorkspaceRetentionStatus{}, errors.New("attempt job is busy; workspace inspection did not complete. Retry examctl workspaces show after collection/staging settles")
		}
		return WorkspaceRetentionStatus{}, err
	}
	defer lock.Close()
	var snapshot Attempt
	if err := e.WithState(func() error {
		a, err := e.Find(id)
		if err == nil && a.ID != id {
			return errors.New("workspace attempt identity mismatch; preserve native records")
		}
		if err == nil {
			snapshot = *a
		}
		return err
	}); err != nil {
		return WorkspaceRetentionStatus{}, err
	}
	return e.workspaceRetentionStatus(&snapshot)
}

type WorkspaceRetentionPage struct {
	Workspaces []WorkspaceRetentionStatus `json:"workspaces"`
	Next       string                     `json:"next,omitempty"`
	Note       string                     `json:"note"`
}

func (e *Engine) WorkspaceRetentions(exam, after string, limit int) (WorkspaceRetentionPage, error) {
	page := WorkspaceRetentionPage{Workspaces: []WorkspaceRetentionStatus{}, Note: "Known native attempts only; unknown/orphan folders stay preserved. ID order is not chronological. Candidate is not eligibility; no deletion is enabled."}
	if (exam != "" && !identifier.MatchString(exam)) || (after != "" && !attemptID.MatchString(after)) || limit < 1 || limit > 200 {
		return page, errors.New("list requires optional exam ID/attempt UUID cursor and --limit 1..200")
	}
	var attempts []Attempt
	if err := e.WithState(func() error {
		ids := []string{}
		for id, a := range e.state.Attempts {
			if a.ID != id {
				return errors.New("workspace attempt identity mismatch; preserve native records")
			}
			if id > after && (exam == "" || a.Exam == exam) {
				ids = append(ids, id)
			}
		}
		sort.Strings(ids)
		if len(ids) > limit {
			page.Next = ids[limit-1]
			ids = ids[:limit]
		}
		for _, id := range ids {
			attempts = append(attempts, *e.state.Attempts[id])
		}
		return nil
	}); err != nil {
		return page, err
	}
	for _, a := range attempts {
		if !attemptID.MatchString(a.ID) {
			return page, errors.New("unsafe historical attempt identity; preserve workspace and inspect native history")
		}
		v, err := e.workspaceRetentionStatus(&a)
		if err != nil {
			return page, fmt.Errorf("inspect workspace %s individually; inventory refused: %w", a.ID, err)
		}
		page.Workspaces = append(page.Workspaces, v)
	}
	return page, nil
}

// Returning/fsynced audit is required for operator holds. Native Audit is best
// effort and must not turn an audit failure into an acknowledged hold release.
func (e *Engine) auditWorkspaceRetention(action string, a *Attempt, reason string, revision int64) error {
	return e.appendNativeManagementAudit(map[string]any{"at": Millis(), "action": action, "attempt": a.ID, "reason": reason, "revision": revision, "actor_uid": os.Getuid(), "effective_uid": os.Geteuid()})
}

func (e *Engine) appendNativeManagementAudit(event map[string]any) error {
	b, err := json.Marshal(event)
	if err != nil {
		return err
	}
	f, err := os.OpenFile(filepath.Join(e.Config.State, "audit.ndjson"), os.O_APPEND|os.O_CREATE|os.O_RDWR|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0600)
	if err != nil {
		return err
	}
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 || info.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) || info.Sys().(*syscall.Stat_t).Nlink != 1 {
		f.Close()
		return errors.New("unsafe native management audit file; requested control unchanged")
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		f.Close()
		return errors.New("native audit busy; requested control unchanged")
	}
	// Close releases this exact open-file-description lock. Never defer a raw
	// numeric unlock past Close, where another goroutine could reuse that fd.
	info, err = f.Stat()
	if err != nil {
		f.Close()
		return err
	}
	if info.Size() > 0 {
		var last [1]byte
		if _, err := f.ReadAt(last[:], info.Size()-1); err != nil {
			f.Close()
			return err
		}
		if last[0] != '\n' {
			b = append([]byte{'\n'}, b...)
		}
	}
	_, err = f.Write(append(b, '\n'))
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return syncDirectory(e.Config.State)
}

func (e *Engine) SetWorkspaceHold(id string, held bool, revision int64, reason string) (WorkspaceHold, error) {
	var empty WorkspaceHold
	reason = strings.TrimSpace(reason)
	if !attemptID.MatchString(id) || revision < 0 || len(reason) < 8 || len(reason) > 1000 {
		return empty, errors.New("hold/release-hold requires exact attempt UUID, reviewed --revision and --reason 8..1000 bytes")
	}
	lock, err := e.attemptCollectionLock(id)
	if err != nil {
		if errors.Is(err, errCollectionPending) {
			return empty, errors.New("attempt job is busy; workspace hold change was NOT accepted or queued. Inspect native info and retry only after the job settles")
		}
		return empty, err
	}
	defer lock.Close()
	var a Attempt
	if err := e.WithState(func() error {
		v, err := e.Find(id)
		if err == nil && v.ID != id {
			return errors.New("workspace attempt identity mismatch; hold unchanged")
		}
		if err == nil {
			a = *v
		}
		return err
	}); err != nil {
		return empty, err
	}
	current, err := e.readWorkspaceHold(&a)
	if err != nil {
		return empty, err
	}
	if current.Revision != revision {
		return current, fmt.Errorf("workspace hold changed (revision %d, held %t); inspect examctl workspaces show %s before a new reviewed change; a lost-reply retry never clears a later hold", current.Revision, current.Held, id)
	}
	if current.Revision == math.MaxInt64 {
		return current, errors.New("workspace hold revision exhausted; preserve metadata for recovery")
	}
	next := current
	next.Revision++
	next.Held = held
	next.Reason = reason
	next.UpdatedAt = Millis()
	next.ActorUID = os.Getuid()
	next.EffectiveUID = os.Geteuid()
	parent := e.workspaceRetentionDirectory()
	if err := os.Mkdir(parent, 0700); err != nil && !os.IsExist(err) {
		return current, err
	}
	if err := privateWorkspaceDirectory(parent); err != nil {
		return current, err
	}
	if err := syncDirectory(e.Config.State); err != nil {
		return current, err
	}
	if _, err := e.workspaceRetentionGlobalMarker(true); err != nil {
		return current, err
	}
	// Existing valid data can safely repair an interrupted marker publication.
	// Never create the first per-attempt marker before its record is durable.
	if current.Revision > 0 {
		if _, err := e.workspaceRetentionKnownMarker(&a, true); err != nil {
			return current, err
		}
	}
	b, err := json.Marshal(next)
	if err != nil {
		return current, err
	}
	temp, err := os.CreateTemp(parent, "."+id+"-")
	if err != nil {
		return current, err
	}
	name := temp.Name()
	defer os.Remove(name) // Exact unpublished file created here only.
	if _, err = temp.Write(b); err == nil {
		err = temp.Sync()
	}
	closeErr := temp.Close()
	if err != nil {
		return current, err
	}
	if closeErr != nil {
		return current, closeErr
	}
	action := "workspace-hold-intent"
	if !held {
		action = "workspace-release-hold-intent"
	}
	if err := e.auditWorkspaceRetention(action, &a, reason, next.Revision); err != nil {
		return current, err
	}
	if err := os.Rename(name, filepath.Join(parent, id+".json")); err != nil {
		return current, err
	}
	if err := syncDirectory(parent); err != nil {
		return next, fmt.Errorf("workspace hold publication durability unconfirmed; inspect fresh status before retrying: %w", err)
	}
	if _, err := e.workspaceRetentionKnownMarker(&a, true); err != nil {
		return next, fmt.Errorf("hold stored but loss-detection durability unconfirmed; inspect/reaffirm current revision before retrying: %w", err)
	}
	return next, nil
}
