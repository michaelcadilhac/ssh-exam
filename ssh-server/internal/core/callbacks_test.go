package core

import (
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
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

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
