package core

// The scope starts only this trusted, closed bootstrap, never student code.
// Inherited IPC EOF/timeout denies exec, including a manager starting it after
// the parent died. This is not a retained terminal supervisor or work authority.
import (
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"strconv"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
)

const paneBootstrapRole = "--pane-bootstrap-v1"

var errPaneBootstrap = errors.New("closed pane startup was not verified; retry opening the pane after checks settle; inspect examctl panes show ATTEMPT PANE, preserving tracking and work")

func paneBootstrapSocket() (*net.UnixConn, *os.File, error) {
	fds, err := unix.Socketpair(unix.AF_UNIX, unix.SOCK_SEQPACKET|unix.SOCK_CLOEXEC, 0)
	if err != nil {
		return nil, nil, err
	}
	local := os.NewFile(uintptr(fds[0]), "pane-bootstrap-parent")
	remote := os.NewFile(uintptr(fds[1]), "pane-bootstrap-child")
	if err := unix.SetsockoptInt(fds[0], unix.SOL_SOCKET, unix.SO_PASSCRED, 1); err != nil {
		local.Close()
		remote.Close()
		return nil, nil, err
	}
	conn, err := net.FileConn(local)
	local.Close()
	if err != nil {
		remote.Close()
		return nil, nil, err
	}
	return conn.(*net.UnixConn), remote, nil
}

// Pin the already-loaded binary, not a path an upgrade can replace between
// checking and exec. The inherited descriptor is closed before student exec.
func paneBootstrapExecutable() (*os.File, error) {
	f, err := os.Open("/proc/self/exe")
	if err != nil {
		return nil, errPaneBootstrap
	}
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Mode()&(os.ModeSetuid|os.ModeSetgid) != 0 || info.Mode().Perm()&0022 != 0 || info.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) {
		f.Close()
		return nil, errPaneBootstrap
	}
	return f, nil
}

func paneBootstrapArgs(args []string, unit string, expires, bootUntil int64) ([]string, error) {
	for i, arg := range args {
		if arg == "--" && i+1 < len(args) && args[i+1] == "/usr/bin/bwrap" && strings.HasSuffix(unit, ".scope") {
			v := append([]string{}, args[:i+1]...)
			v = append(v, "/proc/self/fd/4", paneBootstrapRole, unit, strconv.FormatInt(expires, 10), strconv.FormatInt(bootUntil, 10), "--")
			return append(v, args[i+1:]...), nil
		}
	}
	return nil, errPaneBootstrap
}

func paneBootstrapScope(data []byte, unit string) bool {
	return string(data) == "0::/exam.slice/"+unit+"\n"
}

// Called only with an inherited private SOCK_SEQPACKET descriptor. No pathname,
// config, socket listener, student-provided shell command or recovery option.
func runPaneBootstrap(conn *net.UnixConn, unit string, expires, bootUntil int64, command []string) error {
	if len(command) < 2 || command[0] != "/usr/bin/bwrap" || !strings.HasPrefix(unit, "exam-") || !strings.HasSuffix(unit, ".scope") || len(unit) > 160 {
		return errPaneBootstrap
	}
	remaining := time.Until(time.UnixMilli(expires))
	now, clockErr := monitoringBootMillis()
	if clockErr != nil || now >= bootUntil || bootUntil-now > 15000 || remaining <= 0 || remaining > 15*time.Second {
		return errPaneBootstrap
	}
	remaining = min(remaining, time.Duration(bootUntil-now)*time.Millisecond)
	if err := conn.SetDeadline(time.Now().Add(remaining)); err != nil {
		return errPaneBootstrap
	}
	if _, err := conn.Write([]byte{1}); err != nil {
		return errPaneBootstrap
	}
	var permit [2]byte
	n, _, flags, _, err := conn.ReadMsgUnix(permit[:], nil)
	now, clockErr = monitoringBootMillis()
	if err != nil || clockErr != nil || now >= bootUntil || flags&(unix.MSG_TRUNC|unix.MSG_CTRUNC) != 0 || n != 1 || permit[0] != 1 || Millis() >= expires {
		return errPaneBootstrap
	}
	// Parent sends exactly one permit and closes its endpoint in the final
	// transaction. No trailing request or inherited control FD reaches bwrap.
	var extra [1]byte
	if n, err := conn.Read(extra[:]); n != 0 || !errors.Is(err, io.EOF) {
		return errPaneBootstrap
	}
	now, clockErr = monitoringBootMillis()
	if clockErr != nil || now >= bootUntil || Millis() >= expires {
		return errPaneBootstrap
	}
	return nil
}

