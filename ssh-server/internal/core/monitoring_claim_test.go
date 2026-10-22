package core

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

const monitoringClaimTestID = "12345678-1234-1234-1234-123456789abc"

func monitoringClaimState(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestMonitoringClaimExclusiveIndependentAndPersistent(t *testing.T) {
	state := monitoringClaimState(t)
	c, err := claimMonitoringOwner(state, monitoringClaimTestID)
	if err != nil || !c.current() {
		t.Fatal(c, err)
	}
	t.Cleanup(c.close)
	path := filepath.Join(state, "monitoring-control", monitoringClaimTestID+".lock")
	before, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if other, err := claimMonitoringOwner(state, monitoringClaimTestID); other != nil || err != errMonitoringClaimBusy {
		t.Fatal("same process acquired a duplicate actor claim", other, err)
	}
	other, err := claimMonitoringOwner(state, "22345678-1234-1234-1234-123456789abc")
	if err != nil || !other.current() {
		t.Fatal("another attempt blocked", err)
	}
	other.close()
	c.close()
	c.close()
	if c.current() {
		t.Fatal("closed ownership remained current")
	}
	if handle, err := c.publisherHandle(); handle != nil || err != errMonitoringClaim {
		t.Fatal("closed claim duplicated", err)
	}
	replacement, err := claimMonitoringOwner(state, monitoringClaimTestID)
	if err != nil {
		t.Fatal(err)
	}
	defer replacement.close()
	after, err := os.Stat(path)
	if err != nil || !os.SameFile(before, after) || after.Size() != 0 || !before.ModTime().Equal(after.ModTime()) {
		t.Fatal("lock inode was replaced/truncated/written", err)
	}
}

func TestMonitoringClaimRefusesUnsafeTargetsWithoutRepairOrFollowing(t *testing.T) {
	for _, mode := range []string{"missing-state", "state-symlink", "public-state", "public-dir", "dir-symlink", "file-symlink", "fifo", "directory", "hardlink", "public-file", "setuid-file", "nonempty"} {
		t.Run(mode, func(t *testing.T) {
			state := monitoringClaimState(t)
			outside := monitoringClaimState(t)
			dir := filepath.Join(state, "monitoring-control")
			must := func(err error) {
				t.Helper()
				if err != nil {
					t.Fatal(err)
				}
			}
			must(os.Mkdir(dir, 0700))
			lock := filepath.Join(dir, monitoringClaimTestID+".lock")
			sentinel := filepath.Join(outside, "private")
			must(os.WriteFile(sentinel, []byte("PRIVATE-UNRELATED"), 0600))
			switch mode {
			case "missing-state":
				state = filepath.Join(state, "missing")
			case "state-symlink":
				alias := filepath.Join(outside, "state-link")
				must(os.Symlink(state, alias))
				state = alias
			case "public-state":
				must(os.Chmod(state, 0755))
			case "public-dir":
				must(os.Chmod(dir, 0755))
			case "dir-symlink":
				must(os.Remove(dir))
				must(os.Symlink(outside, dir))
			case "file-symlink":
				must(os.Symlink(sentinel, lock))
			case "fifo":
				must(syscall.Mkfifo(lock, 0600))
			case "directory":
				must(os.Mkdir(lock, 0700))
			case "hardlink":
				must(os.WriteFile(lock, nil, 0600))
				must(os.Link(lock, filepath.Join(outside, "alias")))
			case "public-file", "setuid-file", "nonempty":
				must(os.WriteFile(lock, nil, 0600))
				if mode == "public-file" {
					must(os.Chmod(lock, 0644))
				}
				if mode == "setuid-file" {
					must(os.Chmod(lock, 0600|os.ModeSetuid))
				}
				if mode == "nonempty" {
					must(os.WriteFile(lock, []byte("PRIVATE-CORRUPTION"), 0600))
				}
			}
			if c, err := claimMonitoringOwner(state, monitoringClaimTestID); c != nil || err != errMonitoringClaim {
				if c != nil {
					c.close()
				}
				t.Fatal("unsafe target accepted or private contents leaked", err)
			}
			b, err := os.ReadFile(sentinel)
			if err != nil || string(b) != "PRIVATE-UNRELATED" {
				t.Fatal("followed/changed unrelated file", err)
			}
			if mode == "missing-state" {
				if _, err := os.Lstat(state); !os.IsNotExist(err) {
					t.Fatal("initialized missing state", err)
				}
			}
			if mode == "public-state" {
				info, _ := os.Stat(state)
				if info.Mode().Perm() != 0755 {
					t.Fatal("repaired state permissions")
				}
			}
			if mode == "public-dir" {
				info, _ := os.Stat(dir)
				if info.Mode().Perm() != 0755 {
					t.Fatal("repaired directory permissions")
				}
			}
		})
	}
	for _, id := range []string{"", "../escape", strings.Repeat("f", 64), "12345678-1234-1234-1234-123456789ABC"} {
		state := monitoringClaimState(t)
		if c, err := claimMonitoringOwner(state, id); c != nil || err != errMonitoringClaim {
			t.Fatal("invalid attempt accepted", err)
		}
		entries, _ := os.ReadDir(state)
		if len(entries) != 0 {
			t.Fatal("invalid selection created coordination data")
		}
	}
}

// Private test executable protocol only, never a production command/config flag.
func TestMonitoringClaimChild(t *testing.T) {
	if len(os.Args) < 3 || os.Args[len(os.Args)-2] != "--monitoring-claim-test" {
		return
	}
	mode := os.Args[len(os.Args)-1]
	if mode != "inherit" {
		os.Exit(41)
	}
	f := os.NewFile(3, "private-test-claim")
	if f == nil {
		os.Exit(42)
	}
	var st unix.Stat_t
	if unix.Fstat(3, &st) != nil || st.Mode&unix.S_IFMT != unix.S_IFREG || st.Size != 0 {
		os.Exit(43)
	}
	if _, err := fmt.Fprintln(os.Stdout, "ready"); err != nil {
		os.Exit(44)
	}
	_, _ = io.Copy(io.Discard, os.Stdin)
	f.Close()
	os.Exit(0)
}

func startMonitoringClaimChild(t *testing.T, claim *monitoringOwnerClaim) *exec.Cmd {
	t.Helper()
	handle, err := claim.publisherHandle()
	if err != nil {
		t.Fatal(err)
	}
	defer handle.Close()
	flags, err := unix.FcntlInt(handle.Fd(), unix.F_GETFD, 0)
	if err != nil || flags&unix.FD_CLOEXEC == 0 {
		t.Fatal("duplicate leaks to unrelated exec", err)
	}
	cmd := exec.Command(os.Args[0], "-test.run=^TestMonitoringClaimChild$", "--", "--monitoring-claim-test", "inherit")
	cmd.ExtraFiles = []*os.File{handle}
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
			t.Fatal("private claim child failed")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("private claim child did not become ready")
	}
	return cmd
}

