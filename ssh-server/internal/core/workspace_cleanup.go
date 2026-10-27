package core

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"time"
	"unicode/utf8"

	"golang.org/x/sys/unix"
)

// The CLI owns no mutation after launching this bounded worker. An uncertain
// exit must direct the administrator to the durable job, never promise no work.
func ControlWorkspaceCleanup(c Config, action, id, request, review, reason string) (WorkspaceCleanupView, error) {
	var result WorkspaceCleanupView
	if os.Getuid() != 0 || os.Geteuid() != 0 || !attemptID.MatchString(id) || !attemptID.MatchString(request) {
		return result, errors.New("run as root with exact attempt and --request UUID; see examctl help workspaces")
	}
	if action != "cleanup-status" && (!templateDigest.MatchString(review) || !utf8.ValidString(reason) || len(strings.TrimSpace(reason)) < 8 || len(reason) > 1000) {
		return result, errors.New("reviewed cleanup requires --review SHA256 and --reason 8..1000 UTF-8 bytes")
	}
	switch action {
	case "cleanup", "cleanup-status", "cleanup-retry", "cleanup-cancel":
	default:
		return result, errors.New("unknown cleanup workflow; see examctl help workspaces")
	}
	e := &Engine{Config: c}
	if _, err := e.recoveryRevocationState(); err != nil {
		return result, err
	}
	executable, err := os.Executable()
	if err != nil {
		return result, err
	}
	info, err := os.Stat(executable)
	if err != nil || info.Sys().(*syscall.Stat_t).Uid != 0 || info.Mode().Perm()&0022 != 0 {
		return result, errors.New("cleanup requires a root-owned non-writable examctl executable")
	}
	if err := collectionResourceBounds(); err != nil {
		return result, err
	}
	r := workspaceInspectionRequest{Purpose: workspaceInspectionPurpose, Nonce: Token(), ID: id, Config: c, Action: action, Request: request, Review: review, Reason: reason}
	payload, err := json.Marshal(r)
	if err != nil || len(payload) > 65536 {
		return result, errors.New("cleanup request exceeds bound")
	}
	unit := "exam-workspace-cleanup-" + id + "-" + r.Nonce[:12] + ".service"
	args := collectionServiceArgs(unit, executable)
	args[len(args)-1] = workspaceInspectionFlag
	// Every accepted inode stays pinned until this one worker completes/exits.
	args = append(args[:len(args)-3], append([]string{"--property=LimitNOFILE=32768"}, args[len(args)-3:]...)...)
	ctx, cancel := context.WithTimeout(context.Background(), 130*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, args[0], args[1:]...)
	cmd.Stdin = bytes.NewReader(payload)
	var output workerOutput
	cmd.Stdout = &output
	cmd.Stderr = io.Discard
	cmd.WaitDelay = 5 * time.Second
	err = cmd.Run()
	if ctx.Err() != nil {
		stop, done := context.WithTimeout(context.Background(), 7*time.Second)
		_ = exec.CommandContext(stop, "/usr/bin/systemctl", "stop", unit).Run()
		done()
	}
	if err != nil {
		return result, fmt.Errorf("cleanup worker outcome uncertain: %w; preserve work/quarantine/archive; run examctl workspaces cleanup-status %s --request %s before any retry", err, id, request)
	}
	var reply workspaceInspectionReply
	if output.overflow || !validReadOnlyJSON(output.Bytes()) || decodeWorkerFrame(bytes.NewReader(output.Bytes()), 8192, &reply) != nil || reply.Purpose != r.Purpose || reply.Nonce != r.Nonce || reply.ID != id || reply.Preview != nil || (reply.Error != "" && reply.Cleanup != nil) {
		return result, errors.New("invalid cleanup worker reply; inspect cleanup-status with the same attempt/request; preserve all evidence")
	}
	if reply.Error != "" {
		return result, errors.New(reply.Error)
	}
	if reply.Cleanup == nil || reply.Cleanup.Attempt != id || reply.Cleanup.Request != request || !templateDigest.MatchString(reply.Cleanup.Review) {
		return result, errors.New("incomplete cleanup result; inspect cleanup-status before retry")
	}
	return *reply.Cleanup, nil
}

