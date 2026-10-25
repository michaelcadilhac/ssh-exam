package core

// Test-binary-only private IPC. No production binary/environment branch calls
// this helper, and it does not load/save Engine state or grant execution.
import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"io"
	"os"
	"syscall"
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

// Test-binary-only bridge: the real live authority issues its own challenge and
// accepts the HTTP gateway's unchanged signed frame. Only clocks and initial
// owner authentication are synthetic; no Engine state/kernel execution is used.
func TestMonitoringAuthorityHTTPInteropHelper(t *testing.T) {
	path := os.Getenv("EXAM_MONITORING_AUTHORITY_VECTOR")
	if path == "" {
		t.Skip("private synthetic authority subprocess helper")
	}
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		t.Fatal(err)
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || stat.Uid != uint32(os.Getuid()) || stat.Nlink != 1 || info.Size() > 8192 {
		t.Fatal("invalid private authority vector")
	}
	var v struct {
		Public  string                  `json:"public"`
		Context monitoringActiveContext `json:"context"`
		Now     int64                   `json:"now"`
	}
	d := json.NewDecoder(f)
	d.DisallowUnknownFields()
	if d.Decode(&v) != nil {
		t.Fatal("invalid authority vector JSON")
	}
	key, err := base64.StdEncoding.DecodeString(v.Public)
	if err != nil || len(key) != ed25519.PublicKeySize {
		t.Fatal("invalid synthetic authority key")
	}
	now := v.Now
	a, err := newMonitoringAuthority(sealedAuthorityTestContext(v.Context), func() (int64, error) { return now, nil })
	if err != nil {
		t.Fatal(err)
	}
	c, err := a.challenge()
	if err != nil {
		t.Fatal(err)
	}
	out := json.NewEncoder(os.Stdout)
	if err := out.Encode(map[string]any{"challenge": map[string]any{"type": "monitoring-execution-challenge-v1", "agent": c.Agent, "nonce": c.Nonce, "owner": c.Owner, "after_sequence": c.AfterSequence, "coverage_epoch": c.CoverageEpoch, "policy_reports": c.PolicyReports}}); err != nil {
		t.Fatal(err)
	}
	var reply struct {
		Frame SignedFrame `json:"frame"`
		Now   int64       `json:"now"`
	}
	d = json.NewDecoder(io.LimitReader(os.Stdin, 16385))
	d.DisallowUnknownFields()
	if d.Decode(&reply) != nil {
		t.Fatal("invalid bounded gateway reply")
	}
	now = reply.Now
	p, rejected := verifyMonitoringEvidence(reply.Frame, ed25519.PublicKey(key), c, now)
	if rejected == nil {
		_, rejected = a.accept(p)
	}
	if err := out.Encode(map[string]any{"accepted": rejected == nil, "view": a.check()}); err != nil {
		t.Fatal(err)
	}
}
