package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"examworkspace/agent/internal/core"
)

func refusalFixture(t *testing.T) (*core.Engine, string, string) {
	t.Helper()
	dir := t.TempDir()
	id := core.ManagementID()
	state := core.State{Attempts: map[string]*core.Attempt{id: {ID: id, Exam: "synthetic-exam", Username: "synthetic-student", UID: 29999, State: "ACTIVE", Start: core.Millis() - 1000, Deadline: core.Millis() + 3600000, OriginalDeadline: core.Millis() + 3600000, AccessState: "HELD", AccessError: "synthetic access diagnostic", PolicyError: "synthetic policy diagnostic", Errors: []string{"synthetic recorded writer diagnostic"}}}, Caps: map[string]core.Capability{}, Registrations: map[string]string{}}
	b, err := json.Marshal(state)
	if err == nil {
		err = os.WriteFile(filepath.Join(dir, "state.json"), b, 0600)
	}
	if err != nil {
		t.Fatal(err)
	}
	e, err := core.New(core.Config{State: dir})
	if err != nil {
		t.Fatal(err)
	}
	return e, id, filepath.Join(t.TempDir(), "private config's file.json")
}

func TestRefusalReportingDoesNotInitializeOrRewriteStateAndPreservesGuidance(t *testing.T) {
	e, id, config := refusalFixture(t)
	path := filepath.Join(e.Config.State, "state.json")
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	printRefusal(&out, "delete", id, config, e)
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	afterInfo, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) || !info.ModTime().Equal(afterInfo.ModTime()) || info.Sys().(*syscall.Stat_t).Ctim != afterInfo.Sys().(*syscall.Stat_t).Ctim {
		t.Error("refusal diagnostics rewrote authoritative state")
	}
	for _, forbidden := range []string{"initialized", "lock", "audit.jsonl", "collection-locks"} {
		if _, err := os.Lstat(filepath.Join(e.Config.State, forbidden)); !os.IsNotExist(err) {
			t.Error("refusal reporting initialized/reconciled or locked native state", forbidden, err)
		}
	}
	for _, want := range []string{id, "synthetic-student", "synthetic-exam", "state ACTIVE", "access HELD", "Original deadline", "Current deadline", "synthetic access diagnostic", "synthetic policy diagnostic", "synthetic recorded writer diagnostic", "--read-only", "--config '" + strings.ReplaceAll(config, "'", "'\\''") + "'", "not an exam definition", "never automatic"} {
		if !strings.Contains(out.String(), want) {
			t.Error("actionable refusal context missing", want, out.String())
		}
	}
}

