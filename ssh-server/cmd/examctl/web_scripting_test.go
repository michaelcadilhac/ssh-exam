package main

import (
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
	"sync"
	"syscall"
	"testing"
	"time"
)

type scriptCLIFixture struct {
	dir, config string
	invoke      func(...string) (string, string, int)
	streams     func(io.Reader, io.Writer, ...string) (string, int)
}

func TestScriptingActualCLIBatchRetainsArchivesAndResumesPartialOutcomes(t *testing.T) {
	var mu sync.Mutex
	plans := map[string]core.SourceRetentionPlan{}
	acks := map[string]bool{}
	drop := true
	var statePath string
	var stateBefore []byte
	f := newScriptCLIFixture(t, func(r map[string]any) (any, string, bool) {
		mu.Lock()
		defer mu.Unlock()
		b := r["body"].(map[string]any)
		id := b["id"].(string)
		plan, exists := plans[id]
		if !exists {
			t.Error("unexpected batch target", id)
			return nil, "wrong target", false
		}
		if r["operation"] == "grants.source-plan" {
			return plan, "", false
		}
		if r["operation"] != "grants.source-confirm" {
			t.Error("unexpected batch operation")
			return nil, "unsupported", false
		}
		pinPath := filepath.Join(filepath.Dir(statePath), "source-retentions", id+"-1.json")
		var pin core.GrantSourceRetention
		data, err := os.ReadFile(pinPath)
		if err != nil || json.Unmarshal(data, &pin) != nil || pin.Phase != "retained" || b["retention_hash"] != pin.RetentionHash {
			t.Error("ack before exact durable native pin", err)
		}
		request := r["request"].(string)
		acks[request] = true
		plan.Status = "AVAILABLE"
		plans[id] = plan
		result := map[string]any{"id": id, "revision": 1, "state": "RETAINED", "retention_hash": pin.RetentionHash, "status": "AVAILABLE"}
		lose := drop
		drop = false
		return result, "", lose
	})
	data, err := os.ReadFile(f.config)
	if err != nil {
		t.Fatal(err)
	}
	var c core.Config
	if json.Unmarshal(data, &c) != nil {
		t.Fatal("bad synthetic config")
	}
	c.State, c.Work = filepath.Join(f.dir, "native"), filepath.Join(f.dir, "work")
	for _, path := range []string{c.State, c.Work, filepath.Join(c.State, "submissions")} {
		if err := os.MkdirAll(path, 0700); err != nil {
			t.Fatal(err)
		}
	}
	data, _ = json.Marshal(c)
	if err := os.WriteFile(f.config, data, 0600); err != nil {
		t.Fatal(err)
	}
	sources := []string{"11111111-1234-4234-8234-123456789abc", "22222222-1234-4234-8234-123456789abc"}
	grants := []string{"44444444-1234-4234-8234-123456789abc", "55555555-1234-4234-8234-123456789abc"}
	users := []string{"alice", "bob"}
	state := core.State{Attempts: map[string]*core.Attempt{}, Caps: map[string]core.Capability{}, Registrations: map[string]string{}}
	settings := core.Settings{ID: "midterm", Name: "Synthetic batch", Template: "v1", TemplateVersion: strings.Repeat("b", 64), Duration: 5400, Webcam: true, Terminals: 2, Earliest: core.Millis() - 1000, Latest: core.Millis() + 600000}
	rows := []any{}
	issuedRows := []any{}
	for i, sourceID := range sources {
		work := filepath.Join(f.dir, users[i]+"-source")
		if err := os.Mkdir(work, 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(work, "answer.txt"), []byte("SYNTHETIC-"+users[i]), 0600); err != nil {
			t.Fatal(err)
		}
		a := &core.Attempt{ID: sourceID, Exam: "midterm-recovery", Username: users[i], UID: 29998 + i, State: "COMPLETED", Settings: core.Settings{ID: "midterm-recovery", Duration: 3600}, Start: core.Millis() - 7200000, Deadline: core.Millis() - 3600000, OriginalDeadline: core.Millis() - 3600000, AccessState: "RELEASED", PolicyState: "NORMAL"}
		a.Checksum, err = core.Collect(work, filepath.Join(c.State, "submissions", sourceID), a)
		if err != nil {
			t.Fatal(err)
		}
		a.Protected = true
		state.Attempts[sourceID] = a
		hash := strings.Repeat(string(rune('c'+i)), 64)
		workSource := grantWorkResult{Kind: "saved", Attempt: sourceID, Checksum: a.Checksum}
		plans[grants[i]] = core.SourceRetentionPlan{Version: 1, Agent: "class", Grant: &core.GrantBinding{ID: grants[i], Revision: 1, Hash: hash, Kind: "ADDITIONAL", Order: int64(2 + i), Work: &core.GrantWork{Kind: "saved", Attempt: sourceID, Checksum: a.Checksum}}, Exam: "midterm", Username: users[i], UID: a.UID, Settings: settings, Source: core.SourceRetentionSource{Attempt: sourceID, Checksum: a.Checksum}, Action: "retain", CurrentRevision: 1, Status: "PENDING_NATIVE"}
		rows = append(rows, map[string]any{"username": users[i], "settings": settings, "work": workSource, "hash": hash})
		issuedRows = append(issuedRows, map[string]any{"username": users[i], "grant": grants[i]})
	}
	stateBefore, _ = json.Marshal(state)
	statePath = filepath.Join(c.State, "state.json")
	if err := os.WriteFile(statePath, stateBefore, 0600); err != nil {
		t.Fatal(err)
	}
	archiveB := filepath.Join(c.State, "submissions", sources[1], "submission.tar.gz")
	originalB, err := os.ReadFile(archiveB)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(archiveB, []byte("CORRUPT-SYNTHETIC"), 0600); err != nil {
		t.Fatal(err)
	}
	body := map[string]any{"id": "33333333-1234-4234-8234-123456789abc", "revision": strings.Repeat("e", 64)}
	r, err := newScriptReceipt(c, "grants.issue-confirm", "", body)
	if err != nil {
		t.Fatal(err)
	}
	result := map[string]any{"id": body["id"], "kind": "NEW_ADDITIONAL_TEMPLATE_GRANTS", "agent": "class", "exam": "midterm", "actor": "agent:class:root", "reason": "Synthetic verified saved-work batch", "definition_revision": strings.Repeat("a", 64), "revision": body["revision"], "created": core.Millis(), "expires": core.Millis() + 900000, "status": "CONFIRMED", "rows": rows, "issued": issuedRows}
	raw, _ := json.Marshal(result)
	r.Outcome = "confirmed"
	r.Result = core.ManagementResult{Request: r.Request, Operation: r.Operation, Confirmed: true, Result: raw}
	issued := filepath.Join(f.dir, "issued.receipt")
	if err := saveScriptReceipt(issued, r, false); err != nil {
		t.Fatal(err)
	}
	journal := filepath.Join(f.dir, "sync.receipt")
	args := []string{"grants", "source-sync", "--from-receipt", issued, "--receipt", journal, "--resume", "--format", "table"}
	out, stderr, code := f.invoke(args...)
	if code != 1 || !strings.Contains(out, "alice") || !strings.Contains(out, "bob") {
		t.Fatal(code, out, stderr)
	}
	first, err := readScriptReceipt(journal)
	if err != nil {
		t.Fatal(err)
	}
	var refs []scriptSourceRef
	encoded, _ := json.Marshal(first.Body["grants"])
	if json.Unmarshal(encoded, &refs) != nil || len(refs) != 2 {
		t.Fatal("missing durable per-grant intents")
	}
	// With the first reply now recoverable but the second archive still corrupt,
	// human output must report both the successful and failing item, not fail to
	// render optional status/error fields and discard the whole report.
	out, stderr, code = f.invoke(args...)
	if code != 1 || !strings.Contains(out, "alice") || !strings.Contains(out, "bob") || !strings.Contains(out, "AVAILABLE") {
		t.Fatal("partial result report lost", code, out, stderr)
	}
	if err := os.WriteFile(archiveB, originalB, 0600); err != nil {
		t.Fatal(err)
	}
	out, stderr, code = f.invoke(args...)
	if code != 0 {
		t.Fatal(code, out, stderr)
	}
	mu.Lock()
	if len(acks) != 2 || !acks[refs[0].Request] || !acks[refs[1].Request] {
		t.Error("restart changed acknowledgement intent IDs", acks)
	}
	mu.Unlock()
	if current, err := os.ReadFile(statePath); err != nil || string(current) != string(stateBefore) {
		t.Fatal("source synchronization changed native attempts/clocks/holds")
	}
	full, err := os.OpenFile("/dev/full", os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer full.Close()
	for _, operation := range []string{"source-show", "source-sync"} {
		stderr, code := f.streams(nil, full, "grants", operation, grants[0], "--revision", "1", "--request", refs[0].Request)
		if code != 1 || !strings.Contains(stderr, "no space left") {
			t.Fatal("source output failure hidden", operation, code, stderr)
		}
	}
	mu.Lock()
	p := plans[grants[0]]
	p.Status, p.Action = "REVOKED", "release"
	plans[grants[0]] = p
	mu.Unlock()
	out, stderr, code = f.invoke(args...)
	if code != 1 {
		t.Fatal("revocation silently adopted", code, out, stderr)
	}
	engine := &core.Engine{Config: c}
	pin, err := engine.SourceRetention(grants[0], 1)
	if err != nil || pin.Phase != "retained" {
		t.Fatal("intended retain became a pin release", err)
	}
}

func newScriptCLIFixture(t *testing.T, handle func(map[string]any) (any, string, bool)) *scriptCLIFixture {
	t.Helper()
	if os.Getenv("EXAM_MANAGEMENT_USERNS") != "1" {
		t.Skip("requires root-mapped actual CLI/TLS opt-in")
	}
	dir := t.TempDir()
	if err := os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	// The external CLI's first connection is not a Go memory synchronization
	// primitive. Publish completed fixture setup explicitly to the HTTP actor.
	ready := make(chan struct{})
	var publish sync.Once
	agentPub, agentKey, _ := ed25519.GenerateKey(rand.Reader)
	gatewayPub, gatewayKey, _ := ed25519.GenerateKey(rand.Reader)
	private, _ := x509.MarshalPKCS8PrivateKey(agentKey)
	public, _ := x509.MarshalPKIXPublicKey(gatewayPub)
	for name, data := range map[string][]byte{"agent.key": pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: private}), "gateway.pub": pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: public})} {
		if err := os.WriteFile(filepath.Join(dir, name), data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		<-ready
		data, err := io.ReadAll(io.LimitReader(req.Body, 1024*1024))
		if err != nil {
			t.Error(err)
			w.WriteHeader(500)
			return
		}
		sig, _ := base64.StdEncoding.DecodeString(req.Header.Get("X-Exam-Signature"))
		if !ed25519.Verify(agentPub, data, sig) || req.URL.Path != "/api/agent/management" {
			t.Error("unsigned/wrong-route CLI request")
			w.WriteHeader(403)
			return
		}
		var request map[string]any
		if json.Unmarshal(data, &request) != nil {
			t.Error("invalid request")
			w.WriteHeader(400)
			return
		}
		value, refusal, drop := handle(request)
		if drop {
			connection, _, err := w.(http.Hijacker).Hijack()
			if err != nil {
				t.Error(err)
			} else {
				connection.Close()
			}
			return
		}
		response := map[string]any{"version": 1, "purpose": "ssh-exam-management/v1", "audience": "class", "request": request["request"], "nonce": request["nonce"], "operation": request["operation"], "at": core.Millis(), "ok": refusal == "", "status": 200, "result": value}
		if refusal != "" {
			response["status"], response["error"] = 409, refusal
		}
		payload, _ := json.Marshal(response)
		_ = json.NewEncoder(w).Encode(map[string]string{"payload": base64.StdEncoding.EncodeToString(payload), "signature": base64.StdEncoding.EncodeToString(ed25519.Sign(gatewayKey, payload))})
	}))
	t.Cleanup(server.Close)
	ca := filepath.Join(dir, "ca.crt")
	if err := os.WriteFile(ca, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: server.Certificate().Raw}), 0600); err != nil {
		t.Fatal(err)
	}
	c := core.Config{State: filepath.Join(dir, "unused-state"), Work: filepath.Join(dir, "unused-work"), Rootfs: dir, AgentID: "class", CallbackKey: filepath.Join(dir, "agent.key"), GatewayPublicKey: filepath.Join(dir, "gateway.pub"), CallbackURL: server.URL, CallbackCA: ca, Accounts: map[string]core.Account{"synthetic": {UID: 29999, GID: 29999, Home: dir, Shell: "/bin/bash"}}}
	config := filepath.Join(dir, "agent.json")
	data, _ := json.Marshal(c)
	if err := os.WriteFile(config, data, 0600); err != nil {
		t.Fatal(err)
	}
	f := &scriptCLIFixture{dir: dir, config: config}
	f.streams = func(input io.Reader, output io.Writer, args ...string) (string, int) {
		t.Helper()
		publish.Do(func() { close(ready) })
		ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
		defer cancel()
		words := []string{"--user", "--map-root-user", os.Args[0], "-test.run=^TestCLIEntry$", "--", "--config", config, "web"}
		words = append(words, args...)
		cmd := exec.CommandContext(ctx, "/usr/bin/unshare", words...)
		cmd.Env = append(os.Environ(), "EXAMCTL_TEST_ENTRY=1", "GORACE=atexit_sleep_ms=0")
		cmd.Stdin, cmd.Stdout = input, output
		var stderr strings.Builder
		cmd.Stderr = &stderr
		err := cmd.Run()
		if err == nil {
			return stderr.String(), 0
		}
		if exit, ok := err.(*exec.ExitError); ok {
			return stderr.String(), exit.ExitCode()
		}
		t.Fatal(err)
		return "", -1
	}
	f.invoke = func(args ...string) (string, string, int) {
		var out strings.Builder
		err, code := f.streams(nil, &out, args...)
		return out.String(), err, code
	}
	return f
}

