package core

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRecoveryRevocationReviewIncludesRefusalEvidence(t *testing.T) {
	e, a, r := recoveryCatalogFixture(t)
	orphan := filepath.Join(e.Config.Work, retryRecoveryID)
	if err := os.Mkdir(orphan, 0700); err != nil {
		t.Fatal(err)
	}
	blocked, err := e.PreviewRecoveryRevocation(r.Exam, r.Username)
	if err != nil || blocked.Eligible || len(blocked.Blockers) == 0 {
		t.Fatal("orphan must block preview", blocked, err)
	}
	if err := os.Remove(orphan); err != nil {
		t.Fatal(err)
	}
	eligible, err := e.PreviewRecoveryRevocation(r.Exam, r.Username)
	if err != nil || !eligible.Eligible {
		t.Fatal("repaired fixture is not eligible", eligible, err)
	}
	path := filepath.Join(e.Config.State, recoveryName(a))
	before, _ := os.ReadFile(path)
	if blocked.Review == eligible.Review {
		t.Error("ineligible preview can become an eligible cancellation without renewed review")
	}
	if _, err := e.RevokeRecoveryPermission(r.Exam, r.Username, blocked.Review, "Cancel only the exact reviewed unused permission"); err == nil {
		t.Error("stale ineligible review cancelled a repaired target")
	}
	after, _ := os.ReadFile(path)
	if !bytes.Equal(before, after) {
		t.Fatal("stale confirmation rewrote authority")
	}
}

func TestRevokedRecoveryReferenceRequiresMatchingIdentityAndNoContradictions(t *testing.T) {
	for _, kind := range []string{"new-grant", "wrong-uid", "consumed", "pending", "legacy-start"} {
		t.Run(kind, func(t *testing.T) {
			e, a, r := recoveryCatalogFixture(t)
			preview, err := e.PreviewRecoveryRevocation(r.Exam, r.Username)
			if err != nil || !preview.Eligible {
				t.Fatal(preview, err)
			}
			if _, err := e.RevokeRecoveryPermission(r.Exam, r.Username, preview.Review, "Cancel unused permission before explicit replacement"); err != nil {
				t.Fatal(err)
			}
			a.Grant = &GrantBinding{ID: retryRecoveryID, Revision: 1, Hash: strings.Repeat("b", 64), Work: &GrantWork{Kind: "saved", Attempt: r.SourceAttempt, Checksum: r.Checksum}}
			a.Settings.Duration = 4500 // The NEW permission has its independently chosen allowance.
			switch kind {
			case "wrong-uid":
				a.UID++
			case "consumed", "pending":
				if err := os.WriteFile(filepath.Join(e.Config.State, recoveryName(a))+"."+kind, []byte(a.ID), 0600); err != nil {
					t.Fatal(err)
				}
			case "legacy-start":
				if err := e.WithState(func() error {
					e.state.Attempts[retryRecoveryID] = &Attempt{ID: retryRecoveryID, Exam: r.Exam, Username: "former-name", UID: r.UID, State: "COMPLETED", Start: Millis(), Deadline: Millis() + 5400000, OriginalDeadline: Millis() + 5400000}
					return nil
				}); err != nil {
					t.Fatal(err)
				}
			}
			if !validGrant(a.Grant) {
				t.Fatal("fixture did not supply a valid NEW grant")
			}
			result, err := e.recoveryReference(a)
			if kind == "new-grant" {
				if err != nil || result != nil {
					t.Fatal("explicit NEW grant still conflicts with cancelled old authority", result, err)
				}
			} else if err == nil {
				t.Fatal("cancelled authority bypassed identity or contradictory legacy evidence")
			}
			if kind == "consumed" || kind == "pending" || kind == "legacy-start" {
				if _, err := e.RevokeRecoveryPermission(r.Exam, r.Username, preview.Review, "Cancel unused permission before explicit replacement"); err == nil {
					t.Fatal("contradictory history became a clean cancellation acknowledgement")
				}
			}
		})
	}
}

