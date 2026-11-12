package main

import (
	"encoding/json"
	"examworkspace/agent/internal/core"
	"fmt"
	"strings"
	"sync"
	"testing"
)

func TestCompleteListsActualCLIEntryPoints(t *testing.T) {
	for _, category := range []string{"exams", "students", "attempts", "grants", "templates", "administrators", "alerts", "monitoring", "purges", "reviews"} {
		t.Run(category, func(t *testing.T) {
			var mu sync.Mutex
			calls := 0
			requests := map[string]bool{}
			f := newScriptCLIFixture(t, func(r map[string]any) (any, string, bool) {
				mu.Lock()
				defer mu.Unlock()
				calls++
				request := r["request"].(string)
				if requests[request] {
					t.Error("request identity reused across pages")
				}
				requests[request] = true
				b := r["body"].(map[string]any)
				n := int(b["limit"].(float64))
				start := 0
				if after, ok := b["after"]; ok && after != float64(0) {
					start = 200
				}
				count := n
				if start > 0 {
					count = 1
				}
				rows := make([]any, 0, count)
				var last any
				for i := 0; i < count; i++ {
					index := start + i + 1
					id := fmt.Sprintf("%08d-1234-4234-8234-123456789abc", index)
					name := fmt.Sprintf("student%03d", index)
					var row any
					last = id
					switch category {
					case "exams":
						row = examDefinitionReply{Exam: examReplySettings{ID: name, Name: name, Template: "v1", Duration: 300, Terminals: 2, Earliest: 100, Latest: 200}, Revision: strings.Repeat("a", 64)}
						last = name
					case "students":
						row = map[string]any{"exam": "exam", "username": name}
						last = name
					case "attempts":
						row = scriptAttempt(id, "exam")
					case "grants":
						row = grantResult{ID: id, Agent: "class", Exam: "exam", Username: name, Revision: 1, Status: "AVAILABLE", Issuance: "ENROLLMENT", IssuanceOrder: 1, IssuedAt: 100, Actor: "instructor", Reason: "Synthetic ordinary grant", Hash: strings.Repeat("a", 64), Settings: core.Settings{ID: "exam", Name: "Exam", Template: "v1", TemplateVersion: strings.Repeat("b", 64), Duration: 5400, Earliest: 100, Latest: 200, Terminals: 2}, Work: grantWorkResult{Kind: "template", Name: "v1", Hash: strings.Repeat("b", 64)}}
					case "templates":
						source := catalogTestSource()
						source.Name = name
						row = source
						last = source.Name + "@" + source.Hash
					case "administrators":
						row = map[string]any{"username": name}
						last = name
					case "alerts":
						row = map[string]any{"id": id, "status": "sent"}
					case "monitoring":
						row = map[string]any{"cursor": index}
						last = index
					case "purges":
						row = map[string]any{"id": id, "status": "pending"}
					case "reviews":
						row = map[string]any{"id": id, "kind": "NEW_LEGACY_INITIAL_GRANTS", "status": "REVIEW", "created": 100, "expires": 200, "reason": "Synthetic review", "usernames": []string{name}}
					}
					rows = append(rows, row)
				}
				if start > 0 {
					last = nil
				}
				op := r["operation"].(string)
				value := map[string]any{webListKey(op): rows, "next": last}
				switch category {
				case "templates":
					value["agent"], value["observed"], value["note"] = "class", 100, "Metadata only"
				case "monitoring":
					value["id"], value["section"], value["through"] = "attempt", "frames", 1000
					if start > 0 && b["through"] != float64(1000) {
						t.Error("first watermark not carried", b)
					}
				case "purges":
					value["observed"] = 100
				case "reviews":
					value["agent"], value["exam"], value["actor"] = "class", "exam", "agent:class:root"
				}
				return value, "", false
			})
			args := []string{category, "list"}
			switch category {
			case "students", "attempts", "grants":
				args = append(args, "exam")
			case "monitoring":
				args = append(args, "attempt")
			case "purges":
				args = []string{"monitoring", "purges"}
			case "reviews":
				args = []string{"grants", "issue-list", "exam"}
			}
			out, stderr, code := f.invoke(args...)
			if code != 0 {
				t.Fatal(code, out, stderr)
			}
			var result core.ManagementResult
			var value map[string]json.RawMessage
			if json.Unmarshal([]byte(out), &result) != nil || json.Unmarshal(result.Result, &value) != nil {
				t.Fatal("invalid list output", out)
			}
			var rows []any
			if json.Unmarshal(value[webListKey(result.Operation)], &rows) != nil || len(rows) < 21 || string(value["next"]) != "null" {
				t.Fatal("list incomplete", out)
			}
			mu.Lock()
			if calls != 2 {
				t.Error("not every page fetched", calls)
			}
			calls = 0
			requests = map[string]bool{}
			mu.Unlock()
			limited := append(append([]string{}, args...), "--limit", "2")
			out, stderr, code = f.invoke(limited...)
			if code != 0 {
				t.Fatal(code, out, stderr)
			}
			_ = json.Unmarshal([]byte(out), &result)
			_ = json.Unmarshal(result.Result, &value)
			_ = json.Unmarshal(value[webListKey(result.Operation)], &rows)
			if len(rows) != 2 || string(value["next"]) == "null" {
				t.Fatal("explicit limit not applied", out)
			}
			mu.Lock()
			defer mu.Unlock()
			if calls != 1 {
				t.Error("bounded list fetched unnecessary page", calls)
			}
		})
	}
}

