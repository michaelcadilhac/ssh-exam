package main

import (
	"examworkspace/agent/internal/core"
	"strings"
	"sync"
	"testing"
)

func TestGrantNextCLIHelpAndFlagRefusals(t *testing.T) {
	for _, args := range [][]string{{"help", "grants"}, {"web", "grants", "help"}, {"web", "grants", "list", "--help"}} {
		out, code := cliProcess(t, args...)
		for _, word := range []string{"--next", "claimed setups", "full history", "matching updated web server"} {
			if code != 0 || !strings.Contains(out, word) {
				t.Fatal("missing next-list discovery", word, code, out)
			}
		}
	}
	for _, args := range [][]string{
		{"web", "grants", "list", "midterm", "--next=bad"},
		{"web", "grants", "list", "midterm", "--next", "false"},
		{"web", "grants", "show", "33333333-1234-4234-8234-123456789abc", "--next"},
		{"web", "students", "list", "midterm", "--next", "--format", "tsv"},
	} {
		out, code := cliProcess(t, args...)
		if code != 2 || !strings.Contains(out, "help") || strings.Contains(out, "Load root") {
			t.Fatal("invalid next flag reached authority", code, out)
		}
	}
}

func TestGrantNextActualSignedCLIAndTablePagination(t *testing.T) {
	first := grantResult{ID: "33333333-1234-4234-8234-123456789abc", Agent: "class", Exam: "midterm", Username: "student", Revision: 1, Status: "AVAILABLE", IssuedAt: 100, Actor: "instructor", Reason: "Synthetic next permission", Issuance: "ENROLLMENT", IssuanceOrder: 1, Hash: strings.Repeat("a", 64), Settings: core.Settings{ID: "midterm", Name: "Midterm", Template: "v1", TemplateVersion: strings.Repeat("b", 64), Duration: 5400, Earliest: 100, Latest: 200, Terminals: 2}, Work: grantWorkResult{Kind: "template", Name: "v1", Hash: strings.Repeat("b", 64)}, Claims: []grantClaimResult{{Attempt: "99999999-1234-4234-8234-123456789abc", UID: 10001, Revision: 1, Hash: strings.Repeat("a", 64), State: "PREPARING", CreatedAt: 100}}}
	second := first
	second.ID, second.Username, second.Status, second.Issuance, second.IssuanceOrder = "44444444-1234-4234-8234-123456789abc", "otherstudent", "PENDING_NATIVE", "ADDITIONAL_TEMPLATE", 2
	second.Work = grantWorkResult{Kind: "saved", Attempt: "88888888-1234-4234-8234-123456789abc", Checksum: strings.Repeat("c", 64)}
	second.Claims = []grantClaimResult{}
	var mu sync.Mutex
	mode, calls := "single", 0
	f := newScriptCLIFixture(t, func(request map[string]any) (any, string, bool) {
		mu.Lock()
		defer mu.Unlock()
		calls++
		body := request["body"].(map[string]any)
		if request["operation"] != "grants.list" || body["exam"] != "midterm" {
			t.Error("wrong next-list operation/scope", request)
		}
		row := first
		var next any
		if mode == "full" {
			if _, present := body["next_only"]; present {
				t.Error("default history request gained a filter", body)
			}
			row.Status = "REVOKED"
		} else {
			if body["next_only"] != true {
				t.Error("next flag was not a typed true", body)
			}
			if mode == "pages" {
				if body["limit"] != float64(100) {
					t.Error("page size changed", body)
				}
				if body["after"] == nil {
					next = first.ID
				} else if body["after"] == first.ID {
					row = second
				} else {
					t.Error("wrong cursor", body)
				}
			}
		}
		return map[string]any{"grants": []grantResult{row}, "next": next}, "", false
	})
	requestNotice := func(value string) bool {
		const prefix = "Management request ID: "
		return strings.HasPrefix(value, prefix) && managementUUID.MatchString(strings.TrimSpace(strings.TrimPrefix(value, prefix)))
	}
	out, err, code := f.invoke("grants", "list", "midterm", "--next", "--limit", "200")
	if code != 0 || !requestNotice(err) || !strings.Contains(out, first.ID) {
		t.Fatal(code, out, err)
	}
	mu.Lock()
	mode = "full"
	mu.Unlock()
	out, err, code = f.invoke("grants", "list", "midterm", "--next=false")
	if code != 0 || !requestNotice(err) || !strings.Contains(out, "REVOKED") {
		t.Fatal("default historical listing changed", code, out, err)
	}
	mu.Lock()
	mode = "pages"
	mu.Unlock()
	out, err, code = f.invoke("grants", "list", "midterm", "--next", "--all", "--format", "tsv", "--fields", "username,status")
	if code != 0 || err != "" || out != "username\tstatus\nstudent\tAVAILABLE\notherstudent\tPENDING_NATIVE\n" {
		t.Fatal("filtered table pagination changed", code, out, err)
	}
	mu.Lock()
	defer mu.Unlock()
	if calls != 4 {
		t.Error("unexpected list requests", calls)
	}
}

func TestGrantNextActualCLIRefusesUnsupportedOrIgnoredFilterWithoutFallback(t *testing.T) {
	row := grantResult{ID: "33333333-1234-4234-8234-123456789abc", Agent: "class", Exam: "midterm", Username: "student", Revision: 1, Status: "REVOKED", IssuedAt: 100, Actor: "instructor", Reason: "Synthetic retained cancelled permission", Issuance: "ENROLLMENT", IssuanceOrder: 1, Hash: strings.Repeat("a", 64), Settings: core.Settings{ID: "midterm", Name: "Midterm", Template: "v1", TemplateVersion: strings.Repeat("b", 64), Duration: 5400, Earliest: 100, Latest: 200, Terminals: 2}, Work: grantWorkResult{Kind: "template", Name: "v1", Hash: strings.Repeat("b", 64)}, Claims: []grantClaimResult{}}
	var mu sync.Mutex
	mode, calls := "unsupported", 0
	f := newScriptCLIFixture(t, func(request map[string]any) (any, string, bool) {
		mu.Lock()
		defer mu.Unlock()
		calls++
		body := request["body"].(map[string]any)
		if request["operation"] != "grants.list" || body["next_only"] != true {
			t.Error("filter lost or fallback sent", request)
		}
		if mode == "unsupported" {
			return nil, "next_only unsupported; update the matching web server", false
		}
		return map[string]any{"grants": []grantResult{row}, "next": nil}, "", false
	})
	for _, next := range []string{"unsupported", "ignored"} {
		mu.Lock()
		mode = next
		mu.Unlock()
		out, err, code := f.invoke("grants", "list", "midterm", "--next", "--format", "tsv", "--fields", "username,status")
		if code != 1 || out != "" || err == "" {
			t.Fatal("unsupported/unconfirmed filter became output", code, out, err)
		}
	}
	mu.Lock()
	defer mu.Unlock()
	if calls != 2 {
		t.Error("unsupported filter retried as history", calls)
	}
}
