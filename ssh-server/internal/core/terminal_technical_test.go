package core

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestMonitoringTechnicalContinuationPurposePreservesSequenceWithoutWeakeningReviewedProof(t *testing.T) {
	pub, key, challenge, _ := evidenceFixture(t)
	previous := challenge.Owner
	owner := previous
	owner.Generation++
	owner.InputEpoch = strings.Repeat("d", 64)
	seed := monitoringBootstrap{Type: "monitoring-bootstrap/v2", ControlRetention: "v1", PolicyReports: "v1", Owner: owner, CoverageEpoch: strings.Repeat("e", 64), Sequence: 40}
	proof := monitoringContinueReply{Type: monitoringTechnicalContinue, Audience: "class", Nonce: strings.Repeat("f", 64), ExchangeNonce: strings.Repeat("a", 64), PreviousOwner: previous, Owner: owner, AuthorizationExpires: Millis() + 30000, Expires: Millis() + 20000, CaptureValidFor: 12000, Bootstrap: &seed}
	decode := func() error {
		payload, err := json.Marshal(proof)
		if err != nil {
			t.Fatal(err)
		}
		_, err = decodeMonitoringContinuation(signEvidenceBytes(key, payload), pub)
		return err
	}
	if err := decode(); err != nil {
		t.Fatal("technical proof lost the existing sequence", err)
	}
	proof.Type = "monitoring-continue/v1"
	proof.ExchangeNonce = ""
	if decode() == nil {
		t.Fatal("reviewed proof accepted a technical sequence")
	}
	seed.Sequence = 1
	if err := decode(); err != nil {
		t.Fatal("reviewed positive control refused", err)
	}
	proof.Expires = Millis() - 1
	if decode() == nil {
		t.Fatal("expired reviewed proof accepted")
	}
	proof.Type = monitoringTechnicalContinue
	proof.ExchangeNonce = strings.Repeat("a", 64)
	// Technical runtime uses its matching exchange's native BOOTTIME cutoff, not this wall
	// timestamp. Decoder acceptance alone is deliberately NOT work permission.
	if err := decode(); err != nil {
		t.Fatal("wall time replaced native cutoff", err)
	}
	proof.Type = "monitoring-technical-continue/v1"
	proof.ExchangeNonce = ""
	if decode() == nil {
		t.Fatal("old technical role bypassed the fresh-exchange contract")
	}
	proof.Type = monitoringTechnicalContinue
	if decode() == nil {
		t.Fatal("technical proof without exchange nonce accepted")
	}
	proof.ExchangeNonce = strings.Repeat("a", 64)
	for _, invalid := range []int64{0, monitoringEvidenceWindowMS + 1} {
		proof.CaptureValidFor = invalid
		if decode() == nil {
			t.Fatal("invalid capture allowance accepted", invalid)
		}
	}
}

func TestTechnicalResumeFreshExchangeDoesNotSpendItsPermitWaitingToFetchProof(t *testing.T) {
	p := &terminalResumePrepared{Nonce: Token(), IssuedBootMS: 1000}
	first, err := p.issueProofExchange(2000)
	if err != nil {
		t.Fatal(err)
	}
	// A failed fetch leaves the stable transaction prepared. This later proof
	// exchange must charge its own full round trip, not the old preparation wait.
	second, err := p.issueProofExchange(50000)
	if err != nil {
		t.Fatal(err)
	}
	if first.Nonce != second.Nonce || first.ExchangeNonce == second.ExchangeNonce || p.IssuedBootMS != 1000 {
		t.Fatal("proof exchange changed operation identity or reused a transport nonce")
	}
	proof := monitoringContinueReply{Type: monitoringTechnicalContinue, Nonce: p.Nonce, ExchangeNonce: second.ExchangeNonce, CaptureValidFor: 60000}
	issued, err := p.consumeProofExchange(proof, 51000)
	if err != nil {
		t.Fatal(err)
	}
	if issued+proof.CaptureValidFor-51000 != 59000 {
		t.Fatal("fresh proof lost time before its own exchange", issued)
	}
	if _, err := p.consumeProofExchange(proof, 51001); err == nil {
		t.Fatal("consumed exchange replayed")
	}
	proof.ExchangeNonce = first.ExchangeNonce
	proof.CaptureValidFor = 10000
	if _, err := p.consumeProofExchange(proof, 51000); err == nil {
		t.Fatal("old exchange refreshed its cutoff")
	}
}

