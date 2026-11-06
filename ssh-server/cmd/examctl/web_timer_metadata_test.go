package main

import (
	"encoding/json"
	"testing"
)

func TestScriptAttemptTimerMetadataIsBoundedAndRetainsPrivateFieldRefusal(t *testing.T) {
	base := map[string]any{"id": "attempt", "exam": "exam", "username": "alice", "uid": json.Number("1001"),
		"start": json.Number("1"), "deadline": json.Number("2"), "original_deadline": json.Number("2"), "ended": nil,
		"monitoring_mode": "v1", "timer_paused_at": json.Number("1"), "timer_remaining_ms": json.Number("1000")}
	body := map[string]any{"exam": "exam"}
	if err := validateScriptListRows("attempts.list", body, []map[string]any{base}); err != nil {
		t.Fatal(err)
	}
	for key, bad := range map[string]any{"timer_paused_at": json.Number("-1"), "timer_remaining_ms": json.Number("9007199254740992"), "monitoring_mode": "unknown", "private_key": "synthetic secret"} {
		copy := map[string]any{}
		for k, v := range base {
			copy[k] = v
		}
		copy[key] = bad
		if validateScriptListRows("attempts.list", body, []map[string]any{copy}) == nil {
			t.Fatal("accepted unbounded/private metadata", key)
		}
	}
	for _, bad := range []any{nil, "1000", json.Number("0"), json.Number("1.5")} {
		copy := map[string]any{}
		for k, v := range base {
			copy[k] = v
		}
		copy["timer_remaining_ms"] = bad
		if validateScriptListRows("attempts.list", body, []map[string]any{copy}) == nil {
			t.Fatal("accepted inconsistent timer metadata", bad)
		}
	}
	delete(base, "timer_paused_at")
	delete(base, "timer_remaining_ms")
	delete(base, "monitoring_mode")
	if err := validateScriptListRows("attempts.list", body, []map[string]any{base}); err != nil {
		t.Fatal("old metadata reader compatibility lost", err)
	}
}
