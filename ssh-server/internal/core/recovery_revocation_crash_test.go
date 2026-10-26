package core

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

type recoveryRevocationCrashFixture struct {
	Config                                 Config
	Exam, Username, Review, Phase, Witness string
}

const revocationCrashReason = "Cancel unused synthetic permission before reviewed replacement"

func TestRecoveryRevocationCrashChild(t *testing.T) {
	path := os.Getenv("EXAM_REVOCATION_CRASH_FIXTURE")
	if path == "" {
		return
	}
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || info.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) {
		t.Fatal("unsafe private crash fixture", err)
	}
	data, err := os.ReadFile(path)
	var fixture recoveryRevocationCrashFixture
	if err != nil || json.Unmarshal(data, &fixture) != nil {
		t.Fatal("unavailable private crash fixture", err)
	}
	e := &Engine{Config: fixture.Config}
	e.workspaceCheckpoint = func(phase string) error {
		if phase != fixture.Phase {
			return nil
		}
		file, err := os.OpenFile(fixture.Witness, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			return err
		}
		_, err = file.WriteString(phase)
		if closeErr := file.Close(); err == nil {
			err = closeErr
		}
		if err != nil {
			return err
		}
		if err := syscall.Kill(os.Getpid(), syscall.SIGSTOP); err != nil {
			return err
		}
		t.Fatal("owned crash child unexpectedly continued")
		return nil
	}
	if _, err := e.RevokeRecoveryPermission(fixture.Exam, fixture.Username, fixture.Review, revocationCrashReason); err != nil {
		t.Fatal("crash child refused before its checkpoint", err)
	}
	t.Fatal("crash child never reached the intended publication boundary")
}

func TestRecoveryRevocationProcessCrashesRemainInspectableAndRetryable(t *testing.T) {
	for _, phase := range []string{"revocation-staged", "revocation-audited", "revocation-published", "revocation-before-state-sync", "revocation-synced"} {
		t.Run(phase, func(t *testing.T) {
			e, a, r := recoveryFixture(t)
			preview, err := e.PreviewRecoveryRevocation(r.Exam, r.Username)
			if err != nil || !preview.Eligible {
				t.Fatal("safe unused fixture unavailable", preview, err)
			}
			paths := []string{filepath.Join(e.Config.State, "state.json"), filepath.Join(e.Config.State, "submissions", r.SourceAttempt, "submission.tar.gz")}
			before := make([][]byte, len(paths))
			for i, path := range paths {
				var err error
				before[i], err = os.ReadFile(path)
				if err != nil {
					t.Fatal(err)
				}
			}
			grantPath := filepath.Join(e.Config.State, recoveryName(a))
			original, err := os.ReadFile(grantPath)
			if err != nil {
				t.Fatal(err)
			}
			dir := t.TempDir()
			fixture := recoveryRevocationCrashFixture{Config: e.Config, Exam: r.Exam, Username: r.Username, Review: preview.Review, Phase: phase, Witness: filepath.Join(dir, "reached")}
			encoded, err := json.Marshal(fixture)
			if err != nil {
				t.Fatal(err)
			}
			fixturePath := filepath.Join(dir, "fixture.json")
			if err := os.WriteFile(fixturePath, encoded, 0600); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestRecoveryRevocationCrashChild$")
			command.Env = append(os.Environ(), "EXAM_REVOCATION_CRASH_FIXTURE="+fixturePath, "GORACE=atexit_sleep_ms=0")
			var output bytes.Buffer
			command.Stdout, command.Stderr = &output, &output
			if err := command.Start(); err != nil {
				t.Fatal(err)
			}
			done := make(chan error, 1)
			go func() { done <- command.Wait() }()
			reaped := false
			defer func() {
				if reaped {
					return
				}
				_ = command.Process.Kill() // Only our exact unreaped synthetic child.
				select {
				case <-done:
				case <-time.After(2 * time.Second):
					t.Error("owned crash child did not exit")
				}
			}()
			deadline := time.NewTimer(5 * time.Second)
			defer deadline.Stop()
			tick := time.NewTicker(10 * time.Millisecond)
			defer tick.Stop()
			reached := false
			for !reached {
				select {
				case err := <-done:
					reaped = true
					t.Fatalf("child exited before %s: %v\n%s", phase, err, output.String())
				case <-deadline.C:
					t.Fatal("child did not reach its exact publication checkpoint")
				case <-tick.C:
					witness, err := os.ReadFile(fixture.Witness)
					if os.IsNotExist(err) {
						continue
					}
					if err != nil || string(witness) != phase {
						t.Fatal("wrong crash witness", err, string(witness))
					}
					info, err := os.Lstat(fixture.Witness)
					if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || info.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) {
						t.Fatal("unsafe crash witness", err)
					}
					reached = true
				}
			}
			if err := command.Process.Kill(); err != nil {
				t.Fatal(err)
			}
			err = <-done
			reaped = true
			var exited *exec.ExitError
			if !errors.As(err, &exited) || exited.Sys().(syscall.WaitStatus).Signal() != syscall.SIGKILL {
				t.Fatal("child did not undergo actual owned SIGKILL", err)
			}
			published := phase != "revocation-staged" && phase != "revocation-audited"
			current, err := os.ReadFile(grantPath)
			if err != nil {
				t.Fatal(err)
			}
			decoded, err := decodeRecoveryMetadata(current)
			if err != nil || (decoded.Revocation != nil) != published {
				t.Fatal("crash produced ambiguous authority", err)
			}
			if !published && !bytes.Equal(original, current) {
				t.Fatal("unpublished crash changed old permission")
			}
			if published && !bytes.Equal(original, decoded.Revocation.original) {
				t.Fatal("publication lost original authority bytes")
			}
			restarted := &Engine{Config: e.Config}
			observed, err := restarted.PreviewRecoveryRevocation(r.Exam, r.Username)
			if err != nil || observed.Eligible == published || observed.Review != preview.Review {
				t.Fatal("crash outcome not inspectable", observed, err)
			}
			stateSync := false
			restarted.workspaceCheckpoint = func(at string) error {
				if at == "revocation-before-state-sync" {
					stateSync = true
				}
				return nil
			}
			result, err := restarted.RevokeRecoveryPermission(r.Exam, r.Username, preview.Review, revocationCrashReason)
			if err != nil || result.Disposition != "revoked" || !stateSync {
				t.Fatal("exact retry did not finish both-directory durability", result, err)
			}
			after, err := os.ReadFile(grantPath)
			if err != nil || (published && !bytes.Equal(current, after)) {
				t.Fatal("lost-reply retry changed committed receipt", err)
			}
			for i, path := range paths {
				after, err := os.ReadFile(path)
				if err != nil || !bytes.Equal(before[i], after) {
					t.Fatal("crash/retry changed original interval, holds or protected source", path, err)
				}
			}
			if _, err := os.Stat(grantPath + ".consumed"); !os.IsNotExist(err) {
				t.Fatal("cancellation consumed allowance", err)
			}
		})
	}
}
