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
	seed := monitoringBootstrap{Type: "monitoring-bootstrap/v1", ControlRetention: "v1", PolicyReports: "v1", Owner: owner, CoverageEpoch: strings.Repeat("e", 64), Sequence: 40}
	proof := monitoringContinueReply{Type: monitoringTechnicalContinue, Audience: "class", Nonce: strings.Repeat("f", 64), PreviousOwner: previous, Owner: owner, AuthorizationExpires: Millis() + 30000, Expires: Millis() + 20000, CaptureValidFor: 12000, Bootstrap: &seed}
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
	// Technical runtime uses the prepared native BOOTTIME cutoff, not this wall
	// timestamp. Decoder acceptance alone is deliberately NOT work permission.
	if err := decode(); err != nil {
		t.Fatal("wall time replaced native cutoff", err)
	}
	for _, invalid := range []int64{0, 15001} {
		proof.CaptureValidFor = invalid
		if decode() == nil {
			t.Fatal("invalid capture allowance accepted", invalid)
		}
	}
}
