package core

// Test-only job-control/buffer experiment in the pinned disposable guest. No
// general stop barrier, retained SSH capability or native attempt is created.

import (
	"bytes"
	"context"
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

func TestMonitoringEditorGuest(t *testing.T) {
	uid := requireMonitoringGuest(t, "monitoring-editor", "EXAM_MONITORING_EDITOR_GUEST")
	account, err := user.Lookup("examq")
	if err != nil {
		t.Fatal(err)
	}
	gid, err := strconv.Atoi(account.Gid)
	if err != nil || gid < 1000 {
		t.Fatal("synthetic GID unavailable")
	}
	dir, err := os.MkdirTemp("/var/tmp", "qualification-editor-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) }) // Exact newly owned guest fixture.
	if os.Chmod(dir, 0o755) != nil || os.Mkdir(filepath.Join(dir, "work"), 0o700) != nil || os.Chown(filepath.Join(dir, "work"), uid, gid) != nil {
		t.Fatal("private synthetic editor work unavailable")
	}
	work := filepath.Join(dir, "work")
	answer := filepath.Join(work, "qualification-answer")
	master, slave, err := openPTYMasterFlags(syscall.O_NONBLOCK)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = master.Close(); _ = slave.Close() })
	// Use the actual interactive terminal discipline, not a raw stdin mock.
	if err := unix.IoctlSetWinsize(int(slave.Fd()), unix.TIOCSWINSZ, &unix.Winsize{Row: 30, Col: 120}); err != nil {
		t.Fatal(err)
	}
	unit := "exam-qualification-editor-" + Token()[:16] + ".scope"
	args := []string{"--scope", "--quiet", "--unit=" + strings.TrimSuffix(unit, ".scope"), "--slice=exam.slice", "--property=Delegate=no", "--property=MemoryMax=64M", "--property=MemorySwapMax=0", "--property=TasksMax=16", "--property=RuntimeMaxSec=30s", "--", "/usr/bin/setpriv", "--reuid", strconv.Itoa(uid), "--regid", strconv.Itoa(gid), "--clear-groups", "--inh-caps=-all", "--ambient-caps=-all", "--bounding-set=-all", "--no-new-privs", "--", "/usr/bin/bash", "--noprofile", "--norc", "-i"}
	launch := exec.Command("/usr/bin/systemd-run", args...)
	launch.Env = []string{"PATH=/usr/bin:/bin", "TERM=xterm", "HOME=" + work, "HISTFILE=/dev/null", "PS1=QUALIFICATION-PROMPT> "}
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
			t.Error("owned editor cleanup unconfirmed")
		}
	})
	var pending []byte
	readUntil := func(needle string) {
		t.Helper()
		_ = master.SetReadDeadline(time.Now().Add(4 * time.Second))
		buf := make([]byte, 4096)
		for {
			if index := bytes.Index(pending, []byte(needle)); index >= 0 {
				pending = pending[index+len(needle):]
				return
			}
			n, err := master.Read(buf)
			pending = append(pending, buf[:n]...)
			if err != nil || len(pending) > 128*1024 {
				t.Fatalf("interactive fixture did not produce %q: %v output=%q", needle, err, pending)
			}
		}
	}
	write := func(value string) {
		t.Helper()
		if n, err := master.Write([]byte(value)); err != nil || n != len(value) {
			t.Fatal("owned editor PTY write failed", n, err)
		}
	}
	readUntil("QUALIFICATION-PROMPT>")
	pin := func(pid int) *monitoringProcessGuard {
		t.Helper()
		id, err := snapshotMonitoringProcess(pid)
		if err != nil || id.uids != [4]uint32{uint32(uid), uint32(uid), uint32(uid), uint32(uid)} {
			t.Fatal("unverified synthetic editor identity", err)
		}
		guard, err := pinMonitoringProcess(id)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(guard.close)
		return guard
	}
	shell := pin(launch.Process.Pid)
	find := func(executable string) *monitoringProcessGuard {
		t.Helper()
		until := time.Now().Add(time.Second)
		for time.Now().Before(until) {
			data, err := os.ReadFile(filepath.Join("/sys/fs/cgroup/exam.slice", unit, "cgroup.procs"))
			if err != nil {
				t.Fatal(err)
			}
			for _, value := range strings.Fields(string(data)) {
				pid, err := strconv.Atoi(value)
				if err != nil {
					t.Fatal(err)
				}
				path, err := os.Readlink(filepath.Join("/proc", value, "exe"))
				if err == nil && filepath.Base(path) == executable {
					return pin(pid)
				}
			}
			time.Sleep(time.Millisecond)
		}
		t.Fatal("owned fixture executable did not start", executable)
		return nil
	}
	signal := func(g *monitoringProcessGuard, sig unix.Signal) {
		t.Helper()
		if !g.current() {
			t.Fatal("owned editor process no longer live")
		}
		if err := unix.PidfdSendSignal(int(g.file.Fd()), sig, nil, 0); err != nil {
			t.Fatal(err)
		}
	}
	state := func(g *monitoringProcessGuard) string {
		t.Helper()
		data, err := monitoringProcBytes(g.identity.pid, "stat", 4096)
		if err != nil || !g.current() {
			t.Fatal("owned editor process state unknown", err)
		}
		fields := strings.Fields(string(data[strings.LastIndexByte(string(data), ')')+1:]))
		if len(fields) == 0 {
			t.Fatal("owned editor process state malformed")
		}
		return fields[0]
	}
	stop := func(g *monitoringProcessGuard) {
		t.Helper()
		signal(g, unix.SIGSTOP)
		until := time.Now().Add(time.Second)
		for state(g) != "T" {
			if time.Now().After(until) {
				t.Fatal("owned editor stop unconfirmed")
			}
			time.Sleep(time.Millisecond)
		}
	}
	write("sleep 300 &\n")
	readUntil("QUALIFICATION-PROMPT>")
	background := find("sleep")
	stop(background) // Deliberately stopped BEFORE the hold; must stay stopped.
	write("nano -I -w " + answer + "\n")
	readUntil("qualification-answer")
	readUntil("Exit") // Full editor footer, not merely echoed shell command/title.
	editor := find("nano")
	foreground := func() int {
		t.Helper()
		// The test parent is deliberately outside the child's terminal session.
		// Query the PTY master; TIOCGPGRP on its slave requires that session.
		group, err := unix.IoctlGetInt(int(master.Fd()), unix.TIOCGPGRP)
		if err != nil {
			t.Fatal("owned PTY foreground group unavailable", err)
		}
		return group
	}
	if foreground() != editor.identity.pid {
		t.Fatal("unfrozen editor did not own the foreground terminal")
	}
	write("preserved-unsaved-buffer")
	readUntil("preserved-unsaved-buffer")
	position := func() {
		t.Helper()
		write("\x03")           // Nano Cursor Position proves the editor consumed the keys.
		readUntil("char 24/25") //24 typed bytes; Nano includes the final newline.
	}
	position() // An echoed string alone cannot certify an unsaved editor buffer.
	engine := &Engine{state: State{Registrations: map[string]string{}}}
	a := &Attempt{ID: finalID, Username: "examq", UID: uid, State: "ACTIVE", Units: []string{unit}}
	gate, err := newPaneInputGate(testInputPane, monitoringBootMillis)
	if err != nil {
		t.Fatal(err)
	}
	pty, err := newPanePTYInput(gate, master, slave)
	if err != nil {
		t.Fatal(err)
	}
	for range 3 {
		if _, err := os.Stat(answer); !os.IsNotExist(err) {
			t.Fatal("editor buffer was saved before explicit write-out", err)
		}
		stop(shell) // Prevent the parent consuming an intermediate stop event.
		stop(editor)
		if err := engine.freeze(a, true); err != nil {
			t.Fatal(err)
		}
		if err := engine.verifyWriters(a); err != nil {
			t.Fatal(err)
		}
		write("STALE-UNAUTHORIZED") // Inject actual queued old PTY bytes.
		drain := gate.revoke()
		requirePaneDrain(t, drain)
		if err := pty.discardKernelInput(drain); err != nil {
			t.Fatal(err)
		}
		time.Sleep(30 * time.Millisecond)
		if state(background) != "T" {
			t.Fatal("previously stopped job lost its stopped state")
		}
		if err := engine.freeze(a, false); err != nil {
			t.Fatal(err)
		}
		signal(editor, unix.SIGCONT) // Children before shell; leave original stops.
		signal(shell, unix.SIGCONT)
		time.Sleep(30 * time.Millisecond)
		if group := foreground(); group != editor.identity.pid || !shell.current() || !editor.current() || state(editor) == "T" || state(background) != "T" {
			t.Fatal("foreground editor/job state did not survive", group)
		}
		position()
	}
	write("\x0f") // Nano Write Out, through its real terminal interface.
	readUntil("File Name to Write")
	write("\r") // Actual Enter key (Ctrl-M), not Nano's distinct Ctrl-J binding.
	readUntil("Wrote 1 line")
	data, err := os.ReadFile(answer)
	if err != nil || string(data) != "preserved-unsaved-buffer\n" {
		t.Fatal("original unsaved buffer not preserved, or stale input leaked", err, string(data))
	}
	write("\x18")
	readUntil("QUALIFICATION-PROMPT>")
	write("printf 'SHELL-STILL-ALIVE\\n'\n")
	readUntil("SHELL-STILL-ALIVE\r\n")
	if !shell.current() || state(background) != "T" {
		t.Fatal("shell/original stopped job not preserved after editor exit")
	}
	t.Log("actual bash/nano preserved unsaved buffer, foreground pgrp, shell and original stopped job through three stop/freeze/discard/thaw cycles")
}
