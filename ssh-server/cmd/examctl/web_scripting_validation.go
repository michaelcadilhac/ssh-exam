package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
)

func validateScriptListRows(operation string, body map[string]any, rows []map[string]any) error {
	limit := 100
	if raw, ok := body["limit"].(int); ok {
		limit = raw
	}
	if limit < 1 || limit > 200 || len(rows) > limit {
		return errors.New("list reply exceeds the requested page bound")
	}
	if operation != "students.list" && operation != "attempts.list" {
		return nil
	} // Existing typed grant/exam validators run first.
	allowed := "exam username webcam duration uid attempt recovery_allowance_edit"
	if operation == "attempts.list" {
		allowed = "id exam username uid state settings preflight_started_at start deadline original_deadline clock_revision ended generation last_contact reason work_path export_status checksum protected completed_at collected_at secured_at policy_state policy_expires policy_error access_state access_held_at access_released_at access_override access_checked_at access_error functional_test grant_id grant_revision grant_hash attempt_number connected working terminalCount grantContext pendingClockReset"
	}
	fields := map[string]bool{}
	for _, key := range strings.Fields(allowed) {
		fields[key] = true
	}
	previous := stringField(body, "after")
	for _, row := range rows {
		for key := range row {
			if !fields[key] {
				return fmt.Errorf("unexpected metadata field %s; no private output", key)
			}
		}
		username, ok := row["username"].(string)
		if !ok || !regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9_-]{0,31}$`).MatchString(username) || row["exam"] != body["exam"] {
			return errors.New("list row account/exam differs from selected scope")
		}
		id := username
		if operation == "attempts.list" {
			id, ok = row["id"].(string)
			if !ok || !catalogName.MatchString(id) {
				return errors.New("invalid attempt identity")
			}
			for _, key := range []string{"start", "deadline", "original_deadline", "ended", "uid"} {
				value, exists := row[key]
				if !exists {
					return fmt.Errorf("missing attempt field %s", key)
				}
				if value == nil && key != "uid" {
					continue
				}
				number, ok := value.(json.Number)
				if !ok {
					return errors.New("attempt timing/identity is not an integer")
				}
				n, err := number.Int64()
				if err != nil || n < 0 || n > catalogSafeInteger {
					return errors.New("attempt timing/identity is out of bounds")
				}
			}
		} else {
			// The legacy roster API includes its full dashboard attempt. Scripting
			// exports deliberately expose roster metadata only; attempt history has
			// its separate bounded, credential-free attempts projection.
			delete(row, "attempt")
		}
		if id <= previous {
			return errors.New("list identities are not strictly advancing")
		}
		previous = id
		if hasScriptPrivateField(row) {
			return errors.New("private credential field in metadata; no output")
		}
	}
	return nil
}

func hasScriptPrivateField(value any) bool {
	switch v := value.(type) {
	case map[string]any:
		for key, child := range v {
			switch strings.ToLower(key) {
			case "password", "passwordfile", "private_key", "callback_key", "page_hash", "token", "csrf", "input_token", "control_token":
				return true
			}
			if hasScriptPrivateField(child) {
				return true
			}
		}
	case []any:
		for _, child := range v {
			if hasScriptPrivateField(child) {
				return true
			}
		}
	}
	return false
}
