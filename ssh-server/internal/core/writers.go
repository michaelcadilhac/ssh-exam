package core

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
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
	processes, err := pinUIDProcesses(a.UID)
	if err != nil {
		return err
	}
	defer closeUIDProcesses(processes)
	for _, p := range processes {
		if err := e.inspectWriter(a, release, p); err != nil {
			return err
		}
	}
	return nil
}

func (e *Engine) inspectWriter(a *Attempt, release bool, p *uidProcess) error {
	pid := p.pid
	cg, readErr := p.read("cgroup", 131072)
	live, err := p.live()
	if err != nil {
		return err
	}
	if !live {
		return nil
	}
	if readErr != nil {
		return fmt.Errorf("live process %d containment unavailable; writer isolation unverified: %w", pid, readErr)
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
		return nil
	}
	// Root-owned gate/SSH entry stubs bridge PTYs, not the working tree. They cannot invoke
	// an ordinary shell while Busy denies this UID. No arbitrary executable is exempted.
	exempt := false
	if trustedEntryExecutable(pid) {
		identity, err := transportIdentity(pid, a.UID)
		if err == nil && (identity == a.Transport || e.state.Registrations[identity] == a.Username) {
			exempt = true
		}
	}
	if release && e.idleDeniedSSH(a, pid) {
		exempt = true
	}
	live, err = p.live()
	if err != nil {
		return err
	}
	if !live || exempt {
		return nil
	}
	if release {
		return fmt.Errorf("uncontained process %d for exam UID; account restoration blocked until all writers are quiesced", pid)
	}
	return fmt.Errorf("uncontained process %d for exam UID; collection refused until all writers are quiesced", pid)
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
	if empty, err := emptyRecordedScope(base); err != nil {
		return err
	} else if empty {
		return nil
	}
	run(ctx, "kill", "--signal=KILL", unit)
	run(ctx, "stop", unit)
	for {
		empty, err := emptyRecordedScope(base)
		if err == nil && empty {
			return nil
		}
		if err != nil || ctx.Err() != nil {
			return errors.New("protected archive exists, but workload termination unconfirmed")
		}
		time.Sleep(25 * time.Millisecond)
	}
}

// systemd may retain an empty frozen cgroup after the scope has stopped.
// populated includes descendants; an empty direct cgroup.procs alone is not proof.
func emptyRecordedScope(base string) (bool, error) {
	b, err := os.ReadFile(filepath.Join(base, "cgroup.events"))
	if os.IsNotExist(err) {
		if _, statErr := os.Stat(base); os.IsNotExist(statErr) {
			return true, nil
		}
		return false, nil
	}
	if err != nil {
		return false, err
	}
	for _, line := range strings.Split(string(b), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && fields[0] == "populated" {
			if fields[1] == "0" {
				return true, nil
			}
			if fields[1] == "1" {
				return false, nil
			}
			return false, errors.New("invalid cgroup population status")
		}
	}
	return false, errors.New("cgroup population status unavailable")
}
