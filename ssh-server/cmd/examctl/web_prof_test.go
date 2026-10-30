package main

import (
	"strings"
	"sync"
	"testing"
	"time"
)

func TestProfActualCLIPreservesDurationAndAcceptsMixedStartingFiles(t *testing.T) {
	var mu sync.Mutex
	calls := 0
	f := newScriptCLIFixture(t, func(r map[string]any) (any, string, bool) {
		mu.Lock()
		defer mu.Unlock()
		calls++
		if r["operation"] != "grants.additional-preview" {
			t.Error("wrong operation", r["operation"])
		}
		b := r["body"].(map[string]any)
		if b["preserve_duration"] != true {
			t.Error("lost explicit preserved duration", b)
		}
		if _, ok := b["duration"]; ok {
			t.Error("preservation must not invent a shared allowance", b)
		}
		if sources, ok := b["work_sources"].([]any); ok {
			if len(sources) != 2 {
				t.Error("mixed starting files lost", sources)
			}
			for _, raw := range sources {
				row := raw.(map[string]any)
				work := row["work"].(map[string]any)
				if row["username"] == "alice" && (work["kind"] != "saved" || len(work) != 3) {
					t.Error("strict saved union lost", row)
				}
				if row["username"] == "bob" && (work["kind"] != "template" || len(work) != 3) {
					t.Error("strict template union lost", row)
				}
			}
		} else if calls == 2 {
			t.Error("missing mixed sources", b)
		}
		return nil, "synthetic preserved-time review reached", false
	})
	args := []string{"grants", "additional-preview", "midterm", "--definition-revision", strings.Repeat("a", 64), "--template-version", strings.Repeat("b", 64), "--earliest", time.Now().Add(-time.Minute).Format(time.RFC3339), "--latest", time.Now().Add(time.Hour).Format(time.RFC3339), "--reason", "Reviewed extra attempts with preserved time", "--preserve-duration"}
	if out, err, code := f.invoke(append(append([]string{}, args...), "alice", "bob")...); code != 1 || out != "" || !strings.Contains(err, "synthetic preserved-time") {
		t.Fatal(code, out, err)
	}
	input := `{"username":"alice","settings":{"duration":95,"webcam":false},"work":{"kind":"saved","attempt":"22222222-1234-4234-8234-123456789abc","checksum":"` + strings.Repeat("a", 64) + `"}}` + "\n" +
		`{"username":"bob","settings":{},"work":{"kind":"template","name":"v1","hash":"` + strings.Repeat("b", 64) + `"}}`
	var out strings.Builder
	if err, code := f.streams(strings.NewReader(input), &out, append(append([]string{}, args...), "--input", "-", "--format", "table")...); code != 1 || out.Len() != 0 || !strings.Contains(err, "synthetic preserved-time") {
		t.Fatal(code, out.String(), err)
	}
	for _, extra := range [][]string{{"--duration-minutes", "5"}, {"--duration-seconds", "95"}} {
		if out, err, code := f.invoke(append(append(append([]string{}, args...), "alice"), extra...)...); code != 2 || out != "" || !strings.Contains(err, "preserve") {
			t.Fatal("ambiguous duration reached authority", code, out, err)
		}
	}
	mu.Lock()
	defer mu.Unlock()
	if calls != 2 {
		t.Error("ambiguous input reached authority", calls)
	}
}