func TestScriptingDiscoveryAndSyntaxBeforeAuthority(t *testing.T) {
	for _, args := range [][]string{{"help", "scripting"}, {"web", "grants", "--format", "table", "--help"}} {
		out, code := cliProcess(t, args...)
		if code != 0 || !strings.Contains(out, "--from-receipt") || !strings.Contains(out, "--all") {
			t.Fatal(code, out)
		}
	}
	for _, args := range [][]string{{"web", "attempts", "list", "--all", "--format", "bogus"}, {"web", "students", "list", "midterm", "--all", "--request", "12345678-1234-4234-8234-123456789abc"}, {"web", "grants", "issue-confirm", "--format", "table"}} {
		out, code := cliProcess(t, args...)
		if code != 2 || !strings.Contains(out, "scripting") {
			t.Fatal(code, out)
		}
	}
	for _, name := range []string{"saved-sources", "input", "receipt", "from-receipt", "definition-from", "output", "fields", "request", "username", "webcam"} {
		out, code := cliProcess(t, "--config", "/missing/config", "web", "grants", "additional-preview", "midterm", "alice", "--format", "table", "--"+name, "")
		if code != 2 || !strings.Contains(out, "cannot be empty") || strings.Contains(out, "Load root") {
			t.Fatal("empty flag became a fallback or reached authority", name, code, out)
		}
	}
}

