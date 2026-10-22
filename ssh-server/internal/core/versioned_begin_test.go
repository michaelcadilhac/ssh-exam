package core

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestVersionedBeginSignedPurposeRequiresCompleteExactSavedSettingsBeforeChecks(t *testing.T) {
	for _, change := range []string{"missing-version", "wrong-version", "wrong-name", "duration", "webcam", "terminals", "window", "limits", "id", "exam-name"} {
		t.Run(change, func(t *testing.T) {
			e, _, key := boundTemplateFixture(t)
			s, err := readStateSnapshot(e.Config.State)
			if err != nil {
				t.Fatal(err)
			}
			expected := s.Attempts[finalID].Settings
			switch change {
			case "missing-version":
				expected.TemplateVersion = ""
			case "wrong-version":
				expected.TemplateVersion = strings.Repeat("b", 64)
			case "wrong-name":
				expected.Template = "other"
			case "duration":
				expected.Duration++
			case "webcam":
				expected.Webcam = !expected.Webcam
			case "terminals":
				expected.Terminals--
			case "window":
				expected.Latest++
			case "limits":
				expected.CollectionTotalMiB++
			case "id":
				expected.ID = "another"
			case "exam-name":
				expected.Name = "another"
			}
			checks := 0
			e.templateVerify = func(Settings) error { checks++; return nil }
			e.activationPrepare = func(*Attempt) error { checks++; return nil }
			cmd := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "activate-versioned-attempt", Username: "student", Transport: "ssh-a", Body: Request{ID: finalID, Settings: expected}}
			if _, err := e.Command(signedCommand(key, cmd), "student", "ssh-a"); err == nil || !strings.Contains(err.Error(), "settings differ") {
				t.Fatal("bad exact intent did not reach its scoped refusal", err)
			}
			if checks != 0 {
				t.Fatal("bad intent reached OS/material verification", checks)
			}
			a, err := readStateSnapshot(e.Config.State)
			if err != nil {
				t.Fatal(err)
			}
			if a.Attempts[finalID].Start != 0 || a.Attempts[finalID].Settings != s.Attempts[finalID].Settings {
				t.Fatal("refusal changed saved settings or started time")
			}
		})
	}
}

func TestVersionedBeginSignedWorkflowStagesExactBytesAndRetryKeepsOriginalInterval(t *testing.T) {
	e, f, key := boundTemplateFixture(t)
	if _, err := boundCommand(e, key, "prepare-workspace"); err != nil {
		t.Fatal(err)
	}
	s, err := readStateSnapshot(e.Config.State)
	if err != nil {
		t.Fatal(err)
	}
	settings := s.Attempts[finalID].Settings
	cmd := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "activate-versioned-attempt", Username: "student", Transport: "ssh-a", Body: Request{ID: finalID, Settings: settings}}
	result, err := e.Command(signedCommand(key, cmd), "student", "ssh-a")
	if err != nil {
		t.Fatal("actual signed versioned Begin", err)
	}
	first := *result.(*Attempt)
	if first.Start <= 0 || first.Deadline-first.Start != settings.Duration*1000 || first.Settings.TemplateVersion != f.hash {
		t.Fatal("exact interval/source not committed", first.Start, first.Deadline)
	}
	// No new Begin/material verification on a retry after original commit.
	if err := os.Remove(filepath.Join(e.Config.State, "template-catalog", "versions", "midterm", f.hash, "content", "materials", "WELCOME.txt")); err != nil {
		t.Fatal(err)
	}
	cmd.Nonce = Token()
	result, err = e.Command(signedCommand(key, cmd), "student", "ssh-a")
	if err != nil {
		t.Fatal("idempotent versioned retry reverified missing source or restarted", err)
	}
	again := result.(*Attempt)
	if again.Start != first.Start || again.Deadline != first.Deadline || again.OriginalDeadline != first.OriginalDeadline {
		t.Fatal("retry changed interval")
	}
}
