package core

import (
	"crypto/ed25519"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

const preparationID = "22222222-1234-1234-1234-123456789abc"

func preparationFixture(t *testing.T) (*Engine, ed25519.PrivateKey, Request) {
	t.Helper()
	e, _, _ := finalFixture(t, "ACTIVE", Millis()+5400000)
	key := commandKeys(t, e)
	home := t.TempDir()
	putConfig(t, home, ".bashrc", "# retained synthetic configuration\n")
	// Actual copied files belong to this unprivileged fixture UID. The healthy
	// synthetic student has a distinct UID; no UID-wide OS action is exercised.
	e.Config.Accounts["student2"] = Account{UID: os.Getuid(), GID: os.Getgid(), Home: home, Shell: "/bin/bash"}
	e.Config.Accounts["student"] = Account{UID: os.Getuid() + 1, GID: os.Getgid() + 1}
	if err := e.WithState(func() error {
		e.state.Attempts[finalID].Transport = "ssh-a"
		e.state.Attempts[finalID].UID = os.Getuid() + 1
		e.state.Attempts[finalID].Settings.Terminals = 4
		e.state.Registrations["ssh-a"] = "student"
		e.state.Registrations["ssh-b"] = "student2"
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	r := Request{ID: preparationID, Exam: "exam-new", Username: "student2", UID: os.Getuid(), Transport: "ssh-b", Settings: Settings{Duration: 5400, Template: "v1", Terminals: 4, Earliest: Millis() - 1000, Latest: Millis() + 60000}}
	return e, key, r
}

func preparationCommand(r Request) Command {
	return Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "prepare-attempt", Username: r.Username, Transport: r.Transport, Body: r}
}

func TestPrepareAttemptSlowDependenciesLeaveOtherStudentControlsAvailable(t *testing.T) {
	for _, route := range []string{"native", "signed"} {
		for _, phase := range []string{"readiness", "home"} {
			t.Run(route+"/"+phase, func(t *testing.T) {
				e, key, r := preparationFixture(t)
				before, err := readStateSnapshot(e.Config.State)
				if err != nil {
					t.Fatal(err)
				}
				reader, writer, err := os.Pipe()
				if err != nil {
					t.Fatal(err)
				}
				defer reader.Close()
				defer writer.Close()
				entered := make(chan struct{})
				e.preparationReady = func() (bool, []string) { return true, nil }
				block := func() {
					close(entered)
					_, _ = io.Copy(io.Discard, reader)
				}
				if phase == "readiness" {
					e.preparationReady = func() (bool, []string) { block(); return false, []string{"synthetic guard unavailable"} }
				} else {
					e.preparationHome = func(a *Attempt) error { block(); return e.prepareHome(a) }
				}
				done := make(chan error, 1)
				go func() {
					var err error
					if route == "signed" {
						_, err = e.Command(signedCommand(key, preparationCommand(r)), r.Username, r.Transport)
					} else {
						_, err = e.Call("prepare-attempt", r)
					}
					done <- err
				}()
				select {
				case <-entered:
				case <-time.After(2 * time.Second):
					t.Fatal("preparation did not reach the controlled dependency")
				}
				controls := make(chan error, 1)
				go func() {
					for _, op := range []string{"inspect-attempt", "issue-channel-admission", "renew-execution-lease"} {
						cmd := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: op, Username: "student", Transport: "ssh-a", Body: Request{ID: finalID, Username: "student", Transport: "ssh-a", Pane: "33333333-1234-1234-1234-123456789abc"}}
						if _, err := e.Command(signedCommand(key, cmd), "student", "ssh-a"); err != nil {
							controls <- err
							return
						}
					}
					controls <- nil
				}()
				observed := false
				select {
				case err := <-controls:
					observed = true
					if err != nil {
						t.Error("healthy student's signed control failed", err)
					}
				case <-time.After(500 * time.Millisecond):
					t.Error("one preflight's slow dependency blocks another student's signed controls")
				}
				writer.Close()
				select {
				case err := <-done:
					if phase == "readiness" && (err == nil || !strings.Contains(err.Error(), "guard")) {
						t.Error("unavailable readiness admitted preparation", err)
					} else if phase == "home" && err != nil {
						t.Error("safe actual home snapshot did not complete", err)
					}
				case <-time.After(2 * time.Second):
					t.Fatal("preparation did not unwind")
				}
				if !observed {
					select {
					case err := <-controls:
						if err != nil {
							t.Error(err)
						}
					case <-time.After(2 * time.Second):
						t.Fatal("healthy controls did not unwind")
					}
				}
				after, err := readStateSnapshot(e.Config.State)
				if err != nil {
					t.Fatal(err)
				}
				a, b := before.Attempts[finalID], after.Attempts[finalID]
				if a.State != b.State || a.Start != b.Start || a.Deadline != b.Deadline || a.OriginalDeadline != b.OriginalDeadline || a.AccessState != b.AccessState || a.Protected != b.Protected || a.Transport != b.Transport {
					t.Fatal("new preflight changed the healthy attempt's authority/history")
				}
				prepared := after.Attempts[r.ID]
				if phase == "readiness" && (prepared == nil || prepared.State != "CANCELLED_BEFORE_START" || prepared.PreparationPending || prepared.Start != 0 || prepared.Deadline != 0) {
					t.Fatal("unavailable readiness did not retain a cancelled, unstarted preparation")
				}
				if phase == "home" {
					if prepared == nil || prepared.State != "PREPARING" || prepared.PreparationPending || prepared.Start != 0 || prepared.Deadline != 0 {
						t.Fatal("home preparation started time or was not published")
					}
					data, err := os.ReadFile(filepath.Join(e.Config.State, "homes", r.ID, ".bashrc"))
					if err != nil || string(data) != "# retained synthetic configuration\n" {
						t.Fatal("actual home configuration snapshot missing", err)
					}
				}
			})
		}
	}
}

// Used by additional fault cases below; release is safe on both RED and GREEN.
func preparationBarrier(t *testing.T, e *Engine) (<-chan struct{}, func()) {
	t.Helper()
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	e.preparationReady = func() (bool, []string) { close(entered); <-release; return true, nil }
	finish := func() { once.Do(func() { close(release) }) }
	t.Cleanup(finish)
	return entered, finish
}

func TestPrepareAttemptPendingCancellationAndAdmissionFences(t *testing.T) {
	for _, phase := range []string{"readiness", "home"} {
		for _, route := range []string{"native", "signed"} {
			t.Run(phase+"/"+route, func(t *testing.T) {
				e, key, r := preparationFixture(t)
				entered, release := preparationBarrier(t, e)
				if phase == "home" {
					blockedReady := e.preparationReady
					e.preparationReady = func() (bool, []string) { return true, nil }
					e.preparationHome = func(a *Attempt) error { blockedReady(); return e.prepareHome(a) }
				}
				done := make(chan error, 1)
				go func() {
					_, err := e.Command(signedCommand(key, preparationCommand(r)), r.Username, r.Transport)
					done <- err
				}()
				select {
				case <-entered:
				case <-time.After(2 * time.Second):
					t.Fatal("preflight did not reach pending checks")
				}
				for _, op := range []string{"prepare-workspace", "activate-attempt", "issue-channel-admission"} {
					if _, err := e.Call(op, Request{ID: r.ID, Username: r.Username, Transport: r.Transport, Purpose: "practice", Pane: finalID}); err == nil || !strings.Contains(err.Error(), "pending") {
						t.Fatal("pending checks permitted workload/material/clock release", op, err)
					}
				}
				if _, err := e.prepareAccountPolicy(r.ID); err == nil || !strings.Contains(err.Error(), "checks") {
					t.Fatal("pending checks permitted account setup", err)
				}
				var err error
				cancel := Request{ID: r.ID, Reason: "Synthetic student logged out during preflight checks"}
				if route == "native" {
					_, err = e.Call("cancel-attempt", cancel)
				} else {
					cmd := preparationCommand(r)
					cmd.Op, cmd.Body = "cancel-attempt", cancel
					_, err = e.Command(signedCommand(key, cmd), r.Username, r.Transport)
				}
				if err != nil {
					t.Fatal("pending preflight was not cancellable", err)
				}
				release()
				if err := <-done; err == nil || !strings.Contains(err.Error(), "cancelled or changed") {
					t.Fatal("late checks revived cancelled preparation", err)
				}
				state, err := readStateSnapshot(e.Config.State)
				if err != nil {
					t.Fatal(err)
				}
				a := state.Attempts[r.ID]
				if a.State != "CANCELLED_BEFORE_START" || a.Reason != cancel.Reason || a.Start != 0 || a.Deadline != 0 || a.OriginalDeadline != 0 || a.Workspace != nil {
					t.Fatal("late preflight replaced cancellation/history or started time")
				}
				if err := workloadAllowed(a, "practice"); err == nil {
					t.Fatal("cancelled pending preflight could run practice")
				}
			})
		}
	}
}

func TestPrepareAttemptRechecksCurrentRegistrationAccountAndReservation(t *testing.T) {
	for _, change := range []string{"registration", "account", "reservation", "settings"} {
		t.Run(change, func(t *testing.T) {
			e, key, r := preparationFixture(t)
			entered, release := preparationBarrier(t, e)
			done := make(chan error, 1)
			go func() {
				_, err := e.Command(signedCommand(key, preparationCommand(r)), r.Username, r.Transport)
				done <- err
			}()
			<-entered
			if err := e.WithState(func() error {
				switch change {
				case "registration":
					delete(e.state.Registrations, r.Transport)
				case "account":
					// No concurrent reader touches Config while the owned barrier
					// is held; closing release synchronizes the new observation.
					a := e.Config.Accounts[r.Username]
					a.Shell = "/bin/sh"
					e.Config.Accounts[r.Username] = a
				case "reservation":
					e.state.Attempts["44444444-1234-1234-1234-123456789abc"] = &Attempt{ID: "44444444-1234-1234-1234-123456789abc", UID: r.UID, State: "PREPARING"}
				case "settings":
					e.state.Attempts[r.ID].Settings.Duration++
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			release()
			if err := <-done; err == nil {
				t.Fatal("stale preflight checks published ready preparation", change)
			}
			state, err := readStateSnapshot(e.Config.State)
			if err != nil {
				t.Fatal(err)
			}
			a := state.Attempts[r.ID]
			if (a.State == "PREPARING" && !a.PreparationPending) || a.Start != 0 || a.Deadline != 0 || a.OriginalDeadline != 0 {
				t.Fatal("changed preflight became ready or started time")
			}
		})
	}
}

func TestPrepareAttemptRejectsUntrustedRequestsBeforeSlowDependencies(t *testing.T) {
	e, key, r := preparationFixture(t)
	var calls atomic.Int32
	e.preparationReady = func() (bool, []string) { calls.Add(1); return true, nil }
	e.preparationHome = func(*Attempt) error { calls.Add(1); return nil }
	for _, bad := range []string{"signature", "transport", "uid", "username", "id", "settings", "unregistered"} {
		cmd := preparationCommand(r)
		peer, transport := r.Username, r.Transport
		switch bad {
		case "transport":
			transport = "other"
		case "uid":
			cmd.Body.UID++
		case "username":
			cmd.Body.Username = "other"
		case "id":
			cmd.Body.ID = "invalid"
		case "settings":
			cmd.Body.Settings.Duration = 0
		case "unregistered":
			cmd.Transport, cmd.Body.Transport, transport = "unregistered", "unregistered", "unregistered"
		}
		frame := signedCommand(key, cmd)
		if bad == "signature" {
			frame.Signature = "invalid"
		}
		if _, err := e.Command(frame, peer, transport); err == nil {
			t.Fatal("untrusted preparation accepted", bad)
		}
	}
	if calls.Load() != 0 {
		t.Fatal("untrusted request reached slow readiness/home dependency")
	}
	if err := e.WithState(func() error { _, err := e.callLocked("prepare-attempt", r); return err }); err == nil {
		t.Fatal("locked fallback restored slow IO")
	}
}

func TestPrepareAttemptNonceExpiryFailureAndRestartRequireFreshChecks(t *testing.T) {
	t.Run("nonce-and-expiry", func(t *testing.T) {
		e, key, r := preparationFixture(t)
		entered, release := preparationBarrier(t, e)
		cmd := preparationCommand(r)
		cmd.Expires = Millis() + 250
		frame := signedCommand(key, cmd)
		done := make(chan error, 1)
		go func() { _, err := e.Command(frame, r.Username, r.Transport); done <- err }()
		<-entered
		for _, target := range []*Engine{e, func() *Engine {
			other, err := New(e.Config)
			if err != nil {
				t.Fatal(err)
			}
			return other
		}()} {
			if _, err := target.Command(frame, r.Username, r.Transport); err == nil || !strings.Contains(err.Error(), "replay") {
				t.Fatal("pending nonce replayed, including after restart", err)
			}
		}
		for Millis() <= cmd.Expires {
			time.Sleep(5 * time.Millisecond)
		}
		release()
		if err := <-done; err == nil || !strings.Contains(err.Error(), "expired") {
			t.Fatal("expired checks published a preparation", err)
		}
	})
	t.Run("home-failure", func(t *testing.T) {
		e, _, r := preparationFixture(t)
		e.preparationReady = func() (bool, []string) { return true, nil }
		cause := errors.New("synthetic disk write failure")
		e.preparationHome = func(*Attempt) error { return cause }
		if _, err := e.Call("prepare-attempt", r); !errors.Is(err, cause) {
			t.Fatal("home preparation lost its IO cause", err)
		}
		state, _ := readStateSnapshot(e.Config.State)
		if a := state.Attempts[r.ID]; a.State != "CANCELLED_BEFORE_START" || a.PreparationPending || a.Start != 0 || a.Deadline != 0 {
			t.Fatal("failed home checks admitted or started work")
		}
	})
	t.Run("restart-and-idempotent-retry", func(t *testing.T) {
		e, _, r := preparationFixture(t)
		started := Millis() - 1000
		if err := e.WithState(func() error {
			e.state.Attempts[r.ID] = &Attempt{ID: r.ID, Exam: r.Exam, Username: r.Username, UID: r.UID, State: "PREPARING", PreparationPending: true, PreflightStartedAt: started, Transport: r.Transport, Settings: r.Settings, WorkPath: "/work"}
			return nil
		}); err != nil {
			t.Fatal(err)
		}
		restarted, err := New(e.Config)
		if err != nil {
			t.Fatal(err)
		}
		var checks atomic.Int32
		restarted.preparationReady = func() (bool, []string) { checks.Add(1); return true, nil }
		result, err := restarted.Call("prepare-attempt", r)
		if err != nil || result.(*Attempt).PreparationPending || result.(*Attempt).PreflightStartedAt != started {
			t.Fatal("restart trusted pending checks, reset timer or failed fresh preparation", err)
		}
		if _, err := restarted.Call("prepare-attempt", r); err != nil || checks.Load() != 1 {
			t.Fatal("ready retry changed the existing workflow", err)
		}
	})
}

func TestPrepareAttemptPendingReadinessExpiresAfterCrashWithoutStartingExamClock(t *testing.T) {
	e, _, r := preparationFixture(t)
	since := Millis() - PreflightTimeoutMillis - 1
	if err := e.WithState(func() error {
		e.state.Attempts[r.ID] = &Attempt{ID: r.ID, Exam: r.Exam, Username: r.Username, UID: r.UID, State: "PREPARING", PreparationPending: true, PreparationPendingSince: since, Transport: r.Transport, Settings: r.Settings}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	restarted, err := New(e.Config)
	if err != nil {
		t.Fatal(err)
	}
	if err := restarted.Tick(); err != nil {
		t.Fatal(err)
	}
	state, err := readStateSnapshot(e.Config.State)
	if err != nil {
		t.Fatal(err)
	}
	a := state.Attempts[r.ID]
	if a.State != "CANCELLED_BEFORE_START" || a.PreparationPending || a.PreparationPendingSince != 0 || a.PreflightStartedAt != 0 || a.Start != 0 || a.Deadline != 0 || a.OriginalDeadline != 0 || a.Reason != PreflightExpiredReason {
		t.Fatal("crashed readiness reserved the account forever, started a timer or lost expiry history")
	}
}