func scriptAttempt(id, exam string) map[string]any {
	return map[string]any{"id": id, "exam": exam, "username": "alice", "uid": 10001, "start": 1000, "deadline": 61000, "original_deadline": 61000, "ended": 61000, "state": "COMPLETED", "protected": 1, "checksum": strings.Repeat("a", 64)}
}

func TestScriptingActualCLICompleteExportsAndNoPartialOutput(t *testing.T) {
	var mu sync.Mutex
	mode := "ok"
	requests := map[string]bool{}
	calls := 0
	f := newScriptCLIFixture(t, func(r map[string]any) (any, string, bool) {
		mu.Lock()
		defer mu.Unlock()
		calls++
		id := r["request"].(string)
		if requests[id] {
			t.Error("pagination reused a cached request ID")
		}
		requests[id] = true
		b := r["body"].(map[string]any)
		exam := b["exam"].(string)
		after, _ := b["after"].(string)
		if after == "" {
			return map[string]any{"attempts": []any{}, "next": "11111111-1234-4234-8234-123456789abc", "scanned": 1}, "", false
		}
		if mode == "refuse" {
			return nil, "synthetic second-page refusal", false
		}
		row := scriptAttempt("22222222-1234-4234-8234-123456789abc", exam)
		if mode == "private" {
			row["callback_key"] = "PRIVATE-SENTINEL"
		}
		if mode == "wrong-exam" {
			row["exam"] = "other"
		}
		if mode == "control" {
			row["work_path"] = "unsafe\tpath"
		}
		var next any
		if mode == "cycle" {
			next = after
		}
		return map[string]any{"attempts": []any{row}, "next": next, "scanned": 1}, "", false
	})
	args := []string{"attempts", "list", "--exam", "midterm", "--exam", "midterm-recovery", "--all", "--view", "secured", "--format", "tsv", "--fields", "username,start,id,checksum", "--no-header"}
	out, stderr, code := f.invoke(args...)
	if code != 0 || strings.Count(out, "alice\t1000\t") != 2 || strings.Contains(out, "\"request\"") {
		t.Fatal(code, out, stderr)
	}
	mu.Lock()
	if calls != 4 {
		t.Error("empty filtered page or second exam omitted", calls)
	}
	mu.Unlock()
	for _, scenario := range []string{"refuse", "private", "wrong-exam", "cycle", "control"} {
		mu.Lock()
		mode = scenario
		mu.Unlock()
		selected := append([]string{}, args...)
		if scenario == "control" {
			for i := range selected {
				if selected[i] == "username,start,id,checksum" {
					selected[i] = "work_path"
				}
			}
		}
		out, stderr, code = f.invoke(selected...)
		if code != 1 || out != "" || strings.Contains(stderr, "PRIVATE-SENTINEL") {
			t.Fatal(scenario, code, out, stderr)
		}
	}
	if _, err := os.Stat(filepath.Join(f.dir, "unused-state")); !os.IsNotExist(err) {
		t.Fatal("metadata export initialized native state")
	}
}