func TestRevokedRecoveryEnvelopePreservesOriginalAndRefusesOldReaders(t *testing.T) {
	original := []byte(`{ "exam":"retake", "username":"student", "uid":20001, "duration":5400, "source_attempt":"12345678-1234-4234-8234-123456789abc", "checksum":"` + strings.Repeat("a", 64) + `", "created_at":1234, "reason":"Explicit saved work for synthetic test" }`)
	r, err := decodeLegacyRecoveryMetadata(original)
	if err != nil {
		t.Fatal(err)
	}
	r.Revocation = &RecoveryRevocation{Version: 1, OriginalHash: Hash(original), Review: strings.Repeat("b", 64), At: 1235, Reason: "Cancel unused synthetic permission", original: original}
	encoded, err := encodeRecoveryMetadata(r)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := decodeRecoveryMetadata(encoded)
	if err != nil || !bytes.Equal(decoded.Revocation.original, original) {
		t.Fatal("original JSON bytes not preserved", err)
	}
	if _, err := decodeLegacyRecoveryMetadata(encoded); err == nil {
		t.Fatal("old strict reader accepted cancellation envelope")
	}
	var permissive RecoveryPreparation
	if err := json.Unmarshal(encoded, &permissive); err != nil {
		t.Fatal(err)
	}
	if permissive.Exam != "" || permissive.Username != "" || permissive.Duration != 0 || permissive.SourceAttempt != "" {
		t.Fatal("old permissive reader can obtain usable legacy authority", permissive)
	}
	for name, mutate := range map[string]func(map[string]any){
		"unknown":             func(w map[string]any) { w["ignored"] = true },
		"case-alias":          func(w map[string]any) { w["Purpose"] = w["purpose"]; delete(w, "purpose") },
		"null-receipt":        func(w map[string]any) { w["receipt"] = nil },
		"bad-base64":          func(w map[string]any) { w["original"] = "!" },
		"noncanonical-base64": func(w map[string]any) { w["original"] = w["original"].(string) + "\n" },
		"hash-mismatch":       func(w map[string]any) { w["receipt"].(map[string]any)["original_hash"] = strings.Repeat("c", 64) },
		"receipt-version":     func(w map[string]any) { w["receipt"].(map[string]any)["version"] = 2 },
		"early-time":          func(w map[string]any) { w["receipt"].(map[string]any)["at"] = 1233 },
		"late-time":           func(w map[string]any) { w["receipt"].(map[string]any)["at"] = 9007199254740992 },
		"null-reason":         func(w map[string]any) { w["receipt"].(map[string]any)["reason"] = nil },
		"negative-actor":      func(w map[string]any) { w["receipt"].(map[string]any)["actor_uid"] = -1 },
		"unknown-receipt":     func(w map[string]any) { w["receipt"].(map[string]any)["ignored"] = true },
	} {
		t.Run(name, func(t *testing.T) {
			var wire map[string]any
			if err := json.Unmarshal(encoded, &wire); err != nil {
				t.Fatal(err)
			}
			mutate(wire)
			invalid, err := json.Marshal(wire)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := decodeRecoveryMetadata(invalid); err == nil {
				t.Fatal("ambiguous revocation authority accepted")
			}
		})
	}
	for _, invalid := range [][]byte{
		append(append([]byte{}, encoded...), []byte(` {}`)...),
		append(append([]byte{}, encoded[:len(encoded)-1]...), []byte(`,"purpose":"legacy-recovery-revoked/v1"}`)...),
		bytes.Repeat([]byte(" "), recoveryMetadataMaxBytes+1),
	} {
		if _, err := decodeRecoveryMetadata(invalid); err == nil {
			t.Fatal("duplicate/trailing/oversized envelope accepted")
		}
	}
	decoded.Duration++
	if _, err := encodeRecoveryMetadata(decoded); err == nil {
		t.Fatal("outer authority changed while retaining original bytes")
	}
}
