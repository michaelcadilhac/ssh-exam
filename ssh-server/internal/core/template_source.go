package core

// Internal catalog foundation only. Not wired into the agent, student paths or
// examctl yet. Bulk calls must run in a separately bounded template OS worker;
// never call this while holding WithState or in a PTY-owning process.
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
	"strconv"
	"strings"
	"syscall"
	"unicode/utf8"
)

type templateSourceEntry struct {
	Path         string `json:"path"`
	Kind         string `json:"kind"`
	Mode         uint32 `json:"mode"`
	ModifiedSec  int64  `json:"mtime_sec"`
	ModifiedNsec int64  `json:"mtime_nsec"`
	Size         int64  `json:"size,omitempty"`
	SHA256       string `json:"sha256,omitempty"`
}
type templateSourceManifest struct {
	Entries    []templateSourceEntry
	Files      int
	TotalBytes int64
	Hash       string
}
type templateSourceStamp struct {
	Device, Inode, Links, Mount uint64
	Mode                        uint32
	Size                        int64
	Modified, Changed           syscall.Timespec
}
type templateSourceRecord struct {
	entry templateSourceEntry
	stamp templateSourceStamp
	tree  int
	rel   string
}

// mnt_id is the containing mount, not just st_dev: a bind mount on the same
// filesystem must also refuse. See docs.kernel.org/filesystems/proc.html#
// proc-pid-fdinfo-fd-information-about-opened-file. Only our exact live FD is read.
func templateMountID(f *os.File) (uint64, error) {
	in, err := os.Open(fmt.Sprintf("/proc/self/fdinfo/%d", f.Fd()))
	if err != nil {
		return 0, errors.New("template descriptor mount identity unavailable")
	}
	defer in.Close()
	data, err := io.ReadAll(io.LimitReader(in, 16385))
	if err != nil || len(data) > 16384 {
		return 0, errors.New("template descriptor mount identity unavailable")
	}
	for _, line := range strings.Split(string(data), "\n") {
		if value, ok := strings.CutPrefix(line, "mnt_id:"); ok {
			id, err := strconv.ParseUint(strings.TrimSpace(value), 10, 64)
			if err == nil && id > 0 {
				return id, nil
			}
			break
		}
	}
	return 0, errors.New("template descriptor mount identity unavailable")
}
func templateStamp(f *os.File, expectedMount uint64) (templateSourceStamp, os.FileInfo, error) {
	info, err := f.Stat()
	if err != nil {
		return templateSourceStamp{}, nil, err
	}
	mount, err := templateMountID(f)
	if err != nil {
		return templateSourceStamp{}, nil, err
	}
	if mount != expectedMount {
		return templateSourceStamp{}, nil, errors.New("template source crosses a nested mount")
	}
	s := info.Sys().(*syscall.Stat_t)
	return templateSourceStamp{Device: uint64(s.Dev), Inode: s.Ino, Links: uint64(s.Nlink), Mount: mount, Mode: s.Mode, Size: s.Size, Modified: s.Mtim, Changed: s.Ctim}, info, nil
}
func templatePinnedRoot(f *os.File) (*os.Root, error) {
	// Intentional proc-fd traversal of our pinned no-follow descriptor, never a
	// path supplied by a student/author. Each tree has its own confinement root.
	return os.OpenRoot(fmt.Sprintf("/proc/self/fd/%d", f.Fd()))
}

