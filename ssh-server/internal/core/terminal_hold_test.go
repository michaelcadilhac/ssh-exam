package core

import (
	"bufio"
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

func TestRetainedHoldOrdersPinnedParentsBeforeChildren(t *testing.T) {
	child := exec.Command("/bin/sleep", "15")
	if err := child.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = child.Process.Kill(); _ = child.Wait() })
	groups := map[int]*terminalHoldGroup{}
	for _, pid := range []int{child.Process.Pid, os.Getpid()} {
		p, err := pinUIDProcess(pid, os.Getuid())
		if err != nil || p == nil {
			t.Fatal("real process pin unavailable", err)
		}
		t.Cleanup(p.close)
		groups[pid] = &terminalHoldGroup{process: p, uid: os.Getuid()}
	}
	for range 20 {
		ordered, err := orderedTerminalHoldGroups(groups)
		if err != nil || len(ordered) != 2 || ordered[0].process.pid != os.Getpid() || ordered[1].process.pid != child.Process.Pid || ordered[1].parent != os.Getpid() {
			t.Fatal("pinned hierarchy did not order parent-stop/child-continue", ordered, err)
		}
	}
}

func TestRetainedGuardianNeverAcceptsAnUnrelatedLiveExecutable(t *testing.T) {
	// This exact process is alive and has a real proc directory/pidfd. Neither
	// root credentials nor membership in the test UID can substitute for the
	// installed Bubblewrap inode in a registered pane scope. No signal is sent.
	group, err := pinTerminalGuardian(os.Getpid(), "unrelated.scope")
	if group != nil {
		group.process.close()
		t.Fatal("accepted an unrelated process as an owned root guardian")
	}
	if err == nil {
		t.Fatal("guardian refusal returned no actionable error")
	}
	if _, err := os.Stat("/proc/self/status"); err != nil {
		t.Fatal("negative guardian observation affected the caller", err)
	}
}

