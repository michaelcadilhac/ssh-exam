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
	if err := r.file.Truncate(64 * 1024 * 1024); err != nil {
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