func PaneBootstrapMain(args []string) bool {
	if len(args) == 0 || args[0] != paneBootstrapRole {
		return false
	}
	refuse := func() bool { os.Exit(1); return true }
	if os.Getuid() != 0 || os.Geteuid() != 0 || len(args) < 8 || args[4] != "--" {
		return refuse()
	}
	expires, err := strconv.ParseInt(args[2], 10, 64)
	if err != nil {
		return refuse()
	}
	bootUntil, err := strconv.ParseInt(args[3], 10, 64)
	if err != nil {
		return refuse()
	}
	file := os.NewFile(3, "inherited-closed-pane-control")
	connection, err := net.FileConn(file)
	file.Close()
	// Descriptor4 pins this executable through systemd-run. Never leak it into
	// the namespace or the student's descriptor table.
	_ = unix.Close(4)
	if err != nil {
		return refuse()
	}
	conn, ok := connection.(*net.UnixConn)
	if !ok {
		connection.Close()
		return refuse()
	}
	defer conn.Close()
	group, err := os.ReadFile("/proc/self/cgroup")
	if err != nil || !paneBootstrapScope(group, args[1]) || runPaneBootstrap(conn, args[1], expires, bootUntil, args[5:]) != nil {
		return refuse()
	}
	conn.Close()
	if err := syscall.Exec(args[5], args[5:], os.Environ()); err != nil {
		return refuse()
	}
	return true
}

type paneBootstrapPeer struct {
	process *uidProcess
	exe     os.FileInfo
	group   string
}

// Kernel credentials identify the sender of READY, not a PID supplied in JSON.
// Keep its original pidfd/proc handle through the final state transaction.
func awaitPaneBootstrap(conn *net.UnixConn, executable *os.File, unit string, expires, bootUntil int64) (*paneBootstrapPeer, error) {
	return awaitPaneBootstrapIdentity(conn, executable, "0::/exam.slice/"+unit+"\n", 0, expires, bootUntil)
}

func awaitPaneBootstrapIdentity(conn *net.UnixConn, executable *os.File, group string, uid int, expires, bootUntil int64) (*paneBootstrapPeer, error) {
	now, clockErr := monitoringBootMillis()
	if clockErr != nil || bootUntil <= now || bootUntil-now > 15000 {
		return nil, errPaneBootstrap
	}
	remaining := min(time.Until(time.UnixMilli(expires)), time.Duration(bootUntil-now)*time.Millisecond)
	if clockErr != nil || remaining <= 0 || remaining > 15*time.Second {
		return nil, errPaneBootstrap
	}
	if err := conn.SetDeadline(time.Now().Add(remaining)); err != nil {
		return nil, errPaneBootstrap
	}
	var b [2]byte
	oob := make([]byte, unix.CmsgSpace(unix.SizeofUcred))
	n, on, flags, _, err := conn.ReadMsgUnix(b[:], oob)
	// Own/close any unexpected installed SCM_RIGHTS even on a malformed or
	// truncated message. Credentials are checked separately below.
	descriptors, _ := receiveGateDescriptors(oob[:on], flags)
	descriptors.close()
	if err != nil || n != 1 || b[0] != 1 || flags&(unix.MSG_TRUNC|unix.MSG_CTRUNC) != 0 {
		return nil, errPaneBootstrap
	}
	frames, err := unix.ParseSocketControlMessage(oob[:on])
	if err != nil || len(frames) != 1 {
		return nil, errPaneBootstrap
	}
	cred, err := unix.ParseUnixCredentials(&frames[0])
	if err != nil || cred.Uid != uint32(uid) || cred.Pid <= 1 {
		return nil, errPaneBootstrap
	}
	process, err := pinUIDProcess(int(cred.Pid), uid)
	if err != nil || process == nil {
		return nil, errPaneBootstrap
	}
	exe, err := executable.Stat()
	peer := &paneBootstrapPeer{process: process, exe: exe, group: group}
	if err != nil || !peer.current() {
		process.close()
		return nil, errPaneBootstrap
	}
	return peer, nil
}

func (p *paneBootstrapPeer) current() bool {
	if p == nil || p.process == nil || p.exe == nil {
		return false
	}
	live, err := p.process.live()
	if err != nil || !live {
		return false
	}
	exe, err := os.Stat(fmt.Sprintf("/proc/%d/exe", p.process.pid))
	if err != nil || !os.SameFile(exe, p.exe) {
		return false
	}
	group, err := p.process.read("cgroup", 4096)
	if err != nil || string(group) != p.group {
		return false
	}
	live, err = p.process.live()
	return err == nil && live
}
