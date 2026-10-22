package core

// Unwired bounded kernel hierarchy observations only, NOT an atomic snapshot,
// closed launch/delegation admission, all-writer stop, freeze or cleanup permit.
import (
	"io"
	"os"
	"path"
	"reflect"
	"sort"
	"strings"

	"golang.org/x/sys/unix"
)

const retainedScopeLimit = 128
const retainedScopeDepth = 32
const retainedScopeEntries = 4096

type retainedScopeIdentity struct {
	Device, Inode uint64
}

type retainedScopeObservation struct {
	Relative string
	Identity retainedScopeIdentity
	Threads  []int
}

type retainedScopeChild struct {
	Name     string
	Identity retainedScopeIdentity
}

type retainedScopeBudget struct{ Scopes, Depth, Threads int }

func retainedScopeStat(scope *os.File) (retainedScopeIdentity, error) {
	if scope == nil {
		return retainedScopeIdentity{}, errRetainedThreadInventory
	}
	raw, err := scope.SyscallConn()
	if err != nil {
		return retainedScopeIdentity{}, errRetainedThreadInventory
	}
	var fs unix.Statfs_t
	var info unix.Stat_t
	var inner error
	err = raw.Control(func(fd uintptr) {
		if unix.Fstatfs(int(fd), &fs) != nil || fs.Type != unix.CGROUP2_SUPER_MAGIC || unix.Fstat(int(fd), &info) != nil || info.Mode&unix.S_IFMT != unix.S_IFDIR {
			inner = errRetainedThreadInventory
		}
	})
	if err != nil || inner != nil {
		return retainedScopeIdentity{}, errRetainedThreadInventory
	}
	return retainedScopeIdentity{uint64(info.Dev), info.Ino}, nil
}

// Open only a single directory leaf relative to a retained real kernel handle.
// This never resolves a stored absolute pathname or follows a symlink.
func openRetainedScopeAt(parent *os.File, name string) (*os.File, error) {
	if _, err := retainedScopeStat(parent); err != nil || name == "" || name == ".." || strings.ContainsAny(name, "/\x00") {
		return nil, errRetainedThreadInventory
	}
	raw, err := parent.SyscallConn()
	if err != nil {
		return nil, errRetainedThreadInventory
	}
	fd := -1
	var inner error
	err = raw.Control(func(parent uintptr) {
		fd, inner = unix.Openat(int(parent), name, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC|unix.O_NONBLOCK, 0)
	})
	if err != nil || inner != nil || fd < 0 {
		if fd >= 0 {
			unix.Close(fd)
		}
		return nil, errRetainedThreadInventory
	}
	f := os.NewFile(uintptr(fd), "retained-kernel-scope")
	if _, err := retainedScopeStat(f); err != nil {
		f.Close()
		return nil, err
	}
	return f, nil
}

func retainedScopeChildren(scope *os.File) ([]retainedScopeChild, error) {
	// A new description preserves the retained handle's enumeration position.
	dir, err := openRetainedScopeAt(scope, ".")
	if err != nil {
		return nil, err
	}
	defer dir.Close()
	entries, err := dir.ReadDir(retainedScopeEntries + 1)
	if (err != nil && err != io.EOF) || len(entries) > retainedScopeEntries {
		return nil, errRetainedThreadInventory
	}
	raw, err := dir.SyscallConn()
	if err != nil {
		return nil, errRetainedThreadInventory
	}
	children := []retainedScopeChild{}
	for _, entry := range entries {
		name := entry.Name()
		if name == "" || name == "." || name == ".." || strings.ContainsAny(name, "/\x00") {
			return nil, errRetainedThreadInventory
		}
		var info unix.Stat_t
		var inner error
		err := raw.Control(func(fd uintptr) { inner = unix.Fstatat(int(fd), name, &info, unix.AT_SYMLINK_NOFOLLOW) })
		if err != nil || inner != nil || info.Mode&unix.S_IFMT == unix.S_IFLNK {
			return nil, errRetainedThreadInventory
		}
		if info.Mode&unix.S_IFMT == unix.S_IFDIR {
			children = append(children, retainedScopeChild{name, retainedScopeIdentity{uint64(info.Dev), info.Ino}})
		}
	}
	sort.Slice(children, func(i, j int) bool { return children[i].Name < children[j].Name })
	return children, nil
}

