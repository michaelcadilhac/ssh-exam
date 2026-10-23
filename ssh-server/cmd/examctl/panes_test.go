package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"examworkspace/agent/internal/core"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

func TestNativePaneHelpAndRefusalsAreDiscoverableBeforeRootOrConfiguration(t *testing.T) {
	for _, args := range [][]string{{"help", "panes"}, {"panes", "help"}, {"--config", "/missing", "panes", "--help"}} {
		out, code := cliProcess(t, args...)
		for _, want := range []string{"Usage:", "list ATTEMPT", "show ATTEMPT PANE", "close ATTEMPT PANE", "supervisor ATTEMPT", "local Unix", "--revision", "--reason", "unsaved", "read-only", "root", "Exit status:", "closed_startups", "cancelled_startups", "earliest_startup_expiry", "recorded_supervisors", "NOT proof they are alive"} {
			if code != 0 || !strings.Contains(out, want) {
				t.Fatal("pane workflow missing", want, code, out)
			}
		}
	}
	out, code := cliProcess(t, "help")
	if code != 0 || !strings.Contains(out, "panes list/show/close") {
		t.Fatal("pane workflow undiscoverable", code, out)
	}
	id := "12345678-1234-4234-8234-123456789abc"
	for _, args := range [][]string{{"panes"}, {"panes", "close", id, id}, {"panes", "list"}, {"panes", "show", id}, {"panes", "list", id, "--limit", "201"}, {"panes", "show", id, id, "--reason", "Unexpected control"}, {"panes", "close", id, id, "--state", "/missing", "--revision", "sha256:" + strings.Repeat("a", 64), "--reason", "Explicit reviewed close"}} {
		out, code := cliProcess(t, args...)
		if code != 2 || !strings.Contains(out, "help") || strings.Contains(out, "Cannot load") {
			t.Fatal("pane syntax reached configuration/authority", args, code, out)
		}
	}
	for _, args := range [][]string{{"panes", "supervisor"}, {"panes", "supervisor", id, id}, {"panes", "supervisor", id, "--limit", "1"}, {"panes", "supervisor", id, "--after", id}, {"panes", "supervisor", id, "--reason", "not a control"}, {"panes", "supervisor", id, "--state", "/missing", "--config", "/missing"}, {"panes", "supervisor", "../invalid"}} {
		out, code := cliProcess(t, args...)
		if code != 2 || !strings.Contains(out, "help") || strings.Contains(out, "Cannot load") {
			t.Fatal("supervisor syntax reached configuration/authority", args, code, out)
		}
	}
	if os.Getuid() != 0 {
		out, code := cliProcess(t, "panes", "list", id, "--config", "/missing")
		if code != 1 || !strings.Contains(out, "root") || strings.Contains(out, "Cannot load") {
			t.Fatal("pane root refusal opened configuration", code, out)
		}
		out, code = cliProcess(t, "panes", "supervisor", id, "--config", "/missing")
		if code != 1 || !strings.Contains(out, "root") || strings.Contains(out, "Cannot load") {
			t.Fatal("supervisor root refusal opened configuration", code, out)
		}
	}
}