func cleanupPathIdentity(path string) (WorkspacePathIdentity, error) {
	root, err := os.OpenRoot("/")
	if err != nil {
		return WorkspacePathIdentity{}, err
	}
	defer root.Close()
	return workspacePathIdentity(root, strings.TrimPrefix(path, "/"))
}

func (e *Engine) cleanupStatus(j *workspaceCleanupJob, data []byte, a *Attempt) (WorkspaceCleanupView, error) {
	hold, err := e.readWorkspaceHold(a)
	if err != nil {
		return WorkspaceCleanupView{}, err
	}
	view := e.cleanupView(j, data)
	physical := []WorkspacePathIdentity{}
	for _, path := range []string{e.workspaceBase(j.Attempt), e.cleanupQuarantinePath(j)} {
		i, err := cleanupPathIdentity(path)
		if err != nil {
			return view, err
		}
		physical = append(physical, i)
	}
	if !cleanupPending(j) {
		contradictory := physical[1].Exists || j.Phase == "COMPLETED" && physical[0].Exists || j.Phase == "CANCELLED" && (!physical[0].Exists || physical[0].Device != j.Base.Device || physical[0].Inode != j.Base.Inode)
		if contradictory {
			view.Cleaned = false
			view.ArchivePinned = true
			view.Error = "Terminal cleanup receipt contradicts physical files; preserve archive and all folders; restore consistent verified evidence"
		}
	}
	payload, _ := json.Marshal([]any{Hash(data), hold, physical})
	view.Review = Hash(payload)
	return view, nil
}

