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
	"path/filepath"
	"reflect"
	"strings"
	"syscall"
)

type FileEntry struct {
	Path string `json:"path"`
	Size int64  `json:"size"`
	Hash string `json:"sha256"`
}
type Manifest struct {
	Attempt      *Attempt    `json:"attempt"`
	Files        []FileEntry `json:"files"`
	Omissions    []string    `json:"omissions"`
	Collected    int64       `json:"collected"`
	Secured      int64       `json:"secured"`
	Checksum     string      `json:"checksum,omitempty"`
	metadataHash string
}

// Collect reads only through an os.Root and opens regular files O_NOFOLLOW. Its caller must
// have verified every writer is frozen; the protected destination is never student accessible.
func Collect(source, dest string, a *Attempt) (string, error) {
	if _, err := os.Lstat(dest); err == nil {
		manifest, err := ReadProtected(dest, a)
		if err != nil {
			return "", err
		}
		return manifest.Checksum, nil
	} else if !os.IsNotExist(err) {
		return "", err
	}
	info, err := os.Lstat(source)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("authorized source must be a directory, not a link")
	}
	root, err := os.OpenRoot(source)
	if err != nil {
		return "", err
	}
	defer root.Close()
	parent := filepath.Dir(dest)
	if err = os.MkdirAll(parent, 0700); err != nil {
		return "", err
	}
	stage, err := os.MkdirTemp(parent, "."+filepath.Base(dest)+".collect-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(stage)
	f, err := os.OpenFile(filepath.Join(stage, "submission.tar.gz"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return "", err
	}
	defer f.Close()
	gz := gzip.NewWriter(f)
	tw := tar.NewWriter(gz)
	snapshot := *a
	manifest := Manifest{Attempt: &snapshot, Files: []FileEntry{}, Omissions: []string{}}
	var count int
	var total int64
	info, err = root.Stat(".")
	if err != nil {
		return "", err
	}
	device := info.Sys().(*syscall.Stat_t).Dev
	var walk func(string, int) error
	walk = func(name string, depth int) error {
		if depth > 32 {
			return errors.New("submission depth limit exceeded")
		}
		dir, err := root.OpenFile(name, os.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW, 0)
		if err != nil {
			return err
		}
		entries, err := dir.ReadDir(-1)
		dir.Close()
		if err != nil {
			return err
		}
		for _, entry := range entries {
			count++
			if count > 10000 {
				return errors.New("submission file-count limit exceeded")
			}
			p := filepath.ToSlash(filepath.Join(name, entry.Name()))
			if p == "MANIFEST.json" {
				return errors.New("MANIFEST.json is reserved for protected collection metadata")
			}
			if strings.HasPrefix(p, "/") || p == ".." || strings.HasPrefix(p, "../") {
				return errors.New("unsafe archive path")
			}
			i, err := root.Lstat(p)
			if err != nil {
				return err
			}
			st := i.Sys().(*syscall.Stat_t)
			if st.Dev != device {
				return errors.New("unexpected mount crossing")
			}
			if i.Mode()&os.ModeSymlink != 0 {
				manifest.Omissions = append(manifest.Omissions, p+": symlink omitted (never dereferenced)")
				continue
			}
			if i.IsDir() {
				if err = walk(p, depth+1); err != nil {
					return err
				}
				continue
			}
			if !i.Mode().IsRegular() {
				manifest.Omissions = append(manifest.Omissions, p+": special file omitted")
				continue
			}
			if st.Nlink != 1 {
				return fmt.Errorf("hardlinked regular file rejected: %s", p)
			}
			if i.Size() > 32*1024*1024 {
				return fmt.Errorf("per-file logical size exceeded: %s", p)
			}
			total += i.Size()
			if total > 64*1024*1024 {
				return errors.New("submission total logical size exceeded")
			}
			file, err := root.OpenFile(p, os.O_RDONLY|syscall.O_NOFOLLOW, 0)
			if err != nil {
				return err
			}
			current, err := file.Stat()
			if err != nil {
				file.Close()
				return err
			}
			if !os.SameFile(i, current) || !current.Mode().IsRegular() {
				file.Close()
				return errors.New("file changed during collection")
			}
			if err = tw.WriteHeader(&tar.Header{Name: p, Mode: int64(i.Mode().Perm() & 0777), Size: i.Size(), ModTime: i.ModTime(), Typeflag: tar.TypeReg}); err != nil {
				file.Close()
				return err
			}
			h := sha256.New()
			n, err := io.CopyN(io.MultiWriter(tw, h), file, i.Size())
			file.Close()
			if err != nil || n != i.Size() {
				return fmt.Errorf("regular file copy failed: %s", p)
			}
			manifest.Files = append(manifest.Files, FileEntry{p, i.Size(), hex.EncodeToString(h.Sum(nil))})
		}
		return nil
	}
	if err = walk(".", 0); err != nil {
		return "", err
	}
	manifest.Collected = Millis()
	manifest.Attempt.CollectedAt = manifest.Collected
	b, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return "", err
	}
	if err = tw.WriteHeader(&tar.Header{Name: "MANIFEST.json", Mode: 0600, Size: int64(len(b)), Typeflag: tar.TypeReg}); err != nil {
		return "", err
	}
	if _, err = tw.Write(b); err != nil {
		return "", err
	}
	if err = tw.Close(); err != nil {
		return "", err
	}
	if err = gz.Close(); err != nil {
		return "", err
	}
	if err = f.Sync(); err != nil {
		return "", err
	}
	if err = f.Close(); err != nil {
		return "", err
	}
	archive, err := os.Open(filepath.Join(stage, "submission.tar.gz"))
	if err != nil {
		return "", err
	}
	h := sha256.New()
	_, err = io.Copy(h, archive)
	archive.Close()
	if err != nil {
		return "", err
	}
	checksum := hex.EncodeToString(h.Sum(nil))
	manifest.Checksum = checksum
	manifest.Secured = Millis()
	manifest.Attempt.SecuredAt = manifest.Secured
	manifest.Attempt.Checksum = checksum
	manifest.Attempt.Protected = true
	b, err = json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return "", err
	}
	if err = durableFile(filepath.Join(stage, "manifest.json"), b); err != nil {
		return "", err
	}
	if err = durableFile(filepath.Join(stage, "archive.sha256"), []byte(checksum+"\n")); err != nil {
		return "", err
	}
	if _, err = ReadProtected(stage, a); err != nil {
		return "", err
	}
	if err = syncDirectory(stage); err != nil {
		return "", err
	}
	// One complete, nonempty bundle is atomically published. Never replace an existing bundle.
	if err = os.Rename(stage, dest); err != nil {
		if manifest, verifyErr := ReadProtected(dest, a); verifyErr == nil {
			return manifest.Checksum, nil
		}
		return "", err
	}
	if err = syncDirectory(parent); err != nil {
		return "", err
	}
	return checksum, nil
}
func durableFile(path string, data []byte) error {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer f.Close()
	if _, err = f.Write(data); err != nil {
		return err
	}
	if err = f.Sync(); err != nil {
		return err
	}
	return f.Close()
}
func syncDirectory(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return f.Sync()
}

