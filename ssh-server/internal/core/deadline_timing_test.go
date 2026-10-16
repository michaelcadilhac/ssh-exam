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
	"sync/atomic"
	"testing"
	"time"
)

func timingServer(t *testing.T, e *Engine, reply func(*Attempt, string) (timingReply, int)) *httptest.Server {
	t.Helper()
	gateway := commandKeys(t, e)
	pub, key, _ := ed25519.GenerateKey(rand.Reader)
	b, _ := x509.MarshalPKCS8PrivateKey(key)
	e.Config.CallbackKey = filepath.Join(t.TempDir(), "agent.key")
	os.WriteFile(e.Config.CallbackKey, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: b}), 0600)
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/agent/timing" {
			t.Error("unexpected request", r.URL.Path)
			w.WriteHeader(404)
			return
		}
		payload, _ := io.ReadAll(r.Body)
		sig, _ := base64.StdEncoding.DecodeString(r.Header.Get("X-Exam-Signature"))
		if !ed25519.Verify(pub, payload, sig) {
			t.Error("request was not authenticated")
			w.WriteHeader(403)
			return
		}
		var request struct {
			Attempt *Attempt `json:"attempt"`
			Nonce   string   `json:"nonce"`
		}
		json.Unmarshal(payload, &request)
		body, status := reply(request.Attempt, request.Nonce)
		if status != 200 {
			w.WriteHeader(status)
			return
		}
		payload, _ = json.Marshal(body)
		signature := ed25519.Sign(gateway, payload)
		if body.Type == "tampered-signature" {
			signature[0] ^= 1
		}
		json.NewEncoder(w).Encode(SignedFrame{Payload: base64.StdEncoding.EncodeToString(payload), Signature: base64.StdEncoding.EncodeToString(signature)})
	}))
	e.Config.CallbackURL = server.URL
	e.Config.CallbackCA = filepath.Join(t.TempDir(), "ca.crt")
	os.WriteFile(e.Config.CallbackCA, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: server.Certificate().Raw}), 0600)
	t.Cleanup(server.Close)
	return server
}
func timingDecision(a *Attempt, nonce string) timingReply {
	return timingReply{Type: "deadline-timing", Audience: "class", ID: a.ID, Nonce: nonce, Expires: Millis() + 30000, Deadline: a.Deadline, ClockRevision: a.ClockRevision, Collect: true}
}
func TestTimingOutageFreezesAndDefersCollectionAcrossRestart(t *testing.T) {
	e, _, _ := finalFixture(t, "ACTIVE", Millis()-1000)
	var available atomic.Bool
	timingServer(t, e, func(a *Attempt, nonce string) (timingReply, int) {
		if !available.Load() {
			return timingReply{}, 503
		}
		return timingDecision(a, nonce), 200
	})
	freezes := 0
	e.quiesce = func(*Attempt) error { freezes++; return nil }
	e.RefreshExpiredTiming()
	if err := e.Tick(); err != nil {
		t.Fatal(err)
	}
	a := inspectFinal(t, e)
	if freezes == 0 || a.Protected || a.TimingPendingSince == 0 || a.State != "LOCKED" || a.AccessState != "HELD" {
		t.Fatalf("outage did not safely defer collection: %+v", a)
	}
	restarted, _ := New(e.Config)
	restarted.quiesce = func(*Attempt) error { return nil }
	restarted.terminate = func(*Attempt) error { return nil }
	restarted.WithState(func() error { restarted.state.Attempts[finalID].TimingNextCheck = 0; return nil })
	available.Store(true)
	restarted.RefreshExpiredTiming()
	if err := restarted.Tick(); err != nil {
		t.Fatal(err)
	}
	a = inspectFinal(t, restarted)
	if !a.Protected || a.State != "COMPLETED" || a.TimingVerifiedAt < a.Deadline {
		t.Fatal("restart failed to verify then collect")
	}
}
func TestDisconnectedResetIsCheckedBeforeOldDeadlineCollection(t *testing.T) {
	e, _, _ := finalFixture(t, "LOCKED", Millis()-1000)
	original := inspectFinal(t, e).Deadline
	timingServer(t, e, func(a *Attempt, nonce string) (timingReply, int) {
		reply := timingDecision(a, nonce)
		r := resetRequest(a)
		r.RequestedAt = a.Deadline - 1000
		r.RemainingSeconds = 60
		reply.Reset = &r
		reply.Collect = false
		return reply, 200
	})
	e.RefreshExpiredTiming()
	if err := e.Tick(); err != nil {
		t.Fatal(err)
	}
	a := inspectFinal(t, e)
	if a.ClockRevision != 1 || a.Deadline <= Millis() || a.OriginalDeadline != original || a.State != "LOCKED" || a.Protected {
		t.Fatalf("offline reset was lost or resumed without authorization: %+v", a)
	}
	var calls atomic.Int32
	timingServer(t, e, func(a *Attempt, nonce string) (timingReply, int) { calls.Add(1); return timingDecision(a, nonce), 200 })
	e.RefreshExpiredTiming()
	if err := e.Tick(); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 0 {
		t.Fatal("future deadline caused idle polling")
	}
}
func TestTimingReplyCannotBeForgedReplayedOrMisScoped(t *testing.T) {
	for _, mode := range []string{"signature", "nonce", "attempt", "audience", "expired", "deadline", "revision"} {
		t.Run(mode, func(t *testing.T) {
			e, _, _ := finalFixture(t, "LOCKED", Millis()-1000)
			timingServer(t, e, func(a *Attempt, nonce string) (timingReply, int) {
				r := timingDecision(a, nonce)
				switch mode {
				case "signature":
					r.Type = "tampered-signature"
				case "nonce":
					r.Nonce = "old-nonce"
				case "attempt":
					r.ID = "wrong"
				case "audience":
					r.Audience = "other"
				case "expired":
					r.Expires = Millis() - 1
				case "deadline":
					r.Deadline++
				case "revision":
					r.ClockRevision++
				}
				return r, 200
			})
			e.RefreshExpiredTiming()
			e.Tick()
			a := inspectFinal(t, e)
			if a.Protected || a.TimingVerifiedAt != 0 {
				t.Fatal("untrusted decision allowed collection")
			}
		})
	}
}
func TestVerifiedTimingSurvivesRestartAndLaterOutage(t *testing.T) {
	e, _, _ := finalFixture(t, "LOCKED", Millis()-1000)
	server := timingServer(t, e, func(a *Attempt, nonce string) (timingReply, int) { return timingDecision(a, nonce), 200 })
	if err := e.RefreshExpiredTiming(); err != nil {
		t.Fatal(err)
	}
	server.Close()
	restarted, _ := New(e.Config)
	restarted.quiesce = func(*Attempt) error { return nil }
	restarted.terminate = func(*Attempt) error { return nil }
	restarted.RefreshExpiredTiming()
	if err := restarted.Tick(); err != nil {
		t.Fatal(err)
	}
	if !inspectFinal(t, restarted).Protected {
		t.Fatal("lost durable collection authorization")
	}
}

func TestSlowTimingCheckDoesNotDelayOtherExecutionLeases(t *testing.T) {
	e, _, _ := finalFixture(t, "LOCKED", Millis()-1000)
	entered, release := make(chan struct{}), make(chan struct{})
	timingServer(t, e, func(a *Attempt, nonce string) (timingReply, int) {
		close(entered)
		<-release
		return timingDecision(a, nonce), 200
	})
	otherID := "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
	e.WithState(func() error {
		e.state.Attempts[otherID] = &Attempt{ID: otherID, Username: "other", UID: 1002, State: "ACTIVE", Start: Millis() - 1000, Deadline: Millis() + 60000, UptimeDeadline: uptime() + 60, Boot: boot(), Lease: Millis() - 1}
		return nil
	})
	done := make(chan error, 1)
	go func() { done <- e.RefreshExpiredTiming() }()
	<-entered
	started := time.Now()
	if err := e.Tick(); err != nil {
		close(release)
		t.Fatal(err)
	}
	took := time.Since(started)
	locked := false
	e.WithState(func() error { locked = e.state.Attempts[otherID].State == "LOCKED"; return nil })
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if !locked || took > time.Second {
		t.Fatal("outbound timing check delayed lease enforcement")
	}
}
