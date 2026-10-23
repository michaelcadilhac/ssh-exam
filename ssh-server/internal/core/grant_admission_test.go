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
	"sync/atomic"
	"testing"
	"time"
)

func initialGrantUnpreparedFixture(t *testing.T, configure ...func(*Settings)) (*Engine, ed25519.PrivateKey, Request) {
	t.Helper()
	e, _, key := boundTemplateFixture(t)
	var settings Settings
	if err := e.WithState(func() error {
		settings = e.state.Attempts[finalID].Settings
		delete(e.state.Attempts, finalID)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	for _, change := range configure {
		change(&settings)
	}
	r := Request{ID: "22222222-1234-4234-8234-123456789abc", Exam: "exam", Username: "student", UID: os.Getuid(), Transport: "ssh-a", Settings: settings, Grant: &GrantBinding{ID: "33333333-1234-4234-8234-123456789abc", Revision: 1, Hash: strings.Repeat("a", 64)}}
	e.preparationReady = func() (bool, []string) { return true, nil }
	e.preparationHome = func(*Attempt) error { return nil }
	return e, key, r
}

func initialGrantFixture(t *testing.T, configure ...func(*Settings)) (*Engine, ed25519.PrivateKey, Request) {
	t.Helper()
	e, key, r := initialGrantUnpreparedFixture(t, configure...)
	cmd := preparationCommand(r)
	cmd.Op = "prepare-grant-attempt"
	if _, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport); err != nil {
		t.Fatal("grant-aware signed preparation", err)
	}
	cmd.Op, cmd.Nonce = "prepare-workspace", Token()
	if _, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport); err != nil {
		t.Fatal("real exact private workspace staging", err)
	}
	a := assertUnstartedWorkspace(t, e, r.ID)
	if a.Workspace == nil || !sameGrant(a.Grant, r.Grant) || !sameGrant(a.Workspace.Grant, r.Grant) || a.Workspace.Source.Version != r.Settings.TemplateVersion {
		t.Fatal("stage lost immutable grant/source", a.Workspace)
	}
	return e, key, r
}

func initialGrantServer(t *testing.T, e *Engine, gateway ed25519.PrivateKey, handler func(grantBeginReply) (grantBeginReply, int)) *httptest.Server {
	t.Helper()
	pub, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	b, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	e.Config.CallbackKey = filepath.Join(t.TempDir(), "agent.key")
	if err := os.WriteFile(e.Config.CallbackKey, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: b}), 0600); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/agent/grant-begin" || r.Method != "POST" {
			t.Error("unexpected grant verification route")
			w.WriteHeader(404)
			return
		}
		payload, err := io.ReadAll(io.LimitReader(r.Body, 32769))
		if err != nil || len(payload) > 32768 {
			t.Error("bad bounded request")
			w.WriteHeader(400)
			return
		}
		sig, _ := base64.StdEncoding.DecodeString(r.Header.Get("X-Exam-Signature"))
		if !ed25519.Verify(pub, payload, sig) {
			t.Error("native request not authenticated")
			w.WriteHeader(403)
			return
		}
		var request struct {
			Type      string        `json:"type"`
			Agent     string        `json:"agent"`
			Nonce     string        `json:"nonce"`
			Attempt   string        `json:"attempt"`
			Grant     *GrantBinding `json:"grant"`
			Intent    string        `json:"intent"`
			Transport string        `json:"transport"`
			Boot      string        `json:"boot"`
			Settings  Settings      `json:"settings"`
		}
		if json.Unmarshal(payload, &request) != nil || request.Type != "grant-begin/v1" || request.Agent != "class" || request.Settings.TemplateVersion == "" {
			t.Error("wrong fresh verification scope/source")
			w.WriteHeader(400)
			return
		}
		reply, status := handler(grantBeginReply{Type: "grant-begin/v1", Audience: request.Agent, Nonce: request.Nonce, Expires: Millis() + 30000, Attempt: request.Attempt, Grant: request.Grant, Intent: request.Intent, Transport: request.Transport, Boot: request.Boot})
		if status != 200 {
			w.WriteHeader(status)
			return
		}
		signed, err := json.Marshal(reply)
		if err != nil {
			t.Error(err)
			return
		}
		signature := ed25519.Sign(gateway, signed)
		if reply.Type == "bad-signature" {
			signature[0] ^= 1
		}
		json.NewEncoder(w).Encode(SignedFrame{Payload: base64.StdEncoding.EncodeToString(signed), Signature: base64.StdEncoding.EncodeToString(signature)})
	}))
	e.Config.CallbackURL = server.URL
	e.Config.CallbackCA = filepath.Join(t.TempDir(), "ca.crt")
	if err := os.WriteFile(e.Config.CallbackCA, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: server.Certificate().Raw}), 0600); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(server.Close)
	return server
}

