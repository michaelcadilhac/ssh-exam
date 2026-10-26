package core

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestWatchHealthyCallbacksStayPromptAfterIdle(t *testing.T) {
	const childConfig = "EXAM_WATCH_CALLBACK_TEST_CONFIG"
	if configPath := os.Getenv(childConfig); configPath != "" {
		data, err := os.ReadFile(configPath)
		var config Config
		if err != nil || json.Unmarshal(data, &config) != nil {
			t.Fatal("private watcher fixture config unavailable", err)
		}
		engine, err := New(config)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(configPath+".ready", []byte("watch-entry"), 0600); err != nil {
			t.Fatal(err)
		}
		engine.Watch()
		return
	}
	pub, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	var received []int64
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(io.LimitReader(r.Body, 8192))
		signature, _ := base64.StdEncoding.DecodeString(r.Header.Get("X-Exam-Signature"))
		var event CallbackEvent
		if r.URL.Path != "/api/agent/events" || !ed25519.Verify(pub, body, signature) || json.Unmarshal(body, &event) != nil || event.Agent != "watch-test" {
			w.WriteHeader(403)
			return
		}
		mu.Lock()
		received = append(received, event.Sequence)
		mu.Unlock()
	}))
	defer server.Close()
	config := Config{State: nativeFixtureDir(t), Work: nativeFixtureDir(t), AgentID: "watch-test", CallbackURL: server.URL}
	config.CallbackKey = filepath.Join(t.TempDir(), "agent.key")
	encoded, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(config.CallbackKey, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: encoded}), 0600); err != nil {
		t.Fatal(err)
	}
	config.CallbackCA = filepath.Join(t.TempDir(), "ca.crt")
	if err := os.WriteFile(config.CallbackCA, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: server.Certificate().Raw}), 0600); err != nil {
		t.Fatal(err)
	}
	engine, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	if err := engine.WithState(func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	configPath := filepath.Join(t.TempDir(), "watch.json")
	data, _ := json.Marshal(config)
	if err := os.WriteFile(configPath, data, 0600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestWatchHealthyCallbacksStayPromptAfterIdle$", "-test.count=1")
	command.Env = append(os.Environ(), childConfig+"="+configPath)
	var output bytes.Buffer
	command.Stdout, command.Stderr = &output, &output
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	finished := make(chan struct{})
	var waitErr error
	go func() { waitErr = command.Wait(); close(finished) }()
	defer func() {
		cancel()
		select {
		case <-finished:
		case <-time.After(3 * time.Second):
			t.Error("owned callback watcher did not exit")
		}
	}()
	until := time.Now().Add(3 * time.Second)
	for {
		select {
		case <-finished:
			t.Fatalf("owned watcher exited before ready: %v; %s", waitErr, output.String())
		default:
		}
		if _, err := os.Stat(configPath + ".ready"); err == nil {
			break
		}
		if time.Now().After(until) {
			t.Fatal("actual Watch entry did not become ready")
		}
		time.Sleep(10 * time.Millisecond)
	}
	// Healthy EMPTY passes must not grow retry delay. After idle, both bounded
	// passes for21 events must stay prompt. No account/student exists here.
	select {
	case <-finished:
		t.Fatalf("owned watcher exited during idle: %v; %s", waitErr, output.String())
	case <-time.After(8200 * time.Millisecond):
	}
	if err := engine.WithState(func() error {
		for i := 0; i < 21; i++ {
			engine.state.Sequence++
			engine.state.Events = append(engine.state.Events, CallbackEvent{Agent: config.AgentID, Sequence: engine.state.Sequence, At: Millis(), Health: map[string]bool{"ready": true}})
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	until = time.Now().Add(4 * time.Second)
	for {
		select {
		case <-finished:
			t.Fatalf("owned watcher exited during delivery: %v; %s", waitErr, output.String())
		default:
		}
		mu.Lock()
		count := len(received)
		mu.Unlock()
		if count == 21 {
			break
		}
		if time.Now().After(until) {
			t.Fatalf("healthy signed callback batch stayed stale after idle: received %d/21; both bounded passes must finish within4s", count)
		}
		time.Sleep(20 * time.Millisecond)
	}
	mu.Lock()
	defer mu.Unlock()
	for i, sequence := range received {
		if sequence != int64(i+1) {
			t.Fatal("callback sequence reordered", received)
		}
	}
}

func TestEarlyCollectionDurableCallbacksWithoutGateway(t *testing.T) {
	e, _, source := finalFixture(t, "ACTIVE", Millis()+5400000)
	pub, key, _ := ed25519.GenerateKey(rand.Reader)
	b, _ := x509.MarshalPKCS8PrivateKey(key)
	keyPath := filepath.Join(t.TempDir(), "agent.key")
	os.WriteFile(keyPath, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: b}), 0600)
	var mu sync.Mutex
	available := false
	events := []CallbackEvent{}
	archives := 0
	calls := 0
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		calls++
		if !available {
			w.WriteHeader(503)
			return
		}
		body, _ := io.ReadAll(r.Body)
		payload := body
		if r.Header.Get("Content-Type") == "application/gzip" {
			payload, _ = base64.StdEncoding.DecodeString(r.Header.Get("X-Exam-Receipt"))
		}
		sig, _ := base64.StdEncoding.DecodeString(r.Header.Get("X-Exam-Signature"))
		if !ed25519.Verify(pub, payload, sig) {
			t.Error("callback signature failed")
			w.WriteHeader(403)
			return
		}
		if r.URL.Path == "/api/agent/events" {
			var event CallbackEvent
			json.Unmarshal(body, &event)
			events = append(events, event)
		} else {
			var receipt map[string]string
			json.Unmarshal(payload, &receipt)
			if Hash(body) != receipt["checksum"] {
				t.Error("archive checksum mismatch")
			}
			archives++
		}
	}))
	defer server.Close()
	ca := filepath.Join(t.TempDir(), "ca.crt")
	os.WriteFile(ca, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: server.Certificate().Raw}), 0600)
	e.Config.AgentID = "class"
	e.Config.CallbackURL = server.URL
	e.Config.CallbackCA = ca
	e.Config.CallbackKey = keyPath
	if _, err := e.Call("finalize-attempt", Request{ID: finalID, Reason: "student finish"}); err != nil {
		t.Fatal(err)
	}
	a := inspectFinal(t, e)
	if !a.Protected || a.State != "COMPLETED" {
		t.Fatal("outage prevented local collection")
	}
	if err := e.DeliverCallbacks(); err == nil {
		t.Fatal("failed callback acknowledged")
	}
	os.WriteFile(filepath.Join(source, "answer.txt"), []byte("later work"), 0600)
	paused := true
	if _, err := e.ExportDelivery(finalID, &paused, "Historical test archive retained on class server"); err != nil {
		t.Fatal(err)
	}
	audit, err := os.ReadFile(filepath.Join(e.Config.State, "audit.ndjson"))
	if err != nil || !strings.Contains(string(audit), "pause-archive-export") || !strings.Contains(string(audit), "Historical test archive retained on class server") {
		t.Fatal("archive pause was not audited", err)
	}
	restarted, _ := New(e.Config)
	restarted.terminate = func(*Attempt) error { return nil }
	mu.Lock()
	available = true
	mu.Unlock()
	if err := restarted.DeliverCallbacks(); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	if archives != 0 || len(events) == 0 {
		t.Fatal("paused archive should retain status callbacks without uploading")
	}
	mu.Unlock()
	status, err := restarted.ExportDelivery(finalID, nil, "")
	if err != nil || status.(map[string]any)["webserver_transfer_verified"] != false || status.(map[string]any)["export_paused_reason"] == "" {
		t.Fatal("restart lost explicit pause or falsely acknowledged a transfer", status, err)
	}
	paused = false
	if _, err := restarted.ExportDelivery(finalID, &paused, "Resume export after importing matching historical attempt"); err == nil {
		t.Fatal("disabled archive export was re-enabled")
	}
	// Even legacy unpaused state cannot cause an archive upload after upgrade.
	if err := restarted.WithState(func() error { delete(restarted.state.ExportPauses, finalID); return nil }); err != nil {
		t.Fatal(err)
	}
	if err := restarted.DeliverCallbacks(); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	if archives != 0 || len(events) == 0 {
		t.Fatal("protected archives must remain on the SSH server")
	}
	before := calls
	mu.Unlock()
	if err := restarted.DeliverCallbacks(); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	defer mu.Unlock()
	if calls != before {
		t.Fatal("idle agent made HTTP requests")
	}
	for _, event := range events {
		if event.Attempt != nil && (event.Attempt.Transport != "" || event.Attempt.Lease != 0) {
			t.Fatal("callback leaked admission state")
		}
	}
}

