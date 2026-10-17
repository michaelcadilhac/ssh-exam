package core

import (
	"strings"
	"testing"
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
	for _, required := range []string{"Welcome to the exam.", "Saved files in /work are collected automatically", "Unsaved editor buffers are not included.", "Deadline: 1792186200000"} {
		if !strings.Contains(message, required) {
			t.Fatalf("timed exam welcome missing %q: %q", required, message)
		}
	}
	if strings.Contains(message, "Practice") || strings.Contains(message, "has not started") {
		t.Fatalf("timed exam incorrectly described as preflight: %q", message)
	}
}
