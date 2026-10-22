package core

// Opt-in qualification only, executed by overlay_guest.py inside the pinned,
// disposable systemd guest. No production command or ACTIVE factory calls this.

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestMonitoringSSHProcessGuestRefusesUnqualifiedHost(t *testing.T) {
	if _, err := os.Stat("/run/ssh-exam-qualification-input/run.json"); err == nil {
		t.Skip("negative host probe is not run inside a prepared guest")
	}
	for _, item := range []struct{ test, optIn string }{
		{"TestMonitoringSSHProcessGuest", "EXAM_MONITORING_SSH_GUEST"},
		{"TestMonitoringFreezePTYGuest", "EXAM_MONITORING_FREEZE_GUEST"},
		{"TestMonitoringAsyncIOGuest", "EXAM_MONITORING_ASYNCIO_GUEST"},
		{"TestMonitoringAsyncIOStoppedGuest", "EXAM_MONITORING_ASYNCIO_STOPPED_GUEST"},
		{"TestMonitoringEditorGuest", "EXAM_MONITORING_EDITOR_GUEST"},
		{"TestTemplateCatalogSystemManagerGuest", "EXAM_TEMPLATE_CATALOG_GUEST"},
		{"TestCollectionPoolReadinessGuest", "EXAM_COLLECTION_POOL_GUEST"},
		{"TestWriterThreadGroupGuest", "EXAM_WRITER_THREADS_GUEST"},
		{"TestMonitoringThreadTTYGuest", "EXAM_MONITORING_THREAD_TTY_GUEST"},
	} {
		t.Run(item.test, func(t *testing.T) {
			command := exec.Command("/usr/bin/env", item.optIn+"=1", "GORACE=atexit_sleep_ms=0", os.Args[0], "-test.run=^"+item.test+"$", "-test.count=1")
			output, err := command.CombinedOutput()
			if err == nil || !(bytes.Contains(output, []byte("private guest root required")) || bytes.Contains(output, []byte("refuse outside the private systemd guest")) || bytes.Contains(output, []byte("private monitoring qualification identity required"))) {
				t.Fatal("opt-in flag alone did not refuse an unqualified host", err, string(output))
			}
		})
	}
}

func requireMonitoringGuest(t *testing.T, profile, optIn string) int {
	t.Helper()
	if os.Getenv(optIn) != "1" {
		t.Skip("requires explicit disposable overlay qualification profile")
	}
	if os.Getuid() != 0 || os.Geteuid() != 0 {
		t.Fatal("private guest root required")
	}
	container, err := os.ReadFile("/run/systemd/container")
	if err != nil || strings.TrimSpace(string(container)) != "systemd-nspawn" {
		t.Fatal("refuse outside the private systemd guest")
	}
	const input = "/run/ssh-exam-qualification-input"
	marker, err := os.ReadFile(input + "/run.json")
	var run struct{ Username, Unit, Profile string }
	if err != nil || len(marker) > 4096 || json.Unmarshal(marker, &run) != nil || run.Username != "examq" || run.Profile != profile || !strings.HasPrefix(run.Unit, "ssh-exam-qualification-") || !strings.HasSuffix(run.Unit, ".service") {
		t.Fatal("private monitoring qualification identity required")
	}
	mounts, err := os.ReadFile("/proc/self/mountinfo")
	if err != nil || !strings.Contains(string(mounts), " "+input+" ") || !strings.Contains(string(mounts), " /run/ssh-exam-qualification-output ") {
		t.Fatal("private fixture mounts required")
	}
	configBytes, err := os.ReadFile("/etc/exam-agent/agent.json")
	var config Config
	if err != nil || len(configBytes) > 65536 || json.Unmarshal(configBytes, &config) != nil || config.Socket != "/run/exam-agent/gate.sock" || !config.TemporaryAccountPolicy || config.FunctionalTestAccount != "" {
		t.Fatal("private strict account-policy fixture required")
	}
	guardBytes, err := os.ReadFile(config.GuardReport)
	var guard struct{ Fixture string }
	if err != nil || len(guardBytes) > 65536 || json.Unmarshal(guardBytes, &guard) != nil || !strings.HasPrefix(guard.Fixture, "Private qualification") {
		t.Fatal("private guard report required")
	}
	account, err := user.Lookup(run.Username)
	if err != nil {
		t.Fatal("synthetic local account unavailable")
	}
	uid, err := strconv.Atoi(account.Uid)
	if err != nil || uid < 1000 {
		t.Fatal("invalid synthetic account UID")
	}
	return uid
}

