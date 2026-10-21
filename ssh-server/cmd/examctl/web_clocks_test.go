package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestClockAndAttemptHelpSyntaxAndDeterministicChildIntents(t *testing.T) {
	for _, topic := range []string{"attempts", "clocks"} {
		for _, args := range [][]string{{"help", topic}, {"web", topic, "help"}, {"--config", "/missing", "web", topic, "--help"}} {
			out, code := cliProcess(t, args...)
			for _, want := range []string{"Usage:", "--request", "native", "gateway", "Exit status:"} {
				if code != 0 || !strings.Contains(strings.ToLower(out), strings.ToLower(want)) {
					t.Fatal("undiscoverable clock/attempt help", want, code, out)
				}
			}
		}
	}
	id := "11111111-1111-4111-8111-111111111111"
	for _, args := range [][]string{
		{"web", "attempts"}, {"web", "attempts", "show"}, {"web", "attempts", "show", id, "--view", "working"},
		{"web", "attempts", "list", "exam", "--limit", "201"}, {"web", "attempts", "list", "exam", "--view", "UNKNOWN"},
		{"web", "clocks", "reset", id, "--minutes", "0", "--revision", "0"},
		{"web", "clocks", "extend", id, "--minutes", "5", "--revision", "-1"},
		{"web", "clocks", "reset", id, "--minutes", "5", "--revision", strings.Repeat("a", 64)},
		{"web", "clocks", "show", id, "--minutes", "5"},
		{"web", "clocks", "add", "exam", "--minutes", "5", "--target", "bad"},
		{"web", "clocks", "add", "exam", "--minutes", "5", "--target", id + ":0", "--target", id + ":0"},
		{"web", "clocks", "reset-default", "exam", "--target", id + ":0", "--minutes", "90"},
		{"web", "clocks", "reset-default", "exam", "--target", id + ":0:bad"},
	} {
		out, code := cliProcess(t, args...)
		if code != 2 || !strings.Contains(out, "help") || strings.Contains(out, "Load root") {
			t.Fatal("bad clock syntax reached authority/configuration", code, out)
		}
	}
	parent := "22222222-2222-4222-8222-222222222222"
	first := clockChildID(parent, id)
	if !managementUUID.MatchString(first) || first != clockChildID(parent, id) || first == clockChildID(id, parent) || first == clockChildID(parent, parent) {
		t.Fatal("child request IDs are invalid, unstable or not scoped")
	}
}

func TestClockResultRequiresEveryScopedTargetAndExplicitStatus(t *testing.T) {
	id := "11111111-1111-4111-8111-111111111111"
	intent := "22222222-2222-4222-8222-222222222222"
	body := map[string]any{"id": id, "requestID": intent}
	valid := map[string]any{"requestID": intent, "status": "pending", "confirmed": false, "attempt": map[string]any{"id": id}}
	raw, _ := json.Marshal(valid)
	if err := validateClockResult("clocks.reset", body, raw); err != nil {
		t.Fatal(err)
	}
	for _, change := range []map[string]any{{"requestID": id}, {"status": "unknown"}, {"confirmed": true}, {"confirmed": nil}, {"attempt": map[string]any{"id": intent}}} {
		wrong := map[string]any{}
		for key, value := range valid {
			wrong[key] = value
		}
		for key, value := range change {
			wrong[key] = value
		}
		raw, _ = json.Marshal(wrong)
		if validateClockResult("clocks.reset", body, raw) == nil {
			t.Fatal("accepted wrong clock result", wrong)
		}
	}
	valid["id"] = id
	batchBody := map[string]any{"targets": []any{body}}
	raw, _ = json.Marshal(map[string]any{"results": []any{valid}})
	if err := validateClockResult("clocks.batch", batchBody, raw); err != nil {
		t.Fatal(err)
	}
	for _, values := range [][]any{{}, {valid, valid}} {
		raw, _ = json.Marshal(map[string]any{"results": values})
		if validateClockResult("clocks.batch", batchBody, raw) == nil {
			t.Fatal("accepted missing/duplicate results")
		}
	}
}
