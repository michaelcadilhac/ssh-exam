package core

// Investigation only: compare real deferred IO against an unfrozen baseline.
// No new native policy/retained mode or kernel restriction is implemented here.

import (
	"bufio"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

func TestMonitoringAsyncIOGuest(t *testing.T) {
	uid := requireMonitoringGuest(t, "monitoring-async-io", "EXAM_MONITORING_ASYNCIO_GUEST")
	monitoringAsyncIOMatrix(t, uid, false)
}

func TestMonitoringAsyncIOStoppedGuest(t *testing.T) {
	uid := requireMonitoringGuest(t, "monitoring-async-io-stopped", "EXAM_MONITORING_ASYNCIO_STOPPED_GUEST")
	monitoringAsyncIOMatrix(t, uid, true)
}

func monitoringAsyncIOMatrix(t *testing.T, uid int, stopped bool) {
	t.Helper()
	account, err := user.Lookup("examq")
	if err != nil {
		t.Fatal(err)
	}
	gid, err := strconv.Atoi(account.Gid)
	if err != nil || gid < 1000 {
		t.Fatal("synthetic account GID unavailable")
	}
	probe, err := os.ReadFile("/run/ssh-exam-qualification-input/asyncio-probe")
	if err != nil || len(probe) > 4*1024*1024 || len(probe) < 4 || string(probe[:4]) != "\x7fELF" {
		t.Fatal("manifested static async-IO fixture unavailable")
	}
	for _, kind := range []string{"pipe", "timer"} {
		for _, mode := range []string{"basic", "sqpoll"} {
			for _, dispatch := range []string{"normal", "forced"} {
				if kind == "timer" && dispatch == "forced" {
					continue
				}
				for _, frozen := range []bool{false, true} {
					label := kind + "/" + mode + "/" + dispatch + "/baseline"
					if frozen {
						label = kind + "/" + mode + "/" + dispatch + "/frozen"
					}
					if !t.Run(label, func(t *testing.T) {
						monitoringAsyncIOCase(t, uid, gid, probe, kind, mode, dispatch, frozen, stopped)
					}) && !frozen {
						// A broken baseline cannot certify its paired freeze case.
						break
					}
				}
			}
		}
	}
}

func monitoringAsyncIOCase(t *testing.T, uid, gid int, probe []byte, kind, mode, dispatch string, frozen, stopped bool) {
	t.Helper()
	dir, err := os.MkdirTemp("/var/tmp", "qualification-asyncio-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) }) // Exact newly created guest fixture.
	binary, work := filepath.Join(dir, "probe"), filepath.Join(dir, "work")
	if os.Chmod(dir, 0o755) != nil || os.WriteFile(binary, probe, 0o555) != nil || os.Mkdir(work, 0o700) != nil || os.Chown(work, uid, gid) != nil {
		t.Fatal("private unprivileged fixture staging failed")
	}
	output := filepath.Join(work, "result")
	pipe, trigger, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = pipe.Close(); _ = trigger.Close() })
	master, slave, err := openPTYMasterFlags(syscall.O_NONBLOCK)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = master.Close(); _ = slave.Close() })
	restore, err := rawTerminal(slave.Fd())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(restore)
	unit := "exam-qualification-asyncio-" + Token()[:16] + ".scope"
	args := []string{"--scope", "--quiet", "--unit=" + strings.TrimSuffix(unit, ".scope"), "--slice=exam.slice", "--property=Delegate=no", "--property=MemoryMax=64M", "--property=MemorySwapMax=0", "--property=TasksMax=16", "--property=RuntimeMaxSec=30s", "--", "/usr/bin/setpriv", "--reuid", strconv.Itoa(uid), "--regid", strconv.Itoa(gid), "--clear-groups", "--inh-caps=-all", "--ambient-caps=-all", "--bounding-set=-all", "--no-new-privs", "--", binary, mode, kind, dispatch, output}
	launch := exec.Command("/usr/bin/systemd-run", args...)
	launch.Dir = "/"
	launch.Stdin, launch.Stdout, launch.Stderr = slave, slave, slave
	launch.ExtraFiles = []*os.File{pipe}
	launch.SysProcAttr = &syscall.SysProcAttr{Setsid: true, Setctty: true, Ctty: 0}
	if err := launch.Start(); err != nil {
		t.Fatal("private async-IO scope failed startup", err)
	}
	ended := make(chan error, 1)
	go func() { ended <- launch.Wait() }()
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		_ = exec.CommandContext(ctx, "/usr/bin/systemctl", "kill", "--signal=KILL", unit).Run()
		_ = exec.CommandContext(ctx, "/usr/bin/systemctl", "stop", unit).Run()
		_ = launch.Process.Kill()
		select {
		case <-ended:
		case <-ctx.Done():
			t.Error("private async-IO cleanup unconfirmed")
		}
	})
	reader := bufio.NewReader(master)
	read := func(value any) {
		t.Helper()
		_ = master.SetReadDeadline(time.Now().Add(5 * time.Second))
		line, err := reader.ReadBytes('\n')
		if err != nil || len(line) > 4096 || json.Unmarshal(line, value) != nil {
			t.Fatal("private async-IO response unavailable", err, string(line))
		}
	}
	var ready struct {
		Phase       string
		PID, UID    int
		Kernel      string
		Expires     int64
		Completions int
	}
	read(&ready)
	if ready.Phase != "ready" || ready.PID != launch.Process.Pid || ready.UID != uid || ready.Kernel == "" || ready.Completions != 0 {
		t.Fatal("deferred IO was not genuinely pending in the owned synthetic scope", ready)
	}
	engine := &Engine{state: State{Registrations: map[string]string{}}}
	a := &Attempt{ID: finalID, Username: "examq", UID: uid, State: "ACTIVE", Units: []string{unit}}
	if err := engine.verifyWriters(a); err != nil {
		t.Fatal("uncontained async-IO fixture", err)
	}
	contents := func() []byte {
		t.Helper()
		b, err := os.ReadFile(output)
		if err != nil || len(b) > 1 {
			t.Fatal("invalid synthetic IO output", err)
		}
		return b
	}
	if len(contents()) != 0 {
		t.Fatal("deferred IO finished before the controlled trigger")
	}
	stoppedFD := -1
	if frozen {
		if stopped {
			// Test-only experiment, not a general workload stop barrier. The
			// unreaped direct child's pidfd cannot signal a recycled process.
			fd, err := unix.PidfdOpen(ready.PID, 0)
			if err != nil {
				t.Fatal("owned fixture pidfd unavailable", err)
			}
			t.Cleanup(func() { _ = unix.Close(fd) })
			stoppedFD = fd
			if err := unix.PidfdSendSignal(fd, unix.SIGSTOP, nil, 0); err != nil {
				t.Fatal("owned fixture stop failed", err)
			}
			until := time.Now().Add(time.Second)
			for {
				status, err := os.ReadFile(filepath.Join("/proc", strconv.Itoa(ready.PID), "status"))
				if err != nil {
					t.Fatal("owned fixture stop observation failed", err)
				}
				if strings.Contains(string(status), "\nState:\tT (stopped)\n") {
					break
				}
				if time.Now().After(until) {
					t.Fatal("owned fixture job-stop not confirmed")
				}
				time.Sleep(time.Millisecond)
			}
		}
		if err := engine.freeze(a, true); err != nil {
			t.Fatal("pending async-IO freeze was not confirmed", err)
		}
		if err := engine.verifyWriters(a); err != nil {
			t.Fatal("pending async-IO UID containment not confirmed", err)
		}
		if kind == "timer" {
			now, err := monitoringBootMillis()
			if err != nil || now >= ready.Expires-100 {
				t.Fatal("timer elapsed before freeze confirmation; timing inconclusive", err)
			}
		}
	}
	if kind == "pipe" {
		if _, err := trigger.Write([]byte{'X'}); err != nil {
			t.Fatal(err)
		}
	}
	if frozen {
		observe := 200 * time.Millisecond
		if kind == "timer" {
			observe = 2500 * time.Millisecond // Beyond the armed2s timer after SQ consumption.
		}
		until := time.Now().Add(observe)
		wrote := false
		for time.Now().Before(until) {
			if len(contents()) != 0 {
				wrote = true
			}
			time.Sleep(10 * time.Millisecond)
		}
		events, err := os.ReadFile(filepath.Join("/sys/fs/cgroup/exam.slice", unit, "cgroup.events"))
		if err != nil || !strings.Contains(string(events), "frozen 1\n") {
			t.Fatal("scope did not remain frozen during observation", err)
		}
		if wrote {
			t.Error("deferred IO changed the file while cgroup.events confirmed frozen1; containment not qualified")
		}
		if err := engine.freeze(a, false); err != nil {
			t.Fatal("test-only thaw unconfirmed", err)
		}
		if stopped {
			if err := unix.PidfdSendSignal(stoppedFD, unix.SIGCONT, nil, 0); err != nil {
				t.Fatal("owned fixture continuation failed", err)
			}
		}
	} else {
		until := time.Now().Add(4 * time.Second)
		for string(contents()) != "X" {
			if time.Now().After(until) {
				t.Fatal("unfrozen baseline did not complete deferred IO")
			}
			time.Sleep(10 * time.Millisecond)
		}
	}
	if _, err := master.Write([]byte{'Q'}); err != nil {
		t.Fatal(err)
	}
	var result struct {
		Phase                                   string
		First, Second, Saved, Dropped, Overflow int
	}
	read(&result)
	expected := 1
	if kind == "timer" {
		expected = -int(unix.ETIME)
	}
	t.Logf("kernel=%s completed=%+v", ready.Kernel, result)
	if result.Phase != "done" || result.First != expected || result.Second != 1 || result.Saved != int('X') || result.Dropped != 0 || result.Overflow != 0 || string(contents()) != "X" {
		t.Error("IO completion changed across the freeze/baseline; compatibility not qualified")
	}
	select {
	case err := <-ended:
		ended <- err // Preserve the cleanup's exact-child completion observation.
		if err != nil {
			t.Error("private IO workload exited unsuccessfully after its result", err)
		}
	case <-time.After(2 * time.Second):
		t.Error("private IO workload did not exit after reporting completion")
	}
}
