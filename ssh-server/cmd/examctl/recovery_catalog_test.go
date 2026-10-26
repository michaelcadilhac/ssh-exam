package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"examworkspace/agent/internal/core"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestRecoveryCatalogCLIInRootUserNamespace(t *testing.T) {
	if os.Getenv("EXAM_MANAGEMENT_USERNS") != "1" {
		t.Skip("set EXAM_MANAGEMENT_USERNS=1 for actual root-mapped local CLI catalog checks")
	}
	dir := t.TempDir()
	pub, key, _ := ed25519.GenerateKey(rand.Reader)
	publicDER, _ := x509.MarshalPKIXPublicKey(pub)
	privateDER, _ := x509.MarshalPKCS8PrivateKey(key)
	publicPath, privatePath := filepath.Join(dir, "gateway.pub"), filepath.Join(dir, "agent.key")
	if err := os.WriteFile(publicPath, pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: publicDER}), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(privatePath, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: privateDER}), 0600); err != nil {
		t.Fatal(err)
	}
	c := core.Config{State: filepath.Join(dir, "state"), Work: filepath.Join(dir, "work"), Rootfs: dir, Templates: dir, AgentID: "class", CallbackURL: "https://unused.example.edu", CallbackKey: privatePath, GatewayPublicKey: publicPath, Accounts: map[string]core.Account{"student": {UID: 29999, GID: 29999, Home: dir, Shell: "/bin/bash"}}}
	for _, p := range []string{c.State, c.Work, filepath.Join(c.State, "recovery-preparations", "retake")} {
		if err := os.MkdirAll(p, 0700); err != nil {
			t.Fatal(err)
		}
	}
	const source = "12345678-1234-4234-8234-123456789abc"
	state := core.State{Attempts: map[string]*core.Attempt{source: {ID: source, Exam: "midterm", Username: "student", UID: 29999, State: "COMPLETED", Start: core.Millis() - 1000, Deadline: core.Millis() + 5400000, OriginalDeadline: core.Millis() + 5400000, Protected: true, Checksum: strings.Repeat("a", 64), AccessState: "HELD"}}, Caps: map[string]core.Capability{}, Registrations: map[string]string{}}
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
	configPath := filepath.Join(dir, "config.json")
	writeJSON(configPath, c)
	statePath := filepath.Join(c.State, "state.json")
	writeJSON(statePath, state)
	r := core.RecoveryPreparation{Exam: "retake", Username: "student", UID: 29999, Duration: 5400, SourceAttempt: source, Checksum: strings.Repeat("a", 64), CreatedAt: core.Millis(), Reason: "Explicit synthetic additional allowance"}
	writeJSON(filepath.Join(c.State, "recovery-preparations", "retake", "student.json"), r)
	before, _ := os.ReadFile(statePath)
	invoke := func(args ...string) (string, int) {
		t.Helper()
		argv := []string{"--user", "--map-root-user", os.Args[0], "-test.run=^TestCLIEntry$", "--", "--config", configPath}
		argv = append(argv, args...)
		command := exec.Command("/usr/bin/unshare", argv...)
		command.Env = append(os.Environ(), "EXAMCTL_TEST_ENTRY=1", "GORACE=atexit_sleep_ms=0")
		out, err := command.CombinedOutput()
		if err == nil {
			return string(out), 0
		}
		if status, ok := err.(*exec.ExitError); ok {
			return string(out), status.ExitCode()
		}
		t.Fatal(err)
		return "", -1
	}
	out, code := invoke("recovery-grants", "--exam", "retake")
	var rows []core.RecoveryGrantView
	if code != 0 || json.Unmarshal([]byte(out), &rows) != nil || len(rows) != 1 || rows[0].Disposition != "unused" || rows[0].SourceAttempt != source || !rows[0].SourceRecordedProtected {
		t.Fatal("actual catalog workflow failed", code, out)
	}
	after, _ := os.ReadFile(statePath)
	if !bytes.Equal(before, after) {
		t.Fatal("CLI inspection rewrote authoritative history")
	}
	out, code = invoke("recovery-grants", "--exam", "other")
	if code != 0 || strings.TrimSpace(out) != "[]" {
		t.Fatal("CLI exam filter failed", code, out)
	}
	// Catalog uncertainty must use the same exam/UID/committed-start fence as
	// native Begin, even when the account's earlier name differs.
	const priorID = "33333333-1234-4234-8234-123456789abc"
	for _, test := range []struct {
		name, exam, username, disposition string
		uid                               int
		start                             int64
	}{
		{"same-account", r.Exam, r.Username, "uncertain", r.UID, r.CreatedAt},
		{"renamed-account", r.Exam, "former-name", "uncertain", r.UID, r.CreatedAt},
		{"other-uid", r.Exam, r.Username, "unused", r.UID + 1, r.CreatedAt},
		{"other-exam", "other", r.Username, "unused", r.UID, r.CreatedAt},
		{"before-issuance", r.Exam, r.Username, "unused", r.UID, r.CreatedAt - 1},
		{"unstarted", r.Exam, r.Username, "unused", r.UID, 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			state.Attempts[priorID] = &core.Attempt{ID: priorID, Exam: test.exam, Username: test.username, UID: test.uid,
				State: "COMPLETED", Start: test.start, Deadline: test.start + r.Duration*1000, OriginalDeadline: test.start + r.Duration*1000}
			if test.start == 0 {
				state.Attempts[priorID].State = "PREPARING"
				state.Attempts[priorID].Deadline, state.Attempts[priorID].OriginalDeadline = 0, 0
			}
			writeJSON(statePath, state)
			before, err := os.ReadFile(statePath)
			if err != nil {
				t.Fatal(err)
			}
			out, code := invoke("recovery-grants", "--exam", r.Exam)
			var rows []core.RecoveryGrantView
			if code != 0 || json.Unmarshal([]byte(out), &rows) != nil || len(rows) != 1 || rows[0].Disposition != test.disposition || rows[0].ConsumedBy != "" || !rows[0].SourceRecordedProtected {
				t.Error("actual CLI disagrees with committed UID fence", code, out)
			}
			after, err := os.ReadFile(statePath)
			if err != nil || !bytes.Equal(before, after) {
				t.Fatal("CLI inspection changed original intervals or source history", err)
			}
		})
	}
	delete(state.Attempts, priorID)
	writeJSON(statePath, state)
	out, code = invoke("delete", source, "--reason", "Synthetic held-source retention refusal")
	if code != 1 || !strings.Contains(out, "account restriction") || !strings.Contains(out, "recovery-grants") || !strings.Contains(out, "Original deadline") {
		t.Fatal("actual destructive refusal lacks guidance", code, out)
	}
	const absent = "22222222-1234-1234-1234-123456789abc"
	for _, args := range [][]string{
		{"cancel-absent", absent, "--exam", "retake", "--reason", "Synthetic missing account refusal"},
		{"cancel-absent", absent, "--exam", "retake", "--username", "unapproved", "--reason", "Synthetic unknown account refusal"},
		{"cancel-absent", source, "--exam", "retake", "--username", "student", "--reason", "Synthetic existing history refusal"},
	} {
		if out, code := invoke(args...); code == 0 {
			t.Fatal("unsafe absent cancellation accepted", args, out)
		}
	}
	out, code = invoke("cancel-absent", absent, "--exam", "retake", "--username", "student", "--reason", "Synthetic refused preparation cleanup")
	var tombstone core.Attempt
	if code != 0 || json.Unmarshal([]byte(out), &tombstone) != nil || tombstone.ID != absent || tombstone.Exam != "retake" || tombstone.Username != "student" || tombstone.UID != 29999 || tombstone.State != "CANCELLED_BEFORE_START" || tombstone.Start != 0 || tombstone.Deadline != 0 || tombstone.OriginalDeadline != 0 {
		t.Fatal("actual absent cancellation failed", code, out)
	}
	out, code = invoke("info", absent, "--read-only")
	if code != 0 || !strings.Contains(out, "CANCELLED_BEFORE_START") {
		t.Fatal("tombstone not discoverable", code, out)
	}
	out, code = invoke("cancel-absent", absent, "--exam", "retake", "--username", "student", "--reason", "Synthetic duplicate command refusal")
	if code != 1 || !strings.Contains(out, "attempt exists") {
		t.Fatal("existing UUID not fenced", code, out)
	}
	after, _ = os.ReadFile(statePath)
	var changed core.State
	if json.Unmarshal(after, &changed) != nil {
		t.Fatal("state unreadable")
	}
	oldSource, _ := json.Marshal(state.Attempts[source])
	newSource, _ := json.Marshal(changed.Attempts[source])
	if !bytes.Equal(oldSource, newSource) {
		t.Fatal("orphan cleanup changed source interval/protection/hold")
	}
	if _, err := os.Stat(filepath.Join(c.Work, absent)); !os.IsNotExist(err) {
		t.Fatal("cancellation touched workspace", err)
	}
	if _, err := os.Stat(filepath.Join(c.State, "recovery-preparations", "retake", "student.json.consumed")); !os.IsNotExist(err) {
		t.Fatal("cancellation consumed grant", err)
	}
	// Actual root CLI must agree with Begin's strict parser without exposing
	// malformed private fields or interpreting them as an absent authorization.
	grantPath := filepath.Join(c.State, "recovery-preparations", "retake", "student.json")
	grant, err := json.Marshal(r)
	if err != nil {
		t.Fatal(err)
	}
	stateBefore, _ := os.ReadFile(statePath)
	for _, suffix := range []string{`,"exam":"retake"}`, `,"Exam":"retake"}`, `,"private":"SYNTHETIC-PRIVATE-DO-NOT-ECHO"}`} {
		malformed := append(append([]byte{}, grant[:len(grant)-1]...), []byte(suffix)...)
		if err := os.WriteFile(grantPath, malformed, 0600); err != nil {
			t.Fatal(err)
		}
		out, code = invoke("recovery-grants", "--exam", "retake")
		if code != 1 || !strings.Contains(out, "preserve") || strings.Contains(out, "SYNTHETIC-PRIVATE-DO-NOT-ECHO") || strings.Contains(out, "\"disposition\"") {
			t.Fatal("actual catalog CLI accepted ambiguous authority or leaked private fields", code, out)
		}
		stateAfter, _ := os.ReadFile(statePath)
		metadataAfter, _ := os.ReadFile(grantPath)
		if !bytes.Equal(stateBefore, stateAfter) || !bytes.Equal(malformed, metadataAfter) {
			t.Fatal("refused catalog CLI rewrote authority or malformed metadata")
		}
	}
}
