package core

import (
	"crypto/ed25519"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"os"
)

type SignedFrame struct {
	Payload   string `json:"payload"`
	Signature string `json:"signature"`
}
type Command struct {
	Audience  string  `json:"audience"`
	Nonce     string  `json:"nonce"`
	Expires   int64   `json:"expires"`
	Op        string  `json:"op"`
	Username  string  `json:"username"`
	Transport string  `json:"transport"`
	Body      Request `json:"body"`
}

func publicKey(path string) (ed25519.PublicKey, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	block, _ := pem.Decode(b)
	if block == nil {
		return nil, errors.New("invalid Ed25519 public key")
	}
	k, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return nil, err
	}
	key, ok := k.(ed25519.PublicKey)
	if !ok {
		return nil, errors.New("Ed25519 key required")
	}
	return key, nil
}
func privateKey(path string) (ed25519.PrivateKey, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	block, _ := pem.Decode(b)
	if block == nil {
		return nil, errors.New("invalid Ed25519 private key")
	}
	k, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, err
	}
	key, ok := k.(ed25519.PrivateKey)
	if !ok {
		return nil, errors.New("Ed25519 key required")
	}
	return key, nil
}

// The socket supplies the peer account and verified root sshd ancestry, never client flags.
func (e *Engine) Command(frame SignedFrame, username, transport string) (any, error) {
	payload, err := base64.StdEncoding.DecodeString(frame.Payload)
	if err != nil || len(payload) > 32768 {
		return nil, errors.New("invalid command payload")
	}
	sig, err := base64.StdEncoding.DecodeString(frame.Signature)
	if err != nil {
		return nil, err
	}
	key, err := publicKey(e.Config.GatewayPublicKey)
	if err != nil {
		return nil, err
	}
	if !ed25519.Verify(key, payload, sig) {
		return nil, errors.New("gateway signature rejected")
	}
	var cmd Command
	if json.Unmarshal(payload, &cmd) != nil || cmd.Audience != e.Config.AgentID || cmd.Username != username || len(cmd.Nonce) < 16 || len(cmd.Nonce) > 64 {
		return nil, errors.New("command scope rejected")
	}
	var result any
	err = e.WithState(func() error {
		now := Millis()
		if cmd.Expires <= now || cmd.Expires > now+30000 {
			return errors.New("command expired")
		}
		if e.state.Commands == nil {
			e.state.Commands = map[string]int64{}
		}
		for nonce, until := range e.state.Commands {
			if until <= now {
				delete(e.state.Commands, nonce)
			}
		}
		if _, used := e.state.Commands[cmd.Nonce]; used {
			return errors.New("command replay rejected")
		}
		e.state.Commands[cmd.Nonce] = cmd.Expires
		r := cmd.Body
		account, ok := e.Config.Accounts[username]
		if !ok {
			return errors.New("account not approved")
		}
		if cmd.Op == "register" {
			if cmd.Transport != "" {
				return errors.New("registration must use fresh SSH")
			}
			if r.Continuation != nil {
				grant := r.Continuation
				a, err := e.Find(grant.ID)
				if err != nil || a.Username != username {
					return errors.New("continuation owner mismatch")
				}
				if a.State == "ACTIVE" || (a.State == "LOCKED" && a.Generation < grant.Generation) {
					if _, err = e.callLocked("lock-attempt", Request{ID: a.ID, Generation: grant.Generation, Reason: "Gateway authorized reconnection"}); err != nil {
						return err
					}
				}
				if _, err = e.callLocked("authorize-continuation", *grant); err != nil {
					return err
				}
			}
			if err := e.registrationAllowed(account.UID); err != nil {
				return err
			}
			e.state.Registrations[transport] = username
			result = map[string]any{"transport": transport, "uid": account.UID}
			return nil
		}
		if cmd.Transport != transport || e.state.Registrations[transport] != username {
			return errors.New("command SSH transport mismatch")
		}
		if r.Username != "" && r.Username != username {
			return errors.New("command account mismatch")
		}
		switch cmd.Op {
		case "health":
		case "resolve-course-accounts":
			if len(r.Usernames) != 1 || r.Usernames[0] != username {
				return errors.New("only own account resolution allowed over student SSH")
			}
		case "prepare-attempt":
			if r.UID != account.UID || r.Transport != transport || r.Username != username {
				return errors.New("preparation identity mismatch")
			}
		case "inspect-attempt", "submission-status", "submission-manifest", "cancel-attempt":
			a, err := e.Find(r.ID)
			if err != nil || a.Username != username {
				return errors.New("attempt owner mismatch")
			}
		case "activate-attempt", "issue-channel-admission", "lock-attempt", "renew-execution-lease", "consume-continuation", "finalize-attempt":
			a, err := e.Find(r.ID)
			if err != nil || a.Username != username || a.Transport != transport {
				return errors.New("attempt SSH transport mismatch")
			}
			if cmd.Op == "finalize-attempt" {
				if a.State == "COMPLETED" || a.State == "FINALIZING" || a.State == "COLLECTION_FAILED" {
					result = a
					return nil
				}
				if a.State != "ACTIVE" {
					return errors.New("finish requires an active connected attempt")
				}
				r.Reason = "student finish"
			}
		case "attach-transport":
			a, err := e.Find(r.ID)
			if err != nil || a.Username != username || r.Transport != transport {
				return errors.New("replacement identity mismatch")
			}
		default:
			return errors.New("operation unavailable through student SSH")
		}
		var err error
		result, err = e.callLocked(cmd.Op, r)
		return err
	})
	return result, err
}
