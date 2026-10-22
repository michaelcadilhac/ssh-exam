package core

import (
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"net"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

func TestSignedClosePaneRevokesOnlyMatchingUnusedAdmissions(t *testing.T) {
	for _, state := range []string{"ACTIVE", "PREPARING"} {
		t.Run(state, func(t *testing.T) {
			e, key, command := leaseFixture(t)
			pane, otherPane := finalID, "98765432-1234-1234-1234-123456789abc"
			var matching []string
			var unrelated []string
			if err := e.WithState(func() error {
				a := e.state.Attempts[finalID]
				a.State, a.AccessState, a.Settings.Terminals = state, "HELD", 4
				if state == "PREPARING" {
					a.Start, a.PreflightStartedAt = 0, Millis()
				}
				for _, purpose := range []string{"practice", "exam"} {
					result := e.issue(Capability{Username: "student", ID: finalID, Pane: pane, Purpose: purpose, Transport: "ssh-a", Expires: Millis() + 15000}).(map[string]string)
					matching = append(matching, Hash([]byte(result["token"])))
				}
				for _, cap := range []Capability{
					{ID: finalID, Pane: otherPane}, {ID: otherPane, Pane: pane},
				} {
					cap.Expires = Millis() + 15000
					result := e.issue(cap).(map[string]string)
					unrelated = append(unrelated, Hash([]byte(result["token"])))
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			before, err := readStateSnapshot(e.Config.State)
			if err != nil {
				t.Fatal(err)
			}
			command.Op, command.Body = "close-pane", Request{ID: finalID, Pane: pane}
			if _, err := e.Command(signedCommand(key, command), "student", "ssh-a"); err != nil {
				t.Fatal(err)
			}
			restarted, err := New(e.Config)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := restarted.Command(signedCommand(key, command), "student", "ssh-a"); err == nil {
				t.Fatal("replayed close accepted")
			}
			after, err := readStateSnapshot(e.Config.State)
			if err != nil {
				t.Fatal(err)
			}
			for _, token := range matching {
				if _, found := after.Caps[token]; found {
					t.Fatal("closed pane retains unused admission after restart")
				}
			}
			for _, token := range unrelated {
				if _, found := after.Caps[token]; !found {
					t.Fatal("close revoked another pane/attempt")
				}
			}
			a, b := after.Attempts[finalID], before.Attempts[finalID]
			if a.State != b.State || a.Generation != b.Generation || a.Start != b.Start || a.Deadline != b.Deadline || a.OriginalDeadline != b.OriginalDeadline || a.AccessState != b.AccessState || a.Transport != b.Transport {
				t.Fatal("pane close changed attempt authority")
			}
		})
	}
}

func paneAdmissionFixture(t *testing.T) (*Engine, ed25519.PrivateKey, Command, string, *paneLaunchAdmission) {
	t.Helper()
	e, key, command := leaseFixture(t)
	if err := e.WithState(func() error {
		a := e.state.Attempts[finalID]
		a.AccessState, a.Settings.Terminals = "HELD", 4
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	command.Op, command.Body = "issue-channel-admission", Request{ID: finalID, Username: "student", Transport: "ssh-a", Pane: finalID, Purpose: "exam"}
	result, err := e.Command(signedCommand(key, command), "student", "ssh-a")
	if err != nil {
		t.Fatal(err)
	}
	token := result.(map[string]string)["token"]
	var pending *paneLaunchAdmission
	if err := e.WithState(func() error {
		account, _ := e.account("student")
		cap, a, err := e.paneAdmission(token, "student", "ssh-a", account)
		if err == nil {
			pending = &paneLaunchAdmission{capability: cap, account: account, authority: paneLaunchAuthority(a)}
		}
		return err
	}); err != nil {
		t.Fatal(err)
	}
	return e, key, command, token, pending
}

func launchTestPane(e *Engine, token string, pending *paneLaunchAdmission, start func(*Attempt, Capability) (bool, error)) error {
	return e.launchAcknowledgedPane(pending, token, "student", "exam-"+finalID+"-"+finalID+"-"+ManagementID()+".scope", func(Account) (string, error) { return "ssh-a", nil }, start)
}

func TestPaneAcknowledgementOutsideStateLockAndLateSignedCloseRefusesLaunch(t *testing.T) {
	e, key, command, token, pending := paneAdmissionFixture(t)
	listener, err := net.Listen("unix", filepath.Join(t.TempDir(), "ack.sock"))
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	client, err := net.Dial("unix", listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	server, err := listener.Accept()
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	finished := make(chan error, 1)
	started := false
	go func() {
		err := awaitPaneAcknowledgement(server, map[string]any{"attempt": finalID, "proof": "provisional-only"}, pending.capability.Expires)
		if err == nil {
			err = launchTestPane(e, token, pending, func(*Attempt, Capability) (bool, error) { started = true; return true, nil })
		}
		finished <- err
	}()
	_ = client.SetDeadline(time.Now().Add(3 * time.Second))
	var ready map[string]any
	if err := json.NewDecoder(client).Decode(&ready); err != nil || ready["proof"] != "provisional-only" {
		t.Fatal("real Unix ready response unavailable", err, ready)
	}
	other, err := New(e.Config)
	if err != nil {
		t.Fatal(err)
	}
	management := make(chan error, 1)
	go func() {
		command.Op, command.Nonce, command.Body = "renew-execution-lease", Token(), Request{ID: finalID}
		if _, err := other.Command(signedCommand(key, command), "student", "ssh-a"); err != nil {
			management <- err
			return
		}
		command.Op, command.Nonce = "inspect-attempt", Token()
		if _, err := other.Command(signedCommand(key, command), "student", "ssh-a"); err != nil {
			management <- err
			return
		}
		command.Op, command.Nonce, command.Body = "close-pane", Token(), Request{ID: finalID, Pane: finalID}
		_, err := other.Command(signedCommand(key, command), "student", "ssh-a")
		management <- err
	}()
	select {
	case err := <-management:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("unacknowledged pane blocks signed renewal/inspection/close")
	}
	if _, err := client.Write([]byte{1}); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-finished:
		if err == nil || started {
			t.Fatal("late ACK resurrected closed pane", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("late closed ACK did not settle")
	}
	state, err := readStateSnapshot(e.Config.State)
	if err != nil {
		t.Fatal(err)
	}
	a := state.Attempts[finalID]
	if len(a.Units) != 0 || a.State != "ACTIVE" || a.Deadline != pending.authority.Deadline || a.Generation != pending.authority.Generation || a.AccessState != "HELD" {
		t.Fatal("late ACK changed authority or allocated a scope")
	}
}

func TestPaneAcknowledgementRechecksEveryAuthorityAndCurrentOwner(t *testing.T) {
	changes := map[string]func(*Engine, *Attempt){
		"pause":        func(_ *Engine, a *Attempt) { a.State = "LOCKED" },
		"generation":   func(_ *Engine, a *Attempt) { a.Generation++ },
		"transport":    func(_ *Engine, a *Attempt) { a.Transport = "ssh-other" },
		"registration": func(e *Engine, _ *Attempt) { delete(e.state.Registrations, "ssh-a") },
		"uid":          func(_ *Engine, a *Attempt) { a.UID++ },
		"account": func(e *Engine, _ *Attempt) {
			account := e.Config.Accounts["student"]
			account.Home = "/different"
			e.Config.Accounts["student"] = account
		},
		"settings":           func(_ *Engine, a *Attempt) { a.Settings.Webcam = !a.Settings.Webcam },
		"deadline":           func(_ *Engine, a *Attempt) { a.Deadline += 1000 },
		"original-deadline":  func(_ *Engine, a *Attempt) { a.OriginalDeadline++ },
		"clock-revision":     func(_ *Engine, a *Attempt) { a.ClockRevision++ },
		"boot":               func(_ *Engine, a *Attempt) { a.Boot = "different-boot" },
		"start":              func(_ *Engine, a *Attempt) { a.Start++ },
		"work":               func(_ *Engine, a *Attempt) { a.WorkPath = "/different-work" },
		"policy":             func(_ *Engine, a *Attempt) { a.PolicyGeneration = "different-policy" },
		"policy-restoration": func(_ *Engine, a *Attempt) { a.PolicyRestoreAuthorized = true },
		"access":             func(_ *Engine, a *Attempt) { a.AccessState = "RELEASED" },
		"timing-unknown":     func(_ *Engine, a *Attempt) { a.TimingPendingSince = Millis() },
		"collection":         func(_ *Engine, a *Attempt) { a.CollectionJob = "new-job" },
		"completed":          func(_ *Engine, a *Attempt) { a.State, a.Protected = "COMPLETED", true },
		"cancelled":          func(_ *Engine, a *Attempt) { a.State, a.Start = "CANCELLED_BEFORE_START", 0 },
		"lease-expired":      func(_ *Engine, a *Attempt) { a.Lease = Millis() - 1 },
		"capability-expired": func(e *Engine, _ *Attempt) {
			for hash, cap := range e.state.Caps {
				cap.Expires = Millis() - 1
				e.state.Caps[hash] = cap
			}
		},
		"capability-replaced":   func(e *Engine, _ *Attempt) { e.revokePaneAdmissions(finalID, finalID) },
		"terminal-limit":        func(_ *Engine, a *Attempt) { a.Units = []string{"other1", "other2", "other3", "other4"} },
		"pane-already-recorded": func(_ *Engine, a *Attempt) { a.Units = []string{"exam-" + finalID + "-" + finalID + ".scope"} },
	}
	for name, change := range changes {
		t.Run(name, func(t *testing.T) {
			e, _, _, token, pending := paneAdmissionFixture(t)
			if err := e.WithState(func() error { change(e, e.state.Attempts[finalID]); return nil }); err != nil {
				t.Fatal(err)
			}
			started := false
			err := launchTestPane(e, token, pending, func(*Attempt, Capability) (bool, error) { started = true; return true, nil })
			if err == nil || started {
				t.Fatal("stale authority started code", err)
			}
		})
	}
	t.Run("actual-ancestry-lost", func(t *testing.T) {
		e, _, _, token, pending := paneAdmissionFixture(t)
		started := false
		err := e.launchAcknowledgedPane(pending, token, "student", "exam-"+finalID+"-"+finalID+".scope", func(Account) (string, error) { return "", errors.New("owned SSH exited") }, func(*Attempt, Capability) (bool, error) { started = true; return true, nil })
		if err == nil || started {
			t.Fatal("lost actual SSH ancestry started code")
		}
	})
}

func TestPaneAcknowledgementPreservesFreshRenewalsAndCommitsBeforeCode(t *testing.T) {
	e, key, command, token, pending := paneAdmissionFixture(t)
	command.Op, command.Nonce, command.Body = "renew-execution-lease", Token(), Request{ID: finalID}
	if _, err := e.Command(signedCommand(key, command), "student", "ssh-a"); err != nil {
		t.Fatal(err)
	}
	if err := e.WithState(func() error {
		a := e.state.Attempts[finalID]
		a.Units = []string{"exam-" + finalID + "-98765432-1234-1234-1234-123456789abc.scope"}
		a.Errors = []string{"non-authoritative diagnostic"}
		a.TimingNextCheck, a.TimingVerifiedAt = Millis()+10000, Millis()
		a.TimingVerifiedDeadline, a.TimingVerifiedRevision = a.Deadline, a.ClockRevision
		a.DeniedSSHTransports = []DeniedSSHTransport{{Identity: "refused-other-channel", Monitor: 123}}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	started := 0
	start := func(a *Attempt, cap Capability) (bool, error) {
		state, err := readStateSnapshot(e.Config.State)
		if err != nil {
			t.Fatal(err)
		}
		if _, found := state.Caps[Hash([]byte(token))]; found || !paneRecorded(state.Attempts[finalID], cap.Pane) {
			t.Fatal("code starts before durable token consumption and scope tracking")
		}
		if a.Deadline != pending.authority.Deadline || a.OriginalDeadline != pending.authority.OriginalDeadline || a.AccessState != "HELD" {
			t.Fatal("ACK changed clock/hold")
		}
		started++
		return true, nil
	}
	if err := launchTestPane(e, token, pending, start); err != nil {
		t.Fatal(err)
	}
	if err := launchTestPane(e, token, pending, start); err == nil || started != 1 {
		t.Fatal("one-use ACK replay started more code", err, started)
	}
}

func TestPaneAcknowledgementWireIsExactFiniteAndBounded(t *testing.T) {
	for _, name := range []string{"valid", "invalid", "timeout", "expired", "disconnect", "blocked-ready"} {
		t.Run(name, func(t *testing.T) {
			server, client := net.Pipe()
			defer server.Close()
			defer client.Close()
			expires := Millis() + 120
			if name == "expired" {
				expires = Millis() - 1
			}
			done := make(chan error, 1)
			result := map[string]any{"attempt": finalID, "proof": "signed-provisional-receipt"}
			go func() { done <- awaitPaneAcknowledgement(server, result, expires) }()
			if name != "expired" && name != "blocked-ready" {
				_ = client.SetDeadline(time.Now().Add(time.Second))
				var response map[string]any
				if err := json.NewDecoder(client).Decode(&response); err != nil || !reflect.DeepEqual(result, response) {
					t.Fatal("changed ready protocol", err, response)
				}
				switch name {
				case "valid":
					_, _ = client.Write([]byte{1})
				case "invalid":
					_, _ = client.Write([]byte{0})
				case "disconnect":
					_ = client.Close()
				}
			}
			select {
			case err := <-done:
				if (err == nil) != (name == "valid") {
					t.Fatal("wrong bounded ACK outcome", name, err)
				}
			case <-time.After(time.Second):
				t.Fatal("ACK/reply IO exceeded original expiry")
			}
		})
	}
}

func TestPaneAdmissionCommitFailureNeverStartsOrStrandsUnstartedScope(t *testing.T) {
	for _, name := range []string{"save", "exec", "started-error"} {
		t.Run(name, func(t *testing.T) {
			e, _, _, token, pending := paneAdmissionFixture(t)
			if name == "save" {
				if err := os.Mkdir(filepath.Join(e.Config.State, "state.json.tmp"), 0700); err != nil {
					t.Fatal(err)
				}
			}
			called := false
			err := launchTestPane(e, token, pending, func(*Attempt, Capability) (bool, error) {
				called = true
				return name == "started-error", errors.New("owned synthetic launch failure")
			})
			if err == nil || (name == "save" && called) {
				t.Fatal("failed persistence started code", err, called)
			}
			state, err := readStateSnapshot(e.Config.State)
			if err != nil {
				t.Fatal(err)
			}
			if paneRecorded(state.Attempts[finalID], finalID) != (name == "started-error") {
				t.Fatal("unstarted slot stranded or started workload untracked")
			}
		})
	}
}

func TestSignedCloseRevokesPendingAdmissionEvenWhenWorkloadCleanupRefuses(t *testing.T) {
	e, key, command, token, _ := paneAdmissionFixture(t)
	if err := e.WithState(func() error {
		e.state.Attempts[finalID].Units = []string{"exam-" + finalID + "-" + finalID + ".service"}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	// Ordinary students cannot have a host service. Refusal is deterministic and
	// must not invoke a manager, send a signal or erase the unsafe recorded scope.
	command.Op, command.Nonce, command.Body = "close-pane", Token(), Request{ID: finalID, Pane: finalID}
	if _, err := e.Command(signedCommand(key, command), "student", "ssh-a"); err == nil {
		t.Fatal("unsafe recorded service silently accepted")
	}
	state, err := readStateSnapshot(e.Config.State)
	if err != nil {
		t.Fatal(err)
	}
	if _, found := state.Caps[Hash([]byte(token))]; found || !paneRecorded(state.Attempts[finalID], finalID) {
		t.Fatal("cleanup error retained queued admission or dropped workload protection")
	}
}

func TestSignedNewPaneAdmissionSupersedesUnusedTokensAndRefusesRecordedPane(t *testing.T) {
	for _, suffix := range []string{".scope", ".service"} {
		t.Run(suffix, func(t *testing.T) {
			e, key, command := leaseFixture(t)
			if err := e.WithState(func() error {
				a := e.state.Attempts[finalID]
				a.AccessState, a.Settings.Terminals = "HELD", 4
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			command.Op, command.Body = "issue-channel-admission", Request{ID: finalID, Username: "student", Transport: "ssh-a", Pane: finalID, Purpose: "exam"}
			first, err := e.Command(signedCommand(key, command), "student", "ssh-a")
			if err != nil {
				t.Fatal(err)
			}
			command.Nonce = Token()
			second, err := e.Command(signedCommand(key, command), "student", "ssh-a")
			if err != nil {
				t.Fatal(err)
			}
			firstHash := Hash([]byte(first.(map[string]string)["token"]))
			secondHash := Hash([]byte(second.(map[string]string)["token"]))
			if err := e.WithState(func() error {
				if _, found := e.state.Caps[firstHash]; found {
					t.Error("superseded pane token remains usable")
				}
				if _, found := e.state.Caps[secondHash]; !found {
					t.Error("current pane token missing")
				}
				e.state.Attempts[finalID].Units = []string{"exam-" + finalID + "-" + finalID + suffix}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			command.Nonce = Token()
			if _, err := e.Command(signedCommand(key, command), "student", "ssh-a"); err == nil {
				t.Fatal("duplicate recorded pane admitted")
			}
		})
	}
}