func observeRetainedScopeTree(scope *os.File) ([]retainedScopeObservation, error) {
	return observeRetainedScopeTreeCheckpoint(scope, nil)
}

// Private test checkpoint only, never supplied by config/RPC/environment. Each
// node is bracketed for identity, membership and children; this still cannot
// establish global atomicity or stop concurrent migration without the full gate.
func observeRetainedScopeTreeCheckpoint(scope *os.File, checkpoint func(string) error) ([]retainedScopeObservation, error) {
	return observeRetainedScopeTreeBounded(scope, retainedScopeBudget{retainedScopeLimit, retainedScopeDepth, retainedThreadLimit}, checkpoint)
}

// Internal lower-budget test seam only; neither configured nor caller supplied
// in a live protocol. It can reduce but never enlarge the supported hard bounds.
func observeRetainedScopeTreeBounded(scope *os.File, budget retainedScopeBudget, checkpoint func(string) error) ([]retainedScopeObservation, error) {
	if budget.Scopes < 1 || budget.Scopes > retainedScopeLimit || budget.Depth < 0 || budget.Depth > retainedScopeDepth || budget.Threads < 1 || budget.Threads > retainedThreadLimit {
		return nil, errRetainedThreadInventory
	}
	observed := []retainedScopeObservation{}
	threads := map[int]bool{}
	inodes := map[retainedScopeIdentity]bool{}
	var walk func(*os.File, string, int) error
	walk = func(dir *os.File, relative string, depth int) error {
		if depth > budget.Depth || len(observed) >= budget.Scopes {
			return errRetainedThreadInventory
		}
		identity, err := retainedScopeStat(dir)
		if err != nil || inodes[identity] {
			return errRetainedThreadInventory
		}
		inodes[identity] = true
		ids, err := readRetainedCgroupThreads(dir)
		if err != nil {
			return err
		}
		for _, id := range ids {
			if threads[id] || len(threads) >= budget.Threads {
				return errRetainedThreadInventory // Observed migration/duplicate is uncertainty.
			}
			threads[id] = true
		}
		children, err := retainedScopeChildren(dir)
		if err != nil || len(observed)+len(children) >= budget.Scopes {
			return errRetainedThreadInventory
		}
		observed = append(observed, retainedScopeObservation{relative, identity, ids})
		if checkpoint != nil {
			if err := checkpoint(relative); err != nil {
				return err
			}
		}
		for _, child := range children {
			f, err := openRetainedScopeAt(dir, child.Name)
			if err != nil {
				return err
			}
			actual, err := retainedScopeStat(f)
			if err == nil && actual != child.Identity {
				err = errRetainedThreadInventory
			}
			if err == nil {
				err = walk(f, path.Join(relative, child.Name), depth+1)
			}
			closed := f.Close()
			if err != nil || closed != nil {
				return errRetainedThreadInventory
			}
		}
		current, err := retainedScopeStat(dir)
		if err != nil || current != identity {
			return errRetainedThreadInventory
		}
		finalIDs, err := readRetainedCgroupThreads(dir)
		if err != nil || !reflect.DeepEqual(ids, finalIDs) {
			return errRetainedThreadInventory
		}
		finalChildren, err := retainedScopeChildren(dir)
		if err != nil || !reflect.DeepEqual(children, finalChildren) {
			return errRetainedThreadInventory
		}
		return nil
	}
	if err := walk(scope, ".", 0); err != nil {
		return nil, errRetainedThreadInventory // Never return partially plausible coverage.
	}
	return observed, nil
}
