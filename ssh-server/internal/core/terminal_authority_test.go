package core

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

func TestMonitoredBeginRemainsDisabledBeforeClockAndRequiresOriginalSocket(t *testing.T) {
	e, key, r := initialGrantFixture(t)
	r.GrantBeginIntent = "44444444-1234-4234-8234-123456789abc"
	cmd := preparationCommand(r)
	cmd.Op = "activate-monitored-grant-attempt"
	if _, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport); err == nil || !strings.Contains(err.Error(), "original authenticated") {
		t.Fatal("monitored Begin accepted a JSON/metadata-only caller", err)
	}
	assertUnstartedWorkspace(t, e, r.ID)
	if err := terminalAuthorityReadiness(); err == nil {
		t.Fatal("incomplete retained input/writer workflow was enabled")
	}
}

// Actual signed native Begin -> inherited original socket -> separate bounded
// supervisor -> real pidfd/claim -> authenticated TLS -> durable native ACTIVE.
// Compiled child test seams replace installed root SSH ancestry/qualification;
// Real owned scopes exercise input, kernel hold and retained shell memory.
// This is not installed-root SSH, whole-UID or asynchronous-writer qualification.
func TestActualMonitoredBeginSupervisorBootstrapAndNonrestorableOwnership(t *testing.T) {
	if os.Getenv("EXAM_COLLECTION_USER_SYSTEMD") != "1" || os.Getuid() < 1000 {
		t.Skip("requires explicit owned user-systemd qualification and a synthetic student UID")
	}
	for _, mode := range []string{"current", "roles-unavailable", "roles-exited", "clock-live", "recording-fault", "clock-recording-fault", "recording-fault-replacement", "partial-thaw", "partial-continue", "resume-ack-loss", "delayed-manager", "revoked-before-exec", "revoked-after-save", "pending-resume-cancel", "expired-pending-resume", "native-live-expiry", "ssh-pin-refused", "wrong-bootstrap"} {
		t.Run(mode, func(t *testing.T) {
			previous := terminalAuthorityReadiness
			terminalAuthorityReadiness = func() error { return nil }
			t.Cleanup(func() { terminalAuthorityReadiness = previous })
			e, key, r := initialGrantUnpreparedFixture(t)
			e.nativeRolesProbe = func() (*nativeRoleGuard, error) { return &nativeRoleGuard{}, nil } // Desktop role/group seam; real root profile uses production probing.
			var stopRole func()
			if mode == "roles-unavailable" {
				e.nativeRolesProbe = func() (*nativeRoleGuard, error) { return nil, errNativeRoles }
			}
			if mode == "roles-exited" {
				guard, stop := testNativeRoleLifetime(t)
				stopRole = stop
				e.nativeRolesProbe = func() (*nativeRoleGuard, error) {
					return &nativeRoleGuard{peers: []*monitoringProcessGuard{guard}}, nil
				}
			}
			t.Setenv("EXAM_TEST_REFUSE_RESUME_COMMIT", filepath.Join(e.Config.State, "synthetic-resume-commit-refusal"))
			r.Transport, r.BrowserSSH = strings.Repeat("a", 64), true
			if err := e.WithState(func() error { e.state.Registrations[r.Transport] = r.Username; return nil }); err != nil {
				t.Fatal(err)
			}
			cmd := preparationCommand(r)
			cmd.Op = "prepare-grant-attempt"
			if _, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport); err != nil {
				t.Fatal(err)
			}
			cmd.Op, cmd.Nonce = "prepare-workspace", Token()
			if _, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport); err != nil {
				t.Fatal(err)
			}
			unit := terminalSupervisorUnit(e.Config.State, r.ID)
			stop := func() {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				if out, err := exec.CommandContext(ctx, "/usr/bin/systemctl", "--user", "stop", unit).CombinedOutput(); err != nil {
					t.Error("owned bootstrap owner stop failed", err, string(out))
				}
				_ = exec.CommandContext(ctx, "/usr/bin/systemctl", "--user", "reset-failed", unit).Run()
			}
			if mode != "roles-unavailable" {
				t.Cleanup(stop)
			}
			if mode == "ssh-pin-refused" {
				t.Setenv("EXAM_TEST_REFUSE_SSH_PIN", filepath.Join(e.Config.State, "synthetic-ssh-pin-refusal"))
			}
			var calls atomic.Int32
			var resumeMode atomic.Int32
			var approvalUntil atomic.Int64
			var initialOwner atomic.Pointer[monitoringOwner]
			proofReached := make(chan struct{}, 1)
			captured := make(chan grantBeginReply, 1)
			initialGrantServer(t, e, key, func(reply grantBeginReply) (grantBeginReply, int) {
				calls.Add(1)
				if stopRole != nil {
					stopRole()
				}
				if reply.Type != "grant-begin/v3" || reply.Bootstrap == nil {
					t.Error("actual monitored Begin missed scoped TLS bootstrap")
					return reply, 400
				}
				if mode == "wrong-bootstrap" {
					reply.Bootstrap.Owner.InputEpoch = strings.Repeat("d", 64)
				}
				owner := reply.Bootstrap.Owner
				initialOwner.Store(&owner)
				captured <- reply
				return reply, 200
			}, testLiveCallbacks{Evidence: func(q testMonitoringRequest) (monitoringEvidence, int) {
				select {
				case proofReached <- struct{}{}:
				default:
				}
				return monitoringEvidence{Type: "monitoring-execution-evidence-v1", Audience: q.Agent, Nonce: q.Nonce, Owner: q.Owner, CoverageEpoch: q.CoverageEpoch, Sequence: q.AfterSequence + 1, AgeMS: 0, Complete: true}, 200
			}, Continue: func(q monitoringContinueRequest) (monitoringContinueReply, int) {
				if resumeMode.Load() == 0 {
					return monitoringContinueReply{}, 403
				}
				// Match the REAL gateway's unconsumed authorization contract:
				// its previous registered owner remains older than the proposed
				// generation until native Continue actually succeeds.
				if mode == "partial-thaw" || mode == "partial-continue" {
					original := initialOwner.Load()
					if q.PreviousOwner.Generation >= q.Owner.Generation || (q.Owner.Generation == 1 && (original == nil || q.PreviousOwner != *original)) {
						return monitoringContinueReply{}, 403
					}
				}
				reply := monitoringContinueReply{Type: q.Type, Audience: q.Agent, Nonce: q.Nonce, PreviousOwner: q.PreviousOwner, Owner: q.Owner, AuthorizationExpires: approvalUntil.Load(), Expires: min(Millis()+30000, approvalUntil.Load()), CaptureValidFor: 15000, Bootstrap: &monitoringBootstrap{Type: "monitoring-bootstrap/v1", Owner: q.Owner, CoverageEpoch: strings.Repeat("f", 64), Sequence: 1}}
				switch resumeMode.Load() {
				case 1:
					reply.Owner.InputEpoch = Token()
				case 2:
					reply.Expires = Millis() - 1
				case 3:
					reply.Bootstrap.CoverageEpoch = "invalid"
				}
				return reply, 200
			}})
			t.Cleanup(e.stopTerminalMonitoring)
			listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: filepath.Join(t.TempDir(), "original-begin.sock"), Net: "unix"})
			if err != nil {
				t.Fatal(err)
			}
			defer listener.Close()
			client, err := net.DialUnix("unix", nil, listener.Addr().(*net.UnixAddr))
			if err != nil {
				t.Fatal(err)
			}
			defer client.Close()
			_ = listener.SetDeadline(time.Now().Add(time.Second))
			original, err := listener.AcceptUnix()
			if err != nil {
				t.Fatal(err)
			}
			defer original.Close()
			cmd.Op, cmd.Nonce = "activate-monitored-grant-attempt", Token()
			cmd.Body.GrantBeginIntent, cmd.Body.PageEpoch = "44444444-1234-4234-8234-123456789abc", strings.Repeat("b", 64)
			before := Millis()
			_, err = e.command(signedCommand(key, cmd), r.Username, r.Transport, 0, original)
			expectedCalls := int32(1)
			if mode == "roles-unavailable" || mode == "roles-exited" {
				wantCalls := int32(0)
				if mode == "roles-exited" {
					wantCalls = 1
				}
				if !errors.Is(err, errNativeRoles) || calls.Load() != wantCalls {
					t.Fatal("role refusal missed pre-clock boundary", err, calls.Load())
				}
				assertUnstartedWorkspace(t, e, r.ID)
				if wantCalls == 1 {
					select {
					case <-captured:
					default:
						t.Fatal("exited-role fixture missed its complete authenticated reply")
					}
				}
				e.nativeRolesProbe = func() (*nativeRoleGuard, error) { return &nativeRoleGuard{}, nil } // Repair only this synthetic role fixture.
				if mode == "roles-unavailable" {
					t.Cleanup(stop)
				}
				cmd.Nonce = Token()
				before = Millis()
				_, err = e.command(signedCommand(key, cmd), r.Username, r.Transport, 0, original)
				expectedCalls = wantCalls + 1
			}
			if mode == "ssh-pin-refused" {
				marker, markerErr := os.ReadFile(filepath.Join(e.Config.State, "synthetic-ssh-pin-refusal"))
				if err == nil || markerErr != nil || string(marker) != "original-socket-ssh-pin-reached" || calls.Load() != 0 {
					t.Fatal("refusal missed exact received-socket pin boundary before TLS/time", err, markerErr, calls.Load())
				}
				assertUnstartedWorkspace(t, e, r.ID)
				return
			}
			if calls.Load() != expectedCalls {
				t.Fatal("fixture missed authenticated native TLS stage", calls.Load(), err)
			}
			if mode == "wrong-bootstrap" {
				if err == nil || !strings.Contains(err.Error(), "monitoring evidence") {
					t.Fatal("wrong seed did not reach intended verification refusal", err)
				}
				assertUnstartedWorkspace(t, e, r.ID)
				return
			}
			if err != nil {
				t.Fatal("actual monitored native Begin did not commit its live owner", err)
			}
			state, err := readStateSnapshot(e.Config.State)
			if err != nil {
				t.Fatal(err)
			}
			a := state.Attempts[r.ID]
			if a.State != "ACTIVE" || a.MonitoringMode != "v1" || a.RegisteredOwner == nil || a.Start < before || a.Deadline-a.Start != r.Settings.Duration*1000 || a.OriginalDeadline != a.Deadline {
				t.Fatal("bootstrap changed the original interval or omitted native owner", a)
			}
			view, err := e.callTerminalAuthority(terminalAuthorityRequest{Op: "view", Attempt: a.ID, Owner: *a.RegisteredOwner}, nil, false)
			if err != nil || view.View == nil || !view.View.ExecutionAuthorized || view.View.Sequence != 1 {
				t.Fatal("actual supervisor did not own the fresh native context", view, err)
			}
			reply := <-captured
			if reply.Bootstrap.Owner != *a.RegisteredOwner || view.View.CoverageEpoch != reply.Bootstrap.CoverageEpoch {
				t.Fatal("durable native owner differs from the actual fresh TLS seed")
			}
			// The coordinator cached its credential before committing time. Healthy
			// live renewals must not depend on a private-key disk read afterwards.
			credential, err := os.ReadFile(e.Config.CallbackKey)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.Remove(e.Config.CallbackKey); err != nil {
				t.Fatal(err)
			}
			select {
			case <-proofReached:
			case <-time.After(5 * time.Second):
				t.Fatal("live renewal missed authenticated outbound proof route")
			}
			until := time.Now().Add(2 * time.Second)
			for {
				renewed, err := e.callTerminalAuthority(terminalAuthorityRequest{Op: "view", Attempt: a.ID, Owner: *a.RegisteredOwner}, nil, false)
				if err != nil {
					t.Fatal(err)
				}
				if renewed.View != nil && renewed.View.ExecutionAuthorized && renewed.View.Sequence > 1 {
					break
				}
				if time.Now().After(until) {
					t.Fatal("signed proof reached HTTP but was not accepted by the live supervisor", renewed)
				}
				time.Sleep(10 * time.Millisecond)
			}
			if err := os.WriteFile(e.Config.CallbackKey, credential, 0600); err != nil {
				t.Fatal(err)
			}
			testActualSharedCutoffWatch(t, e, a)
			if mode == "clock-live" || mode == "clock-recording-fault" {
				// The public signed clock operation must use actual live authority,
				// not the deliberately stale durable lease verified just above.
				request := resetRequest(a)
				request.RemainingSeconds, request.ExtendSeconds = 0, 60
				clock := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "reset-clock", Username: a.Username, Transport: a.Transport, Body: request}
				if _, err := e.Command(signedCommand(key, clock), a.Username, a.Transport); err != nil {
					t.Fatal("actual signed clock extension refused healthy live authority because of a stale disk lease", err)
				}
				changed, err := readStateSnapshot(e.Config.State)
				if err != nil {
					t.Fatal(err)
				}
				next := changed.Attempts[a.ID]
				if next.Start != a.Start || next.OriginalDeadline != a.OriginalDeadline || next.Deadline != a.Deadline+60000 || next.ClockRevision != a.ClockRevision+1 || len(next.ClockResets) != 1 || next.State != "ACTIVE" {
					t.Fatal("explicit clock extension lost original authority or changed the allowance twice", next)
				}
				live, err := e.callTerminalAuthority(terminalAuthorityRequest{Op: "view", Attempt: a.ID, Owner: *next.RegisteredOwner}, nil, false)
				if err != nil || live.View == nil || !live.View.ExecutionAuthorized || live.View.DeadlineUptimeMS != int64(next.UptimeDeadline*1000) {
					t.Fatal("applied clock acknowledgement disagrees with actual live owner/deadline", live, err)
				}
				a = next
			}
			testActualMonitoredPaneInput(t, e, key, a, mode, func(mode int32) {
				if mode != 0 && (resumeMode.Load() == 0 || (mode == 4 && resumeMode.Load() != 4)) {
					approvalUntil.Store(Millis() + 60000)
				}
				resumeMode.Store(mode)
			})
			e.stopTerminalMonitoring()
			stop() // Only the exact newly created synthetic supervisor unit.
			control, owner, err := e.connectTerminalSupervisor(a.ID)
			if err != nil {
				t.Fatal("cannot create an empty replacement test owner", err)
			}
			control.Close()
			owner.process.close()
			payload, _ := json.Marshal(reply)
			old := SignedFrame{Payload: base64.StdEncoding.EncodeToString(payload), Signature: base64.StdEncoding.EncodeToString(ed25519.Sign(key, payload))}
			_, err = e.callTerminalAuthority(terminalAuthorityRequest{Op: "commit", Attempt: a.ID, Owner: *a.RegisteredOwner, Nonce: reply.Nonce, Frame: &old, State: a.State, Start: a.Start, Deadline: a.Deadline, OriginalDeadline: a.OriginalDeadline, DeadlineBootMS: int64(a.UptimeDeadline * 1000), VerifiedUntilBootMS: view.View.AuthorityUntilMS}, nil, false)
			if err == nil || !strings.Contains(err.Error(), "scope") {
				t.Fatal("replacement owner restored positive authority from a saved signed receipt", err)
			}
			after, err := readStateSnapshot(e.Config.State)
			if err != nil || after.Attempts[a.ID].Start != a.Start || after.Attempts[a.ID].OriginalDeadline != a.OriginalDeadline {
				t.Fatal("replacement refusal changed authoritative time", err)
			}
		})
	}
}

