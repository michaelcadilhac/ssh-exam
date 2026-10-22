package core

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

func TestMonitoringProcessChild(t *testing.T) {
	if len(os.Args) < 3 || os.Args[len(os.Args)-2] != "--monitoring-process-test" {
		return
	}
	mode := os.Args[len(os.Args)-1]
	if mode == "fake-root-peer" {
		if os.Getuid() != 0 || os.Geteuid() != 0 {
			os.Exit(81)
		}
		if g, err := pinMonitoringSSHProcess(os.Getpid(), 10001, strings.Repeat("a", 64)); g != nil || err != errMonitoringProcess {
			os.Exit(82)
		}
		fmt.Fprintln(os.Stdout, "untrusted synthetic root executable rejected")
		os.Exit(0)
	}
	if mode != "wait" {
		os.Exit(83)
	}
	fmt.Fprintln(os.Stdout, "ready")
	_, _ = io.Copy(io.Discard, os.Stdin)
	os.Exit(0)
}

func monitoringProcessChild(t *testing.T) *exec.Cmd {
	t.Helper()
	cmd := exec.Command("/usr/bin/env", "GORACE=atexit_sleep_ms=0", os.Args[0], "-test.run=^TestMonitoringProcessChild$", "--", "--monitoring-process-test", "wait")
	input, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	output, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = input.Close(); _ = cmd.Wait() })
	ready := make(chan bool, 1)
	go func() {
		line, err := bufio.NewReader(output).ReadString('\n')
		ready <- err == nil && line == "ready\n"
	}()
	select {
	case ok := <-ready:
		if !ok {
			t.Fatal("synthetic process not ready")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("synthetic process readiness timed out")
	}
	return cmd
}

func monitoringProcessPin(t *testing.T, cmd *exec.Cmd) *monitoringProcessGuard {
	t.Helper()
	id, err := snapshotMonitoringProcess(cmd.Process.Pid)
	if err != nil {
		t.Fatal(err)
	}
	g, err := pinMonitoringProcess(id)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(g.close)
	if !g.current() || g.observation() != "live" {
		t.Fatal("owned live child not pinned")
	}
	flags, err := unix.FcntlInt(g.file.Fd(), unix.F_GETFD, 0)
	if err != nil || flags&unix.FD_CLOEXEC == 0 {
		t.Fatal("kernel handle can leak across unrelated exec", err)
	}
	return g
}

func TestMonitoringProcessKernelExitIsNotAStallOrAnotherCommandExit(t *testing.T) {
	transport := monitoringProcessChild(t)
	g := monitoringProcessPin(t, transport)
	if err := transport.Process.Signal(syscall.SIGSTOP); err != nil {
		t.Fatal(err)
	}
	if !g.current() || g.observation() != "live" {
		t.Fatal("stopped process misclassified as exit/authentication loss")
	}
	if err := transport.Process.Signal(syscall.SIGCONT); err != nil {
		t.Fatal(err)
	}
	command := monitoringProcessChild(t)
	if err := command.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	if err := command.Wait(); err == nil {
		t.Fatal("synthetic command did not exit")
	}
	if !g.current() {
		t.Fatal("unrelated command exit retired the retained owner")
	}
	if err := transport.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	if err := transport.Wait(); err == nil {
		t.Fatal("synthetic transport process did not exit")
	}
	if g.current() || g.observation() != "exited" {
		t.Fatal("exact kernel process death was not observed")
	}
	if next, err := pinMonitoringProcess(g.identity); next != nil || err != errMonitoringProcess {
		t.Fatal("old identity recreated a positive lifetime", err)
	}
}

