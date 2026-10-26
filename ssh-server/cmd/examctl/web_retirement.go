package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"strings"
	"unicode/utf8"
)

// Outer authentication does not bind a nested retirement target or review.
func validateRetirementResult(operation string, body any, raw json.RawMessage) error {
	bad := errors.New("gateway retirement scope/review mismatch; no output or confirmed retirement; preserve --request and inspect web exams show with a NEW read before a new intent")
	if !utf8.Valid(raw) || !boundedMetadataJSON(raw, catalogReplyLimit, 4, 8192) {
		return bad
	}
	input, err := json.Marshal(body)
	if err != nil {
		return bad
	}
	var b struct {
		ID       string `json:"id"`
		Action   string `json:"action"`
		Revision string `json:"revision"`
		Review   string `json:"review"`
		Reason   string `json:"reason"`
	}
	if catalogDecode(input, &b, []string{"id"}) != nil || !catalogName.MatchString(b.ID) {
		return bad
	}
	if operation == "exams.retire-preview" {
		if b.Action != "delete" && b.Action != "archive" && b.Action != "unarchive" {
			return bad
		}
		var r struct {
			ID        string            `json:"id"`
			Action    string            `json:"action"`
			Revision  string            `json:"revision"`
			Review    string            `json:"review"`
			Lifecycle string            `json:"lifecycle"`
			Exam      examReplySettings `json:"exam"`
			Counts    map[string]int64  `json:"counts"`
			Native    json.RawMessage   `json:"native"`
			Allowed   bool              `json:"allowed"`
			Blockers  []string          `json:"blockers"`
			Preserves []string          `json:"preserves"`
		}
		if catalogDecode(raw, &r, []string{"id", "action", "revision", "review", "lifecycle", "exam", "counts", "native", "allowed", "blockers", "preserves"}) != nil || r.ID != b.ID || r.Action != b.Action || !catalogHash.MatchString(r.Revision) || !catalogHash.MatchString(r.Review) || (r.Lifecycle != "active" && r.Lifecycle != "archived") || !r.Exam.valid() || r.Exam.ID != b.ID || r.Allowed != (len(r.Blockers) == 0) || len(r.Blockers) > 50 || len(r.Counts) != 9 || len(r.Preserves) > 10 || !validNativeRetirementSummary(r.Native, b.Action, r.Allowed) {
			return bad
		}
		for _, key := range []string{"enrollments", "attempts", "grants", "claims", "rosterPreviews", "grantPreviews", "allowanceEdits", "recoverySources", "modes"} {
			value, ok := r.Counts[key]
			if !ok || value < 0 || value > catalogSafeInteger {
				return bad
			}
		}
		for _, message := range append(r.Blockers, r.Preserves...) {
			if len(message) < 1 || len(message) > 2000 {
				return bad
			}
		}
		return nil
	}
	action := strings.TrimPrefix(operation, "exams.")
	if (action != "delete" && action != "archive" && action != "unarchive") || !catalogHash.MatchString(b.Revision) || !catalogHash.MatchString(b.Review) || len(b.Reason) < 8 || len(b.Reason) > 1000 {
		return bad
	}
	var r struct {
		ID        string          `json:"id"`
		Action    string          `json:"action"`
		Lifecycle string          `json:"lifecycle"`
		Previous  string          `json:"previous_revision"`
		Revision  json.RawMessage `json:"revision"`
	}
	if catalogDecode(raw, &r, []string{"id", "action", "lifecycle", "previous_revision"}) != nil || r.ID != b.ID || r.Action != action || r.Previous != b.Revision || len(r.Revision) == 0 {
		return bad
	}
	if action == "delete" {
		if r.Lifecycle != "deleted" || !bytes.Equal(bytes.TrimSpace(r.Revision), []byte("null")) {
			return bad
		}
	} else {
		want := "archived"
		if action == "unarchive" {
			want = "active"
		}
		var revision string
		if r.Lifecycle != want || json.Unmarshal(r.Revision, &revision) != nil || !catalogHash.MatchString(revision) || revision == b.Revision {
			return bad
		}
	}
	return nil
}

func validNativeRetirementSummary(raw json.RawMessage, action string, allowed bool) bool {
	var r struct {
		Status      string          `json:"status"`
		Evidence    json.RawMessage `json:"evidence"`
		Attempts    int64           `json:"attempts"`
		Permissions int64           `json:"permissions"`
		Released    int64           `json:"released_retentions"`
		History     bool            `json:"has_history"`
	}
	if catalogDecode(raw, &r, []string{"status", "attempts", "permissions", "released_retentions", "has_history"}) != nil || len(r.Evidence) == 0 {
		return false
	}
	for _, count := range []int64{r.Attempts, r.Permissions, r.Released} {
		if count < 0 || count > 1000 || count > 0 && !r.History {
			return false
		}
	}
	if (r.Status == "required" || r.Status == "stale") && action != "unarchive" && allowed {
		return false
	}
	if r.Status == "not-required" || r.Status == "required" {
		return bytes.Equal(bytes.TrimSpace(r.Evidence), []byte("null")) && r.Attempts == 0 && r.Permissions == 0 && r.Released == 0 && !r.History
	}
	var digest string
	return (r.Status == "verified" || r.Status == "stale") && json.Unmarshal(r.Evidence, &digest) == nil && catalogHash.MatchString(digest)
}
