package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestExamWelcomeStaysOutsideBoundedReadyProtocol(t *testing.T) {
	result, err := json.Marshal(map[string]any{"directory": "/work", "deadline": 1792186200000, "proof": map[string]string{"signature": "unchanged"}, "welcome": strings.Repeat("x", maxWelcomeBytes)})
	if err != nil {
		t.Fatal(err)
	}
	ready, err := terminalReadyResponse(result)
	if err != nil {
		t.Fatal(err)
	}
	if len(ready) >= 8192 || strings.Contains(string(ready), "welcome") || !strings.Contains(string(ready), `"signature":"unchanged"`) || !strings.Contains(string(ready), `"directory":"/work"`) {
		t.Fatalf("readiness corrupted by banner: %s", ready)
	}
}

func TestPracticeWelcomeHasNoDeadline(t *testing.T) {
	// Even a timed attempt's materials must never leak into practice.
	base, a := welcomeFixture(t, "Secret exam material [DEADLINE]")
	message, err := terminalWelcome(Config{Templates: base}, a, true)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(message, "Practice terminal.") || !strings.Contains(message, "The exam clock has not started.") {
		t.Fatalf("practice purpose and clock status missing: %q", message)
	}
	for _, misleading := range []string{"Secret", "Deadline:", "Welcome to the exam.", "collected automatically", "1970"} {
		if strings.Contains(message, misleading) {
			t.Fatalf("practice welcome includes %q: %q", misleading, message)
		}
	}
}

func welcomeFixture(t *testing.T, content string) (string, *Attempt) {
	t.Helper()
	base := t.TempDir()
	dir := filepath.Join(base, "template-v1", "materials")
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "WELCOME.txt"), []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
	return base, &Attempt{Exam: "midterm", Username: "student1", Deadline: 1792186200000, Settings: Settings{Template: "template-v1", Name: "Systems Midterm"}}
}

func TestTimedExamWelcomeReadsTemplateAndReplacesKeywords(t *testing.T) {
	base, a := welcomeFixture(t, "Hello [USER], welcome to [EXAM-NAME].\nDeadline: [DEADLINE]\n[USER] [UNKNOWN]")
	message, err := terminalWelcome(Config{Templates: base}, a, false)
	if err != nil {
		t.Fatal(err)
	}
	want := "\r\nHello student1, welcome to Systems Midterm.\r\nDeadline: Oct 16, 2026 at 4:30:00 PM CDT\r\nstudent1 [UNKNOWN]\r\n"
	if message != want {
		t.Fatalf("got %q, want %q", message, want)
	}
}

func TestExamWelcomeAbsentOrEmptyHasNoHardcodedFallback(t *testing.T) {
	base, a := welcomeFixture(t, "")
	for _, remove := range []bool{false, true} {
		if remove {
			if err := os.Remove(filepath.Join(base, a.Settings.Template, "materials", "WELCOME.txt")); err != nil {
				t.Fatal(err)
			}
		}
		message, err := terminalWelcome(Config{Templates: base}, a, false)
		if err != nil || message != "" {
			t.Fatalf("unexpected banner: %q, %v", message, err)
		}
	}
}

func TestExamWelcomeUsesCurrentMetadataOnEveryPane(t *testing.T) {
	base, a := welcomeFixture(t, "[EXAM-NAME]\r\n[DEADLINE]\r\n")
	a.Settings.Name = "Literal [USER]"
	message, err := terminalWelcome(Config{Templates: base}, a, false)
	if err != nil || !strings.HasPrefix(message, "\r\nLiteral [USER]\r\n") || strings.Contains(message, "\r\r\n") {
		t.Fatalf("replacement was recursive or line endings changed: %q, %v", message, err)
	}
	a.Settings.Name = ""
	a.Deadline += 60000
	message, err = terminalWelcome(Config{Templates: base}, a, false)
	if err != nil || !strings.Contains(message, "midterm\r\n") || !strings.Contains(message, "4:31:00 PM CDT") {
		t.Fatalf("reopened pane has stale metadata: %q, %v", message, err)
	}
}

func TestExamWelcomeUsesChicagoDateAndDaylightSavingTime(t *testing.T) {
	for _, tc := range []struct{ utc, want string }{
		{"2026-01-16T01:05:00Z", "Deadline: Jan 15, 2026 at 7:05:00 PM CST"},
		{"2026-11-01T06:30:00Z", "Deadline: Nov 1, 2026 at 1:30:00 AM CDT"},
		{"2026-11-01T07:30:00Z", "Deadline: Nov 1, 2026 at 1:30:00 AM CST"},
	} {
		t.Run(tc.utc, func(t *testing.T) {
			deadline, err := time.Parse(time.RFC3339, tc.utc)
			if err != nil {
				t.Fatal(err)
			}
			base, a := welcomeFixture(t, "Deadline: [DEADLINE]")
			a.Deadline = deadline.UnixMilli()
			message, err := terminalWelcome(Config{Templates: base}, a, false)
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(message, tc.want) {
				t.Fatalf("incorrect Chicago deadline: %q; expected %q", message, tc.want)
			}
		})
	}
}

func TestExamWelcomeRejectsUnsafeEntriesWithoutReadingThem(t *testing.T) {
	for _, kind := range []string{"symlink", "hardlink", "directory", "fifo", "oversize", "invalid-utf8", "invalid-template"} {
		t.Run(kind, func(t *testing.T) {
			base, a := welcomeFixture(t, "")
			path := filepath.Join(base, a.Settings.Template, "materials", "WELCOME.txt")
			if err := os.Remove(path); err != nil {
				t.Fatal(err)
			}
			var err error
			switch kind {
			case "symlink", "hardlink":
				outside := filepath.Join(t.TempDir(), "private.txt")
				if err = os.WriteFile(outside, []byte("PRIVATE"), 0600); err != nil {
					t.Fatal(err)
				}
				if kind == "symlink" {
					err = os.Symlink(outside, path)
				} else {
					err = os.Link(outside, path)
				}
			case "directory":
				err = os.Mkdir(path, 0755)
			case "fifo":
				err = syscall.Mkfifo(path, 0600)
			case "oversize":
				err = os.WriteFile(path, []byte(strings.Repeat("x", maxWelcomeBytes+1)), 0644)
			case "invalid-utf8":
				err = os.WriteFile(path, []byte{0xff}, 0644)
			case "invalid-template":
				a.Settings.Template = "../outside"
			}
			if err != nil {
				t.Fatal(err)
			}
			if message, err := terminalWelcome(Config{Templates: base}, a, false); err == nil || message != "" {
				t.Fatalf("unsafe welcome accepted: %q, %v", message, err)
			}
		})
	}
}
