package core

// The destructive worker pins every object, rejects opaque object types, seals
// every directory and keeps exclusive regular-file leases until removal ends.
// Queued SCM_RIGHTS and other hidden open file descriptions must refuse a lease.
import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"sort"
	"strings"
	"syscall"

	"golang.org/x/sys/unix"
)

type cleanupTree struct {
	entries []workspaceCleanupEntry
	files   map[string]*os.File
	owned   map[int]workspaceObject
	leases  []*os.File
	breaks  chan os.Signal
}

func (t *cleanupTree) close() {
	for _, f := range t.leases {
		_, _ = unix.FcntlInt(f.Fd(), unix.F_SETLEASE, unix.F_UNLCK)
	}
	for _, f := range t.files {
		_ = f.Close()
	}
	if t.breaks != nil {
		signal.Stop(t.breaks)
	}
}

func cleanupFileHash(f *os.File, limit int64) (string, error) {
	var before, after unix.Stat_t
	if unix.Fstat(int(f.Fd()), &before) != nil || before.Mode&unix.S_IFMT != unix.S_IFREG || before.Nlink != 1 || before.Size < 0 || before.Size > limit {
		return "", errWorkspaceUsage
	}
	h := sha256.New()
	n, err := io.Copy(h, io.NewSectionReader(f, 0, limit+1))
	if err != nil || n != before.Size || unix.Fstat(int(f.Fd()), &after) != nil || before != after {
		return "", errors.New("workspace file changed or exceeds its saved collection limit; preserve it")
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func openCleanupTree(path string, expected WorkspacePathIdentity, limits collectionBounds) (*cleanupTree, error) {
	t := &cleanupTree{files: map[string]*os.File{}, owned: map[int]workspaceObject{}}
	ok := false
	defer func() {
		if !ok {
			t.close()
		}
	}()
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_NONBLOCK|unix.O_CLOEXEC|unix.O_NOATIME, 0)
	if err != nil {
		return nil, err
	}
	root := os.NewFile(uintptr(fd), "cleanup-root")
	t.files[""] = root
	var rootStat unix.Stat_t
	if unix.Fstat(fd, &rootStat) != nil || fmt.Sprint(uint64(rootStat.Dev)) != expected.Device || fmt.Sprint(rootStat.Ino) != expected.Inode {
		return nil, errors.New("reviewed workspace inode changed; preserve both targets")
	}
	mount, err := workspaceFDInfo(root)
	if err != nil {
		return nil, err
	}
	seen := map[workspaceObject]bool{}
	var total, receipts int64
	var visit func(string, *os.File, unix.Stat_t, int) error
	visit = func(name string, f *os.File, st unix.Stat_t, depth int) error {
		if depth > 34 || len(t.entries) >= 20000 || st.Dev != rootStat.Dev {
			return errWorkspaceUsage
		}
		object := workspaceObject{uint64(st.Dev), st.Ino}
		if seen[object] {
			return errors.New("workspace has shared inode/hardlink aliases; preserve and inspect")
		}
		seen[object] = true
		entry := workspaceCleanupEntry{Path: name, Device: uint64(st.Dev), Inode: st.Ino, Mode: st.Mode, UID: st.Uid, GID: st.Gid, Size: st.Size}
		if f != nil {
			t.owned[int(f.Fd())] = object
			if id, err := workspaceFDInfo(f); err != nil || id != mount {
				return errors.New("workspace crosses a mount boundary; cleanup refused")
			}
		}
		switch st.Mode & unix.S_IFMT {
		case unix.S_IFREG:
			var err error
			entry.Hash, err = cleanupFileHash(f, limits.File)
			if err != nil {
				return err
			}
			if strings.HasPrefix(name, "work/") {
				total += st.Size
				if total > limits.Total {
					return errors.New("workspace exceeds its saved total collection limit; preserve and inspect")
				}
			} else {
				if name != "initialized" && name != "workspace-ready/receipt.json" {
					return fmt.Errorf("unknown private workspace artifact %q; preserve it; cleanup does not guess receipt semantics", name)
				}
				if st.Size > 16384 || st.Uid != 0 || st.Mode&0077 != 0 {
					return errWorkspaceUsage
				}
				entry.Receipt = make([]byte, st.Size)
				if _, err := f.ReadAt(entry.Receipt, 0); err != nil && err != io.EOF {
					return err
				}
				receipts += st.Size
				if receipts > 32768 {
					return errWorkspaceUsage
				}
			}
		case unix.S_IFDIR:
			if name != "" && name != "work" && !strings.HasPrefix(name, "work/") && name != "workspace-ready" {
				return errors.New("unknown private workspace directory; preserve it")
			}
		case unix.S_IFLNK:
			if !strings.HasPrefix(name, "work/") {
				return errWorkspaceUsage
			}
			parent := t.files[filepath.Dir(name)]
			if filepath.Dir(name) == "." {
				parent = t.files[""]
			}
			buf := make([]byte, 4097)
			n, err := unix.Readlinkat(int(parent.Fd()), filepath.Base(name), buf)
			if err != nil || n == 0 || n > 4096 {
				return errWorkspaceUsage
			}
			entry.Link = string(buf[:n])
		default:
			return errors.New("socket, FIFO, device or unsupported workspace object; preserve it; no cleanup permission established")
		}
		t.entries = append(t.entries, entry)
		if st.Mode&unix.S_IFMT != unix.S_IFDIR {
			return nil
		}
		children, err := f.ReadDir(20001 - len(t.entries))
		if err != nil && err != io.EOF {
			return err
		}
		if len(t.entries)+len(children) > 20000 {
			return errWorkspaceUsage
		}
		for _, child := range children {
			childName := child.Name()
			if filepath.Base(childName) != childName || childName == "." || childName == ".." {
				return errWorkspaceUsage
			}
			var next unix.Stat_t
			if unix.Fstatat(int(f.Fd()), childName, &next, unix.AT_SYMLINK_NOFOLLOW|unix.AT_NO_AUTOMOUNT) != nil {
				return errWorkspaceUsage
			}
			relative := childName
			if name != "" {
				relative = name + "/" + childName
			}
			var opened *os.File
			if next.Mode&unix.S_IFMT != unix.S_IFLNK {
				flags := unix.O_RDONLY | unix.O_NONBLOCK | unix.O_NOFOLLOW | unix.O_CLOEXEC | unix.O_NOATIME
				if next.Mode&unix.S_IFMT == unix.S_IFDIR {
					flags |= unix.O_DIRECTORY
				} else if next.Mode&unix.S_IFMT != unix.S_IFREG {
					return errors.New("unsupported workspace object; preserve and inspect")
				}
				fd, err := unix.Openat(int(f.Fd()), childName, flags, 0)
				if err != nil {
					return err
				}
				opened = os.NewFile(uintptr(fd), "cleanup-pinned-object")
				t.files[relative] = opened
				var actual unix.Stat_t
				if unix.Fstat(fd, &actual) != nil || actual.Dev != next.Dev || actual.Ino != next.Ino || actual.Mode != next.Mode {
					return errWorkspaceUsage
				}
			}
			if err := visit(relative, opened, next, depth+1); err != nil {
				return err
			}
		}
		return nil
	}
	if err := visit("", root, rootStat, 0); err != nil {
		return nil, err
	}
	sort.Slice(t.entries, func(i, j int) bool { return t.entries[i].Path < t.entries[j].Path })
	ok = true
	return t, nil
}

func (t *cleanupTree) acquireLeases() error {
	t.breaks = make(chan os.Signal, 1)
	signal.Notify(t.breaks, syscall.SIGIO)
	for _, entry := range t.entries {
		if entry.Mode&unix.S_IFMT != unix.S_IFREG {
			continue
		}
		f := t.files[entry.Path]
		if _, err := unix.FcntlInt(f.Fd(), unix.F_SETOWN, os.Getpid()); err != nil {
			return err
		}
		if _, err := unix.FcntlInt(f.Fd(), unix.F_SETLEASE, unix.F_WRLCK); err != nil {
			return fmt.Errorf("exclusive file-reference barrier refused for %q: %w; preserve work and retry after its users release it", entry.Path, err)
		}
		t.leases = append(t.leases, f)
		hash, err := cleanupFileHash(f, entry.Size)
		if err != nil || hash != entry.Hash {
			return errors.New("workspace changed before exclusive lease; preserve the new bytes and inspect the archive")
		}
	}
	return t.checkLeases()
}

func (t *cleanupTree) checkLeases() error {
	select {
	case <-t.breaks:
		return errors.New("workspace lease break requested; cleanup stopped; inspect cleanup-status and preserve remaining work")
	default:
	}
	for _, f := range t.leases {
		lease, err := unix.FcntlInt(f.Fd(), unix.F_GETLEASE, 0)
		if err != nil || lease != unix.F_WRLCK {
			return errors.New("workspace exclusive reference barrier lost; preserve remaining work and inspect cleanup-status")
		}
	}
	return nil
}

func (t *cleanupTree) checkRemovalLease(entry workspaceCleanupEntry) error {
	select {
	case <-t.breaks:
		return errors.New("workspace lease break requested; remaining data preserved")
	default:
	}
	if entry.Mode&unix.S_IFMT != unix.S_IFREG {
		return nil
	}
	f := t.files[entry.Path]
	if f == nil {
		return errWorkspaceUsage
	}
	lease, err := unix.FcntlInt(f.Fd(), unix.F_GETLEASE, 0)
	if err != nil || lease != unix.F_WRLCK {
		return errors.New("target file reference barrier lost; remaining data preserved")
	}
	return nil
}

func (t *cleanupTree) seal() error {
	for _, entry := range t.entries {
		if entry.Mode&unix.S_IFMT != unix.S_IFDIR {
			continue
		}
		f := t.files[entry.Path]
		if err := f.Chown(0, 0); err != nil {
			return err
		}
		if err := f.Chmod(0500); err != nil {
			return err
		}
		if err := f.Sync(); err != nil {
			return err
		}
	}
	if err := t.checkLeases(); err != nil {
		return err
	}
	// Directory permissions also fence descriptors queued only in SCM_RIGHTS.
	// Repeat the complete shape after sealing; a pre-seal insertion is not adopted.
	fd, err := unix.Openat(int(t.files[""].Fd()), ".", unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC|unix.O_NOATIME, 0)
	if err != nil {
		return err
	}
	root := os.NewFile(uintptr(fd), "cleanup-sealed-inventory")
	defer root.Close()
	actual, err := inventoryWorkspace(root)
	if err != nil {
		return err
	}
	rows := []string{}
	for _, entry := range t.entries {
		name := entry.Path
		if name != "" {
			name = "/" + name
		}
		mode := entry.Mode
		if mode&unix.S_IFMT == unix.S_IFDIR {
			mode = unix.S_IFDIR | 0500
		}
		rows = append(rows, fmt.Sprintf("%q:%d:%d:%d", name, entry.Device, entry.Inode, mode))
	}
	sort.Strings(rows)
	if actual.Digest != Hash([]byte(strings.Join(rows, "\n"))) {
		return errors.New("workspace tree changed before the complete directory barrier; remaining data preserved")
	}
	return nil
}
