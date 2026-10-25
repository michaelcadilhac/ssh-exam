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
	"reflect"
	"strconv"
	"syscall"
	"testing"
	"time"
)

func TestHealthActualCompiledRootCLIReleasesStateDuringHeldManagerQuery(t *testing.T) {
	testHealthActualCompiledRootCLIWithHeldDependency(t, false)
}

func TestHealthActualCompiledRootCLIBoundsHungAccountLookup(t *testing.T) {
	testHealthActualCompiledRootCLIWithHeldDependency(t, true)
}

func testHealthActualCompiledRootCLIWithHeldDependency(t *testing.T, holdNSS bool) {
	t.Helper()
	if os.Getenv("EXAM_MANAGEMENT_USERNS") != "1" {
		t.Skip("requires explicitly authorized isolated root user/mount namespace")
	}
	dir := t.TempDir()
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	pub, _ := x509.MarshalPKIXPublicKey(public)
	key, _ := x509.MarshalPKCS8PrivateKey(private)
	c := core.Config{AgentID: "class", State: filepath.Join(dir, "state"), Work: filepath.Join(dir, "work"), Rootfs: dir, Templates: dir, CallbackURL: "https://unused.example.edu", CallbackKey: filepath.Join(dir, "agent.key"), GatewayPublicKey: filepath.Join(dir, "gateway.pub"), Accounts: map[string]core.Account{"synthetic": {UID: 20001, GID: 20001, Home: "/home/synthetic", Shell: "/bin/bash"}}}
	for _, p := range []string{c.State, c.Work} {
		if err := os.Mkdir(p, 0700); err != nil {
			t.Fatal(err)
		}
	}
	for p, b := range map[string][]byte{c.CallbackKey: pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: key}), c.GatewayPublicKey: pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pub})} {
		if err := os.WriteFile(p, b, 0600); err != nil {
			t.Fatal(err)
		}
	}
	write := func(path string, value any) {
		t.Helper()
		b, err := json.Marshal(value)
		if err == nil {
			err = os.WriteFile(path, b, 0600)
		}
		if err != nil {
			t.Fatal(err)
		}
	}
	config := filepath.Join(dir, "config.json")
	write(config, c)
	id := core.ManagementID()
	a := &core.Attempt{ID: id, Exam: "midterm", Username: "student", UID: 20001, State: "ACTIVE", Start: core.Millis(), Deadline: core.Millis() + 3600000, OriginalDeadline: core.Millis() + 3600000, Lease: core.Millis() + 15000, AccessState: "HELD", Transport: "synthetic-owner"}
	statePath := filepath.Join(c.State, "state.json")
	write(statePath, core.State{Attempts: map[string]*core.Attempt{id: a}, Caps: map[string]core.Capability{}, Registrations: map[string]string{a.Transport: a.Username}})
	adapterData, err := os.ReadFile(filepath.Join("..", "..", "tests", "collection_readiness_fixture.py"))
	if err != nil {
		t.Fatal(err)
	}
	adapter := filepath.Join(dir, "private-manager")
	if err := os.WriteFile(adapter, adapterData, 0700); err != nil {
		t.Fatal(err)
	}
	prefix, holdOption := "health", "hold"
	if holdNSS {
		prefix, holdOption = "nss", "hold_nss"
	}
	gate := filepath.Join(dir, prefix+"-probe-gate")
	if err := syscall.Mkfifo(gate, 0600); err != nil {
		t.Fatal(err)
	}
	policy := filepath.Join(dir, "policy.json")
	write(policy, map[string]any{"swap": "0", "capture": filepath.Join(dir, "captured-query.json"), holdOption: true})
	binary := filepath.Join(dir, "examctl")
	build := exec.Command("go", "build", "-o", binary, ".")
	build.Env = append(os.Environ(), "CGO_ENABLED=0")
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatal("compile actual static health CLI", err, string(out))
	}
	inode := func(path string) string {
		t.Helper()
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		return strconv.FormatUint(info.Sys().(*syscall.Stat_t).Ino, 10)
	}
	managerBefore, err := os.ReadFile("/usr/bin/systemctl")
	if err != nil {
		t.Fatal(err)
	}
	nssBefore, err := os.ReadFile("/usr/bin/getent")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	health := exec.CommandContext(ctx, "/usr/bin/unshare", "--user", "--map-root-user", "--mount", "/usr/bin/python3", adapter, "--enter", adapter, inode("/proc/self/ns/user"), inode("/proc/self/ns/mnt"), binary, "--config", config, "health")
	health.Env = append(os.Environ(), "EXAM_COLLECTION_READINESS_FIXTURE="+policy)
	var output, diagnostics bytes.Buffer
	health.Stdout, health.Stderr = &output, &diagnostics
	if err := health.Start(); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- health.Wait() }()
	defer func() {
		cancel()
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			t.Error("owned health process did not stop")
		}
	}()
	until := time.Now().Add(3 * time.Second)
	for {
		if _, err := os.Stat(filepath.Join(dir, prefix+"-probe-entered")); err == nil {
			break
		}
		select {
		case err := <-done:
			done <- err
			t.Fatal("health never reached private held systemctl query", err, diagnostics.String(), output.String())
		default:
		}
		if time.Now().After(until) {
			t.Fatal("private manager query did not start")
		}
		time.Sleep(5 * time.Millisecond)
	}
	inspectCtx, inspectCancel := context.WithTimeout(context.Background(), 750*time.Millisecond)
	defer inspectCancel()
	inspect := exec.CommandContext(inspectCtx, "/usr/bin/unshare", "--user", "--map-root-user", binary, "--config", config, "info", id)
	infoOut, infoErr := inspect.CombinedOutput()
	var observed core.Attempt
	if infoErr != nil || json.Unmarshal(infoOut, &observed) != nil || observed.ID != id || observed.Deadline != a.Deadline || observed.AccessState != "HELD" {
		t.Error("real root CLI inspection waited behind health or changed target", infoErr, string(infoOut))
	}
	settled := false
	if holdNSS {
		select {
		case err := <-done:
			done <- err
			settled = true
			if err != nil || !bytes.Contains(output.Bytes(), []byte("account lookup unavailable")) {
				t.Error("hung account lookup did not fail closed with an actionable readiness issue", err, output.String(), diagnostics.String())
			}
		case <-time.After(6 * time.Second):
			t.Error("readiness account lookup has no bounded wait")
		}
	}
	if !settled {
		fd, err := syscall.Open(gate, syscall.O_WRONLY|syscall.O_NONBLOCK|syscall.O_CLOEXEC, 0)
		if err != nil {
			t.Fatal("owned readiness hold expired before release", err)
		}
		writer := os.NewFile(uintptr(fd), "private-readiness-release")
		_, err = writer.Write([]byte("1"))
		writer.Close()
		if err != nil {
			t.Fatal(err)
		}
	}
	select {
	case err := <-done:
		done <- err
		if err != nil {
			t.Fatal("health did not finish", err, diagnostics.String(), output.String())
		}
	case <-time.After(3 * time.Second):
		t.Fatal("health remained blocked after exact release")
	}
	var result struct {
		Ready        bool            `json:"ready"`
		Capabilities []string        `json:"capabilities"`
		NativeRoles  json.RawMessage `json:"native_roles"`
	}
	if json.Unmarshal(output.Bytes(), &result) != nil || result.Ready || len(result.Capabilities) == 0 {
		t.Fatal("synthetic host incorrectly claimed production readiness", output.String())
	}
	if len(result.NativeRoles) == 0 {
		t.Fatal("actual health CLI omits live native-role agreement and actionable unavailable observation", output.String())
	}
	var roles core.NativeRoleObservation
	if json.Unmarshal(result.NativeRoles, &roles) != nil || !roles.ObservationOnly || roles.Complete || roles.RetainedEnabled || len(roles.Issues) == 0 || len(roles.Roles) != 0 {
		t.Fatal("actual health CLI promoted an unavailable synthetic cohort into live permission", string(result.NativeRoles))
	}
	var saved core.State
	data, err := os.ReadFile(statePath)
	if err != nil || json.Unmarshal(data, &saved) != nil || !reflect.DeepEqual(saved.Attempts[id], a) {
		t.Fatal("readiness changed original attempt authority", err)
	}
	managerAfter, err := os.ReadFile("/usr/bin/systemctl")
	if err != nil || !bytes.Equal(managerBefore, managerAfter) {
		t.Fatal("namespace test changed host manager", err)
	}
	nssAfter, err := os.ReadFile("/usr/bin/getent")
	if err != nil || !bytes.Equal(nssBefore, nssAfter) {
		t.Fatal("namespace test changed host NSS executable", err)
	}
}
