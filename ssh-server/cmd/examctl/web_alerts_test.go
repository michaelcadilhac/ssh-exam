package main

import (
	"strings"
	"testing"
)

func TestAlertsCLIHelpAndSyntaxBeforeConfiguration(t *testing.T) {
	for _, args := range [][]string{{"help", "alerts"}, {"web", "alerts", "help"}, {"web", "alerts", "remind", "--help"}, {"--config", "/missing", "web", "alerts", "--help"}} {
		out, code := cliProcess(t, args...)
		for _, want := range []string{"Usage:", "OUTBOX_UUID", "EPISODE_UUID", "--revision", "--reason", "managementOperations", "delivered=false", "SMTP", "NEW", "Exit status:"} {
			if code != 0 || !strings.Contains(out, want) {
				t.Fatal("missing alert help", want, code, out)
			}
		}
	}
	for _, args := range [][]string{
		{"web", "alerts"}, {"web", "alerts", "unknown"},
		{"web", "alerts", "list", "EXTRA"}, {"web", "alerts", "list", "--status", "unknown"},
		{"web", "alerts", "list", "--limit", "201"}, {"web", "alerts", "list", "--after", "help"},
		{"web", "alerts", "show", "bad"}, {"web", "alerts", "remind", "12345678-1234-4234-8234-123456789abc"},
		{"web", "alerts", "test", "--reason", "No implicit new operation"},
		{"web", "alerts", "test", "--request", "bad"},
	} {
		out, code := cliProcess(t, args...)
		if code != 2 || !strings.Contains(out, "alerts help") || strings.Contains(out, "Load root") {
			t.Fatal("unactionable alert syntax", code, out)
		}
	}
}
