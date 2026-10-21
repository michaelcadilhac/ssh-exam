package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestInterruptionHelpAndSyntaxNeedNoRootConfiguration(t *testing.T) {
	for _, args := range [][]string{{"help", "interruptions"}, {"web", "interruptions", "help"}, {"--config", "/missing", "web", "interruptions", "--help"}} {
		out, code := cliProcess(t, args...)
		for _, want := range []string{"Usage:", "--generation", "--revision", "--request", "five minutes", "transient", "native", "Exit status:"} {
			if code != 0 || !strings.Contains(out, want) {
				t.Fatal("undiscoverable interruption help", want, code, out)
			}
		}
	}
	for _, args := range [][]string{
		{"web", "interruptions"}, {"web", "interruptions", "show", "a", "--reason", "unexpected reason"},
		{"web", "interruptions", "authorize", "a", "--generation", "1", "--revision", "0"},
		{"web", "interruptions", "authorize", "a", "--generation", "1", "--revision", "-1", "--reason", "Reviewed safely"},
		{"web", "interruptions", "authorize", "a", "--generation", "9007199254740992", "--revision", "0", "--reason", "Reviewed safely"},
		{"web", "interruptions", "review", "a", "--limit", "101"}, {"web", "interruptions", "review", "a", "--section", "PRIVATE"},
	} {
		out, code := cliProcess(t, args...)
		if code != 2 || !strings.Contains(out, "help") || strings.Contains(out, "Load root") {
			t.Fatal("bad syntax reached authority", code, out)
		}
	}
}
func TestInterruptionReplyRequiresExactScopeAndNonExecution(t *testing.T) {
	b := map[string]any{"id": "a", "generation": 2, "requestID": "id"}
	v := map[string]any{"id": "a", "generation": 2, "requestID": "id", "status": "authorized", "execution": false, "expires": 100}
	raw, _ := json.Marshal(v)
	if err := validateInterruptionResult("interruptions.authorize", b, raw); err != nil {
		t.Fatal(err)
	}
	for _, patch := range []map[string]any{{"id": "other"}, {"generation": 3}, {"requestID": "other"}, {"status": "pending"}, {"execution": true}, {"execution": nil}, {"expires": 0}} {
		wrong := map[string]any{}
		for k, val := range v {
			wrong[k] = val
		}
		for k, val := range patch {
			wrong[k] = val
		}
		raw, _ = json.Marshal(wrong)
		if validateInterruptionResult("interruptions.authorize", b, raw) == nil {
			t.Fatal("accepted wrong authorization reply", wrong)
		}
	}
}
