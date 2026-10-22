package core

// Actual process death through the public workspace/Begin/repair workflows.
// Account/OS admission and writer hooks are explicitly fake; no host user,
// service or real student's workspace is controlled by these tests.
import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestSavedWorkspaceProcessDeathPreservesIntervalAndOneUse(t *testing.T) {
	testSavedWorkspaceProcessDeath(t, false)
}

func TestSavedWorkspaceProcessDeathWatchdogBeforeRepair(t *testing.T) {
	testSavedWorkspaceProcessDeath(t, true)
}

func testSavedWorkspaceProcessDeath(t *testing.T, watchdogFirst bool) {
	t.Helper()
	cli, cliConfig, signingKey := workspaceCrashCompiledCLI(t)
	for _, phase := range []string{"copied", "published-private", "start-committed", "recovery-consumed", "work-published", "initialized"} {
		t.Run(phase, func(t *testing.T) {
			e, target, grant := recoveryFixture(t)
			e.Config.AgentID, e.Config.CallbackURL = cliConfig.AgentID, cliConfig.CallbackURL
			e.Config.Rootfs, e.Config.Templates = cliConfig.Rootfs, cliConfig.Templates
			e.Config.GatewayPublicKey, e.Config.CallbackKey = cliConfig.GatewayPublicKey, cliConfig.CallbackKey
			account := e.Config.Accounts["student"]
			account.Home, account.Shell = e.Config.Work, "/bin/bash"
			e.Config.Accounts["student"] = account
			healthyID := ManagementID()
			healthy := &Attempt{ID: healthyID, Exam: "peer", Username: "healthy", UID: os.Getuid() + 10000, State: "ACTIVE", Transport: "ssh-healthy", Generation: 7, Start: Millis(), Deadline: Millis() + 3600000, OriginalDeadline: Millis() + 3600000, Lease: Millis() + 15000, Boot: boot(), UptimeDeadline: uptime() + 3600}
			e.Config.Accounts["healthy"] = Account{UID: healthy.UID, GID: os.Getgid() + 10000, Home: e.Config.Work, Shell: "/bin/bash"}
			target.PreflightStartedAt, target.Transport = Millis(), "ssh-target"
			target.Settings.Earliest, target.Settings.Latest, target.Settings.Terminals = Millis()-1000, Millis()+600000, 4
			if err := e.WithState(func() error {
				e.state.Attempts[target.ID] = target
				e.state.Attempts[healthyID] = healthy
				e.state.Registrations[target.Transport] = target.Username
				e.state.Registrations[healthy.Transport] = healthy.Username
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			renewals := 0
			maxRenewal := time.Duration(0)
			renewHealthy := func() error {
				cmd := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "renew-execution-lease", Username: healthy.Username, Transport: healthy.Transport, Body: Request{ID: healthyID}}
				at := time.Now()
				value, err := e.Command(signedCommand(signingKey, cmd), healthy.Username, healthy.Transport)
				elapsed := time.Since(at)
				if elapsed > maxRenewal {
					maxRenewal = elapsed
				}
				if err != nil {
					return err
				}
				a := value.(*Attempt)
				if elapsed > time.Second || a.State != "ACTIVE" || a.Lease != 0 || a.Generation != healthy.Generation || a.Transport != "" || a.Deadline != healthy.Deadline || a.OriginalDeadline != healthy.OriginalDeadline {
					return fmt.Errorf("crash/repair interrupted healthy signed authority (%s)", elapsed)
				}
				state, err := readStateSnapshot(e.Config.State)
				if err != nil {
					return err
				}
				current := state.Attempts[healthyID]
				if current == nil || current.Transport != healthy.Transport || state.Registrations[healthy.Transport] != healthy.Username {
					return errors.New("healthy persisted ownership changed; public receipts must keep transport private")
				}
				if err := e.applyExecutionLease(current); err != nil || current.Lease <= Millis() {
					return errors.New("healthy journal lost its current execution lease")
				}
				renewals++
				return nil
			}
			archive := filepath.Join(e.Config.State, "submissions", grant.SourceAttempt, "submission.tar.gz")
			originalArchive, err := os.ReadFile(archive)
			if err != nil {
				t.Fatal(err)
			}
			manifestPath := filepath.Join(e.Config.State, "submissions", grant.SourceAttempt, "manifest.json")
			originalManifest, err := os.ReadFile(manifestPath)
			if err != nil {
				t.Fatal(err)
			}
			originalState, err := readStateSnapshot(e.Config.State)
			if err != nil {
				t.Fatal(err)
			}
			originalSource := *originalState.Attempts[grant.SourceAttempt]
			assertSourceUnchanged := func() {
				t.Helper()
				for path, expected := range map[string][]byte{archive: originalArchive, manifestPath: originalManifest} {
					if data, err := os.ReadFile(path); err != nil || !bytes.Equal(data, expected) {
						t.Fatal("crash/retry/repair changed protected source bytes", err)
					}
				}
				state, err := readStateSnapshot(e.Config.State)
				if err != nil {
					t.Fatal(err)
				}
				source := state.Attempts[grant.SourceAttempt]
				if source == nil || !protectedIdentity(source, &originalSource) || source.State != originalSource.State || source.Protected != originalSource.Protected || source.Checksum != originalSource.Checksum || source.AccessState != originalSource.AccessState {
					t.Fatal("crash/retry/repair changed protected source identity/interval/hold")
				}
			}
			unstarted := phase == "copied" || phase == "published-private"
			if !unstarted {
				if _, err := e.Call("prepare-workspace", Request{ID: target.ID}); err != nil {
					t.Fatal(err)
				}
			}
			configPath := filepath.Join(t.TempDir(), "child-config.json")
			config, _ := json.Marshal(e.Config)
			if err := os.WriteFile(configPath, config, 0600); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
			defer cancel()
			child := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestSavedWorkspaceCrashChild$", "--", configPath, target.ID, phase)
			child.Env = append(os.Environ(), "EXAM_SAVED_WORKSPACE_CRASH_CHILD=1", "GORACE=atexit_sleep_ms=0")
			var childOutput bytes.Buffer
			child.Stdout, child.Stderr = &childOutput, &childOutput
			if err := child.Start(); err != nil {
				t.Fatal(err)
			}
			controlErr := renewHealthy() // Independent signed path while the child runs/dies.
			err = child.Wait()           // Always reap our exact child before reporting errors.
			out := childOutput.Bytes()
			if controlErr != nil {
				t.Fatal("child death interrupted healthy peer", controlErr)
			}
			exit, ok := err.(*exec.ExitError)
			if ctx.Err() != nil || !ok {
				t.Fatal("workspace child did not die at the requested boundary", err, string(out))
			}
			status, ok := exit.Sys().(syscall.WaitStatus)
			entered, enteredErr := os.ReadFile(filepath.Join(e.Config.State, "synthetic-crash-phase"))
			if !ok || !status.Signaled() || status.Signal() != syscall.SIGKILL || enteredErr != nil || string(entered) != phase {
				t.Fatal("requested real crash boundary was not exercised", err, enteredErr, string(entered), string(out))
			}
			saved, err := readStateSnapshot(e.Config.State)
			if err != nil {
				t.Fatal(err)
			}
			before := *saved.Attempts[target.ID]
			claimPath := filepath.Join(e.Config.State, recoveryName(target)+".consumed")
			claim, claimErr := os.ReadFile(claimPath)
			if unstarted {
				if before.Start != 0 || before.Deadline != 0 || before.OriginalDeadline != 0 || before.Lease != 0 || !os.IsNotExist(claimErr) {
					t.Fatal("pre-Begin child death consumed an allowance or interval", claimErr)
				}
			} else {
				if before.State != "ACTIVATING" || before.Start <= 0 || before.Deadline-before.Start != grant.Duration*1000 || before.OriginalDeadline != before.Deadline || before.AccessState != "HELD" {
					t.Fatal("committed interval/hold lost at process death", before.State, before.Start, before.Deadline)
				}
				if phase == "start-committed" {
					if !os.IsNotExist(claimErr) {
						t.Fatal("start-commit fixture passed the consumption boundary", claimErr)
					}
				} else if claimErr != nil || string(claim) != target.ID {
					t.Fatal("grant consumption did not bind the original attempt", claimErr)
				}
			}
			restarted, err := New(e.Config)
			if err != nil {
				t.Fatal(err)
			}
			// Explicitly avoid real host OS/account control in every fresh Engine.
			restarted.quiesce, restarted.terminate = func(*Attempt) error { return nil }, func(*Attempt) error { return nil }
			restarted.activationPrepare = func(*Attempt) error { return nil }
			restarted.cutoff = func(*Attempt) error { return nil }
			if watchdogFirst {
				if err := restarted.Tick(); err != nil {
					t.Fatal("native watchdog failed after actual publication process death", err)
				}
				if err := renewHealthy(); err != nil {
					t.Fatal(err)
				}
				if phase == "work-published" || phase == "initialized" {
					// Work is already collectable. The watchdog may secure it without
					// an operator repairing an otherwise obsolete publication marker.
					after, err := readStateSnapshot(e.Config.State)
					if err != nil {
						t.Fatal(err)
					}
					a := after.Attempts[target.ID]
					if a.State != "COMPLETED" || !a.Protected || a.Start != before.Start || a.Deadline != before.Deadline || a.OriginalDeadline != before.OriginalDeadline || a.AccessState != before.AccessState || a.Lease != 0 {
						t.Fatal("watchdog lost published bytes/original interval/hold")
					}
					manifest, err := ReadProtected(filepath.Join(e.Config.State, "submissions", target.ID), a)
					if err != nil || len(manifest.Files) != 1 || manifest.Files[0].Path != "answer.txt" || manifest.Files[0].Hash != Hash([]byte("saved answer")) {
						t.Fatal("watchdog reported unverified protection", err)
					}
					if _, err := restarted.Admin("workspace-repair", target.ID, "Refuse repair of already secured publication"); err == nil {
						t.Fatal("completed watchdog result accepted workspace repair")
					}
					if cli != "" {
						ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
						command := exec.CommandContext(ctx, "/usr/bin/unshare", "--user", "--map-root-user", cli, "--config", configPath, "workspace-repair", target.ID, "--reason", "Refuse repair of already secured publication")
						out, err := command.CombinedOutput()
						cancel()
						if err == nil || !strings.Contains(string(out), "workspace repair only supports interrupted committed activation") {
							t.Fatal("actual root CLI did not refuse completed publication repair", err, string(out))
						}
					}
					assertSourceUnchanged()
					t.Logf("native watchdog secured published saved work after child SIGKILL; healthy renewals=%d max=%s; OS writer/admission guards fake", renewals, maxRenewal)
					return
				}
			}
			if unstarted {
				if _, err := restarted.Admin("workspace-prepare", target.ID, ""); err != nil {
					t.Fatal("unstarted saved source could not be retried after death", err)
				}
				assertUnstartedWorkspace(t, restarted, target.ID)
				if _, err := os.Stat(claimPath); !os.IsNotExist(err) {
					t.Fatal("unstarted retry consumed the allowance", err)
				}
				if err := renewHealthy(); err != nil {
					t.Fatal(err)
				}
			} else {
				// Even without the consumed marker, the committed-start fence must
				// refuse a fresh attempt ID. Never reset that fence as a repair.
				if err := restarted.WithState(func() error {
					other := before
					other.ID, other.Start, other.Deadline, other.OriginalDeadline = retryRecoveryID, 0, 0, 0
					other.State = "PREPARING"
					if _, err := restarted.recoveryReference(&other); err == nil {
						t.Error("crashed committed allowance could be reused by a new attempt")
					}
					return nil
				}); err != nil {
					t.Fatal(err)
				}
				answer := filepath.Join(e.Config.Work, target.ID, "work", "answer.txt")
				retained := "saved answer"
				if phase == "work-published" || phase == "initialized" {
					retained = "retained edits after publication"
					if err := os.WriteFile(answer, []byte(retained), 0600); err != nil {
						t.Fatal(err)
					}
				}
				if cli != "" {
					ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
					command := exec.CommandContext(ctx, "/usr/bin/unshare", "--user", "--map-root-user", cli, "--config", configPath, "workspace-repair", target.ID, "--reason", "Recover only the original committed publication")
					out, err := command.CombinedOutput()
					cancel()
					var repaired Attempt
					if err != nil || json.Unmarshal(out, &repaired) != nil || repaired.State != "COLLECTION_FAILED" || repaired.Start != before.Start || repaired.Deadline != before.Deadline || repaired.Lease != 0 {
						t.Fatal("actual compiled root CLI repair failed or reopened work", err, string(out))
					}
				}
				if _, err := restarted.Admin("workspace-repair", target.ID, "Recover only the original committed publication"); err != nil {
					t.Fatal("supported repair failed after process death", err)
				}
				after, err := readStateSnapshot(e.Config.State)
				if err != nil {
					t.Fatal(err)
				}
				a := after.Attempts[target.ID]
				if a.State != "COLLECTION_FAILED" || a.Start != before.Start || a.Deadline != before.Deadline || a.OriginalDeadline != before.OriginalDeadline || a.AccessState != before.AccessState || a.Lease != 0 || a.Authorization != 0 {
					t.Fatal("repair reopened work, reset time or released its hold")
				}
				if data, err := os.ReadFile(answer); err != nil || string(data) != retained {
					t.Fatal("repair replaced published edits or lost saved bytes", err)
				}
				if err := renewHealthy(); err != nil {
					t.Fatal(err)
				}
				// A retry may return the original started result idempotently;
				// successful transport is not permission to reopen a failed attempt.
				if result, err := restarted.Admin("start", target.ID, "Inspect original start without reopening recovery"); err == nil {
					a := result.(*Attempt)
					if a.State != "COLLECTION_FAILED" || a.Start != before.Start || a.Deadline != before.Deadline || a.Lease != 0 {
						t.Fatal("start retry reopened the original interval")
					}
				}
				if _, err := restarted.Admin("retry", target.ID, "Secure the repaired original interval"); err != nil {
					t.Fatal("explicit protected collection after repair failed", err)
				}
				after, err = readStateSnapshot(e.Config.State)
				if err != nil || !after.Attempts[target.ID].Protected || after.Attempts[target.ID].State != "COMPLETED" || after.Attempts[target.ID].Start != before.Start || after.Attempts[target.ID].OriginalDeadline != before.OriginalDeadline || after.Attempts[target.ID].AccessState != before.AccessState {
					t.Fatal("post-repair collection lost original interval/protection/hold", err)
				}
				manifest, err := ReadProtected(filepath.Join(e.Config.State, "submissions", target.ID), after.Attempts[target.ID])
				if err != nil || len(manifest.Files) != 1 || manifest.Files[0].Path != "answer.txt" || manifest.Files[0].Hash != Hash([]byte(retained)) {
					t.Fatal("post-repair archive lost retained saved bytes", err)
				}
				if err := renewHealthy(); err != nil {
					t.Fatal(err)
				}
			}
			assertSourceUnchanged()
			t.Logf("healthy signed renewals=%d maximum=%s; actual child SIGKILL and saved bytes/interval/hold fences verified; OS writer/admission guards fake", renewals, maxRenewal)
		})
	}
}

func workspaceCrashCompiledCLI(t *testing.T) (string, Config, ed25519.PrivateKey) {
	t.Helper()
	dir := t.TempDir()
	c := Config{AgentID: "class", CallbackURL: "https://unused.example.edu", Rootfs: dir, Templates: dir, GatewayPublicKey: filepath.Join(dir, "gateway.pub"), CallbackKey: filepath.Join(dir, "callback.key")}
	pub, gatewayKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	public, _ := x509.MarshalPKIXPublicKey(pub)
	private, _ := x509.MarshalPKCS8PrivateKey(key)
	for path, data := range map[string][]byte{c.GatewayPublicKey: pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: public}), c.CallbackKey: pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: private})} {
		if err := os.WriteFile(path, data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	if os.Getenv("EXAM_MANAGEMENT_USERNS") != "1" || os.Getuid() < 1000 || os.Getgid() < 1000 {
		t.Log("actual root CLI leg requires explicit private namespace qualification from an ordinary UID; not qualified by this run")
		return "", c, gatewayKey
	}
	binary := filepath.Join(dir, "examctl")
	build := exec.Command("go", "build", "-o", binary, "./cmd/examctl")
	build.Dir = filepath.Join("..", "..")
	build.Env = append(os.Environ(), "CGO_ENABLED=0")
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatal("compile actual workspace-repair CLI", err, string(out))
	}
	t.Log("actual compiled root CLI repair enabled in private user namespace; no host account/manager action")
	return binary, c, gatewayKey
}