func (e *Engine) workspaceCleanupControl(r workspaceInspectionRequest) (view WorkspaceCleanupView, failure error) {
	if !attemptID.MatchString(r.Request) || !attemptID.MatchString(r.ID) {
		return view, errors.New("exact attempt/request UUID required")
	}
	switch r.Action {
	case "cleanup-status":
	case "cleanup", "cleanup-retry", "cleanup-cancel":
		if !templateDigest.MatchString(r.Review) || !utf8.ValidString(r.Reason) || len(strings.TrimSpace(r.Reason)) < 8 || len(r.Reason) > 1000 {
			return view, errors.New("exact review and 8..1000-byte UTF-8 reason required")
		}
	default:
		return view, errors.New("unknown cleanup operation")
	}
	if r.Action == "cleanup-status" {
		state, err := e.recoveryRevocationState()
		if err != nil {
			return view, err
		}
		a := state.Attempts[r.ID]
		if a == nil {
			return view, errReadOnlySnapshot
		}
		current, _, err := e.readCleanupJob(r.ID, "")
		if err != nil && current == nil {
			return view, err
		}
		j, data, readErr := e.readCleanupJob(r.ID, r.Request)
		if readErr != nil && j == nil {
			return view, readErr
		}
		if j == nil {
			return view, errors.New("no durable cleanup receipt observed for this request; an in-flight worker may still accept it; preserve files and recheck status before new intent")
		}
		view, err = e.cleanupStatus(j, data, a)
		if current != nil && current.Request != j.Request {
			view.Historical = true
			view.ArchivePinned = false
			view.Error = j.Error
		}
		if readErr != nil {
			view.Error = "Accepted cleanup receipt needs explicit same-job marker durability repair; preserve archive and use reviewed cleanup-retry/cancel"
			view.ArchivePinned = true
		}
		return view, err
	}
	release, err := e.workspaceCleanupLocks(r.ID)
	if err != nil {
		return view, err
	}
	defer release()
	state, err := e.recoveryRevocationState()
	if err != nil {
		return view, err
	}
	a := state.Attempts[r.ID]
	if a == nil {
		return view, errReadOnlySnapshot
	}
	j, data, readErr := e.readCleanupJob(r.ID, "")
	if readErr != nil && j == nil {
		return view, readErr
	}
	if r.Action == "cleanup" && j != nil && j.Request == r.Request {
		if j.Review != r.Review || j.Reason != r.Reason {
			return view, errors.New("request UUID already records different intent; inspect cleanup-status, never reuse it for a changed review/reason")
		}
		view, err := e.cleanupStatus(j, data, a)
		if readErr != nil {
			view.Error = "Accepted cleanup receipt needs explicit same-job marker durability repair; inspect current review, then use cleanup-retry/cancel; preserve archive"
			view.ArchivePinned = true
		}
		return view, err
	}
	if r.Action == "cleanup" {
		if readErr != nil {
			return view, readErr
		}
		if _, err := os.Lstat(filepath.Join(e.cleanupHistoryDirectory(), r.ID+"."+r.Request+".json")); err == nil {
			return view, errors.New("request UUID is already historical; inspect cleanup-status for it and use a NEW request for new intent")
		} else if !os.IsNotExist(err) {
			return view, err
		}
		if j != nil && j.Phase != "CANCELLED" {
			return view, fmt.Errorf("cleanup already recorded as %s under request %s; inspect cleanup-status and use explicit cleanup-retry/cancel", j.Phase, j.Request)
		}
		preview, err := e.inspectWorkspaceCleanupLocked(r.ID)
		if err != nil {
			return view, err
		}
		if preview.Review != r.Review || !preview.SnapshotClear {
			return view, errors.New("stale or blocked workspace review; inspect fresh dry-run and review its blockers before cleanup")
		}
		limits, err := limitsForSettings(a.Settings)
		if err != nil {
			return view, err
		}
		tree, err := openCleanupTree(e.workspaceBase(a.ID), preview.Base, limits)
		if err != nil {
			return view, err
		}
		defer tree.close()
		if err := tree.acquireLeases(); err != nil {
			return view, err
		}
		if err := e.validateCleanupArchive(a, tree.entries); err != nil {
			return view, err
		}
		if uses, err := e.workspaceUseSnapshotAt(a, preview.Base, e.workspaceBase(a.ID), tree.owned); err != nil || len(uses) != 0 {
			return view, fmt.Errorf("fresh cleanup reference proof refused (%v, %d references); preserve workspace", err, len(uses))
		}
		previous, previousHash := "", ""
		if j != nil {
			if err := e.publishCleanupJob(j, true); err != nil {
				return view, err
			}
			previous, previousHash = j.Request, Hash(data)
		}
		now := Millis()
		j = &workspaceCleanupJob{Version: 1, Attempt: a.ID, Request: r.Request, Exam: a.Exam, Username: a.Username, UID: a.UID, Start: a.Start, Deadline: a.Deadline, OriginalDeadline: a.OriginalDeadline, Checksum: a.Checksum, Review: r.Review, Reason: r.Reason, Created: now, Updated: now, Revision: 1, Phase: "PREPARED", WorkRoot: e.Config.Work, Base: preview.Base, Parent: preview.Base, HoldRevision: preview.Hold.Revision, Entries: tree.entries, PreviousRequest: previous, PreviousHash: previousHash}
		parent, err := cleanupPathIdentity(e.Config.Work)
		if err != nil {
			return view, err
		}
		j.Parent = parent
		if err := e.cleanupAudit(j, r.Action, r.Reason); err != nil {
			return view, err
		}
		if err := e.publishCleanupJob(j, false); err != nil {
			return view, err
		}
		if err := e.workspaceBarrier("cleanup-prepared"); err != nil {
			return view, err
		}
		return e.performWorkspaceCleanup(j, a, tree)
	}
	if j == nil || j.Request != r.Request {
		return view, errors.New("no current cleanup with this request; inspect cleanup-status and use the exact recorded UUID")
	}
	view, err = e.cleanupStatus(j, data, a)
	if err != nil {
		return view, err
	}
	if view.Review != r.Review {
		return view, errors.New("stale cleanup review; inspect cleanup-status and explicitly review its current state/holds")
	}
	if !cleanupPending(j) {
		return view, errors.New("cleanup is already terminal; inspect its receipt; completed deletion cannot be cancelled")
	}
	if err := e.validateCleanupAuthority(j, a, state); err != nil {
		return view, err
	}
	if err := e.validateCleanupArchive(a, j.Entries); err != nil {
		return view, err
	}
	if r.Action == "cleanup-retry" && j.Phase == "REMOVING" {
		canonical, err := cleanupPathIdentity(e.workspaceBase(j.Attempt))
		if err != nil {
			return view, err
		}
		q, err := cleanupPathIdentity(e.cleanupQuarantinePath(j))
		if err != nil {
			return view, err
		}
		if !canonical.Exists && !q.Exists {
			if err := e.cleanupAudit(j, r.Action, r.Reason); err != nil {
				return view, err
			}
			if err := syncDirectory(e.cleanupQuarantine()); err != nil {
				return view, err
			}
			if err := e.cleanupPhase(j, "COMPLETED"); err != nil {
				return view, err
			}
			data, _ := json.Marshal(j)
			return e.cleanupStatus(j, data, a)
		}
	}
	path, err := e.currentCleanupPath(j)
	if err != nil {
		return view, err
	}
	limits, err := limitsForSettings(a.Settings)
	if err != nil {
		return view, err
	}
	tree, err := openCleanupTree(path, j.Base, limits)
	if err != nil {
		return view, err
	}
	defer tree.close()
	if err := validateCleanupEntries(j, tree, r.Action == "cleanup-cancel"); err != nil {
		return view, err
	}
	if err := tree.acquireLeases(); err != nil {
		return view, err
	}
	if uses, err := e.workspaceUseSnapshotAt(a, j.Base, path, tree.owned); err != nil || len(uses) != 0 {
		return view, fmt.Errorf("cleanup retry reference proof refused (%v, %d references)", err, len(uses))
	}
	if err := e.cleanupAudit(j, r.Action, r.Reason); err != nil {
		return view, err
	}
	if readErr != nil {
		if err := e.publishCleanupJob(j, false); err != nil {
			return view, err
		}
	}
	hold, err := e.readWorkspaceHold(a)
	if err != nil {
		return view, err
	}
	j.HoldRevision = hold.Revision
	if r.Action == "cleanup-cancel" {
		return e.cancelWorkspaceCleanup(j, a, tree, path)
	}
	if r.Action != "cleanup-retry" {
		return view, errors.New("unknown cleanup control; see examctl help workspaces")
	}
	return e.performWorkspaceCleanup(j, a, tree)
}

