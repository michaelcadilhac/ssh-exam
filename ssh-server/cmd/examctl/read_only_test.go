package main

import (
	"bytes"
	"context"
	"encoding/json"
	"examworkspace/agent/internal/core"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestReadOnlyHelpAndInvalidSelectionsBeforePrivilegeOrConfiguration(t *testing.T) {
	for _, topic := range []string{"info", "list"} {
		out, code := cliProcess(t, "help", topic)
		for _, want := range []string{"--read-only", "--state", "64 MiB", "partial", "NOT healthy", "without --read-only", "no Engine initialization"} {
			if code != 0 || !strings.Contains(out, want) {
				t.Fatal(topic, want, code, out)
			}
		}
	}
	id := "12345678-1234-1234-1234-123456789abc"
	for _, args := range [][]string{
		{"pause", id, "--read-only", "--reason", "Concrete synthetic reason"},
		{"health", "--read-only"}, {"list", "--state", "/missing"}, {"list", "--limit", "50"},
		{"list", "--read-only", "--state", ""}, {"info", "invalid", "--read-only"},
		{"list", "--read-only", "--limit", "201"}, {"list", "--read-only", "--after", "invalid"},
		{"list", "--read-only", "--state", "/missing", "--config", "/missing-config"},
		{"info", id, "--read-only", "--active"}, {"info", id, "--read-only", "--reason", "Concrete synthetic reason"},
		{"info", id, "--read-only", "--limit", "1"},
	} {
		out, code := cliProcess(t, args...)
		if code != 2 || !strings.Contains(out, "help") || strings.Contains(out, "Cannot load") {
			t.Fatal("unsafe read-only syntax reached configuration/operation", args, code, out)
		}
	}
}

func TestCompiledReadOnlyCLIUnderRootUserNamespaceDoesNotInitializeReconcileOrWaitOnStateLock(t *testing.T) {
	if os.Getenv("EXAM_MANAGEMENT_USERNS") != "1" {
		t.Skip("set EXAM_MANAGEMENT_USERNS=1 for actual compiled namespace-root read-only CLI workflows")
	}
	dir := t.TempDir()
	binary := filepath.Join(dir, "examctl")
	build := exec.Command("go", "build", "-o", binary, ".")
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatal("compile actual local CLI", err, string(out))
	}
	stateDir := filepath.Join(dir, "native")
	if err := os.Mkdir(stateDir, 0700); err != nil {
		t.Fatal(err)
	}
	const id = "12345678-1234-1234-1234-123456789abc"
	state := core.State{Attempts: map[string]*core.Attempt{id: {ID: id, Exam: "midterm", Username: "student", UID: 20001, State: "ACTIVE", Start: 1000, Deadline: core.Millis() + 3600000, OriginalDeadline: core.Millis() + 3600000, Lease: 1234, Transport: "PRIVATE-TRANSPORT", ResumeTransport: "PRIVATE-RESUME", Handoff: &core.SSHHandoff{CertificateKey: "PRIVATE-KEY"}, Generation: 1, AccessState: "HELD", Boot: "synthetic-boot"}}, Caps: map[string]core.Capability{"PRIVATE-CAPABILITY": {ID: id}}, Registrations: map[string]string{"PRIVATE-TRANSPORT": "student"}}
	write := func(path string, v any) {
		t.Helper()
		b, err := json.Marshal(v)
		if err == nil {
			err = os.WriteFile(path, b, 0600)
		}
		if err != nil {
			t.Fatal(err)
		}
	}
	statePath := filepath.Join(stateDir, "state.json")
	write(statePath, state)
	config := filepath.Join(dir, "config.json")
	// Normal LoadConfig cannot use this intentionally incomplete install. The
	// observation path needs only state; no keys/services/root filesystem exist.
	write(config, map[string]string{"state": stateDir, "callback_key": "/MISSING-PRIVATE-KEY"})
	lock, err := os.OpenFile(filepath.Join(stateDir, "lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Close()
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		t.Fatal(err)
	}
	invoke := func(args ...string) (string, string, int) {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, "/usr/bin/unshare", append([]string{"--user", "--map-root-user", binary}, args...)...)
		var out, diagnostics bytes.Buffer
		cmd.Stdout = &out
		cmd.Stderr = &diagnostics
		err := cmd.Run()
		if ctx.Err() != nil {
			t.Fatal("read-only CLI waited on a state lock/subprocess", out.String(), diagnostics.String())
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
	fingerprint := func() map[string]string {
		t.Helper()
		v := map[string]string{}
		err := filepath.WalkDir(stateDir, func(p string, d os.DirEntry, err error) error {
			if err != nil {
				return err
			}
			i, err := os.Lstat(p)
			if err != nil {
				return err
			}
			s := i.Sys().(*syscall.Stat_t)
			v[p] = fmt.Sprintf("%v/%d/%v/%v", i.Mode(), i.Size(), s.Mtim, s.Ctim)
			if i.Mode().IsRegular() {
				b, err := os.ReadFile(p)
				if err != nil {
					return err
				}
				v[p] += "/" + core.Hash(b)
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
	for _, args := range [][]string{
		{"info", id, "--read-only", "--state", stateDir},
		{"--read-only", "--config", config, "info", id},
		{"list", "--read-only", "--state", stateDir, "--active", "--exam", "midterm", "--limit", "1", "--json"},
	} {
		before := fingerprint()
		out, diagnostics, code := invoke(args...)
		var v core.ReadOnlySnapshot
		if code != 0 || diagnostics != "" || json.Unmarshal([]byte(out), &v) != nil || !v.ReadOnly || !v.Complete || len(v.Attempts) != 1 || v.Attempts[0].RecordedLease != 1234 || v.Attempts[0].Lease.Status != "absent" {
			t.Fatal(args, code, out, diagnostics)
		}
		for _, secret := range []string{"PRIVATE-KEY", "PRIVATE-TRANSPORT", "PRIVATE-RESUME", "PRIVATE-CAPABILITY"} {
			if strings.Contains(out+diagnostics, secret) {
				t.Fatal("compiled CLI leaked private authority")
			}
		}
		if !reflect.DeepEqual(before, fingerprint()) {
			t.Fatal("compiled read-only workflow mutated native state")
		}
	}
	if err := os.Mkdir(filepath.Join(stateDir, "leases"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(stateDir, "leases", id+".json"), []byte(`{"PRIVATE-CONTENTS":`), 0600); err != nil {
		t.Fatal(err)
	}
	before := fingerprint()
	out, diagnostics, code := invoke("info", id, "--read-only", "--state", stateDir)
	var partial core.ReadOnlySnapshot
	if code != 1 || json.Unmarshal([]byte(out), &partial) != nil || partial.Complete || partial.Attempts[0].Lease.Status != "invalid" || !strings.Contains(diagnostics, "Partial read-only") || strings.Contains(out+diagnostics, "PRIVATE-CONTENTS") {
		t.Fatal("partial observation misreported/echoed", code, out, diagnostics)
	}
	if !reflect.DeepEqual(before, fingerprint()) {
		t.Fatal("partial observation mutated records")
	}
	missing := filepath.Join(dir, "not-initialized")
	out, diagnostics, code = invoke("list", "--read-only", "--state", missing)
	if code != 1 || out != "" || !strings.Contains(diagnostics, "preserve existing state") {
		t.Fatal("missing state not safely reported", code, out, diagnostics)
	}
	if _, err := os.Stat(missing); !os.IsNotExist(err) {
		t.Fatal("read-only workflow initialized missing state", err)
	}
}