func TestTechnicalResumeExchangeMismatchExpiryAndCapacityFailClosed(t *testing.T) {
	p := &terminalResumePrepared{Nonce: Token(), IssuedBootMS: 1000}
	var exchange terminalResumePrepared
	for i := 0; i < 8; i++ {
		var err error
		exchange, err = p.issueProofExchange(2000 + int64(i))
		if err != nil {
			t.Fatal(err)
		}
	}
	if _, err := p.issueProofExchange(3000); err == nil {
		t.Fatal("unbounded outstanding exchanges")
	}
	proof := monitoringContinueReply{Type: monitoringTechnicalContinue, Nonce: p.Nonce, ExchangeNonce: exchange.ExchangeNonce, CaptureValidFor: 60000}
	for _, fault := range []string{"nonce", "operation", "clock", "expiry", "purpose"} {
		bad, at := proof, int64(3000)
		switch fault {
		case "nonce":
			bad.ExchangeNonce = Token()
		case "operation":
			bad.Nonce = Token()
		case "clock":
			at = 1000
		case "expiry":
			at = 62007
		case "purpose":
			bad.Type = "monitoring-continue/v1"
		}
		if _, err := p.consumeProofExchange(bad, at); err == nil {
			t.Fatal("invalid exchange accepted", fault)
		}
	}
	if _, err := p.issueProofExchange(62008); err != nil {
		t.Fatal("expired exchange capacity did not recover", err)
	}
	if len(p.exchanges) != 1 {
		t.Fatal("expired exchanges retained")
	}
}

func TestTechnicalResumeInFlightExchangePinsOperationAndCancellationIsScoped(t *testing.T) {
	_, _, challenge, _ := evidenceFixture(t)
	p := &terminalResumePrepared{Nonce: Token(), IssuedBootMS: 1000}
	exchange, err := p.issueProofExchange(50000)
	if err != nil {
		t.Fatal(err)
	}
	// A simultaneous caller must not replace the operation while this fresh
	// proof is in flight, even though the original preparation is old.
	if !p.reusablePreparation(65000, true) || p.reusablePreparation(65000, false) {
		t.Fatal("technical exchange did not pin exactly its own operation")
	}
	hold := &terminalHold{}
	r := &terminalAuthorityRuntime{owner: challenge.Owner, resume: p, hold: hold}
	s := &terminalSupervisor{workAuthority: r}
	wrongOwner := challenge.Owner
	wrongOwner.Generation++
	if s.cancelTechnicalProofExchange(wrongOwner, p.Nonce, exchange.ExchangeNonce) == nil ||
		s.cancelTechnicalProofExchange(challenge.Owner, Token(), exchange.ExchangeNonce) == nil {
		t.Fatal("stale owner/operation cancelled an in-flight exchange")
	}
	if err := s.cancelTechnicalProofExchange(challenge.Owner, p.Nonce, Token()); err != nil || len(p.exchanges) != 1 {
		t.Fatal("unknown exchange affected a sibling", err)
	}
	if err := s.cancelTechnicalProofExchange(challenge.Owner, p.Nonce, exchange.ExchangeNonce); err != nil {
		t.Fatal(err)
	}
	if p.reusablePreparation(65000, true) || r.hold != hold || r.resume != p || r.owner != challenge.Owner || r.authority != nil {
		t.Fatal("cancellation changed hold/owner/authority or pinned a failed operation")
	}
	proof := monitoringContinueReply{Type: monitoringTechnicalContinue, Nonce: p.Nonce, ExchangeNonce: exchange.ExchangeNonce, CaptureValidFor: 60000}
	if _, err := p.consumeProofExchange(proof, 65000); err == nil {
		t.Fatal("cancelled exchange remained usable")
	}
	if p.reusablePreparation(999, true) {
		t.Fatal("backwards clock reused a preparation")
	}
	fresh, err := p.issueProofExchange(65000)
	if err != nil || !p.reusablePreparation(70000, true) || p.reusablePreparation(125000, true) {
		t.Fatal("exchange expiry was replaced by operation age", fresh, err)
	}
}

func TestTechnicalResumeCanonicalCommitDoesNotRotateAnInFlightOperation(t *testing.T) {
	p := &terminalResumePrepared{Nonce: Token(), IssuedBootMS: 1000}
	if _, err := p.issueProofExchange(50000); err != nil {
		t.Fatal(err)
	}
	// A coordinator can observe canonical ACTIVE/resuming while another caller
	// has not yet committed this exact operation in the live supervisor. Its
	// recovery entry must not replace the pending owner's nonce/input epochs.
	if !p.reusableRecovery(p.Nonce, 65000, true) {
		t.Fatal("canonical progress invalidated the in-flight technical operation")
	}
	if p.reusableRecovery(Token(), 65000, true) || p.reusableRecovery(p.Nonce, 65000, false) || p.reusableRecovery(p.Nonce, 110000, true) {
		t.Fatal("wrong purpose, operation or expired exchange pinned recovery")
	}
	p.PreviousNonce = Token()
	if !p.reusableRecovery(p.PreviousNonce, 2000, false) {
		t.Fatal("existing reviewed interrupted recovery stopped matching its predecessor")
	}
}
