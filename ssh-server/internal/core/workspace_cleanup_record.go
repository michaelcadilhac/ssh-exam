package core

// Private receipts for the root CLI cleanup worker. Neither state.json writers
// nor a missing live folder may erase or manufacture an accepted cleanup.
import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"syscall"
	"unicode/utf8"
)

const workspaceCleanupRecordLimit = 8 * 1024 * 1024

type workspaceCleanupEntry struct {
	Path    string `json:"path"`
	Device  uint64 `json:"device"`
	Inode   uint64 `json:"inode"`
	Mode    uint32 `json:"mode"`
	UID     uint32 `json:"uid"`
	GID     uint32 `json:"gid"`
	Size    int64  `json:"size"`
	Hash    string `json:"hash"`
	Link    string `json:"link"`
	Receipt []byte `json:"receipt"`
}

type workspaceCleanupJob struct {
	Version          int                     `json:"version"`
	Attempt          string                  `json:"attempt"`
	Request          string                  `json:"request"`
	Exam             string                  `json:"exam"`
	Username         string                  `json:"username"`
	UID              int                     `json:"uid"`
	Start            int64                   `json:"start"`
	Deadline         int64                   `json:"deadline"`
	OriginalDeadline int64                   `json:"original_deadline"`
	Checksum         string                  `json:"checksum"`
	Review           string                  `json:"review"`
	Reason           string                  `json:"reason"`
	ActorUID         int                     `json:"actor_uid"`
	EffectiveUID     int                     `json:"effective_uid"`
	Created          int64                   `json:"created"`
	Updated          int64                   `json:"updated"`
	Revision         int64                   `json:"revision"`
	Phase            string                  `json:"phase"`
	Error            string                  `json:"error"`
	WorkRoot         string                  `json:"work_root"`
	Base             WorkspacePathIdentity   `json:"base"`
	Parent           WorkspacePathIdentity   `json:"parent"`
	HoldRevision     int64                   `json:"hold_revision"`
	Entries          []workspaceCleanupEntry `json:"entries"`
	PreviousRequest  string                  `json:"previous_request"`
	PreviousHash     string                  `json:"previous_hash"`
}

type WorkspaceCleanupView struct {
	Attempt         string `json:"attempt"`
	Request         string `json:"request"`
	Phase           string `json:"phase"`
	Revision        int64  `json:"revision"`
	Review          string `json:"review"`
	Reason          string `json:"reason"`
	Updated         int64  `json:"updated"`
	Cleaned         bool   `json:"cleaned"`
	ArchivePinned   bool   `json:"archive_pinned"`
	Quarantine      string `json:"quarantine"`
	Error           string `json:"error"`
	PreviousRequest string `json:"previous_request,omitempty"`
	Historical      bool   `json:"historical,omitempty"`
}

var errWorkspaceCleanupRecord = errors.New("workspace cleanup receipt unavailable, malformed or unsafe; preserve workspace/quarantine, archives and markers; inspect cleanup-status and restore a consistent verified backup, never edit JSON or remove loss-detection markers")

func (e *Engine) cleanupDirectory() string {
	return filepath.Join(e.Config.State, "workspace-cleanups")
}
func (e *Engine) cleanupHistoryDirectory() string {
	return filepath.Join(e.Config.State, "workspace-cleanup-history")
}
func (e *Engine) cleanupQuarantine() string {
	return filepath.Join(e.Config.Work, ".workspace-cleanup-quarantine")
}
func (e *Engine) cleanupQuarantinePath(j *workspaceCleanupJob) string {
	return filepath.Join(e.cleanupQuarantine(), j.Attempt+"."+j.Request)
}
func cleanupPending(j *workspaceCleanupJob) bool {
	return j.Phase != "COMPLETED" && j.Phase != "CANCELLED"
}
func cleanupIdentity(j *workspaceCleanupJob) string {
	return Hash([]byte(fmt.Sprintf("%s\x00%s\x00%s\x00%d", j.Attempt, j.Exam, j.Username, j.UID))) + "\n"
}

// Complete exact-key objects: encoding/json's case aliases and null/default
// attribution must not turn damaged private metadata into a valid root receipt.
func completeCleanupObject(data []byte, value any) error {
	var fields map[string]json.RawMessage
	if !validReadOnlyJSON(data) || json.Unmarshal(data, &fields) != nil {
		return errWorkspaceCleanupRecord
	}
	t := reflect.TypeOf(value)
	if t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	if t.Kind() != reflect.Struct || len(fields) != t.NumField() {
		return errWorkspaceCleanupRecord
	}
	for i := 0; i < t.NumField(); i++ {
		key := strings.Split(t.Field(i).Tag.Get("json"), ",")[0]
		v, ok := fields[key]
		if !ok || (bytes.Equal(bytes.TrimSpace(v), []byte("null")) && t.Field(i).Type != reflect.TypeOf([]byte{})) {
			return errWorkspaceCleanupRecord
		}
	}
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if d.Decode(value) != nil {
		return errWorkspaceCleanupRecord
	}
	return nil
}