func (e *Engine) cleanupAudit(j *workspaceCleanupJob, action, reason string) error {
	return e.appendNativeManagementAudit(map[string]any{"at": Millis(), "action": "workspace-" + action, "attempt": j.Attempt, "request": j.Request, "revision": j.Revision, "review": j.Review, "reason": reason, "actor_uid": os.Getuid(), "effective_uid": os.Geteuid()})
}

func (e *Engine) validateCleanupAuthority(j *workspaceCleanupJob, a *Attempt, s State) error {
	if a == nil || a.ID != j.Attempt || a.Exam != j.Exam || a.Username != j.Username || a.UID != j.UID || a.State != "COMPLETED" || !a.Protected || a.Checksum != j.Checksum || a.Start != j.Start || a.Deadline != j.Deadline || a.OriginalDeadline != j.OriginalDeadline || len(a.Units) != 0 || a.PolicyError != "" || a.AccessError != "" {
		return errors.New("cleanup attempt authority changed or is unsafe; preserve files/archives and inspect native info")
	}
	hold, err := e.readWorkspaceHold(a)
	if err != nil {
		return err
	}
	if hold.Held {
		return errors.New("workspace retention hold is active; preserve work and inspect workspaces show")
	}
	for id, other := range s.Attempts {
		if other == nil {
			return errReadOnlySnapshot
		}
		if id != a.ID && other.UID == a.UID && other.State != "COMPLETED" && other.State != "CANCELLED_BEFORE_START" {
			return errors.New("another account attempt is unfinished; defer cleanup without interrupting it")
		}
	}
	_, err = e.verifySourceRetentionArchive(a)
	return err
}

