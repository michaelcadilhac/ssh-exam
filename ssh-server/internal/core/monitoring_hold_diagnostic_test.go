package core

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMonitoringHoldDiagnosticPreservesAuthorityAndSanitizesUnknownCauses(t *testing.T) {
	e, _, _ := finalFixture(t, "LOCKED", Millis()+60000)
	a := inspectFinal(t, e)
	before, _ := json.Marshal(a)
	e.auditMonitoringHold(a, terminalCutoffFact{error: errors.New("password=PRIVATE"), sshExited: true, held: true, view: &monitoringAuthorityView{Sequence: 27, Revision: 9, AuthorityUntilMS: 12000, DeadlineUptimeMS: 60000, Causes: []string{"technical-expiry", "PRIVATE-TERMINAL-INPUT"}}})
	after, _ := json.Marshal(a)
	if string(after) != string(before) {
		t.Fatal("diagnostic changed clock/owner/hold")
	}
	raw, err := os.ReadFile(filepath.Join(e.Config.State, "audit.ndjson"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "PRIVATE") {
		t.Fatal("unknown cause/error text leaked")
	}
	var record map[string]any
	lines := strings.Split(strings.TrimSpace(string(raw)), "\n")
	if json.Unmarshal([]byte(lines[len(lines)-1]), &record) != nil {
		t.Fatal("missing durable record")
	}
	d := record["diagnostic"].(map[string]any)
	if d["sequence"] != float64(27) || d["authority_until_boot_ms"] != float64(12000) || d["error_class"] != "observation-failed" || d["ssh_exited"] != true {
		t.Fatal("last native authority fact lost", record)
	}
}
