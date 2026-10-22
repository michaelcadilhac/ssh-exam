package core

// Disposable-guest integration of the existing freeze/UID inspection and unused
// local PTY gate. NOT root admission, a live retained-SSH workflow or thaw policy.

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
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

const monitoringFrozenProgram = `import ctypes,json,os,sys,time
buffer="unsaved-editor-buffer"
writer=os.fork()
if writer==0:
 f=os.open(sys.argv[1],os.O_WRONLY|os.O_CREAT|os.O_APPEND,0o600)
 while True:
  os.write(f,b"x")
  time.sleep(.02)
libc=ctypes.CDLL(None,use_errno=True)
libc.syscall.restype=ctypes.c_long
uring={}
for name,flags in (("basic_errno",0),("sqpoll_errno",2)):
 params=(ctypes.c_uint32*30)()
 assert ctypes.sizeof(params)==120
 params[2]=flags
 params[4]=1 if flags else 0
 ring=libc.syscall(ctypes.c_long(int(sys.argv[2])),ctypes.c_uint(2),ctypes.byref(params))
 uring[name]=ctypes.get_errno() if ring<0 else 0
 if ring>=0: os.close(ring)
os.write(1,(json.dumps({"pid":os.getpid(),"writer":writer,"buffer":buffer,"kernel":os.uname().release,"uring":uring})+"\n").encode())
pending=b""
while True:
 chunk=os.read(0,1)
 if not chunk: break
 pending+=chunk
 if chunk==b"\n":
  os.write(1,(json.dumps({"pid":os.getpid(),"writer":writer,"buffer":buffer,"input":pending.decode("ascii")})+"\n").encode())
  pending=b""
`

