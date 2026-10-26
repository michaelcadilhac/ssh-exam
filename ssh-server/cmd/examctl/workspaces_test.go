package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"examworkspace/agent/internal/core"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"syscall"
	"testing"
)

func TestWorkspaceHelpAndSyntaxWithoutRootOrConfiguration(t *testing.T) {
	for _, args := range [][]string{{"help", "workspaces"}, {"workspaces", "help"}, {"--config", "/missing", "workspaces", "--help"}} {
		out, code := cliProcess(t, args...)
		for _, want := range []string{"Usage:", "--revision", "--reason", "Offline", "candidate=true", "eligible=false", "NO WORKSPACE DELETION", "Exit status:"} {
			if code != 0 || !strings.Contains(out, want) {
				t.Fatal(want, code, out)
			}
		}
	}
	id := "12345678-1234-4234-8234-123456789abc"
	for _, args := range [][]string{
		{"workspaces"}, {"workspaces", "cleanup", id}, {"workspaces", "show", id, "--exam", "e"},
		{"workspaces", "hold", id, "--reason", "Reviewed reason"}, {"workspaces", "release-hold", id, "--revision", "0"},
		{"workspaces", "hold", id, "--revision", "-1", "--reason", "Reviewed reason"}, {"workspaces", "list", "--limit", "201"},
	} {
		out, code := cliProcess(t, args...)
		if code != 2 || !strings.Contains(out, "help") || strings.Contains(out, "Cannot load") {
			t.Fatal("invalid syntax reached root/config", code, out)
		}
	}
}

