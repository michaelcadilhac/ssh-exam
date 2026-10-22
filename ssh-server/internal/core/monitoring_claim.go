package core

// Private coordination groundwork only. This claim excludes cooperating local
// actors; it does NOT verify SSH ancestry, ACTIVE state or permission to work.
// No live entry point or monitoringActiveSeal factory uses it yet. Open/dup/close
// belong outside the authority lock; current() is a memory-only predicate.

import (
	"errors"
	"os"
	"sync"
	"sync/atomic"
	"syscall"

	"golang.org/x/sys/unix"
)

var errMonitoringClaim = errors.New("native monitoring ownership unavailable or unsafe; preserve coordination files and inspect the current owner; no new authority established")
var errMonitoringClaimBusy = errors.New("native monitoring owner or publisher still holds the attempt claim; do not remove its lock; no replacement authority established")

type monitoringOwnerClaim struct {
	mu   sync.Mutex
	file *os.File
	live atomic.Bool
}

// Use an existing protected state directory, never initialize/repair the agent.
// Only this dedicated coordination subdirectory and persistent empty lock inode
// may be created. Lock inodes are never renamed, truncated, unlinked or unlocked
// explicitly: a publisher can inherit the SAME open-file description, retaining
// exclusion after coordinator death until that publisher exits as well.
func claimMonitoringOwner(state, attempt string) (*monitoringOwnerClaim, error) {
	if !monitoringUUID.MatchString(attempt) {
		return nil, errMonitoringClaim
	}
	root, err := readOnlyRoot(state)
	if err != nil {
		return nil, errMonitoringClaim
	}
	defer root.Close()
	raw, err := root.SyscallConn()
	if err != nil {
		return nil, errMonitoringClaim
	}
	var inner error
	if err = raw.Control(func(fd uintptr) { inner = unix.Mkdirat(int(fd), "monitoring-control", 0700) }); err != nil || (inner != nil && !errors.Is(inner, unix.EEXIST)) {
		return nil, errMonitoringClaim
	}
	dir, err := readOnlyOpenAt(root, "monitoring-control", true)
	if err != nil {
		return nil, errMonitoringClaim
	}
	defer dir.Close()
	raw, err = dir.SyscallConn()
	if err != nil {
		return nil, errMonitoringClaim
	}
	name := attempt + ".lock"
	fd := -1
	err = raw.Control(func(parent uintptr) {
		fd, inner = unix.Openat(int(parent), name, unix.O_RDWR|unix.O_CREAT|unix.O_NOFOLLOW|unix.O_NONBLOCK|unix.O_CLOEXEC, 0600)
	})
	if err != nil || inner != nil {
		if fd >= 0 {
			unix.Close(fd)
		}
		return nil, errMonitoringClaim
	}
	f := os.NewFile(uintptr(fd), name)
	good := false
	defer func() {
		if !good {
			f.Close()
		}
	}()
	var opened unix.Stat_t
	if unix.Fstat(fd, &opened) != nil || opened.Mode&unix.S_IFMT != unix.S_IFREG || opened.Mode&07777 != 0600 || opened.Uid != uint32(os.Geteuid()) || opened.Nlink != 1 || opened.Size != 0 {
		return nil, errMonitoringClaim
	}
	if err := unix.Flock(fd, unix.LOCK_EX|unix.LOCK_NB); err != nil {
		if errors.Is(err, syscall.EWOULDBLOCK) || errors.Is(err, syscall.EAGAIN) {
			return nil, errMonitoringClaimBusy
		}
		return nil, errMonitoringClaim
	}
	// Detect replacement/unlink while opening/acquiring; no path-based write or
	// symlink-following stat can create a second accepted inode accidentally.
	var named unix.Stat_t
	if raw.Control(func(parent uintptr) { inner = unix.Fstatat(int(parent), name, &named, unix.AT_SYMLINK_NOFOLLOW) }) != nil || inner != nil || named.Dev != opened.Dev || named.Ino != opened.Ino || named.Nlink != 1 || named.Mode != opened.Mode || named.Uid != opened.Uid || named.Size != 0 {
		return nil, errMonitoringClaim
	}
	c := &monitoringOwnerClaim{file: f}
	c.live.Store(true)
	good = true
	return c, nil
}

// This predicate only means this claim has not been closed by its coordinator.
// It is NOT a live SSH peer, process inventory or kernel-freeze proof.
func (c *monitoringOwnerClaim) current() bool { return c != nil && c.live.Load() }

func (c *monitoringOwnerClaim) close() {
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.live.Store(false)
	if c.file != nil {
		// Do not LOCK_UN: that would also drop a surviving publisher's lock on
		// the shared open-file description and permit overlapping actors.
		c.file.Close()
		c.file = nil
	}
}

// A future trusted worker gets this as an inherited private descriptor, never a
// file path or browser-provided fd. Keep it open until the child has inherited it;
// close the parent's duplicate afterward even if launch fails. No runtime worker
// accepts this descriptor yet. Close-on-exec prevents unrelated subprocess leaks.
func (c *monitoringOwnerClaim) publisherHandle() (*os.File, error) {
	if c == nil {
		return nil, errMonitoringClaim
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.live.Load() || c.file == nil {
		return nil, errMonitoringClaim
	}
	raw, err := c.file.SyscallConn()
	if err != nil {
		return nil, errMonitoringClaim
	}
	fd := -1
	var inner error
	err = raw.Control(func(original uintptr) { fd, inner = unix.FcntlInt(original, unix.F_DUPFD_CLOEXEC, 0) })
	if err != nil || inner != nil {
		if fd >= 0 {
			unix.Close(fd)
		}
		return nil, errMonitoringClaim
	}
	return os.NewFile(uintptr(fd), "private-monitoring-claim"), nil
}
