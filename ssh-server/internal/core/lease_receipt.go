package core

// Runtime caller: the distinct signed execution-renewal-receipt command. This
// observes an already committed LEGACY lease, never renews, thaws or bootstraps
// the future C10 live authority. Original one-use renewal commands still refuse
// replay. A repeat of this read-only purpose creates no permission or clock.

import (
	"encoding/json"
	"errors"
	"syscall"
)

const executionRenewalReceiptLimit = 64

// Confirmation of a completed legacy journal publication, NOT execution
// authority. It is never restored from disk or shared with a replacement agent.
type executionRenewalConfirmation struct {
	Hash      string
	UntilBoot int64
}

func (e *Engine) confirmExecutionRenewal(id, hash string, untilBoot int64) {
	e.renewalReceiptMu.Lock()
	defer e.renewalReceiptMu.Unlock()
	if e.renewalReceiptConfirmed == nil {
		e.renewalReceiptConfirmed = map[string]executionRenewalConfirmation{}
	}
	// Each accepted receipt lasts at most15 seconds. No IO under this mutex and
	// no fresh confirmation is evicted to recover another account's reply.
	now := untilBoot - 15000
	for attempt, confirmation := range e.renewalReceiptConfirmed {
		if confirmation.UntilBoot <= now {
			delete(e.renewalReceiptConfirmed, attempt)
		}
	}
	if len(e.renewalReceiptConfirmed) < 4096 || e.renewalReceiptConfirmed[id].Hash != "" {
		e.renewalReceiptConfirmed[id] = executionRenewalConfirmation{Hash: hash, UntilBoot: untilBoot}
	}
}

func (e *Engine) executionRenewalConfirmed(id, hash string, nowBoot int64) bool {
	e.renewalReceiptMu.Lock()
	defer e.renewalReceiptMu.Unlock()
	confirmation, ok := e.renewalReceiptConfirmed[id]
	return ok && confirmation.Hash == hash && confirmation.UntilBoot > nowBoot
}

type executionRenewalReceipt struct {
	Exam             string `json:"exam"`
	UID              int    `json:"uid"`
	Start            int64  `json:"start"`
	Deadline         int64  `json:"deadline"`
	OriginalDeadline int64  `json:"original_deadline"`
	Issued           int64  `json:"issued"`
	Until            int64  `json:"until"`
	IssuedBoot       int64  `json:"issued_boot_ms"`
	UntilBoot        int64  `json:"until_boot_ms"`
}

type executionRenewalStatus struct {
	Version     int      `json:"version"`
	Nonce       string   `json:"nonce"`
	Until       int64    `json:"until"`
	RemainingMS int64    `json:"remaining_ms"`
	Attempt     *Attempt `json:"attempt"`
}

var errExecutionRenewalReceipt = errors.New("exact committed renewal receipt unavailable or superseded; no permission or renewal inferred; preserve the original pending command and inspect examctl info ATTEMPT --read-only")

func sameExecutionReceiptContext(l executionLease, a *Attempt) bool {
	return a != nil && l.ID == a.ID && l.Username == a.Username && l.Transport == a.Transport && l.Boot == a.Boot && l.Generation == a.Generation && l.ClockRevision == a.ClockRevision &&
		((a.RegisteredOwner == nil && l.RegisteredOwner == (monitoringOwner{})) || (a.RegisteredOwner != nil && l.RegisteredOwner == *a.RegisteredOwner))
}

func (e *Engine) signedRenewalReceipt(cmd Command, username, transport string) (any, error) {
	if !attemptID.MatchString(cmd.Body.ID) || cmd.Transport != transport || transport == "" || len(cmd.Body.RenewalNonce) < 16 || len(cmd.Body.RenewalNonce) > 64 {
		return nil, errExecutionRenewalReceipt
	}
	root, err := readOnlyRoot(e.Config.State)
	if err != nil {
		return nil, errExecutionRenewalReceipt
	}
	defer root.Close()
	dir, err := readOnlyOpenAt(root, "leases", true)
	if err != nil {
		return nil, errExecutionRenewalReceipt
	}
	defer dir.Close()
	lock, err := readOnlyOpenAt(dir, cmd.Body.ID+".lock", false)
	if err != nil {
		return nil, errExecutionRenewalReceipt
	}
	defer lock.Close()
	// Rename visibility is NOT durable commit. The writer holds EX through file
	// and directory sync plus revocation recheck. Never wait for it or recover
	// an unconfirmed intermediate record; the client keeps its original command.
	if privateRecordingFile(lock) != nil || syscall.Flock(int(lock.Fd()), syscall.LOCK_SH|syscall.LOCK_NB) != nil {
		return nil, errExecutionRenewalReceipt
	}
	data, err := readOnlyFile(dir, cmd.Body.ID+".json", 4*1024*1024)
	var lease executionLease
	if err != nil || !validReadOnlyJSON(data) || json.Unmarshal(data, &lease) != nil || len(lease.Receipts) > executionRenewalReceiptLimit {
		return nil, errExecutionRenewalReceipt
	}
	state, err := readStateSnapshot(e.Config.State)
	if err != nil {
		return nil, errExecutionRenewalReceipt
	}
	a := state.Attempts[cmd.Body.ID]
	if a == nil || a.ID != cmd.Body.ID || a.Username != username || a.Transport != transport || state.Registrations[transport] != username || (cmd.Body.Username != "" && cmd.Body.Username != username) {
		return nil, errExecutionRenewalReceipt
	}
	applyExecutionLeaseValue(a, lease, Millis())
	if a.State != "ACTIVE" || expired(a) || a.Lease <= Millis() || a.Boot != boot() {
		return publicAttempt(a), errors.New("cannot recover a renewal for locked/ended workload")
	}
	if !sameExecutionReceiptContext(lease, a) || requireRegisteredPage(a, cmd.Body.PageEpoch) != nil {
		return nil, errExecutionRenewalReceipt
	}
	receipt, found := lease.Receipts[cmd.Body.RenewalNonce]
	nowBoot, clockErr := monitoringBootMillis()
	now := Millis()
	if !found || clockErr != nil || cmd.Expires <= now || lease.Nonces[cmd.Body.RenewalNonce] <= now || receipt.Exam != a.Exam || receipt.UID != a.UID || receipt.Start != a.Start || receipt.Deadline != a.Deadline || receipt.OriginalDeadline != a.OriginalDeadline || receipt.Issued <= 0 || receipt.IssuedBoot < 0 || receipt.Until <= receipt.Issued || receipt.Until-receipt.Issued != 15000 || receipt.UntilBoot <= receipt.IssuedBoot || receipt.UntilBoot-receipt.IssuedBoot != 15000 || nowBoot < receipt.IssuedBoot || receipt.Until > lease.Until {
		return nil, errExecutionRenewalReceipt
	}
	remaining := min(receipt.Until-now, receipt.UntilBoot-nowBoot, a.Lease-now, a.Deadline-now)
	if a.UptimeDeadline > 0 {
		remaining = min(remaining, int64(a.UptimeDeadline*1000)-nowBoot)
	}
	if remaining <= 0 || remaining > 15000 || !e.executionRenewalConfirmed(a.ID, Hash(data), nowBoot) {
		return nil, errExecutionRenewalReceipt
	}
	return executionRenewalStatus{Version: 1, Nonce: cmd.Body.RenewalNonce, Until: receipt.Until, RemainingMS: remaining, Attempt: publicAttempt(a)}, nil
}
