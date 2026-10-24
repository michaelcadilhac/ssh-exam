package core

import (
	"context"
	"crypto/ed25519"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

// Called from the actual Engine.local/supervisor fixture after student exec.
// Real owned user-systemd scopes, PTYs, SCM_RIGHTS and pinned process identities;
// SSH ancestry/root scope paths are test seams, not privileged qualification.
func testFramedSupervisorReplacement(t *testing.T, e *Engine, key ed25519.PrivateKey, cmd Command, connection *net.UnixConn, master *os.File, ready map[string]any, epoch string, address *net.UnixAddr, cliBinary string) {
	t.Helper()
	if !monitoringDigest.MatchString(epoch) || ready["input_protocol"] != "v1" || ready["input_epoch"] != epoch {
		t.Fatal("actual native gate lost the explicit input context")
	}
	if cliBinary != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
		defer cancel()
		data, err := exec.CommandContext(ctx, "/usr/bin/unshare", "--user", "--map-root-user", cliBinary, "panes", "show", cmd.Body.ID, cmd.Body.Pane, "--state", e.Config.State).CombinedOutput()
		var view NativePanesSnapshot
		if err != nil || json.Unmarshal(data, &view) != nil || !view.ReadOnly || !view.Complete || len(view.Panes) != 1 || len(view.Panes[0].InputEpochs) != 1 || view.Panes[0].InputEpochs[0] != epoch {
			t.Fatal("actual read-only CLI lost the captured framed pane epoch", string(data), err)
		}
		help, err := exec.CommandContext(ctx, cliBinary, "help", "panes").CombinedOutput()
		if err != nil || !strings.Contains(string(help), "input_epochs") || !strings.Contains(string(help), "NOT live input") {
			t.Fatal("framed pane metadata is not discoverable or confuses authority", string(help), err)
		}
	}
	write := func(fd int, captured, pane string, seq uint64, kind byte, data []byte) {
		t.Helper()
		wire := make([]byte, framedInputHeaderBytes+len(data))
		copy(wire, "EXIN")
		wire[4], wire[5] = 1, kind
		epochBytes, err := hex.DecodeString(captured)
		if err != nil || len(epochBytes) != 32 {
			t.Fatal("invalid synthetic epoch")
		}
		paneBytes, err := hex.DecodeString(strings.ReplaceAll(pane, "-", ""))
		if err != nil || len(paneBytes) != 16 {
			t.Fatal("invalid synthetic pane")
		}
		copy(wire[8:40], epochBytes)
		copy(wire[40:56], paneBytes)
		binary.BigEndian.PutUint64(wire[56:64], seq)
		binary.BigEndian.PutUint32(wire[64:68], uint32(len(data)))
		copy(wire[68:], data)
		until := time.Now().Add(time.Second)
		for at := 0; at < len(wire); {
			n, err := unix.Write(fd, wire[at:])
			if n > 0 {
				at += n
			}
			if err != nil && err != unix.EAGAIN && err != unix.EINTR {
				t.Fatal("synthetic frame transport failed", err)
			}
			if time.Now().After(until) {
				t.Fatal("synthetic frame transport stalled")
			}
			if at < len(wire) {
				_ = recordingPoll(fd, unix.POLLOUT)
			}
		}
	}
	memory := func(fd int) string {
		t.Helper()
		out, err := supervisionReadUntil(fd, "BUFFER:synthetic-buffer-not-on-disk:", time.Second)
		if err != nil {
			t.Fatal("valid framed input did not reach the actual shell", err)
		}
		for _, line := range strings.Split(out, "\n") {
			if strings.HasPrefix(line, "BUFFER:") {
				return strings.TrimSpace(line)
			}
		}
		t.Fatal("shell memory response missing")
		return ""
	}
	fd, pane := int(master.Fd()), cmd.Body.Pane
	observedSSH, err := ObserveTerminalSupervisor(e.Config.State, cmd.Body.ID)
	if err != nil || observedSSH.SSHPeer != "pinned-live" {
		t.Fatal("actual framed handoff did not bind the original socket peer's live kernel process", observedSSH, err)
	}
	write(fd, epoch, pane, 1, 0, []byte("check\n"))
	before := memory(fd)
	parts := strings.Split(before, ":")
	pid, err := strconv.Atoi(parts[len(parts)-1])
	if err != nil {
		t.Fatal("invalid actual shell identity")
	}
	process, err := pinUIDProcess(pid, os.Getuid())
	if err != nil || process == nil {
		t.Fatal("actual synthetic shell lifetime unavailable", err)
	}
	defer process.close()
	terminalFD, err := unix.Openat(int(process.proc.Fd()), "fd/0", unix.O_RDONLY|unix.O_NOCTTY|unix.O_CLOEXEC, 0)
	if err != nil {
		t.Fatal("actual pinned shell PTY unavailable", err)
	}
	terminal := os.NewFile(uintptr(terminalFD), "synthetic-inner-pty-observation")
	defer terminal.Close()
	resize := make([]byte, 8)
	binary.BigEndian.PutUint32(resize, 38)
	binary.BigEndian.PutUint32(resize[4:], 113)
	write(fd, epoch, pane, 2, 1, resize)
	for until := time.Now().Add(time.Second); ; {
		var size windowSize
		live, lifetimeErr := process.live()
		if lifetimeErr != nil || !live {
			t.Fatal("framed resize ended the actual shell", lifetimeErr)
		}
		if ioctl(uintptr(terminalFD), syscall.TIOCGWINSZ, unsafePointer(&size)) == nil && size.Row == 38 && size.Col == 113 {
			break
		}
		if time.Now().After(until) {
			t.Fatal("scoped resize did not reach the actual inner PTY")
		}
		time.Sleep(5 * time.Millisecond)
	}
	// Observing the real slave must not keep it open through shell completion.
	// File.Close is idempotent; no deferred numeric FD may close a later reuse.
	if err := terminal.Close(); err != nil {
		t.Fatal(err)
	}
	// Each bad frame would exit the shell if admitted; a later positive memory
	// response proves refusal. No missing output or runner timeout is the oracle.
	write(fd, Token(), pane, 100, 0, []byte("finish\n"))
	write(fd, epoch, ManagementID(), 100, 0, []byte("finish\n"))
	write(fd, epoch, pane, 1, 0, []byte("finish\n"))
	write(fd, epoch, pane, 3, 0, []byte("check\n"))
	if after := memory(fd); after != before {
		t.Fatal("rejected input replaced or ended shell memory")
	}
	write(fd, epoch, pane, 4, 0, []byte("finish\n"))
	var ended map[string]any
	if err := json.NewDecoder(connection).Decode(&ended); err != nil || ended["ended"] != true {
		t.Fatal("first framed pane did not complete through the actual gate", err)
	}
	for until := time.Now().Add(2 * time.Second); ; {
		_ = e.reconcileTerminalRecordingReports()
		state, err := readStateSnapshot(e.Config.State)
		if err == nil && len(state.Attempts[cmd.Body.ID].Units) == 0 {
			break
		}
		if time.Now().After(until) {
			t.Fatal("first incarnation never positively retired", err)
		}
		time.Sleep(5 * time.Millisecond)
	}
	cmd.Nonce, cmd.Expires = Token(), Millis()+20000
	result, err := e.Command(signedCommand(key, cmd), cmd.Username, cmd.Transport)
	if err != nil {
		t.Fatal("same UI pane could not obtain a fresh native incarnation", err)
	}
	issued := result.(map[string]string)
	next := issued["input_epoch"]
	if next == epoch || !monitoringDigest.MatchString(next) {
		t.Fatal("same-pane replacement reused a packet epoch")
	}
	second, err := net.DialUnix("unix", nil, address)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	_ = second.SetDeadline(time.Now().Add(8 * time.Second))
	m2, s2, err := openPTYMasterFlags(unix.O_NONBLOCK)
	if err != nil {
		t.Fatal(err)
	}
	defer m2.Close()
	defer s2.Close()
	if _, err := rawTerminal(s2.Fd()); err != nil {
		t.Fatal("replacement fixture did not reproduce the raw exam-login PTY", err)
	}
	request, _ := json.Marshal(LocalRequest{Token: issued["token"], InputProtocol: "v1"})
	if _, _, err := second.WriteMsgUnix(request, syscall.UnixRights(int(s2.Fd())), nil); err != nil {
		t.Fatal(err)
	}
	var reply map[string]any
	if err := json.NewDecoder(second).Decode(&reply); err != nil || reply["error"] != nil || reply["input_epoch"] != next {
		t.Fatal("replacement admission lost its native epoch", err, fmt.Sprint(reply["error"]))
	}
	if _, err := second.Write([]byte{1}); err != nil {
		t.Fatal(err)
	}
	s2.Close()
	fd2 := int(m2.Fd())
	if unix.SetNonblock(fd2, true) != nil {
		t.Fatal("replacement outer PTY is not nonblocking")
	}
	if _, err := supervisionReadUntil(fd2, "SYNTHETIC-CLOSED-PANE-EXEC", 4*time.Second); err != nil {
		t.Fatal("replacement did not execute", err)
	}
	write(fd2, epoch, pane, 1000, 0, []byte("finish\n"))
	write(fd2, next, pane, 1, 0, []byte("check\n"))
	if after := memory(fd2); after == before {
		t.Fatal("fixture did not create a different actual shell")
	}
	write(fd2, next, pane, 2, 0, []byte("finish\n"))
	if err := json.NewDecoder(second).Decode(&ended); err != nil || ended["ended"] != true {
		t.Fatal("replacement framed completion missing", err)
	}
}
