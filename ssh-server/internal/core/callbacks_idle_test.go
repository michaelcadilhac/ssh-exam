package core

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"syscall"
	"testing"
	"time"
)

// The actual public callback entry scans a class-sized, fully acknowledged
// history. No account, live workload, student file or institutional service.
func idleCallbackFixture(t testing.TB, students, panes int, receive http.HandlerFunc) (*Engine, *atomic.Int64) {
	t.Helper()
	pub, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int64
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		sig, sigErr := base64.StdEncoding.DecodeString(r.Header.Get("X-Exam-Signature"))
		if err != nil || sigErr != nil || !ed25519.Verify(pub, body, sig) {
			t.Error("invalid signed callback")
			w.WriteHeader(403)
			return
		}
		calls.Add(1)
		r.Body = io.NopCloser(strings.NewReader(string(body)))
		if receive != nil {
			receive(w, r)
		}
	}))
	t.Cleanup(server.Close)
	dir := t.TempDir()
	config := Config{State: dir, Work: filepath.Join(dir, "work"), AgentID: "synthetic-idle", CallbackURL: server.URL,
		CallbackCA: filepath.Join(dir, "ca.pem"), CallbackKey: filepath.Join(dir, "key.pem")}
	encoded, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(config.CallbackKey, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: encoded}), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(config.CallbackCA, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: server.Certificate().Raw}), 0600); err != nil {
		t.Fatal(err)
	}
	e, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	if err := e.WithState(func() error {
		e.state.RecordingOffsets = map[string]int64{}
		for i := 0; i < students; i++ {
			id := fmt.Sprintf("%08x-1234-4234-8234-123456789abc", i+1)
			e.state.Attempts[id] = &Attempt{ID: id, Exam: "synthetic", Username: fmt.Sprintf("idle%d", i), UID: 60000 + i,
				State: "COMPLETED", Start: 1, Deadline: 2, OriginalDeadline: 2, Ended: Millis(), Protected: true,
				AccessState: "RELEASED", PolicyState: "NORMAL", Reason: strings.Repeat("synthetic history; ", 80)}
			root := filepath.Join(dir, "monitoring", id)
			if err := os.MkdirAll(root, 0700); err != nil {
				return err
			}
			for j := 0; j < panes; j++ {
				pane := fmt.Sprintf("%08x-1234-4234-8234-123456789abc", j+1)
				line := []byte("{\"event\":\"open\"}\n")
				if err := os.WriteFile(filepath.Join(root, pane+".ndjson"), line, 0600); err != nil {
					return err
				}
				e.state.RecordingOffsets[id+":"+pane] = int64(len(line))
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := e.WithState(func() error { e.state.Events = nil; return nil }); err != nil {
		t.Fatal(err)
	}
	return e, &calls
}

func TestIdleCallbackHistoryScanDoesNotRewriteAuthority(t *testing.T) {
	e, calls := idleCallbackFixture(t, 218, 4, nil)
	path := filepath.Join(e.Config.State, "state.json")
	before, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := e.DeliverCallbacks(); err != nil {
		t.Fatal(err)
	}
	after, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if !os.SameFile(before, after) || !before.ModTime().Equal(after.ModTime()) {
		t.Fatal("idle callback/recording scan rewrote authoritative state")
	}
	if calls.Load() != 0 {
		t.Fatal("acknowledged history made an HTTP request")
	}
}

func TestIdleReconciliationLookupsDoNotRewriteAuthority(t *testing.T) {
	for _, operation := range []string{"access", "recording-reports"} {
		t.Run(operation, func(t *testing.T) {
			e, _ := idleCallbackFixture(t, 218, 0, nil)
			path := filepath.Join(e.Config.State, "state.json")
			before, err := os.Stat(path)
			if err != nil {
				t.Fatal(err)
			}
			if operation == "access" {
				err = e.reconcileAccessOutside("")
			} else {
				err = e.reconcileTerminalRecordingReports()
			}
			if err != nil {
				t.Fatal(err)
			}
			after, err := os.Stat(path)
			if err != nil {
				t.Fatal(err)
			}
			if !os.SameFile(before, after) || !before.ModTime().Equal(after.ModTime()) {
				t.Fatal("read-only reconciliation lookup rewrote authoritative state")
			}
		})
	}
}

func TestIdleCallbackScanDoesNotWaitForCanonicalWriter(t *testing.T) {
	e, calls := idleCallbackFixture(t, 2, 4, nil)
	lock, err := os.OpenFile(filepath.Join(e.Config.State, "lock"), os.O_RDWR, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Close()
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- e.DeliverCallbacks() }()
	defer func() {
		_ = syscall.Flock(int(lock.Fd()), syscall.LOCK_UN)
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			t.Error("owned delivery did not stop after lock release")
		}
	}()
	select {
	case err := <-done:
		done <- err // Preserve completion for cleanup.
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("idle scan blocked behind canonical state writer")
	}
	if calls.Load() != 0 {
		t.Fatal("idle scan sent a callback")
	}
}

func TestCallbackScanRejectsMissingAndCorruptAuthority(t *testing.T) {
	for _, contents := range []string{"missing", "{", `{"attempts":{},"registrations":{}}`} {
		t.Run(contents, func(t *testing.T) {
			e, calls := idleCallbackFixture(t, 0, 0, nil)
			path := filepath.Join(e.Config.State, "state.json")
			if contents == "missing" {
				if err := os.Remove(path); err != nil {
					t.Fatal(err)
				}
			} else if err := os.WriteFile(path, []byte(contents), 0600); err != nil {
				t.Fatal(err)
			}
			if err := e.DeliverCallbacks(); err == nil {
				t.Fatal("invalid authority accepted")
			}
			if calls.Load() != 0 {
				t.Fatal("invalid authority sent an HTTP request")
			}
			if contents == "missing" {
				if _, err := os.Stat(path); !os.IsNotExist(err) {
					t.Fatal("missing authority recreated", err)
				}
			}
		})
	}
}

func TestRecordingDeliveryRetainsOffsetUntilSuccessfulAcknowledgement(t *testing.T) {
	var available atomic.Bool
	var receivedOffset atomic.Int64
	e, _ := idleCallbackFixture(t, 1, 1, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/agent/recordings" {
			t.Error("unexpected callback route")
			w.WriteHeader(400)
			return
		}
		var body struct {
			Offset int64  `json:"offset"`
			Data   string `json:"data"`
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil {
			t.Error("invalid recording callback")
			w.WriteHeader(400)
			return
		}
		receivedOffset.Store(body.Offset)
		if !available.Load() {
			w.WriteHeader(503)
		}
	})
	id, pane := "00000001-1234-4234-8234-123456789abc", "00000001-1234-4234-8234-123456789abc"
	path := filepath.Join(e.Config.State, "monitoring", id, pane+".ndjson")
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.WriteString("{\"event\":\"output\",\"data\":\"synthetic\"}\n"); err != nil {
		t.Fatal(err)
	}
	f.Close()
	before, err := readStateSnapshot(e.Config.State)
	if err != nil {
		t.Fatal(err)
	}
	offset := before.RecordingOffsets[id+":"+pane]
	if err := e.DeliverCallbacks(); err == nil {
		t.Fatal("failed recording acknowledged")
	}
	failed, err := readStateSnapshot(e.Config.State)
	if err != nil || failed.RecordingOffsets[id+":"+pane] != offset {
		t.Fatal("failure advanced recording offset", err)
	}
	available.Store(true)
	restarted, err := New(e.Config)
	if err != nil {
		t.Fatal(err)
	}
	if err := restarted.DeliverCallbacks(); err != nil {
		t.Fatal(err)
	}
	after, err := readStateSnapshot(e.Config.State)
	info, statErr := os.Stat(path)
	if err != nil || statErr != nil || receivedOffset.Load() != offset || after.RecordingOffsets[id+":"+pane] != info.Size() {
		t.Fatal("restart failed to retry exact durable offset", err, statErr)
	}
}

func TestRecordingDeliveryAcknowledgesOnlySentBytesDuringAppend(t *testing.T) {
	var path string
	var offsets []int64
	var first atomic.Bool
	const extra = "{\"event\":\"output\",\"data\":\"arrived while sending\"}\n"
	e, _ := idleCallbackFixture(t, 1, 1, func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Offset int64 `json:"offset"`
		}
		if r.URL.Path != "/api/agent/recordings" || json.NewDecoder(r.Body).Decode(&body) != nil {
			t.Error("invalid recording callback")
			w.WriteHeader(400)
			return
		}
		offsets = append(offsets, body.Offset)
		if first.CompareAndSwap(false, true) {
			f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0600)
			if err != nil {
				t.Error(err)
				w.WriteHeader(500)
				return
			}
			_, err = f.WriteString(extra)
			f.Close()
			if err != nil {
				t.Error(err)
				w.WriteHeader(500)
			}
		}
	})
	id := "00000001-1234-4234-8234-123456789abc"
	path = filepath.Join(e.Config.State, "monitoring", id, id+".ndjson")
	const pending = "{\"event\":\"output\",\"data\":\"already pending\"}\n"
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.WriteString(pending); err != nil {
		t.Fatal(err)
	}
	f.Close()
	before, err := readStateSnapshot(e.Config.State)
	if err != nil {
		t.Fatal(err)
	}
	original := before.RecordingOffsets[id+":"+id]
	if err := e.DeliverCallbacks(); err != nil {
		t.Fatal(err)
	}
	after, err := readStateSnapshot(e.Config.State)
	if err != nil || after.RecordingOffsets[id+":"+id] != original+int64(len(pending)) {
		t.Fatal("acknowledged bytes that were never sent", err)
	}
	if err := e.DeliverCallbacks(); err != nil {
		t.Fatal(err)
	}
	final, err := readStateSnapshot(e.Config.State)
	if err != nil || final.RecordingOffsets[id+":"+id] != original+int64(len(pending)+len(extra)) || len(offsets) != 2 || offsets[0] != original || offsets[1] != original+int64(len(pending)) {
		t.Fatal("concurrent append lost/replayed recording data", err, offsets)
	}
}

func BenchmarkIdleCallbackHistoryScan(b *testing.B) {
	e, _ := idleCallbackFixture(b, 218, 4, nil)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if err := e.DeliverCallbacks(); err != nil {
			b.Fatal(err)
		}
	}
}
