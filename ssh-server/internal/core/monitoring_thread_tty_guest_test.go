package core

// Test-only C11 investigation. No live admission/retained SSH/stop policy is
// enabled. Every signal/file/scope belongs to this guarded disposable guest.
import (
	"bytes"
	"context"
	"fmt"
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

func TestMonitoringThreadTTYGuest(t *testing.T) {
	uid := requireMonitoringGuest(t, "monitoring-thread-tty", "EXAM_MONITORING_THREAD_TTY_GUEST")
	account, err := user.Lookup("examq")
	if err != nil {
		t.Fatal(err)
	}
	gid, err := strconv.Atoi(account.Gid)
	if err != nil || gid < 1000 {
		t.Fatal("invalid synthetic GID")
	}
	for _, assisted := range []bool{false, true} {
		name := "cgroup-only"
		if assisted {
			name = "stop-assisted"
		}
		t.Run(name, func(t *testing.T) { qualifyThreadTTY(t, uid, gid, assisted) })
	}
}

func qualifyThreadTTY(t *testing.T, uid, gid int, assisted bool) {
	dir, err := os.MkdirTemp("/var/tmp", "qualification-thread-tty-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) }) // Exact new guest-only fixture.
	work := filepath.Join(dir, "work")
	if os.Chmod(dir, 0o755) != nil || os.Mkdir(work, 0o700) != nil || os.Chown(work, uid, gid) != nil {
		t.Fatal("private synthetic work unavailable")
	}
	probe, err := os.ReadFile("/run/ssh-exam-qualification-input/thread-leader-probe")
	if err != nil || len(probe) == 0 || len(probe) > 2*1024*1024 {
		t.Fatal("bounded manifested fixture unavailable", err)
	}
	fixture := filepath.Join(dir, "thread-leader-probe")
	if err := os.WriteFile(fixture, probe, 0o755); err != nil {
		t.Fatal(err)
	}
	master, slave, err := openPTYMasterFlags(syscall.O_NONBLOCK)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = master.Close(); _ = slave.Close() })
	unit := "exam-qualification-thread-tty-" + Token()[:16] + ".scope"
	args := []string{"--scope", "--quiet", "--unit=" + strings.TrimSuffix(unit, ".scope"), "--slice=exam.slice", "--property=Delegate=no", "--property=MemoryMax=64M", "--property=MemorySwapMax=0", "--property=TasksMax=16", "--property=RuntimeMaxSec=30s", "--", "/usr/bin/setpriv", "--reuid", strconv.Itoa(uid), "--regid", strconv.Itoa(gid), "--clear-groups", "--inh-caps=-all", "--ambient-caps=-all", "--bounding-set=-all", "--no-new-privs", "--", "/usr/bin/bash", "--noprofile", "--norc", "-i"}
	launch := exec.Command("/usr/bin/systemd-run", args...)
	launch.Env = []string{"PATH=/usr/bin:/bin", "TERM=xterm", "HOME=" + work, "HISTFILE=/dev/null", "PS1=THREAD-PROMPT> "}
	launch.Dir = "/"
	launch.Stdin, launch.Stdout, launch.Stderr = slave, slave, slave
	launch.SysProcAttr = &syscall.SysProcAttr{Setsid: true, Setctty: true, Ctty: 0}
	if err := launch.Start(); err != nil {
		t.Fatal(err)
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
			t.Error("owned thread/TTY scope cleanup unconfirmed")
		}
	})
	var pending []byte
	take := func(needle string) string {
		t.Helper()
		_ = master.SetReadDeadline(time.Now().Add(4 * time.Second))
		for {
			if at := bytes.Index(pending, []byte(needle)); at >= 0 {
				out := string(pending[:at])
				pending = pending[at+len(needle):]
				return out
			}
			var b [4096]byte
			n, err := master.Read(b[:])
			pending = append(pending, b[:n]...)
			if err != nil || len(pending) > 128*1024 {
				t.Fatal("owned foreground thread marker unavailable", needle, err, string(pending))
			}
		}
	}
	write := func(text string) {
		t.Helper()
		if n, err := master.Write([]byte(text)); err != nil || n != len(text) {
			t.Fatal("owned PTY write failed", n, err)
		}
	}
	pin := func(pid int) *uidProcess {
		t.Helper()
		p, err := pinUIDProcess(pid, uid)
		if err != nil || p == nil {
			t.Fatal("owned UID/group identity unavailable", err)
		}
		t.Cleanup(p.close)
		status, err := p.read("status", 16384)
		if err != nil {
			t.Fatal(err)
		}
		valid := false
		for _, line := range strings.Split(string(status), "\n") {
			if strings.HasPrefix(line, "Uid:") {
				fields := strings.Fields(line)
				valid = len(fields) == 5
				for _, value := range fields[1:] {
					valid = valid && value == strconv.Itoa(uid)
				}
			}
		}
		if !valid {
			t.Fatal("synthetic process UID tuple changed")
		}
		return p
	}
	state := func(p *uidProcess, tid int) string {
		t.Helper()
		var data []byte
		var err error
		if tid == p.pid {
			data, err = p.read("status", 16384)
		} else {
			data, err = os.ReadFile(fmt.Sprintf("/proc/%d/task/%d/status", p.pid, tid))
		}
		live, lifetimeErr := p.live()
		if err != nil || lifetimeErr != nil || !live {
			t.Fatal("owned live process/thread view unavailable", err, lifetimeErr)
		}
		for _, line := range strings.Split(string(data), "\n") {
			if strings.HasPrefix(line, "State:") {
				fields := strings.Fields(line)
				if len(fields) > 1 {
					return fields[1]
				}
			}
		}
		t.Fatal("owned thread state unavailable")
		return ""
	}
	signal := func(p *uidProcess, sig unix.Signal) {
		t.Helper()
		live, err := p.live()
		if err != nil || !live {
			t.Fatal("owned signal identity lost", err)
		}
		if err := p.control(func(fd int) error { return unix.PidfdSendSignal(fd, sig, nil, 0) }); err != nil {
			t.Fatal(err)
		}
	}
	stop := func(p *uidProcess, tid int) {
		t.Helper()
		signal(p, unix.SIGSTOP)
		until := time.Now().Add(time.Second)
		for state(p, tid) != "T" {
			if time.Now().After(until) {
				t.Fatal("owned thread stop unconfirmed")
			}
			time.Sleep(time.Millisecond)
		}
	}
	foreground := func() int {
		t.Helper()
		// RawConn preserves the adapter's nonblocking flags; File.Fd can turn a
		// pollable descriptor blocking. The supervisor is outside this TTY session.
		raw, err := master.SyscallConn()
		if err != nil {
			t.Fatal(err)
		}
		var group int
		var inner error
		err = raw.Control(func(fd uintptr) { group, inner = unix.IoctlGetInt(int(fd), unix.TIOCGPGRP) })
		if err != nil || inner != nil {
			t.Fatal("owned foreground pgrp unavailable", err, inner)
		}
		return group
	}
	take("THREAD-PROMPT>")
	shell := pin(launch.Process.Pid)
	write("sleep 300 &\n")
	take("THREAD-PROMPT>")
	var background *uidProcess
	until := time.Now().Add(time.Second)
	for background == nil && time.Now().Before(until) {
		data, err := os.ReadFile(filepath.Join("/sys/fs/cgroup/exam.slice", unit, "cgroup.procs"))
		if err != nil {
			t.Fatal(err)
		}
		for _, value := range strings.Fields(string(data)) {
			pid, err := strconv.Atoi(value)
			if err != nil {
				t.Fatal(err)
			}
			path, err := os.Readlink("/proc/" + value + "/exe")
			if err == nil && filepath.Base(path) == "sleep" {
				background = pin(pid)
				break
			}
		}
		if background == nil {
			time.Sleep(time.Millisecond)
		}
	}
	if background == nil {
		t.Fatal("owned background fixture unavailable")
	}
	stop(background, background.pid)
	counter := filepath.Join(work, "counter")
	write(fixture + " " + counter + " tty\n")
	take("THREAD-TTY ")
	var pid, tid int
	if _, err := fmt.Sscanf(strings.TrimSpace(take("\n")), "%d %d", &pid, &tid); err != nil || pid < 2 || tid < 2 || pid == tid {
		t.Fatal("owned foreground thread report invalid", err)
	}
	worker := pin(pid)
	until = time.Now().Add(time.Second)
	for state(worker, pid) != "Z" {
		if time.Now().After(until) {
			t.Fatal("foreground leader did not exit")
		}
		time.Sleep(time.Millisecond)
	}
	if foreground() != pid || state(worker, tid) == "Z" {
		t.Fatal("surviving worker lacks a live foreground baseline")
	}
	write("PUT preserved-thread-buffer\n")
	take("THREAD-BUFFER 1 preserved-thread-buffer")
	engine := &Engine{state: State{Registrations: map[string]string{}}}
	deadline := Millis() + 60000
	a := &Attempt{ID: finalID, Username: "examq", UID: uid, State: "ACTIVE", Deadline: deadline, OriginalDeadline: deadline, Units: []string{unit}}
	gate, err := newPaneInputGate(testInputPane, monitoringBootMillis)
	if err != nil {
		t.Fatal(err)
	}
	pty, err := newPanePTYInput(gate, master, slave)
	if err != nil {
		t.Fatal(err)
	}
	for cycle := 0; cycle < 3; cycle++ {
		if assisted {
			stop(shell, shell.pid)
			stop(worker, tid)
		}
		if err := engine.freeze(a, true); err != nil {
			t.Fatal(err)
		}
		if err := engine.verifyWriters(a); err != nil {
			t.Fatal("frozen dead-leader group containment unverified", err)
		}
		before, err := os.Stat(counter)
		if err != nil {
			t.Fatal(err)
		}
		write("STALE-UNAUTHORIZED")
		drain := gate.revoke()
		requirePaneDrain(t, drain)
		if err := pty.discardKernelInput(drain); err != nil {
			t.Fatal(err)
		}
		time.Sleep(40 * time.Millisecond)
		after, err := os.Stat(counter)
		if err != nil || before.Size() != after.Size() {
			t.Fatal("surviving foreground worker wrote during verified freeze", err)
		}
		if state(background, background.pid) != "T" {
			t.Fatal("original stopped job was resumed")
		}
		if err := engine.freeze(a, false); err != nil {
			t.Fatal(err)
		}
		if assisted {
			signal(worker, unix.SIGCONT)
			signal(shell, unix.SIGCONT)
		}
		write("CHECK\n")
		take(fmt.Sprintf("THREAD-BUFFER %d preserved-thread-buffer", cycle+2))
		if foreground() != pid || state(shell, shell.pid) == "T" || state(worker, tid) == "T" || state(background, background.pid) != "T" {
			t.Fatal("dead-leader foreground/shell/original job state not preserved")
		}
	}
	write("EXIT\n")
	take("THREAD-PROMPT>")
	write("printf 'PARENT-STILL-ALIVE\\n'\n")
	take("PARENT-STILL-ALIVE\r\n")
	if foreground() != shell.pid || state(background, background.pid) != "T" || a.Deadline != deadline || a.OriginalDeadline != deadline {
		t.Fatal("post-worker shell/job/interval state changed")
	}
	t.Logf("dead main thread/live foreground worker retained acknowledged private buffer and job control across three verified freeze/discard/thaw cycles; stop_assisted=%t; original stopped job/deadlines unchanged", assisted)
}
