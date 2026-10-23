package main

import (
	"encoding/json"
	"examworkspace/agent/internal/core"
	"strings"
	"testing"
)

func TestGrantCLIHelpAndSyntaxBeforeAuthority(t *testing.T) {
	for _, args := range [][]string{{"help", "grants"}, {"web", "grants", "help"}, {"web", "grants", "revise", "--help"}, {"--config", "/missing", "web", "grants", "--help"}} {
		output, code := cliProcess(t, args...)
		for _, word := range []string{"Usage:", "enrollment", "--revision", "--request", "BEGIN_PENDING", "outbound HTTPS", "UID", "Exit status:"} {
			if code != 0 || !strings.Contains(output, word) {
				t.Fatalf("missing discovery %q: %d %s", word, code, output)
			}
		}
	}
	const id = "33333333-1234-4234-8234-123456789abc"
	for _, args := range [][]string{
		{"web", "grants"}, {"web", "grants", "list", "exam", "--limit", "201"}, {"web", "grants", "show", "exam"}, {"web", "grants", "show", id, "--before", "0"},
		{"web", "grants", "revise", id, "--revision", "1", "--reason", "Concrete revision"}, {"web", "grants", "revoke", id, "--revision", "0", "--reason", "Concrete revocation"},
		{"web", "grants", "revise", id, "--revision", "1", "--reason", "Concrete revision", "--duration-minutes", "0"},
		{"web", "grants", "revise", id, "--revision", "1", "--reason", "Concrete revision", "--duration-minutes", "90", "--duration-seconds", "5400"},
		{"web", "grants", "revise", id, "--revision", "1", "--reason", "Concrete revision", "--latest", "2026-10-23T09:00"},
		{"web", "grants", "revise", id, "--revision", "1", "--reason", "Concrete revision", "--template-version", "legacy"},
		{"web", "grants", "revoke", id, "--revision", "1", "--reason", "Concrete revocation", "--duration-minutes", "90"},
	} {
		output, code := cliProcess(t, args...)
		if code != 2 || !strings.Contains(output, "grants help") || strings.Contains(output, "Load root") {
			t.Fatal("invalid syntax reached authority", code, output)
		}
	}
}

func TestGrantCLIRejectsWrongNestedScopeAndPrivateFieldsBeforeOutput(t *testing.T) {
	const id = "33333333-1234-4234-8234-123456789abc"
	valid := grantResult{ID: id, Agent: "class", Exam: "exam", Username: "student", Revision: 1, Status: "AVAILABLE", IssuedAt: 100, Actor: "instructor", Reason: "Initial synthetic ordinary grant", Hash: strings.Repeat("a", 64), Settings: core.Settings{ID: "exam", Name: "Exam", Template: "v1", TemplateVersion: strings.Repeat("b", 64), Duration: 5400, Earliest: 100, Latest: 200, Terminals: 2}, Work: grantWorkResult{Kind: "template", Name: "v1", Hash: strings.Repeat("b", 64)}, Claims: []grantClaimResult{{Attempt: "44444444-1234-4234-8234-123456789abc", UID: 10001, Revision: 1, Hash: strings.Repeat("a", 64), State: "PREPARING", CreatedAt: 100}}}
	raw, _ := json.Marshal(valid)
	if err := validateGrantResult("grants.show", map[string]any{"id": id}, raw, "class"); err != nil {
		t.Fatal("valid scoped claim rejected", err)
	}
	for _, kind := range []string{"agent", "id", "exam", "username", "settings", "source", "private", "claim-private", "limit"} {
		t.Run(kind, func(t *testing.T) {
			var value map[string]any
			json.Unmarshal(raw, &value)
			body := map[string]any{"id": id}
			op := "grants.show"
			switch kind {
			case "agent":
				value["agent"] = "other"
			case "id":
				value["id"] = "55555555-1234-4234-8234-123456789abc"
			case "exam":
				value["exam"] = "other"
			case "username":
				op = "grants.list"
				body = map[string]any{"exam": "exam", "username": "other", "limit": 100}
			case "settings":
				value["settings"].(map[string]any)["id"] = "other"
			case "source":
				value["work"].(map[string]any)["kind"] = "saved"
			case "private":
				value["callback_key"] = "PRIVATE-SENTINEL"
			case "claim-private":
				value["claims"].([]any)[0].(map[string]any)["page_hash"] = "PRIVATE-SENTINEL"
			case "limit":
				op = "grants.list"
				body = map[string]any{"exam": "exam", "limit": 0}
			}
			var encoded []byte
			if op == "grants.list" {
				encoded, _ = json.Marshal(map[string]any{"grants": []any{value}, "next": nil})
			} else {
				encoded, _ = json.Marshal(value)
			}
			if err := validateGrantResult(op, body, encoded, "class"); err == nil || strings.Contains(err.Error(), "PRIVATE-SENTINEL") {
				t.Fatal("unconfirmed/private grant reply accepted or echoed", err)
			}
		})
	}
}