func TestNativePaneActualStaticRootNamespaceCLI(t *testing.T) {
	if os.Getenv("EXAM_MANAGEMENT_USERNS") != "1" {
		t.Skip("requires explicit isolated namespace-root CLI qualification")
	}
	dir := t.TempDir()
	binary := filepath.Join(dir, "examctl")
	build := exec.Command("go", "build", "-o", binary, ".")
	build.Env = append(os.Environ(), "CGO_ENABLED=0")
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatal("build actual static pane CLI", err, string(out))
	}
	stateDir := filepath.Join(dir, "native")
	if err := os.Mkdir(stateDir, 0700); err != nil {
		t.Fatal(err)
	}
	write := func(path string, value any) {
		t.Helper()
		data, err := json.Marshal(value)
		if err == nil {
			err = os.WriteFile(path, data, 0600)
		}
		if err != nil {
			t.Fatal(err)
		}
	}
	id, pane, other := core.ManagementID(), core.ManagementID(), core.ManagementID()
	token, otherToken := core.Token(), core.Token()
	state := core.State{Attempts: map[string]*core.Attempt{id: {ID: id, Exam: "midterm", Username: "student", UID: 20001, State: "PREPARING", PreflightStartedAt: core.Millis() - 20*60000, Transport: "PRIVATE-TRANSPORT", Handoff: &core.SSHHandoff{CertificateKey: "PRIVATE-HANDOFF"}}}, Caps: map[string]core.Capability{core.Hash([]byte(token)): {ID: id, Pane: pane, Username: "student", Transport: "PRIVATE-TRANSPORT", Purpose: "practice", Expires: core.Millis() + 15000}, core.Hash([]byte(otherToken)): {ID: id, Pane: other, Username: "student", Transport: "PRIVATE-TRANSPORT", Purpose: "practice", Expires: core.Millis() + 15000}}, Registrations: map[string]string{"PRIVATE-TRANSPORT": "student"}}
	write(filepath.Join(stateDir, "state.json"), state)
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	pubDER, err := x509.MarshalPKIXPublicKey(public)
	if err != nil {
		t.Fatal(err)
	}
	privDER, err := x509.MarshalPKCS8PrivateKey(private)
	if err != nil {
		t.Fatal(err)
	}
	pubPath, keyPath := filepath.Join(dir, "gateway.pub"), filepath.Join(dir, "callback.key")
	if err := os.WriteFile(pubPath, pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pubDER}), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(keyPath, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: privDER}), 0600); err != nil {
		t.Fatal(err)
	}
	config := filepath.Join(dir, "config.json")
	write(config, core.Config{AgentID: "class", GatewayPublicKey: pubPath, CallbackKey: keyPath, CallbackURL: "https://127.0.0.1:9", State: stateDir, Work: filepath.Join(dir, "work"), Rootfs: "/", Accounts: map[string]core.Account{"student": {UID: 20001, GID: 20001, Home: "/home/student", Shell: "/bin/sh"}}})
	invoke := func(args ...string) (string, string, int) {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, "/usr/bin/unshare", append([]string{"--user", "--map-root-user", binary}, args...)...)
		var out, diagnostics bytes.Buffer
		cmd.Stdout, cmd.Stderr = &out, &diagnostics
		err := cmd.Run()
		if ctx.Err() != nil {
			t.Fatal("pane CLI waited on a lock/network/subprocess", out.String(), diagnostics.String())
		}
		if err == nil {
			return out.String(), diagnostics.String(), 0
		}
		if status, ok := err.(*exec.ExitError); ok {
			return out.String(), diagnostics.String(), status.ExitCode()
		}
		t.Fatal(err)
		return "", "", -1
	}
	lock, err := os.OpenFile(filepath.Join(stateDir, "lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Close()
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(filepath.Join(stateDir, "state.json"))
	beforeInfo, _ := os.Stat(filepath.Join(stateDir, "state.json"))
	out, diagnostics, code := invoke("panes", "show", id, pane, "--state", stateDir)
	var view core.NativePanesSnapshot
	if code != 0 || diagnostics != "" || json.Unmarshal([]byte(out), &view) != nil || !view.ReadOnly || len(view.Panes) != 1 || view.Panes[0].Revision == "" {
		t.Fatal("actual locked read-only pane show", code, out, diagnostics)
	}
	afterInfo, _ := os.Stat(filepath.Join(stateDir, "state.json"))
	after, _ := os.ReadFile(filepath.Join(stateDir, "state.json"))
	if !bytes.Equal(before, after) || beforeInfo.ModTime() != afterInfo.ModTime() || beforeInfo.Sys().(*syscall.Stat_t).Ctim != afterInfo.Sys().(*syscall.Stat_t).Ctim {
		t.Fatal("actual read-only CLI changed state")
	}
	for _, secret := range []string{token, otherToken, "PRIVATE-HANDOFF", "PRIVATE-TRANSPORT", string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: privDER}))} {
		if strings.Contains(out+diagnostics, secret) {
			t.Fatal("actual pane metadata leaked private authority")
		}
	}
	if _, err := os.Stat(filepath.Join(stateDir, "initialized")); !os.IsNotExist(err) {
		t.Fatal("read-only CLI initialized state")
	}
	_ = syscall.Flock(int(lock.Fd()), syscall.LOCK_UN)
	out, diagnostics, code = invoke("panes", "close", id, pane, "--config", config, "--revision", view.Panes[0].Revision, "--reason", "Explicit reviewed pending terminal closure")
	var closed core.NativePaneCloseResult
	if code != 0 || diagnostics != "" || json.Unmarshal([]byte(out), &closed) != nil || !closed.RecordedTargetsQuiesced || closed.ClockChanged || closed.AccessReleased {
		t.Fatal("actual reviewed root close", code, out, diagnostics)
	}
	data, _ := os.ReadFile(filepath.Join(stateDir, "state.json"))
	var current core.State
	if json.Unmarshal(data, &current) != nil {
		t.Fatal("closed state invalid")
	}
	if _, ok := current.Caps[core.Hash([]byte(token))]; ok {
		t.Fatal("actual CLI retained target admission")
	}
	if _, ok := current.Caps[core.Hash([]byte(otherToken))]; !ok {
		t.Fatal("actual CLI revoked other pane")
	}
	a := current.Attempts[id]
	if a.State != "PREPARING" || a.Start != 0 || a.Deadline != 0 || a.OriginalDeadline != 0 || a.PolicyRestoreAuthorized {
		t.Fatal("pane close implicitly cancelled/reconciled expired preflight or changed clock/policy")
	}
	audit, _ := os.ReadFile(filepath.Join(stateDir, "audit.ndjson"))
	if !bytes.Contains(audit, []byte("administrator-pane-close-requested")) || !bytes.Contains(audit, []byte(`"actor_uid":0`)) {
		t.Fatal("actual root close intent not audited")
	}
	beforeRetry := append([]byte(nil), data...)
	out, diagnostics, code = invoke("panes", "close", id, pane, "--config", config, "--revision", view.Panes[0].Revision, "--reason", "Explicit reviewed pending terminal closure")
	data, _ = os.ReadFile(filepath.Join(stateDir, "state.json"))
	if code != 1 || out != "" || !strings.Contains(diagnostics, "snapshot changed") || !bytes.Equal(beforeRetry, data) {
		t.Fatal("stale actual root close touched replacement/state", code, out, diagnostics)
	}
	// Actual compiled CLI can inspect and cancel a closed OS startup, not only
	// an unused admission token. No real host scope or manager call is needed.
	bootData, err := os.ReadFile("/proc/sys/kernel/random/boot_id")
	var clock unix.Timespec
	if err != nil || unix.ClockGettime(unix.CLOCK_BOOTTIME, &clock) != nil {
		t.Fatal("fixture kernel clocks unavailable", err)
	}
	instance := core.ManagementID()
	unit := "exam-" + id + "-" + other + "-" + instance + ".scope"
	until := core.Millis() + 15000
	current.Attempts[id].Units = []string{unit}
	current.PaneInstances = map[string]core.PaneInstance{unit: {Attempt: id, Pane: other, ID: instance, Boot: strings.TrimSpace(string(bootData)), ClosedUntil: until, ClosedBootUntil: clock.Sec*1000 + clock.Nsec/1000000 + 15000}}
	write(filepath.Join(stateDir, "state.json"), current)
	out, diagnostics, code = invoke("panes", "show", id, other, "--state", stateDir)
	if code != 0 || diagnostics != "" || json.Unmarshal([]byte(out), &view) != nil || len(view.Panes) != 1 || view.Panes[0].ClosedStartups != 1 || view.Panes[0].StartupExpires != until || view.Panes[0].Unsafe || view.Panes[0].Revision == "" {
		t.Fatal("actual CLI cannot review closed startup", code, out, diagnostics)
	}
	out, diagnostics, code = invoke("panes", "close", id, other, "--config", config, "--revision", view.Panes[0].Revision, "--reason", "Reviewed closed synthetic OS startup cancellation")
	if code != 0 || diagnostics != "" || json.Unmarshal([]byte(out), &closed) != nil || closed.ClosedStartupsRevoked != 1 || !closed.RecordedTargetsQuiesced {
		t.Fatal("actual CLI cannot cancel closed startup", code, out, diagnostics)
	}
	data, _ = os.ReadFile(filepath.Join(stateDir, "state.json"))
	current = core.State{}
	if json.Unmarshal(data, &current) != nil || len(current.Attempts[id].Units) != 0 || len(current.PaneInstances) != 0 || current.Attempts[id].Start != 0 || current.Attempts[id].State != "PREPARING" {
		t.Fatal("actual CLI stranded closed startup or changed clock/attempt")
	}
}
