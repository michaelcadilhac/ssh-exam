package main

import (
	"encoding/json"
	"errors"
	"regexp"
)

func validateGrantReviewPage(body any, raw json.RawMessage, agent string) error {
	fail := errors.New("Unconfirmed request-list scope/schema; no output. Inspect the selected exam and retry a fresh issue-list read")
	var page struct {
		Agent string `json:"agent"`
		Exam  string `json:"exam"`
		Actor string `json:"actor"`
		Rows  []struct {
			ID        string   `json:"id"`
			Kind      string   `json:"kind"`
			Status    string   `json:"status"`
			Created   int64    `json:"created"`
			Expires   int64    `json:"expires"`
			Reason    string   `json:"reason"`
			Usernames []string `json:"usernames"`
		} `json:"rows"`
		Next *string `json:"next"`
	}
	var scope struct {
		Exam  string `json:"exam"`
		Limit int    `json:"limit"`
		After string `json:"after"`
	}
	encoded, _ := json.Marshal(body)
	if json.Unmarshal(encoded, &scope) != nil || scope.Limit < 1 || scope.Limit > 20 ||
		catalogDecode(raw, &page, []string{"agent", "exam", "actor", "rows", "next"}) != nil ||
		page.Agent != agent || page.Actor != "agent:"+agent+":root" || page.Exam != scope.Exam || len(page.Rows) > scope.Limit {
		return fail
	}
	seen := map[string]bool{}
	for _, row := range page.Rows {
		if !managementUUID.MatchString(row.ID) || seen[row.ID] || row.Created <= 0 || row.Expires <= row.Created || len(row.Reason) < 8 || len(row.Reason) > 1000 || len(row.Usernames) < 1 || len(row.Usernames) > 200 {
			return fail
		}
		seen[row.ID] = true
		switch row.Kind {
		case "NEW_LEGACY_INITIAL_GRANTS", "NEW_ADDITIONAL_TEMPLATE_GRANTS", "NEW_SANDBOX_PRACTICE_GRANTS":
		default:
			return fail
		}
		if (page.Exam == "sandbox") != (row.Kind == "NEW_SANDBOX_PRACTICE_GRANTS") {
			return fail
		}
		switch row.Status {
		case "REVIEW", "CONFIRMED", "CANCELLED", "EXPIRED":
		default:
			return fail
		}
		names := map[string]bool{}
		for _, name := range row.Usernames {
			if !regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9_-]{0,31}$`).MatchString(name) || names[name] {
				return fail
			}
			names[name] = true
		}
	}
	if page.Next != nil && (!managementUUID.MatchString(*page.Next) || *page.Next == scope.After || len(page.Rows) != scope.Limit || page.Rows[len(page.Rows)-1].ID != *page.Next) {
		return fail
	}
	return nil
}
