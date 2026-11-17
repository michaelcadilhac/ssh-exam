package core

// The stable operation nonce protects idempotent recovery. It is not the clock
// origin for a later proof fetch. These exchanges are live supervisor memory,
// bounded and one-use; restart cannot reconstruct a fresh permit from metadata.
// Callers hold the supervisor mutex while accessing the prepared exchange map.
func (p *terminalResumePrepared) reusablePreparation(now int64, technical bool) bool {
	if p == nil || now < p.IssuedBootMS {
		return false
	}
	if now-p.IssuedBootMS < monitoringEvidenceWindowMS {
		return true
	}
	if technical {
		for _, issued := range p.exchanges {
			if now >= issued && now-issued < monitoringEvidenceWindowMS {
				return true
			}
		}
	}
	return false
}

func (p *terminalResumePrepared) reusableRecovery(nonce string, now int64, technical bool) bool {
	return p != nil && (p.PreviousNonce == nonce || (technical && p.Nonce == nonce)) &&
		p.reusablePreparation(now, technical)
}

func (p *terminalResumePrepared) issueProofExchange(now int64) (terminalResumePrepared, error) {
	if p == nil || now <= 0 || now < p.IssuedBootMS {
		return terminalResumePrepared{}, errMonitoringAuthority
	}
	if p.exchanges == nil {
		p.exchanges = map[string]int64{}
	}
	for nonce, at := range p.exchanges {
		if now < at || now-at >= monitoringEvidenceWindowMS {
			delete(p.exchanges, nonce)
		}
	}
	if len(p.exchanges) >= 8 {
		return terminalResumePrepared{}, errTerminalHold
	}
	nonce := Token()
	if _, exists := p.exchanges[nonce]; exists {
		return terminalResumePrepared{}, errMonitoringEvidence
	}
	p.exchanges[nonce] = now
	copy := *p
	copy.ExchangeNonce, copy.ExchangeIssuedBootMS, copy.exchanges = nonce, now, nil
	return copy, nil
}

func (p *terminalResumePrepared) proofExchangeIssued(proof monitoringContinueReply, now int64) (int64, error) {
	at, found := p.exchanges[proof.ExchangeNonce]
	if proof.Type != monitoringTechnicalContinue || proof.Nonce != p.Nonce || !found ||
		!monitoringDigest.MatchString(proof.ExchangeNonce) || at <= 0 || now < at ||
		proof.CaptureValidFor <= 0 || proof.CaptureValidFor > monitoringEvidenceWindowMS ||
		now-at >= proof.CaptureValidFor {
		return 0, errMonitoringAuthority
	}
	return at, nil
}

func (p *terminalResumePrepared) consumeProofExchange(proof monitoringContinueReply, now int64) (int64, error) {
	at, err := p.proofExchangeIssued(proof, now)
	if err != nil {
		return 0, err
	}
	delete(p.exchanges, proof.ExchangeNonce)
	return at, nil
}

func (s *terminalSupervisor) cancelTechnicalProofExchange(owner monitoringOwner, nonce, exchange string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	r := s.workAuthority
	if r == nil || r.owner != owner || r.resume == nil || r.resume.Nonce != nonce ||
		r.hold == nil || !monitoringDigest.MatchString(exchange) {
		return errMonitoringScope
	}
	// Cancellation cannot release a hold, change an owner or create authority.
	// A stale or repeated cancellation is harmless to every other exchange.
	delete(r.resume.exchanges, exchange)
	return nil
}

func (s *terminalSupervisor) prepareTechnicalProofExchange(owner monitoringOwner, prepared terminalResumePrepared) (terminalResumePrepared, error) {
	s.mu.Lock()
	r := s.workAuthority
	if r == nil || r.owner != owner || r.resume == nil || r.resume.Nonce != prepared.Nonce || r.hold == nil ||
		!r.live.Load() || !r.peer.current() || !r.claim.current() {
		s.mu.Unlock()
		return terminalResumePrepared{}, errMonitoringAuthority
	}
	p, h := r.resume, r.hold
	s.mu.Unlock()
	if !h.mu.TryLock() {
		return terminalResumePrepared{}, errTerminalHold
	}
	defer h.mu.Unlock()
	now, err := monitoringBootMillis()
	if err != nil || now >= r.deadlineBootMS {
		return terminalResumePrepared{}, errMonitoringAuthority
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.workAuthority != r || r.resume != p || r.owner != owner || r.hold != h || h.phase != "held" {
		return terminalResumePrepared{}, errMonitoringScope
	}
	return p.issueProofExchange(now)
}
