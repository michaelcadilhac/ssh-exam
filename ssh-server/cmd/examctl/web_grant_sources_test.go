package main

import (
	"bytes"
	"context"
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
	"syscall"
	"testing"
	"time"
)

func TestSavedSourceSynchronizationCLIUsesDurableNativePinBeforeSignedAcknowledgement(t *testing.T) {
	if os.Getenv("EXAM_MANAGEMENT_USERNS") != "1" {
		t.Skip("requires explicit isolated root-mapped CLI/TLS qualification")
	}
	dir := t.TempDir()
	agentPub, agentKey, _ := ed25519.GenerateKey(rand.Reader)
	gatewayPub, gatewayKey, _ := ed25519.GenerateKey(rand.Reader)
	write := func(path string, v any) {
		t.Helper()
		data, err := json.Marshal(v)
		if err == nil {
			err = os.WriteFile(path, data, 0600)
		}
		if err != nil {
			t.Fatal(err)
		}
	}
	keyFile := filepath.Join(dir, "agent.key")
	gatewayFile := filepath.Join(dir, "gateway.pub")
	private, _ := x509.MarshalPKCS8PrivateKey(agentKey)
	public, _ := x509.MarshalPKIXPublicKey(gatewayPub)
	if err := os.WriteFile(keyFile, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: private}), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(gatewayFile, pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: public}), 0600); err != nil {
		t.Fatal(err)
	}
	c := core.Config{State: filepath.Join(dir, "state"), Work: filepath.Join(dir, "work"), Rootfs: dir, Templates: dir, AgentID: "class", CallbackKey: keyFile, GatewayPublicKey: gatewayFile, Accounts: map[string]core.Account{"student": {UID: 29999, GID: 29999, Home: dir, Shell: "/bin/bash"}}}
	for _, path := range []string{c.State, c.Work, filepath.Join(c.State, "submissions"), filepath.Join(dir, "synthetic-source")} {
		if err := os.MkdirAll(path, 0700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "synthetic-source", "answer.txt"), []byte("verified saved synthetic work\n"), 0600); err != nil {
		t.Fatal(err)
	}
	const sourceID = "11111111-1234-4234-8234-123456789abc"
	const grantID = "44444444-1234-4234-8234-123456789abc"
	source := &core.Attempt{ID: sourceID, Exam: "original", Username: "student", UID: 29999, State: "COMPLETED", Settings: core.Settings{ID: "original", Duration: 3600}, Start: core.Millis() - 7200000, Deadline: core.Millis() - 3600000, OriginalDeadline: core.Millis() - 3600000, AccessState: "RELEASED", PolicyState: "NORMAL"}
	source.OriginalDeadline = source.Deadline
	checksum, err := core.Collect(filepath.Join(dir, "synthetic-source"), filepath.Join(c.State, "submissions", sourceID), source)
	if err != nil {
		t.Fatal(err)
	}
	source.Checksum, source.Protected = checksum, true
	state := core.State{Attempts: map[string]*core.Attempt{sourceID: source}, Caps: map[string]core.Capability{}, Registrations: map[string]string{}}
	statePath := filepath.Join(c.State, "state.json")
	write(statePath, state)
	settings := core.Settings{ID: "retake", Name: "Synthetic saved-work grant", Duration: 5400, Webcam: true, Terminals: 4, Template: "v1", TemplateVersion: strings.Repeat("a", 64), Earliest: core.Millis() - 1000, Latest: core.Millis() + 600000}
	plan := core.SourceRetentionPlan{Version: 1, Agent: "class", Grant: &core.GrantBinding{ID: grantID, Revision: 1, Hash: strings.Repeat("c", 64), Kind: "ADDITIONAL", Order: 2, Work: &core.GrantWork{Kind: "saved", Attempt: sourceID, Checksum: checksum}}, Exam: settings.ID, Username: "student", UID: 29999, Settings: settings, Source: core.SourceRetentionSource{Attempt: sourceID, Checksum: checksum}, Action: "retain", CurrentRevision: 1, Status: "PENDING_NATIVE"}
	var acknowledgements atomic.Int32
	var plans atomic.Int32
	var status atomic.Value
	status.Store("PENDING_NATIVE")
	var lose atomic.Bool
	lose.Store(true)
	var wrongUID atomic.Bool
	pinPath := filepath.Join(c.State, "source-retentions", grantID+"-1.json")
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, err := io.ReadAll(io.LimitReader(r.Body, 65537))
		if err != nil {
			t.Error(err)
			http.Error(w, "read", 400)
			return
		}
		signature, err := base64.StdEncoding.DecodeString(r.Header.Get("X-Exam-Signature"))
		if err != nil || !ed25519.Verify(agentPub, data, signature) {
			t.Error("actual CLI request signature invalid")
			http.Error(w, "signature", 403)
			return
		}
		var request struct {
			Request   string          `json:"request"`
			Nonce     string          `json:"nonce"`
			Operation string          `json:"operation"`
			Body      json.RawMessage `json:"body"`
		}
		if json.Unmarshal(data, &request) != nil || r.URL.Path != "/api/agent/management" {
			t.Error("wrong actual management route/body")
			http.Error(w, "scope", 400)
			return
		}
		var result any
		switch request.Operation {
		case "grants.source-plan":
			plans.Add(1)
			current := plan
			current.Status = status.Load().(string)
			if current.Status == "REVOKED" {
				current.Action = "release"
			}
			if wrongUID.Load() {
				current.UID++
			}
			result = current
		case "grants.source-confirm":
			acknowledgements.Add(1)
			var receipt struct {
				ID            string `json:"id"`
				Revision      int64  `json:"revision"`
				State         string `json:"state"`
				RetentionHash string `json:"retention_hash"`
				RetainedAt    int64  `json:"retained_at"`
			}
			var pin core.GrantSourceRetention
			stored, readErr := os.ReadFile(pinPath)
			if json.Unmarshal(request.Body, &receipt) != nil || readErr != nil || json.Unmarshal(stored, &pin) != nil || pin.RetentionHash != receipt.RetentionHash || pin.RetainedAt != receipt.RetainedAt || (receipt.State == "RETAINED" && pin.Phase != "retained") || (receipt.State == "RELEASED" && pin.Phase != "released") {
				t.Error("ack preceded exact durable native retention")
				http.Error(w, "not durable", 400)
				return
			}
			if lose.Swap(false) {
				http.Error(w, "synthetic lost gateway acknowledgement after native fsync", 503)
				return
			}
			if receipt.State == "RETAINED" {
				status.Store("AVAILABLE")
			}
			result = map[string]any{"id": grantID, "revision": 1, "state": receipt.State, "retention_hash": receipt.RetentionHash, "status": status.Load().(string)}
		default:
			t.Error("unexpected management operation", request.Operation)
			http.Error(w, "operation", 400)
			return
		}
		payload, _ := json.Marshal(map[string]any{"version": 1, "purpose": "ssh-exam-management/v1", "audience": "class", "request": request.Request, "nonce": request.Nonce, "operation": request.Operation, "at": core.Millis(), "ok": true, "status": 200, "result": result})
		_ = json.NewEncoder(w).Encode(core.SignedFrame{Payload: base64.StdEncoding.EncodeToString(payload), Signature: base64.StdEncoding.EncodeToString(ed25519.Sign(gatewayKey, payload))})
	}))
	defer server.Close()
	c.CallbackURL = server.URL
	c.CallbackCA = filepath.Join(dir, "gateway-ca.pem")
	if err := os.WriteFile(c.CallbackCA, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: server.Certificate().Raw}), 0600); err != nil {
		t.Fatal(err)
	}
	configPath := filepath.Join(dir, "config.json")
	write(configPath, c)
	before, _ := os.ReadFile(statePath)
	invoke := func(op string) (string, int) {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		args := []string{"--user", "--map-root-user", os.Args[0], "-test.run=^TestCLIEntry$", "--", "--config", configPath, "web", "grants", op, grantID, "--revision", "1"}
		if op == "source-sync" {
			args = append(args, "--request", "88888888-1234-4234-8234-123456789abc")
		}
		command := exec.CommandContext(ctx, "/usr/bin/unshare", args...)
		command.Env = append(os.Environ(), "EXAMCTL_TEST_ENTRY=1", "GORACE=atexit_sleep_ms=0")
		out, err := command.CombinedOutput()
		if ctx.Err() != nil {
			t.Fatal("bounded CLI protocol did not finish", ctx.Err(), string(out))
		}
		if err == nil {
			return string(out), 0
		}
		if exit, ok := err.(*exec.ExitError); ok {
			return string(out), exit.ExitCode()
		}
		t.Fatal(err)
		return "", -1
	}
	archive := filepath.Join(c.State, "submissions", sourceID, "submission.tar.gz")
	good, _ := os.ReadFile(archive)
	bad := append(append([]byte(nil), good...), byte(0))
	if err := os.WriteFile(archive, bad, 0600); err != nil {
		t.Fatal(err)
	}
	if out, code := invoke("source-sync"); code != 1 || !strings.Contains(out, "protected source verification") || acknowledgements.Load() != 0 {
		t.Fatal("bad archive reached ack or wrong refusal stage", code, out, acknowledgements.Load())
	}
	if err := os.WriteFile(archive, good, 0600); err != nil {
		t.Fatal(err)
	}
	// Deletion and retention must serialize on the SAME private catalog inode,
	// across the real root-mapped CLI process and signed outbound plan exchange.
	lock, err := os.OpenFile(filepath.Join(c.State, "collection-locks", "recovery-catalog"), os.O_RDWR|syscall.O_NOFOLLOW, 0)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = lock.Close() })
	info, err := lock.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || info.Sys().(*syscall.Stat_t).Uid != uint32(os.Getuid()) || info.Sys().(*syscall.Stat_t).Nlink != 1 {
		t.Fatal("catalog contention fixture is not the private owned regular lock", info, err)
	}
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		t.Fatal(err)
	}
	planned := plans.Load()
	if out, code := invoke("source-sync"); code != 1 || !strings.Contains(out, "catalog is changing") || plans.Load() != planned+1 || acknowledgements.Load() != 0 {
		t.Fatal("CLI did not refuse at the held catalog after its actual signed plan", code, out, plans.Load(), acknowledgements.Load())
	}
	if _, err := os.Stat(pinPath); !os.IsNotExist(err) {
		t.Fatal("catalog contention published a native retention pin", err)
	}
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_UN); err != nil {
		t.Fatal(err)
	}
	if err := lock.Close(); err != nil {
		t.Fatal(err)
	}
	out, code := invoke("source-sync")
	if code != 1 || !strings.Contains(out, "native source is retained") || acknowledgements.Load() != 1 {
		t.Fatal("lost reply did not preserve inspectable native pin", code, out)
	}
	stored, _ := os.ReadFile(pinPath)
	out, code = invoke("source-show")
	var first core.GrantSourceRetention
	if code != 0 || json.Unmarshal([]byte(out), &first) != nil || first.Phase != "retained" || first.Plan.Settings.Duration != 5400 || len(first.Consumers) != 0 {
		t.Fatal("actual CLI inspection lost fixed unconsumed source", code, out)
	}
	out, code = invoke("source-sync")
	if code != 0 || acknowledgements.Load() != 2 {
		t.Fatal("same source/revision retry failed", code, out)
	}
	retried, _ := os.ReadFile(pinPath)
	if !bytes.Equal(stored, retried) {
		t.Fatal("lost-reply retry replaced native source identity")
	}
	wrongUID.Store(true)
	out, code = invoke("source-sync")
	wrongUID.Store(false)
	if code != 1 || acknowledgements.Load() != 2 {
		t.Fatal("wrong signed source UID acknowledged", code, out)
	}
	status.Store("REVOKED")
	out, code = invoke("source-sync")
	if code != 0 {
		t.Fatal("explicit unused revocation did not release source", code, out)
	}
	out, code = invoke("source-show")
	var released core.GrantSourceRetention
	if code != 0 || json.Unmarshal([]byte(out), &released) != nil || released.Phase != "released" || released.RetentionHash != first.RetentionHash {
		t.Fatal("release lost retained identity", code, out)
	}
	after, _ := os.ReadFile(statePath)
	if !bytes.Equal(before, after) {
		t.Fatal("source synchronization rewrote native attempts or consumed time")
	}
	after, _ = os.ReadFile(archive)
	if !bytes.Equal(good, after) {
		t.Fatal("source synchronization changed protected archive")
	}
}
