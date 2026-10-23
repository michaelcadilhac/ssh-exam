package core

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestCancellationCleanupReceiptRequiresCompletedNativeCleanup(t *testing.T) {
	for _, phase := range []string{"invalid-unit", "temporary"} {
		t.Run(phase, func(t *testing.T) {
			e, source := workspaceFixture(t)
			key := commandKeys(t, e)
			e.Config.Accounts["student"] = Account{UID: os.Getuid(), GID: os.Getgid()}
			target := t.TempDir()
			if err := os.WriteFile(filepath.Join(target, "sentinel"), []byte("retain"), 0600); err != nil {
				t.Fatal(err)
			}
			if phase == "invalid-unit" {
				if err := e.WithState(func() error { e.state.Attempts[finalID].Units = []string{"not-an-attempt-scope"}; return nil }); err != nil {
					t.Fatal(err)
				}
			} else if err := os.Symlink(target, filepath.Join(e.Config.State, "temporary")); err != nil {
				t.Fatal(err)
			}
			if _, err := boundCommand(e, key, "cancel-attempt"); err == nil {
				t.Fatal("fixture did not reach native cleanup refusal")
			}
			if err := e.WithState(func() error {
				a := e.state.Attempts[finalID]
				if a.CancellationCleanupComplete || a.Start != 0 || a.Deadline != 0 || a.State != "CANCELLED_BEFORE_START" {
					t.Fatal("failed cleanup advertised release", a)
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			if err := e.WithState(func() error { e.state.Attempts[finalID].Units = nil; return nil }); err != nil {
				t.Fatal(err)
			}
			if phase == "temporary" {
				if err := os.Remove(filepath.Join(e.Config.State, "temporary")); err != nil {
					t.Fatal(err)
				}
			}
			result, err := boundCommand(e, key, "cancel-attempt")
			if err != nil {
				t.Fatal(err)
			}
			a := result.(*Attempt)
			if !a.CancellationCleanupComplete || a.PolicyState != "NORMAL" || a.Start != 0 || a.OriginalDeadline != 0 {
				t.Fatal("complete no-policy cancellation not acknowledged", a)
			}
			restarted, err := New(e.Config)
			if err != nil {
				t.Fatal(err)
			}
			result, err = boundCommand(restarted, key, "inspect-attempt")
			if err != nil || !result.(*Attempt).CancellationCleanupComplete || result.(*Attempt).PolicyState != "NORMAL" {
				t.Fatal("positive cleanup receipt lost on restart", err)
			}
			for path, want := range map[string]string{filepath.Join(target, "sentinel"): "retain", filepath.Join(source, "src", "main.c"): "original starter\n"} {
				data, err := os.ReadFile(path)
				if err != nil || string(data) != want {
					t.Fatal("cancellation changed protected fixture source", path, err)
				}
			}
		})
	}
}

func TestCancellationCleanupDoesNotImplyAppliedAccountRestoration(t *testing.T) {
	e := temporaryFixture(t, "PREPARING", Millis()+5400000)
	if _, err := e.Call("cancel-attempt", Request{ID: finalID}); err != nil {
		t.Fatal(err)
	}
	e.policyRun = func(string, string, string, string) ([]byte, error) {
		return nil, errors.New("synthetic restoration unavailable")
	}
	if err := e.ReconcilePolicies(); err == nil {
		t.Fatal("fixture restoration did not fail")
	}
	if err := e.WithState(func() error {
		a := e.state.Attempts[finalID]
		if !a.CancellationCleanupComplete || a.PolicyState == "NORMAL" || a.Start != 0 {
			t.Fatal("cleanup bit conflated with account restoration", a)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}
