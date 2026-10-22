package core

// Uses only one owned unprivileged process and private files. Never call UID
// termination/quiesce on the developer's UID, signal another PID or change state.
import (
	"bufio"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

func TestUIDEnumerationDoesNotIgnoreLiveThreadsAfterLeaderExit(t *testing.T) {
	if os.Getenv("EXAM_COMPILER_WORKLOADS") != "1" {
		t.Skip("requires known installed compiler workload opt-in")
	}
	if os.Getuid() < 1000 || os.Geteuid() != os.Getuid() {
		t.Skip("local synthetic workload must be unprivileged")
	}
	dir := t.TempDir()
	binary := filepath.Join(dir, "thread-fixture")
	output := filepath.Join(dir, "writes")
	compile := exec.Command("gcc", "-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-pthread", "-o", binary, filepath.Join("..", "..", "tests", "thread_leader_fixture.c"))
	if data, err := compile.CombinedOutput(); err != nil {
		t.Fatal("compile owned thread fixture", err, string(data))
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, binary, output)
	stdout, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = command.Process.Kill(); _ = command.Wait() }) // This exact owned child only.
	file := stdout.(*os.File)
	_ = file.SetReadDeadline(time.Now().Add(3 * time.Second))
	line, err := bufio.NewReaderSize(file, 1024).ReadString('\n')
	if err != nil || len(line) > 1024 {
		t.Fatal("owned thread fixture report missing", err)
	}
	var pid, tid int
	if _, err := fmt.Sscanf(line, "%d %d", &pid, &tid); err != nil || pid != command.Process.Pid || tid == pid || tid < 2 {
		t.Fatal("unexpected owned process/thread identity", line, err)
	}
	fd, err := unix.PidfdOpen(pid, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer unix.Close(fd)
	statusPath := fmt.Sprintf("/proc/%d/status", pid)
	var status []byte
	until := time.Now().Add(2 * time.Second)
	for time.Now().Before(until) {
		status, err = os.ReadFile(statusPath)
		if err == nil && strings.Contains(string(status), "State:\tZ") {
			break
		}
		time.Sleep(2 * time.Millisecond)
	}
	if err != nil || !strings.Contains(string(status), "State:\tZ") {
		t.Fatal("fixture did not reach zombie leader while worker lives", err)
	}
	poll := []unix.PollFd{{Fd: int32(fd), Events: unix.POLLIN}}
	if _, err := unix.Poll(poll, 0); err != nil || poll[0].Revents != 0 {
		t.Fatal("owned thread group is not positively live", err, poll[0].Revents)
	}
	first, err := os.Stat(output)
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(35 * time.Millisecond)
	next, err := os.Stat(output)
	if err != nil || next.Size() <= first.Size() {
		t.Fatal("surviving synthetic worker did not continue writing", err)
	}
	tasks, taskErr := os.ReadDir(fmt.Sprintf("/proc/%d/task", pid))
	_, exeErr := os.Readlink(fmt.Sprintf("/proc/%d/exe", pid))
	t.Logf("owned leader is Z, group pidfd remains live, file grows; task entries=%d task_error=%v executable_view_available=%v", len(tasks), taskErr, exeErr == nil)
	pids, err := uidProcesses(os.Getuid())
	if err != nil {
		t.Fatal("UID observation failed", err)
	}
	found := false
	for _, value := range pids {
		if value == pid {
			found = true
		}
	}
	if !found {
		t.Fatal("live thread group omitted solely because leader is zombie", strconv.Itoa(pid))
	}
	p, err := pinUIDProcess(pid, os.Getuid())
	if err != nil || p == nil {
		t.Fatal("surviving group not pinned", err)
	}
	defer p.close()
	cg, err := p.read("cgroup", 131072)
	if err != nil {
		t.Fatal("surviving leader cgroup view unavailable", err)
	}
	t.Logf("surviving group cgroup=%q", cg)
	e := &Engine{state: State{Registrations: map[string]string{}}}
	a := &Attempt{ID: finalID, Username: "synthetic-only", UID: os.Getuid()}
	for _, release := range []bool{false, true} {
		if err := e.inspectWriter(a, release, p); err == nil || !strings.Contains(err.Error(), "uncontained process "+strconv.Itoa(pid)) {
			t.Fatal("live uncontained worker incorrectly exempted because leader executable disappeared", release, err)
		}
	}
	// Wrong-account checks cannot kill even this owned child. The write must
	// continue, then a signal through its original pinned handle ends the GROUP.
	if err := p.kill(os.Getuid() + 1); err == nil {
		t.Fatal("wrong account allowed signal")
	}
	if live, err := p.live(); err != nil || !live {
		t.Fatal("wrong-account check affected owned child", live, err)
	}
	if err := p.control(func(fd int) error { return unix.PidfdSendSignal(fd, unix.SIGSTOP, nil, 0) }); err != nil {
		t.Fatal(err)
	}
	until = time.Now().Add(time.Second)
	for {
		workerStatus, err := os.ReadFile(fmt.Sprintf("/proc/%d/task/%d/status", pid, tid))
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(workerStatus), "State:\tT") {
			break
		}
		if time.Now().After(until) {
			t.Fatal("owned worker did not stop")
		}
		time.Sleep(time.Millisecond)
	}
	if live, err := p.live(); err != nil || !live {
		t.Fatal("stopped group mistaken for exited", live, err)
	}
	if observed, err := pinUIDProcess(pid, os.Getuid()); err != nil || observed == nil {
		t.Fatal("stopped surviving group omitted", err)
	} else {
		observed.close()
	}
	beforeStop, err := os.Stat(output)
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(35 * time.Millisecond)
	afterStop, err := os.Stat(output)
	if err != nil || beforeStop.Size() != afterStop.Size() {
		t.Fatal("owned worker did not remain stopped", err)
	}
	if err := p.control(func(fd int) error { return unix.PidfdSendSignal(fd, unix.SIGCONT, nil, 0) }); err != nil {
		t.Fatal(err)
	}
	uncertain, err := pinUIDProcess(pid, os.Getuid())
	if err != nil || uncertain == nil {
		t.Fatal(err)
	}
	if err := uncertain.proc.Close(); err != nil {
		t.Fatal(err)
	}
	if err := e.inspectWriter(a, false, uncertain); err == nil || !strings.Contains(err.Error(), "containment unavailable") {
		t.Fatal("uncertain live view became no-writer proof", err)
	}
	if err := uncertain.kill(os.Getuid()); err == nil {
		t.Fatal("missing pinned UID view allowed signal")
	}
	uncertain.close()
	if live, err := p.live(); err != nil || !live {
		t.Fatal("uncertain view affected owned worker", live, err)
	}
	if _, err := p.read("status", 1); err == nil {
		t.Fatal("oversize pinned observation accepted")
	}
	if _, err := p.read("../status", 16384); err == nil {
		t.Fatal("non-allowlisted process path accepted")
	}
	if err := p.kill(os.Getuid()); err != nil {
		t.Fatal("pinned group kill failed", err)
	}
	until = time.Now().Add(2 * time.Second)
	for time.Now().Before(until) {
		live, err := p.live()
		if err != nil {
			t.Fatal(err)
		}
		if !live {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("surviving thread group did not terminate through exact pinned handle")
}