func TestCompleteListsActualCLIFilteredLimitAndFailure(t *testing.T) {
	var mu sync.Mutex
	mode, calls := "healthy", 0
	f := newScriptCLIFixture(t, func(r map[string]any) (any, string, bool) {
		mu.Lock()
		defer mu.Unlock()
		calls++
		b := r["body"].(map[string]any)
		if b["view"] != "COMPLETED" {
			t.Error("view filter dropped", b)
		}
		if _, ok := b["after"]; !ok {
			return map[string]any{"attempts": []any{}, "next": "11111111-1234-4234-8234-123456789abc", "scanned": 1}, "", false
		}
		if mode == "refuse" {
			return nil, "synthetic later refusal", false
		}
		if mode == "backwards" {
			return map[string]any{"attempts": []any{}, "next": "00000000-1234-4234-8234-123456789abc"}, "", false
		}
		if mode == "cycle" {
			return map[string]any{"attempts": []any{}, "next": b["after"]}, "", false
		}
		row := scriptAttempt("22222222-1234-4234-8234-123456789abc", "exam")
		if mode == "wrong-scope" {
			row["exam"] = "other"
		}
		return map[string]any{"attempts": []any{row}, "next": nil}, "", false
	})
	for _, args := range [][]string{{"attempts", "list", "exam", "--view", "COMPLETED"}, {"attempts", "list", "exam", "--view", "COMPLETED", "--limit", "1", "--username", "alice", "--format", "tsv", "--fields", "username", "--no-header"}} {
		out, stderr, code := f.invoke(args...)
		if code != 0 || !strings.Contains(out, "alice") {
			t.Fatal(code, out, stderr)
		}
		mu.Lock()
		if calls != 2 {
			t.Error("empty scanned page consumed returned-row limit", calls)
		}
		calls = 0
		mu.Unlock()
	}
	for _, failure := range []string{"refuse", "cycle", "backwards", "wrong-scope"} {
		mu.Lock()
		mode = failure
		mu.Unlock()
		// Scripting validation rejects wrong-scope; both entry paths reject transport
		// failure/cursor cycles before publishing even the first page.
		out, stderr, code := f.invoke("attempts", "list", "exam", "--view", "COMPLETED", "--format", "json")
		if code != 1 || out != "" {
			t.Fatal(failure, code, out, stderr)
		}
	}
}

func TestCompleteListsActualCLIExactFilterSkipsNonmatches(t *testing.T) {
	var mu sync.Mutex
	calls := 0
	f := newScriptCLIFixture(t, func(r map[string]any) (any, string, bool) {
		mu.Lock()
		defer mu.Unlock()
		calls++
		b := r["body"].(map[string]any)
		if b["limit"] != float64(1) {
			t.Error("explicit output limit lost", b)
		}
		first := b["after"] == nil
		id := "11111111-1234-4234-8234-123456789abc"
		if !first {
			id = "22222222-1234-4234-8234-123456789abc"
		}
		row := scriptAttempt(id, "exam")
		var next any
		if first {
			row["username"] = "bob"
			next = id
		}
		return map[string]any{"attempts": []any{row}, "next": next}, "", false
	})
	out, stderr, code := f.invoke("attempts", "list", "exam", "--username", "alice", "--limit", "1", "--format", "tsv", "--fields", "username", "--no-header")
	if code != 0 || out != "alice\n" {
		t.Fatal(code, out, stderr)
	}
	out, stderr, code = f.invoke("attempts", "list", "--exam", "exam", "--username", "alice", "--limit", "1")
	if code != 0 || !strings.Contains(out, `"username":"alice"`) || strings.Contains(out, `"username":"bob"`) {
		t.Fatal("ordinary filters require a formatting flag", code, out, stderr)
	}
	mu.Lock()
	defer mu.Unlock()
	if calls != 4 {
		t.Fatal("nonmatching scanned row consumed output limit", calls)
	}
}

func TestCompleteListsActualCLIMultipleExamsFreshRequests(t *testing.T) {
	var mu sync.Mutex
	calls := 0
	requests := map[string]bool{}
	const first = "99999999-1234-4234-8234-123456789abc"
	f := newScriptCLIFixture(t, func(r map[string]any) (any, string, bool) {
		mu.Lock()
		defer mu.Unlock()
		calls++
		id := r["request"].(string)
		if requests[id] || calls == 1 && id != first {
			t.Error("wrong/reused multi-exam read identity", id, calls)
		}
		requests[id] = true
		exam := r["body"].(map[string]any)["exam"].(string)
		return map[string]any{"attempts": []any{scriptAttempt("11111111-1234-4234-8234-123456789abc", exam)}, "next": nil}, "", false
	})
	out, stderr, code := f.invoke("attempts", "list", "--exam", "exam", "--exam", "other", "--request", first)
	if code != 0 || strings.Count(out, `"username":"alice"`) != 2 {
		t.Fatal(code, out, stderr)
	}
	mu.Lock()
	defer mu.Unlock()
	if calls != 2 {
		t.Fatal("missing selected exam", calls)
	}
}