func templateInventory(root *os.Root, prefix string, tree int, mount uint64, limits collectionBounds, total *int64) ([]templateSourceRecord, error) {
	result := []templateSourceRecord{}
	count := 0
	var walk func(string, int) error
	walk = func(rel string, depth int) error {
		if depth > 32 {
			return errors.New("template source directory depth exceeds 32")
		}
		dir, err := root.OpenFile(rel, os.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW, 0)
		if err != nil {
			return err
		}
		defer dir.Close()
		stamp, info, err := templateStamp(dir, mount)
		if err != nil {
			return err
		}
		if !info.IsDir() {
			return errors.New("template directory changed")
		}
		if prefix == "materials" && info.Mode().Perm()&0005 != 0005 {
			return errors.New("materials directories need other-user read/search permissions")
		}
		path := prefix
		if rel != "." {
			path += "/" + filepath.ToSlash(rel)
		}
		result = append(result, templateSourceRecord{entry: templateSourceEntry{Path: path, Kind: "directory", Mode: uint32(info.Mode().Perm()), ModifiedSec: stamp.Modified.Sec, ModifiedNsec: stamp.Modified.Nsec}, stamp: stamp, tree: tree, rel: rel})
		entries, err := dir.ReadDir(10001 - count)
		if err != nil && err != io.EOF {
			return err
		}
		count += len(entries)
		if count > 10000 {
			return errors.New("template source tree exceeds 10000 entries")
		}
		sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
		for _, entry := range entries {
			if !utf8.ValidString(entry.Name()) {
				return errors.New("template paths must be valid UTF-8")
			}
			name := filepath.Join(rel, entry.Name())
			if prefix == "work" && name == "MANIFEST.json" {
				return errors.New("work/MANIFEST.json is reserved for protected collection metadata")
			}
			before, err := root.Lstat(name)
			if err != nil {
				return err
			}
			if before.IsDir() {
				if err := walk(name, depth+1); err != nil {
					return err
				}
				continue
			}
			if !before.Mode().IsRegular() || before.Sys().(*syscall.Stat_t).Nlink != 1 {
				return fmt.Errorf("template entry %q is a link or special file", name)
			}
			if before.Size() < 0 || before.Size() > limits.File || before.Size() > limits.Total-*total {
				return errors.New("template source exceeds declared logical file/total bounds")
			}
			if prefix == "materials" && before.Mode().Perm()&0004 == 0 {
				return errors.New("materials files need other-user read permission")
			}
			file, err := root.OpenFile(name, os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
			if err != nil {
				return err
			}
			stamp, current, err := templateStamp(file, mount)
			closeErr := file.Close()
			if err != nil {
				return err
			}
			if closeErr != nil {
				return closeErr
			}
			if !os.SameFile(before, current) || !current.Mode().IsRegular() || stamp.Links != 1 {
				return errors.New("template entry changed during inventory")
			}
			if current.Size() < 0 || current.Size() > limits.File || current.Size() > limits.Total-*total {
				return errors.New("template source exceeds declared logical file/total bounds")
			}
			if prefix == "materials" && current.Mode().Perm()&0004 == 0 {
				return errors.New("materials files need other-user read permission")
			}
			*total += current.Size()
			result = append(result, templateSourceRecord{entry: templateSourceEntry{Path: prefix + "/" + filepath.ToSlash(name), Kind: "file", Mode: uint32(current.Mode().Perm()), ModifiedSec: stamp.Modified.Sec, ModifiedNsec: stamp.Modified.Nsec, Size: current.Size()}, stamp: stamp, tree: tree, rel: name})
		}
		return nil
	}
	if err := walk(".", 0); err != nil {
		return nil, err
	}
	return result, nil
}

// Read-only, bounded source fingerprint. Pre/post inventories bracket ALL file
// reads and reject observed mutations, including an earlier file changing after
// hashing. This is not an atomic filesystem snapshot or a hostile-writer freeze:
// the eventual worker must import quiescent input and verify its own private copy
// before publication. Physical inode/device/ctime/mount values fence observed
// races but are not part of content identity.
// checkpoint is an internal test barrier only, never configuration/environment.
func inspectTemplateSource(source string, limits collectionBounds, checkpoint func(string) error) (*templateSourceManifest, error) {
	if !filepath.IsAbs(source) || filepath.Clean(source) != source || limits.File < 1 || limits.File > 4096*mib || limits.Total < limits.File || limits.Total > 16384*mib {
		return nil, errors.New("template inspection requires a clean absolute source and explicit bounded logical limits")
	}
	file, err := os.OpenFile(source, os.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	mount, err := templateMountID(file)
	if err != nil {
		return nil, err
	}
	initial, _, err := templateStamp(file, mount)
	if err != nil {
		return nil, err
	}
	root, err := templatePinnedRoot(file)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	listing, err := root.OpenFile(".", os.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return nil, err
	}
	children, readErr := listing.ReadDir(3)
	_ = listing.Close()
	if readErr != nil && readErr != io.EOF {
		return nil, readErr
	}
	if len(children) != 2 {
		return nil, errors.New("template source must contain only work/ and materials/; keep instructor files outside it")
	}
	for _, child := range children {
		if child.Name() != "work" && child.Name() != "materials" {
			return nil, errors.New("template source must contain only work/ and materials/")
		}
	}
	roots := make([]*os.Root, 0, 2)
	defer func() {
		for _, r := range roots {
			_ = r.Close()
		}
	}()
	for _, name := range []string{"work", "materials"} {
		f, err := root.OpenFile(name, os.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW, 0)
		if err != nil {
			return nil, err
		}
		_, _, err = templateStamp(f, mount)
		if err != nil {
			f.Close()
			return nil, err
		}
		r, err := templatePinnedRoot(f)
		closeErr := f.Close()
		if err != nil {
			return nil, err
		}
		if closeErr != nil {
			r.Close()
			return nil, closeErr
		}
		roots = append(roots, r)
	}
	collect := func() ([]templateSourceRecord, error) {
		all := []templateSourceRecord{}
		var total int64
		for i, name := range []string{"work", "materials"} {
			rows, err := templateInventory(roots[i], name, i, mount, limits, &total)
			if err != nil {
				return nil, err
			}
			all = append(all, rows...)
		}
		sort.Slice(all, func(i, j int) bool { return all[i].entry.Path < all[j].entry.Path })
		return all, nil
	}
	records, err := collect()
	if err != nil {
		return nil, err
	}
	if checkpoint != nil {
		if err := checkpoint("inventoried"); err != nil {
			return nil, err
		}
	}
	manifest := &templateSourceManifest{Entries: make([]templateSourceEntry, 0, len(records))}
	for i := range records {
		r := &records[i]
		if r.entry.Kind == "file" {
			f, err := roots[r.tree].OpenFile(r.rel, os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
			if err != nil {
				return nil, err
			}
			stamp, _, err := templateStamp(f, mount)
			if err != nil || stamp != r.stamp {
				f.Close()
				return nil, errors.New("template source changed before hashing")
			}
			h := sha256.New()
			_, readErr := io.CopyN(h, f, r.entry.Size)
			after, _, statErr := templateStamp(f, mount)
			closeErr := f.Close()
			if readErr != nil {
				return nil, readErr
			}
			if statErr != nil || after != r.stamp {
				return nil, errors.New("template source changed during hashing")
			}
			if closeErr != nil {
				return nil, closeErr
			}
			r.entry.SHA256 = hex.EncodeToString(h.Sum(nil))
			manifest.Files++
			manifest.TotalBytes += r.entry.Size
			if checkpoint != nil {
				if err := checkpoint("hashed:" + r.entry.Path); err != nil {
					return nil, err
				}
			}
		}
		manifest.Entries = append(manifest.Entries, r.entry)
	}
	if checkpoint != nil {
		if err := checkpoint("hashed"); err != nil {
			return nil, err
		}
	}
	final, err := collect()
	if err != nil {
		return nil, err
	}
	if len(final) != len(records) {
		return nil, errors.New("template source changed after hashing")
	}
	for i, r := range records {
		if final[i].entry.Path != r.entry.Path || final[i].stamp != r.stamp {
			return nil, errors.New("template source changed after hashing")
		}
	}
	last, _, err := templateStamp(file, mount)
	if err != nil {
		return nil, err
	}
	if last != initial {
		return nil, errors.New("template source layout changed during inspection")
	}
	// Canonical NDJSON streams one bounded entry at a time, not one allocation
	// proportional to source bytes or an entire long-path manifest encoding.
	h := sha256.New()
	_, _ = io.WriteString(h, "ssh-exam-template-source/v1\n")
	encoder := json.NewEncoder(h)
	_ = encoder.Encode([]int64{int64(len(manifest.Entries)), int64(manifest.Files), manifest.TotalBytes})
	for _, entry := range manifest.Entries {
		if err := encoder.Encode(entry); err != nil {
			return nil, err
		}
	}
	manifest.Hash = hex.EncodeToString(h.Sum(nil))
	return manifest, nil
}