func testActualSharedCutoffWatch(t *testing.T, e *Engine, a *Attempt) {
	t.Helper()
	if err := e.WithState(func() error { e.state.Attempts[a.ID].Lease = Millis() - 1000; return nil }); err != nil {
		t.Fatal(err)
	}
	stale, err := readStateSnapshot(e.Config.State)
	if err != nil || stale.Attempts[a.ID].Lease > Millis() {
		t.Fatal("fixture did not install a stale durable lease", err)
	}
	// Actual watchdog entry: a stale disk lease cannot overrule fresh RAM proof.
	if err := e.Tick(); err != nil {
		t.Fatal("actual Tick failed with fresh independent authority", err)
	}
	current, err := readStateSnapshot(e.Config.State)
	if err != nil || current.Attempts[a.ID].State != "ACTIVE" || current.Attempts[a.ID].Start != a.Start || current.Attempts[a.ID].OriginalDeadline != a.OriginalDeadline {
		t.Fatal("watchdog converted a stale disk lease into a false interruption", err)
	}
	watch, err := e.terminalCutoffFor(current.Attempts[a.ID])
	if err != nil {
		t.Fatal("actual root SCM_RIGHTS cutoff handoff failed", err)
	}
	old := watch.slot.until()
	if old <= 0 {
		t.Fatal("fresh native authority was not visible in the actual mapped cutoff")
	}
	for until := time.Now().Add(3 * time.Second); watch.slot.until() <= old; {
		if time.Now().After(until) {
			t.Fatal("an actual accepted outbound renewal did not update the independent shared mapping")
		}
		time.Sleep(10 * time.Millisecond)
	}
	// Synthetic old timer argument; real pending expiry is tested separately.
	// This cannot zero the CURRENT word after a newer accepted live renewal.
	if observed, expired := watch.slot.expire(old); expired || observed <= old {
		t.Fatal("stale timer overwrote newer verified live proof", observed, expired)
	}
	e.terminalMonitoring.watchMu.Lock()
	delete(e.terminalMonitoring.watched, a.ID)
	e.terminalMonitoring.watchMu.Unlock()
	watch.close() // Retiring an observer must NEVER revoke the live root producer.
	if err := e.Tick(); err != nil {
		t.Fatal(err)
	}
	after, err := readStateSnapshot(e.Config.State)
	if err != nil || after.Attempts[a.ID].State != "ACTIVE" || after.Attempts[a.ID].Generation != a.Generation {
		t.Fatal("watcher mapping retirement/reload revoked healthy authority", err)
	}
}

