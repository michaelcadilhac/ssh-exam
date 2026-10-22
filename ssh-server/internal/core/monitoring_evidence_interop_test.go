package core

// Test-binary-only private IPC. No production binary/environment branch calls
// this helper, and it does not load/save Engine state or grant execution.
import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"os"
	"testing"
)

func TestMonitoringEvidenceInteropHelper(t *testing.T) {
	path := os.Getenv("EXAM_MONITORING_EVIDENCE_VECTOR")
	if path == "" {
		t.Skip("private synthetic subprocess helper")
	}
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > 16384 {
		t.Fatal("invalid synthetic evidence vector")
	}
	var v struct {
		Public    string              `json:"public"`
		Frame     SignedFrame         `json:"frame"`
		Challenge monitoringChallenge `json:"challenge"`
		Now       int64               `json:"now"`
	}
	d := json.NewDecoder(f)
	d.DisallowUnknownFields()
	if d.Decode(&v) != nil {
		t.Fatal("invalid synthetic vector JSON")
	}
	key, err := base64.StdEncoding.DecodeString(v.Public)
	if err != nil || len(key) != ed25519.PublicKeySize {
		t.Fatal("invalid synthetic key")
	}
	p, rejected := verifyMonitoringEvidence(v.Frame, ed25519.PublicKey(key), v.Challenge, v.Now)
	if err := json.NewEncoder(os.Stdout).Encode(map[string]any{"accepted": rejected == nil, "until": p.UntilUptimeMS, "sequence": p.Sequence, "coverage_epoch": p.CoverageEpoch}); err != nil {
		t.Fatal(err)
	}
}
