package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestMonitoringHelpAndSyntaxWithoutConfiguration(t *testing.T) {
	for _, args := range [][]string{{"help", "monitoring"}, {"web", "monitoring", "help"}, {"--config", "/missing", "web", "monitoring", "--help"}} {
		out, code := cliProcess(t, args...)
		for _, want := range []string{"Usage:", "--through", "--offset", "--request", "1 MiB", "transient", "0600", "Exit status:"} {
			if code != 0 || !strings.Contains(out, want) {
				t.Fatal("missing monitoring help", want, code, out)
			}
		}
	}
	for _, args := range [][]string{
		{"web", "monitoring"}, {"web", "monitoring", "show", "a", "--output", "private"},
		{"web", "monitoring", "show", "a", "--limit", "1"},
		{"web", "monitoring", "list", "a", "--section", "private"},
		{"web", "monitoring", "list", "a", "--limit", "201"},
		{"web", "monitoring", "list", "a", "--after", "1"},
		{"web", "monitoring", "list", "a", "--after", "2", "--through", "1"},
		{"web", "monitoring", "replay", "a"},
		{"web", "monitoring", "replay", "a", "pane", "--offset", "-1"},
		{"web", "monitoring", "replay", "a", "pane", "--offset", "9007199254740992"},
		{"web", "monitoring", "replay", "a", "pane", "--output="},
		{"web", "monitoring", "delete", "a"},
		{"web", "monitoring", "show", "a", "--reason", "Not a read flag"},
		{"web", "monitoring", "delete", "a", "--confirm", "student", "--revision", strings.Repeat("a", 64), "--reason", "short"},
		{"web", "monitoring", "delete", "a", "--confirm", "student", "--revision", strings.Repeat("a", 64), "--reason", "Reviewed removal", "--output", "private"},
		{"web", "monitoring", "purge-status"},
		{"web", "monitoring", "purges", "a"},
		{"web", "monitoring", "purges", "--status", "not-verified"},
		{"web", "monitoring", "purges", "--limit", "101"},
		{"web", "monitoring", "purges", "--after", "../private"},
		{"web", "monitoring", "purge-status", "a", "--status", "retry"},
	} {
		out, code := cliProcess(t, args...)
		if code != 2 || !strings.Contains(out, "help") || strings.Contains(out, "Load root") {
			t.Fatal("bad syntax reached authority", code, out)
		}
	}
}

func TestPurgeInventoryReplyScope(t *testing.T) {
	body := map[string]any{"limit": 1, "after": "a", "status": "retry"}
	value := map[string]any{"entries": []any{map[string]any{"id": "b", "status": "retry"}}, "next": "b", "observed": 1}
	raw, _ := json.Marshal(value)
	if err := validateMonitoringResult("monitoring.purges", body, raw); err != nil {
		t.Fatal(err)
	}
	for _, patch := range []map[string]any{{"observed": nil}, {"next": "c"}, {"entries": []any{map[string]any{"id": "a", "status": "retry"}}}, {"entries": []any{map[string]any{"id": "b", "status": "pending"}}}} {
		wrong := map[string]any{}
		for k, v := range value {
			wrong[k] = v
		}
		for k, v := range patch {
			wrong[k] = v
		}
		raw, _ = json.Marshal(wrong)
		if validateMonitoringResult("monitoring.purges", body, raw) == nil {
			t.Fatal("accepted invalid inventory", wrong)
		}
	}
	single := json.RawMessage(`{"id":"a","deleted":0,"observed":1,"attempt":null,"job":{"status":"not-verified"}}`)
	if err := validateMonitoringResult("monitoring.purge", map[string]any{"id": "a"}, single); err != nil {
		t.Fatal(err)
	}
	if validateMonitoringResult("monitoring.purge", map[string]any{"id": "b"}, single) == nil {
		t.Fatal("accepted wrong job")
	}
}

func TestMonitoringDeletionReplyScope(t *testing.T) {
	body := map[string]any{"id": "a", "requestID": "intent"}
	value := map[string]any{"id": "a", "requestID": "intent", "status": "logical-deletion-accepted", "logicalDeleted": true, "physicalPurge": "pending-verification"}
	raw, _ := json.Marshal(value)
	if err := validateMonitoringResult("monitoring.delete", body, raw); err != nil {
		t.Fatal(err)
	}
	for _, patch := range []map[string]any{{"id": "other"}, {"requestID": "other"}, {"status": "removed"}, {"logicalDeleted": false}, {"logicalDeleted": nil}, {"physicalPurge": "complete"}} {
		wrong := map[string]any{}
		for k, v := range value {
			wrong[k] = v
		}
		for k, v := range patch {
			wrong[k] = v
		}
		raw, _ := json.Marshal(wrong)
		if validateMonitoringResult("monitoring.delete", body, raw) == nil {
			t.Fatal("accepted invalid deletion receipt", wrong)
		}
	}
}

func TestMonitoringReplayReplyCheckedBeforePrivateOutput(t *testing.T) {
	body := map[string]any{"id": "a", "pane": "pane", "offset": 0}
	value := map[string]any{"id": "a", "pane": "pane", "offset": 0, "format": "ndjson", "text": "日本語\n", "nextOffset": 10, "availableBytes": 10, "more": false}
	raw, _ := json.Marshal(value)
	if err := validateMonitoringResult("monitoring.replay", body, raw); err != nil {
		t.Fatal(err)
	}
	for _, patch := range []map[string]any{{"id": "other"}, {"pane": "other"}, {"offset": 1}, {"format": "csv"}, {"text": nil}, {"text": "incomplete"}, {"nextOffset": 4}, {"availableBytes": 9}, {"more": true}, {"more": nil}} {
		wrong := map[string]any{}
		for k, v := range value {
			wrong[k] = v
		}
		for k, v := range patch {
			wrong[k] = v
		}
		raw, _ = json.Marshal(wrong)
		if validateMonitoringResult("monitoring.replay", body, raw) == nil {
			t.Fatal("accepted unsafe replay", wrong)
		}
	}
}

func TestMonitoringPageScopeAndCursorValidation(t *testing.T) {
	body := map[string]any{"id": "a", "section": "frames", "limit": 1, "after": 2, "through": 8}
	value := map[string]any{"id": "a", "section": "frames", "through": 8, "entries": []any{map[string]any{"cursor": 3}}, "next": 3}
	raw, _ := json.Marshal(value)
	if err := validateMonitoringResult("monitoring.list", body, raw); err != nil {
		t.Fatal(err)
	}
	for _, patch := range []map[string]any{{"section": "terminals"}, {"through": 9}, {"through": nil}, {"next": 4}, {"entries": []any{map[string]any{"cursor": 2}}}, {"entries": []any{map[string]any{"cursor": 9}}}} {
		wrong := map[string]any{}
		for k, v := range value {
			wrong[k] = v
		}
		for k, v := range patch {
			wrong[k] = v
		}
		raw, _ = json.Marshal(wrong)
		if validateMonitoringResult("monitoring.list", body, raw) == nil {
			t.Fatal("accepted unsafe page", wrong)
		}
	}
}
