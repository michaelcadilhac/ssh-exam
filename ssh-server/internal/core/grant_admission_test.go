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

type testMonitoringRequest struct {
	Type          string          `json:"type"`
	Agent         string          `json:"agent"`
	Nonce         string          `json:"nonce"`
	Owner         monitoringOwner `json:"owner"`
	AfterSequence uint64          `json:"after_sequence"`
	CoverageEpoch string          `json:"coverage_epoch"`
}

type testLiveCallbacks struct {
	Evidence func(testMonitoringRequest) (monitoringEvidence, int)
	Continue func(monitoringContinueRequest) (monitoringContinueReply, int)
}

func initialGrantServer(t *testing.T, e *Engine, gateway ed25519.PrivateKey, handler func(grantBeginReply) (grantBeginReply, int), monitoring ...testLiveCallbacks) *httptest.Server {
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
		proofRoute := r.URL.Path == "/api/agent/monitoring-evidence" && len(monitoring) == 1 && monitoring[0].Evidence != nil
		resumeRoute := r.URL.Path == "/api/agent/monitoring-continue" && len(monitoring) == 1 && monitoring[0].Continue != nil
		if (r.URL.Path != "/api/agent/grant-begin" && !proofRoute && !resumeRoute) || r.Method != "POST" {
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
		if resumeRoute {
			var q monitoringContinueRequest
			if terminalDecode(payload, &q) != nil || q.Type != "monitoring-continue/v1" || q.Agent != "class" || !validMonitoringOwner(q.Owner) || !validMonitoringOwner(q.PreviousOwner) || !monitoringDigest.MatchString(q.Nonce) {
				t.Error("wrong authenticated continuation scope")
				w.WriteHeader(400)
				return
			}
			proof, status := monitoring[0].Continue(q)
			if status != 200 {
				w.WriteHeader(status)
				return
			}
			data, err := json.Marshal(proof)
			if err != nil {
				t.Error(err)
				w.WriteHeader(500)
				return
			}
			_ = json.NewEncoder(w).Encode(SignedFrame{Payload: base64.StdEncoding.EncodeToString(data), Signature: base64.StdEncoding.EncodeToString(ed25519.Sign(gateway, data))})
			return
		}
		if proofRoute {
			var q testMonitoringRequest
			if terminalDecode(payload, &q) != nil || q.Type != "monitoring-execution-challenge-v1" || q.Agent != "class" || !validMonitoringOwner(q.Owner) || !monitoringDigest.MatchString(q.Nonce) {
				t.Error("wrong authenticated monitoring challenge scope")
				w.WriteHeader(400)
				return
			}
			proof, status := monitoring[0].Evidence(q)
			if status != 200 {
				w.WriteHeader(status)
				return
			}
			data, err := json.Marshal(proof)
			if err != nil {
				t.Error(err)
				w.WriteHeader(500)
				return
			}
			_ = json.NewEncoder(w).Encode(SignedFrame{Payload: base64.StdEncoding.EncodeToString(data), Signature: base64.StdEncoding.EncodeToString(ed25519.Sign(gateway, data))})
			return
		}
		var request struct {
			Type         string           `json:"type"`
			Agent        string           `json:"agent"`
			Nonce        string           `json:"nonce"`
			Attempt      string           `json:"attempt"`
			Grant        *GrantBinding    `json:"grant"`
			Intent       string           `json:"intent"`
			Transport    string           `json:"transport"`
			Boot         string           `json:"boot"`
			Settings     Settings         `json:"settings"`
			PageEpoch    string           `json:"page_epoch,omitempty"`
			InitialOwner *monitoringOwner `json:"initial_owner,omitempty"`
		}
		if json.Unmarshal(payload, &request) != nil || (request.Type != "grant-begin/v2" && request.Type != "grant-begin/v3") || (request.Type == "grant-begin/v3") != (request.InitialOwner != nil) || request.Agent != "class" || request.Settings.TemplateVersion == "" {
			t.Error("wrong fresh verification scope/source")
			w.WriteHeader(400)
			return
		}
		var seed *monitoringBootstrap
		if request.InitialOwner != nil {
			if !validMonitoringOwner(*request.InitialOwner) || request.InitialOwner.PageEpoch != request.PageEpoch || request.InitialOwner.TransportHash != request.Transport || request.InitialOwner.Boot != request.Boot {
				t.Error("provisional owner missing or not bound to authenticated Begin")
				w.WriteHeader(400)
				return
			}
			seed = &monitoringBootstrap{Type: "monitoring-bootstrap/v1", ControlRetention: "v1", Owner: *request.InitialOwner, CoverageEpoch: strings.Repeat("e", 64), Sequence: 1}
		}
		reply, status := handler(grantBeginReply{Type: request.Type, Audience: request.Agent, Nonce: request.Nonce, Expires: Millis() + 30000, CaptureValidFor: 15000, Attempt: request.Attempt, Grant: request.Grant, Intent: request.Intent, Transport: request.Transport, Boot: request.Boot, PageEpoch: request.PageEpoch, Bootstrap: seed})
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

func TestAdvertisedRetainedMonitoringRefusesLegacyBeginBeforeClock(t *testing.T) {
	e, key, r := initialGrantFixture(t)
	previous := terminalAuthorityReadiness
	terminalAuthorityReadiness = func() error { return nil }
	t.Cleanup(func() { terminalAuthorityReadiness = previous })
	register := Command{Audience: e.Config.AgentID, Username: r.Username, Nonce: Token(), Expires: Millis() + 10000, Op: "register"}
	result, err := e.Command(signedCommand(key, register), r.Username, r.Transport)
	if err != nil {
		t.Fatal("eligible signed registration failed before capability observation", err)
	}
	features, ok := result.(map[string]any)
	if !ok || features["retained_monitoring"] != "v1" {
		t.Fatal("fixture did not actually advertise retained monitoring", result)
	}
	var calls atomic.Int32
	initialGrantServer(t, e, key, func(reply grantBeginReply) (grantBeginReply, int) {
		calls.Add(1)
		return reply, 200
	})
	before := *assertUnstartedWorkspace(t, e, r.ID)
	grantBefore, err := json.Marshal(before.Grant)
	if err != nil {
		t.Fatal(err)
	}
	ready := filepath.Join(e.Config.Work, r.ID, "workspace-ready", "work")
	identity, err := os.Stat(ready)
	if err != nil {
		t.Fatal(err)
	}
	r.GrantBeginIntent = "44444444-1234-4234-8234-123456789abc"
	cmd := preparationCommand(r)
	cmd.Op, cmd.Nonce = "activate-grant-attempt", Token()
	_, err = e.Command(signedCommand(key, cmd), r.Username, r.Transport)
	if err == nil || !strings.Contains(err.Error(), "retained monitoring") {
		t.Fatal("advertised retained mode did not refuse legacy purpose before start", err, calls.Load())
	}
	if calls.Load() != 0 {
		t.Fatal("legacy purpose reached outbound grant authorization", calls.Load())
	}
	after := assertUnstartedWorkspace(t, e, r.ID)
	current, statErr := os.Stat(ready)
	grantAfter, marshalErr := json.Marshal(after.Grant)
	if statErr != nil || marshalErr != nil || !os.SameFile(identity, current) || string(grantBefore) != string(grantAfter) || before.GrantBeginIntent != after.GrantBeginIntent || before.Settings != after.Settings {
		t.Fatal("refusal changed staged source/settings/intent/grant", statErr)
	}
	// Model an existing interval begun before the protocol upgrade. Its exact
	// retry must remain cached, with no new authorization, clock or conversion.
	terminalAuthorityReadiness = previous
	cmd.Nonce = Token()
	if _, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport); err != nil {
		t.Fatal("existing legacy baseline could not start under its original policy", err)
	}
	state, err := readStateSnapshot(e.Config.State)
	if err != nil {
		t.Fatal(err)
	}
	started := *state.Attempts[r.ID]
	if started.Start == 0 || started.Deadline-started.Start != r.Settings.Duration*1000 || calls.Load() != 1 {
		t.Fatal("legacy baseline did not reach its full actual interval", started, calls.Load())
	}
	terminalAuthorityReadiness = func() error { return nil }
	cmd.Nonce = Token()
	if _, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport); err != nil {
		t.Fatal("upgrade rejected already-started legacy cached retry", err)
	}
	state, err = readStateSnapshot(e.Config.State)
	if err != nil || calls.Load() != 1 {
		t.Fatal("legacy cached retry reauthorized an existing interval", err, calls.Load())
	}
	active := state.Attempts[r.ID]
	if active.Start != started.Start || active.Deadline != started.Deadline || active.OriginalDeadline != started.OriginalDeadline || active.MonitoringMode != started.MonitoringMode {
		t.Fatal("upgrade changed an already-started legacy interval", active)
	}
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

func TestExplicitGrantWorkspaceSignedStageTLSBeginAndRestart(t *testing.T) {
	for _, kind := range []string{"empty", "template", "missing", "saved"} {
		t.Run(kind, func(t *testing.T) {
			e, key, r := initialGrantUnpreparedFixture(t)
			r.Grant.Kind, r.Grant.Order = "ADDITIONAL", 2
			r.Grant.Work = &GrantWork{Kind: "empty"}
			var savedPlan SourceRetentionPlan
			if kind == "saved" {
				r.Settings.Duration = 5400 // Explicit NEW full ninety-minute allowance.
				priorSettings := r.Settings
				priorSettings.ID = "saved-history"
				priorSettings.Duration = 3600
				prior := &Attempt{ID: "99999999-1234-4234-8234-123456789abc", Exam: priorSettings.ID, Username: r.Username, UID: r.UID, State: "COMPLETED", Settings: priorSettings, Start: Millis() - 10800000, Deadline: Millis() - 5400000, AccessState: "RELEASED", PolicyState: "NORMAL"}
				prior.Deadline = prior.Start + priorSettings.Duration*1000
				prior.Settings.Earliest, prior.Settings.Latest = prior.Start-1000, prior.Start+1000
				prior.OriginalDeadline = prior.Deadline
				work := t.TempDir()
				if err := os.WriteFile(filepath.Join(work, "answer.txt"), []byte("VERIFIED SAVED ANSWER\n"), 0600); err != nil {
					t.Fatal(err)
				}
				checksum, err := Collect(work, filepath.Join(e.Config.State, "submissions", prior.ID), prior)
				if err != nil {
					t.Fatal(err)
				}
				prior.Checksum, prior.Protected = checksum, true
				if err := e.WithState(func() error { e.state.Attempts[prior.ID] = prior; return nil }); err != nil {
					t.Fatal(err)
				}
				r.Grant.Work = &GrantWork{Kind: "saved", Attempt: prior.ID, Checksum: checksum}
				savedPlan = SourceRetentionPlan{Version: 1, Agent: e.Config.AgentID, Grant: r.Grant, Exam: r.Exam, Username: r.Username, UID: r.UID, Settings: r.Settings, Source: SourceRetentionSource{Attempt: prior.ID, Checksum: checksum}, Action: "retain", CurrentRevision: 1, Status: "PENDING_NATIVE"}
				if _, err := e.RetainGrantSource(savedPlan); err != nil {
					t.Fatal(err)
				}
			}
			if kind == "template" || kind == "missing" {
				source := templateSourceFixture(t)
				if err := os.WriteFile(filepath.Join(source, "work", "main.c"), []byte("INDEPENDENT STARTER\n"), 0644); err != nil {
					t.Fatal(err)
				}
				metadata, err := inspectTemplateSource(source, sourceTestBounds(), nil)
				if err != nil {
					t.Fatal(err)
				}
				f := templateFixture{state: e.Config.State, source: source, hash: metadata.Hash}
				install := templateInstallCommand(f)
				install.Name = "starter"
				if kind != "missing" {
					if _, err := templateRun(t, f, install, ""); err != nil {
						t.Fatal(err)
					}
				}
				r.Grant.Work = &GrantWork{Kind: "template", Name: "starter", Hash: metadata.Hash}
			}
			cmd := preparationCommand(r)
			cmd.Op = "prepare-additional-grant-attempt"
			if _, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport); err != nil {
				t.Fatal(err)
			}
			cmd.Op, cmd.Nonce = "prepare-workspace", Token()
			// Cross the real production-framed OS process boundary with the new
			// source binding. Only privileged systemd/writer setup is injected.
			childCollections(e, "success")
			e.workerTimeout = 10 * time.Second
			if kind == "template" || kind == "saved" {
				childCollections(e, "workspace-kill-private")
				e.workerTimeout = 10 * time.Second
				_, killed := e.Command(signedCommand(key, cmd), r.Username, r.Transport)
				if killed == nil {
					t.Fatal("synthetic child death after private publication was not observed")
				}
				assertUnstartedWorkspace(t, e, r.ID)
				receipt, err := readWorkspaceReceipt(e.workspaceBase(r.ID))
				if err != nil || !sameGrant(receipt.Grant, r.Grant) {
					t.Fatal("child death lost frozen private source receipt", err, "worker:", killed)
				}
				if !strings.Contains(killed.Error(), "signal: killed") {
					t.Fatal("fixture missed actual post-publication SIGKILL boundary", killed)
				}
				childCollections(e, "success")
				e.workerTimeout = 10 * time.Second
				cmd.Nonce = Token()
			}
			_, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport)
			if kind == "missing" {
				if err == nil {
					t.Fatal("missing independent source silently fell back to materials starter")
				}
				assertUnstartedWorkspace(t, e, r.ID)
				if _, err := os.Lstat(filepath.Join(e.workspaceBase(r.ID), "work")); !os.IsNotExist(err) {
					t.Fatal("failed staging published writable work", err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			a := assertUnstartedWorkspace(t, e, r.ID)
			if a.Workspace == nil || !sameGrant(a.Workspace.Grant, r.Grant) || a.Workspace.Source.Kind != kind || a.Settings.Template != r.Settings.Template {
				t.Fatal("explicit source/independent materials lost", a.Workspace)
			}
			encoded, err := json.Marshal(a.Workspace)
			if err != nil {
				t.Fatal(err)
			}
			for _, bad := range []any{nil, map[string]any{"kind": "empty", "name": nil}, map[string]any{"kind": "saved"}, map[string]any{"kind": "template", "name": "starter", "hash": "bad"}, map[string]any{"kind": "empty", "private": "sentinel"}} {
				var receipt map[string]any
				if err := json.Unmarshal(encoded, &receipt); err != nil {
					t.Fatal(err)
				}
				receipt["grant"].(map[string]any)["work"] = bad
				invalid, err := json.Marshal(receipt)
				if err != nil {
					t.Fatal(err)
				}
				if _, err := decodeWorkspaceReceipt(invalid); err == nil {
					t.Fatal("unsafe/null explicit source receipt accepted", bad)
				}
			}
			entries, err := os.ReadDir(filepath.Join(e.workspaceBase(r.ID), "workspace-ready", "work"))
			if err != nil {
				t.Fatal(err)
			}
			if kind == "empty" && len(entries) != 0 {
				t.Fatal("empty source copied material starter", entries)
			}
			if kind == "template" {
				b, err := os.ReadFile(filepath.Join(e.workspaceBase(r.ID), "workspace-ready", "work", "main.c"))
				if err != nil || string(b) != "INDEPENDENT STARTER\n" {
					t.Fatal("wrong exact starter", string(b), err)
				}
			}
			if kind == "saved" {
				content, err := os.ReadFile(filepath.Join(e.workspaceBase(r.ID), "workspace-ready", "work", "answer.txt"))
				if err != nil || string(content) != "VERIFIED SAVED ANSWER\n" {
					t.Fatal("saved archive did not reach actual private staging", string(content), err)
				}
				pin, err := e.SourceRetention(r.Grant.ID, r.Grant.Revision)
				if err != nil || len(pin.Consumers) != 1 || pin.Consumers[0] != r.ID || a.Workspace.RecoveryHash != pin.RetentionHash {
					t.Fatal("staging lost its durable source/consumer binding", pin, err)
				}
			}
			var corrupt atomic.Bool
			initialGrantServer(t, e, key, func(reply grantBeginReply) (grantBeginReply, int) {
				if corrupt.Load() {
					g := *reply.Grant
					g.Work = &GrantWork{Kind: "template", Name: r.Settings.Template, Hash: r.Settings.TemplateVersion}
					reply.Grant = &g
				}
				return reply, 200
			})
			r.GrantBeginIntent = "44444444-1234-4234-8234-123456789abc"
			cmd = preparationCommand(r)
			cmd.Op = "activate-additional-grant-attempt"
			corrupt.Store(true)
			if _, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport); err == nil {
				t.Fatal("fresh reply substituted source")
			}
			assertUnstartedWorkspace(t, e, r.ID)
			corrupt.Store(false)
			restarted, err := New(e.Config)
			if err != nil {
				t.Fatal(err)
			}
			restarted.activationPrepare = e.activationPrepare
			restarted.templateVerify = e.templateVerify
			cmd.Nonce = Token()
			at := Millis()
			result, err := restarted.Command(signedCommand(key, cmd), r.Username, r.Transport)
			if err != nil {
				t.Fatal(err)
			}
			started := result.(*Attempt)
			if started.Start < at || started.Deadline-started.Start != r.Settings.Duration*1000 || !sameGrant(started.Grant, r.Grant) {
				t.Fatal("full allowance/source not retained", started)
			}
			if kind == "empty" {
				entries, err := os.ReadDir(filepath.Join(e.workspaceBase(r.ID), "work"))
				if err != nil || len(entries) != 0 {
					t.Fatal("empty publication changed", entries, err)
				}
			}
			childCollections(restarted, "success")
			restarted.workerTimeout = 10 * time.Second
			completed, err := restarted.Call("finalize-attempt", Request{ID: r.ID, Reason: "Synthetic explicit-source workflow completion"})
			if err != nil {
				t.Fatal("real worker collection of explicit source", err)
			}
			finished := completed.(*Attempt)
			if finished.State != "COMPLETED" || !finished.Protected || finished.Start != started.Start || finished.OriginalDeadline != started.OriginalDeadline || !sameGrant(finished.Grant, r.Grant) {
				t.Fatal("collection changed source authority/history", finished)
			}
			manifest, err := ReadProtected(filepath.Join(restarted.Config.State, "submissions", r.ID), finished)
			if err != nil || !sameGrant(manifest.Attempt.Grant, r.Grant) {
				t.Fatal("protected archive lost explicit source binding", err)
			}
			wantFiles := 0
			if kind == "template" || kind == "saved" {
				wantFiles = 1
			}
			if len(manifest.Files) != wantFiles {
				t.Fatal("wrong starter collected", len(manifest.Files))
			}
			if kind == "saved" {
				savedPlan.Action, savedPlan.Status = "release", "CONSUMED"
				if _, err := restarted.ReleaseGrantSource(savedPlan); err != nil {
					t.Fatal("verified protected consumer could not retire its source dependency", err)
				}
			}
		})
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
	for _, kind := range []string{"signature", "nonce", "intent", "grant", "revision", "transport", "boot", "expired", "purpose", "legacy", "capture-missing", "capture-negative", "capture-excess", "capture-transit"} {
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
				case "legacy":
					reply.Type = "grant-begin/v1"
				case "capture-missing":
					reply.CaptureValidFor = 0
				case "capture-negative":
					reply.CaptureValidFor = -1
				case "capture-excess":
					reply.CaptureValidFor = 15001
				case "capture-transit":
					reply.CaptureValidFor = 1000
					time.Sleep(1200 * time.Millisecond)
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

func TestInitialGrantShortFreshReplyDoesNotDoubleChargeTransit(t *testing.T) {
	e, key, r := initialGrantFixture(t)
	var reached atomic.Bool
	initialGrantServer(t, e, key, func(reply grantBeginReply) (grantBeginReply, int) {
		reached.Store(true)
		reply.CaptureValidFor = 3000
		reply.Expires = Millis() + 3000
		time.Sleep(1700 * time.Millisecond)
		return reply, 200
	})
	r.GrantBeginIntent = "44444444-1234-4234-8234-123456789abc"
	cmd := preparationCommand(r)
	cmd.Op = "activate-grant-attempt"
	actual := Millis()
	result, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport)
	if err != nil || !reached.Load() {
		t.Fatal("valid original freshness was charged twice", err)
	}
	a := result.(*Attempt)
	if a.State != "ACTIVE" || a.Start < actual+1700 || a.Deadline-a.Start != 5400000 || a.GrantBeginIntent != r.GrantBeginIntent {
		t.Fatal("fresh delayed Begin did not receive its original full allowance", a)
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
					reply.CaptureValidFor = 1000
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
