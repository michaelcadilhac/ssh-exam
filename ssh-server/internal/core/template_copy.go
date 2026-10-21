package core

// Internal/unwired catalog foundation. This must run only in the eventual
// resource-bounded template worker, never under WithState or in a PTY owner.
// No installed version, manifest, grant or public capability is created here.
import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"syscall"
	"time"
)

// Refuse physical containment too: lexical paths alone miss aliased ancestors.
// Both arguments are pinned descriptors; climbing .. never follows an author
// symlink. The final parent is retained by the caller through every output write.
func templateCopyOutsideSource(parent, source *os.File, input *os.Root, entries []templateSourceEntry, mount uint64) error {
	sourceInfo, err := source.Stat()
	if err != nil {
		return err
	}
	type identity struct{ device, inode uint64 }
	key := func(info os.FileInfo) identity {
		s := info.Sys().(*syscall.Stat_t)
		return identity{uint64(s.Dev), s.Ino}
	}
	inside := map[identity]bool{key(sourceInfo): true}
	for _, entry := range entries {
		if entry.Kind != "directory" {
			continue
		}
		f, err := input.OpenFile(entry.Path, os.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW, 0)
		if err != nil {
			return err
		}
		_, info, statErr := templateStamp(f, mount)
		closeErr := f.Close()
		if err := errors.Join(statErr, closeErr); err != nil {
			return err
		}
		inside[key(info)] = true
	}
	current, err := os.OpenFile(fmt.Sprintf("/proc/self/fd/%d/.", parent.Fd()), os.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return err
	}
	defer func() { _ = current.Close() }()
	for i := 0; i < 4096; i++ {
		info, err := current.Stat()
		if err != nil {
			return err
		}
		// A bind alias of a source subdirectory has a different parent chain;
		// compare every inventoried directory identity, not just the top root.
		if inside[key(info)] {
			return errors.New("template copy destination must be outside the authored source")
		}
		next, err := os.OpenFile(fmt.Sprintf("/proc/self/fd/%d/..", current.Fd()), os.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW, 0)
		if err != nil {
			return err
		}
		nextInfo, err := next.Stat()
		if err != nil {
			next.Close()
			return err
		}
		if os.SameFile(info, nextInfo) {
			next.Close()
			return nil
		}
		current.Close()
		current = next
	}
	return errors.New("template copy destination ancestry exceeds safety bound")
}

