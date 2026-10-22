package core

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestHealthObservationSlowProbeDoesNotHoldStateOrBlockSignedInspection(t *testing.T) {
	for _, route := range []string{"native-call", "signed-command", "configuration-report"} {
		t.Run(route, func(t *testing.T) {
			e, _, _ := finalFixture(t, "ACTIVE", Millis()+5400000)
			key := commandKeys(t, e)
			if err := e.WithState(func() error {
				e.state.Attempts[finalID].Transport = "ssh-a"
				e.state.Registrations["ssh-a"] = "student"
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			before, _ := readStateSnapshot(e.Config.State)
			reader, writer, err := os.Pipe()
			if err != nil {
				t.Fatal(err)
			}
			defer reader.Close()
			defer writer.Close()
			entered := make(chan struct{})
			e.healthProbe = func() (bool, []string) {
				close(entered)
				_, err := io.Copy(io.Discard, reader) // Actual owned kernel-pipe backpressure.
				if err != nil {
					return false, []string{"synthetic probe unavailable"}
				}
				return false, []string{"synthetic probe completed; not production readiness"}
			}
			healthDone := make(chan error, 1)
			go func() {
				var err error
				switch route {
				case "native-call":
					_, err = e.Call("health", Request{})
				case "signed-command":
					cmd := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "health", Username: "student", Transport: "ssh-a"}
					_, err = e.Command(signedCommand(key, cmd), "student", "ssh-a")
				case "configuration-report":
					err = e.ReportConfiguration()
				}
				healthDone <- err
			}()
			select {
			case <-entered:
			case <-time.After(2 * time.Second):
				t.Fatal("health route did not reach controlled slow dependency")
			}
			inspection := make(chan error, 1)
			go func() {
				cmd := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "inspect-attempt", Username: "student", Transport: "ssh-a", Body: Request{ID: finalID}}
				_, err := e.Command(signedCommand(key, cmd), "student", "ssh-a")
				inspection <- err
			}()
			observed := false
			select {
			case err := <-inspection:
				observed = true
				if err != nil {
					t.Error("independent signed inspection failed", err)
				}
			case <-time.After(500 * time.Millisecond):
				t.Error("slow health/readiness IO owns shared state and blocks independent signed inspection")
			}
			writer.Close() // Release only this exact test dependency on RED and GREEN.
			select {
			case err := <-healthDone:
				if err != nil {
					t.Error(err)
				}
			case <-time.After(2 * time.Second):
				t.Fatal("health probe did not unwind")
			}
			if !observed {
				select {
				case err := <-inspection:
					if err != nil {
						t.Error(err)
					}
				case <-time.After(2 * time.Second):
					t.Fatal("inspection remained blocked after release")
				}
			}
			after, _ := readStateSnapshot(e.Config.State)
			a, b := before.Attempts[finalID], after.Attempts[finalID]
			if a.State != b.State || a.Start != b.Start || a.Deadline != b.Deadline || a.OriginalDeadline != b.OriginalDeadline || a.AccessState != b.AccessState || a.Protected != b.Protected || a.Transport != b.Transport || a.Lease != b.Lease {
				t.Fatal("health/inspection changed attempt authority")
			}
		})
	}
}