func TestMonitoringFreezePTYGuest(t *testing.T) {
	uid := requireMonitoringGuest(t, "monitoring-freeze", "EXAM_MONITORING_FREEZE_GUEST")
	account, err := user.Lookup("examq")
	if err != nil {
		t.Fatal(err)
	}
	gid, err := strconv.Atoi(account.Gid)
	if err != nil || gid < 1000 {
		t.Fatal("invalid synthetic account GID")
	}
	dir, err := os.MkdirTemp("/var/tmp", "qualification-freeze-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) }) // Exact new private guest fixture only.
	if os.Chmod(dir, 0o755) != nil || os.Mkdir(filepath.Join(dir, "work"), 0o700) != nil || os.Chown(filepath.Join(dir, "work"), uid, gid) != nil {
		t.Fatal("private synthetic work directory unavailable")
	}
	writerFile := filepath.Join(dir, "work", "background-writes")
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
	gate, err := newPaneInputGate(testInputPane, monitoringBootMillis)
	if err != nil {
		t.Fatal(err)
	}
	pty, err := newPanePTYInput(gate, master, slave)
	if err != nil {
		t.Fatal(err)
	}
	unit := "exam-qualification-freeze-" + Token()[:16] + ".scope"
	drop := []string{"--reuid", strconv.Itoa(uid), "--regid", strconv.Itoa(gid), "--clear-groups", "--inh-caps=-all", "--ambient-caps=-all", "--bounding-set=-all", "--no-new-privs", "--"}
	workload := append(append([]string{}, drop...), "/usr/bin/python3", "-u", "-c", monitoringFrozenProgram, writerFile, strconv.Itoa(unix.SYS_IO_URING_SETUP))
	args := []string{"--scope", "--quiet", "--unit=" + strings.TrimSuffix(unit, ".scope"), "--slice=exam.slice", "--property=Delegate=no", "--property=MemoryMax=64M", "--property=MemorySwapMax=0", "--property=TasksMax=16", "--property=RuntimeMaxSec=30s", "--", "/usr/bin/setpriv"}
	launch := exec.Command("/usr/bin/systemd-run", append(args, workload...)...)
	launch.Dir = "/"
	launch.Stdin, launch.Stdout, launch.Stderr = slave, slave, slave
	launch.SysProcAttr = &syscall.SysProcAttr{Setsid: true, Setctty: true, Ctty: 0}
	if err := launch.Start(); err != nil {
		t.Fatal("private workload scope did not start", err)
	}
	ended := make(chan error, 1)
	go func() { ended <- launch.Wait() }()
	t.Cleanup(func() {
		gate.revoke()
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		_ = exec.CommandContext(ctx, "/usr/bin/systemctl", "kill", "--signal=KILL", unit).Run()
		_ = exec.CommandContext(ctx, "/usr/bin/systemctl", "stop", unit).Run()
		_ = launch.Process.Kill()
		select {
		case <-ended:
		case <-ctx.Done():
			t.Error("private workload cleanup unconfirmed")
		}
	})
	reader := bufio.NewReader(master)
	type report struct {
		PID, Writer   int
		Buffer, Input string
		Kernel        string
		Uring         map[string]int
	}
	read := func() report {
		t.Helper()
		_ = master.SetReadDeadline(time.Now().Add(5 * time.Second))
		line, err := reader.ReadBytes('\n')
		var r report
		if err != nil || len(line) > 4096 || json.Unmarshal(line, &r) != nil || r.PID < 2 || r.Writer < 2 || r.Buffer != "unsaved-editor-buffer" {
			t.Fatal("private workload response unavailable/changed", err, string(line))
		}
		return r
	}
	initial := read()
	if initial.Kernel == "" || len(initial.Uring) != 2 {
		t.Fatal("kernel/async-IO capability observation missing")
	}
	t.Logf("guest kernel=%s; unprivileged setup errno=%v (0=available, not async-IO freeze qualification)", initial.Kernel, initial.Uring)
	if initial.PID != launch.Process.Pid {
		t.Fatal("scope did not exec the exact owned child")
	}
	var handles []int
	for _, pid := range []int{initial.PID, initial.Writer} {
		fd, err := unix.PidfdOpen(pid, 0)
		if err != nil {
			t.Fatal("synthetic workload kernel identity unavailable", err)
		}
		t.Cleanup(func() { _ = unix.Close(fd) })
		handles = append(handles, fd)
	}
	engine := &Engine{state: State{Registrations: map[string]string{}}}
	deadline := Millis() + 60000
	a := &Attempt{ID: finalID, Username: "examq", UID: uid, State: "ACTIVE", Start: Millis(), Deadline: deadline, OriginalDeadline: deadline, Units: []string{unit}}
	if err := engine.verifyWriters(a); err != nil {
		t.Fatal("healthy contained synthetic writers rejected", err)
	}
	bytesWritten := func() int64 {
		t.Helper()
		info, err := os.Stat(writerFile)
		if err != nil {
			t.Fatal("synthetic background writer unavailable", err)
		}
		return info.Size()
	}
	until := time.Now().Add(time.Second)
	for {
		info, err := os.Stat(writerFile)
		if err == nil && info.Size() > 2 {
			break
		}
		if time.Now().After(until) {
			t.Fatal("synthetic background writer did not run")
		}
		time.Sleep(10 * time.Millisecond)
	}
	bootNow, err := monitoringBootMillis()
	if err != nil {
		t.Fatal(err)
	}
	cutoff, fixedDeadline := bootNow+15000, bootNow+60000
	epoch := Token()
	if err := gate.arm(gate.revoke(), epoch, cutoff, fixedDeadline); err != nil {
		t.Fatal(err)
	}
	oldSequence := uint64(1)
	for range 3 {
		if err := engine.freeze(a, true); err != nil {
			t.Fatal("actual scope freeze unconfirmed", err)
		}
		if err := engine.verifyWriters(a); err != nil {
			t.Fatal("frozen UID containment unconfirmed", err)
		}
		before := bytesWritten()
		time.Sleep(150 * time.Millisecond)
		if bytesWritten() != before {
			t.Fatal("background descendant wrote during confirmed freeze")
		}
		// Model bytes completing before drain while the actual reader is frozen.
		// Direct fresh input is revoked before the caller could claim a hold.
		if n, err := gate.forward(paneGateFrame(epoch, oldSequence, "STALE\n"), pty.write); err != nil || n != 6 {
			t.Fatal("could not establish actual pending old PTY bytes", n, err)
		}
		drain := gate.revoke()
		requirePaneDrain(t, drain)
		until = time.Now().Add(time.Second)
		for {
			waiting, err := unix.IoctlGetInt(int(slave.Fd()), unix.TIOCINQ)
			if err != nil {
				t.Fatal(err)
			}
			if waiting > 0 {
				break
			}
			if time.Now().After(until) {
				t.Fatal("old input did not reach the frozen PTY queue")
			}
			time.Sleep(time.Millisecond)
		}
		if err := pty.discardKernelInput(drain); err != nil {
			t.Fatal("verified frozen PTY discard failed", err)
		}
		oldEpoch := epoch
		epoch = Token()
		if err := gate.arm(drain, epoch, cutoff, fixedDeadline); err != nil {
			t.Fatal("fresh local epoch refused", err)
		}
		if n, err := gate.forward(paneGateFrame(oldEpoch, 2, "LATE\n"), pty.write); err != errPaneInputScope || n != 0 {
			t.Fatal("late prior-epoch bytes admitted", n, err)
		}
		if err := engine.freeze(a, false); err != nil {
			t.Fatal("test-only authorized local thaw unconfirmed", err)
		}
		if n, err := gate.forward(paneGateFrame(epoch, 2, "FRESH\n"), pty.write); err != nil || n != 6 {
			t.Fatal("fresh input unavailable after local barrier", n, err)
		}
		r := read()
		if r.PID != initial.PID || r.Writer != initial.Writer || r.Input != "FRESH\n" || r.Buffer != initial.Buffer {
			t.Fatal("buffer/process changed or stale input survived the barrier", r)
		}
		for _, fd := range handles {
			if n, err := unix.Poll([]unix.PollFd{{Fd: int32(fd), Events: unix.POLLIN}}, 0); err != nil || n != 0 {
				t.Fatal("exact workload process exited during freeze/thaw", n, err)
			}
		}
		until = time.Now().Add(time.Second)
		for bytesWritten() <= before {
			if time.Now().After(until) {
				t.Fatal("background writer did not resume")
			}
			time.Sleep(10 * time.Millisecond)
		}
		oldSequence = 3 // The current epoch has already consumed FRESH sequence2.
	}
	if a.Deadline != deadline || a.OriginalDeadline != deadline || a.State != "ACTIVE" {
		t.Fatal("freeze test changed synthetic timing/state")
	}
	// Containment cannot be inferred from the recorded unit alone.
	outside := exec.Command("/usr/bin/setpriv", append(append([]string{}, drop...), "/usr/bin/python3", "-c", "import time;time.sleep(20)")...)
	outside.Stdout, outside.Stderr = io.Discard, io.Discard
	if err := outside.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = outside.Process.Kill(); _ = outside.Wait() })
	// Wait for the already-owned child to finish its UID drop before inspecting.
	until = time.Now().Add(time.Second)
	for {
		status, _ := os.ReadFile("/proc/" + strconv.Itoa(outside.Process.Pid) + "/status")
		if strings.Contains(string(status), "Uid:\t"+strconv.Itoa(uid)+"\t") {
			break
		}
		if time.Now().After(until) {
			t.Fatal("uncontained fixture did not enter the synthetic UID")
		}
		time.Sleep(time.Millisecond)
	}
	if err := engine.verifyWriters(a); err == nil {
		t.Fatal("uncontained same-UID writer was accepted")
	}
	t.Log("three actual descendant freezes preserve process/buffer state; pending/late input discarded; uncontained UID writer refuses")
}
