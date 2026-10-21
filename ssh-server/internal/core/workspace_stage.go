package core

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
)

// Workspace initialization and material selection are independent. This source
// choice is frozen by the eventual grant/attempt snapshot, never inferred anew
// from a changed exam default. Empty Kind is reserved for legacy resolution.
type WorkspaceSource struct {
	Kind     string `json:"kind"`
	Template string `json:"template,omitempty"`
	Attempt  string `json:"attempt,omitempty"`
	Checksum string `json:"checksum,omitempty"`
}

type WorkspaceReceipt struct {
	Version      int             `json:"version"`
	Attempt      string          `json:"attempt"`
	Exam         string          `json:"exam"`
	Username     string          `json:"username"`
	UID          int             `json:"uid"`
	SettingsHash string          `json:"settings_hash"`
	Source       WorkspaceSource `json:"source"`
	PreparedAt   int64           `json:"prepared_at"`
	RecoveryHash string          `json:"recovery_hash,omitempty"`
	ContentHash  string          `json:"content_hash,omitempty"`
	WorkDevice   uint64          `json:"work_device"`
	WorkInode    uint64          `json:"work_inode"`
}

// Called only by a private staging worker with an empty, root-private parent on
// the work filesystem. It never publishes live /work, starts a clock, consumes a
// grant/legacy marker or modifies the immutable saved source. Publication is a
// separate, short Begin operation after the interval/hold is durably committed.
func (e *Engine) buildPrivateWorkspace(a *Attempt, source WorkspaceSource, dest string) (*WorkspaceReceipt, error) {
	if a.Start != 0 || a.Deadline != 0 || a.OriginalDeadline != 0 || a.State != "PREPARING" || !attemptID.MatchString(a.ID) {
		return nil, errors.New("private staging requires a provably unstarted preparation")
	}
	account, ok := e.account(a.Username)
	if !ok || account.UID != a.UID {
		return nil, errors.New("workspace account identity unavailable")
	}
	limits, err := limitsForSettings(a.Settings)
	if err != nil {
		return nil, err
	}
	if err := os.Mkdir(dest, 0700); err != nil {
		return nil, err
	}
	contentHash := ""
	switch source.Kind {
	case "empty":
		if source.Template != "" || source.Attempt != "" || source.Checksum != "" {
			return nil, errors.New("empty workspace cannot name another source")
		}
	case "template":
		if !identifier.MatchString(source.Template) || source.Attempt != "" || source.Checksum != "" {
			return nil, errors.New("select one versioned workspace template")
		}
		var err error
		contentHash, err = copyPrivateTemplate(filepath.Join(e.Config.Templates, source.Template, "work"), dest, account, limits)
		if err != nil {
			return nil, err
		}
	case "saved":
		if !attemptID.MatchString(source.Attempt) || len(source.Checksum) != 64 || source.Template != "" {
			return nil, errors.New("saved workspace requires an exact attempt/checksum")
		}
		prior := e.state.Attempts[source.Attempt]
		if prior == nil || prior.Username != a.Username || prior.UID != a.UID || prior.State != "COMPLETED" || !prior.Protected || prior.Checksum != source.Checksum {
			return nil, errors.New("verified saved workspace source unavailable")
		}
		manifest, err := ReadProtected(filepath.Join(e.Config.State, "submissions", prior.ID), prior)
		if err != nil {
			e.invalidateManifestReceipt(prior, err)
			return nil, err
		}
		recovery := &RecoveryPreparation{SourceAttempt: prior.ID, Checksum: source.Checksum}
		if err := e.restoreRecoveryFiles(a, recovery, manifest, dest); err != nil {
			return nil, err
		}
	default:
		return nil, errors.New("choose empty, template or verified saved workspace")
	}
	if err := os.Chown(dest, account.UID, account.GID); err != nil {
		return nil, err
	}
	if err := os.Chmod(dest, 0700); err != nil {
		return nil, err
	}
	if err := syncSnapshotDirectories(dest); err != nil {
		return nil, err
	}
	settings, err := json.Marshal(a.Settings)
	if err != nil {
		return nil, err
	}
	info, err := os.Lstat(dest)
	if err != nil {
		return nil, err
	}
	stat := info.Sys().(*syscall.Stat_t)
	return &WorkspaceReceipt{Version: 1, Attempt: a.ID, Exam: a.Exam, Username: a.Username, UID: a.UID, SettingsHash: Hash(settings), Source: source, ContentHash: contentHash, PreparedAt: Millis(), WorkDevice: uint64(stat.Dev), WorkInode: stat.Ino}, nil
}