func TestHeldScopeEventsIdentifyKernelRetirementWithoutPathAbsence(t *testing.T) {
	if os.Getenv("EXAM_COLLECTION_USER_SYSTEMD") != "1" || os.Getuid() < 1000 || os.Getuid() != os.Geteuid() {
		t.Skip("requires explicit owned user-manager cgroup qualification")
	}
	unit := "ssh-exam-held-lifetime-" + Token()[:12] + ".scope"
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, "/usr/bin/systemd-run", "--user", "--scope", "--quiet", "--unit="+unit, "--property=Delegate=yes", "--property=MemoryMax=64M", "--property=MemorySwapMax=0", "--property=TasksMax=16", "--property=RuntimeMaxSec=15s", "--", os.Args[0], "-test.run=^TestRetainedScopeTreeChild$")
	command.Env = append(os.Environ(), "EXAM_RETAINED_SCOPE_TREE_CHILD=1", "GORACE=atexit_sleep_ms=0", "GOMAXPROCS=2", "GOMEMLIMIT=48MiB")
	command.Stderr = io.Discard
	stdout, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = command.Process.Kill()
		_ = command.Wait()
		cleanup, done := context.WithTimeout(context.Background(), 3*time.Second)
		defer done()
		_ = exec.CommandContext(cleanup, "/usr/bin/systemctl", "--user", "stop", unit).Run()
		_ = exec.CommandContext(cleanup, "/usr/bin/systemctl", "--user", "reset-failed", unit).Run()
	})
	_ = stdout.(*os.File).SetReadDeadline(time.Now().Add(4 * time.Second))
	line, err := bufio.NewReaderSize(stdout, 1024).ReadString('\n')
	pid, parseErr := strconv.Atoi(strings.TrimSpace(line))
	if err != nil || parseErr != nil || pid != command.Process.Pid {
		t.Fatal("owned scope helper identity unavailable", err, parseErr)
	}
	parent, err := terminalScopeHandle(unit)
	if err != nil {
		t.Fatal(err)
	}
	defer parent.Close()
	if err := unix.Mkdirat(int(parent.Fd()), "empty", 0755); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = unix.Unlinkat(int(parent.Fd()), "empty", unix.AT_REMOVEDIR) }()
	fd, err := unix.Openat(int(parent.Fd()), "empty", unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		t.Fatal(err)
	}
	scope := os.NewFile(uintptr(fd), "owned-empty-scope")
	defer scope.Close()
	fd, err = unix.Openat(int(scope.Fd()), "cgroup.events", unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_CLOEXEC|unix.O_NONBLOCK, 0)
	if err != nil {
		t.Fatal(err)
	}
	events := os.NewFile(uintptr(fd), "owned-empty-scope-events")
	defer events.Close()
	if at, err := events.Seek(0, io.SeekStart); err != nil || at != 0 {
		t.Fatal("live empty cgroup seek must not look retired", at, err)
	}
	if empty, err := retainedScopeHasNoTasks(events); err != nil || !empty {
		t.Fatal("fixed pinned empty events were not recognized", empty, err)
	}
	liveEvents, err := pinTerminalScopeEvents(parent)
	if err != nil {
		t.Fatal(err)
	}
	defer liveEvents.Close()
	if empty, err := retainedScopeHasNoTasks(liveEvents); err != nil || empty {
		t.Fatal("live owned helper was treated as absent", empty, err)
	}
	process, err := pinUIDProcess(pid, os.Getuid())
	if err != nil || process == nil {
		t.Fatal("owned whole-process lifetime unavailable", err)
	}
	defer process.close()
	orphan := &terminalHold{groups: map[int]*terminalHoldGroup{pid: {process: process, uid: os.Getuid()}}, scopes: map[string]*os.File{unit: parent}, scopeEvents: map[string]*os.File{unit: liveEvents}, input: map[string]*paneInputDrain{unit: nil}, resize: map[string]*paneInputDrain{unit: nil}}
	if err := orphan.pruneExited(map[string]bool{}); err == nil || len(orphan.scopes) != 1 || len(orphan.groups) != 1 {
		t.Fatal("missing request metadata overrode the positively live owned writer", err)
	}
	if _, err := events.Seek(0, io.SeekStart); err != nil {
		t.Fatal(err)
	}
	data, err := io.ReadAll(io.LimitReader(events, 513))
	if err != nil || !strings.Contains(string(data), "populated 0\n") || len(data) > 512 {
		t.Fatal("positive empty cgroup observation unavailable", string(data), err)
	}
	if err := terminalScopeWrite(scope, "cgroup.freeze", "1"); err != nil {
		t.Fatal(err)
	}
	if at, err := events.Seek(0, io.SeekStart); err != nil || at != 0 {
		t.Fatal("live changed cgroup must remain active", at, err)
	}
	held := &terminalHold{groups: map[int]*terminalHoldGroup{}, scopes: map[string]*os.File{"empty": scope}, scopeEvents: map[string]*os.File{"empty": events}, input: map[string]*paneInputDrain{"empty": nil}, resize: map[string]*paneInputDrain{"empty": nil}}
	if err := held.pruneExited(map[string]bool{"empty": true}); err != nil || len(held.scopes) != 1 {
		t.Fatal("an empty requested scope was prematurely discarded", err)
	}
	if err := unix.Unlinkat(int(parent.Fd()), "empty", unix.AT_REMOVEDIR); err != nil {
		t.Fatal("remove only the positively empty owned cgroup", err)
	}
	if _, err := events.Seek(0, io.SeekStart); !errors.Is(err, unix.ENODEV) {
		t.Fatal("retained kernel events descriptor did not identify deactivation", err)
	}
	if empty, err := retainedScopeHasNoTasks(events); err != nil || !empty {
		t.Fatal("pinned inactive kernel object was not recognized", empty, err)
	}
	if err := held.pruneExited(map[string]bool{"empty": true}); err != nil || len(held.scopes) != 1 {
		t.Fatal("requested scope retirement was inferred before its launch/request settled", err)
	}
	if err := held.pruneExited(map[string]bool{}); err != nil || len(held.scopes)+len(held.scopeEvents)+len(held.input)+len(held.resize) != 0 {
		t.Fatal("positively retired unrequested scope retained stale hold handles", err)
	}
	if empty, err := retainedScopeHasNoTasks(events); err == nil || empty {
		t.Fatal("closed descriptor became retirement proof", empty, err)
	}
	if err := command.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	_ = command.Wait()
	if live, err := process.live(); err != nil || live {
		t.Fatal("owned writer did not positively exit", live, err)
	}
	if err := orphan.pruneExited(map[string]bool{}); err != nil || len(orphan.scopes)+len(orphan.scopeEvents)+len(orphan.groups)+len(orphan.input)+len(orphan.resize) != 0 {
		t.Fatal("positively exited owned writer/scope could not retire", err)
	}
	t.Log("live/empty/changed kernel object remains seekable; the same pinned events descriptor returns ENODEV only after owned cgroup removal")
}
