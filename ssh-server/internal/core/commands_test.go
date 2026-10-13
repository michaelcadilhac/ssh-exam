package core

import (
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

func commandKeys(t *testing.T, e *Engine) ed25519.PrivateKey {
	t.Helper()
	pub, key, _ := ed25519.GenerateKey(rand.Reader)
	b, _ := x509.MarshalPKIXPublicKey(pub)
	p := filepath.Join(t.TempDir(), "gateway.pub")
	os.WriteFile(p, pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: b}), 0600)
	e.Config.AgentID = "class"
	e.Config.GatewayPublicKey = p
	e.Config.Accounts = map[string]Account{"student": {UID: 1001, GID: 1001}}
	return key
}
func signedCommand(key ed25519.PrivateKey, cmd Command) SignedFrame {
	b, _ := json.Marshal(cmd)
	return SignedFrame{Payload: base64.StdEncoding.EncodeToString(b), Signature: base64.StdEncoding.EncodeToString(ed25519.Sign(key, b))}
}
func TestSignedCommandsScopeTransportReplayAndRestart(t *testing.T) {
	e, _, _ := finalFixture(t, "ACTIVE", Millis()+5400000)
	key := commandKeys(t, e)
	e.WithState(func() error {
		e.state.Attempts[finalID].Transport = "ssh-a"
		e.state.Registrations["ssh-a"] = "student"
		return nil
	})
	cmd := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "inspect-attempt", Username: "student", Transport: "ssh-a", Body: Request{ID: finalID}}
	for _, name := range []string{"signature", "account", "transport", "audience", "expiration", "operation", "owner"} {
		t.Run(name, func(t *testing.T) {
			bad := cmd
			bad.Nonce = Token()
			peer, transport := "student", "ssh-a"
			switch name {
			case "account":
				peer = "other"
			case "transport":
				transport = "ssh-b"
			case "audience":
				bad.Audience = "other"
			case "expiration":
				bad.Expires = Millis() - 1
			case "operation":
				bad.Op = "delete-submission"
			case "owner":
				bad.Body.ID = "98765432-1234-1234-1234-123456789abc"
			}
			frame := signedCommand(key, bad)
			if name == "signature" {
				frame.Signature = base64.StdEncoding.EncodeToString(make([]byte, 64))
			}
			if _, err := e.Command(frame, peer, transport); err == nil {
				t.Fatal("adversarial command accepted")
			}
		})
	}
	frame := signedCommand(key, cmd)
	if _, err := e.Command(frame, "student", "ssh-a"); err != nil {
		t.Fatal(err)
	}
	restarted, _ := New(e.Config)
	if _, err := restarted.Command(frame, "student", "ssh-a"); err == nil {
		t.Fatal("replayed command accepted after restart")
	}
}
func TestSignedFinishKeepsOriginalHoldAndCannotRegister(t *testing.T) {
	deadline := Millis() + 5400000
	e, _, _ := finalFixture(t, "ACTIVE", deadline)
	key := commandKeys(t, e)
	e.WithState(func() error {
		e.state.Attempts[finalID].Transport = "ssh-a"
		e.state.Registrations["ssh-a"] = "student"
		return nil
	})
	cmd := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "finalize-attempt", Username: "student", Transport: "ssh-a", Body: Request{ID: finalID}}
	if _, err := e.Command(signedCommand(key, cmd), "student", "ssh-a"); err != nil {
		t.Fatal(err)
	}
	cmd.Nonce = Token()
	if _, err := e.Command(signedCommand(key, cmd), "student", "ssh-a"); err != nil {
		t.Fatal("duplicate finish not idempotent", err)
	}
	a := inspectFinal(t, e)
	if a.Deadline != deadline || a.AccessState != "HELD" || !a.Protected {
		t.Fatal("early finish altered interval hold")
	}
	cmd.Op = "register"
	cmd.Transport = ""
	cmd.Nonce = Token()
	cmd.Body = Request{Continuation: &Request{ID: finalID, Generation: a.Generation, Expires: Millis() + 10000}}
	if _, err := e.Command(signedCommand(key, cmd), "student", "ssh-b"); err == nil {
		t.Fatal("finished attempt reopened")
	}
}
func TestContinuationDeliveredAtFreshRegistration(t *testing.T) {
	e, _, _ := finalFixture(t, "LOCKED", Millis()+5400000)
	key := commandKeys(t, e)
	e.WithState(func() error {
		a := e.state.Attempts[finalID]
		a.Transport = "old"
		a.Generation = 2
		a.Authorization = 0
		return nil
	})
	cmd := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "register", Username: "student", Body: Request{Continuation: &Request{ID: finalID, Generation: 2, Expires: Millis() + 10000}}}
	if _, err := e.Command(signedCommand(key, cmd), "student", "fresh"); err != nil {
		t.Fatal(err)
	}
	cmd.Op = "attach-transport"
	cmd.Transport = "fresh"
	cmd.Nonce = Token()
	cmd.Body = Request{ID: finalID, Username: "student", Transport: "fresh", Generation: 2}
	if _, err := e.Command(signedCommand(key, cmd), "student", "fresh"); err != nil {
		t.Fatal(err)
	}
	a := inspectFinal(t, e)
	if a.State != "LOCKED" || a.ResumeTransport != "fresh" {
		t.Fatal("registration bypassed monitored continuation")
	}
}
func TestLocalAdminControlsAndActiveList(t *testing.T) {
	e, _, _ := finalFixture(t, "ACTIVE", Millis()+5400000)
	list, err := e.List(true, "exam")
	if err != nil || len(list) != 1 {
		t.Fatal("active list missing attempt")
	}
	if _, err = e.Admin("stop", finalID, ""); err == nil {
		t.Fatal("unaudited stop accepted")
	}
	if _, err = e.Admin("stop", finalID, "Operator manually ended attempt"); err != nil {
		t.Fatal(err)
	}
	list, _ = e.List(true, "")
	if len(list) != 0 {
		t.Fatal("completed attempt considered active")
	}
	list, _ = e.List(false, "")
	if len(list) != 1 || list[0].AccessState != "HELD" {
		t.Fatal("completion erased hold")
	}
	if _, err = e.Admin("info", finalID, ""); err != nil {
		t.Fatal(err)
	}
}
