package core

import (
	"os"
	"testing"
)

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