func TestWorkspaceCLIInRootUserNamespace(t *testing.T) {
	if os.Getenv("EXAM_MANAGEMENT_USERNS") != "1" {
		t.Skip("set EXAM_MANAGEMENT_USERNS=1 for actual namespace-root workspace CLI checks")
	}
	dir := t.TempDir()
	pub, key, _ := ed25519.GenerateKey(rand.Reader)
	pubDER, _ := x509.MarshalPKIXPublicKey(pub)
	keyDER, _ := x509.MarshalPKCS8PrivateKey(key)
	pubPath, keyPath := filepath.Join(dir, "gateway.pub"), filepath.Join(dir, "agent.key")
	if err := os.WriteFile(pubPath, pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pubDER}), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(keyPath, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER}), 0600); err != nil {
		t.Fatal(err)
	}
	c := core.Config{State: filepath.Join(dir, "state"), Work: filepath.Join(dir, "work"), Rootfs: dir, Templates: dir, AgentID: "class", CallbackURL: "https://unused.example.edu", CallbackKey: keyPath, GatewayPublicKey: pubPath,
		Accounts: map[string]core.Account{"student": {UID: 29999, GID: 29999, Home: dir, Shell: "/bin/bash"}}}
	const id = "12345678-1234-4234-8234-123456789abc"
	work := filepath.Join(c.Work, id, "work")
	for _, p := range []string{c.State, work} {
		if err := os.MkdirAll(p, 0700); err != nil {
			t.Fatal(err)
		}
	}
	answer := filepath.Join(work, "answer.txt")
	if err := os.WriteFile(answer, []byte("synthetic protected answer"), 0600); err != nil {
		t.Fatal(err)
	}
	// Match the actual preparation producer's default exam-visible directory;
	// the host target above is deliberately a different path.
	state := core.State{Attempts: map[string]*core.Attempt{id: {ID: id, Exam: "midterm", Username: "student", UID: 29999, State: "COMPLETED", Start: 1, Ended: 2, Deadline: core.Millis() + 3600000, OriginalDeadline: core.Millis() + 7200000, Protected: true, Checksum: strings.Repeat("a", 64), AccessState: "HELD", WorkPath: "/work"}}, Caps: map[string]core.Capability{}, Registrations: map[string]string{}}
	writeJSON := func(path string, v any) {
		t.Helper()
		b, err := json.Marshal(v)
		if err == nil {
			err = os.WriteFile(path, b, 0600)
		}
		if err != nil {
			t.Fatal(err)
		}
	}
	config := filepath.Join(dir, "config.json")
	writeJSON(config, c)
	statePath := filepath.Join(c.State, "state.json")
	writeJSON(statePath, state)
	invoke := func(args ...string) (string, int) {
		t.Helper()
		argv := []string{"--user", "--map-root-user", os.Args[0], "-test.run=^TestCLIEntry$", "--", "--config", config, "workspaces"}
		argv = append(argv, args...)
		cmd := exec.Command("/usr/bin/unshare", argv...)
		cmd.Env = append(os.Environ(), "EXAMCTL_TEST_ENTRY=1", "GORACE=atexit_sleep_ms=0")
		out, err := cmd.CombinedOutput()
		if err == nil {
			return string(out), 0
		}
		if status, ok := err.(*exec.ExitError); ok {
			return string(out), status.ExitCode()
		}
		t.Fatal(err)
		return "", -1
	}
	show := func() core.WorkspaceRetentionStatus {
		t.Helper()
		out, code := invoke("show", id)
		var v core.WorkspaceRetentionStatus
		if code != 0 || json.Unmarshal([]byte(out), &v) != nil {
			t.Fatal(code, out)
		}
		return v
	}
	original := show()
	if !original.Candidate || original.Eligible || original.ArchiveVerified || original.Hold.Revision != 0 || original.RecordedDirectory != "/work" || original.Path != filepath.Join(c.Work, id) {
		t.Fatal("recorded metadata became cleanup proof", original)
	}
	c.ExamDirectory = "/future-exam-directory"
	writeJSON(config, c)
	if v := show(); !v.Candidate || v.RecordedDirectory != "/work" || v.Path != original.Path {
		t.Fatal("actual CLI confused changed defaults with historical host target", v)
	}
	job, err := os.OpenFile(filepath.Join(c.State, "collection-locks", id), os.O_RDWR, 0)
	if err != nil {
		t.Fatal(err)
	}
	if err := syscall.Flock(int(job.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		t.Fatal(err)
	}
	busy, code := invoke("hold", id, "--revision", "0", "--reason", "A busy CLI control must not claim queued success")
	job.Close()
	if code != 1 || !strings.Contains(busy, "NOT accepted or queued") || show().Hold.Revision != 0 {
		t.Fatal("actual CLI confused refusal with pending acceptance", code, busy)
	}
	out, code := invoke("list", "--exam", "midterm", "--limit", "1")
	var page core.WorkspaceRetentionPage
	if code != 0 || json.Unmarshal([]byte(out), &page) != nil || len(page.Workspaces) != 1 {
		t.Fatal(code, out)
	}
	out, code = invoke("hold", id, "--revision", "0", "--reason", "Retain synthetic work for explicit investigation")
	if code != 0 {
		t.Fatal(code, out)
	}
	if v := show(); !v.Hold.Held || v.Hold.Revision != 1 || v.Candidate {
		t.Fatal(v)
	}
	// An unrelated older state writer has no retention fields to preserve/drop.
	writeJSON(statePath, state)
	if !show().Hold.Held {
		t.Fatal("old state writer lost separate hold")
	}
	recordPath := filepath.Join(c.State, "workspace-retention", id+".json")
	validHold, err := os.ReadFile(recordPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"missing-held", "null-held", "duplicate-held", "case-alias"} {
		var raw map[string]json.RawMessage
		if err := json.Unmarshal(validHold, &raw); err != nil {
			t.Fatal(err)
		}
		bad := append([]byte(nil), validHold...)
		switch mode {
		case "missing-held":
			delete(raw, "held")
			bad, _ = json.Marshal(raw)
		case "null-held":
			raw["held"] = json.RawMessage("null")
			bad, _ = json.Marshal(raw)
		case "duplicate-held":
			bad = []byte(strings.Replace(string(bad), `"held":true`, `"held":true,"held":false`, 1))
		case "case-alias":
			bad = []byte(strings.Replace(string(bad), `"held":true`, `"held":true,"Held":false`, 1))
		}
		if string(bad) == string(validHold) {
			t.Fatal("fixture did not corrupt intended held field", mode)
		}
		if err := os.WriteFile(recordPath, bad, 0600); err != nil {
			t.Fatal(err)
		}
		auditBefore, err := os.ReadFile(filepath.Join(c.State, "audit.ndjson"))
		if err != nil {
			t.Fatal(err)
		}
		for _, args := range [][]string{{"show", id}, {"list", "--exam", "midterm"}, {"hold", id, "--revision", "1", "--reason", "A corrupt record must not be replaced"}, {"release-hold", id, "--revision", "1", "--reason", "A corrupt record must never imply release"}} {
			out, code := invoke(args...)
			if code != 1 || !strings.Contains(out, "malformed") || strings.Contains(out, `"held":false`) {
				t.Fatal("actual CLI trusted ambiguous/incomplete hold metadata", mode, args, code, out)
			}
			after, err := os.ReadFile(recordPath)
			if err != nil || string(after) != string(bad) {
				t.Fatal("refused CLI control overwrote hold evidence", mode, err)
			}
		}
		auditAfter, err := os.ReadFile(filepath.Join(c.State, "audit.ndjson"))
		if err != nil || string(auditAfter) != string(auditBefore) {
			t.Fatal("malformed hold produced a new accepted control intent", mode, err)
		}
		if err := os.WriteFile(recordPath, validHold, 0600); err != nil {
			t.Fatal(err)
		}
		if !show().Hold.Held {
			t.Fatal("valid explicit hold failed round trip")
		}
	}
	out, code = invoke("release-hold", id, "--revision", "0", "--reason", "A stale lost reply cannot clear a newer hold")
	if code != 1 || !strings.Contains(out, "changed") || !strings.Contains(out, "show") || !show().Hold.Held {
		t.Fatal(code, out)
	}
	out, code = invoke("release-hold", id, "--revision", "1", "--reason", "Reviewed release without cleanup or access changes")
	if code != 0 {
		t.Fatal(code, out)
	}
	if v := show(); v.Hold.Held || v.Hold.Revision != 2 || v.AccessState != "HELD" || v.Eligible {
		t.Fatal(v)
	}
	var saved core.State
	data, err := os.ReadFile(statePath)
	if err != nil || json.Unmarshal(data, &saved) != nil || !reflect.DeepEqual(saved.Attempts[id], state.Attempts[id]) {
		t.Fatal("retention controls changed native attempt authority", err)
	}
	audit := filepath.Join(c.State, "audit.ndjson")
	if err := os.Rename(audit, audit+"-preserved"); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(audit, 0700); err != nil {
		t.Fatal(err)
	}
	out, code = invoke("hold", id, "--revision", "2", "--reason", "Failed audit cannot acknowledge retention control")
	if code != 1 || show().Hold.Revision != 2 {
		t.Fatal(code, out)
	}
	if err := os.Remove(audit); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(audit+"-preserved", audit); err != nil {
		t.Fatal(err)
	}
	out, code = invoke("hold", id, "--revision", "2", "--reason", "Preserve explicit hold even after metadata record loss")
	if code != 0 {
		t.Fatal(code, out)
	}
	record := filepath.Join(c.State, "workspace-retention", id+".json")
	if err := os.Remove(record); err != nil {
		t.Fatal(err)
	}
	out, code = invoke("show", id)
	if code != 1 || !strings.Contains(out, "missing") {
		t.Fatal("missing hold treated as released", code, out)
	}
	if got, err := os.ReadFile(answer); err != nil || string(got) != "synthetic protected answer" {
		t.Fatal("workspace bytes changed", err)
	}
}