// Actual signed pane issuance -> Engine.local -> closed user scope -> separate
// supervisor -> inner PTY. Installed SSH ancestry is a compiled test seam;
// revoking input is explicitly NOT a verified all-writer hold or approved thaw.
// Return only after the actual gate has registered a closed launcher and reached
// the real manager-start seam. Finishing releases that manager AFTER pause and
// requires an explicit gate refusal, actual child death and no consumed permit.
func stageActualMonitoredLaunch(t *testing.T, e *Engine, key ed25519.PrivateKey, a *Attempt, pane, barrier string) func() {
	t.Helper()
	probe := filepath.Join(t.TempDir(), "late-exec-probe")
	t.Setenv("EXAM_TEST_BOOTSTRAP_EXEC_PROBE", probe)
	reached, released := make(chan string, 1), make(chan struct{})
	var once sync.Once
	release := func() { once.Do(func() { close(released) }) }
	// The first shell's output crosses a process boundary, which does not order
	// Go memory accesses. Join its final state transaction before changing seams.
	e.mu.Lock()
	prior := e.paneBootstrapStart
	type startedChild struct {
		process *uidProcess
		err     error
	}
	started := make(chan startedChild, 1)
	e.paneBootstrapStart = func(launch *exec.Cmd, control *net.UnixConn, exe *os.File, unit string, proof PaneInstance) (*paneBootstrapPeer, bool, error) {
		if proof.Pane != pane {
			return prior(launch, control, exe, unit, proof)
		}
		if barrier == "manager" {
			reached <- unit
			select {
			case <-released:
			case <-time.After(5 * time.Second):
				return nil, false, fmt.Errorf("test manager release missing")
			}
		}
		peer, didStart, err := prior(launch, control, exe, unit, proof)
		var pinned *uidProcess
		if err == nil && peer != nil {
			pinned, err = pinUIDProcess(peer.process.pid, a.UID)
		}
		started <- startedChild{pinned, err}
		return peer, didStart, err
	}
	priorIdentity := e.paneIdentity
	priorRelease := e.paneReleaseCheckpoint
	if barrier == "after-save" {
		e.paneReleaseCheckpoint = func(unit string) error {
			id, _, _, valid := recordedPaneIdentity(a.ID, unit)
			if valid && id == pane {
				reached <- unit
				select {
				case <-released:
				case <-time.After(5 * time.Second):
					return fmt.Errorf("test saved-tracking release missing")
				}
			}
			if priorRelease != nil {
				return priorRelease(unit)
			}
			return nil
		}
	}
	if barrier == "final-release" {
		e.paneIdentity = func(pid, uid int) (string, error) {
			identity, err := priorIdentity(pid, uid)
			if err != nil {
				return identity, err
			}
			view, err := e.callTerminalAuthority(terminalAuthorityRequest{Op: "view", Attempt: a.ID, Owner: *a.RegisteredOwner}, nil, false)
			if err != nil {
				return "", err
			}
			for _, observed := range view.Panes {
				id, _, _, valid := recordedPaneIdentity(a.ID, observed.Unit)
				if valid && id == pane {
					reached <- observed.Unit
					select {
					case <-released:
					case <-time.After(5 * time.Second):
						return "", fmt.Errorf("test final release missing")
					}
				}
			}
			return identity, nil
		}
	}
	e.mu.Unlock()
	t.Cleanup(func() {
		release()
		e.mu.Lock()
		defer e.mu.Unlock()
		e.paneBootstrapStart = prior
		e.paneIdentity = priorIdentity
		e.paneReleaseCheckpoint = priorRelease
	})
	command := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "issue-framed-owner-channel-admission", Username: a.Username, Transport: a.Transport, Body: Request{ID: a.ID, Pane: pane, Purpose: "exam", Username: a.Username, Transport: a.Transport, PageEpoch: a.RegisteredOwner.PageEpoch}}
	value, err := e.Command(signedCommand(key, command), a.Username, a.Transport)
	if err != nil {
		t.Fatal(err)
	}
	listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: filepath.Join(t.TempDir(), "delayed-manager.sock"), Net: "unix"})
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	client, err := net.DialUnix("unix", nil, listener.Addr().(*net.UnixAddr))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { client.Close() })
	_ = listener.SetDeadline(time.Now().Add(time.Second))
	accepted, err := listener.AcceptUnix()
	if err != nil {
		t.Fatal(err)
	}
	finished := make(chan struct{})
	go func() { defer close(finished); e.local(accepted) }()
	t.Cleanup(func() {
		release()
		client.Close()
		select {
		case <-finished:
		case <-time.After(5 * time.Second):
			t.Error("owned delayed manager gate did not finish")
		}
	})
	master, slave, err := openPTYMasterFlags(unix.O_NONBLOCK)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { master.Close(); slave.Close() })
	if _, err := rawTerminal(slave.Fd()); err != nil {
		t.Fatal(err)
	}
	payload, _ := json.Marshal(LocalRequest{Token: value.(map[string]string)["token"], InputProtocol: "v1"})
	if _, _, err := client.WriteMsgUnix(payload, syscall.UnixRights(int(slave.Fd())), nil); err != nil {
		t.Fatal(err)
	}
	_ = client.SetDeadline(time.Now().Add(5 * time.Second))
	var ready map[string]any
	if err := json.NewDecoder(client).Decode(&ready); err != nil || ready["error"] != nil {
		t.Fatal("delayed manager missed actual admission", ready, err)
	}
	if _, err := client.Write([]byte{1}); err != nil {
		t.Fatal(err)
	}
	var unit string
	select {
	case unit = <-reached:
	case <-time.After(5 * time.Second):
		t.Fatal("actual closed launcher never reached manager-start boundary")
	}
	if _, err := os.Stat(probe); !os.IsNotExist(err) {
		t.Fatal("bootstrap executed before manager start", err)
	}
	if barrier == "after-save" {
		state, err := readStateSnapshot(e.Config.State)
		if err != nil || state.PaneInstances[unit].ReadyAt == 0 || state.Attempts[a.ID].State != "ACTIVE" {
			t.Fatal("fixture missed durable tracking before final exec", err)
		}
	}
	return func() {
		t.Helper()
		release()
		_ = client.SetDeadline(time.Now().Add(5 * time.Second))
		type outcome struct {
			value map[string]any
			err   error
		}
		replies := make(chan outcome, 1)
		go func() {
			var value map[string]any
			err := json.NewDecoder(client).Decode(&value)
			replies <- outcome{value, err}
		}()
		var reply outcome
		wait := time.NewTimer(3 * time.Second)
		defer wait.Stop()
	waiting:
		for {
			select {
			case reply = <-replies:
				break waiting
			case <-wait.C:
				t.Fatal("exact gate neither refused nor completed; not an absence oracle")
			case <-time.After(10 * time.Millisecond):
				if data, err := os.ReadFile(probe); err == nil {
					t.Fatalf("revoked launch consumed an execution permit: %q", data)
				} else if !os.IsNotExist(err) {
					t.Fatal("exec witness unavailable", err)
				}
			}
		}
		if reply.err != nil || reply.value["error"] == nil {
			t.Fatal("late launch lacked an explicit native gate refusal", reply.value, reply.err)
		}
		select {
		case <-finished:
		case <-time.After(5 * time.Second):
			t.Fatal("late refused gate did not finish")
		}
		var child startedChild
		select {
		case child = <-started:
		case <-time.After(time.Second):
			t.Fatal("real delayed manager never reported its exact child")
		}
		if child.err != nil || child.process == nil {
			t.Fatal("late manager never reached actual pinned bootstrap", child.err)
		}
		defer child.process.close()
		for until := time.Now().Add(2 * time.Second); ; {
			live, err := child.process.live()
			if err == nil && !live {
				break
			}
			if err != nil || time.Now().After(until) {
				t.Fatal("refused actual bootstrap remained live", err)
			}
			time.Sleep(10 * time.Millisecond)
		}
		if _, err := os.Stat(probe); !os.IsNotExist(err) {
			t.Fatal("late manager consumed a closed execution permit", err)
		}
		state, err := readStateSnapshot(e.Config.State)
		if err != nil {
			t.Fatal(err)
		}
		for _, recorded := range state.Attempts[a.ID].Units {
			if recorded == unit {
				t.Fatal("positively exited refused startup remained reserved")
			}
		}
		for until := time.Now().Add(2 * time.Second); ; {
			observed, err := ObserveTerminalSupervisor(e.Config.State, a.ID)
			if err != nil {
				t.Fatal(err)
			}
			if len(observed.AttachedUnits) == 1 && len(observed.PendingLaunchUnits) == 0 {
				break
			}
			if time.Now().After(until) {
				t.Fatal("refused bootstrap left an actual supervisor reservation", observed)
			}
			time.Sleep(10 * time.Millisecond)
		}
	}
}

