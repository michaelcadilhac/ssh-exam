package core

import (
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAdministrativeExportRequiresVerifiedBundleAndDurableAudit(t *testing.T) {
	e, _, _ := finalFixture(t, "ACTIVE", Millis()+5400000)
	if _, err := e.Call("finalize-attempt", Request{ID: finalID, Reason: "Synthetic export fixture"}); err != nil {
		t.Fatal(err)
	}
	p := filepath.Join(e.Config.State, "submissions", finalID, "submission.tar.gz")
	original, _ := os.ReadFile(p)
	f, err := e.OpenExport(finalID)
	if err != nil {
		t.Fatal(err)
	}
	bytes, err := io.ReadAll(f)
	f.Close()
	if err != nil || string(bytes) != string(original) {
		t.Fatal("verified export differs", err)
	}
	audit := filepath.Join(e.Config.State, "audit.ndjson")
	b, _ := os.ReadFile(audit)
	if !strings.Contains(string(b), `"action":"administrator-export"`) {
		t.Fatal("sensitive export not audited")
	}
	if err := os.Rename(audit, audit+".saved"); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(audit, 0700); err != nil {
		t.Fatal(err)
	}
	if f, err := e.OpenExport(finalID); err == nil || f != nil {
		t.Fatal("export allowed without a durable audit")
	}
	after, _ := os.ReadFile(p)
	if string(after) != string(original) {
		t.Fatal("failed export modified protected source")
	}
}
