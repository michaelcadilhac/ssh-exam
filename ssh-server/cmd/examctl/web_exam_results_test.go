package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func examReplyFixture() map[string]any {
	return map[string]any{"exam": map[string]any{"id": "midterm", "name": "Midterm", "template": "v1", "duration": 5400, "webcam": true, "terminals": 4, "earliest": 0, "latest": 8640000000000000}, "revision": strings.Repeat("a", 64)}
}
func TestExamResultScopeSchemaPagesAndIntentBeforeOutput(t *testing.T) {
	encode := func(v any) json.RawMessage {
		b, err := json.Marshal(v)
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	body := map[string]any{"id": "midterm"}
	if err := validateExamResult("exams.show", body, encode(examReplyFixture())); err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"wrong-id", "private", "missing", "null", "bad-version", "empty-version", "null-version", "bad-limit", "extra-root"} {
		t.Run(mode, func(t *testing.T) {
			r := examReplyFixture()
			e := r["exam"].(map[string]any)
			switch mode {
			case "wrong-id":
				e["id"] = "other"
			case "private":
				e["private"] = "SECRET"
			case "missing":
				delete(e, "webcam")
			case "null":
				e["webcam"] = nil
			case "bad-version":
				e["template_version"] = "latest"
			case "empty-version":
				e["template_version"] = ""
			case "null-version":
				e["template_version"] = nil
			case "bad-limit":
				e["collection_file_mib"] = 0
			case "extra-root":
				r["private"] = "SECRET"
			}
			if err := validateExamResult("exams.show", body, encode(r)); err == nil {
				t.Fatal("unsafe signed metadata accepted")
			}
		})
	}
	raw := string(encode(examReplyFixture()))
	for _, duplicate := range []string{strings.Replace(raw, `"id":"midterm"`, `"id":"elsewhere","id":"midterm"`, 1), strings.Replace(raw, `"revision":`, `"revision":"private","revision":`, 1)} {
		if err := validateExamResult("exams.show", body, []byte(duplicate)); err == nil {
			t.Fatal("duplicate reply keys accepted")
		}
	}
	selected := examReplyFixture()
	selected["exam"].(map[string]any)["template_version"] = strings.Repeat("b", 64)
	change := map[string]any{"id": "midterm", "revision": strings.Repeat("a", 64), "changes": map[string]any{"template_version": strings.Repeat("a", 64)}, "source_selection": "template-version/v1"}
	if err := validateExamResult("exams.update", change, encode(selected)); err == nil {
		t.Fatal("different saved source confirmed")
	}
	change["changes"] = map[string]any{"template_version": ""}
	if err := validateExamResult("exams.update", change, encode(examReplyFixture())); err != nil {
		t.Fatal("explicit legacy default refused", err)
	}
	rows := []any{}
	for i := 0; i < 200; i++ {
		v := examReplyFixture()
		v["exam"].(map[string]any)["id"] = fmt.Sprintf("exam-%03d", i)
		v["exam"].(map[string]any)["name"] = strings.Repeat("字", 120)
		rows = append(rows, v)
	}
	page := map[string]any{"exams": rows, "next": "exam-199"}
	if len(encode(page)) <= 65536 {
		t.Fatal("fixture did not exceed administrator JSON size")
	}
	if err := validateExamResult("exams.list", map[string]any{"limit": 200}, encode(page)); err != nil {
		t.Fatal("valid maximum Unicode page refused", err)
	}
	for _, mode := range []string{"cursor", "order", "overflow", "null-page"} {
		page := map[string]any{"exams": rows, "next": "exam-199"}
		switch mode {
		case "cursor":
			page["next"] = "elsewhere"
		case "order":
			page["exams"] = []any{rows[1], rows[0]}
		case "overflow":
			page["exams"] = append(append([]any{}, rows...), rows[0])
		case "null-page":
			page["exams"] = nil
		}
		if err := validateExamResult("exams.list", map[string]any{"limit": 200}, encode(page)); err == nil {
			t.Fatal("invalid definition page accepted", mode)
		}
	}
}