func TestRefusalReportingDoesNotWaitOnHeldStateLock(t *testing.T) {
	e, id, config := refusalFixture(t)
	lock, err := os.OpenFile(filepath.Join(e.Config.State, "lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Close()
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	done := make(chan struct{})
	go func() { printRefusal(&out, "pause", id, config, e); close(done) }()
	observed := false
	select {
	case <-done:
		observed = true
	case <-time.After(300 * time.Millisecond):
		t.Error("refusal reporting waits for the shared state lock")
	}
	_ = syscall.Flock(int(lock.Fd()), syscall.LOCK_UN)
	if !observed {
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			t.Fatal("refusal reporter did not unwind")
		}
	}
}

func TestRefusalReportingBrokenStateNeverRepairsOrEchoesPrivateData(t *testing.T) {
	e, id, config := refusalFixture(t)
	path := filepath.Join(e.Config.State, "state.json")
	broken := []byte(`{"private":"SYNTHETIC-DO-NOT-ECHO",`)
	if err := os.WriteFile(path, broken, 0600); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	printRefusal(&out, "pause", id, config, e)
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(after, broken) || strings.Contains(out.String(), "SYNTHETIC-DO-NOT-ECHO") || !strings.Contains(out.String(), "no fallback reconciliation") || !strings.Contains(out.String(), "--read-only") {
		t.Fatal("unavailable diagnostic state was repaired, echoed or lost inspection guidance", err, out.String())
	}
}

func TestRefusalReportingBoundsDisplayAndLabelsPartialLeaseWithoutRepair(t *testing.T) {
	e, id, config := refusalFixture(t)
	path := filepath.Join(e.Config.State, "state.json")
	data, _ := os.ReadFile(path)
	var state core.State
	if err := json.Unmarshal(data, &state); err != nil {
		t.Fatal(err)
	}
	state.Attempts[id].AccessError = "\x1b[31m\n" + strings.Repeat("x", 1100) + "HIDDEN-ACCESS-TAIL"
	state.Attempts[id].Errors = []string{strings.Repeat("y", 1100) + "HIDDEN-WRITER-TAIL"}
	for range 19 {
		state.Attempts[id].Errors = append(state.Attempts[id].Errors, "synthetic displayed diagnostic")
	}
	state.Attempts[id].Errors = append(state.Attempts[id].Errors, "HIDDEN-EXCESS-ERROR")
	data, err := json.Marshal(state)
	if err == nil {
		err = os.WriteFile(path, data, 0600)
	}
	if err != nil {
		t.Fatal(err)
	}
	leases := filepath.Join(e.Config.State, "leases")
	if err := os.Mkdir(leases, 0700); err != nil {
		t.Fatal(err)
	}
	leasePath := filepath.Join(leases, id+".json")
	broken := []byte(`{"PRIVATE-LEASE-CONTENTS":`)
	if err := os.WriteFile(leasePath, broken, 0600); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	printRefusal(&out, "cancel", id, config, e)
	for _, forbidden := range []string{"\x1b", "HIDDEN-ACCESS-TAIL", "HIDDEN-WRITER-TAIL", "HIDDEN-EXCESS-ERROR", "PRIVATE-LEASE-CONTENTS"} {
		if strings.Contains(out.String(), forbidden) {
			t.Fatal("diagnostic display was unbounded/unescaped or echoed invalid lease data", forbidden)
		}
	}
	if !strings.Contains(out.String(), "Lease observation: invalid") || !strings.Contains(out.String(), "21 total") || !strings.Contains(out.String(), "Further errors omitted") || !strings.Contains(out.String(), "not proof") {
		t.Fatal("partial/bounded diagnosis lost truthful status", out.String())
	}
	after, _ := os.ReadFile(leasePath)
	if !bytes.Equal(after, broken) {
		t.Fatal("refusal reporting repaired the invalid lease")
	}
}

func TestRefusalReportingActualCompiledRootCLILeavesUnrelatedRecoveryUntouched(t *testing.T) {
	if os.Getenv("EXAM_MANAGEMENT_USERNS") != "1" {
		t.Skip("requires explicitly authorized isolated namespace-root CLI workflows")
	}
	dir := t.TempDir()
	binary := filepath.Join(dir, "examctl")
	build := exec.Command("go", "build", "-o", binary, ".")
	build.Env = append(os.Environ(), "CGO_ENABLED=0")
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatal("compile actual refusal CLI", err, string(out))
	}
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	pub, _ := x509.MarshalPKIXPublicKey(public)
	key, _ := x509.MarshalPKCS8PrivateKey(private)
	c := core.Config{State: filepath.Join(dir, "state"), Work: filepath.Join(dir, "work"), Rootfs: dir, Templates: dir, AgentID: "class", CallbackURL: "https://unused.example.edu", CallbackKey: filepath.Join(dir, "agent.key"), GatewayPublicKey: filepath.Join(dir, "gateway.pub"), Accounts: map[string]core.Account{"student": {UID: 29999, GID: 29999, Home: "/home/student", Shell: "/bin/sh"}, "other": {UID: 29998, GID: 29998, Home: "/home/other", Shell: "/bin/sh"}}}
	if err := os.Mkdir(c.State, 0700); err != nil {
		t.Fatal(err)
	}
	for p, data := range map[string][]byte{c.CallbackKey: pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: key}), c.GatewayPublicKey: pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pub})} {
		if err := os.WriteFile(p, data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	write := func(p string, v any) {
		t.Helper()
		b, err := json.Marshal(v)
		if err == nil {
			err = os.WriteFile(p, b, 0600)
		}
		if err != nil {
			t.Fatal(err)
		}
	}
	config := filepath.Join(dir, "config with ' apostrophe.json")
	write(config, c)
	id := core.ManagementID()
	deadline := core.Millis() - 1000
	state := core.State{Attempts: map[string]*core.Attempt{id: {ID: id, Exam: "midterm", Username: "student", UID: 29999, State: "COMPLETED", Start: deadline - 5400000, Deadline: deadline, OriginalDeadline: deadline, AccessState: "HELD", AccessError: "Original recovery diagnostic", Transport: "SYNTHETIC-PRIVATE-TRANSPORT", Handoff: &core.SSHHandoff{CertificateKey: "SYNTHETIC-PRIVATE-HANDOFF"}}}, Caps: map[string]core.Capability{}, Registrations: map[string]string{}}
	other := core.ManagementID()
	state.Attempts[other] = &core.Attempt{ID: other, Exam: "midterm", Username: "other", UID: 29998, State: "COMPLETED", Start: deadline - 5400000, Deadline: deadline, OriginalDeadline: deadline, AccessState: "HELD", AccessError: "Unrelated original diagnostic"}
	statePath := filepath.Join(c.State, "state.json")
	write(statePath, state)
	jobLocks := filepath.Join(c.State, "collection-locks")
	if err := os.Mkdir(jobLocks, 0700); err != nil {
		t.Fatal(err)
	}
	// This exact private synthetic unsafe lock refuses before any state/audit
	// transaction. No emergency release can occur, so ALL subsequent state IO
	// would be a side effect of reporting rather than the requested operation.
	if err := os.Symlink(filepath.Join(dir, "unused-synthetic-target"), filepath.Join(jobLocks, id)); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(statePath)
	beforeStateInfo, _ := os.Stat(statePath)
	invoke := func(command string, args ...string) (string, string, int) {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, "/usr/bin/unshare", append([]string{"--user", "--map-root-user", command}, args...)...)
		var out, diagnostics bytes.Buffer
		cmd.Stdout, cmd.Stderr = &out, &diagnostics
		err := cmd.Run()
		if ctx.Err() != nil {
			t.Fatal("actual CLI refusal/suggested observation stalled", out.String(), diagnostics.String())
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
	out, diagnostics, code := invoke(binary, "override-access", id, "--config", config, "--reason", "Synthetic refused override with unsafe private job lock")
	if code != 1 || out != "" || !strings.Contains(diagnostics, "state COMPLETED") || !strings.Contains(diagnostics, "--read-only") || strings.Contains(diagnostics, "SYNTHETIC-PRIVATE-TRANSPORT") || strings.Contains(diagnostics, "SYNTHETIC-PRIVATE-HANDOFF") {
		t.Fatal("actual refusal lost exit/state/guidance or leaked authority", code, out, diagnostics)
	}
	data, err := os.ReadFile(statePath)
	afterStateInfo, statErr := os.Stat(statePath)
	if err != nil || statErr != nil || !bytes.Equal(data, before) || beforeStateInfo.ModTime() != afterStateInfo.ModTime() || beforeStateInfo.Sys().(*syscall.Stat_t).Ctim != afterStateInfo.Sys().(*syscall.Stat_t).Ctim {
		t.Fatal("actual refusal reporting rewrote native state", err, statErr)
	}
	for _, name := range []string{"initialized", "audit.jsonl", "native-management-audit.jsonl"} {
		if _, err := os.Lstat(filepath.Join(c.State, name)); !os.IsNotExist(err) {
			t.Fatal("refusal reporting initialized or audited unrequested work", name, err)
		}
	}
	var after core.State
	if err != nil || json.Unmarshal(data, &after) != nil {
		t.Fatal("read final native state", err)
	}
	a := after.Attempts[id]
	if a.AccessError != "Original recovery diagnostic" || a.AccessState != "HELD" || a.State != "COMPLETED" || a.Start != deadline-5400000 || a.Deadline != deadline || a.OriginalDeadline != deadline {
		t.Fatal("refusal reporting performed unrequested release/recovery or changed history", a.AccessError, a.AccessState, a.State)
	}
	if other := after.Attempts[other]; other.AccessError != "Unrelated original diagnostic" || other.AccessState != "HELD" || other.State != "COMPLETED" || other.Deadline != deadline || other.OriginalDeadline != deadline {
		t.Fatal("refused operation reconciled another student's recovery", other.AccessError, other.AccessState)
	}
	lock, err := os.OpenFile(filepath.Join(c.State, "lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Close()
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX); err != nil {
		t.Fatal(err)
	}
	defer syscall.Flock(int(lock.Fd()), syscall.LOCK_UN)
	if _, diagnostics, code := invoke(binary, "override-access", id, "--config", config, "--reason", "Same synthetic refused override while state is locked"); code != 1 || !strings.Contains(diagnostics, "Captured native metadata only") {
		t.Fatal("refusal reporting needed the held global lock", code, diagnostics)
	}
	// Exercise the emitted inspection command, including actual shell quoting,
	// without sudo: this fixture already runs in its own root user namespace.
	const prefix = "Inspect without writes: sudo examctl "
	var suggested string
	for _, line := range strings.Split(diagnostics, "\n") {
		if strings.HasPrefix(line, prefix) {
			suggested = strings.TrimPrefix(line, prefix)
		}
	}
	if suggested == "" {
		t.Fatal("no executable suggested diagnostic workflow")
	}
	beforeInfo, _ := os.Stat(statePath)
	view, errors, exit := invoke("/bin/sh", "-c", `exec "$0" `+suggested, binary)
	var snapshot core.ReadOnlySnapshot
	if exit != 0 || errors != "" || json.Unmarshal([]byte(view), &snapshot) != nil || len(snapshot.Attempts) != 1 || snapshot.Attempts[0].ID != id || !snapshot.ReadOnly {
		t.Fatal("suggested diagnostic command did not work", exit, view, errors)
	}
	final, _ := os.ReadFile(statePath)
	finalInfo, _ := os.Stat(statePath)
	if !bytes.Equal(final, data) || beforeInfo.ModTime() != finalInfo.ModTime() || beforeInfo.Sys().(*syscall.Stat_t).Ctim != finalInfo.Sys().(*syscall.Stat_t).Ctim {
		t.Fatal("following the suggested command mutated state")
	}
}
