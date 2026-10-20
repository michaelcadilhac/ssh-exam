package core

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestScopeRemovalRaceDoesNotReportCollectionFailure(t *testing.T) {
	base := filepath.Join(t.TempDir(), "scope")
	os.Mkdir(base, 0700)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	err := terminateRecordedScope(ctx, base, "exam-test.scope", func(_ context.Context, args ...string) error {
		if args[0] == "kill" {
			return os.Remove(base)
		}
		return errors.New("Unit not loaded")
	})
	if err != nil {
		t.Fatalf("already removed scope falsely failed: %v", err)
	}
}

func TestTerminationCommandsCannotSecureStillPresentScope(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	err := terminateRecordedScope(ctx, t.TempDir(), "exam-test.scope", func(context.Context, ...string) error { return nil })
	if err == nil {
		t.Fatal("successful command exit falsely confirmed termination")
	}
}

func TestStoppedEmptyFrozenScopeDoesNotRequireDirectoryRemoval(t *testing.T) {
	base := t.TempDir()
	os.WriteFile(filepath.Join(base, "cgroup.events"), []byte("populated 0\nfrozen 1\n"), 0600)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := terminateRecordedScope(ctx, base, "exam-test.scope", func(context.Context, ...string) error { t.Fatal("empty scope must not wait for systemctl"); return nil }); err != nil {
		t.Fatal(err)
	}
}

func TestEmptyDirectProcessListDoesNotHideDescendantWriters(t *testing.T) {
	base := t.TempDir()
	os.WriteFile(filepath.Join(base, "cgroup.procs"), nil, 0600)
	os.WriteFile(filepath.Join(base, "cgroup.events"), []byte("populated 1\nfrozen 1\n"), 0600)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	if err := terminateRecordedScope(ctx, base, "exam-test.scope", func(context.Context, ...string) error { return nil }); err == nil {
		t.Fatal("descendant writers incorrectly declared stopped")
	}
}

func TestMalformedPopulationFailsClosed(t *testing.T) {
	for _, content := range []string{"frozen 1\n", "populated unknown\n"} {
		base := t.TempDir()
		os.WriteFile(filepath.Join(base, "cgroup.events"), []byte(content), 0600)
		if empty, err := emptyRecordedScope(base); err == nil || empty {
			t.Fatal("malformed population accepted")
		}
	}
}
