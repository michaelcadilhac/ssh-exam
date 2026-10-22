package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"examworkspace/agent/internal/core"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
)

func TestCollectionNoSwapReadinessThroughActualRootCLI(t *testing.T) {
	if os.Getenv("EXAM_MANAGEMENT_USERNS") != "1" {
		t.Skip("requires isolated root user/mount namespaces")
	}
	dir := t.TempDir()
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	pub, err := x509.MarshalPKIXPublicKey(public)
	if err != nil {
		t.Fatal(err)
	}
	key, err := x509.MarshalPKCS8PrivateKey(private)
	if err != nil {
		t.Fatal(err)
	}
	config := core.Config{AgentID: "class", State: filepath.Join(dir, "state"), Work: filepath.Join(dir, "work"), Rootfs: "/", CallbackURL: "https://gateway.invalid", CallbackKey: filepath.Join(dir, "agent.key"), GatewayPublicKey: filepath.Join(dir, "gateway.pub"), Accounts: map[string]core.Account{"synthetic": {UID: 20001, GID: 20001, Home: "/home/synthetic", Shell: "/bin/bash"}}}
	if os.Mkdir(config.Work, 0700) != nil || os.WriteFile(filepath.Join(config.Work, "protected-sentinel"), []byte("PRESERVE-SYNTHETIC-WORK"), 0600) != nil {
		t.Fatal("private work fixture")
	}
	if os.WriteFile(config.CallbackKey, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: key}), 0600) != nil || os.WriteFile(config.GatewayPublicKey, pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pub}), 0644) != nil {
		t.Fatal("synthetic keys")
	}
	configPath := filepath.Join(dir, "agent.json")
	raw, _ := json.Marshal(config)
	if err := os.WriteFile(configPath, raw, 0600); err != nil {
		t.Fatal(err)
	}
	fixture, err := os.ReadFile(filepath.Join("..", "..", "tests", "collection_readiness_fixture.py"))
	if err != nil {
		t.Fatal(err)
	}
	adapter := filepath.Join(dir, "private-manager")
	if err := os.WriteFile(adapter, fixture, 0700); err != nil {
		t.Fatal(err)
	}
	binary := filepath.Join(dir, "examctl")
	if output, err := exec.Command("go", "build", "-o", binary, ".").CombinedOutput(); err != nil {
		t.Fatal("build actual CLI", err, string(output))
	}
	inode := func(path string) string {
		t.Helper()
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		return strconv.FormatUint(info.Sys().(*syscall.Stat_t).Ino, 10)
	}
	parentUser, parentMount := inode("/proc/self/ns/user"), inode("/proc/self/ns/mnt")
	policy, capture := filepath.Join(dir, "policy.json"), filepath.Join(dir, "captured-query.json")
	for _, swap := range []string{"0", "absent", "infinity", "1024", "0"} {
		var value any = swap
		if swap == "absent" {
			value = nil
		}
		data, _ := json.Marshal(map[string]any{"swap": value, "capture": capture})
		if os.WriteFile(policy, data, 0600) != nil {
			t.Fatal("private policy fixture")
		}
		command := exec.Command("/usr/bin/unshare", "--user", "--map-root-user", "--mount", "/usr/bin/python3", adapter, "--enter", adapter, parentUser, parentMount, binary, "--config", configPath, "health")
		command.Env = append(os.Environ(), "EXAM_COLLECTION_READINESS_FIXTURE="+policy)
		var stdout, stderr bytes.Buffer
		command.Stdout = &stdout
		command.Stderr = &stderr
		if err := command.Run(); err != nil {
			t.Fatal("actual CLI readiness workflow failed", swap, err, stderr.String(), stdout.String())
		}
		var result struct {
			Ready   bool     `json:"ready"`
			Missing []string `json:"missing"`
		}
		if json.Unmarshal(stdout.Bytes(), &result) != nil || result.Ready {
			t.Fatal("synthetic host incorrectly claimed production readiness", stdout.String())
		}
		poolRefused := false
		for _, message := range result.Missing {
			if strings.HasPrefix(message, "collection resource slice unavailable or unbounded") {
				poolRefused = true
			}
		}
		if poolRefused != (swap != "0") {
			t.Fatal("actual CLI did not honor explicit aggregate no-swap proof", swap, result.Missing)
		}
		query, err := os.ReadFile(capture)
		if err != nil || !bytes.Contains(query, []byte("--property=MemorySwapMax")) {
			t.Fatal("no actual explicit systemctl property query", err, string(query))
		}
		saved, err := os.ReadFile(filepath.Join(config.Work, "protected-sentinel"))
		if err != nil || string(saved) != "PRESERVE-SYNTHETIC-WORK" {
			t.Fatal("readiness changed saved fixture work", err)
		}
		state, err := os.ReadFile(filepath.Join(config.State, "state.json"))
		if err != nil {
			t.Fatal(err)
		}
		var native core.State
		if json.Unmarshal(state, &native) != nil || len(native.Attempts) != 0 {
			t.Fatal("readiness created an exam attempt")
		}
	}
	if inode("/proc/self/ns/user") != parentUser || inode("/proc/self/ns/mnt") != parentMount {
		t.Fatal("fixture escaped/changed parent namespaces")
	}
}