func testActualMonitoredPaneInput(t *testing.T, e *Engine, key ed25519.PrivateKey, a *Attempt, mode string, authorize func(int32)) {
	t.Helper()
	reconciled := make(chan struct{}, 1)
	if strings.Contains(mode, "recording-fault") {
		e.terminalFailureCheckpoint = func(stage string) {
			if stage == "after-state" {
				select {
				case reconciled <- struct{}{}:
				default:
				}
			}
		}
	}
	// The bootstrap-only fixture deliberately omits the filesystem view. This
	// pane continuation needs the real synthetic home snapshot as well.
	account := e.Config.Accounts[a.Username]
	account.Home = t.TempDir()
	e.Config.Accounts[a.Username] = account
	if err := e.prepareHome(a); err != nil {
		t.Fatal(err)
	}
	e.paneIdentity = func(pid, uid int) (string, error) {
		if pid != os.Getpid() || uid != os.Getuid() {
			return "", fmt.Errorf("wrong synthetic original socket peer")
		}
		return a.Transport, nil
	}
	e.paneBootstrapStart = func(launch *exec.Cmd, control *net.UnixConn, exe *os.File, unit string, proof PaneInstance) (*paneBootstrapPeer, bool, error) {
		return ownedPaneBootstrapStart(t, launch, control, exe, unit, proof)
	}
	cmd := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "issue-framed-owner-channel-admission", Username: a.Username, Transport: a.Transport, Body: Request{ID: a.ID, Pane: finalID, Purpose: "exam", Username: a.Username, Transport: a.Transport, PageEpoch: a.RegisteredOwner.PageEpoch}}
	issued, err := e.Command(signedCommand(key, cmd), a.Username, a.Transport)
	if err != nil {
		t.Fatal(err)
	}
	capability := issued.(map[string]string)
	listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: filepath.Join(t.TempDir(), "monitored-pane.sock"), Net: "unix"})
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	client, err := net.DialUnix("unix", nil, listener.Addr().(*net.UnixAddr))
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	_ = listener.SetDeadline(time.Now().Add(time.Second))
	accepted, err := listener.AcceptUnix()
	if err != nil {
		t.Fatal(err)
	}
	finished := make(chan struct{})
	go func() { defer close(finished); e.local(accepted) }()
	defer func() {
		client.Close()
		select {
		case <-finished:
		case <-time.After(5 * time.Second):
			t.Error("exact synthetic pane handler did not finish")
		}
	}()
	master, slave, err := openPTYMasterFlags(unix.O_NONBLOCK)
	if err != nil {
		t.Fatal(err)
	}
	defer master.Close()
	defer slave.Close()
	if _, err := rawTerminal(slave.Fd()); err != nil {
		t.Fatal(err)
	}
	payload, _ := json.Marshal(LocalRequest{Token: capability["token"], InputProtocol: "v1"})
	if _, _, err := client.WriteMsgUnix(payload, syscall.UnixRights(int(slave.Fd())), nil); err != nil {
		t.Fatal(err)
	}
	_ = client.SetDeadline(time.Now().Add(5 * time.Second))
	var ready map[string]any
	if err := json.NewDecoder(client).Decode(&ready); err != nil || ready["error"] != nil {
		t.Fatal("actual monitored pane admission failed", ready, err)
	}
	if _, err := client.Write([]byte{1}); err != nil {
		t.Fatal(err)
	}
	if err := client.SetDeadline(time.Time{}); err != nil {
		t.Fatal(err)
	} // Admission bound is not terminal lifetime.
	slave.Close()
	fd := int(master.Fd())
	if unix.SetNonblock(fd, true) != nil {
		t.Fatal("synthetic outer PTY is blocking")
	}
	if _, err := supervisionReadUntil(fd, "SYNTHETIC-CLOSED-PANE-EXEC", 4*time.Second); err != nil {
		t.Fatal("actual monitored pane did not execute", err)
	}
	encode := func(seq uint64, kind byte, data []byte) []byte {
		t.Helper()
		wire := make([]byte, framedInputHeaderBytes+len(data))
		copy(wire, "EXIN")
		wire[4], wire[5] = 1, kind
		epoch, _ := hex.DecodeString(capability["input_epoch"])
		pane, _ := hex.DecodeString(strings.ReplaceAll(finalID, "-", ""))
		copy(wire[8:40], epoch)
		copy(wire[40:56], pane)
		binary.BigEndian.PutUint64(wire[56:64], seq)
		binary.BigEndian.PutUint32(wire[64:68], uint32(len(data)))
		copy(wire[68:], data)
		return wire
	}
	send := func(wire []byte) {
		t.Helper()
		for at, until := 0, time.Now().Add(time.Second); at < len(wire); {
			n, err := unix.Write(fd, wire[at:])
			if n > 0 {
				at += n
			}
			if (err != nil && err != unix.EAGAIN && err != unix.EINTR) || time.Now().After(until) {
				t.Fatal("bounded framed write failed", err)
			}
			if at < len(wire) {
				_ = recordingPoll(fd, unix.POLLOUT)
			}
		}
	}
	write := func(seq uint64, kind byte, data []byte) { t.Helper(); send(encode(seq, kind, data)) }
	write(1, 0, []byte("check\n"))
	beforeMemory, err := supervisionReadUntil(fd, "BUFFER:synthetic-buffer-not-on-disk:", time.Second)
	if err != nil {
		t.Fatal("verified live authority did not admit actual shell input", err)
	}
	if mode == "clock-live" || mode == "clock-recording-fault" {
		// Stop only this fixture's producer so the transfer oracle cannot mistake
		// an unrelated fresh renewal for facts carried by the clock operation.
		e.stopTerminalMonitoring()
		prior, err := e.callTerminalAuthority(terminalAuthorityRequest{Op: "view", Attempt: a.ID, Owner: *a.RegisteredOwner}, nil, false)
		if err != nil || prior.View == nil || !prior.View.ExecutionAuthorized {
			t.Fatal(prior, err)
		}
		oldWatch, err := e.openTerminalCutoff(a)
		if err != nil {
			t.Fatal(err)
		}
		defer oldWatch.close()
		challenge, err := e.callTerminalAuthority(terminalAuthorityRequest{Op: "challenge", Attempt: a.ID, Owner: *a.RegisteredOwner}, nil, false)
		if err != nil || challenge.Challenge == nil {
			t.Fatal(challenge, err)
		}
		request := resetRequest(a)
		request.ResetID, request.RemainingSeconds, request.ExtendSeconds = ManagementID(), 0, 60
		clock := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "reset-clock", Username: a.Username, Transport: a.Transport, Body: request}
		// A real local publication fault must refuse before the supervisor gains
		// any extended interval. Keep the native authority/facts and durable row.
		fault := filepath.Join(e.Config.State, "state.json.tmp")
		if err := os.Mkdir(fault, 0700); err != nil {
			t.Fatal(err)
		}
		_, failed := e.Command(signedCommand(key, clock), a.Username, a.Transport)
		if err := os.Remove(fault); err != nil {
			t.Fatal(err)
		}
		if failed == nil || !strings.Contains(failed.Error(), "is a directory") {
			t.Fatal("fixture missed the actual durable clock publication refusal", failed)
		}
		unchanged, err := readStateSnapshot(e.Config.State)
		if err != nil || unchanged.Attempts[a.ID].ClockRevision != a.ClockRevision || unchanged.Attempts[a.ID].Deadline != a.Deadline {
			t.Fatal("failed publication consumed clock intent", err)
		}
		oldLive, err := e.callTerminalAuthority(terminalAuthorityRequest{Op: "view", Attempt: a.ID, Owner: *a.RegisteredOwner}, nil, false)
		if err != nil || oldLive.View == nil || !oldLive.View.ExecutionAuthorized || oldLive.View.DeadlineUptimeMS != prior.View.DeadlineUptimeMS || oldLive.View.AuthorityUntilMS != prior.View.AuthorityUntilMS {
			t.Fatal("failed publication changed live clock/freshness", oldLive, err)
		}
		clock.Nonce = Token()
		if _, err := e.Command(signedCommand(key, clock), a.Username, a.Transport); err != nil {
			t.Fatal("live-pane clock handover failed", err)
		}
		state, err := readStateSnapshot(e.Config.State)
		if err != nil {
			t.Fatal(err)
		}
		next := state.Attempts[a.ID]
		after, err := e.callTerminalAuthority(terminalAuthorityRequest{Op: "view", Attempt: a.ID, Owner: *next.RegisteredOwner}, nil, false)
		if err != nil || after.View == nil || !after.View.ExecutionAuthorized || after.View.AuthorityUntilMS != prior.View.AuthorityUntilMS || after.View.CoverageEpoch != prior.View.CoverageEpoch || after.View.Sequence != prior.View.Sequence || after.View.DeadlineUptimeMS != int64(next.UptimeDeadline*1000) {
			t.Fatal("clock edit refreshed/forgot capture facts or left old deadline", prior, after, err)
		}
		oldProof := monitoringEvidence{Type: "monitoring-execution-evidence-v1", Audience: "class", Nonce: challenge.Challenge.Nonce, Owner: *a.RegisteredOwner, CoverageEpoch: prior.View.CoverageEpoch, Sequence: prior.View.Sequence + 1, AgeMS: 0, Complete: true}
		payload, _ := json.Marshal(oldProof)
		frame := SignedFrame{Payload: base64.StdEncoding.EncodeToString(payload), Signature: base64.StdEncoding.EncodeToString(ed25519.Sign(key, payload))}
		if _, err := e.callTerminalAuthority(terminalAuthorityRequest{Op: "proof", Attempt: a.ID, Owner: *a.RegisteredOwner, Frame: &frame}, nil, false); err == nil {
			t.Fatal("old-clock signed proof renewed the replacement scope")
		}
		// A delayed observer can zero only the retired mapping, never the new one.
		oldWatch.slot.expire(prior.View.AuthorityUntilMS)
		freshWatch, err := e.openTerminalCutoff(next)
		if err != nil {
			t.Fatal(err)
		}
		if freshWatch.slot.until() != prior.View.AuthorityUntilMS {
			freshWatch.close()
			t.Fatal("stale old-clock observer revoked current facts")
		}
		freshWatch.close()
		clock.Nonce = Token()
		if _, err := e.Command(signedCommand(key, clock), a.Username, a.Transport); err != nil {
			t.Fatal("same durable clock intent could not recover its acknowledgement", err)
		}
		retried, err := readStateSnapshot(e.Config.State)
		if err != nil || retried.Attempts[a.ID].Deadline != next.Deadline || len(retried.Attempts[a.ID].ClockResets) != len(a.ClockResets)+1 {
			t.Fatal("clock retry applied another allowance", err)
		}
		write(2, 0, []byte("check\n"))
		memory, err := supervisionReadUntil(fd, "BUFFER:synthetic-buffer-not-on-disk:", time.Second)
		if err != nil || !strings.Contains(memory, "synthetic-buffer-not-on-disk") {
			t.Fatal("clock transition held input or lost the original shell", memory, err)
		}
		// New-revision challenges must continue through the actual signed HTTPS
		// exchange; merely preserving the original cutoff is insufficient.
		if err := e.refreshTerminalMonitoring(context.Background(), a.ID, *next.RegisteredOwner); err != nil {
			t.Fatal("new clock revision could not renew", err)
		}
		a = next
	}
	if mode == "revoked-before-exec" || mode == "revoked-after-save" {
		barrier := "final-release"
		if mode == "revoked-after-save" {
			barrier = "after-save"
		}
		finish := stageActualMonitoredLaunch(t, e, key, a, ManagementID(), barrier)
		revoked, err := e.callTerminalAuthority(terminalAuthorityRequest{Op: "revoke", Attempt: a.ID, Owner: *a.RegisteredOwner, Cause: "operator-pause"}, nil, false)
		if err != nil || revoked.View == nil || revoked.View.ExecutionAuthorized {
			t.Fatal("actual supervisor revocation missed final exec barrier", revoked, err)
		}
		finish()
		paused, err := e.Admin("pause", a.ID, "synthetic confirmed pause after final-exec refusal")
		if err != nil || paused.(*Attempt).RetainedHold != "held" {
			t.Fatal("refused launch prevented verified hold of the original shell", err)
		}
		held := paused.(*Attempt)
		authorize(4)
		resume := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "consume-monitored-continuation", Username: a.Username, Transport: a.Transport, Body: Request{ID: a.ID, Generation: held.Generation, PageEpoch: a.RegisteredOwner.PageEpoch}}
		resumed, err := e.Command(signedCommand(key, resume), a.Username, a.Transport)
		if err != nil {
			t.Fatal("original shell could not continue after final-exec refusal", err)
		}
		capability["input_epoch"] = resumed.(map[string]any)["input_epochs"].(map[string]string)[finalID]
		write(1, 0, []byte("check\n"))
		memory, err := supervisionReadUntil(fd, "BUFFER:synthetic-buffer-not-on-disk:", time.Second)
		same := false
		for _, row := range strings.Split(beforeMemory, "\n") {
			if strings.HasPrefix(row, "BUFFER:") && strings.Contains(memory, strings.TrimSpace(row)) {
				same = true
			}
		}
		if err != nil || !same {
			t.Fatal("final-exec refusal lost original shell memory", memory, err)
		}
		return
	}
	if mode == "native-live-expiry" {
		e.stopTerminalMonitoring() // End this synthetic producer; retain the real supervisor/SSH.
		watch, err := e.terminalCutoffFor(a)
		if err != nil {
			t.Fatal(err)
		}
		untilBoot := watch.slot.until()
		if untilBoot <= 0 {
			t.Fatal("fixture missed unexpired current native proof")
		}
		for limit := time.Now().Add(18 * time.Second); ; {
			observed, err := ObserveTerminalSupervisor(e.Config.State, a.ID)
			if err != nil {
				t.Fatal(err)
			}
			now, err := monitoringBootMillis()
			if err != nil {
				t.Fatal(err)
			}
			if observed.RetainedHold != nil && observed.RetainedHold.Phase == "held" {
				if now < untilBoot {
					t.Fatal("supervisor froze still-valid proof before its original live cutoff")
				}
				break
			}
			if time.Now().After(limit) {
				t.Fatal("independent supervisor expiry did not verify a writer hold")
			}
			time.Sleep(25 * time.Millisecond)
		}
		if err := e.Tick(); err != nil {
			t.Fatal(err)
		}
		state, err := readStateSnapshot(e.Config.State)
		if err != nil {
			t.Fatal(err)
		}
		held := state.Attempts[a.ID]
		if held.State != "LOCKED" || held.RetainedHold != "held" || held.MonitoringHoldKind != "technical" || !strings.Contains(held.Reason, "not a student violation") || held.Start != a.Start || held.OriginalDeadline != a.OriginalDeadline {
			t.Fatal("actual proof expiry changed time or invented a policy violation", held)
		}
		view, err := e.callTerminalAuthority(terminalAuthorityRequest{Op: "view", Attempt: a.ID, Owner: *a.RegisteredOwner}, nil, false)
		if err != nil || view.View == nil || view.View.ExecutionAuthorized {
			t.Fatal("expired held authority remained executable", view, err)
		}
		for _, cause := range view.View.Causes {
			if cause == "operator-pause" || cause == "policy-condition" {
				t.Fatal("expiry manufactured a confirmed policy/operator cause", cause)
			}
		}
		master.Close()
		if err := client.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
			t.Fatal(err)
		}
		var ended map[string]any
		if err := json.NewDecoder(client).Decode(&ended); err != nil || ended["ended"] != true {
			t.Fatal("technical hold did not preserve clean explicit terminal closure", ended, err)
		}
		return
	}
	// Model the actual registered-before-manager boundary without starting any
	// second process. Missing scope/row alone must not turn it into absence.
	pendingPane, pendingIncarnation := ManagementID(), ManagementID()
	now, err := monitoringBootMillis()
	if err != nil {
		t.Fatal(err)
	}
	pendingProof := PaneInstance{Attempt: a.ID, Pane: pendingPane, ID: pendingIncarnation, Boot: boot(), ClosedUntil: Millis() + 15000, ClosedBootUntil: now + 15000, InputEpoch: Token()}
	pendingUnit := "exam-" + a.ID + "-" + pendingPane + "-" + pendingIncarnation + ".scope"
	var finishDelayed func()
	if mode == "delayed-manager" {
		finishDelayed = stageActualMonitoredLaunch(t, e, key, a, pendingPane, "manager")
	} else {
		if _, err := e.callTerminalAuthority(terminalAuthorityRequest{Op: "register-launch", Attempt: a.ID, Owner: *a.RegisteredOwner, Unit: pendingUnit, Proof: &pendingProof}, nil, false); err != nil {
			t.Fatal(err)
		}
	}
	unverified, err := e.Admin("pause", a.ID, "synthetic pending launch pause")
	if err == nil || !strings.Contains(err.Error(), "hold is unverified") {
		t.Fatal("native pause invented absence of a pending registered launcher", unverified, err)
	}
	diagnostic, err := e.callTerminalAuthority(terminalAuthorityRequest{Op: "view", Attempt: a.ID, Owner: *a.RegisteredOwner}, nil, false)
	if err != nil || diagnostic.Hold == nil || diagnostic.Hold.Phase != "unverified" || !strings.Contains(diagnostic.Hold.Error, "launch is still pending") {
		t.Fatal("pending launch refusal missed the intended hold stage", diagnostic, err)
	}
	if len(diagnostic.Panes) != 1 {
		t.Fatal("pending launch test lost the actual running pane", diagnostic)
	}
	knownScope, err := terminalScopeHandle(diagnostic.Panes[0].Unit)
	if err != nil {
		t.Fatal(err)
	}
	knownFrozen, freezeErr := terminalScopeFrozen(knownScope)
	knownScope.Close()
	if freezeErr != nil || !knownFrozen {
		t.Fatal("pending launch uncertainty left a known student writer running", freezeErr)
	}
	cli := ""
	if os.Getenv("EXAM_MANAGEMENT_USERNS") == "1" {
		cli = observationCLIBinary(t)
	}
	inspectCLI := func(phase string, pending int) {
		t.Helper()
		if cli == "" {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
		defer cancel()
		data, err := exec.CommandContext(ctx, "/usr/bin/unshare", "--user", "--map-root-user", cli, "panes", "supervisor", a.ID, "--state", e.Config.State).CombinedOutput()
		var v TerminalSupervisorObservation
		if err != nil || json.Unmarshal(data, &v) != nil || !v.ObservationOnly || v.MonitoringMode != "v1" || v.RetainedHold == nil || v.RetainedHold.Phase != phase || len(v.PendingLaunchUnits) != pending {
			t.Fatal("actual read-only examctl lost the current retained/pending state", string(data), err)
		}
	}
	inspectCLI("unverified", 1)
	// This exact synthetic launch was NEVER started. Release that promise; no
	// real manager record/process is cleared or inferred dead from a timeout.
	if finishDelayed != nil {
		finishDelayed()
	} else {
		if _, err := e.callTerminalAuthority(terminalAuthorityRequest{Op: "cancel-launch", Attempt: a.ID, Owner: *a.RegisteredOwner, Unit: pendingUnit, Proof: &pendingProof}, nil, false); err != nil {
			t.Fatal(err)
		}
	}
	paused, err := e.Admin("pause", a.ID, "synthetic retained policy pause")
	if err != nil {
		t.Fatal("actual native administrator pause did not verify a retained hold", paused, err)
	}
	held, ok := paused.(*Attempt)
	if !ok || held.State != "LOCKED" || held.RetainedHold != "held" || held.Start != a.Start || held.Deadline != a.Deadline || held.OriginalDeadline != a.OriginalDeadline || held.ResumeTransport != a.Transport {
		t.Fatal("retained pause changed authoritative time or lost its verified transport", paused)
	}
	revoked, err := e.callTerminalAuthority(terminalAuthorityRequest{Op: "view", Attempt: a.ID, Owner: *a.RegisteredOwner}, nil, false)
	if err != nil || revoked.View == nil || revoked.View.ExecutionAuthorized || revoked.Hold == nil || revoked.Hold.Phase != "held" || len(revoked.Panes) != 1 || !revoked.Panes[0].Held {
		t.Fatal("actual supervisor did not hold its current live pane", revoked, err)
	}
	scope, err := terminalScopeHandle(revoked.Panes[0].Unit)
	if err != nil {
		t.Fatal(err)
	}
	frozen, err := terminalScopeFrozen(scope)
	scope.Close()
	if err != nil || !frozen {
		t.Fatal("administrator pause claimed a hold without actual kernel freeze", err)
	}
	inspectCLI("held", 0)
	if mode == "clock-live" || mode == "clock-recording-fault" {
		request := resetRequest(held)
		request.ResetID, request.RemainingSeconds, request.ExtendSeconds = ManagementID(), 0, 60
		clock := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "reset-clock", Username: a.Username, Transport: a.Transport, Body: request}
		if _, err := e.Command(signedCommand(key, clock), a.Username, a.Transport); err != nil {
			t.Fatal("clock change of an already verified hold failed", err)
		}
		state, err := readStateSnapshot(e.Config.State)
		if err != nil {
			t.Fatal(err)
		}
		held = state.Attempts[a.ID]
		next, err := e.callTerminalAuthority(terminalAuthorityRequest{Op: "view", Attempt: a.ID, Owner: *held.RegisteredOwner}, nil, false)
		if err != nil || next.View == nil || next.View.ExecutionAuthorized || next.Hold == nil || next.Hold.Phase != "held" || next.View.Sequence != revoked.View.Sequence || held.Deadline != a.Deadline+60000 || held.State != "LOCKED" || held.OriginalDeadline != a.OriginalDeadline {
			t.Fatal("clock edit thawed held work or changed original facts", next, err)
		}
		a = held
	}
	if cli != "" {
		configPath := filepath.Join(t.TempDir(), "synthetic-agent.json")
		complete := e.Config
		complete.Rootfs = t.TempDir() // Bootstrap-only fixture omitted this required absolute path.
		data, err := json.Marshal(complete)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(configPath, data, 0600); err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		out, err := exec.CommandContext(ctx, "/usr/bin/unshare", "--user", "--map-root-user", cli, "pause", a.ID, "--reason", "synthetic CLI retained hold verification", "--config", configPath).CombinedOutput()
		cancel()
		var pausedCLI Attempt
		if os.Geteuid() != 0 {
			// A child user namespace cannot inspect the outer owner's executable
			// under this host's proc/ptrace policy. Keep that real refusal and root
			// scope checks; this is NOT positive privileged CLI qualification.
			if err == nil || !strings.Contains(string(out), "open /proc/") || !strings.Contains(string(out), "permission denied") || !strings.Contains(string(out), "Help: examctl help pause") {
				t.Fatal("root-boundary CLI refusal was not actionable at its actual stage", string(out), err)
			}
			repaired, repairErr := e.Admin("pause", a.ID, "synthetic same-owner hold confirmation retry")
			if repairErr != nil || repaired.(*Attempt).RetainedHold != "held" {
				t.Fatal("same native owner could not confirm the existing held workload after CLI namespace refusal", repairErr)
			}
			t.Log("Actual CLI mutation refused at outer proc executable pin; positive root CLI hold remains a guarded-guest qualification gate")
		} else if err != nil || json.Unmarshal(out, &pausedCLI) != nil || pausedCLI.State != "LOCKED" || pausedCLI.RetainedHold != "held" || pausedCLI.Start != a.Start || pausedCLI.OriginalDeadline != a.OriginalDeadline {
			t.Fatal("actual examctl pause did not join the existing supervisor hold", string(out), err)
		}
	}
	heldSequence := uint64(2)
	if mode == "clock-live" || mode == "clock-recording-fault" {
		heldSequence = 3
	}
	write(heldSequence, 0, []byte("finish\n"))
	size := make([]byte, 8)
	binary.BigEndian.PutUint32(size, 46)
	binary.BigEndian.PutUint32(size[4:], 119)
	write(heldSequence+1, 1, size)
	var observed terminalAuthorityReply
	for until := time.Now().Add(2 * time.Second); ; {
		observed, err = e.callTerminalAuthority(terminalAuthorityRequest{Op: "view", Attempt: a.ID, Owner: *a.RegisteredOwner}, nil, false)
		if err != nil {
			t.Fatal(err)
		}
		if len(observed.Panes) == 1 && observed.Panes[0].DiscardedInput == heldSequence && observed.Panes[0].DiscardedResize == heldSequence+1 {
			break
		}
		if time.Now().After(until) {
			t.Fatal("held frame did not reach the actual decoder and resize gates", observed)
		}
		time.Sleep(10 * time.Millisecond)
	}
	group, err := ownedTerminalGroup(observed.Panes[0].Unit)
	if err != nil || group == "" {
		t.Fatal("discarded finish input ended the actual shell", err)
	}
	resume := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "consume-monitored-continuation", Username: a.Username, Transport: a.Transport, Body: Request{ID: a.ID, Generation: held.Generation, PageEpoch: a.RegisteredOwner.PageEpoch}}
	if _, err := e.Command(signedCommand(key, resume), a.Username, a.Transport); err == nil || !strings.Contains(err.Error(), "approval is unavailable") {
		t.Fatal("missing current approval did not refuse before thaw", err)
	}
	still, err := readStateSnapshot(e.Config.State)
	if err != nil || still.Attempts[a.ID].State != "LOCKED" || still.Attempts[a.ID].RetainedHold != "held" || still.Attempts[a.ID].Start != a.Start || still.Attempts[a.ID].Deadline != a.Deadline {
		t.Fatal("refused Continue consumed authority or changed time", err)
	}
	for _, mode := range []int32{1, 2, 3} {
		authorize(mode)
		resume.Nonce = Token()
		if _, err := e.Command(signedCommand(key, resume), a.Username, a.Transport); err == nil || !strings.Contains(err.Error(), "monitoring evidence") {
			t.Fatal("wrong-owner/expired/invalid seed reached thaw", mode, err)
		}
		state, err := readStateSnapshot(e.Config.State)
		if err != nil || state.Attempts[a.ID].State != "LOCKED" || state.Attempts[a.ID].Start != a.Start || state.Attempts[a.ID].OriginalDeadline != a.OriginalDeadline {
			t.Fatal("invalid continuation changed original state/time", mode, err)
		}
	}
	late := encode(heldSequence+2, 0, []byte("finish\n"))
	send(late[:framedInputHeaderBytes-3]) // Decoder is mid-old-frame during Continue.
	authorize(4)
	resume.Nonce = Token()
	marker := filepath.Join(e.Config.State, "synthetic-resume-commit-refusal")
	if err := os.WriteFile(marker, []byte("refuse-next-commit"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Command(signedCommand(key, resume), a.Username, a.Transport); err == nil {
		t.Fatal("fixture did not refuse the supervisor commit after durable native ACTIVE")
	}
	stage, stageErr := os.ReadFile(marker)
	pending, pendingErr := readStateSnapshot(e.Config.State)
	if stageErr != nil || string(stage) != "refused-at-supervisor-commit" || pendingErr != nil || pending.Attempts[a.ID].State != "ACTIVE" || pending.Attempts[a.ID].RetainedHold != "resuming" || pending.Attempts[a.ID].Start != a.Start || pending.Attempts[a.ID].OriginalDeadline != a.OriginalDeadline {
		t.Fatal("refusal missed the intended durable-commit/live-hold boundary", stageErr, pendingErr)
	}
	heldNative, err := e.callTerminalAuthority(terminalAuthorityRequest{Op: "view", Attempt: a.ID, Owner: *a.RegisteredOwner}, nil, false)
	if err != nil || heldNative.Hold == nil || heldNative.Hold.Phase != "held" || heldNative.View == nil || heldNative.View.ExecutionAuthorized {
		t.Fatal("uncertain continuation released the live held workload", heldNative, err)
	}
	observedPending, err := ObserveTerminalSupervisor(e.Config.State, a.ID)
	if err != nil || observedPending.PendingResume == nil || observedPending.PendingResume.ClockUnknown || observedPending.PendingResume.Generation != held.Generation {
		t.Fatal("pending continuation is not inspectable at the actual supervisor interface", observedPending, err)
	}
	if mode == "expired-pending-resume" {
		for limit := time.Now().Add(17 * time.Second); ; {
			observed, err := ObserveTerminalSupervisor(e.Config.State, a.ID)
			if err != nil || observed.PendingResume == nil || observed.PendingResume.ClockUnknown {
				t.Fatal("pending expiry lost its exact native observation", observed, err)
			}
			if observed.PendingResume.Expired {
				break
			}
			if time.Now().After(limit) {
				t.Fatal("native pending expiry never reached its original boot bound")
			}
			time.Sleep(25 * time.Millisecond)
		}
	} else if mode == "pending-resume-cancel" {
		authorize(0)
		// WithState deliberately persists even when a callback refuses. Put an
		// invalid SECOND private record after the real pane: cancellation must
		// not partly roll back the first pane's association, stranding retry.
		ghost := fmt.Sprintf("exam-%s-%s-%s.scope", a.ID, ManagementID(), ManagementID())
		if err := e.WithState(func() error {
			current := e.state.Attempts[a.ID]
			if len(current.Units) != 1 {
				return fmt.Errorf("refusal fixture requires exactly one actual pane")
			}
			current.Units = append(current.Units, ghost)
			return nil
		}); err != nil {
			t.Fatal(err)
		}
		if _, err := e.Admin("pause", a.ID, "private cancellation refusal with inconsistent second pane"); err == nil {
			t.Fatal("inconsistent cancellation unexpectedly succeeded")
		}
		refused, err := readStateSnapshot(e.Config.State)
		if err != nil {
			t.Fatal(err)
		}
		current := refused.Attempts[a.ID]
		actual := refused.PaneInstances[current.Units[0]]
		if actual.RecordingContinuedGeneration != current.RegisteredOwner.Generation {
			t.Fatal("refused cancellation partially changed an earlier real pane association", actual.RecordingContinuedGeneration, current.RegisteredOwner.Generation)
		}
		if current.State != "LOCKED" || current.RetainedHold != "unverified" || current.ResumeTransport != "" {
			t.Fatal("refused cancellation claimed a canonical hold or resume entitlement", current)
		}
		if err := e.WithState(func() error {
			current := e.state.Attempts[a.ID]
			if len(current.Units) != 2 || current.Units[1] != ghost {
				return fmt.Errorf("private inconsistent record changed before fixture repair")
			}
			current.Units = current.Units[:1] // Only the injected record; no real scope removed.
			return nil
		}); err != nil {
			t.Fatal(err)
		}
		cancelled, err := e.Admin("pause", a.ID, "explicitly cancel unexecuted pending Continue")
		if err != nil {
			t.Fatal("explicit pending Continue cancellation did not verify the existing hold", err)
		}
		held = cancelled.(*Attempt)
		if held.State != "LOCKED" || held.RetainedHold != "held" || held.MonitoringResumeNonce != "" || held.RegisteredOwner == nil || *held.RegisteredOwner != *a.RegisteredOwner || held.Start != a.Start || held.OriginalDeadline != a.OriginalDeadline {
			t.Fatal("pending cancellation changed work/time or kept an unexecuted owner", held)
		}
		resume.Nonce = Token()
		if _, err := e.Command(signedCommand(key, resume), a.Username, a.Transport); err == nil {
			t.Fatal("cancelled old generation reopened the attempt")
		}
		resume.Body.Generation = held.Generation
		authorize(4) // Explicit NEW approval for the operator's new pause generation.
	}
	if mode == "partial-thaw" || mode == "partial-continue" {
		stage := "scope-thawed"
		if mode == "partial-continue" {
			stage = "process-continued"
		}
		marker := filepath.Join(e.Config.State, "synthetic-resume-transition-refusal")
		payload, _ := json.Marshal(map[string]any{"stage": stage, "attempt": a.ID, "block": true})
		if err := os.WriteFile(marker, payload, 0600); err != nil {
			t.Fatal(err)
		}
		resume.Nonce = Token()
		frame := signedCommand(key, resume)
		failed := make(chan error, 1)
		go func() { _, err := e.Command(frame, a.Username, a.Transport); failed <- err }()
		func() {
			defer func() {
				if err := os.WriteFile(marker+".release", []byte("release"), 0600); err != nil {
					t.Error(err)
				}
			}()
			for until := time.Now().Add(2 * time.Second); ; {
				if _, err := os.Stat(marker + ".observed"); err == nil {
					break
				}
				if time.Now().After(until) {
					t.Fatal("partial transition never reached its exact blocked kernel checkpoint", stage)
				}
				time.Sleep(5 * time.Millisecond)
			}
			pending, err := readStateSnapshot(e.Config.State)
			if err != nil {
				t.Fatal(err)
			}
			current := pending.Attempts[a.ID]
			view, err := e.callTerminalAuthority(terminalAuthorityRequest{Op: "view", Attempt: a.ID, Owner: *current.RegisteredOwner}, nil, false)
			if err != nil || view.View == nil || !view.View.ExecutionAuthorized || current.RetainedHold != "resuming" {
				t.Fatal("fixture missed pending metadata with verified pre-fault authority", view, err)
			}
			admission := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "issue-framed-owner-channel-admission", Username: a.Username, Transport: a.Transport, Body: Request{ID: a.ID, Pane: ManagementID(), Purpose: "exam", Username: a.Username, Transport: a.Transport, PageEpoch: a.RegisteredOwner.PageEpoch}}
			if _, err := e.Command(signedCommand(key, admission), a.Username, a.Transport); err == nil || !strings.Contains(err.Error(), "attempt not active") {
				t.Fatal("pending partial transition admitted another pane despite its closed admission metadata", err)
			}
			if mode == "partial-continue" {
				if err := os.WriteFile(filepath.Join(e.Config.State, "synthetic-retired-hold-process"), []byte("retire-after-pin"), 0600); err != nil {
					t.Fatal(err)
				}
				refusal, _ := json.Marshal(map[string]string{"stage": "rehold-inventory", "attempt": a.ID})
				if err := os.WriteFile(filepath.Join(e.Config.State, "synthetic-rehold-inventory-refusal"), refusal, 0600); err != nil {
					t.Fatal(err)
				}
			}
		}()
		var transitionErr error
		select {
		case transitionErr = <-failed:
		case <-time.After(5 * time.Second):
			t.Fatal("injected transition did not finish after its exact release")
		}
		if transitionErr == nil || !strings.Contains(transitionErr.Error(), "synthetic transition failure after "+stage) {
			t.Fatal("fixture did not refuse after the actual kernel transition", stage, transitionErr)
		}
		observed, err := os.ReadFile(marker + ".observed")
		info, statErr := os.Lstat(marker + ".observed")
		if err != nil || statErr != nil || string(observed) != string(payload) || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || info.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) || info.Sys().(*syscall.Stat_t).Nlink != 1 {
			t.Fatal("transition refusal missed its exact private post-kernel checkpoint", stage, err, statErr)
		}
		pending, err := readStateSnapshot(e.Config.State)
		if err != nil {
			t.Fatal(err)
		}
		current := pending.Attempts[a.ID]
		if current.State != "ACTIVE" || current.RetainedHold != "resuming" || current.Start != a.Start || current.Deadline != a.Deadline || current.OriginalDeadline != a.OriginalDeadline || current.RegisteredOwner == nil {
			t.Fatal("partial transition changed original time or lost its pending owner", current)
		}
		for until := time.Now().Add(5 * time.Second); ; {
			view, err := e.callTerminalAuthority(terminalAuthorityRequest{Op: "view", Attempt: a.ID, Owner: *current.RegisteredOwner}, nil, false)
			if err != nil || view.View == nil || view.View.ExecutionAuthorized {
				t.Fatal("partial transition retained positive execution authority", view, err)
			}
			if view.Hold != nil && view.Hold.Phase == "held" && len(view.Panes) == 1 && view.Panes[0].Held {
				break
			}
			if time.Now().After(until) {
				t.Fatalf("partial transition did not positively re-hold the actual pane: hold=%+v view=%+v", view.Hold, view)
			}
			time.Sleep(10 * time.Millisecond)
		}
		if mode == "partial-continue" {
			refused, err := os.ReadFile(filepath.Join(e.Config.State, "synthetic-rehold-inventory-refusal.observed"))
			var refusal map[string]string
			if err != nil || json.Unmarshal(refused, &refusal) != nil || refusal["attempt"] != a.ID || refusal["stage"] != "rehold-inventory" {
				t.Fatal("re-hold missed its explicit first inventory refusal", string(refused), err)
			}
			observed, err := os.ReadFile(filepath.Join(e.Config.State, "synthetic-retired-hold-process.observed"))
			if err != nil || string(observed) != "pinned whole-process exit before cgroup observation" {
				t.Fatal("re-hold missed its positively exited pinned-process inventory race", string(observed), err)
			}
		}
	}
	var resumedSequence uint64
	if mode == "resume-ack-loss" {
		reached := false
		func() {
			previous := terminalResumeTransitionCheckpoint
			terminalResumeTransitionCheckpoint = func(stage, id, state string) error {
				if stage == "coordinator-committed" && id == a.ID && state == e.Config.State {
					reached = true
					return fmt.Errorf("synthetic coordinator acknowledgement loss")
				}
				return nil
			}
			defer func() { terminalResumeTransitionCheckpoint = previous }()
			resume.Nonce = Token()
			if _, err := e.Command(signedCommand(key, resume), a.Username, a.Transport); err == nil || !strings.Contains(err.Error(), "synthetic coordinator acknowledgement loss") || !reached {
				t.Fatal("fixture missed live resume before durable completion", reached, err)
			}
		}()
		pending, err := readStateSnapshot(e.Config.State)
		if err != nil {
			t.Fatal(err)
		}
		current := pending.Attempts[a.ID]
		if current == nil || current.RegisteredOwner == nil {
			t.Fatal("committed coordinator boundary lost its registered owner", current)
		}
		live, err := e.callTerminalAuthority(terminalAuthorityRequest{Op: "view", Attempt: a.ID, Owner: *current.RegisteredOwner}, nil, false)
		if err != nil || live.View == nil || !live.View.ExecutionAuthorized || current.State != "ACTIVE" || current.RetainedHold != "resuming" {
			t.Fatal("fixture missed successfully resumed authority with pending canonical completion", live, err, current)
		}
		resumedSequence = live.View.Sequence
		// Model only the coordinator's lost in-memory monitoring bridge here;
		// actual process death/restart remains a guarded root qualification.
		e.stopTerminalMonitoring()
		e.terminalMonitoring = terminalMonitoringBridge{}
	}
	resume.Nonce = Token() // Fresh verification, same approval/allowance; no restored receipt permission.
	continued, err := e.Command(signedCommand(key, resume), a.Username, a.Transport)
	if err != nil {
		t.Fatal("fresh approved native Continue failed", err)
	}
	result := continued.(map[string]any)
	active := result["attempt"].(*Attempt)
	epochs := result["input_epochs"].(map[string]string)
	if active.RetainedHold != "" {
		t.Fatal("confirmed native completion still blocks pane admission", active.RetainedHold)
	}
	if active.State != "ACTIVE" || active.Generation != held.Generation || active.Start != a.Start || active.Deadline != a.Deadline || active.OriginalDeadline != a.OriginalDeadline || active.RegisteredOwner == nil || active.RegisteredOwner.InputEpoch == a.RegisteredOwner.InputEpoch || epochs[finalID] == "" || epochs[finalID] == capability["input_epoch"] {
		t.Fatal("Continue changed time, replaced SSH or omitted fresh native epochs", continued)
	}
	if mode == "resume-ack-loss" {
		if !e.terminalMonitoring.ready.Load() {
			t.Fatal("confirmed resume did not initialize the fresh coordinator's monitoring bridge")
		}
		for until := time.Now().Add(3 * time.Second); ; {
			live, err := e.callTerminalAuthority(terminalAuthorityRequest{Op: "view", Attempt: a.ID, Owner: *active.RegisteredOwner}, nil, false)
			if err != nil || live.View == nil || !live.View.ExecutionAuthorized {
				t.Fatal("confirmed resume lost live monitoring authority", live, err)
			}
			if live.View.Sequence > resumedSequence {
				break
			}
			if time.Now().After(until) {
				t.Fatal("fresh coordinator did not perform another authenticated live renewal", live.View)
			}
			time.Sleep(10 * time.Millisecond)
		}
	}
	send(late[framedInputHeaderBytes-3:])
	write(999, 0, []byte("finish\n")) // Complete old-epoch frames stay stale too.
	capability["input_epoch"] = epochs[finalID]
	write(1, 0, []byte("check\n"))
	afterMemory, err := supervisionReadUntil(fd, "BUFFER:synthetic-buffer-not-on-disk:", time.Second)
	if err != nil {
		t.Fatal("same authenticated shell/editor memory did not survive hold/Continue", err)
	}
	line := func(s string) string {
		for _, row := range strings.Split(s, "\n") {
			if strings.HasPrefix(row, "BUFFER:") {
				return strings.TrimSpace(row)
			}
		}
		return ""
	}
	if line(beforeMemory) == "" || line(beforeMemory) != line(afterMemory) {
		t.Fatal("Continue replaced the original in-memory shell state", beforeMemory, afterMemory)
	}
	resume.Nonce = Token()
	if repeated, err := e.Command(signedCommand(key, resume), a.Username, a.Transport); err != nil || repeated.(map[string]any)["input_epochs"].(map[string]string)[finalID] != epochs[finalID] {
		t.Fatal("lost-reply retry changed the existing live epoch", repeated, err)
	}
	stalePause := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "lock-attempt", Username: a.Username, Transport: a.Transport, Body: Request{ID: a.ID, Generation: held.Generation, Reason: "old already completed pause"}}
	if value, err := e.Command(signedCommand(key, stalePause), a.Username, a.Transport); err != nil || value.(*Attempt).State != "ACTIVE" {
		t.Fatal("delayed original pause revoked a successfully continued owner", value, err)
	}
	if mode == "clock-live" || mode == "clock-recording-fault" {
		request := resetRequest(active)
		request.ResetID, request.RemainingSeconds, request.ExtendSeconds = ManagementID(), 0, 60
		clock := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "reset-clock", Username: a.Username, Transport: a.Transport, Body: request}
		if _, err := e.Command(signedCommand(key, clock), a.Username, a.Transport); err != nil {
			t.Fatal("completed Continue receipt incorrectly blocked clock management", err)
		}
		state, err := readStateSnapshot(e.Config.State)
		if err != nil {
			t.Fatal(err)
		}
		a = state.Attempts[a.ID]
		if a.State != "ACTIVE" || a.Deadline != active.Deadline+60000 || a.Start != active.Start || a.OriginalDeadline != active.OriginalDeadline {
			t.Fatal("post-Continue clock changed original authority", a)
		}
		if err := e.refreshTerminalMonitoring(context.Background(), a.ID, *a.RegisteredOwner); err != nil {
			t.Fatal("post-Continue clock could not renew", err)
		}
		write(2, 0, []byte("check\n"))
		if _, err := supervisionReadUntil(fd, "BUFFER:synthetic-buffer-not-on-disk:", time.Second); err != nil {
			t.Fatal("post-Continue clock lost live input", err)
		}
	}
	authorize(0)
	pausedAgain, err := e.Admin("pause", a.ID, "synthetic second retained pause")
	if err != nil {
		t.Fatal("second policy hold failed", err)
	}
	second := pausedAgain.(*Attempt)
	resume.Body.Generation, resume.Nonce = second.Generation, Token()
	if _, err := e.Command(signedCommand(key, resume), a.Username, a.Transport); err == nil {
		t.Fatal("second pause reused the first approval")
	}
	authorize(4)
	resume.Nonce = Token()
	resumedAgain, err := e.Command(signedCommand(key, resume), a.Username, a.Transport)
	if err != nil {
		t.Fatal("second approved continuation failed", err)
	}
	newEpoch := resumedAgain.(map[string]any)["input_epochs"].(map[string]string)[finalID]
	if newEpoch == capability["input_epoch"] || newEpoch == "" {
		t.Fatal("second Continue reused an input epoch")
	}
	write(1000, 0, []byte("finish\n"))
	capability["input_epoch"] = newEpoch
	write(1, 0, []byte("check\n"))
	again, err := supervisionReadUntil(fd, "BUFFER:synthetic-buffer-not-on-disk:", time.Second)
	if err != nil || line(again) != line(beforeMemory) {
		t.Fatal("second hold/Continue lost the same shell memory", again, err)
	}
	if strings.Contains(mode, "recording-fault") {
		state, err := readStateSnapshot(e.Config.State)
		if err != nil {
			t.Fatal(err)
		}
		before := *state.Attempts[a.ID]
		found := false
		for _, proof := range state.PaneInstances {
			if proof.Attempt == a.ID && proof.Pane == finalID && proof.ReadyAt > 0 && !proof.RecordingClosed {
				found = proof.RecordingIdentity.Generation < before.Generation
			}
		}
		if !found || before.State != "ACTIVE" || !currentRegisteredOwner(&before) {
			t.Fatal("fixture did not retain the original recording across actual approved generations", before)
		}
		observed, err := ObserveTerminalRecordingReports(e.Config.State, a.ID)
		if err != nil || !observed.CanonicalAvailable || len(observed.PendingCaptured) != 1 ||
			observed.PendingCaptured[0].ContinuedGeneration != before.Generation || observed.PendingCaptured[0].Generation >= before.Generation {
			t.Fatal("operator report does not expose durable original/continued recording generations", observed, err)
		}
		if mode == "recording-fault-replacement" {
			// As in the legacy stale-owner control, replace only this private
			// fixture's canonical generation. It has no authorized association
			// to the old recorder, even with otherwise identical account fields.
			if err := e.WithState(func() error {
				current := e.state.Attempts[a.ID]
				current.Generation++
				owner := *current.RegisteredOwner
				owner.Generation = current.Generation
				current.RegisteredOwner = &owner
				before = *current
				return nil
			}); err != nil {
				t.Fatal(err)
			}
		}
		// Unlink only this synthetic pane's pinned log. Its zero link count
		// makes the actual capture append fail, before any output is delivered.
		if err := os.Remove(filepath.Join(e.Config.State, "monitoring", a.ID, finalID+".ndjson")); err != nil {
			t.Fatal(err)
		}
		write(2, 0, []byte("check\n"))
		select {
		case <-reconciled:
		case <-time.After(5 * time.Second):
			t.Fatal("actual continued recorder fault did not reach canonical reconciliation")
		}
		after, err := readStateSnapshot(e.Config.State)
		if err != nil {
			t.Fatal(err)
		}
		failed := after.Attempts[a.ID]
		if mode == "recording-fault-replacement" {
			if failed.State != "ACTIVE" || failed.Generation != before.Generation || failed.Reason != before.Reason {
				t.Fatal("retired continued recorder fault locked an unrelated generation", failed)
			}
		} else if failed.State != "LOCKED" || failed.Generation != before.Generation+1 || failed.Reason != "Class-server terminal recording failure" {
			t.Fatal("continued current recorder fault was retired instead of enforced", failed)
		}
		if failed.Start != before.Start || failed.Deadline != before.Deadline || failed.OriginalDeadline != before.OriginalDeadline || failed.AccessState != before.AccessState {
			t.Fatal("recording fault changed the allowance or original account hold", failed)
		}
		if err := client.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
			t.Fatal(err)
		}
		var ended map[string]any
		if err := json.NewDecoder(client).Decode(&ended); err != nil || !strings.Contains(fmt.Sprint(ended["error"]), "no student violation") {
			t.Fatal("actual continued pane fault did not report an infrastructure error", ended, err)
		}
		return
	}
	// Explicit close uses the normal terminal EOF cleanup; no test sends a
	// student-UID-wide signal or pretends input revocation proves writer freeze.
	master.Close()
	if err := client.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatal(err)
	}
	var ended map[string]any
	if err := json.NewDecoder(client).Decode(&ended); err != nil || ended["ended"] != true {
		t.Fatal("actual monitored pane EOF did not cleanly end", ended, err)
	}
}