// ReadProtected verifies a published bundle before recovery can adopt it. A damaged existing
// bundle fails closed; it is never overwritten with a fresh view of mutable student work.
func ReadProtected(dest string, a *Attempt) (*Manifest, error) {
	info, err := os.Lstat(dest)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("invalid protected directory")
	}
	root, err := os.OpenRoot(dest)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	read := func(name string) ([]byte, error) {
		f, err := root.OpenFile(name, os.O_RDONLY|syscall.O_NOFOLLOW, 0)
		if err != nil {
			return nil, err
		}
		defer f.Close()
		i, err := f.Stat()
		if err != nil || !i.Mode().IsRegular() {
			return nil, errors.New("invalid protected metadata")
		}
		b, err := io.ReadAll(io.LimitReader(f, 4*1024*1024+1))
		if len(b) > 4*1024*1024 {
			return nil, errors.New("protected metadata limit exceeded")
		}
		return b, err
	}
	b, err := read("manifest.json")
	if err != nil {
		return nil, err
	}
	var m Manifest
	if err = json.Unmarshal(b, &m); err != nil {
		return nil, err
	}
	if len(m.Files)+len(m.Omissions) > 10000 {
		return nil, errors.New("protected manifest entry limit exceeded")
	}
	m.metadataHash = Hash(b)
	if !protectedIdentity(m.Attempt, a) {
		return nil, errors.New("protected manifest identity mismatch")
	}
	sidecar, err := read("archive.sha256")
	if err != nil {
		return nil, err
	}
	f, err := root.OpenFile("submission.tar.gz", os.O_RDONLY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	i, err := f.Stat()
	if err != nil || !i.Mode().IsRegular() || i.Size() > 128*1024*1024 {
		return nil, errors.New("invalid protected archive")
	}
	h := sha256.New()
	if _, err = io.Copy(h, f); err != nil {
		return nil, err
	}
	sum := hex.EncodeToString(h.Sum(nil))
	if strings.TrimSpace(string(sidecar)) != sum || (m.Checksum != "" && m.Checksum != sum) || (a.Checksum != "" && a.Checksum != sum) {
		return nil, errors.New("protected archive checksum mismatch")
	}
	m.Checksum = sum
	return &m, nil
}

func protectedIdentity(x, a *Attempt) bool {
	return x != nil && a != nil && x.ID == a.ID && x.Exam == a.Exam && x.Username == a.Username && x.UID == a.UID && x.Deadline == a.Deadline && x.Start == a.Start && x.Settings == a.Settings && x.OriginalDeadline == a.OriginalDeadline && x.ClockRevision == a.ClockRevision && reflect.DeepEqual(x.ClockResets, a.ClockResets)
}
func appendError(errors []string, message string) []string {
	for _, existing := range errors {
		if existing == message {
			return errors
		}
	}
	return append(errors, message)
}

// Called only in a short state transaction. No filesystem collection, systemd
// waits or worker waits are allowed here. The caller runs the durable job later.
func (e *Engine) beginFinalization(a *Attempt, reason string) error {
	if expired(a) && e.timingRequired(a) {
		return errors.New("collection pending: deadline timing verification required")
	}

	if a.State == "COMPLETED" {
		return nil
	}
	if reason == "" {
		reason = "administrator termination"
	}
	previous := a.State
	if a.CollectionJob == "" || previous == "COLLECTION_FAILED" {
		a.CollectionJob = Token()
	}
	if a.Deadline > 0 && expired(a) {
		reason = "expiration"
	}
	a.State = "FINALIZING"
	a.Authorization = 0
	a.Lease = 0
	if a.Ended == 0 {
		a.Ended = Millis()
		if reason == "expiration" && a.Deadline > 0 && Millis() >= a.Deadline {
			a.Ended = a.Deadline
		}
	}
	if previous != "FINALIZING" && previous != "COLLECTION_FAILED" {
		a.Reason = reason
	}
	return nil
}
