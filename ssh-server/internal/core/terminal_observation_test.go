package core

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

func observationCLIBinary(t *testing.T) string {
	t.Helper()
	binary := filepath.Join(t.TempDir(), "examctl")
	module, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("go", "build", "-o", binary, "./cmd/examctl")
	cmd.Dir = module
	cmd.Env = append(os.Environ(), "CGO_ENABLED=0")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatal("build actual static supervisor CLI", string(out), err)
	}
	return binary
}

// A private owner-UID endpoint exercises the actual bounded query/credential/
// descriptor decoder. It is NOT an installed root-role/cgroup qualification.
func observationReplyFixture(t *testing.T, mode string) (string, string, <-chan struct{}, os.FileInfo, *atomic.Bool) {
	t.Helper()
	state, id := t.TempDir(), ManagementID()
	if strings.Contains(mode, "private-extra") {
		state = filepath.Join(state, "private 'state'")
		if err := os.Mkdir(state, 0700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Chmod(state, 0700); err != nil {
		t.Fatal(err)
	}
	directory := filepath.Join(state, "terminal-supervisors")
	if err := os.Mkdir(directory, 0700); err != nil {
		t.Fatal(err)
	}
	dir, err := os.Open(directory)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { dir.Close() })
	listener, err := net.ListenUnix("unixpacket", &net.UnixAddr{Name: fmt.Sprintf("/proc/self/fd/%d/%s.sock", dir.Fd(), id), Net: "unixpacket"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { listener.Close() })
	if err := listener.SetDeadline(time.Now().Add(4 * time.Second)); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(filepath.Join(directory, id+".sock"), 0600); err != nil {
		t.Fatal(err)
	}
	marker, err := os.Create(filepath.Join(t.TempDir(), "owned-observation-right"))
	if err != nil {
		t.Fatal(err)
	}
	info, err := marker.Stat()
	if err != nil {
		marker.Close()
		t.Fatal(err)
	}
	finished := make(chan struct{})
	sent := new(atomic.Bool)
	go func() {
		defer close(finished)
		defer marker.Close()
		c, err := listener.AcceptUnix()
		if err != nil {
			return
		}
		defer c.Close()
		_ = c.SetDeadline(time.Now().Add(4 * time.Second))
		var hello [2]byte
		if n, err := c.Read(hello[:]); err != nil || n != 1 || hello[0] != 0 {
			return
		}
		count := 0
		if strings.Contains(mode, "extra-right") {
			count = 1
		}
		if strings.Contains(mode, "truncated-rights") {
			count = 32
		}
		rights := func() []byte {
			if count == 0 {
				return nil
			}
			fds := make([]int, count)
			for i := range fds {
				fds[i] = int(marker.Fd())
			}
			return unix.UnixRights(fds...)
		}
		if strings.HasPrefix(mode, "hello-") {
			_, _, err = c.WriteMsgUnix([]byte{1}, rights(), nil)
			sent.Store(err == nil)
			return
		}
		if _, err := c.Write([]byte{1}); err != nil {
			return
		}
		buf := make([]byte, terminalSupervisorBytes+1)
		if _, err := c.Read(buf); err != nil {
			return
		}
		if mode == "old-role" {
			sent.Store(true) // The actual query reached this deliberate old-role EOF.
			return
		}
		if mode == "held-reply" {
			sent.Store(true) // A live sender received the query; withhold only its reply.
			time.Sleep(3200 * time.Millisecond)
			return
		}
		v := map[string]any{"purpose": terminalObservationPurpose, "attempt": id, "supervisor": terminalSupervisorUnit(state, id), "pid": os.Getpid(), "boot": boot(), "at": Millis(), "attached_panes": 0, "attached_units": []string{}, "reported_started_units": []string{}, "observation_only": true}
		switch mode {
		case "wrong-attempt":
			v["attempt"] = ManagementID()
		case "wrong-scope":
			v["supervisor"] = terminalSupervisorUnit(state, ManagementID())
		case "wrong-pid":
			v["pid"] = os.Getpid() + 100000
		case "wrong-boot":
			v["boot"] = ManagementID()
		case "not-observation":
			v["observation_only"] = false
		case "private-extra":
			v["password"] = "PRIVATE-NOT-DIAGNOSTIC-DATA"
		case "bad-count":
			v["attached_panes"] = 1
		case "null-units":
			v["attached_units"] = nil
		case "unattached-notice":
			v["reported_started_units"] = []string{"exam-" + id + "-" + ManagementID() + "-" + ManagementID() + ".scope"}
		case "duplicate-units":
			unit := "exam-" + id + "-" + ManagementID() + "-" + ManagementID() + ".scope"
			v["attached_panes"], v["attached_units"] = 2, []string{unit, unit}
		}
		data, _ := json.Marshal(v)
		if mode == "duplicate-json" {
			data = append([]byte(`{"purpose":"wrong",`), data[1:]...)
		}
		if mode == "oversized" {
			data = bytes.Repeat([]byte{'x'}, terminalSupervisorBytes+10)
		}
		_, _, err = c.WriteMsgUnix(data, rights(), nil)
		sent.Store(err == nil)
	}()
	return state, id, finished, info, sent
}

func TestSupervisorObservationActualIPCRejectsMalformedScopeAndRights(t *testing.T) {
	for _, mode := range []string{"valid", "wrong-attempt", "wrong-scope", "wrong-pid", "wrong-boot", "not-observation", "private-extra", "bad-count", "null-units", "unattached-notice", "duplicate-units", "duplicate-json", "oversized", "hello-extra-right", "hello-truncated-rights", "reply-extra-right", "reply-truncated-rights", "old-role", "held-reply"} {
		t.Run(mode, func(t *testing.T) {
			state, id, finished, info, sent := observationReplyFixture(t, mode)
			started := time.Now()
			result, err := ObserveTerminalSupervisor(state, id)
			elapsed := time.Since(started)
			select {
			case <-finished:
			case <-time.After(5 * time.Second):
				t.Fatal("private observer fixture never completed", err)
			}
			if !sent.Load() {
				t.Fatal("refusal did not reach the intended private reply", err)
			}
			if mode == "held-reply" && (elapsed < 2500*time.Millisecond || elapsed > 5*time.Second) {
				t.Fatal("fixture missed the bounded live-sender reply timeout", elapsed, err)
			}
			if mode == "valid" {
				if err != nil || result.Attempt != id || !result.ObservationOnly {
					t.Fatal("valid owner metadata rejected", result, err)
				}
			} else if err == nil || result.Purpose != "" || result.Attempt != "" || strings.Contains(err.Error(), "PRIVATE-NOT-DIAGNOSTIC-DATA") {
				t.Fatal("untrusted/private reply escaped refusal", result, err)
			}
			leaked := ownedGateDescriptors(t, info)
			for _, fd := range leaked {
				unix.Close(fd)
			}
			if len(leaked) != 0 {
				t.Fatal("diagnostic reply leaked unexpected received rights", len(leaked))
			}
		})
	}
}

func TestSupervisorObservationMissingDirectoriesNeverInitialize(t *testing.T) {
	state := t.TempDir()
	if err := os.Chmod(state, 0700); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{ManagementID(), "../not-an-attempt"} {
		if _, err := ObserveTerminalSupervisor(state, id); err == nil {
			t.Fatal("missing/invalid observer unexpectedly succeeded")
		}
	}
	entries, err := os.ReadDir(state)
	if err != nil || len(entries) != 0 {
		t.Fatal("read-only observer initialized files", entries, err)
	}
}

func TestSupervisorObservationActualStaticRootCLIRefusesPrivateReply(t *testing.T) {
	if os.Getenv("EXAM_MANAGEMENT_USERNS") != "1" {
		t.Skip("explicit isolated root-namespace CLI only")
	}
	binary := observationCLIBinary(t)
	for _, mode := range []string{"private-extra", "wrong-attempt", "reply-extra-right", "old-role", "held-reply"} {
		t.Run(mode, func(t *testing.T) {
			state, id, finished, info, sent := observationReplyFixture(t, mode)
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			cmd := exec.CommandContext(ctx, "/usr/bin/unshare", "--user", "--map-root-user", binary, "panes", "supervisor", id, "--state", state)
			var out, diagnostics bytes.Buffer
			cmd.Stdout, cmd.Stderr = &out, &diagnostics
			err := cmd.Run()
			select {
			case <-finished:
			case <-time.After(5 * time.Second):
				t.Fatal("private CLI fixture never completed", err)
			}
			if !sent.Load() {
				t.Fatal("CLI refusal did not reach the intended private reply", err)
			}
			status, ok := err.(*exec.ExitError)
			if ctx.Err() != nil || !ok || status.ExitCode() != 1 || out.Len() != 0 || !strings.Contains(diagnostics.String(), "no process death") || strings.Contains(diagnostics.String(), "PRIVATE-NOT-DIAGNOSTIC-DATA") || !strings.Contains(diagnostics.String(), "panes list "+id+" --state '"+strings.ReplaceAll(state, "'", "'\\''")+"'") {
				t.Fatal("actual CLI printed/trusted invalid reply or lost guidance", out.String(), diagnostics.String(), err)
			}
			leaked := ownedGateDescriptors(t, info)
			for _, fd := range leaked {
				unix.Close(fd)
			}
			if len(leaked) != 0 {
				t.Fatal("actual CLI left private test rights open", len(leaked))
			}
		})
	}
}

func refuseSupervisorControlQueries(t *testing.T, state, id string, pid int) {
	t.Helper()
	dir, err := os.Open(filepath.Join(state, "terminal-supervisors"))
	if err != nil {
		t.Fatal(err)
	}
	defer dir.Close()
	marker, err := os.Create(filepath.Join(t.TempDir(), "forbidden-control-right"))
	if err != nil {
		t.Fatal(err)
	}
	defer marker.Close()
	info, err := marker.Stat()
	if err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"unknown", "wrong-attempt", "private", "one-right", "five-rights", "malformed"} {
		query := map[string]any{"purpose": terminalObservationPurpose, "attempt": id}
		count := 0
		switch mode {
		case "unknown":
			query["purpose"] = "issue-work-permission"
		case "wrong-attempt":
			query["attempt"] = ManagementID()
		case "private":
			query["exec"] = "NEVER-EXECUTE-THIS"
		case "one-right":
			count = 1
		case "five-rights":
			count = 5
		}
		data, _ := json.Marshal(query)
		if mode == "malformed" {
			data = []byte(`{"purpose":`)
		}
		c, err := net.DialUnix("unixpacket", nil, &net.UnixAddr{Name: fmt.Sprintf("/proc/self/fd/%d/%s.sock", dir.Fd(), id), Net: "unixpacket"})
		if err != nil {
			t.Fatal(err)
		}
		_ = c.SetDeadline(time.Now().Add(3 * time.Second))
		if _, err := c.Write([]byte{0}); err != nil {
			c.Close()
			t.Fatal(err)
		}
		var hello [2]byte
		if n, err := c.Read(hello[:]); err != nil || n != 1 || hello[0] != 1 {
			c.Close()
			t.Fatal("actual supervisor did not reach refusal setup", mode, err)
		}
		var control []byte
		if count > 0 {
			fds := make([]int, count)
			for i := range fds {
				fds[i] = int(marker.Fd())
			}
			control = unix.UnixRights(fds...)
		}
		if _, _, err := c.WriteMsgUnix(data, control, nil); err != nil {
			c.Close()
			t.Fatal(err)
		}
		n, err := c.Read(hello[:])
		c.Close()
		if n != 0 || !errors.Is(err, io.EOF) {
			t.Fatal("actual supervisor did not refuse control-shaped observation", mode, n, err)
		}
		entries, err := os.ReadDir(fmt.Sprintf("/proc/%d/fd", pid))
		if err != nil {
			t.Fatal(err)
		}
		for _, entry := range entries {
			got, err := os.Stat(fmt.Sprintf("/proc/%d/fd/%s", pid, entry.Name()))
			if err == nil && os.SameFile(info, got) {
				t.Fatal("actual supervisor leaked an inspection descriptor", mode)
			}
		}
	}
}