func TestInitialGrantSignedStageFreshTLSBeginAndRestart(t *testing.T) {
	e, key, r := initialGrantFixture(t)
	var available atomic.Bool
	var calls atomic.Int32
	entered, release := make(chan struct{}), make(chan struct{})
	released := false
	defer func() {
		if !released {
			close(release)
		}
	}()
	initialGrantServer(t, e, key, func(reply grantBeginReply) (grantBeginReply, int) {
		calls.Add(1)
		if !available.Load() {
			return reply, 503
		}
		close(entered)
		<-release
		return reply, 200
	})
	r.GrantBeginIntent = "44444444-1234-4234-8234-123456789abc"
	cmd := preparationCommand(r)
	cmd.Op = "activate-versioned-attempt"
	if _, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport); err == nil || !strings.Contains(err.Error(), "grant-aware") {
		t.Fatal("legacy Begin bypassed distinct grant purpose", err)
	}
	if calls.Load() != 0 {
		t.Fatal("legacy Begin reached outbound permission request")
	}
	cmd.Op, cmd.Nonce = "activate-grant-attempt", Token()
	if _, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport); err == nil || !strings.Contains(err.Error(), "HTTP 503") {
		t.Fatal("unavailable fresh path did not refuse before time", err)
	}
	assertUnstartedWorkspace(t, e, r.ID)
	available.Store(true)
	cmd.Nonce = Token()
	finished := make(chan error, 1)
	go func() { _, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport); finished <- err }()
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("Begin did not reach verified outbound boundary")
	}
	transaction := make(chan error, 1)
	go func() { transaction <- e.WithState(func() error { return nil }) }()
	select {
	case err := <-transaction:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("grant HTTPS held unrelated native state")
	}
	assertUnstartedWorkspace(t, e, r.ID)
	actual := Millis()
	close(release)
	released = true
	select {
	case err := <-finished:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("actual grant Begin did not finish")
	}
	var original *Attempt
	if err := e.WithState(func() error {
		a := e.state.Attempts[r.ID]
		copy := *a
		original = &copy
		if a.State != "ACTIVE" || a.Start < actual || a.Deadline-a.Start != 5400000 || a.OriginalDeadline != a.Deadline || a.GrantBeginIntent != r.GrantBeginIntent {
			t.Fatalf("grant did not commit full allowance only at Begin: %+v", a)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	before := calls.Load()
	available.Store(false)
	restarted, err := New(e.Config)
	if err != nil {
		t.Fatal(err)
	}
	cmd.Nonce = Token()
	result, err := restarted.Command(signedCommand(key, cmd), r.Username, r.Transport)
	if err != nil || result.(*Attempt).Start != original.Start || result.(*Attempt).Deadline != original.Deadline || calls.Load() != before {
		t.Fatal("exact committed retry reverified/rebased a consumed grant", result, err)
	}
	cmd.Nonce = Token()
	cmd.Body.GrantBeginIntent = "55555555-1234-4234-8234-123456789abc"
	if _, err := restarted.Command(signedCommand(key, cmd), r.Username, r.Transport); err == nil {
		t.Fatal("committed intent silently changed")
	}
	// A different account avoids using the ordinary UID-busy guard as the
	// consumption oracle. No source/account release is fabricated for the original.
	restarted.Config.Accounts["student2"] = Account{UID: os.Getuid() + 1, GID: os.Getgid() + 1}
	if err := restarted.WithState(func() error { restarted.state.Registrations["ssh-b"] = "student2"; return nil }); err != nil {
		t.Fatal(err)
	}
	r.ID, r.Username, r.UID, r.Transport = "66666666-1234-4234-8234-123456789abc", "student2", os.Getuid()+1, "ssh-b"
	cmd = preparationCommand(r)
	cmd.Op = "prepare-grant-attempt"
	if _, err := restarted.Command(signedCommand(key, cmd), r.Username, r.Transport); err == nil || !strings.Contains(err.Error(), "consumed") {
		t.Fatal("durable one-use grant fence was not reached", err)
	}
}

func TestInitialGrantRefusesIndependentNativeHistory(t *testing.T) {
	for _, kind := range []string{"same-account", "changed-uid", "changed-username"} {
		t.Run(kind, func(t *testing.T) {
			e, key, r := initialGrantUnpreparedFixture(t)
			started := Millis() - 7200000
			prior := &Attempt{ID: "99999999-1234-4234-8234-123456789abc", Exam: r.Exam, Username: r.Username, UID: r.UID, Settings: r.Settings, State: "COMPLETED", AccessState: "RELEASED", Start: started, Deadline: started + 5400000, OriginalDeadline: started + 5400000, Protected: true}
			if kind == "changed-uid" {
				prior.UID++
			}
			if kind == "changed-username" {
				prior.Username = "oldstudent"
			}
			if err := e.WithState(func() error { e.state.Attempts[prior.ID] = prior; return nil }); err != nil {
				t.Fatal(err)
			}
			cmd := preparationCommand(r)
			cmd.Op = "prepare-grant-attempt"
			if _, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport); err == nil || !strings.Contains(err.Error(), "native attempt history") {
				t.Fatal("initial issuance bypassed independent completed/released native history", err)
			}
			if err := e.WithState(func() error {
				if e.state.Attempts[r.ID] != nil || e.state.Attempts[prior.ID].Start != prior.Start || !e.state.Attempts[prior.ID].Protected {
					t.Fatal("refusal modified historical work or created a new preparation")
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestInitialGrantHistoryFencePreservesUnstartedAndOtherScopes(t *testing.T) {
	for _, kind := range []string{"different-exam", "different-account", "cancelled-preflight"} {
		t.Run(kind, func(t *testing.T) {
			e, key, r := initialGrantUnpreparedFixture(t)
			started := Millis() - 7200000
			prior := &Attempt{ID: "99999999-1234-4234-8234-123456789abc", Exam: r.Exam, Username: r.Username, UID: r.UID, Settings: r.Settings, State: "COMPLETED", AccessState: "RELEASED", Start: started, Deadline: started + 5400000, OriginalDeadline: started + 5400000, Protected: true}
			switch kind {
			case "different-exam":
				prior.Exam = "other-exam"
			case "different-account":
				prior.Username = "otherstudent"
				prior.UID++
			case "cancelled-preflight":
				prior.State = "CANCELLED_BEFORE_START"
				prior.Start = 0
				prior.Deadline = 0
				prior.OriginalDeadline = 0
				prior.Protected = false
			}
			if err := e.WithState(func() error { e.state.Attempts[prior.ID] = prior; return nil }); err != nil {
				t.Fatal(err)
			}
			cmd := preparationCommand(r)
			cmd.Op = "prepare-grant-attempt"
			result, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport)
			if err != nil {
				t.Fatal("unrelated history/unstarted preflight falsely prevented initial preparation", err)
			}
			a := result.(*Attempt)
			if a.State != "PREPARING" || a.Start != 0 || a.Deadline != 0 {
				t.Fatal("preparation started an allowance", a)
			}
		})
	}
}

func TestAdditionalGrantHasDistinctSignedPreparationPurpose(t *testing.T) {
	e, key, r := initialGrantUnpreparedFixture(t)
	r.Grant.Kind = "ADDITIONAL"
	r.Grant.Order = 2
	cmd := preparationCommand(r)
	cmd.Op = "prepare-additional-grant-attempt"
	result, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport)
	if err != nil {
		t.Fatal("explicit additional signed preparation unavailable", err)
	}
	a := result.(*Attempt)
	if a.State != "PREPARING" || a.Start != 0 || a.Deadline != 0 || a.Grant.Kind != "ADDITIONAL" {
		t.Fatal("additional preparation lost type or consumed time", a)
	}
}

func TestAdditionalGrantFreshTLSBeginPreservesPriorIntervalAndBytes(t *testing.T) {
	for _, kind := range []string{"legacy", "anchored"} {
		t.Run(kind, func(t *testing.T) {
			e, key, r := initialGrantUnpreparedFixture(t)
			r.Grant.Kind = "ADDITIONAL"
			r.Grant.Order = 2
			if kind == "anchored" {
				r.Grant.Initial = "66666666-1234-4234-8234-123456789abc"
			}
			priorStart := Millis() - 10800000
			prior := &Attempt{ID: "99999999-1234-4234-8234-123456789abc", Exam: r.Exam, Username: r.Username, UID: r.UID, Settings: r.Settings, State: "COMPLETED", AccessState: "RELEASED", Start: priorStart, Deadline: priorStart + 5400000, OriginalDeadline: priorStart + 5400000, Protected: true}
			if kind == "anchored" {
				prior.Grant = &GrantBinding{ID: r.Grant.Initial, Revision: 1, Hash: strings.Repeat("b", 64), Order: 1}
				prior.GrantBeginIntent = "77777777-1234-4234-8234-123456789abc"
			}
			if err := e.WithState(func() error { e.state.Attempts[prior.ID] = prior; return nil }); err != nil {
				t.Fatal(err)
			}
			historyFile := filepath.Join(e.Config.State, "submissions", prior.ID, "historical-sentinel")
			if err := os.MkdirAll(filepath.Dir(historyFile), 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(historyFile, []byte("preserve previously protected bytes"), 0600); err != nil {
				t.Fatal(err)
			}
			cmd := preparationCommand(r)
			cmd.Op = "prepare-grant-attempt"
			if _, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport); err == nil {
				t.Fatal("additional type downgraded to initial purpose")
			}
			cmd.Op, cmd.Nonce = "prepare-additional-grant-attempt", Token()
			if _, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport); err != nil {
				t.Fatal(err)
			}
			cmd.Op, cmd.Nonce = "prepare-workspace", Token()
			if _, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport); err != nil {
				t.Fatal(err)
			}
			var available atomic.Bool
			var additionalCalls atomic.Int32
			initialGrantServer(t, e, key, func(reply grantBeginReply) (grantBeginReply, int) {
				additionalCalls.Add(1)
				if !available.Load() {
					return reply, 503
				}
				return reply, 200
			})
			r.GrantBeginIntent = "44444444-1234-4234-8234-123456789abc"
			cmd = preparationCommand(r)
			cmd.Op = "activate-grant-attempt"
			if _, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport); err == nil {
				t.Fatal("additional Begin downgraded to initial purpose")
			}
			cmd.Op, cmd.Nonce = "activate-additional-grant-attempt", Token()
			if _, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport); err == nil || !strings.Contains(err.Error(), "HTTP 503") || additionalCalls.Load() != 1 {
				t.Fatal("additional flow did not reach its intended fresh-outbound refusal boundary", err, additionalCalls.Load())
			}
			assertUnstartedWorkspace(t, e, r.ID)
			available.Store(true)
			cmd.Nonce = Token()
			at := Millis()
			result, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport)
			if err != nil {
				t.Fatal(err)
			}
			a := result.(*Attempt)
			if a.Start < at || a.Deadline-a.Start != r.Settings.Duration*1000 || a.Grant.Kind != "ADDITIONAL" || a.Grant.Order != 2 {
				t.Fatal("additional interval/type/order lost", a)
			}
			if e.state.Attempts[prior.ID].Start != priorStart || e.state.Attempts[prior.ID].OriginalDeadline != prior.OriginalDeadline || !e.state.Attempts[prior.ID].Protected {
				t.Fatal("new grant rewrote old interval/history")
			}
			if data, err := os.ReadFile(historyFile); err != nil || string(data) != "preserve previously protected bytes" {
				t.Fatal("new template workspace changed protected bytes", err)
			}
			available.Store(false)
			restarted, err := New(e.Config)
			if err != nil {
				t.Fatal(err)
			}
			cmd.Nonce = Token()
			again, err := restarted.Command(signedCommand(key, cmd), r.Username, r.Transport)
			if err != nil || again.(*Attempt).Start != a.Start || again.(*Attempt).Deadline != a.Deadline {
				t.Fatal("restart/retry rebased original additional interval", err)
			}
			r.Grant.Order = 3
			cmd = preparationCommand(r)
			cmd.Op = "activate-additional-grant-attempt"
			if _, err := restarted.Command(signedCommand(key, cmd), r.Username, r.Transport); err == nil {
				t.Fatal("committed issuance order changed")
			}
			r.Grant.Order = 2
			r.Grant.Initial = "55555555-1234-4234-8234-123456789abc"
			cmd = preparationCommand(r)
			cmd.Op = "activate-additional-grant-attempt"
			if _, err := restarted.Command(signedCommand(key, cmd), r.Username, r.Transport); err == nil {
				t.Fatal("committed initial authority anchor changed")
			}
		})
	}
}

func TestInitialAfterAdditionalRequiresOriginalDurableOrderAndTypedHistory(t *testing.T) {
	for _, kind := range []string{"valid", "missing-order", "later-initial", "legacy-prior", "missing-intent", "changed-uid", "same-grant", "missing-initial-anchor", "foreign-initial-anchor"} {
		t.Run(kind, func(t *testing.T) {
			e, key, r := initialGrantUnpreparedFixture(t)
			r.Grant.Order = 1
			started := Millis() - 10800000
			prior := &Attempt{ID: "99999999-1234-4234-8234-123456789abc", Exam: r.Exam, Username: r.Username, UID: r.UID, Settings: r.Settings, State: "COMPLETED", AccessState: "RELEASED", Start: started, Deadline: started + 5400000, OriginalDeadline: started + 5400000, Protected: true, Grant: &GrantBinding{ID: "88888888-1234-4234-8234-123456789abc", Revision: 1, Hash: strings.Repeat("b", 64), Kind: "ADDITIONAL", Order: 2}, GrantBeginIntent: "77777777-1234-4234-8234-123456789abc"}
			prior.Grant.Initial = r.Grant.ID
			switch kind {
			case "missing-order":
				r.Grant.Order = 0
			case "later-initial":
				r.Grant.Order = 3
			case "legacy-prior":
				prior.Grant = nil
			case "missing-intent":
				prior.GrantBeginIntent = ""
			case "changed-uid":
				prior.UID++
			case "same-grant":
				prior.Grant.ID = r.Grant.ID
			case "missing-initial-anchor":
				prior.Grant.Initial = ""
			case "foreign-initial-anchor":
				prior.Grant.Initial = "66666666-1234-4234-8234-123456789abc"
			}
			if err := e.WithState(func() error { e.state.Attempts[prior.ID] = prior; return nil }); err != nil {
				t.Fatal(err)
			}
			cmd := preparationCommand(r)
			cmd.Op = "prepare-grant-attempt"
			result, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport)
			if kind != "valid" {
				if err == nil {
					t.Fatal("uncertain or newly manufactured initial authority bypassed native history")
				}
				return
			}
			if err != nil {
				t.Fatal("earlier unused initial falsely blocked by positively typed later additional history", err)
			}
			if result.(*Attempt).Start != 0 {
				t.Fatal("initial preparation consumed time")
			}
		})
	}
}

