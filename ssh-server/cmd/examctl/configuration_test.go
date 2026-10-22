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
	"strings"
	"testing"
)

func TestConfigurationHelpAndSyntaxBeforeRootOrFiles(t *testing.T) {
	for _, args := range [][]string{{"config", "help"}, {"help", "config"}, {"config", "show", "--config", "/missing", "--help"}, {"config", "validate", "--help"}} {
		out, code := cliProcess(t, args...)
		for _, word := range []string{"Usage:", "show", "validate", "read-only", "No", "keys", "apply", "Exit status:"} {
			if code != 0 || !strings.Contains(out, word) {
				t.Fatalf("missing config help %q: exit%d %s", word, code, out)
			}
		}
	}
	for _, args := range [][]string{{"config"}, {"config", "apply"}, {"config", "show", "extra"}, {"config", "validate", "--reason", "not a mutation"}, {"config", "show", "--unknown"}} {
		out, code := cliProcess(t, args...)
		if code != 2 || !strings.Contains(out, "config help") || strings.Contains(out, "Cannot load") {
			t.Fatalf("bad configuration syntax: exit%d %s", code, out)
		}
	}
	if os.Getuid() != 0 {
		for _, args := range [][]string{{"config", "show", "--config", "/missing"}, {"config", "show", "--config", "help"}, {"config", "validate", "--config", "/missing"}} {
			out, code := cliProcess(t, args...)
			if code != 1 || !strings.Contains(out, "as root") || strings.Contains(out, "JSON rejected") {
				t.Fatal("nonroot observation reached files or misparsed help value", code, out)
			}
		}
	}
}

func TestConfigurationActualCompiledRootNamespaceWorkflow(t *testing.T) {
	if os.Getenv("EXAM_MANAGEMENT_USERNS") != "1" {
		t.Skip("requires isolated root-mapped CLI opt-in")
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
	privatePath, publicPath := filepath.Join(dir, "agent.key"), filepath.Join(dir, "gateway.pub")
	if os.WriteFile(privatePath, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: key}), 0600) != nil || os.WriteFile(publicPath, pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pub}), 0644) != nil {
		t.Fatal("synthetic keys unavailable")
	}
	config := core.Config{AgentID: "class", State: filepath.Join(dir, "unused-state"), Work: filepath.Join(dir, "unused-work"), Rootfs: "/", CallbackURL: "https://gateway.invalid", CallbackKey: privatePath, GatewayPublicKey: publicPath, Accounts: map[string]core.Account{"synthetic": {UID: 20001, GID: 20001, Home: "/home/synthetic", Shell: "/bin/bash"}}}
	raw, _ := json.Marshal(config)
	path := filepath.Join(dir, "candidate.json")
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	binary := filepath.Join(dir, "examctl")
	build := exec.Command("go", "build", "-o", binary, ".")
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatal("build actual CLI", err, string(output))
	}
	invoke := func(expected int, arguments ...string) core.ConfigurationObservation {
		t.Helper()
		command := exec.Command("/usr/bin/unshare", append([]string{"--user", "--map-root-user", binary, "--config", path, "config"}, arguments...)...)
		var stdout, stderr bytes.Buffer
		command.Stdout = &stdout
		command.Stderr = &stderr
		err := command.Run()
		code := 0
		if err != nil {
			if status, ok := err.(*exec.ExitError); ok {
				code = status.ExitCode()
			} else {
				t.Fatal(err)
			}
		}
		if code != expected || strings.Contains(stdout.String(), "PRIVATE KEY") {
			t.Fatal("actual CLI result", code, err, stdout.String(), stderr.String())
		}
		var result core.ConfigurationObservation
		if stdout.Len() > 0 && json.Unmarshal(stdout.Bytes(), &result) != nil {
			t.Fatal("non-JSON diagnostic", stdout.String())
		}
		return result
	}
	shown := invoke(0, "show")
	if !shown.StructuralValid || shown.KeyFilesChecked || shown.Validated || shown.Applied || shown.Configuration.CallbackKey == privatePath {
		t.Fatal("misleading/redaction-free show", shown)
	}
	checked := invoke(0, "validate", "--paths")
	if !checked.Validated || checked.Applied || !checked.KeyFilesChecked || checked.Configuration.CallbackKey != privatePath {
		t.Fatal("offline candidate check missing", checked)
	}
	for _, name := range []string{config.State, config.Work} {
		if _, err := os.Lstat(name); !os.IsNotExist(err) {
			t.Fatal("CLI initialized state/work", err)
		}
	}
	got, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(got, raw) {
		t.Fatal("CLI applied/rewrote candidate", err)
	}
	got, err = os.ReadFile(privatePath)
	if err != nil || !bytes.Equal(got, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: key})) {
		t.Fatal("CLI changed private key", err)
	}
	if err := os.Remove(privatePath); err != nil {
		t.Fatal(err)
	}
	invoke(0, "show") // Inspection still works when runtime credentials cannot load.
	invalid := invoke(1, "validate")
	if invalid.Validated || len(invalid.Issues) != 1 || invalid.Issues[0].Component != "callback_key" {
		t.Fatal("missing key looked valid", invalid)
	}
	if err := os.WriteFile(path, []byte(`{"password":"PRIVATE-UNKNOWN-CONFIG-VALUE"}`), 0600); err != nil {
		t.Fatal(err)
	}
	refused := invoke(1, "show")
	if refused.Version != 0 {
		t.Fatal("invalid JSON shape emitted a snapshot", refused)
	}
}