func validCleanupJob(j *workspaceCleanupJob) bool {
	if j == nil || j.Version != 1 || !attemptID.MatchString(j.Attempt) || !attemptID.MatchString(j.Request) || !identifier.MatchString(j.Exam) || !identifier.MatchString(j.Username) || j.UID < 1000 || j.Start <= 0 || j.Deadline <= j.Start || j.OriginalDeadline <= j.Start || !templateDigest.MatchString(j.Checksum) || !templateDigest.MatchString(j.Review) || !utf8.ValidString(j.Reason) || len(strings.TrimSpace(j.Reason)) < 8 || len(j.Reason) > 1000 || j.ActorUID != 0 || j.EffectiveUID != 0 || j.Created <= 0 || j.Updated < j.Created || j.Revision < 1 || len(j.Error) > 1000 || len(j.Entries) < 2 || len(j.Entries) > 20000 || !filepath.IsAbs(j.WorkRoot) || filepath.Clean(j.WorkRoot) != j.WorkRoot || j.WorkRoot == "/" {
		return false
	}
	switch j.Phase {
	case "PREPARED", "SEALED", "QUARANTINED", "REMOVING", "COMPLETED", "CANCELLED":
	default:
		return false
	}
	if (j.PreviousRequest == "") != (j.PreviousHash == "") || (j.PreviousRequest != "" && (!attemptID.MatchString(j.PreviousRequest) || !templateDigest.MatchString(j.PreviousHash))) {
		return false
	}
	for _, identity := range []WorkspacePathIdentity{j.Base, j.Parent} {
		if !identity.Exists || !identity.Directory || identity.Symlink || identity.OwnerUID != 0 || identity.Device == "" || identity.Inode == "" {
			return false
		}
	}
	seen := map[string]bool{}
	for _, entry := range j.Entries {
		if seen[entry.Path] || !utf8.ValidString(entry.Path) || strings.ContainsRune(entry.Path, 0) || (entry.Path != "" && (filepath.IsAbs(entry.Path) || filepath.Clean(entry.Path) != entry.Path || entry.Path == ".." || strings.HasPrefix(entry.Path, "../"))) || entry.Device == 0 || entry.Inode == 0 {
			return false
		}
		seen[entry.Path] = true
		switch entry.Mode & syscall.S_IFMT {
		case syscall.S_IFDIR:
			if entry.Hash != "" || entry.Link != "" || len(entry.Receipt) != 0 {
				return false
			}
		case syscall.S_IFREG:
			if !templateDigest.MatchString(entry.Hash) || entry.Size < 0 || entry.Link != "" {
				return false
			}
			if strings.HasPrefix(entry.Path, "work/") {
				if len(entry.Receipt) != 0 {
					return false
				}
			} else if (entry.Path != "initialized" && entry.Path != "workspace-ready/receipt.json") || len(entry.Receipt) > 16384 || int64(len(entry.Receipt)) != entry.Size || Hash(entry.Receipt) != entry.Hash {
				return false
			}
		case syscall.S_IFLNK:
			if entry.Hash != "" || entry.Link == "" || len(entry.Link) > 4096 || !utf8.ValidString(entry.Link) || len(entry.Receipt) != 0 {
				return false
			}
		default:
			return false
		}
	}
	return seen[""] && seen["work"]
}

func (e *Engine) readCleanupJob(id, request string) (*workspaceCleanupJob, []byte, error) {
	if request != "" {
		j, data, err := e.readCleanupJob(id, "")
		if j != nil && j.Request == request {
			return j, data, err
		}
		if err != nil {
			return nil, nil, err
		}
		return e.readCleanupHistory(id, request)
	}
	return e.readCleanupHistory(id, "")
}

