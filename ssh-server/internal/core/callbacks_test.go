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
	"sync"
	"testing"
)

func TestDeadlineCollectionDurableCallbacksWithoutGateway(t *testing.T) {
	e, _, source := finalFixture(t, "LOCKED", Millis()-1000)
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
	if err := e.Tick(); err != nil {
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
	restarted, _ := New(e.Config)
	restarted.terminate = func(*Attempt) error { return nil }
	mu.Lock()
	available = true
	mu.Unlock()
	if err := restarted.DeliverCallbacks(); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	if archives != 1 || len(events) == 0 {
		t.Fatal("restart lost pending receipt or transfer")
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