func TestMonitoringSSHProcessGuest(t *testing.T) {
	uid := requireMonitoringGuest(t, "monitoring-owner", "EXAM_MONITORING_SSH_GUEST")
	// The wrapper has stopped ONLY the overlay's agent. Listen refuses an
	// existing socket: never unlink/replace a live guard to make this test pass.
	// systemd removes the agent's RuntimeDirectory at stop. Recreate only this
	// verified disposable guest directory, preserving any existing safe parent.
	if err := os.Mkdir("/run/exam-agent", 0o755); err != nil && !os.IsExist(err) {
		t.Fatal("private runtime directory unavailable", err)
	}
	parent, err := os.Lstat("/run/exam-agent")
	if err != nil || !parent.IsDir() || parent.Mode().Perm()&0o022 != 0 || parent.Sys().(*syscall.Stat_t).Uid != 0 {
		t.Fatal("unsafe private probe socket parent")
	}
	listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: "/run/exam-agent/gate.sock", Net: "unix"})
	if err != nil {
		t.Fatal("private probe socket unavailable; preserve existing guard", err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	if err := os.Chmod("/run/exam-agent/gate.sock", 0o666); err != nil {
		t.Fatal("private peer-credential probe socket unavailable", err)
	}
	dir := t.TempDir()
	control := filepath.Join(dir, "ssh-control")
	args := []string{"-F", "/dev/null", "-i", "/root/qualification-client", "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=yes", "-o", "UserKnownHostsFile=/root/qualification-known-hosts", "-o", "BatchMode=yes", "-o", "ConnectTimeout=3", "-o", "LogLevel=ERROR", "-S", control}
	master := exec.Command("/usr/bin/ssh", append(append([]string{}, args...), "-M", "-N", "examq@127.0.0.1")...)
	master.Stdout, master.Stderr = io.Discard, io.Discard
	if err := master.Start(); err != nil {
		t.Fatal("synthetic guest SSH client unavailable", err)
	}
	masterDone := make(chan error, 1)
	go func() { masterDone <- master.Wait() }()
	t.Cleanup(func() {
		_ = master.Process.Kill() // Exact owned client, never a process-name kill.
		select {
		case <-masterDone:
		case <-time.After(5 * time.Second):
			t.Error("owned SSH client did not exit")
		}
	})
	until := time.Now().Add(5 * time.Second)
	for {
		if info, err := os.Lstat(control); err == nil && info.Mode()&os.ModeSocket != 0 {
			break
		}
		if time.Now().After(until) {
			t.Fatal("synthetic SSH master did not authenticate")
		}
		time.Sleep(20 * time.Millisecond)
	}
	probe := func() (*monitoringProcessGuard, string) {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, "/usr/bin/ssh", append(append([]string{}, args...), "examq@127.0.0.1", "/usr/local/libexec/exam-login -c exam-monitoring-qualification")...)
		command.Stdout, command.Stderr = io.Discard, io.Discard
		if err := command.Start(); err != nil {
			t.Fatal("synthetic SSH command unavailable", err)
		}
		t.Cleanup(func() { _ = command.Process.Kill() })
		_ = listener.SetDeadline(time.Now().Add(5 * time.Second))
		connection, err := listener.AcceptUnix()
		if err != nil {
			_ = command.Wait()
			t.Fatal("authenticated guest entry did not reach probe", err)
		}
		defer connection.Close()
		_ = connection.SetDeadline(time.Now().Add(3 * time.Second))
		credentials, err := peer(connection)
		if err != nil || int(credentials.Uid) != uid {
			t.Fatal("SO_PEERCRED did not identify synthetic student")
		}
		var request LocalRequest
		if err := json.NewDecoder(io.LimitReader(connection, 65536)).Decode(&request); err != nil || !request.Ordinary || request.Command != nil || request.Token != "" {
			t.Fatal("unexpected private entry probe request")
		}
		transport, _, err := transportInfo(int(credentials.Pid), uid)
		if err != nil {
			t.Fatal("actual guest SSH ancestry unavailable", err)
		}
		pinned, err := pinMonitoringSSHProcess(int(credentials.Pid), uid, transport)
		if err != nil || pinned == nil || !pinned.current() {
			t.Fatal("actual authenticated guest transport was not pinned", err)
		}
		t.Cleanup(pinned.close)
		if wrong, err := pinMonitoringSSHProcess(int(credentials.Pid), uid+1, transport); wrong != nil || err != errMonitoringProcess {
			if wrong != nil {
				wrong.close()
			}
			t.Fatal("different account identity accepted")
		}
		// Refuse ordinary execution; this test never supplies a shell/home result.
		if err := json.NewEncoder(connection).Encode(map[string]string{"error": "private qualification probe complete"}); err != nil {
			t.Fatal("private probe response failed")
		}
		_ = connection.Close()
		if err := command.Wait(); err == nil || ctx.Err() != nil {
			t.Fatal("entry probe did not refuse ordinary command promptly")
		}
		if !pinned.current() || pinned.observation() != "live" {
			t.Fatal("short-lived command exit retired the actual SSH owner")
		}
		return pinned, transport
	}
	first, identity := probe()
	second, again := probe()
	if identity != again || first.identity != second.identity || !first.current() {
		t.Fatal("same authenticated multiplexed SSH owner changed across commands")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	closeMaster := exec.CommandContext(ctx, "/usr/bin/ssh", append(append([]string{}, args...), "-O", "exit", "examq@127.0.0.1")...)
	closeMaster.Stdout, closeMaster.Stderr = io.Discard, io.Discard
	if err := closeMaster.Run(); err != nil {
		t.Fatal("owned guest SSH master did not close", err)
	}
	until = time.Now().Add(5 * time.Second)
	for first.current() && time.Now().Before(until) {
		time.Sleep(20 * time.Millisecond)
	}
	if first.current() || second.current() || first.observation() != "exited" || second.observation() != "exited" {
		t.Fatal("actual authenticated SSH owner exit not observed by exact pidfds")
	}
	t.Log("actual SO_PEERCRED/OpenSSH owner pinned across two refused commands; exact connection exit observed")
}
