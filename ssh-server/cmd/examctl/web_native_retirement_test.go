package main

import (
	"encoding/json"
	"examworkspace/agent/internal/core"
	"strings"
	"testing"
)

func TestNativeRetirementSyntaxAndHelpBeforeAuthority(t *testing.T) {
	h := strings.Repeat("a", 64)
	for _, args := range [][]string{
		{"native-review", "midterm", "--out", "/missing-synthetic-evidence"},
		{"reconcile-native", "midterm", "--action", "archive", "--revision", h, "--review", h, "--evidence", "/missing-synthetic-evidence", "--reason", "Reviewed closed native history"},
	} {
		out, code := cliProcess(t, append(append([]string{"web", "exams"}, args...), "--config", "/missing-synthetic-config")...)
		if code != 1 || (!strings.Contains(out, "root") && !strings.Contains(out, "No reconciliation")) {
			t.Fatal("valid native workflow failed at syntax rather than authority", code, out)
		}
	}
	for _, args := range [][]string{
		{"native-review", "midterm"}, {"native-review", "midterm", "--out", "/unused", "--reason", "Unexpected setting"},
		{"reconcile-native", "midterm", "--action", "unarchive", "--revision", h, "--review", h, "--evidence", "/unused", "--reason", "Invalid native action"},
		{"show", "midterm", "--evidence", "/unused"},
	} {
		out, code := cliProcess(t, append([]string{"web", "exams"}, args...)...)
		if code != 2 || !strings.Contains(out, "web help") {
			t.Fatal("invalid native syntax reached authority", code, out)
		}
	}
}

func TestNativeReconciliationResultBindsExactEvidenceBeforeOutput(t *testing.T) {
	e := core.ExamRetirementEvidence{Version: 1, Agent: "class", Exam: "midterm", ObservedAt: 1234567890000, StateHash: strings.Repeat("a", 64), Attempts: []core.ExamRetirementAttempt{}, Permissions: []core.ExamRetirementPermission{}}
	b, _ := json.Marshal(e)
	var normalized any
	json.Unmarshal(b, &normalized)
	b, _ = json.Marshal(normalized)
	input := map[string]any{"id": "midterm", "revision": strings.Repeat("b", 64), "evidence": e}
	for _, mode := range []string{"valid", "target", "revision", "hash", "counts", "null", "private", "duplicate"} {
		r := map[string]any{"id": "midterm", "revision": strings.Repeat("b", 64), "review": strings.Repeat("c", 64), "evidence": core.Hash(b), "attempts": 0, "permissions": 0, "released_retentions": 0}
		switch mode {
		case "target":
			r["id"] = "elsewhere"
		case "revision":
			r["revision"] = strings.Repeat("d", 64)
		case "hash":
			r["evidence"] = strings.Repeat("d", 64)
		case "counts":
			r["permissions"] = 1
		case "null":
			r["evidence"] = nil
		case "private":
			r["private"] = "PRIVATE"
		}
		raw, _ := json.Marshal(r)
		if mode == "duplicate" {
			raw = append([]byte(`{"id":"midterm",`), raw[1:]...)
		}
		err := validateExamResult("exams.native-reconcile", input, raw)
		if (err == nil) != (mode == "valid") {
			t.Fatal("wrong native acknowledgement validation", mode, err)
		}
	}
}
