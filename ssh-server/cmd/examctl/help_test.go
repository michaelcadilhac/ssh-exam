package main

import (
	"os"
	"os/exec"
	"strings"
	"testing"
)

func TestCLIEntry(t *testing.T) {
	if os.Getenv("EXAMCTL_TEST_ENTRY") != "1" {
		return
	}
	for i, arg := range os.Args {
		if arg == "--" {
			os.Args = append([]string{"examctl"}, os.Args[i+1:]...)
			main()
			os.Exit(0)
		}
	}
	os.Exit(99)
}

func cliProcess(t *testing.T, args ...string) (string, int) {
	t.Helper()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	command := exec.Command(executable, append([]string{"-test.run=^TestCLIEntry$", "--"}, args...)...)
	command.Env = append(os.Environ(), "EXAMCTL_TEST_ENTRY=1", "GORACE=atexit_sleep_ms=0")
	output, err := command.CombinedOutput()
	if err == nil {
		return string(output), 0
	}
	if status, ok := err.(*exec.ExitError); ok {
		return string(output), status.ExitCode()
	}
	t.Fatal(err)
	return "", -1
}

func TestEverySupportedCommandHasDiscoverableProcessHelp(t *testing.T) {
	output, code := cliProcess(t, "help")
	if code != 0 || !strings.Contains(output, "cancel-absent") {
		t.Fatal("root help hides orphan recovery workflow", code, output)
	}
	for topic := range guides {
		t.Run(topic, func(t *testing.T) {
			for _, args := range [][]string{{"help", topic}, {topic, "--config", "/missing/configuration", "--help"}} {
				output, code := cliProcess(t, args...)
				for _, required := range []string{"Usage:", "Examples", "Exit status:", "--config", "root", "Offline"} {
					if code != 0 || !strings.Contains(output, required) {
						t.Fatalf("help failed (%d), missing %q: %s", code, required, output)
					}
				}
			}
		})
	}
}

func TestGrantWorkflowsAreDiscoverableFromCurrentManagementHelp(t *testing.T) {
	for _, entry := range []struct {
		name string
		args []string
	}{{"overview", []string{"help"}}, {"management", []string{"help", "management"}}, {"web", []string{"web", "help"}}} {
		t.Run(entry.name, func(t *testing.T) {
			output, code := cliProcess(t, entry.args...)
			if code != 0 || !strings.Contains(output, "web grants help") {
				t.Fatal("supported grant workflow is hidden from first-time management discovery", code, output)
			}
			if entry.name != "overview" {
				for _, supported := range []string{"empty", "separate-template", "sandbox", "saved-work grant migration"} {
					if !strings.Contains(strings.ToLower(output), supported) {
						t.Fatal("help omits supported source/practice scope or the actual remaining migration", supported, output)
					}
				}
				for _, stale := range []string{"Definition retirement, unified grants, template binding/synchronization", "independent empty/saved-work sources, sandbox grants"} {
					if strings.Contains(output, stale) {
						t.Fatal("help incorrectly reports implemented workflows as missing", stale, output)
					}
				}
			}
		})
	}
}

func TestAttemptHelpExplainsHistoricalGrantAndSourceInspection(t *testing.T) {
	output, code := cliProcess(t, "web", "attempts", "--config", "/missing/configuration", "--help")
	for _, required := range []string{"APPLIED grant revision/hash", "web grants show GRANT", "web attempts show SOURCE-ATTEMPT", "web grants list EXAM --username USER", "not fresh archive verification"} {
		if code != 0 || !strings.Contains(output, required) {
			t.Fatalf("attempt provenance inspection is not discoverable without configuration: %q (%d): %s", required, code, output)
		}
	}
}

func TestInvalidCLIUsagePointsToRelevantHelpBeforeRootOrConfiguration(t *testing.T) {
	for _, args := range [][]string{{"unknown"}, {"delete"}, {"stop", "ATTEMPT"}, {"cancel-absent", "ATTEMPT", "--reason", "Concrete missing identity"}, {"cancel", "ATTEMPT", "--username", "student", "--reason", "Wrong command account flag"}, {"workspace-prepare"}, {"workspace-repair", "ATTEMPT"}, {"recovery-grants", "unexpected-target"}, {"recovery-grants", "--active"}, {"agent", "shutdown"}, {"info", "one", "two"}, {"list", "--wrong-flag"}, {"info", "id", "--output", "file"}} {
		output, code := cliProcess(t, args...)
		if code != 2 || !strings.Contains(output, "help") || strings.Contains(output, "Cannot load") {
			t.Fatalf("misleading syntax result %d: %s", code, output)
		}
	}
	output, code := cliProcess(t, "help", "delete")
	if code != 0 || !strings.Contains(output, "not the exam definition") || !strings.Contains(strings.ToLower(output), "emergency") {
		t.Fatal(output)
	}
	output, code = cliProcess(t, "help", "management")
	if code != 0 || !strings.Contains(output, "do not yet satisfy full coverage") {
		t.Fatal(output)
	}
}

func TestCollectionDiagnosisIsDiscoverableWithoutConfiguration(t *testing.T) {
	output, code := cliProcess(t, "help", "collection")
	for _, required := range []string{"FINALIZING", "pending", "COLLECTION_FAILED", "exam-collection.slice", "256 MiB", "120-second", "examctl retry", "account restrictions", "Exit status:"} {
		if code != 0 || !strings.Contains(output, required) {
			t.Fatalf("missing collection diagnosis %q: %s", required, output)
		}
	}
}

func TestWorkspaceHelpExplainsAtomicConsumptionAndStorageRecovery(t *testing.T) {
	for topic, required := range map[string][]string{
		"workspace-prepare": {"O_TMPFILE", "unpublished", "writable", "not a reservation"},
		"workspace-repair":  {"atomic", "existing markers", "--read-only", "COLLECTION_FAILED"},
	} {
		output, code := cliProcess(t, "help", topic)
		for _, text := range required {
			if code != 0 || !strings.Contains(output, text) {
				t.Fatalf("workspace help missing actionable storage contract %q: %s", text, output)
			}
		}
	}
}