func (e *Engine) validateCleanupArchive(a *Attempt, entries []workspaceCleanupEntry) error {
	m, err := e.verifySourceRetentionArchive(a)
	if err != nil {
		return err
	}
	files := map[string]FileEntry{}
	for _, f := range m.Files {
		files["work/"+f.Path] = f
	}
	for _, entry := range entries {
		if entry.Mode&unix.S_IFMT != unix.S_IFREG || !strings.HasPrefix(entry.Path, "work/") {
			continue
		}
		f, ok := files[entry.Path]
		if !ok || f.Size != entry.Size || f.Hash != entry.Hash {
			return errors.New("live workspace has bytes absent from its protected archive; preserve it; cleanup cannot discard post-collection changes")
		}
		delete(files, entry.Path)
	}
	if len(files) != 0 {
		return errors.New("workspace/archive file inventories differ; preserve remaining work and inspect protection")
	}
	return nil
}

func (e *Engine) currentCleanupPath(j *workspaceCleanupJob) (string, error) {
	canonical, q := e.workspaceBase(j.Attempt), e.cleanupQuarantinePath(j)
	c, err := cleanupPathIdentity(canonical)
	if err != nil {
		return "", err
	}
	v, err := cleanupPathIdentity(q)
	if err != nil {
		return "", err
	}
	if c.Exists && v.Exists {
		return "", errors.New("both canonical workspace and quarantine exist; preserve both; no replacement or merge is supported")
	}
	path, identity := canonical, c
	if v.Exists {
		path, identity = q, v
	}
	if !identity.Exists || !identity.Directory || identity.Device != j.Base.Device || identity.Inode != j.Base.Inode {
		return "", errors.New("recorded workspace/quarantine inode missing or replaced; preserve all evidence; do not adopt a different folder")
	}
	return path, nil
}

func validateCleanupEntries(j *workspaceCleanupJob, t *cleanupTree, complete bool) error {
	expected := map[string]workspaceCleanupEntry{}
	for _, entry := range j.Entries {
		expected[entry.Path] = entry
	}
	if complete && len(t.entries) != len(j.Entries) {
		return errors.New("cleanup already removed entries; cancellation would lose data; preserve archive and use cleanup-retry")
	}
	for _, entry := range t.entries {
		old, ok := expected[entry.Path]
		if !ok || entry.Device != old.Device || entry.Inode != old.Inode || entry.Mode&unix.S_IFMT != old.Mode&unix.S_IFMT || entry.Hash != old.Hash || entry.Link != old.Link || !bytes.Equal(entry.Receipt, old.Receipt) {
			return errors.New("workspace contains new, replaced or changed entries; preserve them; retry cannot adopt unreviewed data")
		}
		if old.Mode&unix.S_IFMT == unix.S_IFDIR {
			if !(entry.UID == old.UID && entry.GID == old.GID && entry.Mode == old.Mode) && !(entry.UID == 0 && entry.GID == 0 && entry.Mode&07777 == 0500) {
				return errors.New("workspace directory authority changed; preserve it")
			}
		} else if entry.Mode != old.Mode || entry.UID != old.UID || entry.GID != old.GID {
			return errors.New("workspace file authority changed; preserve it")
		}
	}
	if !complete && j.Phase != "REMOVING" && len(t.entries) != len(j.Entries) {
		return errors.New("unexpected missing workspace entries before removal; preserve and inspect")
	}
	return nil
}

