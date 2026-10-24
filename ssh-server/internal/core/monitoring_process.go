package core

// Process-lifetime fence used by actual framed terminal handoffs. A pidfd is not by itself SSH
// authentication, current native registration, ACTIVE authority or freeze proof.
// No factory creates a monitoringActiveSeal from this guard yet.

import (
	"errors"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"sync"
	"syscall"

	"golang.org/x/sys/unix"
)

var errMonitoringProcess = errors.New("native process identity or lifetime unverified; no authenticated ownership or execution authority established")

type monitoringProcessIdentity struct {
	pid           int
	boot          string
	start         uint64
	uids          [4]uint32
	device, inode uint64
}

type monitoringProcessGuard struct {
	mu       sync.Mutex
	file     *os.File
	identity monitoringProcessIdentity
	status   string // live, exited, unknown, closed; never a student policy finding.
}

func monitoringProcBytes(pid int, name string, limit int64) ([]byte, error) {
	f, err := os.Open(fmt.Sprintf("/proc/%d/%s", pid, name))
	if err != nil {
		return nil, errMonitoringProcess
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, limit+1))
	if err != nil || int64(len(b)) > limit {
		return nil, errMonitoringProcess
	}
	return b, nil
}

func snapshotMonitoringProcess(pid int) (monitoringProcessIdentity, error) {
	var id monitoringProcessIdentity
	if pid <= 1 {
		return id, errMonitoringProcess
	}
	id.pid, id.boot = pid, boot()
	if !monitoringUUID.MatchString(id.boot) {
		return id, errMonitoringProcess
	}
	stat, err := monitoringProcBytes(pid, "stat", 4096)
	if err != nil {
		return id, err
	}
	end := strings.LastIndexByte(string(stat), ')')
	if end < 0 {
		return id, errMonitoringProcess
	}
	fields := strings.Fields(string(stat[end+1:]))
	if len(fields) < 20 || fields[0] == "Z" || fields[0] == "X" || fields[0] == "x" {
		return id, errMonitoringProcess
	}
	id.start, err = strconv.ParseUint(fields[19], 10, 64)
	if err != nil || id.start == 0 {
		return id, errMonitoringProcess
	}
	status, err := monitoringProcBytes(pid, "status", 16384)
	if err != nil {
		return id, err
	}
	found := false
	for _, line := range strings.Split(string(status), "\n") {
		if !strings.HasPrefix(line, "Uid:") {
			continue
		}
		if found {
			return id, errMonitoringProcess
		}
		found = true
		values := strings.Fields(strings.TrimPrefix(line, "Uid:"))
		if len(values) != 4 {
			return id, errMonitoringProcess
		}
		for n, value := range values {
			uid, err := strconv.ParseUint(value, 10, 32)
			if err != nil {
				return id, errMonitoringProcess
			}
			id.uids[n] = uint32(uid)
		}
	}
	if !found {
		return id, errMonitoringProcess
	}
	exe, err := os.Stat(fmt.Sprintf("/proc/%d/exe", pid))
	if err != nil || !exe.Mode().IsRegular() {
		return id, errMonitoringProcess
	}
	s := exe.Sys().(*syscall.Stat_t)
	id.device, id.inode = uint64(s.Dev), s.Ino
	return id, nil
}

// Bracket opening the kernel handle with the full expected snapshot. A reused
// numeric PID cannot keep an old pidfd alive; final nonblocking poll catches an
// exit during the bracket even if proc metadata happens to resemble a new PID.
func pinMonitoringProcess(expected monitoringProcessIdentity) (*monitoringProcessGuard, error) {
	before, err := snapshotMonitoringProcess(expected.pid)
	if err != nil || before != expected {
		return nil, errMonitoringProcess
	}
	fd, err := unix.PidfdOpen(expected.pid, 0)
	if err != nil {
		return nil, errMonitoringProcess
	}
	g := &monitoringProcessGuard{file: os.NewFile(uintptr(fd), "private-monitoring-process"), identity: expected, status: "live"}
	after, err := snapshotMonitoringProcess(expected.pid)
	if err != nil || after != expected || !g.current() {
		g.close()
		return nil, errMonitoringProcess
	}
	return g, nil
}

// Only trusted native local-peer credentials may supply peerPID/accountUID.
// This validates the existing SSH transport identity/installed inode at pin time;
// current registration/page/epoch/ACTIVE state and later role/IPC changes remain
// separate caller responsibilities. A cached live pidfd alone is not their proof.
func pinMonitoringSSHProcess(peerPID, accountUID int, transport string) (*monitoringProcessGuard, error) {
	if os.Getuid() != 0 || os.Geteuid() != 0 || accountUID < 1000 || uint64(accountUID) > 4294967294 || !monitoringDigest.MatchString(transport) || !trustedEntryExecutable(peerPID) {
		return nil, errMonitoringProcess
	}
	identity, pid, err := transportInfo(peerPID, accountUID)
	if err != nil || identity != transport || !trustedSSHExecutable(pid) {
		return nil, errMonitoringProcess
	}
	expected, err := snapshotMonitoringProcess(pid)
	if err != nil || expected.uids != [4]uint32{} {
		return nil, errMonitoringProcess
	}
	g, err := pinMonitoringProcess(expected)
	if err != nil {
		return nil, err
	}
	again, current, err := transportInfo(peerPID, accountUID)
	if err != nil || again != transport || current != pid || !trustedEntryExecutable(peerPID) || !trustedSSHExecutable(pid) || !g.current() {
		g.close()
		return nil, errMonitoringProcess
	}
	return g, nil
}

// Nonblocking kernel poll only: no /proc, path, network or callback under this
// mutex. Unlike a cached goroutine flag, each call observes this exact pidfd.
// Process stop/stall and command delay are not process exit/authentication loss.
func (g *monitoringProcessGuard) current() bool {
	if g == nil {
		return false
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.status != "live" {
		return false
	}
	if g.file == nil {
		g.status = "unknown"
		return false
	}
	raw, err := g.file.SyscallConn()
	if err != nil {
		g.status = "unknown"
		return false
	}
	var inner error
	var events int16
	err = raw.Control(func(fd uintptr) {
		fds := []unix.PollFd{{Fd: int32(fd), Events: unix.POLLIN}}
		for n := 0; n < 4; n++ {
			_, inner = unix.Poll(fds, 0)
			if !errors.Is(inner, unix.EINTR) {
				break
			}
		}
		events = fds[0].Revents
	})
	if err != nil || inner != nil || events&(unix.POLLERR|unix.POLLNVAL) != 0 {
		g.status = "unknown"
		return false
	}
	if events&(unix.POLLIN|unix.POLLHUP) != 0 {
		g.status = "exited"
		return false
	}
	return true
}

func (g *monitoringProcessGuard) observation() string {
	if g == nil {
		return "unknown"
	}
	g.current()
	g.mu.Lock()
	defer g.mu.Unlock()
	switch g.status {
	case "live", "exited", "unknown", "closed":
		return g.status
	default:
		return "unknown"
	}
}

func (g *monitoringProcessGuard) close() {
	if g == nil {
		return
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.status == "live" {
		g.status = "closed"
	}
	if g.file != nil {
		g.file.Close()
		g.file = nil
	}
}