func TestMonitoringProcessRejectsChangedIdentityAndJSONCannotRestoreALiveHandle(t *testing.T) {
	cmd := monitoringProcessChild(t)
	g := monitoringProcessPin(t, cmd)
	for _, change := range []func(*monitoringProcessIdentity){func(id *monitoringProcessIdentity) { id.pid = 0 }, func(id *monitoringProcessIdentity) { id.start++ }, func(id *monitoringProcessIdentity) { id.boot = "11111111-1111-4111-8111-111111111111" }, func(id *monitoringProcessIdentity) { id.uids[2]++ }, func(id *monitoringProcessIdentity) { id.device++ }, func(id *monitoringProcessIdentity) { id.inode++ }} {
		bad := g.identity
		change(&bad)
		if other, err := pinMonitoringProcess(bad); other != nil || err != errMonitoringProcess {
			if other != nil {
				other.close()
			}
			t.Fatal("changed scope accepted", err)
		}
	}
	b, err := json.Marshal(g)
	if err != nil {
		t.Fatal(err)
	}
	var restored monitoringProcessGuard
	if json.Unmarshal(b, &restored) != nil || restored.current() || restored.observation() != "unknown" {
		t.Fatal("persisted metadata reconstructed a live kernel handle")
	}
	fabricated := &monitoringProcessGuard{status: "live", identity: g.identity}
	if fabricated.current() || fabricated.observation() != "unknown" {
		t.Fatal("a live label without a kernel handle became proof")
	}
}

func TestMonitoringProcessKernelDeathFencesPendingSyntheticAuthorityPublication(t *testing.T) {
	cmd := monitoringProcessChild(t)
	g := monitoringProcessPin(t, cmd)
	f := nativeAuthorityFixture(t, false, 5000)
	c := sealedAuthorityTestContext(f.context)
	c.verified.current = g.current // Synthetic ACTIVE seal, not actual SSH proof.
	var err error
	f.a, err = newMonitoringAuthority(c, func() (int64, error) { return f.clock.Load(), nil })
	if err != nil {
		t.Fatal(err)
	}
	ticket := f.prepare(t, f.proof(t, 4, 0))
	if err := cmd.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	if err := cmd.Wait(); err == nil {
		t.Fatal("synthetic owner did not exit")
	}
	if _, err := f.a.published(ticket, ticket.publicationHash); err != errMonitoringAuthority {
		t.Fatal("kernel-dead owner accepted late authority", err)
	}
	v := f.a.check()
	if v.ExecutionAuthorized || v.Phase != "revoking" || len(v.Causes) != 1 || v.Causes[0] != "ownership-unknown" {
		t.Fatal("unknown ownership mislabeled or restored", v)
	}
}

func TestMonitoringProcessClosedAndUnknownAreNotClaimedAsAuthenticationLoss(t *testing.T) {
	cmd := monitoringProcessChild(t)
	closed := monitoringProcessPin(t, cmd)
	closed.close()
	closed.close()
	if closed.current() || closed.observation() != "closed" {
		t.Fatal("retirement misclassified")
	}
	unknown := monitoringProcessPin(t, cmd)
	// Private misuse/failure injection only. A failed handle read is NOT positive
	// process-death evidence and must not be labelled authentication loss.
	unknown.file.Close()
	if unknown.current() || unknown.observation() != "unknown" {
		t.Fatal("unknown handle became positive process exit")
	}
}

func TestMonitoringProcessConcurrentCloseAndNonblockingChecks(t *testing.T) {
	cmd := monitoringProcessChild(t)
	g := monitoringProcessPin(t, cmd)
	var workers sync.WaitGroup
	for range 8 {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for range 200 {
				g.current()
				g.observation()
			}
		}()
	}
	g.close()
	workers.Wait()
	if g.current() || g.observation() != "closed" {
		t.Fatal("closed lifetime revived")
	}
}

func TestMonitoringProcessActualRootMappedFakePeerStillRequiresInstalledSSHInodes(t *testing.T) {
	if os.Getenv("EXAM_MANAGEMENT_USERNS") != "1" {
		t.Skip("set EXAM_MANAGEMENT_USERNS=1 for synthetic root-peer refusal")
	}
	cmd := exec.Command("/usr/bin/env", "GORACE=atexit_sleep_ms=0", "/usr/bin/unshare", "--user", "--map-root-user", os.Args[0], "-test.run=^TestMonitoringProcessChild$", "--", "--monitoring-process-test", "fake-root-peer")
	output, err := cmd.CombinedOutput()
	if err != nil || !strings.Contains(string(output), "untrusted synthetic root executable rejected") {
		t.Fatal("untrusted root process admitted as SSH owner", err, string(output))
	}
}
