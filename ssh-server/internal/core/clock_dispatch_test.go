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
	"testing"
)

func clockDispatchServer(t *testing.T, e *Engine, reply func(string, string) clockDispatchReply) {
	t.Helper()
	gateway := commandKeys(t, e)
	pub, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := x509.MarshalPKCS8PrivateKey(key)
	e.Config.CallbackKey = filepath.Join(t.TempDir(), "agent.key")
	if err := os.WriteFile(e.Config.CallbackKey, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: b}), 0600); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/agent/clock-changes" {
			t.Errorf("unexpected path %s", r.URL.Path)
			w.WriteHeader(404)
			return
		}
		payload, _ := io.ReadAll(r.Body)
		sig, _ := base64.StdEncoding.DecodeString(r.Header.Get("X-Exam-Signature"))
		if !ed25519.Verify(pub, payload, sig) {
			t.Error("native request was not authenticated")
			w.WriteHeader(403)
			return
		}
		var request struct {
			Agent string `json:"agent"`
			Nonce string `json:"nonce"`
			After string `json:"after"`
		}
		if json.Unmarshal(payload, &request) != nil || request.Agent != e.Config.AgentID {
			w.WriteHeader(403)
			return
		}
		body := reply(request.Nonce, request.After)
		payload, _ = json.Marshal(body)
		json.NewEncoder(w).Encode(SignedFrame{Payload: base64.StdEncoding.EncodeToString(payload), Signature: base64.StdEncoding.EncodeToString(ed25519.Sign(gateway, payload))})
	}))
	e.Config.CallbackURL = server.URL
	e.Config.CallbackCA = filepath.Join(t.TempDir(), "ca.crt")
	if err := os.WriteFile(e.Config.CallbackCA, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: server.Certificate().Raw}), 0600); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(server.Close)
}

func TestClockDispatchAppliesBeforeOldDeadlineWithoutStudentSSHAndSurvivesRetry(t *testing.T) {
	e, _, _ := finalFixture(t, "LOCKED", Millis()+300000)
	if err := e.WithState(func() error {
		a := e.state.Attempts[finalID]
		a.MonitoringMode, a.Transport, a.Boot = "v1", strings.Repeat("a", 64), boot()
		a.BrowserSSH, a.TerminalSupervised, a.Lease = true, true, 0
		a.Units = nil
		a.OriginalDeadline, a.OriginalUptimeDeadline = a.Deadline, a.UptimeDeadline
		a.RegisteredOwner = &monitoringOwner{Attempt: a.ID, Exam: a.Exam, Username: a.Username, UID: a.UID, TransportHash: a.Transport, Boot: a.Boot, PageEpoch: strings.Repeat("b", 64), InputEpoch: strings.Repeat("c", 64)}
		owner := *a.RegisteredOwner
		a.SSHExitedOwner = &owner
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	before := inspectFinal(t, e)
	r := resetRequest(before)
	r.RemainingSeconds, r.ExtendSeconds = 0, 1800
	clockDispatchServer(t, e, func(nonce, after string) clockDispatchReply {
		return clockDispatchReply{Type: "clock-changes/v1", Audience: e.Config.AgentID, Nonce: nonce, Expires: Millis() + operationTimeoutMS, Requests: []Request{r}}
	})
	for pass := 0; pass < 2; pass++ {
		if err := e.RefreshClockChanges(); err != nil {
			t.Fatal(err)
		}
		a := inspectFinal(t, e)
		if a.Deadline != before.Deadline+1800000 || a.OriginalDeadline != before.Deadline || a.Start != before.Start || a.ClockRevision != 1 || len(a.ClockResets) != 1 || a.State != "LOCKED" || a.AccessState != before.AccessState || a.Protected {
			t.Fatalf("delivery changed authority or duplicated an increase: %+v", a)
		}
		restarted, err := New(e.Config)
		if err != nil {
			t.Fatal(err)
		}
		e = restarted
	}
}

func TestClockDispatchRejectsScopeAndWholeMalformedBatchBeforeMutation(t *testing.T) {
	for _, mode := range []string{"nonce", "audience", "expired", "malformed-batch"} {
		t.Run(mode, func(t *testing.T) {
			e, _, _ := finalFixture(t, "LOCKED", Millis()+300000)
			before := inspectFinal(t, e)
			r := resetRequest(before)
			clockDispatchServer(t, e, func(nonce, after string) clockDispatchReply {
				reply := clockDispatchReply{Type: "clock-changes/v1", Audience: e.Config.AgentID, Nonce: nonce, Expires: Millis() + operationTimeoutMS, Requests: []Request{r}}
				switch mode {
				case "nonce":
					reply.Nonce = Token()
				case "audience":
					reply.Audience = "other"
				case "expired":
					reply.Expires = Millis() - 1
				case "malformed-batch":
					bad := r
					bad.ResetID = "bad"
					reply.Requests = append(reply.Requests, bad)
				}
				return reply
			})
			if e.RefreshClockChanges() == nil {
				t.Fatal("unsafe reply accepted")
			}
			a := inspectFinal(t, e)
			if a.Deadline != before.Deadline || a.ClockRevision != before.ClockRevision || len(a.ClockResets) != 0 {
				t.Fatal("refused batch mutated a clock")
			}
		})
	}
}
