package core

// Signed evidence verification for the guarded attempt supervisor. Verification
// alone is not permission: its live authority rechecks current ownership, nonce,
// sequence and original cutoffs, then commits in memory independently of optional
// disk publication. Installed retained admission remains disabled. This verifier
// requires unexpired prior authority; held recovery/thaw is a separate barrier.
// Never fabricate a new AuthorityUntilMS to reuse an expired challenge.

import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"regexp"
)

const monitoringEvidenceWindowMS int64 = 15000
const monitoringChallengeWindowMS int64 = 5000
const monitoringEvidenceMaxBytes = 4096
const monitoringEvidenceMaxSequence uint64 = 9007199254740991

var monitoringDigest = regexp.MustCompile(`^[a-f0-9]{64}$`)
var monitoringUUID = regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`)

type monitoringOwner struct {
	Attempt       string `json:"attempt"`
	Exam          string `json:"exam"`
	Username      string `json:"username"`
	UID           int    `json:"uid"`
	TransportHash string `json:"transport_hash"`
	Boot          string `json:"boot"`
	PageEpoch     string `json:"page_epoch"`
	InputEpoch    string `json:"input_epoch"`
	Generation    int    `json:"generation"`
	ClockRevision int    `json:"clock_revision"`
}

// All timing bounds are native boot-monotonic milliseconds, supplied from the
// root caller's immutable request snapshot, never taken from a remote timestamp.
type monitoringChallenge struct {
	Agent            string
	PolicyReports    string
	Nonce            string
	Owner            monitoringOwner
	IssuedUptimeMS   int64
	ExpiresUptimeMS  int64
	AuthorityUntilMS int64
	DeadlineUptimeMS int64
	AfterSequence    uint64
	CoverageEpoch    string
}

type monitoringEvidence struct {
	Type          string          `json:"type"`
	Audience      string          `json:"audience"`
	Nonce         string          `json:"nonce"`
	Owner         monitoringOwner `json:"owner"`
	CoverageEpoch string          `json:"coverage_epoch"`
	Sequence      uint64          `json:"sequence"`
	AgeMS         int64           `json:"age_ms"`
	Complete      bool            `json:"complete"`
}

type monitoringPermitCandidate struct {
	Owner         monitoringOwner
	Nonce         string
	Sequence      uint64
	CoverageEpoch string
	UntilUptimeMS int64
}

func validMonitoringOwner(o monitoringOwner) bool {
	return monitoringUUID.MatchString(o.Attempt) && identifier.MatchString(o.Exam) && identifier.MatchString(o.Username) && o.UID >= 1000 && uint64(o.UID) <= 4294967294 && monitoringDigest.MatchString(o.TransportHash) && monitoringUUID.MatchString(o.Boot) && monitoringDigest.MatchString(o.PageEpoch) && monitoringDigest.MatchString(o.InputEpoch) && o.Generation >= 0 && uint64(o.Generation) <= monitoringEvidenceMaxSequence && o.ClockRevision >= 0 && uint64(o.ClockRevision) <= monitoringEvidenceMaxSequence
}

var errMonitoringEvidence = errors.New("monitoring evidence signature, ownership, sequence or freshness rejected; no execution permission granted; inspect current ownership/capture and matching gateway/native versions while preserving this attempt")

func decodeMonitoringObject(payload []byte, out any, keys []string) (map[string]json.RawMessage, error) {
	d := json.NewDecoder(bytes.NewReader(payload))
	first, err := d.Token()
	if err != nil || first != json.Delim('{') {
		return nil, errMonitoringEvidence
	}
	fields := map[string]json.RawMessage{}
	for d.More() {
		token, err := d.Token()
		key, ok := token.(string)
		if err != nil || !ok || fields[key] != nil {
			return nil, errMonitoringEvidence
		}
		var raw json.RawMessage
		if d.Decode(&raw) != nil || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
			return nil, errMonitoringEvidence
		}
		fields[key] = raw
	}
	if last, err := d.Token(); err != nil || last != json.Delim('}') || d.Decode(new(any)) != io.EOF || len(fields) != len(keys) {
		return nil, errMonitoringEvidence
	}
	for _, key := range keys {
		if fields[key] == nil {
			return nil, errMonitoringEvidence
		}
	}
	d = json.NewDecoder(bytes.NewReader(payload))
	d.DisallowUnknownFields()
	if d.Decode(out) != nil {
		return nil, errMonitoringEvidence
	}
	return fields, nil
}

// The trusted gateway reports evidence AGE at decision time, not its wall clock.
// Charge the FULL native round trip against that remaining budget. A delayed or
// retried reply therefore cannot mint a new 15-second window on receipt, and
// ordinary cross-host wall-clock skew cannot invent permission or a false gap.
func verifyMonitoringEvidence(frame SignedFrame, key ed25519.PublicKey, challenge monitoringChallenge, nowUptimeMS int64) (monitoringPermitCandidate, error) {
	bad := func() (monitoringPermitCandidate, error) { return monitoringPermitCandidate{}, errMonitoringEvidence }
	// Bootstrap is possible only before any evidence has been consumed. The
	// future caller must require ACTIVE/unexpired authority, never hold/thaw.
	// Once bound, a fresh frame/proof cannot conceal a coverage gap.
	if (challenge.CoverageEpoch == "" && challenge.AfterSequence != 0) || (challenge.CoverageEpoch != "" && !monitoringDigest.MatchString(challenge.CoverageEpoch)) {
		return bad()
	}
	if len(key) != ed25519.PublicKeySize || !identifier.MatchString(challenge.Agent) || !monitoringDigest.MatchString(challenge.Nonce) || !validMonitoringOwner(challenge.Owner) || challenge.IssuedUptimeMS < 0 || nowUptimeMS < challenge.IssuedUptimeMS || challenge.ExpiresUptimeMS <= challenge.IssuedUptimeMS || challenge.ExpiresUptimeMS-challenge.IssuedUptimeMS > monitoringChallengeWindowMS || nowUptimeMS >= challenge.ExpiresUptimeMS || nowUptimeMS >= challenge.AuthorityUntilMS || nowUptimeMS >= challenge.DeadlineUptimeMS || challenge.AfterSequence >= monitoringEvidenceMaxSequence || len(frame.Payload) > base64.StdEncoding.EncodedLen(monitoringEvidenceMaxBytes) || len(frame.Signature) != base64.StdEncoding.EncodedLen(ed25519.SignatureSize) {
		return bad()
	}
	payload, err := base64.StdEncoding.Strict().DecodeString(frame.Payload)
	if err != nil || len(payload) > monitoringEvidenceMaxBytes || base64.StdEncoding.EncodeToString(payload) != frame.Payload {
		return bad()
	}
	signature, err := base64.StdEncoding.Strict().DecodeString(frame.Signature)
	if err != nil || !ed25519.Verify(key, payload, signature) {
		return bad()
	}
	var proof monitoringEvidence
	fields, err := decodeMonitoringObject(payload, &proof, []string{"type", "audience", "nonce", "owner", "coverage_epoch", "sequence", "age_ms", "complete"})
	if err != nil {
		return bad()
	}
	if _, err = decodeMonitoringObject(fields["owner"], &proof.Owner, []string{"attempt", "exam", "username", "uid", "transport_hash", "boot", "page_epoch", "input_epoch", "generation", "clock_revision"}); err != nil {
		return bad()
	}
	if proof.Type != "monitoring-execution-evidence-v1" || proof.Audience != challenge.Agent || proof.Nonce != challenge.Nonce || proof.Owner != challenge.Owner || !monitoringDigest.MatchString(proof.CoverageEpoch) || (challenge.CoverageEpoch != "" && proof.CoverageEpoch != challenge.CoverageEpoch) || !proof.Complete || proof.Sequence <= challenge.AfterSequence || proof.Sequence > monitoringEvidenceMaxSequence || proof.AgeMS < 0 || proof.AgeMS >= monitoringEvidenceWindowMS {
		return bad()
	}
	remaining := monitoringEvidenceWindowMS - proof.AgeMS
	// Subtract before adding so a near-MaxInt64 native cutoff cannot overflow.
	if deadlineBudget := challenge.DeadlineUptimeMS - challenge.IssuedUptimeMS; remaining > deadlineBudget {
		remaining = deadlineBudget
	}
	if nowUptimeMS-challenge.IssuedUptimeMS >= remaining {
		return bad()
	}
	return monitoringPermitCandidate{Owner: proof.Owner, Nonce: proof.Nonce, Sequence: proof.Sequence, CoverageEpoch: proof.CoverageEpoch, UntilUptimeMS: challenge.IssuedUptimeMS + remaining}, nil
}
