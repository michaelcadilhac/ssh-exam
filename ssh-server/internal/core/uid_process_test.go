package core

import (
	"os"
	"os/exec"
	"runtime"
	"strings"
	"syscall"
	"testing"
	"time"
	"unsafe"

	"golang.org/x/sys/unix"
)

func TestWriterProcessLifetimeReadinessUsesOwnKernelIdentity(t *testing.T) {
	if err := writerProcessLifetimeReady(); err != nil {
		t.Fatal(err)
	}
}

func TestWriterProcessLifetimeDeniedSyscallHelper(t *testing.T) {
	mode := os.Getenv("EXAM_OWNED_LIFETIME_DENY")
	if mode == "" {
		return
	}
	var number uint32
	switch mode {
	case "open":
		number = unix.SYS_PIDFD_OPEN
	case "signal":
		number = unix.SYS_PIDFD_SEND_SIGNAL
	case "poll":
		number = unix.SYS_PPOLL
	default:
		t.Fatal("invalid owned syscall fixture")
	}
	// One owned child/thread only. This filter is a fault injector, NOT a
	// security boundary or a production sandbox policy. All other calls allowed.
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	filter := []unix.SockFilter{
		{Code: unix.BPF_LD | unix.BPF_W | unix.BPF_ABS, K: 0},
		{Code: unix.BPF_JMP | unix.BPF_JEQ | unix.BPF_K, K: number, Jf: 1},
		{Code: unix.BPF_RET | unix.BPF_K, K: unix.SECCOMP_RET_ERRNO | uint32(unix.ENOSYS)},
		{Code: unix.BPF_RET | unix.BPF_K, K: unix.SECCOMP_RET_ALLOW},
	}
	program := unix.SockFprog{Len: uint16(len(filter)), Filter: &filter[0]}
	if err := unix.Prctl(unix.PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0); err != nil {
		t.Fatal(err)
	}
	if _, _, err := syscall.RawSyscall6(unix.SYS_PRCTL, unix.PR_SET_SECCOMP, unix.SECCOMP_MODE_FILTER, uintptr(unsafe.Pointer(&program)), 0, 0, 0); err != 0 {
		t.Fatal(err)
	}
	err := writerProcessLifetimeReady()
	runtime.KeepAlive(filter)
	if err == nil || !strings.Contains(err.Error(), "kernel process-lifetime isolation unavailable") || !strings.Contains(err.Error(), "examctl health") || !strings.Contains(err.Error(), "never fall back") {
		t.Fatal("denied syscall did not produce actionable readiness refusal", mode, err)
	}
	t.Log("OWNED_KERNEL_LIFETIME_REFUSED", mode)
}

func TestWriterProcessLifetimeReadinessRefusesActualDeniedSyscalls(t *testing.T) {
	for _, mode := range []string{"open", "signal", "poll"} {
		t.Run(mode, func(t *testing.T) {
			command := exec.Command(os.Args[0], "-test.run=^TestWriterProcessLifetimeDeniedSyscallHelper$")
			command.Env = append(os.Environ(), "EXAM_OWNED_LIFETIME_DENY="+mode, "GORACE=atexit_sleep_ms=0")
			output, err := command.CombinedOutput()
			if err != nil || !strings.Contains(string(output), "PASS") {
				t.Fatal("owned kernel denial fixture failed", err, string(output))
			}
		})
	}
}

func TestWriterUIDStatusRequiresAllFourValidFields(t *testing.T) {
	for _, data := range []string{"", "Uid: 1234 1234 1234\n", "Uid: 1234 1234 1234 -1\n", "Uid: 1234 1234 1234 4294967296\n", "Uid: 1234 1234 1234 1234\nUid: 1 1 1 1\n"} {
		if _, err := statusHasUID([]byte(data), 1234); err == nil {
			t.Fatalf("invalid observation accepted %q", data)
		}
	}
	for n := 0; n < 4; n++ {
		values := []string{"1", "1", "1", "1"}
		values[n] = "1234"
		data := "State:\tZ (zombie)\nUid:\t" + values[0] + "\t" + values[1] + "\t" + values[2] + "\t" + values[3] + "\n"
		if owns, err := statusHasUID([]byte(data), 1234); err != nil || !owns {
			t.Fatal("UID component missed", n, err)
		}
		if owns, err := statusHasUID([]byte(data), 1235); err != nil || owns {
			t.Fatal("unrelated UID matched", n, err)
		}
	}
	for _, uid := range []int{-1, 4294967295} {
		if _, err := pinUIDProcesses(uid); err == nil {
			t.Fatal("invalid account accepted", uid)
		}
	}
}

func TestUIDProcessExitHelper(t *testing.T) {
	if os.Getenv("EXAM_OWNED_PROCESS_EXIT") == "1" {
		os.Exit(0)
	}
}

func TestPinnedUIDProcessReallyDeadAndReapedGroupsAreNotWriters(t *testing.T) {
	command := exec.Command(os.Args[0], "-test.run=^TestUIDProcessExitHelper$")
	command.Env = append(os.Environ(), "EXAM_OWNED_PROCESS_EXIT=1", "GORACE=atexit_sleep_ms=0")
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = command.Process.Kill(); _ = command.Wait() })
	fd, err := unix.PidfdOpen(command.Process.Pid, 0)
	if err != nil {
		t.Fatal(err)
	}
	p := &uidProcess{pid: command.Process.Pid, handle: os.NewFile(uintptr(fd), "owned-exit-handle")}
	defer p.close()
	until := time.Now().Add(4 * time.Second)
	for {
		live, err := p.live()
		if err != nil {
			t.Fatal(err)
		}
		if !live {
			break
		}
		if time.Now().After(until) {
			t.Fatal("owned child did not exit")
		}
		time.Sleep(time.Millisecond)
	}
	// It has not been waited: distinguish a truly dead zombie group from the
	// zombie leader with live worker in the separate compiler regression.
	if observed, err := pinUIDProcess(command.Process.Pid, os.Getuid()); err != nil || observed != nil {
		if observed != nil {
			observed.close()
		}
		t.Fatal("dead zombie group counted as writer", err)
	}
	if err := command.Wait(); err != nil {
		t.Fatal(err)
	}
	if live, err := p.live(); err != nil || live {
		t.Fatal("reaped original handle became live", live, err)
	}
	if err := p.kill(os.Getuid()); err != nil {
		t.Fatal("already dead group must be harmless", err)
	}
	if err := p.control(func(fd int) error { return unix.PidfdSendSignal(fd, 0, nil, 0) }); err != unix.ESRCH {
		t.Fatal("dead original handle does not report ESRCH", err)
	}
	p.close()
	if live, err := p.live(); err == nil || live {
		t.Fatal("closed handle became a no-writer proof", live, err)
	}
	if err := p.kill(os.Getuid()); err == nil {
		t.Fatal("closed handle silently accepted")
	}
}