func TestAdditionalConcurrentBeginKeepsOneOriginalInterval(t *testing.T) {
	e, key, r := initialGrantUnpreparedFixture(t)
	r.Grant.Kind = "ADDITIONAL"
	r.Grant.Order = 2
	cmd := preparationCommand(r)
	cmd.Op = "prepare-additional-grant-attempt"
	if _, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport); err != nil {
		t.Fatal(err)
	}
	cmd.Op, cmd.Nonce = "prepare-workspace", Token()
	if _, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport); err != nil {
		t.Fatal(err)
	}
	entered, release := make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	initialGrantServer(t, e, key, func(reply grantBeginReply) (grantBeginReply, int) {
		if calls.Add(1) == 1 {
			close(entered)
		}
		<-release
		return reply, 200
	})
	released := false
	defer func() {
		if !released {
			close(release)
		}
	}()
	r.GrantBeginIntent = "44444444-1234-4234-8234-123456789abc"
	finished := make(chan error, 2)
	for range 2 {
		current := preparationCommand(r)
		current.Op = "activate-additional-grant-attempt"
		go func() { _, err := e.Command(signedCommand(key, current), r.Username, r.Transport); finished <- err }()
	}
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		t.Fatal("concurrent Begin never reached fresh TLS boundary")
	}
	unrelated := make(chan error, 1)
	go func() { unrelated <- e.WithState(func() error { return nil }) }()
	select {
	case err := <-unrelated:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("additional exchange held shared state")
	}
	assertUnstartedWorkspace(t, e, r.ID)
	close(release)
	released = true
	success := 0
	for range 2 {
		select {
		case err := <-finished:
			if err == nil {
				success++
			}
		case <-time.After(5 * time.Second):
			t.Fatal("concurrent Begin did not complete")
		}
	}
	if success < 1 {
		t.Fatal("no concurrent Begin succeeded")
	}
	if err := e.WithState(func() error {
		a := e.state.Attempts[r.ID]
		if a.Start <= 0 || a.Deadline-a.Start != r.Settings.Duration*1000 || a.GrantBeginIntent != r.GrantBeginIntent {
			t.Fatal("concurrent start changed original interval", a)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 1 {
		t.Fatal("stale concurrent snapshot reached another permission exchange", calls.Load())
	}
}

func TestInitialGrantFreshSignedRepliesCannotChangeScope(t *testing.T) {
	for _, kind := range []string{"signature", "nonce", "intent", "grant", "revision", "transport", "boot", "expired", "purpose"} {
		t.Run(kind, func(t *testing.T) {
			e, key, r := initialGrantFixture(t)
			var reached atomic.Bool
			initialGrantServer(t, e, key, func(reply grantBeginReply) (grantBeginReply, int) {
				reached.Store(true)
				switch kind {
				case "signature":
					reply.Type = "bad-signature"
				case "nonce":
					reply.Nonce = Token()
				case "intent":
					reply.Intent = "55555555-1234-4234-8234-123456789abc"
				case "grant":
					reply.Grant.ID = "55555555-1234-4234-8234-123456789abc"
				case "revision":
					reply.Grant.Revision++
				case "transport":
					reply.Transport = "ssh-other"
				case "boot":
					reply.Boot = "55555555-1234-4234-8234-123456789abc"
				case "expired":
					reply.Expires = Millis() - 1
				case "purpose":
					reply.Type = "deadline-timing"
				}
				return reply, 200
			})
			r.GrantBeginIntent = "44444444-1234-4234-8234-123456789abc"
			cmd := preparationCommand(r)
			cmd.Op = "activate-grant-attempt"
			if _, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport); err == nil || !reached.Load() {
				t.Fatal("signed wrong-scope reply did not reach/refuse the intended boundary", err)
			}
			assertUnstartedWorkspace(t, e, r.ID)
		})
	}
}

func TestInitialGrantCancelledPreparationCannotRebindUnixIdentity(t *testing.T) {
	e, key, r := initialGrantFixture(t)
	if err := e.WithState(func() error {
		e.state.Attempts[r.ID].State = "CANCELLED_BEFORE_START"
		e.state.Registrations["ssh-other"] = "student2"
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	e.Config.Accounts["student2"] = Account{UID: os.Getuid() + 1, GID: os.Getgid() + 1}
	r.ID, r.Username, r.UID, r.Transport = "66666666-1234-4234-8234-123456789abc", "student2", os.Getuid()+1, "ssh-other"
	e.preparationReady = func() (bool, []string) { t.Fatal("identity remap reached readiness/staging"); return false, nil }
	cmd := preparationCommand(r)
	cmd.Op = "prepare-grant-attempt"
	if _, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport); err == nil || !strings.Contains(err.Error(), "grant identity changed") {
		t.Fatal("cancelled grant forgot its original Unix owner", err)
	}
}

func TestInitialGrantCommitRechecksExpiryAndWindowAfterFinalMetadata(t *testing.T) {
	for _, kind := range []string{"command", "verification", "window"} {
		t.Run(kind, func(t *testing.T) {
			var target atomic.Int64
			configure := func(s *Settings) {
				if kind == "window" {
					target.Store(Millis() + 3000)
					s.Latest = target.Load()
				}
			}
			e, key, r := initialGrantFixture(t, configure)
			initialGrantServer(t, e, key, func(reply grantBeginReply) (grantBeginReply, int) {
				if kind == "verification" {
					reply.Expires = Millis() + 1000
					target.Store(reply.Expires)
				}
				return reply, 200
			})
			r.GrantBeginIntent = "44444444-1234-4234-8234-123456789abc"
			cmd := preparationCommand(r)
			cmd.Op = "activate-grant-attempt"
			if kind == "command" {
				cmd.Expires = Millis() + 1500
				target.Store(cmd.Expires)
			}
			reached := false
			e.workspaceCheckpoint = func(phase string) error {
				if phase != "grant-before-start" {
					return nil
				}
				reached = true
				remaining := time.Until(time.UnixMilli(target.Load() + 25))
				if remaining > 4*time.Second {
					t.Fatal("unbounded expiry fixture wait")
				}
				if remaining > 0 {
					timer := time.NewTimer(remaining)
					<-timer.C
				}
				return nil
			}
			if _, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport); err == nil || !reached {
				t.Fatal("late metadata completion did not reach/refuse actual clock commit", err, reached)
			}
			assertUnstartedWorkspace(t, e, r.ID)
		})
	}
}
