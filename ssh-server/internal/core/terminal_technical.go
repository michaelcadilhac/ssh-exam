package core

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
)

// Runtime caller: the distinct technical Continue command, through the same
// supervisor preparation/commit barrier as reviewed Continue. A continuity
// witness is historical live identity, never a permit or a restored actor seal.

const monitoringTechnicalContinue = "monitoring-technical-continue/v1"

// Metadata selects an actor to challenge; it is never restored authority.
func technicalRecoveryCandidate(a *Attempt) bool {
	if a == nil || a.RegisteredOwner == nil || a.Start <= 0 || a.MonitoringMode != "v1" || expired(a) {
		return false
	}
	if a.RegisteredOwner.Generation > a.Generation {
		return false
	}
	scoped, owner := *a, *a.RegisteredOwner
	owner.Generation = a.Generation
	scoped.RegisteredOwner = &owner
	if !currentRegisteredOwner(&scoped) {
		return false
	}
	return (a.State == "LOCKED" && a.RetainedHold == "held" && a.MonitoringHoldKind == "technical") ||
		(a.State == "ACTIVE" && a.MonitoringResumeKind == "technical")
}

// Runtime caller: the existing watchdog observer. A current-page HTTP waiter
// supplies a one-use request nonce over existing mutual signed exchanges.
func (e *Engine) pollTechnicalRecovery(ctx context.Context, a *Attempt) error {
	if !technicalRecoveryCandidate(a) || ctx.Err() != nil {
		return errMonitoringScope
	}
	nonce := Token()
	frame, err := e.exchangeTerminalMonitoring(ctx, "/api/agent/monitoring-technical", map[string]any{
		"type": "monitoring-technical-poll/v1", "agent": e.Config.AgentID,
		"nonce": nonce, "generation": a.Generation, "owner": a.RegisteredOwner,
	})
	if err != nil {
		return err
	}
	key, err := publicKey(e.Config.GatewayPublicKey)
	if err != nil {
		return err
	}
	payload, err := base64.StdEncoding.Strict().DecodeString(frame.Payload)
	signature, signatureErr := base64.StdEncoding.Strict().DecodeString(frame.Signature)
	if err != nil || signatureErr != nil || len(payload) > monitoringEvidenceMaxBytes || !ed25519.Verify(key, payload, signature) {
		return errMonitoringEvidence
	}
	var reply struct {
		Type         string `json:"type"`
		Audience     string `json:"audience"`
		Nonce        string `json:"nonce"`
		RequestNonce string `json:"request_nonce"`
	}
	if _, err := decodeMonitoringObject(payload, &reply, []string{"type", "audience", "nonce", "request_nonce"}); err != nil || reply.Type != "monitoring-technical-poll/v1" || reply.Audience != e.Config.AgentID || reply.Nonce != nonce || !monitoringDigest.MatchString(reply.RequestNonce) {
		return errMonitoringEvidence
	}
	if ctx.Err() != nil {
		return errMonitoringAuthority
	}
	// resumeTechnical rechecks the canonical transaction AND actual live pinned
	// supervisor; the snapshot and web poll do not authorize a thaw.
	result, err := e.resumeTechnical(a, Request{Generation: a.Generation, PageEpoch: a.RegisteredOwner.PageEpoch})
	if err != nil {
		return err
	}
	if ctx.Err() != nil {
		return errMonitoringAuthority
	}
	_, err = e.exchangeTerminalMonitoring(ctx, "/api/agent/monitoring-technical", map[string]any{
		"type": "monitoring-technical-result/v1", "agent": e.Config.AgentID,
		"request_nonce": reply.RequestNonce, "result": result,
	})
	return err
}

type terminalTechnicalContinuity struct {
	Owner             monitoringOwner `json:"owner"`
	CoverageEpoch     string          `json:"coverage_epoch"`
	AfterSequence     uint64          `json:"after_sequence"`
	LastAcceptedNonce string          `json:"last_accepted_nonce"`
}

func (a *monitoringAuthority) technicalContinuity(retryingTechnical bool) (terminalTechnicalContinuity, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	now, current := a.tickLocked()
	if !current || a.phase != "revoking" || now >= a.context.DeadlineUptimeMS ||
		a.context.CoverageEpoch == "" || a.context.Sequence == 0 || len(a.causes) == 0 {
		return terminalTechnicalContinuity{}, errMonitoringAuthority
	}
	for cause := range a.causes {
		if cause != "technical-expiry" && !(retryingTechnical && cause == "resume-unverified") {
			return terminalTechnicalContinuity{}, errMonitoringAuthority
		}
	}
	return terminalTechnicalContinuity{Owner: a.context.Owner, CoverageEpoch: a.context.CoverageEpoch,
		AfterSequence: a.context.Sequence, LastAcceptedNonce: a.acceptedNonce}, nil
}

func (s *terminalSupervisor) technicalContinuity(owner monitoringOwner) (terminalTechnicalContinuity, error) {
	s.mu.Lock()
	r := s.workAuthority
	if r == nil || r.owner != owner || !r.live.Load() || !r.peer.current() || !r.claim.current() || r.hold == nil {
		s.mu.Unlock()
		return terminalTechnicalContinuity{}, errMonitoringAuthority
	}
	h, retrying := r.hold, r.resumeKind == "technical"
	s.mu.Unlock()
	if !h.mu.TryLock() {
		return terminalTechnicalContinuity{}, errTerminalHold
	}
	defer h.mu.Unlock()
	if h.phase != "held" {
		return terminalTechnicalContinuity{}, errTerminalHold
	}
	return r.authority.technicalContinuity(retrying)
}
