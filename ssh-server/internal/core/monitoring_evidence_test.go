package core

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"math"
	"os"
	"strings"
	"testing"
)

func evidenceFixture(t *testing.T) (ed25519.PublicKey, ed25519.PrivateKey, monitoringChallenge, monitoringEvidence) {
	t.Helper()
	pub, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	o := monitoringOwner{Attempt: finalID, Exam: "synthetic", Username: "student", UID: 10001, TransportHash: strings.Repeat("a", 64), Boot: "11111111-1111-4111-8111-111111111111", PageEpoch: strings.Repeat("b", 64), InputEpoch: strings.Repeat("c", 64), Generation: 0, ClockRevision: 0}
	c := monitoringChallenge{Agent: "class", Nonce: strings.Repeat("d", 64), Owner: o, IssuedUptimeMS: 10000, ExpiresUptimeMS: 15000, AuthorityUntilMS: 16000, DeadlineUptimeMS: 100000, AfterSequence: 3}
	p := monitoringEvidence{Type: "monitoring-execution-evidence-v1", Audience: c.Agent, Nonce: c.Nonce, Owner: o, Sequence: 4, AgeMS: 1000, Complete: true}
	return pub, key, c, p
}

func signEvidenceBytes(key ed25519.PrivateKey, payload []byte) SignedFrame {
	return SignedFrame{Payload: base64.StdEncoding.EncodeToString(payload), Signature: base64.StdEncoding.EncodeToString(ed25519.Sign(key, payload))}
}
func signEvidence(t *testing.T, key ed25519.PrivateKey, proof monitoringEvidence) SignedFrame {
	t.Helper()
	payload, err := json.Marshal(proof)
	if err != nil {
		t.Fatal(err)
	}
	return signEvidenceBytes(key, payload)
}

func TestMonitoringEvidenceNeverFreshensOnDeliveryOrRetry(t *testing.T) {
	pub, key, c, p := evidenceFixture(t)
	frame := signEvidence(t, key, p)
	for _, now := range []int64{10000, 12000, 14999} {
		v, err := verifyMonitoringEvidence(frame, pub, c, now)
		if err != nil || v.UntilUptimeMS != 24000 || v.Sequence != 4 || v.Owner != c.Owner || v.Nonce != c.Nonce {
			t.Fatalf("reply age=%d changed its original budget: %+v %v", now, v, err)
		}
	}
	if _, err := verifyMonitoringEvidence(frame, pub, c, 15000); err == nil {
		t.Fatal("expired request accepted")
	}
	c.DeadlineUptimeMS = 13000
	v, err := verifyMonitoringEvidence(frame, pub, c, 12000)
	if err != nil || v.UntilUptimeMS != 13000 {
		t.Fatal("deadline was extended", v, err)
	}
	if _, err := verifyMonitoringEvidence(frame, pub, c, 13000); err == nil {
		t.Fatal("expired attempt accepted")
	}
}

