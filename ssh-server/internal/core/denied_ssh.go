package core

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

// Record only a kernel-authenticated denial after collection. This is not a
// client claim, EXAM variable, process name or localhost exemption. The identity
// hashes boot ID, privileged sshd monitor PID/start time and the account UID.
func (e *Engine) recordDeniedSSH(a *Attempt, peerPID int) {
	if a.State != "COMPLETED" || !a.Protected {
		return
	}
	identity, monitor, err := transportInfo(peerPID, a.UID)
	if err != nil {
		return
	}
	for _, denied := range a.DeniedSSHTransports {
		if denied.Identity == identity {
			return
		}
	}
	// Drop entries whose privileged monitor has gone. Reused PIDs cannot authorize
	// an exemption: idleDeniedSSH rechecks the entire transport identity each time.
	var live []DeniedSSHTransport
	for _, denied := range a.DeniedSSHTransports {
		if _, err := os.Stat(fmt.Sprintf("/proc/%d", denied.Monitor)); err == nil {
			live = append(live, denied)
		}
	}
	if len(live) >= 64 {
		a.DeniedSSHTransports = live
		return
	} // Fail closed at capacity.
	a.DeniedSSHTransports = append(live, DeniedSSHTransport{identity, monitor})
	e.Audit("denied-ssh-transport-recorded", a.ID)
	// The normal reconciliation loop rechecks restoration after this gate exits.
	// Do not classify the still-running denial helper as an idle SSH transport.
}

func trustedSSHExecutable(pid int) bool {
	name, err := os.Readlink(fmt.Sprintf("/proc/%d/exe", pid))
	if err != nil {
		return false
	}
	switch name {
	case "/usr/sbin/sshd", "/usr/lib/openssh/sshd-session", "/usr/sbin/sshd-session":
	default:
		return false
	}
	if !trustedEntryExecutable(pid) {
		return false
	}
	info, err := os.Stat(name)
	return err == nil && info.Sys().(*syscall.Stat_t).Uid == 0 && info.Mode().Perm()&0022 == 0
}
func processParent(pid int) (int, error) {
	data, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
	if err != nil {
		return 0, err
	}
	end := strings.LastIndex(string(data), ")")
	if end < 0 {
		return 0, fmt.Errorf("invalid process identity")
	}
	fields := strings.Fields(string(data[end+1:]))
	if len(fields) < 2 {
		return 0, fmt.Errorf("short process identity")
	}
	return strconv.Atoi(fields[1])
}
func writableRegularDescriptor(pid int) (bool, error) {
	base := fmt.Sprintf("/proc/%d", pid)
	entries, err := os.ReadDir(filepath.Join(base, "fd"))
	if err != nil {
		return false, err
	}
	for _, entry := range entries {
		file, err := os.Stat(filepath.Join(base, "fd", entry.Name()))
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return false, err
		}
		if !file.Mode().IsRegular() {
			continue
		}
		data, err := os.ReadFile(filepath.Join(base, "fdinfo", entry.Name()))
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return false, err
		}
		found := false
		for _, line := range strings.Split(string(data), "\n") {
			if strings.HasPrefix(line, "flags:") {
				flags, err := strconv.ParseUint(strings.TrimSpace(strings.TrimPrefix(line, "flags:")), 8, 64)
				if err != nil {
					return false, err
				}
				found = true
				if flags&syscall.O_ACCMODE != syscall.O_RDONLY {
					return true, nil
				}
			}
		}
		if !found {
			return false, fmt.Errorf("file descriptor flags unavailable")
		}
	}
	return false, nil
}
func (e *Engine) idleDeniedSSH(a *Attempt, pid int) bool {
	if a.State != "COMPLETED" || !a.Protected || !trustedSSHExecutable(pid) {
		return false
	}
	identity, monitor, err := transportInfo(pid, a.UID)
	if err != nil || !trustedSSHExecutable(monitor) {
		return false
	}
	parent, err := processParent(pid)
	if err != nil || parent != monitor {
		return false
	} // Never exempt a session/SFTP child or nested student sshd.
	found := false
	for _, denied := range a.DeniedSSHTransports {
		if denied.Identity == identity && denied.Monitor == monitor {
			found = true
			break
		}
	}
	if !found {
		return false
	}
	writable, err := writableRegularDescriptor(pid)
	if err != nil || writable {
		return false
	}
	// A stale /proc scan must not bless an exited/reused process.
	after, afterMonitor, err := transportInfo(pid, a.UID)
	return err == nil && after == identity && afterMonitor == monitor && trustedSSHExecutable(pid)
}
