package core

import (
	"strings"
	"testing"
	"time"
)

func TestPracticeWelcomeHasNoDeadline(t *testing.T) {
	message := terminalWelcome("/work", 0)
	if !strings.Contains(message, "Practice terminal.") || !strings.Contains(message, "The exam clock has not started.") {
		t.Fatalf("practice purpose and clock status missing: %q", message)
	}
	for _, misleading := range []string{"Deadline:", "Welcome to the exam.", "collected automatically", "1970"} {
		if strings.Contains(message, misleading) {
			t.Fatalf("practice welcome includes %q: %q", misleading, message)
		}
	}
}

func TestTimedExamWelcomeKeepsDeadlineAndCollectionNotice(t *testing.T) {
	message := terminalWelcome("/work", 1792186200000)
	for _, required := range []string{"Welcome to the exam.", "Saved files in /work are collected automatically", "Unsaved editor buffers are not included.", "Deadline: Oct 16, 2026 at 4:30:00 PM CDT"} {
		if !strings.Contains(message, required) {
			t.Fatalf("timed exam welcome missing %q: %q", required, message)
		}
	}
	if strings.Contains(message, "1792186200000") || strings.Contains(message, "Practice") || strings.Contains(message, "has not started") {
		t.Fatalf("timed exam incorrectly described as preflight: %q", message)
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
			if message := terminalWelcome("/work", deadline.UnixMilli()); !strings.Contains(message, tc.want) {
				t.Fatalf("incorrect Chicago deadline: %q; expected %q", message, tc.want)
			}
		})
	}
}