func TestHealthObservationBusyAndUntrustedRequestsCannotDispatchOrPublish(t *testing.T) {
	e, _, _ := finalFixture(t, "ACTIVE", Millis()+5400000)
	key := commandKeys(t, e)
	if err := e.WithState(func() error {
		e.state.Attempts[finalID].Transport = "ssh-a"
		e.state.Registrations["ssh-a"] = "student"
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int32
	entered, release := make(chan struct{}), make(chan struct{})
	e.healthProbe = func() (bool, []string) {
		if calls.Add(1) == 1 {
			close(entered)
			<-release
		}
		return false, []string{"synthetic not ready"}
	}
	done := make(chan error, 1)
	go func() { _, err := e.Call("health", Request{}); done <- err }()
	defer func() {
		close(release)
		if err := <-done; err != nil {
			t.Error(err)
		}
	}()
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("probe did not start")
	}
	stateBefore, _ := readStateSnapshot(e.Config.State)
	for _, route := range []string{"native", "signed", "report"} {
		var err error
		cmd := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "health", Username: "student", Transport: "ssh-a"}
		frame := signedCommand(key, cmd)
		switch route {
		case "native":
			_, err = e.Call("health", Request{})
		case "signed":
			_, err = e.Command(frame, "student", "ssh-a")
		case "report":
			err = e.ReportConfiguration()
		}
		if !errors.Is(err, errNativeHealthBusy) {
			t.Fatal("overlapping probe queued/dispatched or became readiness/policy success", route, err)
		}
		if route == "signed" {
			if _, err := e.Command(frame, "student", "ssh-a"); err == nil || !strings.Contains(err.Error(), "replay") {
				t.Fatal("busy signed request nonce was not durably consumed", err)
			}
			restarted, err := New(e.Config)
			if err != nil {
				t.Fatal(err)
			}
			restarted.healthProbe = func() (bool, []string) { calls.Add(100); return true, nil }
			if _, err := restarted.Command(frame, "student", "ssh-a"); err == nil || !strings.Contains(err.Error(), "replay") {
				t.Fatal("busy nonce replay survived restart", err)
			}
		}
	}
	for _, bad := range []string{"registration", "transport", "account", "expired", "signature"} {
		cmd := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "health", Username: "student", Transport: "ssh-a"}
		peer, transport := "student", "ssh-a"
		switch bad {
		case "registration":
			cmd.Transport = "unregistered"
			transport = "unregistered"
		case "transport":
			transport = "other"
		case "account":
			peer = "other"
		case "expired":
			cmd.Expires = Millis() - 1
		}
		frame := signedCommand(key, cmd)
		if bad == "signature" {
			frame.Signature = "invalid"
		}
		if _, err := e.Command(frame, peer, transport); err == nil || errors.Is(err, errNativeHealthBusy) {
			t.Fatal("untrusted health reached probe dispatch", bad, err)
		}
	}
	stateAfter, _ := readStateSnapshot(e.Config.State)
	if calls.Load() != 1 || len(stateAfter.Events) != len(stateBefore.Events) || stateAfter.Sequence != stateBefore.Sequence {
		t.Fatal("busy/invalid probes fanned out or published a false configuration event")
	}
	if stateAfter.Attempts[finalID].Deadline != stateBefore.Attempts[finalID].Deadline || stateAfter.Attempts[finalID].State != "ACTIVE" {
		t.Fatal("readiness contention altered active work")
	}
}

func TestHealthObservationPreservesBrokenStateRefusalBeforeProbeAndLockedPathRefuses(t *testing.T) {
	for _, route := range []string{"native", "signed", "report"} {
		t.Run(route, func(t *testing.T) {
			e, _, _ := finalFixture(t, "ACTIVE", Millis()+5400000)
			key := commandKeys(t, e)
			var calls atomic.Int32
			e.healthProbe = func() (bool, []string) { calls.Add(1); return true, nil }
			path := filepath.Join(e.Config.State, "state.json")
			if err := os.WriteFile(path, []byte("{broken-authority"), 0600); err != nil {
				t.Fatal(err)
			}
			var err error
			switch route {
			case "native":
				_, err = e.Call("health", Request{})
			case "signed":
				cmd := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "health", Username: "student", Transport: "ssh-a"}
				_, err = e.Command(signedCommand(key, cmd), "student", "ssh-a")
			case "report":
				err = e.ReportConfiguration()
			}
			data, _ := os.ReadFile(path)
			if err == nil || calls.Load() != 0 || string(data) != "{broken-authority" {
				t.Fatal("health bypassed broken authority, dispatched IO or repaired state", err)
			}
		})
	}
	e, _, _ := finalFixture(t, "ACTIVE", Millis()+5400000)
	e.healthProbe = func() (bool, []string) { t.Error("locked fallback dispatched readiness"); return true, nil }
	if err := e.WithState(func() error { _, err := e.callLocked("health", Request{}); return err }); err == nil {
		t.Fatal("new locked caller could restore slow health IO")
	}
}

func TestHealthObservationNeverSubstitutesForFreshBeginGuards(t *testing.T) {
	e, _ := workspaceFixture(t)
	if _, err := e.Call("prepare-workspace", Request{ID: finalID}); err != nil {
		t.Fatal(err)
	}
	var health, guards atomic.Int32
	e.healthProbe = func() (bool, []string) { health.Add(1); return true, nil } // Synthetic observation, not actual readiness.
	e.activationPrepare = func(*Attempt) error { guards.Add(1); return errors.New("synthetic actual Begin guard refusal") }
	if result, err := e.Call("health", Request{}); err != nil || result.(map[string]any)["ready"] != true {
		t.Fatal("synthetic health fixture", err)
	}
	if _, err := e.Call("activate-attempt", Request{ID: finalID}); err == nil || !strings.Contains(err.Error(), "actual Begin guard refusal") {
		t.Fatal("health bypassed fresh Begin guard", err)
	}
	if health.Load() != 1 || guards.Load() != 1 {
		t.Fatal("Begin reused or refreshed health in place of actual guard")
	}
	assertUnstartedWorkspace(t, e, finalID)
}