func (e *Engine) readCleanupHistory(id, request string) (*workspaceCleanupJob, []byte, error) {
	if !attemptID.MatchString(id) || (request != "" && !attemptID.MatchString(request)) {
		return nil, nil, errWorkspaceCleanupRecord
	}
	state, err := readOnlyRoot(e.Config.State)
	if err != nil {
		return nil, nil, err
	}
	defer state.Close()
	initialized, err := e.workspaceRetentionMarker("workspace-cleanups-initialized", []byte("Workspace cleanup catalog v1\n"), false)
	if err != nil {
		return nil, nil, err
	}
	known, knownErr := readOnlyFile(state, "workspace-cleanup-known-"+id, 4096)
	if knownErr != nil && !os.IsNotExist(knownErr) {
		return nil, nil, errWorkspaceCleanupRecord
	}
	parent := "workspace-cleanups"
	name := id + ".json"
	if request != "" {
		parent = "workspace-cleanup-history"
		name = id + "." + request + ".json"
	}
	dir, err := readOnlyOpenAt(state, parent, true)
	if os.IsNotExist(err) && request == "" && !initialized && os.IsNotExist(knownErr) {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, errWorkspaceCleanupRecord
	}
	defer dir.Close()
	data, err := readOnlyFile(dir, name, workspaceCleanupRecordLimit)
	if os.IsNotExist(err) && request == "" && os.IsNotExist(knownErr) {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, errWorkspaceCleanupRecord
	}
	var j workspaceCleanupJob
	if completeCleanupObject(data, &j) != nil || !validCleanupJob(&j) || j.Attempt != id || (request != "" && j.Request != request) || j.WorkRoot != e.Config.Work {
		return nil, nil, errWorkspaceCleanupRecord
	}
	var raw map[string]json.RawMessage
	_ = json.Unmarshal(data, &raw)
	for _, name := range []string{"base", "parent"} {
		var identity WorkspacePathIdentity
		if completeCleanupObject(raw[name], &identity) != nil {
			return nil, nil, errWorkspaceCleanupRecord
		}
	}
	var entries []json.RawMessage
	if json.Unmarshal(raw["entries"], &entries) != nil {
		return nil, nil, errWorkspaceCleanupRecord
	}
	for _, entry := range entries {
		var value workspaceCleanupEntry
		if completeCleanupObject(entry, &value) != nil {
			return nil, nil, errWorkspaceCleanupRecord
		}
	}
	if knownErr == nil && !bytes.Equal(known, []byte(cleanupIdentity(&j))) {
		return nil, nil, errWorkspaceCleanupRecord
	}
	if !initialized || os.IsNotExist(knownErr) {
		return &j, data, fmt.Errorf("%w; accepted receipt needs same-job marker durability repair", errWorkspaceCleanupRecord)
	}
	return &j, data, nil
}

func (e *Engine) publishCleanupJob(j *workspaceCleanupJob, history bool) error {
	if !validCleanupJob(j) {
		return errWorkspaceCleanupRecord
	}
	parent := e.cleanupDirectory()
	name := j.Attempt + ".json"
	if history {
		parent = e.cleanupHistoryDirectory()
		name = j.Attempt + "." + j.Request + ".json"
	}
	if err := os.Mkdir(parent, 0700); err != nil && !os.IsExist(err) {
		return err
	}
	if err := privateWorkspaceDirectory(parent); err != nil {
		return err
	}
	data, err := json.Marshal(j)
	if err != nil || len(data) > workspaceCleanupRecordLimit {
		return errWorkspaceCleanupRecord
	}
	f, err := os.CreateTemp(parent, ".pending-"+j.Attempt+"-")
	if err != nil {
		return err
	}
	path := f.Name()
	defer os.Remove(path)
	_, err = f.Write(data)
	if err == nil {
		err = f.Sync()
	}
	closed := f.Close()
	if err == nil {
		err = closed
	}
	if err != nil {
		return err
	}
	if history {
		if err := os.Link(path, filepath.Join(parent, name)); err != nil {
			if !os.IsExist(err) {
				return err
			}
			_, old, readErr := e.readCleanupHistory(j.Attempt, j.Request)
			if readErr != nil || !bytes.Equal(data, old) {
				return errWorkspaceCleanupRecord
			}
		}
		// Never expose a successful history receipt with two links.
		if err := os.Remove(path); err != nil {
			return err
		}
	} else if err := os.Rename(path, filepath.Join(parent, name)); err != nil {
		return err
	}
	if err := syncDirectory(parent); err != nil {
		return err
	}
	if err := syncDirectory(e.Config.State); err != nil {
		return err
	}
	if _, err := e.workspaceRetentionMarker("workspace-cleanups-initialized", []byte("Workspace cleanup catalog v1\n"), true); err != nil {
		return err
	}
	_, err = e.workspaceRetentionMarker("workspace-cleanup-known-"+j.Attempt, []byte(cleanupIdentity(j)), true)
	return err
}

func (e *Engine) cleanupView(j *workspaceCleanupJob, data []byte) WorkspaceCleanupView {
	return WorkspaceCleanupView{Attempt: j.Attempt, Request: j.Request, Phase: j.Phase, Revision: j.Revision, Review: Hash(data), Reason: j.Reason, Updated: j.Updated, Cleaned: j.Phase == "COMPLETED", ArchivePinned: cleanupPending(j), Quarantine: e.cleanupQuarantinePath(j), Error: j.Error, PreviousRequest: j.PreviousRequest}
}

func syncCleanupReceipt(path string) error {
	f, err := os.OpenFile(path, os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	if err != nil {
		return err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 || info.Size() > workspaceCleanupRecordLimit || info.Sys().(*syscall.Stat_t).Uid != 0 || info.Sys().(*syscall.Stat_t).Nlink != 1 {
		return errWorkspaceCleanupRecord
	}
	if n, err := io.Copy(io.Discard, io.LimitReader(f, workspaceCleanupRecordLimit+1)); err != nil || n != info.Size() {
		return errWorkspaceCleanupRecord
	}
	if err := f.Sync(); err != nil {
		return err
	}
	return syncDirectory(filepath.Dir(path))
}
