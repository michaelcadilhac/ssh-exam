package core

import (
	"bytes"
	"io"
	"strings"
	"sync"
	"testing"
)

func TestAdministratorRefusalNeverReflectsArbitraryPrivateDiagnostics(t *testing.T) {
	message := "An administrator with that username already exists; inspect administrators before choosing another username. Creation never replaces credentials."
	if administratorPublicRefusal(message) != message {
		t.Fatal("known actionable cause removed")
	}
	for _, private := range []string{"PRIVATE-SYNTHETIC-PASSWORD", message + " PRIVATE-SYNTHETIC-PASSWORD", "$argon2id$PRIVATE-SYNTHETIC-PASSWORD"} {
		if got := administratorPublicRefusal(private); strings.Contains(got, "PRIVATE") || strings.Contains(got, "argon2") || !strings.Contains(got, "not printed") {
			t.Fatal("arbitrary private error was reflected")
		}
	}
}

func TestCredentialRequestBodyOwnsAndWipesExactlyItsBuffer(t *testing.T) {
	secret := []byte("synthetic-owned-secret-bytes")
	b := &credentialRequestBody{data: secret}
	first := make([]byte, 9)
	if n, err := b.Read(first); err != nil || n != 9 || string(first) != "synthetic" {
		t.Fatal(n, err)
	}
	rest, err := io.ReadAll(b)
	if err != nil || string(rest) != "-owned-secret-bytes" {
		t.Fatal("wrong bounded request bytes", err)
	}
	if err := b.Close(); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(secret, make([]byte, len(secret))) {
		t.Fatal("owned request buffer retained secret")
	}
	if n, err := b.Read(first); n != 0 || err != io.EOF {
		t.Fatal("closed request read reopened data", n, err)
	}
	if err := b.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestCredentialRequestBodyConcurrentTransportReadAndCleanup(t *testing.T) {
	for range 100 {
		secret := bytes.Repeat([]byte("credential"), 4096)
		b := &credentialRequestBody{data: secret}
		var wg sync.WaitGroup
		wg.Add(2)
		go func() { defer wg.Done(); _, _ = io.Copy(io.Discard, b) }()
		go func() { defer wg.Done(); _ = b.Close() }()
		wg.Wait()
		if !bytes.Equal(secret, make([]byte, len(secret))) {
			t.Fatal("concurrent close retained credential bytes")
		}
	}
}
