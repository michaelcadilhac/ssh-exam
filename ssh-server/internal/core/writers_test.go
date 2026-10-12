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
