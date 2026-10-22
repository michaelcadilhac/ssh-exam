package core

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

func TestRetainedScopeTreeRefusesUnsafeRootsAndExpandedBudgets(t *testing.T) {
	root, err := os.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	for _, scope := range []*os.File{nil, root} {
		if tree, err := observeRetainedScopeTree(scope); err == nil || tree != nil {
			t.Fatal("ordinary/absent root became hierarchy coverage")
		}
	}
	for _, budget := range []retainedScopeBudget{{0, 1, 1}, {129, 1, 1}, {1, -1, 1}, {1, 33, 1}, {1, 1, 0}, {1, 1, 4097}} {
		if tree, err := observeRetainedScopeTreeBounded(root, budget, nil); err == nil || tree != nil {
			t.Fatal("invalid/enlarged bounds accepted", budget)
		}
	}
	root.Close()
	if tree, err := observeRetainedScopeTree(root); err == nil || tree != nil {
		t.Fatal("closed root became empty hierarchy")
	}
}

func TestRetainedScopeTreeChild(t *testing.T) {
	if os.Getenv("EXAM_RETAINED_SCOPE_TREE_CHILD") != "1" {
		t.Skip("owned private user-scope child only")
	}
	if os.Getuid() < 1000 || os.Getuid() != os.Geteuid() {
		t.Fatal("owned hierarchy fixture must remain unprivileged")
	}
	fmt.Println(os.Getpid())
	time.Sleep(10 * time.Second) // Self-expiring even if the parent test disappears.
}

