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
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func executionPolicyFixture() ExamExecutionPolicy {
	return ExamExecutionPolicy{Schema: 1, Agent: "class", Exam: "exam", Instance: strings.Repeat("a", 32), Revision: 1, Terminals: 4, CollectionFileMiB: 2, CollectionTotalMiB: 4}
}

// This server consumes the exact production request and authenticates its raw
// bytes, rather than handing an already-verified policy to private helpers.
func executionPolicyServer(t *testing.T, e *Engine, gateway ed25519.PrivateKey, reply func(map[string]any), event ...func([]byte)) *httptest.Server {
	t.Helper()
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := x509.MarshalPKCS8PrivateKey(private)
	if err != nil {
		t.Fatal(err)
	}
	e.Config.CallbackKey = filepath.Join(t.TempDir(), "agent.key")
	if err := os.WriteFile(e.Config.CallbackKey, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: encoded}), 0600); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		isEvent := r.URL.Path == "/api/agent/events" && len(event) == 1
		if r.Method != "POST" || (r.URL.Path != "/api/agent/exam-execution-policy" && !isEvent) || r.Header.Get("Content-Type") != "application/vnd.ssh-exam-event" {
			t.Error("wrong actual policy route/method/content type", r.Method, r.URL.Path)
			w.WriteHeader(400)
			return
		}
		body, err := io.ReadAll(io.LimitReader(r.Body, 32769))
		signature, _ := base64.StdEncoding.DecodeString(r.Header.Get("X-Exam-Signature"))
		if err != nil || len(body) > 32768 || !ed25519.Verify(public, body, signature) {
			t.Error("unsigned or unbounded actual policy/callback request")
			w.WriteHeader(403)
			return
		}
		if isEvent {
			event[0](body)
			return
		}
		var q map[string]any
		if json.Unmarshal(body, &q) != nil || len(q) != 4 || q["agent"] != "class" || q["exam"] != "exam" || q["at"].(float64) < float64(Millis()-operationTimeoutMS) || !monitoringDigest.MatchString(q["nonce"].(string)) {
			t.Error("unsigned, malformed or incorrectly scoped actual policy request", string(body))
			w.WriteHeader(403)
			return
		}
		value := map[string]any{"type": "exam-execution-policy", "audience": "class", "nonce": q["nonce"], "expires": Millis() + operationTimeoutMS, "policy": executionPolicyFixture()}
		reply(value)
		signed, err := json.Marshal(value)
		if err != nil {
			t.Error(err)
			w.WriteHeader(500)
			return
		}
		sig := ed25519.Sign(gateway, signed)
		if value["type"] == "bad-signature" {
			sig[0] ^= 1
		}
		_ = json.NewEncoder(w).Encode(SignedFrame{Payload: base64.StdEncoding.EncodeToString(signed), Signature: base64.StdEncoding.EncodeToString(sig)})
	}))
	e.Config.CallbackURL = server.URL
	e.Config.CallbackCA = filepath.Join(t.TempDir(), "policy-ca.pem")
	if err := os.WriteFile(e.Config.CallbackCA, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: server.Certificate().Raw}), 0600); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(server.Close)
	return server
}

