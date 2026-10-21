package core

import (
	"archive/tar"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

// An administrator can stage a one-use continuation independently of a live
// attempt. No preparation, interval, or countdown exists until the student returns.
// The source is always an immutable protected submission, never a live workspace.
type RecoveryPreparation struct {
	Exam          string `json:"exam"`
	Username      string `json:"username"`
	UID           int    `json:"uid"`
	Duration      int64  `json:"duration"`
	SourceAttempt string `json:"source_attempt"`
	Checksum      string `json:"checksum"`
	CreatedAt     int64  `json:"created_at"`
	Reason        string `json:"reason"`
}

func recoveryName(a *Attempt) string {
	return filepath.Join("recovery-preparations", a.Exam, a.Username+".json")
}

func (e *Engine) recoveryPreparation(a *Attempt) (*RecoveryPreparation, *Manifest, error) {
	if !identifier.MatchString(a.Exam) || !identifier.MatchString(a.Username) {
		return nil, nil, errors.New("invalid recovery identity")
	}
	root, err := os.OpenRoot(e.Config.State)
	if err != nil {
		return nil, nil, err
	}
	defer root.Close()
	f, err := root.OpenFile(recoveryName(a), os.O_RDONLY|syscall.O_NOFOLLOW, 0)
	if os.IsNotExist(err) {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > 16384 || info.Mode().Perm()&0077 != 0 || info.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) {
		return nil, nil, errors.New("unsafe administrator recovery preparation")
	}
	var r RecoveryPreparation
	if err = json.NewDecoder(io.LimitReader(f, 16385)).Decode(&r); err != nil {
		return nil, nil, err
	}
	if r.Exam != a.Exam || r.Username != a.Username || r.UID != a.UID || r.Duration != a.Settings.Duration || r.Duration < 60 || r.Duration > 21600 || !attemptID.MatchString(r.SourceAttempt) || len(r.Checksum) != 64 || r.CreatedAt <= 0 || len(strings.TrimSpace(r.Reason)) < 8 {
		return nil, nil, errors.New("recovery preparation does not match this student, exam or allowance")
	}
	claimed, err := root.ReadFile(recoveryName(a) + ".consumed")
	if err == nil && string(claimed) != a.ID {
		return nil, nil, errors.New("saved-work recovery has already started")
	}
	if err != nil && !os.IsNotExist(err) {
		return nil, nil, err
	}
	// Also fence a crash after committing the interval but before writing the
	// consumption marker. Cancelled, unstarted preflights do not consume a grant.
	for _, other := range e.state.Attempts {
		if other.ID != a.ID && other.Exam == a.Exam && other.UID == a.UID && other.Start >= r.CreatedAt {
			return nil, nil, errors.New("saved-work recovery has already started")
		}
	}
	source, err := e.Find(r.SourceAttempt)
	if err != nil || source.Username != a.Username || source.UID != a.UID || source.State != "COMPLETED" || !source.Protected || source.Checksum != r.Checksum {
		return nil, nil, errors.New("secured recovery source unavailable")
	}
	manifest, err := ReadProtected(filepath.Join(e.Config.State, "submissions", source.ID), source)
	return &r, manifest, err
}

func (e *Engine) initializeRecovery(a *Attempt, r *RecoveryPreparation, manifest *Manifest, dest string) error {
	claim := filepath.Join(e.Config.State, recoveryName(a)+".consumed")
	if err := durableFile(claim, []byte(a.ID)); err != nil {
		if !os.IsExist(err) {
			return err
		}
		b, err := os.ReadFile(claim)
		if err != nil || string(b) != a.ID {
			return errors.New("recovery consumption conflicts with another attempt")
		}
	}
	if err := syncDirectory(filepath.Dir(claim)); err != nil {
		return err
	}
	archive, err := os.Open(filepath.Join(e.Config.State, "submissions", r.SourceAttempt, "submission.tar.gz"))
	if err != nil {
		return err
	}
	defer archive.Close()
	gz, err := gzip.NewReader(archive)
	if err != nil {
		return err
	}
	defer gz.Close()
	stage, err := os.MkdirTemp(filepath.Dir(dest), ".recovery-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(stage)
	root, err := os.OpenRoot(stage)
	if err != nil {
		return err
	}
	defer root.Close()
	expected := make(map[string]FileEntry, len(manifest.Files))
	for _, file := range manifest.Files {
		if _, exists := expected[file.Path]; exists || file.Size < 0 || file.Size > 32*1024*1024 {
			return errors.New("invalid recovery file manifest")
		}
		expected[file.Path] = file
	}
	seen := map[string]bool{}
	type metadata struct {
		mode     os.FileMode
		modified time.Time
	}
	fileMetadata := map[string]metadata{}
	tr := tar.NewReader(gz)
	var total int64
	for {
		h, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		if h.Name == "MANIFEST.json" && h.Typeflag == tar.TypeReg {
			if h.Size < 0 || h.Size > 4*1024*1024 {
				return errors.New("recovery archive metadata exceeds limit")
			}
			continue
		}
		file, exists := expected[h.Name]
		total += h.Size
		if !exists || seen[h.Name] || h.Typeflag != tar.TypeReg || h.Size != file.Size || path.IsAbs(h.Name) || path.Clean(h.Name) != h.Name || h.Name == ".." || strings.HasPrefix(h.Name, "../") || total > 64*1024*1024 || len(seen) >= 10000 {
			return fmt.Errorf("unsafe or unexpected recovery archive entry: %q", h.Name)
		}
		if err := root.MkdirAll(path.Dir(h.Name), 0700); err != nil {
			return err
		}
		// Extract privately with a writable mode, then restore ordinary metadata
		// after verification and ownership changes. umask must not alter the result.
		f, err := root.OpenFile(h.Name, os.O_CREATE|os.O_EXCL|os.O_WRONLY|syscall.O_NOFOLLOW, 0600)
		if err != nil {
			return err
		}
		hash := sha256.New()
		_, copyErr := io.CopyN(io.MultiWriter(f, hash), tr, h.Size)
		syncErr := f.Sync()
		closeErr := f.Close()
		if copyErr != nil || syncErr != nil || closeErr != nil || hex.EncodeToString(hash.Sum(nil)) != file.Hash {
			return fmt.Errorf("recovery file verification failed: %q", h.Name)
		}
		seen[h.Name] = true
		fileMetadata[h.Name] = metadata{os.FileMode(h.Mode) & 0777, h.ModTime}
	}
	if len(seen) != len(expected) {
		return errors.New("recovery archive is missing saved files")
	}
	account, ok := e.account(a.Username)
	if !ok || account.UID != a.UID {
		return errors.New("recovery account identity unavailable")
	}
	if err := filepath.WalkDir(stage, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		return os.Lchown(p, account.UID, account.GID)
	}); err != nil {
		return err
	}
	for name, meta := range fileMetadata {
		f, err := root.OpenFile(name, os.O_WRONLY|syscall.O_NOFOLLOW, 0)
		if err != nil {
			return err
		}
		info, err := f.Stat()
		if err == nil {
			err = f.Chmod(meta.mode)
		}
		// Tar has no reliable original access/birth/change times. Preserve the
		// extraction access time, not an invented original. A zero epoch mtime
		// is the legacy encoding for absent metadata; retain extraction time.
		if err == nil && !meta.modified.IsZero() && !meta.modified.Equal(time.Unix(0, 0)) {
			atime := info.Sys().(*syscall.Stat_t).Atim
			err = root.Chtimes(name, time.Unix(atime.Sec, atime.Nsec), meta.modified)
		}
		if err == nil {
			err = f.Sync()
		}
		closeErr := f.Close()
		if err != nil {
			return fmt.Errorf("restore recovery file metadata %q: %w", name, err)
		}
		if closeErr != nil {
			return closeErr
		}
	}
	if err := syncSnapshotDirectories(stage); err != nil {
		return err
	}
	// initialize created this empty destination. Remove only an empty directory;
	// never replace a pre-existing workspace containing student files.
	if err := os.Remove(dest); err != nil {
		return err
	}
	if err := os.Rename(stage, dest); err != nil {
		return err
	}
	e.Audit("saved-work-recovery-restored", a.ID, r.SourceAttempt)
	return syncDirectory(filepath.Dir(dest))
}
