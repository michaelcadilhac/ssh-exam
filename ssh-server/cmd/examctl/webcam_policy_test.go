package main

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
)

func TestWebcamOffHelpAndRefusalsAreDiscoverable(t *testing.T) {
	for _, args := range [][]string{{"web", "help"}, {"web", "students", "help"}, {"web", "grants", "help"}} {
		out, code := cliProcess(t, args...)
		for _, term := range []string{"required|off", "optional", "alias", "off"} {
			if code != 0 || !strings.Contains(out, term) {
				t.Fatalf("missing webcam policy %q: %d %s", term, code, out)
			}
		}
	}
	out, code := cliProcess(t, "web", "grants", "help")
	if code != 0 || !strings.Contains(out, "examctl web exams update") || strings.Contains(out, "--collection-file-mib N") || strings.Contains(out, "--terminals 1..4") {
		t.Fatalf("per-attempt help still offers exam-wide controls: %d %s", code, out)
	}
	shared, sharedCode := cliProcess(t, "web", "help")
	for _, term := range []string{"ALL", "unstarted, setup and running attempts", "existing panes stay open", "freshly verified current file", "web exams show EXAM", "Protected submissions keep"} {
		if sharedCode != 0 || !strings.Contains(shared, term) {
			t.Fatalf("shared live-policy behavior/inspection missing from CLI help: %q %d %s", term, sharedCode, shared)
		}
	}
	for _, args := range [][]string{
		{"web", "exams", "update", "midterm", "--revision", strings.Repeat("a", 64), "--webcam", "sometimes"},
		{"web", "students", "add", "midterm", "student", "--webcam", "sometimes"},
		{"web", "grants", "revise", "11111111-1111-4111-8111-111111111111", "--revision", "1", "--reason", "Explicit camera policy", "--webcam", "sometimes"},
	} {
		out, code := cliProcess(t, args...)
		if code != 2 || !strings.Contains(out, "webcam") || strings.Contains(out, "Load root") {
			t.Fatalf("invalid webcam setting reached authority: %d %s", code, out)
		}
	}
}

func TestWebcamOffAndOptionalAliasActualSignedCLI(t *testing.T) {
	var mu sync.Mutex
	calls := 0
	f := newScriptCLIFixture(t, func(request map[string]any) (any, string, bool) {
		mu.Lock()
		defer mu.Unlock()
		calls++
		body := request["body"].(map[string]any)
		var value any
		switch request["operation"] {
		case "exams.update", "grants.revise":
			value = body["changes"].(map[string]any)["webcam"]
		case "students.add", "students.settings":
			value = body["webcam"]
		case "grants.additional-preview":
			if settings, ok := body["student_settings"].([]any); ok {
				if len(settings) != 1 {
					t.Error("CSV selected another number of students", settings)
				} else {
					value = settings[0].(map[string]any)["webcam"]
				}
			} else {
				value = body["webcam"]
			}
		default:
			t.Error("unexpected management operation", request["operation"])
		}
		if enabled, ok := value.(bool); !ok || enabled {
			t.Error("off/compatibility alias did not preserve the explicit false value", value, body)
		}
		return nil, "Synthetic webcam-off intent reached", false
	})
	const source = "22222222-2222-4222-8222-222222222222"
	const grant = "11111111-1111-4111-8111-111111111111"
	for _, value := range []string{"off", "optional"} {
		preview := []string{"grants", "additional-preview", "midterm", "student", "--duration-minutes", "90", "--definition-revision", strings.Repeat("a", 64), "--template-version", strings.Repeat("b", 64), "--earliest", "2026-11-01T09:00:00-06:00", "--latest", "2026-11-09T09:00:00-06:00", "--reason", "Explicit camera policy", "--webcam", value}
		cases := [][]string{
			{"exams", "update", "midterm", "--revision", strings.Repeat("a", 64), "--webcam", value},
			{"students", "add", "midterm", "student", "--webcam", value},
			{"students", "settings", "midterm", "student", "--webcam", value},
			{"grants", "revise", grant, "--revision", "1", "--reason", "Explicit camera policy", "--webcam", value},
			preview,
			append(append([]string{}, preview...), "--format", "table"),
		}
		csv := filepath.Join(f.dir, "camera-"+value+".csv")
		if err := os.WriteFile(csv, []byte("username,attempt,checksum,require_webcam\nstudent,"+source+","+strings.Repeat("b", 64)+","+value+"\n"), 0600); err != nil {
			t.Fatal(err)
		}
		cases = append(cases, []string{"grants", "additional-preview", "midterm", "--input", csv, "--duration-minutes", "90", "--definition-revision", strings.Repeat("a", 64), "--template-version", strings.Repeat("b", 64), "--earliest", "2026-11-01T09:00:00-06:00", "--latest", "2026-11-09T09:00:00-06:00", "--reason", "Explicit camera policy"})
		for _, args := range cases {
			out, stderr, code := f.invoke(args...)
			if code != 1 || out != "" || !strings.Contains(stderr, "Synthetic webcam-off intent reached") {
				t.Fatalf("off/alias did not reach the signed interface: %d %s %s", code, out, stderr)
			}
		}
	}
	mu.Lock()
	defer mu.Unlock()
	if calls != 14 {
		t.Fatal("missing signed webcam policy calls", calls)
	}
}

func TestLegacyGrantExamSettingFlagsRetainExactSignedRetryIntent(t *testing.T) {
	const requestID = "33333333-3333-4333-8333-333333333333"
	const grant = "11111111-1111-4111-8111-111111111111"
	const reason = "Historical exact exam setting revision"
	expected := map[string]any{"id": grant, "revision": float64(2), "reason": reason, "changes": map[string]any{"terminals": float64(2), "collection_file_mib": float64(128), "collection_total_mib": float64(512), "template": "v1", "template_version": strings.Repeat("a", 64)}}
	var mu sync.Mutex
	calls, lastNonce := 0, ""
	f := newScriptCLIFixture(t, func(request map[string]any) (any, string, bool) {
		mu.Lock()
		defer mu.Unlock()
		calls++
		if request["request"] != requestID || request["operation"] != "grants.revise" || !reflect.DeepEqual(request["body"], expected) {
			t.Error("historical retry intent was rewritten", request)
		}
		nonce, _ := request["nonce"].(string)
		if nonce == "" || nonce == lastNonce {
			t.Error("historical retry reused authentication")
		}
		lastNonce = nonce
		return nil, "Synthetic historical intent reached", false
	})
	args := []string{"grants", "revise", grant, "--revision", "2", "--request", requestID, "--reason", reason, "--terminals", "2", "--collection-file-mib", "128", "--collection-total-mib", "512", "--template", "v1", "--template-version", strings.Repeat("a", 64)}
	for i := 0; i < 2; i++ {
		out, stderr, code := f.invoke(args...)
		if code != 1 || out != "" || !strings.Contains(stderr, "Synthetic historical intent reached") {
			t.Fatalf("historical encoding did not reach the signed interface: %d %s %s", code, out, stderr)
		}
	}
	mu.Lock()
	defer mu.Unlock()
	if calls != 2 {
		t.Fatal("missing original/retry call", calls)
	}
}
