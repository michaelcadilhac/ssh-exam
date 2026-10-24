package core

import (
	"os"
	"os/exec"
	"testing"
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
