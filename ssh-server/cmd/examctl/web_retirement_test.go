package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestDefinitionRetirementIsDiscoverableBeforeRootOrConfiguration(t *testing.T) {
	out, code := cliProcess(t, "help", "web")
	for _, want := range []string{"exams retire-preview EXAM", "exams native-review EXAM", "exams reconcile-native EXAM", "--evidence", "exams delete EXAM", "exams archive EXAM", "exams unarchive EXAM", "--review", "preserve"} {
		if code != 0 || !strings.Contains(out, want) {
			t.Fatal("definition retirement workflow is undiscoverable", want, code, out)
		}
	}
	for _, args := range [][]string{{"help", "management"}, {"web", "help"}} {
		out, code := cliProcess(t, args...)
		if code != 0 || !strings.Contains(out, "legacy") && !strings.Contains(out, "Legacy") || strings.Contains(out, "Definition retirement, saved-work grant migration") {
			t.Fatal("retirement help misstates supported workflow or legacy safety boundary", code, out)
		}
	}
}

func TestRetirementFlagsReachAuthorityOnlyAfterValidSyntax(t *testing.T) {
	hash := strings.Repeat("a", 64)
	for _, args := range [][]string{
		{"web", "exams", "retire-preview", "midterm", "--action", "archive"},
		{"--action", "delete", "web", "exams", "retire-preview", "midterm"},
		{"web", "exams", "list", "--lifecycle", "archived"},
		{"web", "exams", "delete", "midterm", "--revision", hash, "--review", hash, "--reason", "Reviewed unused definition"},
	} {
		out, code := cliProcess(t, append(args, "--config", "/missing-synthetic-retirement-config")...)
		if code != 1 || (!strings.Contains(out, "root on the class server") && !strings.Contains(out, "Load root agent configuration")) {
			t.Fatal("valid workflow never reached authority/configuration boundary", code, out)
		}
	}
	for _, args := range [][]string{
		{"retire-preview", "midterm"}, {"retire-preview", "midterm", "--action", "archive", "--reason", "Unexpected reason"},
		{"delete", "midterm", "--revision", hash, "--review", hash}, {"archive", "midterm", "--revision", hash, "--review", hash, "--reason", "Reviewed history", "--duration-seconds", "600"},
		{"list", "--lifecycle", "unknown"},
	} {
		out, code := cliProcess(t, append([]string{"web", "exams"}, args...)...)
		if code != 2 || !strings.Contains(out, "web help") {
			t.Fatal("invalid retirement syntax reached authority", code, out)
		}
	}
}

func retirementFixture() map[string]any {
	return map[string]any{"id": "midterm", "action": "archive", "revision": strings.Repeat("a", 64), "review": strings.Repeat("b", 64), "lifecycle": "active", "exam": examReplyFixture()["exam"], "counts": map[string]any{"enrollments": 1, "attempts": 1, "grants": 0, "claims": 0, "rosterPreviews": 0, "grantPreviews": 0, "allowanceEdits": 0, "recoverySources": 0, "modes": 0}, "native": map[string]any{"status": "not-required", "evidence": nil, "attempts": 0, "permissions": 0, "released_retentions": 0, "has_history": false}, "allowed": true, "blockers": []string{}, "preserves": []string{"attempts and submissions"}}
}

func TestRetirementSignedResultMustMatchReviewedScopeBeforeOutput(t *testing.T) {
	encode := func(v any) json.RawMessage {
		b, err := json.Marshal(v)
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	body := map[string]any{"id": "midterm", "action": "archive"}
	if err := validateRetirementResult("exams.retire-preview", body, encode(retirementFixture())); err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"target", "action", "nested-target", "private", "missing-count", "negative-count", "overflow", "contradiction", "null-counts", "null-exam", "bad-review", "native-missing", "native-required", "native-overflow", "native-history", "native-private"} {
		t.Run(mode, func(t *testing.T) {
			r := retirementFixture()
			switch mode {
			case "target":
				r["id"] = "elsewhere"
			case "action":
				r["action"] = "delete"
			case "nested-target":
				r["exam"].(map[string]any)["id"] = "elsewhere"
			case "private":
				r["secret"] = "PRIVATE"
			case "missing-count":
				delete(r["counts"].(map[string]any), "grants")
			case "negative-count":
				r["counts"].(map[string]any)["grants"] = -1
			case "overflow":
				r["counts"].(map[string]any)["grants"] = int64(1 << 54)
			case "contradiction":
				r["blockers"] = []string{"unfinished work"}
			case "null-counts":
				r["counts"] = nil
			case "null-exam":
				r["exam"] = nil
			case "bad-review":
				r["review"] = "latest"
			case "native-missing":
				delete(r, "native")
			case "native-required":
				r["native"].(map[string]any)["status"] = "required"
			case "native-overflow":
				r["native"].(map[string]any)["attempts"] = 1001
			case "native-history":
				r["native"].(map[string]any)["attempts"] = 1
			case "native-private":
				r["native"].(map[string]any)["private"] = "PRIVATE"
			}
			if validateRetirementResult("exams.retire-preview", body, encode(r)) == nil {
				t.Fatal("unsafe retirement reply accepted")
			}
		})
	}
	for _, action := range []string{"archive", "unarchive", "delete"} {
		body := map[string]any{"id": "midterm", "revision": strings.Repeat("a", 64), "review": strings.Repeat("b", 64), "reason": "Reviewed synthetic retirement"}
		lifecycle := "archived"
		if action == "unarchive" {
			lifecycle = "active"
		}
		if action == "delete" {
			lifecycle = "deleted"
		}
		r := map[string]any{"id": "midterm", "action": action, "lifecycle": lifecycle, "previous_revision": strings.Repeat("a", 64), "revision": any(strings.Repeat("c", 64))}
		if action == "delete" {
			r["revision"] = nil
		}
		if err := validateRetirementResult("exams."+action, body, encode(r)); err != nil {
			t.Fatal(action, err)
		}
		r["previous_revision"] = strings.Repeat("d", 64)
		if validateRetirementResult("exams."+action, body, encode(r)) == nil {
			t.Fatal("different reviewed revision confirmed")
		}
	}
}
