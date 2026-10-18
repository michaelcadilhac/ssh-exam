package core

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"os"
	"strings"
	"syscall"
	"time"

	"golang.org/x/crypto/ssh"
)

func (e *Engine) handoffSigner() (ssh.Signer, error) {
	p := e.Config.HandoffCA
	if p == "" {
		return nil, errors.New("SSH handoff CA is not configured")
	}
	f, err := os.OpenFile(p, os.O_RDONLY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) || info.Mode().Perm()&0077 != 0 {
		return nil, errors.New("unprotected SSH handoff CA")
	}
	b := make([]byte, 16384)
	n, err := f.Read(b)
	if err != nil {
		return nil, err
	}
	defer clear(b)
	return ssh.ParsePrivateKey(b[:n])
}

// Only a public browser-generated key is persisted. The short-lived certificate
// authorizes a fresh class SSH transport, never an ordinary shell or forwarding.
func (e *Engine) issueSSHHandoff(id, public, transport string) (any, error) {
	if len(public) > 1024 {
		return nil, errors.New("invalid SSH handoff public key")
	}
	key, _, options, rest, err := ssh.ParseAuthorizedKey([]byte(public))
	if err != nil || key.Type() != ssh.KeyAlgoED25519 || len(options) != 0 || len(strings.TrimSpace(string(rest))) != 0 {
		return nil, errors.New("plain Ed25519 public key required")
	}
	// Reject certificates and nonstandard key implementations explicitly.
	if _, ok := key.(ssh.CryptoPublicKey); !ok {
		return nil, errors.New("plain SSH key required")
	}
	if _, ok := key.(ssh.CryptoPublicKey).CryptoPublicKey().(ed25519.PublicKey); !ok {
		return nil, errors.New("Ed25519 key required")
	}
	var snapshot Attempt
	err = e.WithState(func() error {
		a, err := e.Find(id)
		if err != nil || !e.temporaryPolicy(a) || a.State != "PREPARING" || a.Start != 0 || a.Transport != transport || a.PolicyState != "READY" || a.PolicyExpires <= Millis() || a.PolicyReadyBoot != boot() {
			return errors.New("unstarted protected setup required for SSH handoff")
		}
		if a.Handoff != nil && a.Handoff.Consumed != "" {
			return errors.New("SSH handoff already consumed")
		}
		snapshot = *a
		return nil
	})
	if err != nil {
		return nil, err
	}
	// /proc process start ticks are rounded down. Publish only after crossing
	// the policy tick, so a very fast local handoff cannot look like an old monitor.
	for n := 0; uptime() <= snapshot.PolicyReadyUptime+0.01; n++ {
		if n >= 25 {
			return nil, errors.New("SSH handoff policy clock fence is not current")
		}
		time.Sleep(2 * time.Millisecond)
	}
	signer, err := e.handoffSigner()
	if err != nil {
		return nil, err
	}
	expires := min(Millis()+60000, snapshot.PolicyExpires)
	grant := SSHHandoff{ID: Token(), Principal: "exam:" + id + ":" + snapshot.PolicyGeneration, Expires: expires}
	cert := &ssh.Certificate{Key: key, CertType: ssh.UserCert, KeyId: grant.ID, ValidPrincipals: []string{grant.Principal}, ValidAfter: uint64(time.Now().Unix() - 5), ValidBefore: uint64(expires / 1000), Permissions: ssh.Permissions{CriticalOptions: map[string]string{"force-command": "exam-dispatch"}, Extensions: map[string]string{"permit-pty": ""}}}
	if err = cert.SignCert(rand.Reader, signer); err != nil {
		return nil, err
	}
	grant.Certificate = strings.TrimSpace(string(ssh.MarshalAuthorizedKey(cert)))
	grant.CertificateKey = base64.StdEncoding.EncodeToString(cert.Marshal())
	err = e.WithState(func() error {
		a, err := e.Find(id)
		if err != nil || a.State != "PREPARING" || a.Start != 0 || a.Transport != transport || a.PolicyGeneration != snapshot.PolicyGeneration || a.PolicyState != "READY" || a.PolicyExpires <= Millis() || (a.Handoff != nil && a.Handoff.Consumed != "") {
			return errors.New("SSH handoff setup changed")
		}
		a.Handoff = &grant
		return nil
	})
	if err != nil {
		return nil, err
	}
	return map[string]any{"id": grant.ID, "certificate": grant.Certificate, "expires": grant.Expires}, nil
}
