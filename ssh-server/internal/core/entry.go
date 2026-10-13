package core

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// Only the actual root-installed inode is an entry stub. A student mount namespace
// or an executable renamed to the same path does not qualify.
func trustedEntryExecutable(pid int) bool {
	path := fmt.Sprintf("/proc/%d/exe", pid)
	name, err := os.Readlink(path)
	if err != nil {
		return false
	}
	switch name {
	case "/usr/sbin/sshd", "/usr/lib/openssh/sshd-session", "/usr/sbin/sshd-session", "/usr/local/libexec/exam-login":
		actual, err := os.Stat(path)
		if err != nil {
			return false
		}
		trusted, err := os.Stat(name)
		return err == nil && os.SameFile(actual, trusted)
	default:
		return false
	}
}

func loggedInUID(output []byte, uid int) (bool, error) {
	for _, line := range strings.Split(string(output), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		found, err := strconv.Atoi(fields[0])
		if err != nil || len(fields) < 2 {
			return false, errors.New("unrecognized logind user inventory")
		}
		if found == uid {
			return true, nil
		}
	}
	return false, nil
}

func terminateLoggedInUser(uid int) error {
	output, err := exec.Command("/usr/bin/loginctl", "list-users", "--no-legend", "--no-pager").Output()
	if err != nil {
		return fmt.Errorf("inspect existing login/user-service sessions: %w", err)
	}
	present, err := loggedInUID(output, uid)
	if err != nil || !present {
		return err
	}
	return exec.Command("/usr/bin/loginctl", "terminate-user", strconv.Itoa(uid)).Run()
}

// Kept separate from the account's sessions so logind cannot terminate an approved
// gateway during the activation barrier. This scope contains root-installed entry
// stubs only; shells and every other UID process are still killed before material.
func protectEntryScope(pids []int, name string) error {
	if len(pids) == 0 {
		return errors.New("no gateway entry processes")
	}
	args := []string{"call", "org.freedesktop.systemd1", "/org/freedesktop/systemd1", "org.freedesktop.systemd1.Manager", "StartTransientUnit", "ssa(sv)a(sa(sv))", name, "fail", "3", "Slice", "s", "exam-entry.slice", "CollectMode", "s", "inactive-or-failed", "PIDs", "au", strconv.Itoa(len(pids))}
	for _, pid := range pids {
		args = append(args, strconv.Itoa(pid))
	}
	args = append(args, "0")
	if output, err := exec.Command("/usr/bin/busctl", args...).CombinedOutput(); err != nil {
		return fmt.Errorf("protect gateway entry scope: %w: %s", err, output)
	}
	// StartTransientUnit queues a job. Verify that all protected processes have
	// actually moved before terminating their former logind user/session slice.
	for i := 0; i < 50; i++ {
		ready := true
		for _, pid := range pids {
			data, err := os.ReadFile(fmt.Sprintf("/proc/%d/cgroup", pid))
			if err != nil {
				return fmt.Errorf("gateway entry disappeared: %w", err)
			}
			if !strings.Contains(string(data), "/exam-entry.slice/"+name+"\n") {
				ready = false
			}
		}
		if ready {
			return nil
		}
		time.Sleep(20 * time.Millisecond)
	}
	return errors.New("gateway entry scope did not become active")
}