func TestScriptingActualCLIEmptyFinalExportIsEmptyRowsNotEnvelope(t *testing.T) {
	f := newScriptCLIFixture(t, func(r map[string]any) (any, string, bool) {
		if r["operation"] != "grants.list" {
			t.Error("unexpected operation")
		}
		return map[string]any{"grants": []any{}, "next": nil}, "", false
	})
	for _, format := range []string{"tsv", "csv", "table", "jsonl", "json"} {
		args := []string{"grants", "list", "midterm", "--all", "--format", format, "--fields", "id,status,username"}
		if format != "json" && format != "jsonl" {
			args = append(args, "--no-header")
		}
		out, stderr, code := f.invoke(args...)
		if code != 0 {
			t.Fatalf("empty %s export refused: %d %s %s", format, code, out, stderr)
		}
		if format == "json" {
			var result struct {
				Result struct {
					Grants []any `json:"grants"`
				} `json:"result"`
			}
			if json.Unmarshal([]byte(out), &result) != nil || result.Result.Grants == nil || len(result.Result.Grants) != 0 {
				t.Fatal("empty export lost its array", out)
			}
		} else if out != "" {
			t.Fatal("empty export emitted an envelope as a row", format, out)
		}
	}
}

func TestScriptingActualCLIDurableReceiptLostReplyAndConfirmedRefusal(t *testing.T) {
	var mu sync.Mutex
	calls, confirmations := 0, 0
	cache := map[string]any{}
	drop := true
	refuse := false
	var f *scriptCLIFixture
	previewID := "33333333-1234-4234-8234-123456789abc"
	grantID := "44444444-1234-4234-8234-123456789abc"
	var reviewed map[string]any
	f = newScriptCLIFixture(t, func(r map[string]any) (any, string, bool) {
		mu.Lock()
		defer mu.Unlock()
		calls++
		op := r["operation"].(string)
		b := r["body"].(map[string]any)
		if op == "exams.show" {
			v := examReplyFixture()
			v["exam"].(map[string]any)["template_version"] = strings.Repeat("b", 64)
			return v, "", false
		}
		name := "review.receipt"
		if op == "grants.issue-confirm" {
			name = "issued.receipt"
			if refuse {
				name = "refused.receipt"
			}
		}
		data, err := os.ReadFile(filepath.Join(f.dir, name))
		var intent scriptReceipt
		if err != nil || json.Unmarshal(data, &intent) != nil || intent.Request != r["request"] || intent.Outcome != "unknown" {
			t.Error("mutation reached server before durable request publication", op, err)
		}
		if refuse {
			return nil, "synthetic confirmed policy refusal", false
		}
		if op == "grants.additional-preview" {
			settings := map[string]any{"id": "midterm", "name": "Midterm", "template": "v1", "template_version": b["template_version"], "duration": b["duration"], "webcam": true, "terminals": 4, "earliest": b["earliest"], "latest": b["latest"]}
			reviewed = map[string]any{"id": previewID, "kind": "NEW_ADDITIONAL_TEMPLATE_GRANTS", "agent": "class", "actor": "agent:class:root", "exam": "midterm", "reason": b["reason"], "definition_revision": b["definition_revision"], "revision": strings.Repeat("c", 64), "created": core.Millis(), "expires": core.Millis() + 900000, "status": "REVIEW", "rows": []any{map[string]any{"username": "alice", "settings": settings, "work": grantWorkResult{Kind: "template", Name: "v1", Hash: strings.Repeat("b", 64)}, "hash": strings.Repeat("d", 64)}}, "issued": []any{}}
			return reviewed, "", false
		}
		if value, ok := cache[r["request"].(string)]; ok {
			return value, "", false
		}
		if op != "grants.issue-confirm" {
			t.Error("unexpected operation", op)
			return nil, "unsupported", false
		}
		confirmations++
		reviewed["status"] = "CONFIRMED"
		reviewed["issued"] = []any{map[string]any{"username": "alice", "grant": grantID}}
		cache[r["request"].(string)] = reviewed
		lose := drop
		drop = false
		return reviewed, "", lose
	})
	definition := filepath.Join(f.dir, "definition.receipt")
	review := filepath.Join(f.dir, "review.receipt")
	issued := filepath.Join(f.dir, "issued.receipt")
	if out, err, code := f.invoke("exams", "show", "midterm", "--receipt", definition); code != 0 {
		t.Fatal(code, out, err)
	}
	args := []string{"grants", "additional-preview", "midterm", "alice", "--definition-from", definition, "--duration-minutes", "90", "--earliest", time.Now().Add(-time.Minute).Format(time.RFC3339), "--latest", time.Now().Add(time.Hour).Format(time.RFC3339), "--reason", "Synthetic reviewed additional attempt", "--receipt", review, "--format", "table"}
	if out, err, code := f.invoke(args...); code != 0 || !strings.Contains(out, "alice") {
		t.Fatal(code, out, err)
	}
	confirm := []string{"grants", "issue-confirm", "--from-receipt", review, "--receipt", issued, "--resume", "--error-format", "json"}
	if out, err, code := f.invoke(confirm...); code != 1 || out != "" || !strings.Contains(err, `"outcome":"unknown"`) {
		t.Fatal(code, out, err)
	}
	if out, err, code := f.invoke(confirm...); code != 0 || !strings.Contains(out, `"CONFIRMED"`) {
		t.Fatal(code, out, err)
	}
	mu.Lock()
	before := calls
	if confirmations != 1 {
		t.Error("lost reply duplicated grant confirmation", confirmations)
	}
	mu.Unlock()
	if out, err, code := f.invoke(confirm...); code != 0 {
		t.Fatal(code, out, err)
	}
	mu.Lock()
	if calls != before {
		t.Error("confirmed durable retry contacted gateway again")
	}
	mu.Unlock()
	for _, name := range []string{definition, review, issued} {
		info, err := os.Stat(name)
		if err != nil || info.Mode().Perm() != 0600 {
			t.Fatal("unsafe receipt", name, err)
		}
	}
	args[7] = "91" // Changing an allowance cannot be adopted by receipt retry.
	if out, _, code := f.invoke(append(args, "--resume")...); code != 1 || out != "" {
		t.Fatal("changed intent accepted", code, out)
	}
	mu.Lock()
	if calls != before {
		t.Error("changed intent reached gateway")
	}
	refuse = true
	mu.Unlock()
	other := filepath.Join(f.dir, "refused.receipt")
	args = []string{"grants", "issue-confirm", "--from-receipt", review, "--receipt", other, "--resume", "--error-format", "json"}
	if out, err, code := f.invoke(args...); code != 1 || out != "" || !strings.Contains(err, `"outcome":"refused"`) {
		t.Fatal(code, out, err)
	}
	mu.Lock()
	before = calls
	refuse = false
	mu.Unlock()
	if _, err, code := f.invoke(args...); code != 1 || !strings.Contains(err, `"outcome":"refused"`) {
		t.Fatal(code, err)
	}
	mu.Lock()
	if calls != before {
		t.Error("cached signed refusal silently became a new intent")
	}
	mu.Unlock()
}

