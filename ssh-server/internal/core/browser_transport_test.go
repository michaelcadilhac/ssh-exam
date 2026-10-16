package core

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func TestSSHReceiptBindsVerifiedIdentityAndRequest(t *testing.T) {
	pub, key, _ := ed25519.GenerateKey(rand.Reader)
	b, _ := x509.MarshalPKCS8PrivateKey(key)
	file := filepath.Join(t.TempDir(), "callback.key")
	os.WriteFile(file, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: b}), 0600)
	e := &Engine{Config: Config{AgentID: "class", CallbackKey: file}}
	receipt, err := e.SSHReceipt("ssh-command-receipt", "request-nonce", "student", "kernel-transport", map[string]any{"uid": 1001}, nil)
	if err != nil {
		t.Fatal(err)
	}
	payload, _ := base64.StdEncoding.DecodeString(receipt.Payload)
	sig, _ := base64.StdEncoding.DecodeString(receipt.Signature)
	if !ed25519.Verify(pub, payload, sig) {
		t.Fatal("invalid receipt signature")
	}
	var r map[string]any
	json.Unmarshal(payload, &r)
	if r["nonce"] != "request-nonce" || r["username"] != "student" || r["transport"] != "kernel-transport" {
		t.Fatal("receipt binding absent")
	}
	payload[0] ^= 1
	if ed25519.Verify(pub, payload, sig) {
		t.Fatal("tampered receipt accepted")
	}
}
func TestRootTerminalRecordingBeforeOutputAndFailClosed(t *testing.T) {
	e := &Engine{Config: Config{State: t.TempDir()}}
	pane := "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
	r, err := e.newRecorder(finalID, pane)
	if err != nil {
		t.Fatal(err)
	}
	defer r.file.Close()
	var output bytes.Buffer
	failed := false
	writer := recordedWriter{r, &output, "output", func() { failed = true }}
	if _, err := writer.Write([]byte("trusted output")); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(e.Config.State, "monitoring", finalID, pane+".ndjson")
	data, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(data, []byte(base64.StdEncoding.EncodeToString(output.Bytes()))) || !bytes.Contains(data, []byte(`"source":"class-agent"`)) {
		t.Fatal("authoritative recording absent")
	}
	info, _ := os.Stat(file)
	if info.Mode().Perm() != 0600 {
		t.Fatal("recording not private")
	}
	if err := r.file.Truncate(e.terminalRecordingLimit()); err != nil {
		t.Fatal(err)
	}
	size := output.Len()
	if _, err := writer.Write([]byte("unrecorded")); err == nil || !failed || output.Len() != size {
		t.Fatal("recording failure forwarded output")
	}
}
func TestCancelledPreflightRemovesStalePracticeUnits(t *testing.T) {
	e, _, _ := finalFixture(t, "LOCKED", Millis()+5400000)
	e.WithState(func() error {
		a := e.state.Attempts[finalID]
		a.Start = 0
		a.State = "PREPARING"
		a.Units = []string{"exam-" + finalID + "-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.scope"}
		return nil
	})
	if _, err := e.Call("cancel-attempt", Request{ID: finalID}); err != nil {
		t.Fatal(err)
	}
	e.WithState(func() error {
		a := e.state.Attempts[finalID]
		if a.State != "CANCELLED_BEFORE_START" || len(a.Units) != 0 {
			t.Fatal("cancelled preflight retained scopes")
		}
		return nil
	})
}

func TestRecordingDefaultAllowsMoreThanOldLimit(t *testing.T) {
	e := &Engine{Config: Config{State: t.TempDir()}}
	if e.terminalRecordingLimit() != 2*1024*1024*1024 {
		t.Fatal("wrong default")
	}
	r, err := e.newRecorder(finalID, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
	if err != nil {
		t.Fatal(err)
	}
	defer r.file.Close()
	// Sparse files exercise the old boundary without allocating a huge recording.
	if err := r.file.Truncate(900 * 1024 * 1024); err != nil {
		t.Fatal(err)
	}
	if err := r.record(map[string]any{"event": "output", "data": "bW9yZQ=="}); err != nil {
		t.Fatal("normal output hit old limit", err)
	}
}
func TestRecordingConfiguredBudgetSurvivesPanesAndRestart(t *testing.T) {
	c := Config{State: t.TempDir(), TerminalRecordingLimitMiB: 1}
	first := &Engine{Config: c}
	r, err := first.newRecorder(finalID, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
	if err != nil {
		t.Fatal(err)
	}
	defer r.file.Close()
	if err := r.file.Truncate(1024 * 1024); err != nil {
		t.Fatal(err)
	}
	restarted := &Engine{Config: c}
	if _, err := restarted.newRecorder(finalID, "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"); err == nil {
		t.Fatal("another pane bypassed persisted shared budget")
	}
	// Another attempt has its own quota.
	other, err := restarted.newRecorder("cccccccc-cccc-cccc-cccc-cccccccccccc", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
	if err != nil {
		t.Fatal(err)
	}
	other.file.Close()
}

func TestIndependentPaneProcessesCannotRacePastSharedRecordingBudget(t *testing.T) {
	c := Config{State: t.TempDir(), TerminalRecordingLimitMiB: 1}
	one, two := &Engine{Config: c}, &Engine{Config: c}
	first, err := one.newRecorder(finalID, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
	if err != nil {
		t.Fatal(err)
	}
	defer first.file.Close()
	second, err := two.newRecorder(finalID, "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
	if err != nil {
		t.Fatal(err)
	}
	defer second.file.Close()
	var wg sync.WaitGroup
	wg.Add(2)
	results := make(chan error, 2)
	for _, r := range []*terminalRecorder{first, second} {
		go func(r *terminalRecorder) {
			defer wg.Done()
			results <- r.record(map[string]any{"event": "output", "data": strings.Repeat("a", 600*1024)})
		}(r)
	}
	wg.Wait()
	close(results)
	accepted := 0
	for err := range results {
		if err == nil {
			accepted++
		}
	}
	a, _ := first.file.Stat()
	b, _ := second.file.Stat()
	if accepted != 1 || a.Size()+b.Size() > 1024*1024 {
		t.Fatal("cross-process quota race")
	}
}