func TestSavedWorkspaceCrashChild(t *testing.T) {
	if os.Getenv("EXAM_SAVED_WORKSPACE_CRASH_CHILD") != "1" {
		t.Skip("private process-death child only")
	}
	args := os.Args[len(os.Args)-3:]
	data, err := os.ReadFile(args[0])
	var config Config
	if err != nil || json.Unmarshal(data, &config) != nil || !attemptID.MatchString(args[1]) {
		t.Fatal("invalid private crash fixture")
	}
	e, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	e.activationPrepare = func(*Attempt) error { return nil }
	e.quiesce, e.terminate = func(*Attempt) error { return nil }, func(*Attempt) error { return nil }
	e.workspaceCheckpoint = func(phase string) error {
		if phase == args[2] {
			if err := os.WriteFile(filepath.Join(config.State, "synthetic-crash-phase"), []byte(phase), 0600); err != nil {
				return err
			}
			return syscall.Kill(os.Getpid(), syscall.SIGKILL) // Only this disposable child.
		}
		return nil
	}
	op := "activate-attempt"
	if strings.Contains(args[2], "private") || args[2] == "copied" {
		op = "prepare-workspace"
	}
	if _, err := e.Call(op, Request{ID: args[1]}); err != nil {
		t.Fatal("private workspace workflow failed before requested crash", err)
	}
}