func (e *Engine) cleanupPhase(j *workspaceCleanupJob, phase string) error {
	j.Phase = phase
	j.Updated = Millis()
	j.Revision++
	j.Error = ""
	if err := e.publishCleanupJob(j, false); err != nil {
		return err
	}
	return e.workspaceBarrier("cleanup-" + strings.ToLower(phase))
}

func (e *Engine) performWorkspaceCleanup(j *workspaceCleanupJob, a *Attempt, t *cleanupTree) (view WorkspaceCleanupView, failure error) {
	defer func() {
		if failure != nil {
			j.Error = "Cleanup interrupted; preserve remaining work/quarantine and archive; inspect cleanup-status before an explicit reviewed retry"
			j.Updated = Millis()
			j.Revision++
			_ = e.publishCleanupJob(j, false)
		}
	}()
	state, err := e.recoveryRevocationState()
	if err != nil {
		return view, err
	}
	if err := e.validateCleanupAuthority(j, state.Attempts[a.ID], state); err != nil {
		return view, err
	}
	parent, err := cleanupPathIdentity(e.Config.Work)
	if err != nil || parent != j.Parent {
		return view, errors.New("configured workspace parent identity changed; preserve all targets")
	}
	if err := t.seal(); err != nil {
		return view, err
	}
	if j.Phase == "PREPARED" {
		if err := e.cleanupPhase(j, "SEALED"); err != nil {
			return view, err
		}
	}
	if err := os.Mkdir(e.cleanupQuarantine(), 0700); err != nil && !os.IsExist(err) {
		return view, err
	}
	if err := privateWorkspaceDirectory(e.cleanupQuarantine()); err != nil {
		return view, err
	}
	path, err := e.currentCleanupPath(j)
	if err != nil {
		return view, err
	}
	if path == e.workspaceBase(a.ID) {
		if err := unix.Renameat2(unix.AT_FDCWD, path, unix.AT_FDCWD, e.cleanupQuarantinePath(j), unix.RENAME_NOREPLACE); err != nil {
			return view, err
		}
		if err := syncDirectory(e.Config.Work); err != nil {
			return view, err
		}
		if err := syncDirectory(e.cleanupQuarantine()); err != nil {
			return view, err
		}
		path = e.cleanupQuarantinePath(j)
	}
	if _, err := e.currentCleanupPath(j); err != nil {
		return view, err
	}
	if j.Phase != "REMOVING" {
		if err := e.cleanupPhase(j, "QUARANTINED"); err != nil {
			return view, err
		}
	}
	if uses, err := e.workspaceUseSnapshotAt(a, j.Base, path, t.owned); err != nil || len(uses) != 0 {
		return view, fmt.Errorf("quarantined workspace reference proof refused (%v, %d references)", err, len(uses))
	}
	if err := t.checkLeases(); err != nil {
		return view, err
	}
	if err := e.cleanupPhase(j, "REMOVING"); err != nil {
		return view, err
	}
	entries := append([]workspaceCleanupEntry{}, t.entries...)
	sort.Slice(entries, func(i, k int) bool {
		return len(strings.Split(entries[i].Path, "/")) > len(strings.Split(entries[k].Path, "/")) || len(strings.Split(entries[i].Path, "/")) == len(strings.Split(entries[k].Path, "/")) && entries[i].Path > entries[k].Path
	})
	for _, entry := range entries {
		if entry.Path == "" {
			continue
		}
		if err := t.checkRemovalLease(entry); err != nil {
			return view, err
		}
		parent := filepath.Dir(entry.Path)
		if parent == "." {
			parent = ""
		}
		dir := t.files[parent]
		if dir == nil {
			return view, errWorkspaceUsage
		}
		var st unix.Stat_t
		if unix.Fstatat(int(dir.Fd()), filepath.Base(entry.Path), &st, unix.AT_SYMLINK_NOFOLLOW) != nil || st.Dev != entry.Device || st.Ino != entry.Inode {
			return view, errors.New("cleanup target changed; remaining entries preserved")
		}
		mode, uid, gid := entry.Mode, entry.UID, entry.GID
		if mode&unix.S_IFMT == unix.S_IFDIR {
			mode = unix.S_IFDIR | 0500
			uid = 0
			gid = 0
		}
		if st.Mode != mode || st.Uid != uid || st.Gid != gid || mode&unix.S_IFMT == unix.S_IFREG && st.Nlink != 1 {
			return view, errors.New("cleanup target authority/link count changed; remaining entries preserved")
		}
		flags := 0
		if entry.Mode&unix.S_IFMT == unix.S_IFDIR {
			flags = unix.AT_REMOVEDIR
		}
		if err := unix.Unlinkat(int(dir.Fd()), filepath.Base(entry.Path), flags); err != nil {
			return view, err
		}
		if err := dir.Sync(); err != nil {
			return view, err
		}
		if err := e.workspaceBarrier("cleanup-unlinked"); err != nil {
			return view, err
		}
	}
	if err := t.checkLeases(); err != nil {
		return view, err
	}
	if err := unix.Unlinkat(unix.AT_FDCWD, path, unix.AT_REMOVEDIR); err != nil {
		return view, err
	}
	if err := syncDirectory(e.cleanupQuarantine()); err != nil {
		return view, err
	}
	if err := e.workspaceBarrier("cleanup-root-removed"); err != nil {
		return view, err
	}
	if err := e.cleanupPhase(j, "COMPLETED"); err != nil {
		return view, err
	}
	data, _ := json.Marshal(j)
	return e.cleanupStatus(j, data, a)
}

