package main

import (
	"strings"
	"sync"
	"testing"
	"time"
)

func TestWebStudentEnrollmentDatesHelpAndSyntax(t *testing.T) {
	for _, args := range [][]string{{"help", "students"}, {"web", "students", "add", "--help"}} {
		out, code := cliProcess(t, args...)
		for _, word := range []string{"--earliest", "--latest", "--definition-revision", "new first"} {
			if code != 0 || !strings.Contains(out, word) {
				t.Fatalf("missing %s: %d %s", word, code, out)
			}
		}
	}
	base := []string{"web", "students", "add", "midterm", "student"}
	for _, scenario := range []struct {
		flags []string
		why   string
	}{
		{[]string{"--earliest", "2020-01-02T13:14:23Z"}, "both"},
		{[]string{"--earliest", "2020-01-02T13:14", "--latest", "2020-01-03T13:14:23Z"}, "timezone"},
		{[]string{"--earliest", "1970-01-01T00:00:00Z", "--latest", "2020-01-03T13:14:23Z"}, "finite"},
		{[]string{"--earliest", "2020-01-03T13:14:23Z", "--latest", "2020-01-02T13:14:23Z"}, "after"},
		{[]string{"--definition-revision", "stale"}, "revision"},
	} {
		out, code := cliProcess(t, append(append([]string{}, base...), scenario.flags...)...)
		if code != 2 || !strings.Contains(out, scenario.why) || strings.Contains(out, "Load root") {
			t.Fatal(code, out)
		}
	}
	out, code := cliProcess(t, "web", "students", "settings", "midterm", "student", "--webcam", "optional", "--earliest", "2020-01-02T13:14:23Z", "--latest", "2020-01-03T13:14:23Z")
	if code != 2 || !strings.Contains(out, "does not apply") {
		t.Fatal(code, out)
	}
}

func TestWebStudentEnrollmentDatesActualSignedCLI(t *testing.T) {
	const opens = "2020-01-02T13:14:23.456Z"
	const closes = "2020-01-03T17:18:34.567Z"
	first, _ := time.Parse(time.RFC3339Nano, opens)
	last, _ := time.Parse(time.RFC3339Nano, closes)
	var mu sync.Mutex
	calls, reads := 0, 0
	requests := map[string]bool{}
	f := newScriptCLIFixture(t, func(request map[string]any) (any, string, bool) {
		mu.Lock()
		defer mu.Unlock()
		body := request["body"].(map[string]any)
		if body["exam"] != "midterm" {
			t.Error("wrong exam", body)
		}
		requestID := request["request"].(string)
		if requests[requestID] {
			t.Error("capability read reused another intent ID")
		}
		requests[requestID] = true
		if request["operation"] == "students.list" {
			reads++
			if body["limit"] != float64(1) || len(body) != 2 {
				t.Error("unbounded capability read", body)
			}
			return map[string]any{"students": []any{}, "next": nil, "capabilities": []string{"enrollment-dates-v1"}}, "", false
		}
		calls++
		switch calls {
		case 1:
			if request["operation"] != "students.add" || body["username"] != "newstudent" || body["definition_revision"] != strings.Repeat("c", 64) {
				t.Error("wrong add intent", request)
			}
		case 2:
			if request["operation"] != "students.import-preview" || body["text"] != "username\notherstudent\n" || body["mode"] != "csv" {
				t.Error("wrong preview intent", request)
			}
		case 3:
			if request["operation"] != "students.add" || body["username"] != "defaultstudent" {
				t.Error("wrong default add", request)
			}
			for _, key := range []string{"earliest", "latest", "definition_revision"} {
				if _, exists := body[key]; exists {
					t.Error("omitted default became override", key)
				}
			}
		default:
			t.Error("unexpected request", calls)
		}
		if calls < 3 && (body["earliest"] != float64(first.UnixMilli()) || body["latest"] != float64(last.UnixMilli())) {
			t.Error("date precision or timezone changed", body)
		}
		return nil, "synthetic enrollment dates reached", false
	})
	check := func(out, err string, code int) {
		t.Helper()
		if code != 1 || out != "" || !strings.Contains(err, "synthetic enrollment dates reached") {
			t.Fatal(code, out, err)
		}
	}
	check(f.invoke("students", "add", "midterm", "newstudent", "--earliest", opens, "--latest", closes, "--definition-revision", strings.Repeat("c", 64)))
	var discarded strings.Builder
	err, code := f.streams(strings.NewReader("username\notherstudent\n"), &discarded, "students", "import-preview", "midterm", "--file", "-", "--earliest", opens, "--latest", closes)
	check(discarded.String(), err, code)
	check(f.invoke("students", "add", "midterm", "defaultstudent"))
	mu.Lock()
	defer mu.Unlock()
	if calls != 3 || reads != 2 {
		t.Error("missing authenticated interface calls", calls, reads)
	}
}

func TestWebStudentEnrollmentDatesOldGatewayRefusesBeforeMutation(t *testing.T) {
	var mu sync.Mutex
	reads, mutations := 0, 0
	f := newScriptCLIFixture(t, func(request map[string]any) (any, string, bool) {
		mu.Lock()
		defer mu.Unlock()
		if request["operation"] == "students.list" {
			reads++
			return map[string]any{"students": []any{}, "next": nil}, "", false
		}
		mutations++
		return nil, "old gateway must never receive date overrides", false
	})
	for _, args := range [][]string{
		{"students", "add", "midterm", "student", "--earliest", "2020-01-02T00:00:00Z", "--latest", "2020-01-03T00:00:00Z"},
		{"students", "add", "midterm", "student", "--definition-revision", strings.Repeat("d", 64)},
	} {
		out, err, code := f.invoke(args...)
		if code != 1 || out != "" || !strings.Contains(err, "update the web server") || !strings.Contains(err, "no enrollment/import was sent") {
			t.Fatal(code, out, err)
		}
	}
	var out strings.Builder
	err, code := f.streams(strings.NewReader("username\nstudent\n"), &out, "students", "import-preview", "midterm", "--file", "-", "--earliest", "2020-01-02T00:00:00Z", "--latest", "2020-01-03T00:00:00Z")
	if code != 1 || out.Len() != 0 || !strings.Contains(err, "no enrollment/import was sent") {
		t.Fatal(code, out.String(), err)
	}
	mu.Lock()
	defer mu.Unlock()
	if reads != 3 || mutations != 0 {
		t.Fatal("old gateway received a mutation", reads, mutations)
	}
}