func TestMonitoringEvidenceFencesEveryOwnershipAndPolicyField(t *testing.T) {
	pub, key, c, p := evidenceFixture(t)
	changes := map[string]func(*monitoringEvidence){
		"type":              func(v *monitoringEvidence) { v.Type = "deadline-timing" },
		"agent":             func(v *monitoringEvidence) { v.Audience = "other" },
		"nonce":             func(v *monitoringEvidence) { v.Nonce = strings.Repeat("e", 64) },
		"attempt":           func(v *monitoringEvidence) { v.Owner.Attempt = "22222222-2222-4222-8222-222222222222" },
		"exam":              func(v *monitoringEvidence) { v.Owner.Exam = "other" },
		"account":           func(v *monitoringEvidence) { v.Owner.Username = "other" },
		"uid":               func(v *monitoringEvidence) { v.Owner.UID++ },
		"transport":         func(v *monitoringEvidence) { v.Owner.TransportHash = strings.Repeat("e", 64) },
		"boot":              func(v *monitoringEvidence) { v.Owner.Boot = "22222222-2222-4222-8222-222222222222" },
		"page":              func(v *monitoringEvidence) { v.Owner.PageEpoch = strings.Repeat("e", 64) },
		"input":             func(v *monitoringEvidence) { v.Owner.InputEpoch = strings.Repeat("e", 64) },
		"generation":        func(v *monitoringEvidence) { v.Owner.Generation++ },
		"clock":             func(v *monitoringEvidence) { v.Owner.ClockRevision++ },
		"incomplete":        func(v *monitoringEvidence) { v.Complete = false },
		"old_sequence":      func(v *monitoringEvidence) { v.Sequence = c.AfterSequence },
		"overflow_sequence": func(v *monitoringEvidence) { v.Sequence = monitoringEvidenceMaxSequence + 1 },
		"old_evidence":      func(v *monitoringEvidence) { v.AgeMS = 15000 },
		"future_evidence":   func(v *monitoringEvidence) { v.AgeMS = -1 },
	}
	for name, change := range changes {
		t.Run(name, func(t *testing.T) {
			bad := p
			change(&bad)
			if v, err := verifyMonitoringEvidence(signEvidence(t, key, bad), pub, c, 12000); err == nil || v != (monitoringPermitCandidate{}) {
				t.Fatal("invalid evidence produced permission", v, err)
			}
		})
	}
	_, other, _, _ := evidenceFixture(t)
	if _, err := verifyMonitoringEvidence(signEvidence(t, other, p), pub, c, 12000); err == nil {
		t.Fatal("forged evidence accepted")
	}
}

func TestMonitoringEvidenceRejectsAmbiguousMissingNullAndOversizedSignedMetadata(t *testing.T) {
	pub, key, c, p := evidenceFixture(t)
	payload, _ := json.Marshal(p)
	var fields map[string]json.RawMessage
	json.Unmarshal(payload, &fields)
	for field := range fields {
		t.Run("missing_"+field, func(t *testing.T) {
			var v map[string]json.RawMessage
			json.Unmarshal(payload, &v)
			delete(v, field)
			b, _ := json.Marshal(v)
			if _, err := verifyMonitoringEvidence(signEvidenceBytes(key, b), pub, c, 12000); err == nil {
				t.Fatal("missing field accepted")
			}
		})
		t.Run("null_"+field, func(t *testing.T) {
			var v map[string]json.RawMessage
			json.Unmarshal(payload, &v)
			v[field] = json.RawMessage("null")
			b, _ := json.Marshal(v)
			if _, err := verifyMonitoringEvidence(signEvidenceBytes(key, b), pub, c, 12000); err == nil {
				t.Fatal("null field accepted")
			}
		})
	}
	var owner map[string]json.RawMessage
	json.Unmarshal(fields["owner"], &owner)
	for field := range owner {
		t.Run("missing_owner_"+field, func(t *testing.T) {
			var v map[string]json.RawMessage
			json.Unmarshal(fields["owner"], &v)
			delete(v, field)
			nested, _ := json.Marshal(v)
			var top map[string]json.RawMessage
			json.Unmarshal(payload, &top)
			top["owner"] = nested
			b, _ := json.Marshal(top)
			if _, err := verifyMonitoringEvidence(signEvidenceBytes(key, b), pub, c, 12000); err == nil {
				t.Fatal("missing ownership field accepted")
			}
		})
	}
	for _, raw := range []string{
		strings.TrimSuffix(string(payload), "}") + `,"age_ms":0}`,
		strings.Replace(string(payload), `"generation":0`, `"generation":0,"generation":0`, 1),
		strings.TrimSuffix(string(payload), "}") + `,"unrecognized":"PRIVATE-MUST-NOT-PRINT"}`,
		string(payload) + ` {}`, strings.Repeat(" ", monitoringEvidenceMaxBytes+1) + string(payload),
		strings.Replace(string(payload), `"age_ms":1000`, `"age_ms":1.5`, 1),
	} {
		if _, err := verifyMonitoringEvidence(signEvidenceBytes(key, []byte(raw)), pub, c, 12000); err == nil || strings.Contains(err.Error(), "PRIVATE-MUST-NOT-PRINT") {
			t.Fatal("unsafe metadata accepted/leaked", err)
		}
	}
}

