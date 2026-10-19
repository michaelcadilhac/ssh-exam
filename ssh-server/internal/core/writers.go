package core

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// Finalization denies admissions under the state lock before reaching this barrier. Every
// pane and its detached descendants remains in a recorded, nondelegated cgroup until empty.
func (e *Engine) quiesceWriters(a *Attempt) error {
	if err := e.freeze(a, true); err != nil {
		return err
	}
	if err := e.verifyWriters(a); err != nil {
		return err
	}
	root, err := os.OpenRoot(e.Config.Work)
	if err != nil {
		return err
	}
	defer root.Close()
	f, err := root.OpenFile(filepath.Join(a.ID, "work"), os.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return err
	}
	defer f.Close()
	// Revoke new path access too; this alone would not revoke existing writable descriptors.
	if err = f.Chown(0, 0); err != nil {
		return err
	}
	return f.Chmod(0500)
}
func (e *Engine) verifyWriters(a *Attempt) error        { return e.inspectWriters(a, false) }
func (e *Engine) verifyReleaseWriters(a *Attempt) error { return e.inspectWriters(a, true) }
func (e *Engine) inspectWriters(a *Attempt, release bool) error {
	if e.trustedAdministratorAttempt(a) {
		return nil
	} // Explicit trusted administrator sandbox; other exam UIDs require isolation.
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return err
	}
	for _, entry := range entries {
		pid, err := strconv.Atoi(entry.Name())
		if err != nil {
			continue
		}
		base := filepath.Join("/proc", entry.Name())
		status, err := os.ReadFile(filepath.Join(base, "status"))
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return err
		}
		if strings.Contains(string(status), "State:\tZ") || strings.Contains(string(status), "State:\tX") {
			continue
		}
		owns := false
		for _, line := range strings.Split(string(status), "\n") {
			if strings.HasPrefix(line, "Uid:") {
				for _, value := range strings.Fields(line)[1:] {
					if value == strconv.Itoa(a.UID) {
						owns = true
					}
				}
			}
		}
		if !owns {
			continue
		}
		cg, err := os.ReadFile(filepath.Join(base, "cgroup"))
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return err
		}
		contained := false
		for _, unit := range a.Units {
			scope := "/exam.slice/" + unit
			for _, line := range strings.Split(string(cg), "\n") {
				path := strings.TrimPrefix(line, "0::")
				if path == scope || strings.HasPrefix(path, scope+"/") {
					contained = true
				}
			}
		}
		if contained {
			continue
		}
		_, err = os.Readlink(filepath.Join(base, "exe"))
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return err
		}
		// Root-owned gate/SSH entry stubs bridge PTYs, not the working tree. They cannot invoke
		// an ordinary shell while Busy denies this UID. No arbitrary executable is exempted.
		if trustedEntryExecutable(pid) {
			identity, err := transportIdentity(pid, a.UID)
			if err == nil && (identity == a.Transport || e.state.Registrations[identity] == a.Username) {
				continue
			}
		}
		if release && e.idleDeniedSSH(a, pid) {
			continue
		}
		if release {
			return fmt.Errorf("uncontained process %d for exam UID; account restoration blocked until all writers are quiesced", pid)
		}
		return fmt.Errorf("uncontained process %d for exam UID; collection refused until all writers are quiesced", pid)
	}
	return nil
}
func (e *Engine) terminateWriters(a *Attempt) error {
	for _, unit := range a.Units {
		if !e.recordedUnitAllowed(a, unit) {
			return errors.New("invalid recorded workload unit")
		}
		base := filepath.Join("/sys/fs/cgroup/exam.slice", unit)
		if _, err := os.Stat(base); os.IsNotExist(err) {
			continue
		} else if err != nil {
			return err
		}
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		err := terminateRecordedScope(ctx, base, unit, func(ctx context.Context, args ...string) error {
			return exec.CommandContext(ctx, "/usr/bin/systemctl", args...).Run()
		})
		cancel()
		if err != nil {
			return err
		}
	}
	return nil
}

// A killed scope can disappear before systemctl stop observes it. Command exit
// status alone cannot prove either failure or success; require cgroup removal.
func terminateRecordedScope(ctx context.Context, base, unit string, run func(context.Context, ...string) error) error {
	run(ctx, "kill", "--signal=KILL", unit)
	run(ctx, "stop", unit)
	for {
		_, err := os.Stat(base)
		if os.IsNotExist(err) {
			return nil
		}
		if err != nil || ctx.Err() != nil {
			return errors.New("protected archive exists, but workload termination unconfirmed")
		}
		time.Sleep(25 * time.Millisecond)
	}
}

// Include real/effective/saved/filesystem UIDs, not just pgrep's effective UID.
// A failed /proc enumeration is an isolation failure, never 'no processes'.
func uidProcesses(uid int) ([]int, error) {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return nil, err
	}
	var pids []int
	for _, entry := range entries {
		pid, err := strconv.Atoi(entry.Name())
		if err != nil {
			continue
		}
		status, err := os.ReadFile(filepath.Join("/proc", entry.Name(), "status"))
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if strings.Contains(string(status), "State:\tZ") || strings.Contains(string(status), "State:\tX") {
			continue
		}
		for _, line := range strings.Split(string(status), "\n") {
			if strings.HasPrefix(line, "Uid:") {
				for _, v := range strings.Fields(line)[1:] {
					if v == strconv.Itoa(uid) {
						pids = append(pids, pid)
						break
					}
				}
			}
		}
	}
	return pids, nil
}
