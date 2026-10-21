package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"examworkspace/agent/internal/core"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestWebCLIHelpAndSyntaxBeforeRootOrConfig(t *testing.T) {
	for _, args := range [][]string{{"help", "web"}, {"web", "help"}, {"web", "exams", "list", "--help"}, {"--config", "/missing", "web", "--help"}} {
		output, code := cliProcess(t, args...)
		for _, required := range []string{"Usage:", "managementOperations", "--request", "NEW ID", "root", "Exit status:"} {
			if code != 0 || !strings.Contains(output, required) {
				t.Fatalf("missing %q: %d %s", required, code, output)
			}
		}
	}
	for _, args := range [][]string{{"web"}, {"web", "unknown"}, {"web", "exams", "show"}, {"web", "exams", "list", "--limit", "201"}, {"web", "exams", "show", "midterm", "--after", "exam"}, {"web", "exams", "show", "midterm", "--request", "bad"}, {"web", "exams", "list", "EXTRA"}, {"web", "exams", "create", "exam"}, {"web", "exams", "update", "exam", "--revision", strings.Repeat("a", 64)}, {"web", "exams", "update", "exam", "--revision", "stale", "--name", "Exam"}, {"web", "exams", "update", "exam", "--revision", strings.Repeat("a", 64), "--earliest", "2026-10-22T09:00"}} {
		output, code := cliProcess(t, args...)
		if code != 2 || !strings.Contains(output, "web help") || strings.Contains(output, "Load root") {
			t.Fatalf("wrong syntax response: %d %s", code, output)
		}
	}
	if os.Getuid() != 0 {
		for _, args := range [][]string{{"web", "exams", "list", "--config", "/missing"}, {"web", "exams", "show", "help"}, {"web", "exams", "list", "--after", "help"}, {"--name", "help", "web", "exams", "update", "exam", "--revision", strings.Repeat("a", 64)}} {
			output, code := cliProcess(t, args...)
			if code != 1 || !strings.Contains(output, "root on the class server") {
				t.Fatal(code, output)
			}
		}
	}
}

func TestRosterCLIHelpAndRefusalsAreDiscoverable(t *testing.T) {
	for _, args := range [][]string{{"help", "students"}, {"web", "students", "help"}, {"web", "students", "add", "--help"}, {"--config", "/missing", "web", "students", "--help"}} {
		output, code := cliProcess(t, args...)
		for _, required := range []string{"Usage:", "import-preview", "import-confirm", "--confirm", "duration-minutes", "inherit", "UID", "historical", "Exit status:"} {
			if code != 0 || !strings.Contains(output, required) {
				t.Fatalf("missing %q: %d %s", required, code, output)
			}
		}
	}
	for _, args := range [][]string{{"web", "students"}, {"web", "students", "unknown", "exam"}, {"web", "students", "remove", "exam", "student"}, {"web", "students", "remove", "exam", "student", "--confirm", "other"}, {"web", "students", "settings", "exam", "student"}, {"web", "students", "add", "exam", "student", "--duration-minutes", "0"}, {"web", "students", "add", "exam", "student", "--webcam", "yes"}, {"web", "students", "import-preview", "exam"}, {"web", "students", "import-confirm", "exam", "not-uuid"}, {"web", "students", "export", "exam", "--webcam", "inherit"}} {
		output, code := cliProcess(t, args...)
		if code != 2 || !strings.Contains(output, "students help") || strings.Contains(output, "Load root") {
			t.Fatal("unactionable roster syntax", code, output)
		}
	}
	if os.Getuid() != 0 {
		for _, args := range [][]string{{"web", "students", "add", "exam", "help"}, {"web", "students", "import-preview", "exam", "--file", "help"}} {
			output, code := cliProcess(t, args...)
			if code != 1 || !strings.Contains(output, "root on the class server") {
				t.Fatal("value named help or nonroot path misparsed", code, output)
			}
		}
	}
}

