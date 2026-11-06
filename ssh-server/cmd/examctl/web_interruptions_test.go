package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestInterruptionHelpAndSyntaxNeedNoRootConfiguration(t *testing.T) {
	for _, args := range [][]string{{"help", "interruptions"}, {"web", "interruptions", "help"}, {"--config", "/missing", "web", "interruptions", "--help"}} {
		out, code := cliProcess(t, args...)
		for _, want := range []string{"Usage:", "--generation", "--revision", "--request", "--minutes", "--no-expiry", "five minutes", "transient", "native", "Exit status:"} {
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
		{"web", "interruptions", "show", "a", "--no-expiry"},
		{"web", "interruptions", "authorize", "a", "--minutes", "0", "--generation", "1", "--revision", "0", "--reason", "Reviewed safely"},
		{"web", "interruptions", "authorize", "a", "--minutes", "15", "--no-expiry", "--generation", "1", "--revision", "0", "--reason", "Reviewed safely"},
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

func TestInterruptionUnlimitedReplyRequiresExplicitConfirmation(t *testing.T) {
	b := map[string]any{"id": "a", "generation": 2, "requestID": "id", "validForMinutes": nil}
	v := map[string]any{"id": "a", "generation": 2, "requestID": "id", "status": "authorized", "execution": false, "expires": int64(9007199254740991), "noExpiry": true}
	raw, _ := json.Marshal(v)
	if err := validateInterruptionResult("interruptions.authorize", b, raw); err != nil {
		t.Fatal(err)
	}
	for _, patch := range []map[string]any{{"expires": 100}, {"noExpiry": false}} {
		wrong := map[string]any{}
		for k, value := range v {
			wrong[k] = value
		}
		for k, value := range patch {
			wrong[k] = value
		}
		raw, _ := json.Marshal(wrong)
		if validateInterruptionResult("interruptions.authorize", b, raw) == nil {
			t.Fatal("unconfirmed unlimited approval accepted", wrong)
		}
	}
}
