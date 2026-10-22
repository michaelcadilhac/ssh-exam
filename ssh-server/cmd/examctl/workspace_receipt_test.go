package main

import (
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
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestWorkspaceReceiptActualRootCLIRefusesWithoutClockOrSourceMutation(t *testing.T) {
	if os.Getenv("EXAM_MANAGEMENT_USERNS") != "1" {
		t.Skip("requires explicit isolated namespace-root CLI qualification")
	}
	dir := t.TempDir()
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	publicDER, _ := x509.MarshalPKIXPublicKey(public)
	privateDER, _ := x509.MarshalPKCS8PrivateKey(private)
	publicPath, keyPath := filepath.Join(dir, "gateway.pub"), filepath.Join(dir, "callback.key")
	for path, data := range map[string][]byte{publicPath: pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: publicDER}), keyPath: pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: privateDER})} {
		if err := os.WriteFile(path, data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	c := core.Config{State: filepath.Join(dir, "state"), Work: filepath.Join(dir, "work"), Rootfs: dir, Templates: dir, AgentID: "class", CallbackURL: "https://unused.example.edu", CallbackKey: keyPath, GatewayPublicKey: publicPath, Accounts: map[string]core.Account{"student": {UID: 29999, GID: 29999, Home: dir, Shell: "/bin/bash"}}}
	id := core.ManagementID()
	ready := filepath.Join(c.Work, id, "workspace-ready")
	staged := filepath.Join(ready, "work")
	for _, path := range []string{c.State, staged} {
		if err := os.MkdirAll(path, 0700); err != nil {
			t.Fatal(err)
		}
	}
	answer := filepath.Join(staged, "answer.txt")
	if err := os.WriteFile(answer, []byte("private staged original"), 0600); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(staged)
	if err != nil {
		t.Fatal(err)
	}
	stat := info.Sys().(*syscall.Stat_t)
	a := &core.Attempt{ID: id, Exam: "midterm", Username: "student", UID: 29999, State: "PREPARING", PreflightStartedAt: core.Millis(), Transport: "synthetic-owner", Settings: core.Settings{ID: "midterm", Template: "v1", Duration: 5400, Terminals: 4, Latest: core.Millis() + 600000}}
	settings, _ := json.Marshal(a.Settings)
	r := &core.WorkspaceReceipt{Version: 1, Attempt: id, Exam: a.Exam, Username: a.Username, UID: a.UID, SettingsHash: core.Hash(settings), Source: core.WorkspaceSource{Kind: "template", Template: "v1"}, PreparedAt: core.Millis(), WorkDevice: uint64(stat.Dev), WorkInode: stat.Ino}
	a.Workspace = r
	state := core.State{Attempts: map[string]*core.Attempt{id: a}, Caps: map[string]core.Capability{}, Registrations: map[string]string{a.Transport: a.Username}}
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
	config, statePath := filepath.Join(dir, "config.json"), filepath.Join(c.State, "state.json")
	write(config, c)
	write(statePath, state)
	receiptPath := filepath.Join(ready, "receipt.json")
	for _, kind := range []string{"fifo", "hardlink", "duplicate", "private-unknown"} {
		t.Run(kind, func(t *testing.T) {
			if err := os.Remove(receiptPath); err != nil && !os.IsNotExist(err) {
				t.Fatal(err)
			}
			switch kind {
			case "fifo":
				if err := syscall.Mkfifo(receiptPath, 0600); err != nil {
					t.Fatal(err)
				}
			case "hardlink":
				write(receiptPath, r)
				if err := os.Link(receiptPath, receiptPath+".alias"); err != nil {
					t.Fatal(err)
				}
			default:
				data, _ := json.Marshal(r)
				suffix := `,"attempt":"` + id + `"}`
				if kind == "private-unknown" {
					suffix = `,"private":"SYNTHETIC-PRIVATE-DO-NOT-ECHO"}`
				}
				data = append(data[:len(data)-1], []byte(suffix)...)
				if err := os.WriteFile(receiptPath, data, 0600); err != nil {
					t.Fatal(err)
				}
			}
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			command := exec.CommandContext(ctx, "/usr/bin/unshare", "--user", "--map-root-user", os.Args[0], "-test.run=^TestCLIEntry$", "--", "--config", config, "start", id, "--reason", "Synthetic unsafe receipt refusal")
			command.Env = append(os.Environ(), "EXAMCTL_TEST_ENTRY=1", "GORACE=atexit_sleep_ms=0")
			out, err := command.CombinedOutput()
			status, exited := err.(*exec.ExitError)
			if ctx.Err() != nil || !exited || status.ExitCode() != 1 || !strings.Contains(string(out), "examctl info "+id+" --read-only") || strings.Contains(string(out), "SYNTHETIC-PRIVATE-DO-NOT-ECHO") {
				t.Fatal("actual CLI receipt refusal stalled, lacked guidance or leaked contents", err, string(out))
			}
			var saved core.State
			data, err := os.ReadFile(statePath)
			if err != nil || json.Unmarshal(data, &saved) != nil || !reflect.DeepEqual(saved.Attempts[id], a) {
				t.Fatal("CLI changed unstarted attempt authority", err)
			}
			if data, err := os.ReadFile(answer); err != nil || string(data) != "private staged original" {
				t.Fatal("CLI replaced staged answer", err)
			}
			if _, err := os.Lstat(filepath.Join(c.Work, id, "work")); !os.IsNotExist(err) {
				t.Fatal("refused CLI published live work", err)
			}
		})
	}
}