// A starter tree must not itself guarantee an uncollectable eventual submission.
func copyPrivateTemplate(source, dest string, account Account, limits collectionBounds) (string, error) {
	info, err := os.Lstat(source)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("workspace template must be a real directory")
	}
	root, err := os.OpenRoot(source)
	if err != nil {
		return "", err
	}
	defer root.Close()
	out, err := os.OpenRoot(dest)
	if err != nil {
		return "", err
	}
	defer out.Close()
	device := info.Sys().(*syscall.Stat_t).Dev
	var total int64
	count := 0
	inventory := sha256.New()
	encode := json.NewEncoder(inventory)
	var walk func(string, int) error
	walk = func(name string, depth int) error {
		if depth > 32 {
			return errors.New("workspace template depth limit exceeded")
		}
		dir, err := root.OpenFile(name, os.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW, 0)
		if err != nil {
			return err
		}
		before, err := dir.Stat()
		if err != nil {
			dir.Close()
			return err
		}
		// Bound even the directory enumeration allocation before sorting.
		entries, err := dir.ReadDir(10001 - count)
		if err != nil && err != io.EOF {
			dir.Close()
			return err
		}
		if len(entries)+count > 10000 {
			dir.Close()
			return errors.New("workspace template entry limit exceeded")
		}
		count += len(entries)
		sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
		defer dir.Close()
		for _, entry := range entries {
			path := filepath.Join(name, entry.Name())
			if path == "MANIFEST.json" {
				return errors.New("workspace template MANIFEST.json is reserved for protected collection metadata; correct the authored template and retry preflight before Begin; no clock has started")
			}
			if filepath.IsAbs(path) || path == ".." || strings.HasPrefix(path, "../") {
				return errors.New("unsafe workspace template path")
			}
			i, err := root.Lstat(path)
			if err != nil {
				return err
			}
			stat := i.Sys().(*syscall.Stat_t)
			if stat.Dev != device {
				return errors.New("workspace template crosses a mount")
			}
			if i.IsDir() {
				_ = encode.Encode([]any{path, "directory"})
				if err := out.Mkdir(path, 0700); err != nil {
					return err
				}
				if err := walk(path, depth+1); err != nil {
					return err
				}
				if err := out.Chown(path, account.UID, account.GID); err != nil {
					return err
				}
				if err := out.Chmod(path, 0700); err != nil {
					return err
				}
				continue
			}
			if !i.Mode().IsRegular() || stat.Nlink != 1 {
				return errors.New("workspace template contains a link or special file")
			}
			if i.Size() > limits.File {
				return fmt.Errorf("workspace template per-file size exceeded: %s", path)
			}
			if i.Size() > limits.Total-total {
				return errors.New("workspace template total size exceeded")
			}
			total += i.Size()
			in, err := root.OpenFile(path, os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
			if err != nil {
				return err
			}
			current, err := in.Stat()
			if err != nil || !os.SameFile(i, current) || !current.Mode().IsRegular() {
				in.Close()
				return errors.New("workspace template file changed before copy")
			}
			f, err := out.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY|syscall.O_NOFOLLOW, 0600)
			if err != nil {
				in.Close()
				return err
			}
			// Hash while streaming to keep allocation independent of file size.
			h := sha256.New()
			_, err = io.CopyN(io.MultiWriter(f, h), in, i.Size())
			after, statErr := in.Stat()
			in.Close()
			if err == nil && (statErr != nil || after.Size() != i.Size() || !after.ModTime().Equal(i.ModTime()) || after.Sys().(*syscall.Stat_t).Ctim != stat.Ctim) {
				err = errors.New("workspace template changed during copy")
			}
			if err == nil {
				err = f.Chown(account.UID, account.GID)
			}
			if err == nil {
				err = f.Chmod(i.Mode().Perm() & 0777)
			}
			if err == nil {
				err = out.Chtimes(path, i.ModTime(), i.ModTime())
			}
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
			_ = encode.Encode([]any{path, "file", i.Size(), uint32(i.Mode().Perm()), i.ModTime().UnixNano(), hex.EncodeToString(h.Sum(nil))})
		}
		after, err := dir.Stat()
		if err != nil || after.Sys().(*syscall.Stat_t).Ctim != before.Sys().(*syscall.Stat_t).Ctim || !after.ModTime().Equal(before.ModTime()) {
			return errors.New("workspace template directory changed during copy")
		}
		return nil
	}
	if err := walk(".", 0); err != nil {
		return "", err
	}
	return hex.EncodeToString(inventory.Sum(nil)), nil
}
