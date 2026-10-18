package core

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"encoding/pem"
	"golang.org/x/crypto/ssh"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func handoffCA(t *testing.T, e *Engine) ssh.Signer {
	t.Helper()
	_, private, _ := ed25519.GenerateKey(rand.Reader)
	block, err := ssh.MarshalPrivateKey(private, "exam handoff")
	if err != nil {
		t.Fatal(err)
	}
	e.Config.HandoffCA = filepath.Join(t.TempDir(), "handoff-ca")
	if err = os.WriteFile(e.Config.HandoffCA, pem.EncodeToMemory(block), 0600); err != nil {
		t.Fatal(err)
	}
	signer, _ := ssh.NewSignerFromKey(private)
	return signer
}
func TestHandoffCertificateScopeAndOneUseRegistration(t *testing.T) {
	e := temporaryFixture(t, "PREPARING", Millis()+5400000)
	ca := handoffCA(t, e)
	key := commandKeys(t, e)
	e.Config.Accounts = map[string]Account{}
	e.policyRun = func(op, user, id, generation string) ([]byte, error) {
		return json.Marshal(Account{UID: 1001, GID: 1001, Home: "/home/student", Shell: "/bin/bash"})
	}
	e.transportUptime = func(int) (float64, error) { return 11, nil }
	e.WithState(func() error { e.state.Registrations["old"] = "student"; return nil })
	pub, _, _ := ed25519.GenerateKey(rand.Reader)
	public, _ := ssh.NewPublicKey(pub)
	result, err := e.issueSSHHandoff(finalID, string(ssh.MarshalAuthorizedKey(public)), "old")
	if err != nil {
		t.Fatal(err)
	}
	h := result.(map[string]any)
	parsed, _, _, _, err := ssh.ParseAuthorizedKey([]byte(h["certificate"].(string)))
	if err != nil {
		t.Fatal(err)
	}
	cert := parsed.(*ssh.Certificate)
	if cert.CriticalOptions["force-command"] != "exam-dispatch" || len(cert.CriticalOptions) != 1 || len(cert.Extensions) != 1 || cert.ValidBefore > uint64(time.Now().Unix()+60) || len(cert.ValidPrincipals) != 1 || cert.ValidPrincipals[0] == "student" {
		t.Fatal("unsafe certificate scope", cert)
	}
	if string(cert.SignatureKey.Marshal()) != string(ca.PublicKey().Marshal()) {
		t.Fatal("wrong authority")
	}
	checker := ssh.CertChecker{SupportedCriticalOptions: []string{"force-command"}}
	if err = checker.CheckCert(cert.ValidPrincipals[0], cert); err != nil {
		t.Fatal(err)
	}
	makeCommand := func(handoff, transport string) SignedFrame {
		return signedCommand(key, Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Username: "student", Op: "register", Body: Request{Exam: "exam", Handoff: handoff}})
	}
	if _, err = e.command(makeCommand("wrong", ""), "student", "fresh", 123); err == nil {
		t.Fatal("wrong grant accepted")
	}
	if _, err = e.command(makeCommand(h["id"].(string), ""), "student", "fresh", 123); err != nil {
		t.Fatal(err)
	}
	a := inspectFinal(t, e)
	if a.Start != 0 || a.Deadline != 0 || a.Transport != "fresh" || a.Handoff.Consumed != "fresh" {
		t.Fatal("handoff started clock or did not bind transport")
	}
	if _, err = e.command(makeCommand(h["id"].(string), ""), "student", "another", 124); err == nil {
		t.Fatal("handoff reused")
	}
	if publicAttempt(a).Handoff != nil {
		t.Fatal("handoff published in callback")
	}
}
func TestHandoffRejectsExpiredFinishedForeignAndUnsafeKeys(t *testing.T) {
	for _, kind := range []string{"foreign", "expired", "finished", "unready", "options", "certificate", "oversized", "future-fence"} {
		t.Run(kind, func(t *testing.T) {
			e := temporaryFixture(t, "PREPARING", Millis()+5400000)
			ca := handoffCA(t, e)
			pub, _, _ := ed25519.GenerateKey(rand.Reader)
			key, _ := ssh.NewPublicKey(pub)
			public := string(ssh.MarshalAuthorizedKey(key))
			transport := "old"
			e.WithState(func() error {
				a := e.state.Attempts[finalID]
				switch kind {
				case "expired":
					a.PolicyExpires = Millis() - 1
				case "finished":
					a.State = "COMPLETED"
				case "unready":
					a.PolicyState = "APPLYING"
				case "future-fence":
					a.PolicyReadyUptime = uptime() + 100
				}
				return nil
			})
			switch kind {
			case "foreign":
				transport = "other"
			case "options":
				public = "no-pty " + public
			case "certificate":
				cert := &ssh.Certificate{Key: key, CertType: ssh.UserCert}
				cert.SignCert(rand.Reader, ca)
				public = string(ssh.MarshalAuthorizedKey(cert))
			case "oversized":
				public = string(make([]byte, 2048))
			}
			if _, err := e.issueSSHHandoff(finalID, public, transport); err == nil {
				t.Fatal("unsafe handoff accepted")
			}
		})
	}
}