func TestRetainedScopeTreeObservesOwnedDescendantsAndRefusesChangingCoverage(t *testing.T) {
	if os.Getenv("EXAM_COLLECTION_USER_SYSTEMD") != "1" {
		t.Skip("requires explicit disposable user-manager cgroup hierarchy qualification")
	}
	if os.Getuid() < 1000 || os.Getuid() != os.Geteuid() {
		t.Skip("synthetic hierarchy must be owned by an unprivileged developer")
	}
	unit := "ssh-exam-retained-tree-test-" + Token()[:12] + ".scope"
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
		cleanup, done := context.WithTimeout(context.Background(), 5*time.Second)
		defer done()
		_ = exec.CommandContext(cleanup, "/usr/bin/systemctl", "--user", "stop", unit).Run()
		_ = exec.CommandContext(cleanup, "/usr/bin/systemctl", "--user", "reset-failed", unit).Run()
	})
	_ = stdout.(*os.File).SetReadDeadline(time.Now().Add(4 * time.Second))
	line, err := bufio.NewReaderSize(stdout, 1024).ReadString('\n')
	pid, parseErr := strconv.Atoi(strings.TrimSpace(line))
	if err != nil || parseErr != nil || pid != command.Process.Pid {
		t.Fatal("owned hierarchy helper identity unverified", err, parseErr)
	}
	group, err := exec.CommandContext(ctx, "/usr/bin/systemctl", "--user", "show", unit, "--property=ControlGroup", "--value").Output()
	path := strings.TrimSpace(string(group))
	if err != nil || !filepath.IsAbs(path) || filepath.Clean(path) != path || filepath.Base(path) != unit {
		t.Fatal("owned hierarchy path unavailable", err)
	}
	root, err := os.Open("/sys/fs/cgroup" + path)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	for leaf, want := range map[string]string{"memory.max": "67108864", "memory.swap.max": "0", "pids.max": "16"} {
		data, err := os.ReadFile("/sys/fs/cgroup" + path + "/" + leaf)
		if err != nil || strings.TrimSpace(string(data)) != want {
			t.Fatal("owned hierarchy resource bound unavailable", leaf, err)
		}
	}
	initial, err := readRetainedCgroupThreads(root)
	if err != nil || !slices.Contains(initial, pid) || slices.Contains(initial, os.Getpid()) {
		t.Fatal("root scope does not exclusively contain the owned child", initial, err)
	}
	makeChild := func(parent *os.File, leaf string) *os.File {
		t.Helper()
		raw, err := parent.SyscallConn()
		if err != nil {
			t.Fatal(err)
		}
		var inner error
		if err := raw.Control(func(fd uintptr) { inner = unix.Mkdirat(int(fd), leaf, 0700) }); err != nil || inner != nil {
			t.Fatal("make exact owned test-only delegated child", err, inner)
		}
		child, err := openRetainedScopeAt(parent, leaf)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = child.Close() })
		return child
	}
	nested := makeChild(root, "nested-owned")
	deep := makeChild(nested, "deeper-owned")
	raw, err := deep.SyscallConn()
	if err != nil {
		t.Fatal(err)
	}
	fd := -1
	var inner error
	if err := raw.Control(func(parent uintptr) {
		fd, inner = unix.Openat(int(parent), "cgroup.procs", unix.O_WRONLY|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0)
	}); err != nil || inner != nil {
		t.Fatal("open exact owned migration control", err, inner)
	}
	move := os.NewFile(uintptr(fd), "owned-hierarchy-migration-only")
	_, writeErr := move.WriteString(strconv.Itoa(pid)) // Only this new owned child's group.
	closeErr := move.Close()
	if writeErr != nil || closeErr != nil {
		t.Fatal("move exact owned fixture group into its own descendant", writeErr, closeErr)
	}
	var tree []retainedScopeObservation
	until := time.Now().Add(time.Second)
	for {
		tree, err = observeRetainedScopeTree(root)
		if err == nil {
			break
		}
		if time.Now().After(until) {
			t.Fatal("owned hierarchy never produced a stable observation", err)
		}
		time.Sleep(time.Millisecond)
	}
	found := false
	for _, node := range tree {
		if slices.Contains(node.Threads, os.Getpid()) {
			t.Fatal("parent test unexpectedly in owned hierarchy")
		}
		if node.Relative == "nested-owned/deeper-owned" && slices.Contains(node.Threads, pid) {
			found = true
		}
		if node.Relative == "." && slices.Contains(node.Threads, pid) {
			t.Fatal("test migration was not completed")
		}
	}
	if !found {
		t.Fatal("top-level empty membership hid the owned descendant writer", tree)
	}
	// Test-only user delegation is confined to this new owned scope. Production
	// remains Delegate=no; freezing does NOT make the hierarchy immutable.
	freeze := exec.CommandContext(ctx, "/usr/bin/systemctl", "--user", "freeze", unit)
	if err := freeze.Run(); err != nil {
		t.Fatal("freeze exact owned hierarchy", err)
	}
	t.Cleanup(func() {
		thaw, done := context.WithTimeout(context.Background(), 3*time.Second)
		defer done()
		_ = exec.CommandContext(thaw, "/usr/bin/systemctl", "--user", "thaw", unit).Run()
	})
	events, err := os.ReadFile("/sys/fs/cgroup" + path + "/cgroup.events")
	if err != nil || !strings.Contains(string(events), "frozen 1\n") {
		t.Fatal("owned kernel hierarchy freeze was not confirmed", err)
	}
	for _, budget := range []retainedScopeBudget{{2, 32, 4096}, {128, 1, 4096}, {128, 32, 1}} {
		if partial, err := observeRetainedScopeTreeBounded(root, budget, nil); err == nil || partial != nil {
			t.Fatal("exhausted hierarchy budget returned plausible partial coverage", budget)
		}
	}
	changed := false
	partial, err := observeRetainedScopeTreeCheckpoint(root, func(relative string) error {
		if relative == "." && !changed {
			makeChild(root, "appeared-during-observation")
			changed = true
		}
		return nil
	})
	if !changed || err == nil || partial != nil {
		t.Fatal("changing topology returned apparent stable coverage", changed, partial, err)
	}
	events, err = os.ReadFile("/sys/fs/cgroup" + path + "/cgroup.events")
	if err != nil || !strings.Contains(string(events), "frozen 1\n") {
		t.Fatal("topology-change control unexpectedly thawed the owned hierarchy", err)
	}
	t.Log("actual owned nested cgroups included; exhaustion and concurrent topology change refused without partial coverage; this is not a freeze proof")
}