func TestExportPauseRequiresVerifiedCopyAndAudit(t *testing.T) {
	e, _, _ := finalFixture(t, "ACTIVE", Millis()+60000)
	paused := true
	if _, err := e.ExportDelivery(finalID, &paused, "Retain historical class-server archive"); err == nil {
		t.Fatal("unprotected archive pause accepted")
	}
	if _, err := e.Call("finalize-attempt", Request{ID: finalID, Reason: "student finish"}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.ExportDelivery(finalID, &paused, ""); err == nil {
		t.Fatal("pause without audit reason accepted")
	}
	if err := os.Remove(filepath.Join(e.Config.State, "audit.ndjson")); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(e.Config.State, "audit.ndjson"), 0700); err != nil {
		t.Fatal(err)
	}
	if _, err := e.ExportDelivery(finalID, &paused, "Retain historical class-server archive"); err == nil {
		t.Fatal("pause despite audit failure accepted")
	}
	status, err := e.ExportDelivery(finalID, nil, "")
	if err != nil || status.(map[string]any)["export_paused_reason"] != "" {
		t.Fatal("failed audit changed delivery state", status, err)
	}
}

func TestSSHManifestMatchesCallbackViewAndPreservesProtectedMetadata(t *testing.T) {
	e, c, _ := finalFixture(t, "ACTIVE", Millis()+5400000)
	if err := e.WithState(func() error {
		a := e.state.Attempts[finalID]
		a.Transport = "original-transport"
		a.ResumeTransport = "previous-transport"
		a.Units = []string{"exam-workload.scope"}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Call("finalize-attempt", Request{ID: finalID, Reason: "student finish"}); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(c.State, "submissions", finalID, "manifest.json")
	before, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := ReadProtected(filepath.Dir(file), inspectFinal(t, e))
	if err != nil {
		t.Fatal(err)
	}
	expected := *raw
	expected.Attempt = publicAttempt(raw.Attempt)
	view, err := e.Call("submission-manifest", Request{ID: finalID})
	if err != nil {
		t.Fatal(err)
	}
	want, _ := json.Marshal(expected)
	got, _ := json.Marshal(view)
	if string(want) != string(got) {
		t.Fatal("SSH manifest differs from callback public view")
	}
	after, err := os.ReadFile(file)
	if err != nil || string(before) != string(after) {
		t.Fatal("protected metadata changed")
	}
}