func TestWebCLIRealHTTPSInRootUserNamespace(t *testing.T) {
	if os.Getenv("EXAM_MANAGEMENT_USERNS") != "1" {
		t.Skip("set EXAM_MANAGEMENT_USERNS=1 for actual root-mapped CLI HTTPS tests without host root")
	}
	agentPublic, agentPrivate, _ := ed25519.GenerateKey(rand.Reader)
	gatewayPublic, gatewayPrivate, _ := ed25519.GenerateKey(rand.Reader)
	dir := t.TempDir()
	writeKey := func(name string, private ed25519.PrivateKey, public ed25519.PublicKey) string {
		t.Helper()
		var b []byte
		var kind string
		if private != nil {
			b, _ = x509.MarshalPKCS8PrivateKey(private)
			kind = "PRIVATE KEY"
		} else {
			b, _ = x509.MarshalPKIXPublicKey(public)
			kind = "PUBLIC KEY"
		}
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, pem.EncodeToMemory(&pem.Block{Type: kind, Bytes: b}), 0600); err != nil {
			t.Fatal(err)
		}
		return p
	}
	keyPath := writeKey("agent.key", agentPrivate, nil)
	publicPath := writeKey("gateway.pub", nil, gatewayPublic)
	var calls atomic.Int64
	var mode atomic.Value
	mode.Store("ok")
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		calls.Add(1)
		b, err := io.ReadAll(req.Body)
		if err != nil {
			t.Error(err)
			w.WriteHeader(500)
			return
		}
		sig, _ := base64.StdEncoding.DecodeString(req.Header.Get("X-Exam-Signature"))
		if !ed25519.Verify(agentPublic, b, sig) || req.URL.Path != "/api/agent/management" || req.Header.Get("Content-Type") != "application/vnd.ssh-exam-management" {
			t.Error("CLI request authentication/route failed")
			w.WriteHeader(403)
			return
		}
		var r map[string]any
		if json.Unmarshal(b, &r) != nil || r["purpose"] != "ssh-exam-management/v1" || r["actor"] != "agent-root" || r["agent"] != "class" || r["operation"] != "exams.show" {
			t.Error("CLI request scope failed")
			w.WriteHeader(403)
			return
		}
		switch mode.Load().(string) {
		case "redirect":
			w.Header().Set("Location", "/elsewhere")
			w.WriteHeader(307)
			return
		case "oversized":
			_, _ = w.Write(make([]byte, 16*1024*1024+1))
			return
		}
		reply := map[string]any{"version": 1, "purpose": "ssh-exam-management/v1", "audience": "class", "request": r["request"], "nonce": r["nonce"], "operation": r["operation"], "at": time.Now().UnixMilli(), "ok": true, "status": 200, "result": map[string]any{"exam": map[string]any{"id": "midterm"}, "revision": strings.Repeat("a", 64)}}
		switch mode.Load().(string) {
		case "scope":
			reply["audience"] = "elsewhere"
		case "nonce":
			reply["nonce"] = strings.Repeat("0", 64)
		case "refusal":
			reply["ok"], reply["status"], reply["error"] = false, 403, "managementOperations does not authorize exams.show"
		}
		payload, _ := json.Marshal(reply)
		key := gatewayPrivate
		if mode.Load().(string) == "bad-signature" {
			key = agentPrivate
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"payload": base64.StdEncoding.EncodeToString(payload), "signature": base64.StdEncoding.EncodeToString(ed25519.Sign(key, payload))})
	}))
	defer server.Close()
	ca := filepath.Join(dir, "ca.crt")
	if err := os.WriteFile(ca, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: server.Certificate().Raw}), 0600); err != nil {
		t.Fatal(err)
	}
	config := core.Config{State: filepath.Join(dir, "unused-native-state"), Work: filepath.Join(dir, "unused-work"), Rootfs: dir, AgentID: "class", CallbackKey: keyPath, GatewayPublicKey: publicPath, CallbackURL: server.URL, CallbackCA: ca, Accounts: map[string]core.Account{"synthetic": {UID: 29999, GID: 29999, Home: dir, Shell: "/bin/bash"}}}
	configPath := filepath.Join(dir, "config.json")
	b, _ := json.Marshal(config)
	if err := os.WriteFile(configPath, b, 0600); err != nil {
		t.Fatal(err)
	}
	invoke := func() (string, int) {
		t.Helper()
		args := []string{"--user", "--map-root-user", os.Args[0], "-test.run=^TestCLIEntry$", "--", "--config", configPath, "web", "exams", "show", "midterm", "--request", "12345678-1234-4234-8234-123456789abc"}
		command := exec.Command("/usr/bin/unshare", args...)
		command.Env = append(os.Environ(), "EXAMCTL_TEST_ENTRY=1", "GORACE=atexit_sleep_ms=0")
		out, err := command.CombinedOutput()
		if err == nil {
			return string(out), 0
		}
		if status, ok := err.(*exec.ExitError); ok {
			return string(out), status.ExitCode()
		}
		t.Fatal(err)
		return "", -1
	}
	for _, scenario := range []string{"ok", "scope", "nonce", "refusal", "bad-signature", "redirect", "oversized"} {
		t.Run(scenario, func(t *testing.T) {
			mode.Store(scenario)
			before := calls.Load()
			output, code := invoke()
			if calls.Load() != before+1 {
				t.Fatal("CLI bypassed HTTPS or followed a redirect", output)
			}
			if scenario == "ok" {
				if code != 0 || !strings.Contains(output, `"confirmed":true`) || !strings.Contains(output, `"id":"midterm"`) {
					t.Fatal(code, output)
				}
			} else if code != 1 || strings.Contains(output, `"confirmed":true`) || !strings.Contains(output, "--request") {
				t.Fatal("unverified/refused reply was not actionable", code, output)
			}
			if strings.Contains(output, "PRIVATE KEY") {
				t.Fatal("private key leaked")
			}
		})
	}
	if _, err := os.Stat(config.State); !os.IsNotExist(err) {
		t.Fatal("web inspection mutated native state", err)
	}
}
