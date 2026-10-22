package core

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

func TestRetainedThreadDecoderIsBoundedAndNeverInventsMembership(t *testing.T) {
	for _, input := range []string{"0\n", "-1\n", "+1\n", "01\n", "1", "\n", "1\n\n", "1\n1\n", "1 2\n", "2147483648\n", strings.Repeat("1\n", retainedThreadLimit+1), strings.Repeat("x", retainedThreadBytes+1)} {
		if _, err := decodeRetainedThreadIDs([]byte(input)); err != errRetainedThreadInventory {
			t.Fatalf("invalid/ambiguous kernel IDs accepted (%d bytes)", len(input))
		}
	}
	if ids, err := decodeRetainedThreadIDs([]byte("19\n2\n2147483647\n")); err != nil || !reflect.DeepEqual(ids, []int{2, 19, 2147483647}) {
		t.Fatal("valid unordered observation rejected", ids, err)
	}
	if ids, err := decodeRetainedThreadIDs(nil); err != nil || len(ids) != 0 {
		t.Fatal("empty observation decoded incorrectly", ids, err)
	}
	var maximum strings.Builder
	for id := 1; id <= retainedThreadLimit; id++ {
		fmt.Fprintln(&maximum, id)
	}
	if ids, err := decodeRetainedThreadIDs([]byte(maximum.String())); err != nil || len(ids) != retainedThreadLimit || ids[0] != 1 || ids[len(ids)-1] != retainedThreadLimit {
		t.Fatal("maximum bounded canonical observation rejected", err)
	}
}

func TestRetainedThreadInventoryRefusesFakeAndClosedKernelViews(t *testing.T) {
	if ids, err := readRetainedCgroupThreads(nil); err == nil || ids != nil {
		t.Fatal("nil view became membership proof")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "cgroup.threads")
	if err := unix.Mkfifo(path, 0600); err != nil {
		t.Fatal(err)
	}
	f, err := os.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	// The filesystem/type check must reject before trying the blocking FIFO.
	if ids, err := readRetainedCgroupThreads(f); err == nil || ids != nil {
		t.Fatal("ordinary filesystem/FIFO became kernel membership")
	}
	f.Close()
	if ids, err := readRetainedCgroupThreads(f); err == nil || ids != nil {
		t.Fatal("closed descriptor became empty membership")
	}
	ordinary := t.TempDir()
	if err := os.WriteFile(filepath.Join(ordinary, "cgroup.threads"), []byte("1234\n"), 0600); err != nil {
		t.Fatal(err)
	}
	regular, err := os.Open(ordinary)
	if err != nil {
		t.Fatal(err)
	}
	defer regular.Close()
	if ids, err := readRetainedCgroupThreads(regular); err == nil || ids != nil {
		t.Fatal("valid-looking ordinary text became kernel membership")
	}
}

func FuzzRetainedThreadIDs(f *testing.F) {
	for _, input := range [][]byte{nil, []byte("19\n2\n"), []byte("0\n"), []byte("1\n1\n"), []byte("2147483647\n")} {
		f.Add(input)
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		ids, err := decodeRetainedThreadIDs(data)
		if err != nil {
			if ids != nil {
				t.Fatal("failed decode returned apparent membership")
			}
			return
		}
		if len(ids) > retainedThreadLimit || !slices.IsSorted(ids) {
			t.Fatal("unbounded/unsorted membership")
		}
		for n, id := range ids {
			if id <= 0 || int64(id) > 2147483647 || (n > 0 && ids[n-1] == id) {
				t.Fatal("invalid/duplicate thread ID")
			}
		}
	})
}

func TestRetainedKernelThreadInventoryIncludesOwnedDeadLeaderWorker(t *testing.T) {
	if os.Getenv("EXAM_COLLECTION_USER_SYSTEMD") != "1" || os.Getenv("EXAM_COMPILER_WORKLOADS") != "1" {
		t.Skip("requires opt-in known compiler and disposable user-manager scope")
	}
	if os.Getuid() < 1000 || os.Getuid() != os.Geteuid() {
		t.Skip("local owned workload must be unprivileged")
	}
	dir := t.TempDir()
	binary := filepath.Join(dir, "owned-thread-fixture")
	compile := exec.Command("gcc", "-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-pthread", "-o", binary, filepath.Join("..", "..", "tests", "thread_leader_fixture.c"))
	if output, err := compile.CombinedOutput(); err != nil {
		t.Fatal("compile exact owned fixture", err, string(output))
	}
	unit := "ssh-exam-retained-thread-test-" + Token()[:12] + ".scope"
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, "/usr/bin/systemd-run", "--user", "--scope", "--quiet", "--unit="+unit, "--property=Delegate=no", "--property=MemoryMax=64M", "--property=MemorySwapMax=0", "--property=TasksMax=16", "--property=RuntimeMaxSec=10s", "--", binary, filepath.Join(dir, "writes"))
	stdout, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	var diagnostics bytes.Buffer
	command.Stderr = &diagnostics
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = command.Process.Kill() // Exact owned process/group, never the UID.
		_ = command.Wait()
		cleanup, done := context.WithTimeout(context.Background(), 5*time.Second)
		defer done()
		_ = exec.CommandContext(cleanup, "/usr/bin/systemctl", "--user", "stop", unit).Run()
		_ = exec.CommandContext(cleanup, "/usr/bin/systemctl", "--user", "reset-failed", unit).Run()
	})
	_ = stdout.(*os.File).SetReadDeadline(time.Now().Add(3 * time.Second))
	line, err := bufio.NewReaderSize(stdout, 1024).ReadString('\n')
	var pid, tid int
	if err != nil || len(line) > 1024 {
		t.Fatal("owned thread report unavailable", err, diagnostics.String())
	}
	if _, err := fmt.Sscanf(line, "%d %d", &pid, &tid); err != nil || pid != command.Process.Pid || tid == pid || tid < 2 {
		t.Fatal("owned thread identity mismatch", err, line)
	}
	group, err := exec.CommandContext(ctx, "/usr/bin/systemctl", "--user", "show", unit, "--property=ControlGroup", "--value").Output()
	path := strings.TrimSpace(string(group))
	if err != nil || !filepath.IsAbs(path) || filepath.Clean(path) != path || filepath.Base(path) != unit {
		t.Fatal("owned scope path unverified", err)
	}
	scope, err := os.Open("/sys/fs/cgroup" + path)
	if err != nil {
		t.Fatal(err)
	}
	defer scope.Close()
	until := time.Now().Add(time.Second)
	for {
		status, err := os.ReadFile(fmt.Sprintf("/proc/%d/status", pid))
		if err == nil && strings.Contains(string(status), "State:\tZ") {
			break
		}
		if time.Now().After(until) {
			t.Fatal("owned leader did not exit", err)
		}
		time.Sleep(time.Millisecond)
	}
	ids, err := readRetainedCgroupThreads(scope)
	if err != nil || !slices.Contains(ids, tid) || slices.Contains(ids, os.Getpid()) {
		t.Fatal("kernel inventory lost surviving worker or includes parent", ids, err)
	}
	t.Log("pinned real cgroup.threads includes surviving worker after main-thread exit; this is inventory, not freeze proof")
}
