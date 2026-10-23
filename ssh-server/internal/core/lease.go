package core

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"syscall"
)

// Lease renewal must not wait for collection, systemctl or another attempt's
// state transaction. Only signed, transport-bound renewals take this path.
type executionLease struct {
	ClockRevision   int                                `json:"clock_revision,omitempty"`
	Receipts        map[string]executionRenewalReceipt `json:"receipts,omitempty"`
	RegisteredOwner monitoringOwner                    `json:"registered_owner,omitzero"`
	ID              string                             `json:"id"`
	Username        string                             `json:"username"`
	Transport       string                             `json:"transport"`
	Boot            string                             `json:"boot"`
	Generation      int                                `json:"generation"`
	Until           int64                              `json:"until"`
	Nonces          map[string]int64                   `json:"nonces"`
}

func readStateSnapshot(path string) (State, error) {
	var s State
	b, err := os.ReadFile(filepath.Join(path, "state.json"))
	if err != nil {
		return s, err
	}
	if err = json.Unmarshal(b, &s); err != nil {
		return s, err
	}
	if s.Attempts == nil || s.Registrations == nil {
		return s, errors.New("invalid administrator state")
	}
	return s, nil
}

func (e *Engine) renewSignedLease(cmd Command, username, transport string) (any, error) {
	if !attemptID.MatchString(cmd.Body.ID) || cmd.Transport != transport || transport == "" {
		return nil, errors.New("attempt SSH transport mismatch")
	}
	dir := filepath.Join(e.Config.State, "leases")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	lock, err := os.OpenFile(filepath.Join(dir, cmd.Body.ID+".lock"), os.O_CREATE|os.O_RDWR|syscall.O_NOFOLLOW, 0600)
	if err != nil {
		return nil, err
	}
	defer lock.Close()
	if err = syscall.Flock(int(lock.Fd()), syscall.LOCK_EX); err != nil {
		return nil, err
	}
	defer syscall.Flock(int(lock.Fd()), syscall.LOCK_UN)
	var issuedBoot int64
	if cmd.Body.renewalReceipt {
		issuedBoot, err = monitoringBootMillis()
		if err != nil {
			return nil, err
		}
	}
	now := Millis()
	if cmd.Expires <= now || cmd.Expires > now+30000 {
		return nil, errors.New("command expired")
	}
	state, err := readStateSnapshot(e.Config.State)
	if err != nil {
		return nil, err
	}
	a := state.Attempts[cmd.Body.ID]
	if a == nil || a.Username != username || a.Transport != transport || state.Registrations[transport] != username || (cmd.Body.Username != "" && cmd.Body.Username != username) {
		return nil, errors.New("attempt SSH transport mismatch")
	}
	if err = e.applyExecutionLease(a); err != nil {
		return nil, err
	}
	if a.State != "ACTIVE" || expired(a) || a.Lease <= now || a.Boot != boot() {
		// Preserve the authenticated reason/state for a racing administrator
		// pause or finish. This is still a rejection and grants no execution.
		return publicAttempt(a), errors.New("cannot renew locked/ended workload")
	}
	// A pause legitimately advances generation while retaining historical owner
	// metadata. Preserve that authenticated negative outcome above; only positive
	// renewal needs a current registered page, never mask an intentional lock.
	if cmd.Body.ownerRequired && a.RegisteredOwner == nil {
		return nil, errRegisteredOwner
	}
	if err = requireRegisteredPage(a, cmd.Body.PageEpoch); err != nil {
		return nil, err
	}
	file := filepath.Join(dir, a.ID+".json")
	lease := executionLease{}
	if b, readErr := os.ReadFile(file); readErr == nil {
		if err = json.Unmarshal(b, &lease); err != nil {
			return nil, err
		}
	} else if !os.IsNotExist(readErr) {
		return nil, readErr
	}
	nonces := lease.Nonces
	receipts := lease.Receipts
	if !sameExecutionReceiptContext(lease, a) {
		receipts = nil
	}
	if receipts == nil {
		receipts = map[string]executionRenewalReceipt{}
	}
	for nonce, receipt := range receipts {
		if receipt.Until <= now {
			delete(receipts, nonce)
		}
	}
	if cmd.Body.renewalReceipt && len(receipts) >= executionRenewalReceiptLimit {
		return nil, errors.New("renewal receipt capacity reached; no lease consumed; inspect examctl info ATTEMPT --read-only and current request rate")
	}
	if nonces == nil {
		nonces = map[string]int64{}
	}
	for nonce, until := range nonces {
		if until <= now {
			delete(nonces, nonce)
		}
	}
	if _, used := nonces[cmd.Nonce]; used {
		return nil, errors.New("command replay rejected")
	}
	if state.Commands[cmd.Nonce] > now {
		return nil, errors.New("command replay rejected")
	}
	nonces[cmd.Nonce] = cmd.Expires
	lease = executionLease{ID: a.ID, Username: username, Transport: transport, Boot: a.Boot, Generation: a.Generation, ClockRevision: a.ClockRevision, Until: now + 15000, Nonces: nonces, Receipts: receipts}
	if cmd.Body.renewalReceipt {
		receipts[cmd.Nonce] = executionRenewalReceipt{Issued: now, Until: lease.Until, IssuedBoot: issuedBoot, UntilBoot: issuedBoot + 15000, Exam: a.Exam, UID: a.UID, Start: a.Start, Deadline: a.Deadline, OriginalDeadline: a.OriginalDeadline}
	}
	if a.RegisteredOwner != nil {
		lease.RegisteredOwner = *a.RegisteredOwner
	}
	b, err := json.Marshal(lease)
	if err != nil {
		return nil, err
	}
	f, err := os.OpenFile(file+".tmp", os.O_WRONLY|os.O_CREATE|os.O_TRUNC|syscall.O_NOFOLLOW, 0600)
	if err != nil {
		return nil, err
	}
	_, err = f.Write(b)
	if err == nil {
		err = f.Sync()
	}
	f.Close()
	if err != nil {
		return nil, err
	}
	if err = os.Rename(file+".tmp", file); err != nil {
		return nil, err
	}
	directory, err := os.Open(dir)
	if err != nil {
		return nil, err
	}
	err = directory.Sync()
	directory.Close()
	if err != nil {
		return nil, err
	}
	// Recheck revocation after publication. A racing pause/finish can never be
	// undone: every consumer also checks state, generation, boot and transport.
	current, err := readStateSnapshot(e.Config.State)
	if err != nil {
		return nil, err
	}
	v := current.Attempts[a.ID]
	if v == nil || v.State != "ACTIVE" || v.Generation != a.Generation || v.Transport != transport || expired(v) || (v.RegisteredOwner == nil && lease.RegisteredOwner != (monitoringOwner{})) || (v.RegisteredOwner != nil && lease.RegisteredOwner != *v.RegisteredOwner) {
		if v != nil && v.Username == username && v.UID == a.UID && v.Transport == transport {
			return publicAttempt(v), errors.New("lease superseded by attempt transition")
		}
		return nil, errors.New("lease superseded by attempt transition")
	}
	if cmd.Body.renewalReceipt {
		e.confirmExecutionRenewal(a.ID, Hash(b), issuedBoot+15000)
	}
	a.Lease = lease.Until
	return publicAttempt(a), nil
}

func (e *Engine) applyExecutionLease(a *Attempt) error {
	if a.State != "ACTIVE" {
		return nil
	}
	b, err := os.ReadFile(filepath.Join(e.Config.State, "leases", a.ID+".json"))
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	var v executionLease
	if err = json.Unmarshal(b, &v); err != nil {
		return err
	}
	applyExecutionLeaseValue(a, v, Millis())
	return nil
}

// Runtime consumers: the existing journal reader and the read-only exact-receipt
// command, whose shared lease lock already pins the loaded committed value.
// No IO follows the latter's canonical state snapshot before its freshness read.
func applyExecutionLeaseValue(a *Attempt, v executionLease, now int64) {
	if a.State != "ACTIVE" {
		return
	}
	if (a.RegisteredOwner == nil && v.RegisteredOwner != (monitoringOwner{})) || (a.RegisteredOwner != nil && v.RegisteredOwner != *a.RegisteredOwner) {
		return
	}
	if v.ID == a.ID && v.Username == a.Username && v.Transport == a.Transport && v.Generation == a.Generation && v.Boot == a.Boot && v.Boot == boot() && v.Until > now && v.Until <= now+15000 && v.Until > a.Lease {
		a.Lease = v.Until
	}
}