func TestProfActualCLIMixedPreviewValidatesEachResolvedRowBeforeOutput(t *testing.T) {
	var mu sync.Mutex
	mode := "valid"
	f := newScriptCLIFixture(t, func(request map[string]any) (any, string, bool) {
		mu.Lock()
		defer mu.Unlock()
		b := request["body"].(map[string]any)
		sources := b["work_sources"].([]any)
		rows := []any{}
		for _, raw := range sources {
			source := raw.(map[string]any)
			username := source["username"].(string)
			work := source["work"].(map[string]any)
			duration := 95
			if username == "bob" {
				duration = 5400
			}
			if mode == "source" && username == "alice" {
				work["attempt"] = "44444444-1234-4234-8234-123456789abc"
			}
			if mode == "override" && username == "alice" {
				duration = 96
			}
			if mode == "bounds" && username == "bob" {
				duration = 21601
			}
			rows = append(rows, map[string]any{"username": username, "settings": map[string]any{
				"id": "midterm", "name": "Exam", "template": "v1", "template_version": b["template_version"],
				"duration": duration, "webcam": false, "terminals": 4, "earliest": b["earliest"], "latest": b["latest"],
			}, "work": work, "hash": strings.Repeat("c", 64)})
		}
		return map[string]any{"id": "55555555-1234-4234-8234-123456789abc", "kind": "NEW_ADDITIONAL_TEMPLATE_GRANTS",
			"agent": "class", "exam": "midterm", "actor": "agent:class:root", "reason": b["reason"],
			"definition_revision": b["definition_revision"], "revision": strings.Repeat("d", 64), "created": 1000, "expires": 2000,
			"status": "REVIEW", "rows": rows, "issued": []any{}}, "", false
	})
	input := `{"username":"alice","settings":{"duration":95,"webcam":false},"work":{"kind":"saved","attempt":"22222222-1234-4234-8234-123456789abc","checksum":"` + strings.Repeat("a", 64) + `"}}` + "\n" +
		`{"username":"bob","settings":{},"work":{"kind":"template","name":"v1","hash":"` + strings.Repeat("b", 64) + `"}}`
	args := []string{"grants", "additional-preview", "midterm", "--definition-revision", strings.Repeat("a", 64), "--template-version", strings.Repeat("b", 64), "--earliest", time.Now().Add(-time.Minute).Format(time.RFC3339), "--latest", time.Now().Add(time.Hour).Format(time.RFC3339), "--reason", "Review selected mixed sources and exact limits", "--preserve-duration", "--input", "-", "--format", "tsv", "--fields", "username,settings.duration,work.kind"}
	for _, scenario := range []string{"valid", "source", "override", "bounds"} {
		mu.Lock()
		mode = scenario
		mu.Unlock()
		var out strings.Builder
		stderr, code := f.streams(strings.NewReader(input), &out, args...)
		if scenario == "valid" {
			if code != 0 || !strings.Contains(out.String(), "alice\t95\tsaved") || !strings.Contains(out.String(), "bob\t5400\ttemplate") {
				t.Fatal(code, out.String(), stderr)
			}
		} else if code != 1 || out.Len() != 0 || !strings.Contains(stderr, "scope/schema") {
			t.Fatal("changed row escaped validated output", scenario, code, out.String(), stderr)
		}
	}
}

func TestProfActualCLIListsOnlyScopedRecentReviews(t *testing.T) {
	var mu sync.Mutex
	wrongActor := false
	f := newScriptCLIFixture(t, func(request map[string]any) (any, string, bool) {
		mu.Lock()
		defer mu.Unlock()
		if request["operation"] != "grants.issue-list" {
			t.Error("wrong operation", request["operation"])
		}
		actor := "agent:class:root"
		if wrongActor {
			actor = "another-instructor"
		}
		return map[string]any{"agent": "class", "exam": "midterm", "actor": actor, "next": nil, "rows": []any{
			map[string]any{"id": "55555555-1234-4234-8234-123456789abc", "kind": "NEW_ADDITIONAL_TEMPLATE_GRANTS", "status": "REVIEW",
				"created": 1000, "expires": 2000, "reason": "Reviewed extra attempts for selected students", "usernames": []string{"alice", "bob"}},
		}}, "", false
	})
	args := []string{"grants", "issue-list", "midterm", "--format", "tsv", "--fields", "id,status", "--limit", "1"}
	out, stderr, code := f.invoke(args...)
	if code != 0 || !strings.Contains(out, "55555555-1234-4234-8234-123456789abc\tREVIEW") {
		t.Fatal(code, out, stderr)
	}
	mu.Lock()
	wrongActor = true
	mu.Unlock()
	out, stderr, code = f.invoke(args...)
	if code != 1 || out != "" || !strings.Contains(stderr, "scope/schema") {
		t.Fatal("foreign request metadata escaped", code, out, stderr)
	}
}