// Create one fresh private copy without ever replacing an existing path. A
// failure deliberately leaves an incomplete private directory, never a ready
// marker or published version. Only a later worker-owned staging lifecycle may
// remove its own failed directory. Source bytes are never edited or removed.
// checkpoint is a test barrier only, not configuration/environment authority.
func copyTemplateSource(source, destination string, limits collectionBounds, checkpoint func(string) error) (*templateSourceManifest, error) {
	if !filepath.IsAbs(destination) || filepath.Clean(destination) != destination || destination == "/" {
		return nil, errors.New("template copy requires a fresh clean absolute private destination")
	}
	expected, err := inspectTemplateSource(source, limits, nil)
	if err != nil {
		return nil, err
	}
	if checkpoint != nil {
		if err := checkpoint("inspected"); err != nil {
			return nil, err
		}
	}
	in, err := os.OpenFile(source, os.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return nil, err
	}
	defer in.Close()
	mount, err := templateMountID(in)
	if err != nil {
		return nil, err
	}
	input, err := templatePinnedRoot(in)
	if err != nil {
		return nil, err
	}
	defer input.Close()
	parent, err := os.OpenFile(filepath.Dir(destination), os.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return nil, err
	}
	defer parent.Close()
	info, err := parent.Stat()
	if err != nil {
		return nil, err
	}
	if info.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) || info.Mode().Perm() != 0700 {
		return nil, errors.New("template copy parent must be owned and private (0700)")
	}
	if err := templateCopyOutsideSource(parent, in, input, expected.Entries, mount); err != nil {
		return nil, err
	}
	outputParent, err := templatePinnedRoot(parent)
	if err != nil {
		return nil, err
	}
	defer outputParent.Close()
	name := filepath.Base(destination)
	if err := outputParent.Mkdir(name, 0700); err != nil {
		return nil, fmt.Errorf("create fresh template staging directory (never overwrite): %w", err)
	}
	stage, err := outputParent.OpenFile(name, os.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return nil, err
	}
	defer stage.Close()
	output, err := templatePinnedRoot(stage)
	if err != nil {
		return nil, err
	}
	defer output.Close()
	buffer := make([]byte, 64*1024)
	for _, entry := range expected.Entries {
		if entry.Kind == "directory" {
			if err := output.Mkdir(entry.Path, 0700); err != nil {
				return nil, err
			}
			continue
		}
		if err := copyTemplateEntry(input, output, entry, mount, buffer); err != nil {
			return nil, err
		}
		if checkpoint != nil {
			if err := checkpoint("copied:" + entry.Path); err != nil {
				return nil, err
			}
		}
	}
	// Populate children before restoring directory metadata, deepest first.
	for i := len(expected.Entries) - 1; i >= 0; i-- {
		entry := expected.Entries[i]
		if entry.Kind != "directory" {
			continue
		}
		if err := output.Chmod(entry.Path, os.FileMode(entry.Mode)); err != nil {
			return nil, err
		}
		modified := time.Unix(entry.ModifiedSec, entry.ModifiedNsec)
		if err := output.Chtimes(entry.Path, modified, modified); err != nil {
			return nil, err
		}
	}
	if checkpoint != nil {
		if err := checkpoint("copied"); err != nil {
			return nil, err
		}
	}
	// Verify our own copy, not just the mutable source's earlier fingerprint.
	// Intentional pinned parent traversal, never a source-controlled output path.
	pinned := fmt.Sprintf("/proc/self/fd/%d/%s", parent.Fd(), name)
	actual, err := inspectTemplateSource(pinned, limits, nil)
	if err != nil {
		return nil, err
	}
	if actual.Hash != expected.Hash {
		return nil, errors.New("private template copy differs from inspected source; keep it unpublished")
	}
	final, err := inspectTemplateSource(source, limits, nil)
	if err != nil {
		return nil, err
	}
	if final.Hash != expected.Hash {
		return nil, errors.New("template source changed during copy; keep private copy unpublished")
	}
	if err := syncSnapshotDirectories(pinned); err != nil {
		return nil, err
	}
	if err := parent.Sync(); err != nil {
		return nil, err
	}
	return actual, nil
}

func copyTemplateEntry(input, output *os.Root, entry templateSourceEntry, mount uint64, buffer []byte) error {
	in, err := input.OpenFile(entry.Path, os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	if err != nil {
		return err
	}
	defer in.Close()
	stamp, info, err := templateStamp(in, mount)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || stamp.Links != 1 || info.Size() != entry.Size || uint32(info.Mode().Perm()) != entry.Mode || stamp.Modified.Sec != entry.ModifiedSec || stamp.Modified.Nsec != entry.ModifiedNsec {
		return errors.New("template source file changed before copying")
	}
	out, err := output.OpenFile(entry.Path, os.O_WRONLY|os.O_CREATE|os.O_EXCL|syscall.O_NOFOLLOW, 0600)
	if err != nil {
		return err
	}
	defer out.Close()
	digest := sha256.New()
	n, err := io.CopyBuffer(io.MultiWriter(out, digest), io.LimitReader(in, entry.Size+1), buffer)
	if err != nil {
		return err
	}
	after, _, err := templateStamp(in, mount)
	if err != nil {
		return err
	}
	if n != entry.Size || after != stamp || hex.EncodeToString(digest.Sum(nil)) != entry.SHA256 {
		return errors.New("template source file changed while copying")
	}
	if err := out.Chmod(os.FileMode(entry.Mode)); err != nil {
		return err
	}
	modified := time.Unix(entry.ModifiedSec, entry.ModifiedNsec)
	if err := output.Chtimes(entry.Path, modified, modified); err != nil {
		return err
	}
	if err := out.Sync(); err != nil {
		return err
	}
	return out.Close()
}
