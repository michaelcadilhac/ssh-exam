package core

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

func retainedTaskText() ([]byte, []byte) {
	status := []byte("Name:\tPRIVATE-test\nState:\tS (sleeping)\nTgid:\t1234\nPid:\t1235\nUid:\t1000\t1000\t1000\t1000\n")
	fields := make([]string, 20)
	for n := range fields {
		fields[n] = "0"
	}
	fields[0], fields[19] = "S", "9876"
	return status, []byte("1235 (PRIVATE ) task name) " + strings.Join(fields, " ") + "\n")
}

func TestRetainedTaskExitIsUnknownWhileItsOriginalGroupRemainsAlive(t *testing.T) {
	group, err := pinUIDProcess(os.Getpid(), os.Getuid())
	if err != nil || group == nil {
		t.Fatal("pin this synthetic test group", err)
	}
	defer group.close()
	identity := make(chan int, 1)
	release := make(chan struct{})
	defer close(release)
	var tid int
	for tid == 0 {
		go func() {
			runtime.LockOSThread()
			id := unix.Gettid()
			if id == os.Getpid() {
				// Never terminate this test process's main kernel thread. Keep
				// it occupied while a different owned thread does the fixture.
				identity <- 0
				<-release
				runtime.UnlockOSThread()
				return
			}
			identity <- id
			// Exiting a locked goroutine terminates only its own kernel thread.
			// No signal, UID-wide operation or host process is affected.
			runtime.Goexit()
		}()
		tid = <-identity
	}
	until := time.Now().Add(2 * time.Second)
	for {
		_, err := os.Stat("/proc/" + strconv.Itoa(tid))
		if os.IsNotExist(err) {
			break
		}
		if err != nil || time.Now().After(until) {
			t.Fatal("owned locked thread did not exit", err)
		}
		time.Sleep(time.Millisecond)
	}
	if observation, err := observeRetainedTask(group, tid, os.Getuid()); err == nil || observation != (retainedTaskObservation{}) {
		t.Fatal("missing thread became a stopped/empty identity")
	}
	if live, err := group.live(); err != nil || !live {
		t.Fatal("individual thread exit was confused with group death", live, err)
	}
}

func TestRetainedTaskStatusAndStartAreStrictBoundedIdentityNotNames(t *testing.T) {
	status, stat := retainedTaskText()
	id, states, err := retainedTaskSnapshot(status, stat)
	if err != nil || id.TID != 1235 || id.TGID != 1234 || id.Start != 9876 || id.UIDs != [4]uint32{1000, 1000, 1000, 1000} || states != [2]byte{'S', 'S'} {
		t.Fatal("valid kernel task identity rejected", id, states, err)
	}
	for _, replacement := range []struct{ from, to string }{
		{"Pid:\t1235", "Pid:\t0"}, {"Pid:\t1235", "Pid:\t+1235"}, {"Pid:\t1235", "Pid:\t01235"},
		{"Pid:\t1235", "Pid:\t2147483648"}, {"Pid:\t1235", "Pid:\t1235\nPid:\t1235"},
		{"Tgid:\t1234", "Tgid:\t-1"}, {"Tgid:\t1234", "Missing:\t1234"},
		{"Uid:\t1000\t1000\t1000\t1000", "Uid:\t1000\t1000\t1000"},
		{"Uid:\t1000\t1000\t1000\t1000", "Uid:\t1000\t1000\t1000\t4294967295"},
		{"Uid:\t1000\t1000\t1000\t1000", "Uid:\t1000\t1000\t1000\t-1"},
		{"State:\tS", "State:\t?"}, {"State:\tS", "State:\tSS"},
	} {
		bad := []byte(strings.Replace(string(status), replacement.from, replacement.to, 1))
		if _, _, err := retainedTaskSnapshot(bad, stat); err != errRetainedThreadInventory || strings.Contains(err.Error(), "PRIVATE") {
			t.Fatal("invalid task status accepted/leaked", replacement.from)
		}
	}
	for _, bad := range [][]byte{nil, []byte("1235 (PRIVATE) S"), []byte(strings.Replace(string(stat), "1235 (", "1236 (", 1)), []byte(strings.Replace(string(stat), "9876", "0", 1)), []byte(strings.Replace(string(stat), "9876", "18446744073709551616", 1)), []byte(strings.Repeat("x", 4097))} {
		if _, _, err := retainedTaskSnapshot(status, bad); err != errRetainedThreadInventory {
			t.Fatal("invalid/mismatched task stat accepted")
		}
	}
	if _, _, err := retainedTaskSnapshot([]byte(strings.Repeat("x", 16385)), stat); err != errRetainedThreadInventory {
		t.Fatal("oversized task status accepted")
	}
	// A zombie leader or traced task is an observed state, never omitted and
	// never conflated with a job-control stop which the barrier may later undo.
	for _, state := range []string{"Z", "t", "T", "D"} {
		id, states, err := retainedTaskSnapshot([]byte(strings.Replace(string(status), "State:\tS", "State:\t"+state, 1)), []byte(strings.Replace(string(stat), ") S ", ") "+state+" ", 1)))
		if err != nil || id.Start != 9876 || states != [2]byte{state[0], state[0]} {
			t.Fatal("kernel state lost or misclassified", state, err)
		}
	}
}

func TestRetainedTaskRefusesInvalidGroupAndOrdinaryProcSubstitutes(t *testing.T) {
	for _, tid := range []int{-1, 0, 2147483648} {
		if observation, err := observeRetainedTask(nil, tid, os.Getuid()); err == nil || observation != (retainedTaskObservation{}) {
			t.Fatal("invalid group/task established apparent identity")
		}
	}
	dir := t.TempDir()
	status, stat := retainedTaskText()
	for name, data := range map[string][]byte{"status": status, "stat": stat} {
		if err := os.WriteFile(filepath.Join(dir, name), data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	f, err := os.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	for _, name := range []string{"status", "stat", "../status", "cmdline", "environ"} {
		if data, err := retainedProcRead(f, name, 16384); err == nil || data != nil {
			t.Fatal("ordinary text/nonwhitelisted leaf became kernel observation", name)
		}
	}
	f.Close()
	if data, err := retainedProcRead(f, "status", 16384); err == nil || data != nil {
		t.Fatal("closed proc view became an observation")
	}
}

func FuzzRetainedTaskSnapshot(f *testing.F) {
	status, stat := retainedTaskText()
	f.Add(status, stat)
	f.Add([]byte{}, []byte{})
	f.Fuzz(func(t *testing.T, status, stat []byte) {
		id, states, err := retainedTaskSnapshot(status, stat)
		if err != nil {
			return
		}
		if id.TID <= 0 || id.TGID <= 0 || id.Start == 0 {
			t.Fatal("invalid accepted task identity", fmt.Sprint(id))
		}
		for _, state := range states {
			if !strings.ContainsRune("RSDZTtXxKWPI", rune(state)) {
				t.Fatal("unknown accepted task state", strconv.Itoa(int(state)))
			}
		}
	})
}
