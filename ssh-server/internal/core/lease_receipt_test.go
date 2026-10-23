package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestSignedRenewalLostReplyRecoversExactOriginalCutoffWithoutRenewing(t *testing.T) {
	e, key, cmd := leaseFixture(t)
	cmd.Op = "renew-receipted-execution-lease"
	// Discard the real native reply: only the command's durable effect remains.
	if _, err := e.Command(signedCommand(key, cmd), cmd.Username, cmd.Transport); err != nil {
		t.Fatal("original signed renewal refused", err)
	}
	journalPath := filepath.Join(e.Config.State, "leases", finalID+".json")
	before, err := os.ReadFile(journalPath)
	if err != nil {
		t.Fatal(err)
	}
	stateBefore, err := os.ReadFile(filepath.Join(e.Config.State, "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	var lease struct {
		Until int64 `json:"until"`
	}
	if json.Unmarshal(before, &lease) != nil {
		t.Fatal("invalid committed lease fixture")
	}
	query := cmd
	query.Op, query.Nonce, query.Body.RenewalNonce = "execution-renewal-receipt", Token(), cmd.Nonce
	for i := 0; i < 2; i++ {
		result, err := e.Command(signedCommand(key, query), cmd.Username, cmd.Transport)
		if err != nil {
			t.Fatal("exact committed receipt unavailable", err)
		}
		var receipt struct {
			Version   int     `json:"version"`
			Nonce     string  `json:"nonce"`
			Until     int64   `json:"until"`
			Remaining int64   `json:"remaining_ms"`
			Attempt   Attempt `json:"attempt"`
		}
		data, _ := json.Marshal(result)
		if json.Unmarshal(data, &receipt) != nil || receipt.Version != 1 || receipt.Nonce != cmd.Nonce || receipt.Until != lease.Until || receipt.Remaining <= 0 || receipt.Remaining > 15000 || receipt.Attempt.ID != finalID || receipt.Attempt.State != "ACTIVE" {
			t.Fatal("recovery did not preserve the original current renewal", string(data))
		}
	}
	if _, err := e.Command(signedCommand(key, cmd), cmd.Username, cmd.Transport); err == nil {
		t.Fatal("receipt support weakened renewal one-use replay refusal")
	}
	after, err := os.ReadFile(journalPath)
	if err != nil || string(after) != string(before) {
		t.Fatal("receipt query rewrote or extended lease", err)
	}
	stateAfter, err := os.ReadFile(filepath.Join(e.Config.State, "state.json"))
	if err != nil || string(stateBefore) != string(stateAfter) {
		t.Fatal("receipt query mutated canonical state/clock", err)
	}
}

func TestSignedRenewalReceiptRefusesChangedOriginalAuthority(t *testing.T) {
	for _, field := range []string{"exam", "uid", "start", "deadline", "original-deadline", "clock", "generation", "registration", "transport", "pause", "missing-nonce"} {
		t.Run(field, func(t *testing.T) {
			e, key, cmd := leaseFixture(t)
			cmd.Op = "renew-receipted-execution-lease"
			if _, err := e.Command(signedCommand(key, cmd), cmd.Username, cmd.Transport); err != nil {
				t.Fatal(err)
			}
			query := cmd
			query.Op, query.Nonce, query.Body.RenewalNonce = "execution-renewal-receipt", Token(), cmd.Nonce
			if err := e.WithState(func() error {
				a := e.state.Attempts[finalID]
				switch field {
				case "exam":
					a.Exam = "different-exam"
				case "uid":
					a.UID++
				case "start":
					a.Start++
				case "deadline":
					a.Deadline += 1000
				case "original-deadline":
					a.OriginalDeadline += 1000
				case "clock":
					a.ClockRevision++
				case "generation":
					a.Generation++
				case "registration":
					delete(e.state.Registrations, cmd.Transport)
				case "transport":
					a.Transport = "different"
				case "pause":
					a.State = "LOCKED"
				case "missing-nonce":
					query.Body.RenewalNonce = Token()
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			before, err := os.ReadFile(filepath.Join(e.Config.State, "state.json"))
			if err != nil {
				t.Fatal(err)
			}
			if _, err := e.Command(signedCommand(key, query), cmd.Username, cmd.Transport); err == nil {
				t.Fatal("receipt recovered across changed original authority", field)
			}
			after, err := os.ReadFile(filepath.Join(e.Config.State, "state.json"))
			if err != nil || string(before) != string(after) {
				t.Fatal("refusal consumed state or time", err)
			}
		})
	}
}

func TestSignedRenewalReceiptNeverRecoversVisibleUnconfirmedPublication(t *testing.T) {
	e, key, cmd := leaseFixture(t)
	cmd.Op = "renew-receipted-execution-lease"
	if _, err := e.Command(signedCommand(key, cmd), cmd.Username, cmd.Transport); err != nil {
		t.Fatal(err)
	}
	query := cmd
	query.Op, query.Nonce, query.Body.RenewalNonce = "execution-renewal-receipt", Token(), cmd.Nonce
	lock, err := os.OpenFile(filepath.Join(e.Config.State, "leases", finalID+".lock"), os.O_RDWR, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Close()
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		t.Fatal(err)
	}
	started := time.Now()
	if _, err := e.Command(signedCommand(key, query), cmd.Username, cmd.Transport); err == nil || time.Since(started) > time.Second {
		t.Fatal("held publisher lock did not refuse promptly", err)
	}
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_UN); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Command(signedCommand(key, query), cmd.Username, cmd.Transport); err != nil {
		t.Fatal("confirmed exact receipt did not recover after publisher released", err)
	}
}

func TestSignedRenewalReceiptRequiresLiveAgentPublicationConfirmation(t *testing.T) {
	e, key, cmd := leaseFixture(t)
	cmd.Op = "renew-receipted-execution-lease"
	if _, err := e.Command(signedCommand(key, cmd), cmd.Username, cmd.Transport); err != nil {
		t.Fatal(err)
	}
	query := cmd
	query.Op, query.Nonce, query.Body.RenewalNonce = "execution-renewal-receipt", Token(), cmd.Nonce
	replacement, err := New(e.Config)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := replacement.Command(signedCommand(key, query), cmd.Username, cmd.Transport); err == nil {
		t.Fatal("replacement agent reconstructed positive confirmation from a disk receipt")
	}
	if _, err := e.Command(signedCommand(key, query), cmd.Username, cmd.Transport); err != nil {
		t.Fatal("original live confirmation lost", err)
	}
	journal := filepath.Join(e.Config.State, "leases", finalID+".json")
	data, err := os.ReadFile(journal)
	if err != nil {
		t.Fatal(err)
	}
	// Valid JSON but different unconfirmed publication; an exclusive lock's
	// release or rename visibility alone cannot prove successful directory sync.
	if err := os.WriteFile(journal, append(data, '\n'), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Command(signedCommand(key, query), cmd.Username, cmd.Transport); err == nil {
		t.Fatal("visible but unconfirmed replacement receipt recovered")
	}
}

func TestSignedRenewalReceiptCapacityPreservesPriorAuthorityAndOneUse(t *testing.T) {
	e, key, cmd := leaseFixture(t)
	cmd.Op = "renew-receipted-execution-lease"
	for range executionRenewalReceiptLimit {
		cmd.Nonce = Token()
		if _, err := e.Command(signedCommand(key, cmd), cmd.Username, cmd.Transport); err != nil {
			t.Fatal("capacity fixture did not reach accepted receipt", err)
		}
	}
	path := filepath.Join(e.Config.State, "leases", finalID+".json")
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	last := cmd.Nonce
	cmd.Nonce = Token()
	if _, err := e.Command(signedCommand(key, cmd), cmd.Username, cmd.Transport); err == nil || !strings.Contains(err.Error(), "capacity") {
		t.Fatal("full receipt store missed intended capacity refusal", err)
	}
	after, err := os.ReadFile(path)
	if err != nil || string(before) != string(after) {
		t.Fatal("capacity refusal consumed a nonce or altered prior permission", err)
	}
	query := cmd
	query.Op, query.Nonce, query.Body.RenewalNonce = "execution-renewal-receipt", Token(), last
	if _, err := e.Command(signedCommand(key, query), cmd.Username, cmd.Transport); err != nil {
		t.Fatal("full store evicted a current confirmed receipt", err)
	}
}

func TestSignedRenewalReceiptRefusesLegacyNonceAndDoesNotWaitForGlobalLock(t *testing.T) {
	e, key, cmd := leaseFixture(t)
	if _, err := e.Command(signedCommand(key, cmd), cmd.Username, cmd.Transport); err != nil {
		t.Fatal(err)
	}
	query := cmd
	query.Op, query.Nonce, query.Body.RenewalNonce = "execution-renewal-receipt", Token(), cmd.Nonce
	if _, err := e.Command(signedCommand(key, query), cmd.Username, cmd.Transport); err == nil {
		t.Fatal("old one-use nonce was mistaken for an exact receipt")
	}
	cmd.Op, cmd.Nonce = "renew-receipted-execution-lease", Token()
	if _, err := e.Command(signedCommand(key, cmd), cmd.Username, cmd.Transport); err != nil {
		t.Fatal(err)
	}
	query.Body.RenewalNonce = cmd.Nonce
	lock, err := os.OpenFile(filepath.Join(e.Config.State, "lock"), os.O_RDWR, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Close()
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		t.Fatal(err)
	}
	completed := make(chan error, 1)
	go func() { _, err := e.Command(signedCommand(key, query), cmd.Username, cmd.Transport); completed <- err }()
	select {
	case err := <-completed:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("receipt query waited for unrelated canonical transaction")
	}
}

func TestSignedRenewalReceiptExpiresOriginalWhileLaterLeaseRemainsActive(t *testing.T) {
	e, key, cmd := leaseFixture(t)
	cmd.Op = "renew-receipted-execution-lease"
	if _, err := e.Command(signedCommand(key, cmd), cmd.Username, cmd.Transport); err != nil {
		t.Fatal(err)
	}
	first := cmd.Nonce
	data, err := os.ReadFile(filepath.Join(e.Config.State, "leases", finalID+".json"))
	if err != nil {
		t.Fatal(err)
	}
	var original executionLease
	if json.Unmarshal(data, &original) != nil {
		t.Fatal("missing original cutoff")
	}
	// Use the actual native cutoff, with a fresh valid renewal before it. No
	// fake host clock or rewritten/privately confirmed journal is the oracle.
	time.Sleep(time.Until(time.UnixMilli(original.Until)) - 2*time.Second)
	cmd.Nonce, cmd.Expires = Token(), Millis()+20000
	if _, err := e.Command(signedCommand(key, cmd), cmd.Username, cmd.Transport); err != nil {
		t.Fatal("later authority did not renew before original cutoff", err)
	}
	time.Sleep(time.Until(time.UnixMilli(original.Until)) + 20*time.Millisecond)
	query := cmd
	query.Op, query.Nonce, query.Body.RenewalNonce = "execution-renewal-receipt", Token(), first
	if _, err := e.Command(signedCommand(key, query), cmd.Username, cmd.Transport); err == nil {
		t.Fatal("newer permission refreshed an expired original receipt")
	}
	query.Body.RenewalNonce = cmd.Nonce
	if _, err := e.Command(signedCommand(key, query), cmd.Username, cmd.Transport); err != nil {
		t.Fatal("expiry control did not leave later real authority active", err)
	}
}

func TestSignedRenewalReceiptRequiresExactRegisteredOwner(t *testing.T) {
	for _, change := range []string{"missing-page", "wrong-page", "new-authorization", "erased-owner", "owner-clock"} {
		t.Run(change, func(t *testing.T) {
			e, key, cmd := leaseFixture(t)
			cmd.Op, cmd.Transport, cmd.Body.PageEpoch = "renew-owner-receipted-execution-lease", Hash([]byte("synthetic registered transport")), Hash([]byte("synthetic registered page"))
			if err := e.WithState(func() error {
				a := e.state.Attempts[finalID]
				a.Transport = cmd.Transport
				e.state.Registrations[cmd.Transport] = cmd.Username
				return registerPageOwner(a, cmd.Body.PageEpoch, Token())
			}); err != nil {
				t.Fatal(err)
			}
			if _, err := e.Command(signedCommand(key, cmd), cmd.Username, cmd.Transport); err != nil {
				t.Fatal("registered renewal setup refused", err)
			}
			query := cmd
			query.Op, query.Nonce, query.Body.RenewalNonce = "execution-renewal-receipt", Token(), cmd.Nonce
			if _, err := e.Command(signedCommand(key, query), cmd.Username, cmd.Transport); err != nil {
				t.Fatal("original owner control failed", err)
			}
			if err := e.WithState(func() error {
				a := e.state.Attempts[finalID]
				switch change {
				case "missing-page":
					query.Body.PageEpoch = ""
				case "wrong-page":
					query.Body.PageEpoch = Hash([]byte("different page"))
				case "erased-owner":
					a.RegisteredOwner = nil
				default:
					owner := *a.RegisteredOwner
					if change == "new-authorization" {
						owner.InputEpoch = Token()
					} else {
						owner.ClockRevision++
					}
					a.RegisteredOwner = &owner
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			if _, err := e.Command(signedCommand(key, query), cmd.Username, cmd.Transport); err == nil {
				t.Fatal("receipt crossed registered ownership", change)
			}
		})
	}
}