func TestScriptingPrivateReceiptsAndTransportConfiguration(t *testing.T) {
	f := newScriptCLIFixture(t, func(map[string]any) (any, string, bool) {
		t.Error("private metadata checks must not contact authority")
		return nil, "unexpected", false
	})
	var c core.Config
	data, _ := os.ReadFile(f.config)
	if err := json.Unmarshal(data, &c); err != nil {
		t.Fatal(err)
	}
	r, err := newScriptReceipt(c, "exams.show", "", map[string]any{"id": "midterm"})
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(f.dir, "intent.receipt")
	if err := saveScriptReceipt(path, r, false); err != nil {
		t.Fatal(err)
	}
	if err := saveScriptReceipt(path, r, false); err == nil {
		t.Fatal("receipt overwritten")
	}
	if _, err := readScriptReceipt(path); err != nil {
		t.Fatal(err)
	}
	original, _ := os.ReadFile(path)
	for _, kind := range []string{"mode", "symlink", "hardlink", "fifo", "body", "wire"} {
		other := filepath.Join(f.dir, kind+".receipt")
		switch kind {
		case "symlink":
			err = os.Symlink(path, other)
		case "hardlink":
			err = os.Link(path, other)
		case "fifo":
			err = syscall.Mkfifo(other, 0600)
		default:
			content := original
			if kind == "body" {
				content = []byte(strings.Replace(string(original), `"body": {`, `"body": {"changed":true,`, 1))
			}
			if kind == "wire" {
				content = []byte(strings.Replace(string(original), `"wire_body": {`, `"wire_body": {"changed":true,`, 1))
			}
			err = os.WriteFile(other, content, 0600)
			if kind == "mode" && err == nil {
				err = os.Chmod(other, 0644)
			}
		}
		if err != nil {
			t.Fatal(err)
		}
		if _, err := readScriptReceipt(other); err == nil {
			t.Fatal("unsafe receipt accepted", kind)
		}
		if err := os.Remove(other); err != nil {
			t.Fatal(err)
		}
	}
	changed := c
	changed.AgentID = "another"
	if r.checkContext(changed) == nil {
		t.Fatal("foreign context accepted")
	}
	for _, key := range []string{"HTTPS_PROXY", "https_proxy", "NO_PROXY", "no_proxy"} {
		t.Setenv(key, "")
	}
	proxyFile := filepath.Join(f.dir, "examctl.json")
	if err := os.WriteFile(proxyFile, []byte(`{"https_proxy":"http://127.0.0.1:3128","no_proxy":"localhost"}`), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := scriptLoadConfig(f.config); err != nil {
		t.Fatal(err)
	}
	if os.Getenv("HTTPS_PROXY") != "http://127.0.0.1:3128" || os.Getenv("NO_PROXY") != "localhost" {
		t.Fatal("protected CLI proxy not loaded")
	}
	t.Setenv("HTTPS_PROXY", "http://127.0.0.1:3129")
	if _, err := scriptLoadConfig(f.config); err != nil || os.Getenv("HTTPS_PROXY") != "http://127.0.0.1:3129" {
		t.Fatal("environment override lost", err)
	}
	if err := os.WriteFile(proxyFile, []byte(`{"https_proxy":"http://127.0.0.1:3128","insecure":true}`), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := scriptLoadConfig(f.config); err == nil {
		t.Fatal("verification override accepted")
	}
}

func TestTemplateSyncActualCLIHonorsProtectedProxyBeforeNativeWork(t *testing.T) {
	f := newScriptCLIFixture(t, func(map[string]any) (any, string, bool) {
		return nil, "unexpected network operation", false
	})
	proxy := filepath.Join(f.dir, "examctl.json")
	if err := os.WriteFile(proxy, []byte(`{"https_proxy":"http://unsafe_proxy_secret@127.0.0.1:3128"}`), 0600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	words := []string{"--user", "--map-root-user", os.Args[0], "-test.run=^TestCLIEntry$", "--", "--config", f.config,
		"templates", "sync", "midterm", strings.Repeat("a", 64), "--reason", "Synthetic protected proxy refusal"}
	cmd := exec.CommandContext(ctx, "/usr/bin/unshare", words...)
	cmd.Env = append(os.Environ(), "EXAMCTL_TEST_ENTRY=1", "GORACE=atexit_sleep_ms=0")
	out, err := cmd.CombinedOutput()
	if exit, ok := err.(*exec.ExitError); !ok || exit.ExitCode() != 1 || !strings.Contains(string(out), "examctl.json requires HTTP(S) proxy origin without credentials or paths") || strings.Contains(string(out), "unsafe_proxy_secret") {
		t.Fatalf("native template sync ignored protected CLI transport or leaked it: %v %s", err, out)
	}
}

func TestScriptingActualCLIStdinProjectionAndOutputFailure(t *testing.T) {
	var mu sync.Mutex
	calls := 0
	f := newScriptCLIFixture(t, func(r map[string]any) (any, string, bool) {
		mu.Lock()
		defer mu.Unlock()
		calls++
		if r["operation"] == "attempts.list" {
			return map[string]any{"attempts": []any{scriptAttempt("22222222-1234-4234-8234-123456789abc", "midterm")}, "next": nil, "scanned": 1}, "", false
		}
		b := r["body"].(map[string]any)
		if r["operation"] != "grants.additional-preview" {
			t.Error("unexpected operation")
		}
		if b["duration"] != float64(6000) {
			t.Error("stdin source/settings lost", b)
		}
		if work, ok := b["work"].(map[string]any); ok {
			if _, saved := b["saved_sources"]; saved {
				t.Error("shared starter also sent saved sources", b)
			}
			switch work["kind"] {
			case "empty":
				if len(work) != 1 {
					t.Error("empty source leaked other source fields", work)
				}
			case "template":
				if len(work) != 3 || work["name"] != "v1" || work["hash"] != strings.Repeat("b", 64) {
					t.Error("template source does not match strict wire union", work)
				}
			default:
				t.Error("unexpected starter", work)
			}
		} else if sources, ok := b["saved_sources"].([]any); !ok || len(sources) != 1 {
			t.Error("saved source lost", b)
		}
		if rows, ok := b["student_settings"].([]any); ok {
			row := rows[0].(map[string]any)
			if row["duration"] != float64(6000) || row["webcam"] != false || row["username"] != "alice" {
				t.Error("per-student values lost", row)
			}
		}
		return nil, "synthetic exact input reached review policy", false
	})
	args := []string{"grants", "additional-preview", "midterm", "--definition-revision", strings.Repeat("a", 64), "--template-version", strings.Repeat("b", 64), "--earliest", time.Now().Add(-time.Minute).Format(time.RFC3339), "--latest", time.Now().Add(time.Hour).Format(time.RFC3339), "--reason", "Synthetic stdin source review", "--format", "table"}
	csvInput := "username,attempt,checksum,duration_seconds,require_webcam\nalice,22222222-1234-4234-8234-123456789abc," + strings.Repeat("a", 64) + ",6000,false\n"
	jsonInput := `{"username":"alice","settings":{"duration":6000,"webcam":false},"work":{"kind":"saved","attempt":"22222222-1234-4234-8234-123456789abc","checksum":"` + strings.Repeat("a", 64) + `"}}`
	templateInput := `{"username":"alice","settings":{"duration":6000,"webcam":false},"work":{"kind":"template","name":"v1","hash":"` + strings.Repeat("b", 64) + `"}}`
	emptyInput := `{"username":"alice","settings":{"duration":6000,"webcam":false},"work":{"kind":"empty"}}`
	for _, input := range []string{csvInput, jsonInput, templateInput, emptyInput} {
		var out strings.Builder
		stderr, code := f.streams(strings.NewReader(input), &out, append(append([]string{}, args...), "--input", "-")...)
		if code != 1 || out.Len() != 0 || !strings.Contains(stderr, "synthetic exact input") {
			t.Fatal(code, out.String(), stderr)
		}
	}
	var savedOut strings.Builder
	savedCSV := "username,attempt,checksum\nalice,22222222-1234-4234-8234-123456789abc," + strings.Repeat("a", 64) + "\n"
	if stderr, code := f.streams(strings.NewReader(savedCSV), &savedOut, append(append([]string{}, args...), "--saved-sources", "-", "--duration-seconds", "6000")...); code != 1 || !strings.Contains(stderr, "synthetic exact input") {
		t.Fatal(code, stderr)
	}
	bad := strings.Replace(csvInput, ",6000,false", ",0,false", 1)
	var out strings.Builder
	if stderr, code := f.streams(strings.NewReader(bad), &out, append(append([]string{}, args...), "--input", "-")...); code != 2 || !strings.Contains(stderr, "duration") {
		t.Fatal(code, stderr)
	}
	mu.Lock()
	if calls != 5 {
		t.Error("malformed input reached authority", calls)
	}
	mu.Unlock()
	for _, format := range []string{"json", "jsonl"} {
		stdout, stderr, code := f.invoke("attempts", "list", "--exam", "midterm", "--all", "--format", format, "--fields", "username,start")
		if code != 0 || !strings.Contains(stdout, `"username":"alice"`) || strings.Contains(stdout, `"checksum"`) {
			t.Fatal(code, stdout, stderr)
		}
	}
	full, err := os.OpenFile("/dev/full", os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer full.Close()
	stderr, code := f.streams(nil, full, "attempts", "list", "--exam", "midterm", "--all", "--format", "tsv", "--fields", "username")
	if code != 1 || !strings.Contains(stderr, "no space left") {
		t.Fatal("write failure hidden", code, stderr)
	}
	path := filepath.Join(f.dir, "export.tsv")
	if stdout, stderr, code := f.invoke("attempts", "list", "--exam", "midterm", "--all", "--format", "tsv", "--fields", "username", "--output", path); code != 0 || stdout != "" {
		t.Fatal(code, stdout, stderr)
	}
	before, _ := os.ReadFile(path)
	if _, _, code := f.invoke("attempts", "list", "--exam", "midterm", "--all", "--format", "tsv", "--fields", "username", "--output", path); code != 1 {
		t.Fatal("export overwritten")
	}
	after, _ := os.ReadFile(path)
	if string(before) != string(after) {
		t.Fatal("existing output changed")
	}
}