func TestExecutionPolicyAuthenticatedFreshAndMonotonic(t *testing.T) {
	e, key, _ := leaseFixture(t)
	var mu sync.Mutex
	policy, mode := executionPolicyFixture(), "valid"
	executionPolicyServer(t, e, key, func(reply map[string]any) {
		mu.Lock()
		defer mu.Unlock()
		reply["policy"] = policy
		switch mode {
		case "nonce":
			reply["nonce"] = Token()
		case "audience":
			reply["audience"] = "other"
		case "expired":
			reply["expires"] = Millis() - 1
		case "long":
			reply["expires"] = Millis() + operationTimeoutMS + 2000
		case "extra":
			reply["extra"] = true
		case "signature":
			reply["type"] = "bad-signature"
		case "fractional-bound":
			data, _ := json.Marshal(policy)
			var object map[string]any
			_ = json.Unmarshal(data, &object)
			object["collection_file_mib"] = 1.5
			reply["policy"] = object
		}
	})
	first, err := e.refreshExecutionPolicy("exam")
	if err != nil || first == nil || first.policy != policy {
		t.Fatal("fresh authenticated policy unavailable", first, err)
	}
	for _, bad := range []string{"nonce", "audience", "expired", "long", "extra", "signature", "wrong-exam", "fractional-bound", "hard-bound", "rollback", "same-revision-change", "instance"} {
		t.Run(bad, func(t *testing.T) {
			mu.Lock()
			mode, policy = bad, executionPolicyFixture()
			switch bad {
			case "wrong-exam":
				policy.Exam = "other"
			case "hard-bound":
				policy.CollectionFileMiB = 4097
			case "rollback":
				policy.Revision = 0
			case "same-revision-change":
				policy.Terminals = 1
			case "instance":
				policy.Instance = strings.Repeat("b", 32)
			}
			mu.Unlock()
			if _, err := e.refreshExecutionPolicy("exam"); err == nil {
				t.Fatal("unsafe authenticated policy accepted", bad)
			}
			if err := e.WithState(func() error {
				if e.state.ExamExecutionPolicies["exam"] != first.policy {
					t.Fatal("refused policy partially changed durable revision fence")
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
		})
	}
	mu.Lock()
	mode, policy = "valid", executionPolicyFixture()
	policy.Revision, policy.Terminals = 2, 1
	mu.Unlock()
	newest, err := e.refreshExecutionPolicy("exam")
	if err != nil || newest.policy.Revision != 2 {
		t.Fatal("new policy revision rejected", err)
	}
	restarted, err := New(e.Config)
	if err != nil {
		t.Fatal(err)
	}
	if err := restarted.WithState(func() error {
		if _, err := restarted.admissionTerminalLimitLocked(restarted.state.Attempts[finalID], nil); err == nil {
			t.Fatal("restart treated disk policy as fresh execution authority")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	policy = executionPolicyFixture()
	mu.Unlock()
	if _, err := restarted.refreshExecutionPolicy("exam"); err == nil {
		t.Fatal("restart forgot durable rollback fence")
	}
	// Removing outbound configuration cannot silently return to frozen caps.
	restarted.Config.CallbackURL = ""
	if _, err := restarted.refreshExecutionPolicy("exam"); err == nil {
		t.Fatal("removing configuration bypassed live policy")
	}
}

func TestExecutionPolicySignedPaneAdmissionUsesCurrentExamLimits(t *testing.T) {
	e, key, cmd := leaseFixture(t)
	if err := e.WithState(func() error {
		a := e.state.Attempts[finalID]
		a.Settings.Terminals, a.AccessState = 1, "HELD"
		a.Units = []string{"existing-pane.scope"}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	before := inspectFinal(t, e)
	var revision atomic.Int64
	revision.Store(1)
	executionPolicyServer(t, e, key, func(reply map[string]any) {
		p := executionPolicyFixture()
		p.Revision = revision.Load()
		if p.Revision >= 2 {
			p.Terminals = 1
		}
		reply["policy"] = p
	})
	cmd.Op, cmd.Nonce, cmd.Body = "issue-channel-admission", Token(), Request{ID: finalID, Username: "student", Transport: "ssh-a", Pane: "33333333-1234-4234-8234-123456789abc", Purpose: "exam"}
	result, err := e.Command(signedCommand(key, cmd), "student", "ssh-a")
	if err != nil {
		t.Fatal("raising current exam limit did not permit new pane", err)
	}
	token := result.(map[string]string)["token"]
	verified, err := e.refreshExecutionPolicy("exam")
	if err != nil {
		t.Fatal(err)
	}
	if err := e.WithState(func() error {
		account, ok := e.account("student")
		if !ok {
			t.Fatal("synthetic student account missing")
		}
		_, _, err := e.paneAdmission(token, "student", "ssh-a", account, verified)
		return err
	}); err != nil {
		t.Fatal("fresh gate did not use live cap", err)
	}
	revision.Store(2)
	if _, err := e.refreshExecutionPolicy("exam"); err != nil {
		t.Fatal(err)
	}
	cmd.Nonce, cmd.Body.Pane = Token(), "44444444-1234-4234-8234-123456789abc"
	if _, err := e.Command(signedCommand(key, cmd), "student", "ssh-a"); err == nil || !strings.Contains(err.Error(), "terminal limit") {
		t.Fatal("lower current exam limit did not block NEW pane", err)
	}
	if err := e.WithState(func() error {
		account, _ := e.account("student")
		if _, _, err := e.paneAdmission(token, "student", "ssh-a", account, verified); err == nil {
			t.Fatal("old policy admitted queued pane after current revision changed")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	after := inspectFinal(t, e)
	if before.Settings != after.Settings || before.Deadline != after.Deadline || before.Start != after.Start || before.Lease != after.Lease || before.State != after.State || !reflect.DeepEqual(before.Units, after.Units) {
		t.Fatal("exam cap edit changed existing pane/clock/monitoring/frozen settings")
	}
}

func TestExecutionPolicyCollectionRetryPinsOwnArchiveLimits(t *testing.T) {
	e, _, work := finalFixture(t, "ACTIVE", Millis()+5400000)
	key := commandKeys(t, e)
	if err := e.WithState(func() error {
		a := e.state.Attempts[finalID]
		a.Settings.CollectionFileMiB, a.Settings.CollectionTotalMiB = 1, 1
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	sparseCollectionFile(t, filepath.Join(work, "large.c"), mib+1)
	var revision atomic.Int64
	revision.Store(1)
	server := executionPolicyServer(t, e, key, func(reply map[string]any) {
		p := executionPolicyFixture()
		p.Revision = revision.Load()
		if p.Revision == 1 {
			p.CollectionFileMiB, p.CollectionTotalMiB = 1, 1
		}
		reply["policy"] = p
	})
	before := inspectFinal(t, e)
	if _, err := e.Call("finalize-attempt", Request{ID: finalID, Reason: "student finish"}); err == nil || !strings.Contains(err.Error(), "per-file logical size exceeded") {
		t.Fatal("current smaller cap did not fail isolated collection", err)
	}
	failed := inspectFinal(t, e)
	var failedJob string
	if err := e.WithState(func() error {
		a := e.state.Attempts[finalID]
		failedJob = a.CollectionJob
		if a.State != "COLLECTION_FAILED" || a.Protected || a.CollectionPolicy == nil || e.Busy(a.UID) == nil {
			t.Fatal("collection cap failure released work/account or lost job pin", a)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(work, "large.c")); err != nil {
		t.Fatal("failed collection discarded frozen working files", err)
	}
	revision.Store(2)
	if _, err := e.Call("finalize-attempt", Request{ID: finalID, Reason: "retry after exam setting edit"}); err != nil {
		t.Fatal("new explicit retry did not fetch raised exam caps", err)
	}
	completed := inspectFinal(t, e)
	if completed.State != "COMPLETED" || !completed.Protected || completed.Settings != before.Settings || completed.Deadline != before.Deadline || completed.Ended != failed.Ended {
		t.Fatal("retry changed protected timing/saved settings", completed)
	}
	dest := filepath.Join(e.Config.State, "submissions", finalID)
	m, err := ReadProtected(dest, completed)
	if err != nil || m.CollectionPolicy == nil || m.CollectionPolicy.Policy.Revision != 2 || m.CollectionPolicy.Job == failedJob || m.Attempt.CollectionJob != m.CollectionPolicy.Job || m.Attempt.CollectionPolicy != nil {
		t.Fatal("archive lost exact new job policy or included duplicate private policy", m, err)
	}
	// Restart and a web outage do not invalidate immutable protected bytes.
	server.Close()
	restarted, err := New(e.Config)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := restarted.verifiedManifest(finalID); err != nil {
		t.Fatal("archive reader required current policy/network instead of its own pinned caps", err)
	}
	if _, err := protectedCollectionBounds(dest, completed); err != nil {
		t.Fatal("retention/cleanup metadata preflight still applied old frozen caps", err)
	}
	if _, err := restarted.verifySourceRetentionArchive(completed); err != nil {
		t.Fatal("saved-work retention still applied old frozen archive caps", err)
	}
	entries := make([]workspaceCleanupEntry, 0, len(m.Files))
	for _, file := range m.Files {
		entries = append(entries, workspaceCleanupEntry{Path: "work/" + file.Path, Size: file.Size, Hash: file.Hash, Mode: 0100000 | 0600})
	}
	if err := restarted.validateCleanupArchive(completed, entries); err != nil {
		t.Fatal("cleanup archive verification rejected its own pinned caps", err)
	}
	// Reusing those verified files is allowed by the target's current caps,
	// while a newly lowered target cap still refuses staging without discarding it.
	restarted.Config.Accounts = map[string]Account{"student": {UID: os.Getuid(), GID: os.Getgid()}}
	target := &Attempt{ID: recoveryID, Exam: "recovery", Username: "student", UID: os.Getuid(), Settings: Settings{CollectionFileMiB: 1, CollectionTotalMiB: 1}}
	saved := &RecoveryPreparation{SourceAttempt: finalID}
	restore := filepath.Join(t.TempDir(), "work")
	if err := os.Mkdir(restore, 0700); err != nil {
		t.Fatal(err)
	}
	if err := restarted.restoreRecoveryFiles(target, saved, m, restore, collectionBounds{File: mib, Total: mib}); err == nil {
		t.Fatal("target's newly lowered limits did not refuse staging")
	}
	if err := restarted.restoreRecoveryFiles(target, saved, m, restore, collectionBounds{File: 2 * mib, Total: 4 * mib}); err != nil {
		t.Fatal("saved-work extraction ignored source archive/target live bounds", err)
	}
	if info, err := os.Stat(filepath.Join(restore, "large.c")); err != nil || info.Size() != mib+1 {
		t.Fatal("saved-work extraction lost source bytes", err)
	}
	if _, err := collectionBoundsForManifest(&Manifest{Attempt: m.Attempt, CollectionPolicy: &CollectionExecutionPolicy{Job: Token(), Policy: m.CollectionPolicy.Policy}}); err == nil {
		t.Fatal("archive policy accepted mismatched collection job")
	}
}

func TestExecutionPolicyPublishedArchiveAdoptsOriginalJobOffline(t *testing.T) {
	e, _, work := finalFixture(t, "ACTIVE", Millis()+5400000)
	key := commandKeys(t, e)
	server := executionPolicyServer(t, e, key, func(map[string]any) {})
	proof, err := e.refreshExecutionPolicy("exam")
	if err != nil {
		t.Fatal(err)
	}
	var archived Attempt
	if err := e.WithState(func() error {
		a := e.state.Attempts[finalID]
		a.Settings.CollectionFileMiB, a.Settings.CollectionTotalMiB = 1, 1
		a.State, a.Reason, a.Ended, a.CompletedAt = "FINALIZING", "student finish", Millis(), Millis()
		a.CollectionJob = Token()
		a.CollectionPolicy = &CollectionExecutionPolicy{Job: a.CollectionJob, Policy: proof.policy}
		archived = *a
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	sparseCollectionFile(t, filepath.Join(work, "large.c"), mib+1)
	dest := filepath.Join(e.Config.State, "submissions", finalID)
	if _, err := Collect(work, dest, &archived); err != nil {
		t.Fatal(err)
	}
	if err := e.WithState(func() error {
		a := e.state.Attempts[finalID]
		// Model publication followed by coordinator failure and explicit retry.
		a.State, a.CompletedAt, a.CollectionPolicy = "COLLECTION_FAILED", 0, nil
		a.CollectionJob = Token()
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	server.Close()
	if err := os.RemoveAll(work); err != nil {
		t.Fatal(err)
	}
	restarted, err := New(e.Config)
	if err != nil {
		t.Fatal(err)
	}
	restarted.quiesce = func(*Attempt) error { t.Fatal("published protected archive was recollected"); return nil }
	restarted.terminate = func(*Attempt) error { return nil }
	if _, err := restarted.Call("finalize-attempt", Request{ID: finalID, Reason: "retry"}); err != nil {
		t.Fatal("published archive adoption required fresh web policy/live work", err)
	}
	if err := restarted.WithState(func() error {
		a := restarted.state.Attempts[finalID]
		if a.State != "COMPLETED" || !a.Protected || a.CollectionJob != archived.CollectionJob || !sameCollectionPolicy(a.CollectionPolicy, archived.CollectionPolicy) {
			t.Fatal("adoption changed original archive job/policy", a)
		}
		if _, err := collectionBoundsForAttempt(a); err != nil {
			t.Fatal("adoption left inconsistent state policy/job", err)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestExecutionPolicyPublicManifestAndCallbacksRetainOnlyPolicyJobBinding(t *testing.T) {
	e, _, _ := finalFixture(t, "ACTIVE", Millis()+5400000)
	key := commandKeys(t, e)
	var delivered atomic.Bool
	executionPolicyServer(t, e, key, func(map[string]any) {}, func(body []byte) {
		var event CallbackEvent
		if json.Unmarshal(body, &event) != nil || event.Agent != "class" {
			t.Error("actual signed callback lost its native agent scope")
			return
		}
		if event.Manifest != nil && event.Manifest.CollectionPolicy != nil {
			delivered.Store(true)
			if event.Manifest.Attempt.CollectionJob != event.Manifest.CollectionPolicy.Job || event.Manifest.Attempt.CollectionPolicy != nil || event.Attempt.CollectionJob != "" {
				t.Error("actual signed callback lost archive job or exposed private status authority")
			}
			t.Logf("PUBLIC_POLICY_CALLBACK_JSON %s", body)
		}
	})
	if _, err := e.Call("finalize-attempt", Request{ID: finalID, Reason: "synthetic public manifest projection"}); err != nil {
		t.Fatal(err)
	}
	m, err := e.verifiedManifest(finalID) // Actual public manifest entry used by examctl.
	if err != nil || m.CollectionPolicy == nil || m.Attempt.CollectionJob == "" || m.Attempt.CollectionJob != m.CollectionPolicy.Job || m.Attempt.CollectionPolicy != nil || m.Attempt.Transport != "" {
		t.Fatal("public manifest lost archive job binding or exposed private authority", m, err)
	}
	encodedManifest, _ := json.Marshal(m)
	t.Logf("PUBLIC_POLICY_MANIFEST_JSON %s", encodedManifest)
	if err := e.WithState(func() error {
		found := false
		for _, event := range e.state.Events {
			if event.Manifest == nil || event.Manifest.CollectionPolicy == nil {
				continue
			}
			found = true
			if event.Manifest.Attempt.CollectionJob != event.Manifest.CollectionPolicy.Job || event.Manifest.Attempt.CollectionPolicy != nil || event.Attempt.CollectionJob != "" {
				t.Fatal("actual persisted callback lost manifest job binding or exposed private status authority")
			}
		}
		if !found {
			t.Fatal("regression never reached an actual protected manifest callback")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := e.DeliverCallbacks(); err != nil || !delivered.Load() {
		t.Fatal("regression never delivered an actual signed manifest callback", err)
	}
}

func TestExecutionPolicySignedPolicyCannotUseLegacyFixtureFallback(t *testing.T) {
	e, key, cmd := leaseFixture(t)
	policy := executionPolicyFixture()
	cmd.Op, cmd.Body = "issue-channel-admission", Request{ID: finalID, Username: "student", Transport: "ssh-a", Pane: "33333333-1234-4234-8234-123456789abc", Purpose: "exam", ExecutionPolicy: &policy}
	if _, err := e.Command(signedCommand(key, cmd), "student", "ssh-a"); err == nil {
		t.Fatal("supplied signed live policy silently used legacy no-outbound fallback")
	}
}

func TestExecutionPolicyBlockedFetchDoesNotBlockStateOrRenewal(t *testing.T) {
	e, key, cmd := leaseFixture(t)
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	executionPolicyServer(t, e, key, func(map[string]any) {
		once.Do(func() { close(entered) })
		<-release
	})
	done := make(chan error, 1)
	go func() { _, err := e.refreshExecutionPolicy("exam"); done <- err }()
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		close(release)
		t.Fatal("never reached real authenticated outbound policy request")
	}
	other, err := New(e.Config)
	if err != nil {
		close(release)
		t.Fatal(err)
	}
	renewed := make(chan error, 1)
	go func() { _, err := other.Command(signedCommand(key, cmd), "student", "ssh-a"); renewed <- err }()
	select {
	case err := <-renewed:
		if err != nil {
			close(release)
			t.Fatal("independent signed monitoring renewal failed", err)
		}
	case <-time.After(time.Second):
		close(release)
		<-done
		t.Fatal("policy HTTP blocked shared state/monitoring renewal")
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}