func (e *Engine) cancelWorkspaceCleanup(j *workspaceCleanupJob, a *Attempt, t *cleanupTree, path string) (WorkspaceCleanupView, error) {
	if j.Phase == "REMOVING" {
		return WorkspaceCleanupView{}, errors.New("removal has begun; cancellation cannot recreate deleted bytes; preserve archive and use reviewed cleanup-retry")
	}
	if path != e.workspaceBase(j.Attempt) {
		if err := unix.Renameat2(unix.AT_FDCWD, path, unix.AT_FDCWD, e.workspaceBase(j.Attempt), unix.RENAME_NOREPLACE); err != nil {
			return WorkspaceCleanupView{}, err
		}
		if err := syncDirectory(e.Config.Work); err != nil {
			return WorkspaceCleanupView{}, err
		}
		if err := syncDirectory(e.cleanupQuarantine()); err != nil {
			return WorkspaceCleanupView{}, err
		}
	}
	for i := len(j.Entries) - 1; i >= 0; i-- {
		entry := j.Entries[i]
		if entry.Mode&unix.S_IFMT != unix.S_IFDIR {
			continue
		}
		f := t.files[entry.Path]
		if f == nil {
			return WorkspaceCleanupView{}, errWorkspaceUsage
		}
		if err := f.Chown(int(entry.UID), int(entry.GID)); err != nil {
			return WorkspaceCleanupView{}, err
		}
		if err := unix.Fchmod(int(f.Fd()), entry.Mode&07777); err != nil {
			return WorkspaceCleanupView{}, err
		}
		if err := f.Sync(); err != nil {
			return WorkspaceCleanupView{}, err
		}
	}
	if err := e.cleanupPhase(j, "CANCELLED"); err != nil {
		return WorkspaceCleanupView{}, err
	}
	data, _ := json.Marshal(j)
	return e.cleanupStatus(j, data, a)
}