func TestMonitoringClaimSurvivingPublisherExcludesReplacementAfterActorDeath(t *testing.T) {
	state := monitoringClaimState(t)
	c, err := claimMonitoringOwner(state, monitoringClaimTestID)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(c.close)
	actor := startMonitoringClaimChild(t, c)
	publisher := startMonitoringClaimChild(t, c)
	c.close() // Neither parent duplicate remains; only actual children own the fd.
	if err := actor.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	if err := actor.Wait(); err == nil {
		t.Fatal("actor was not killed")
	}
	started := time.Now()
	if next, err := claimMonitoringOwner(state, monitoringClaimTestID); next != nil || err != errMonitoringClaimBusy {
		if next != nil {
			next.close()
		}
		t.Fatal("surviving publisher lost ownership exclusion", err)
	}
	if time.Since(started) > time.Second {
		t.Fatal("claim waited on a surviving child")
	}
	if err := publisher.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	if err := publisher.Wait(); err == nil {
		t.Fatal("publisher was not killed")
	}
	next, err := claimMonitoringOwner(state, monitoringClaimTestID)
	if err != nil || !next.current() || c.current() {
		t.Fatal("fresh actor unavailable or old claim revived", err)
	}
	next.close()
}

func TestMonitoringClaimPublisherDuplicateRetainsLockWithoutExplicitUnlock(t *testing.T) {
	state := monitoringClaimState(t)
	c, err := claimMonitoringOwner(state, monitoringClaimTestID)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(c.close)
	handle, err := c.publisherHandle()
	if err != nil {
		t.Fatal(err)
	}
	defer handle.Close()
	c.close()
	if next, err := claimMonitoringOwner(state, monitoringClaimTestID); next != nil || !errors.Is(err, errMonitoringClaimBusy) {
		if next != nil {
			next.close()
		}
		t.Fatal("closing actor explicitly unlocked an inherited description", err)
	}
	handle.Close()
	next, err := claimMonitoringOwner(state, monitoringClaimTestID)
	if err != nil {
		t.Fatal(err)
	}
	next.close()
}