func TestMonitoringEvidenceBoundsNativeClockAndPriorAuthority(t *testing.T) {
	pub, key, c, p := evidenceFixture(t)
	frame := signEvidence(t, key, p)
	for _, mutate := range []func(*monitoringChallenge){
		func(c *monitoringChallenge) { c.IssuedUptimeMS = -1 },
		func(c *monitoringChallenge) { c.IssuedUptimeMS = 12001 },
		func(c *monitoringChallenge) { c.ExpiresUptimeMS++ },
		func(c *monitoringChallenge) { c.ExpiresUptimeMS = c.IssuedUptimeMS },
		func(c *monitoringChallenge) { c.AuthorityUntilMS = 12000 },
		func(c *monitoringChallenge) { c.Owner.UID = 0 },
		func(c *monitoringChallenge) { c.Owner.InputEpoch = "" },
		func(c *monitoringChallenge) { c.Owner.Boot = strings.Repeat("-", 36) },
		func(c *monitoringChallenge) { c.Owner.Attempt = strings.Repeat("-", 36) },
	} {
		bad := c
		mutate(&bad)
		if _, err := verifyMonitoringEvidence(frame, pub, bad, 12000); err == nil {
			t.Fatal("invalid local authority snapshot accepted", bad)
		}
	}
	// A wall-clock jump is irrelevant: no remote or local Unix clock is an input.
	p.AgeMS = 14900
	if _, err := verifyMonitoringEvidence(signEvidence(t, key, p), pub, c, 10100); err == nil {
		t.Fatal("round trip outlived remaining evidence freshness")
	}
	c.IssuedUptimeMS, c.ExpiresUptimeMS, c.AuthorityUntilMS, c.DeadlineUptimeMS = math.MaxInt64-100, math.MaxInt64-1, math.MaxInt64, math.MaxInt64
	p.AgeMS = 0
	v, err := verifyMonitoringEvidence(signEvidence(t, key, p), pub, c, math.MaxInt64-50)
	if err != nil || v.UntilUptimeMS != math.MaxInt64 {
		t.Fatal("native cutoff arithmetic overflow", v, err)
	}
}

func TestMonitoringEvidenceSharedWireFixture(t *testing.T) {
	pub, key, c, expected := evidenceFixture(t)
	b, err := os.ReadFile("../../../tests/fixtures/monitoring-evidence.json")
	if err != nil {
		t.Fatal(err)
	}
	var v monitoringEvidence
	if json.Unmarshal(b, &v) != nil || v != expected {
		t.Fatal("native and gateway wire fixtures differ")
	}
	if _, err := verifyMonitoringEvidence(signEvidenceBytes(key, b), pub, c, 12000); err != nil {
		t.Fatal(err)
	}
}

func FuzzMonitoringEvidenceSignedMetadata(f *testing.F) {
	pub, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		f.Fatal(err)
	}
	o := monitoringOwner{Attempt: finalID, Exam: "synthetic", Username: "student", UID: 10001, TransportHash: strings.Repeat("a", 64), Boot: "11111111-1111-4111-8111-111111111111", PageEpoch: strings.Repeat("b", 64), InputEpoch: strings.Repeat("c", 64)}
	c := monitoringChallenge{Agent: "class", Nonce: strings.Repeat("d", 64), Owner: o, IssuedUptimeMS: 10000, ExpiresUptimeMS: 15000, AuthorityUntilMS: 16000, DeadlineUptimeMS: 100000, AfterSequence: 3}
	b, err := os.ReadFile("../../../tests/fixtures/monitoring-evidence.json")
	if err != nil {
		f.Fatal(err)
	}
	f.Add(b)
	f.Add([]byte("null"))
	f.Add([]byte(`{"age_ms":null}`))
	f.Fuzz(func(t *testing.T, payload []byte) {
		if len(payload) > monitoringEvidenceMaxBytes+1 {
			return
		}
		v, err := verifyMonitoringEvidence(signEvidenceBytes(key, payload), pub, c, 12000)
		if err == nil && (v.Owner != o || v.Nonce != c.Nonce || v.Sequence <= c.AfterSequence || v.Sequence > monitoringEvidenceMaxSequence || v.UntilUptimeMS <= 12000 || v.UntilUptimeMS > 25000 || v.UntilUptimeMS > c.DeadlineUptimeMS) {
			t.Fatal("malformed signed input produced invalid candidate", v)
		}
	})
}
