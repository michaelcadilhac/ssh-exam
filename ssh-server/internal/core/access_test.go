package core

import (
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEarlyProtectedSubmissionRetainsOriginalIntervalHold(t *testing.T) {
	e, c, _ := finalFixture(t, "ACTIVE", Millis()+5400000)
	original := inspectFinal(t, e).Deadline
	if _, err := e.Call("finalize-attempt", Request{ID: finalID, Reason: "student finish"}); err != nil {
		t.Fatal(err)
	}
	second, _ := New(c)
	for _, engine := range []*Engine{e, second} {
		if err := engine.WithState(func() error {
			a := engine.state.Attempts[finalID]
			if a.State != "COMPLETED" || !a.Protected || a.AccessState != "HELD" || a.Deadline != original {
				t.Fatalf("early finish changed interval: %+v", a)
			}
			if engine.ordinaryAccess(a.UID) == nil || engine.registrationAllowed(a.UID) == nil {
				t.Fatal("ordinary/recovery access reopened")
			}
			if engine.ordinaryAccess(a.UID+1) != nil {
				t.Fatal("other student disrupted")
			}
			return nil
		}); err != nil {
			t.Fatal(err)
		}
	}
	for _, op := range []string{"authorize-continuation", "consume-continuation", "attach-transport", "issue-channel-admission"} {
		if _, err := second.Call(op, Request{ID: finalID, Username: "student", Transport: "forged", Pane: finalID, Expires: Millis() + 60000}); err == nil {
			t.Fatalf("finished attempt reopened via %s", op)
		}
	}
	if _, err := second.Call("delete-submission", Request{ID: finalID}); err == nil {
		t.Fatal("protected copy deleted during hold")
	}
}
func TestAccessReleaseRequiresElapsedOriginalIntervalAndVerifiedProtection(t *testing.T) {
	for _, scenario := range []string{"secured", "failed", "corrupt", "clock-forward"} {
		t.Run(scenario, func(t *testing.T) {
			e, c, _ := finalFixture(t, "ACTIVE", Millis()-1000)
			e.WithState(func() error {
				a := e.state.Attempts[finalID]
				if scenario != "clock-forward" {
					a.UptimeDeadline = uptime() - 1
				}
				return nil
			})
			if scenario == "failed" {
				e.WithState(func() error { e.state.Attempts[finalID].State = "COLLECTION_FAILED"; return nil })
			} else {
				if _, err := e.Call("finalize-attempt", Request{ID: finalID, Reason: "expiration"}); err != nil {
					t.Fatal(err)
				}
			}
			if scenario == "corrupt" {
				os.WriteFile(filepath.Join(c.State, "submissions", finalID, "submission.tar.gz"), []byte("corrupt"), 0600)
			}
			a := inspectFinal(t, e)
			if (a.AccessState == "RELEASED") != (scenario == "secured") {
				t.Fatalf("incorrect access release: %s %s", scenario, a.AccessState)
			}
		})
	}
}
func TestMissingOrMalformedAdministratorStateFailsClosed(t *testing.T) {
	e, c, _ := finalFixture(t, "ACTIVE", Millis()+5400000)
	os.Remove(filepath.Join(c.State, "state.json"))
	if err := e.WithState(func() error { return e.ordinaryAccess(1001) }); err == nil {
		t.Fatal("lost state opened account")
	}
	os.WriteFile(filepath.Join(c.State, "state.json"), []byte(`{"attempts":null}`), 0600)
	second, _ := New(c)
	if err := second.WithState(func() error { return second.ordinaryAccess(1001) }); err == nil {
		t.Fatal("malformed state opened account")
	}
}
func TestLegacyCompletedRecordsUpgradeToHeld(t *testing.T) {
	e, _, _ := finalFixture(t, "ACTIVE", Millis()+5400000)
	e.WithState(func() error {
		a := e.state.Attempts[finalID]
		a.State = "COMPLETED"
		a.AccessState = ""
		a.Protected = true
		return nil
	})
	if inspectFinal(t, e).AccessState != "HELD" {
		t.Fatal("legacy completion opened account")
	}
}
func TestScheduledOrDetachedWriterRejectsIsolation(t *testing.T) {
	e, _, _ := finalFixture(t, "ACTIVE", Millis()+5400000)
	t.Setenv("EXAM_ID", "exam")
	t.Setenv("EXAM_ATTEMPT_ID", finalID)
	// Running test process models an arbitrary UID writer outside managed scopes.
	if err := e.WithState(func() error {
		a := e.state.Attempts[finalID]
		a.UID = os.Getuid()
		if e.verifyWriters(a) == nil {
			t.Fatal("uncontained writer accepted")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}
func TestEmergencyOverrideIsNotGatewayOperation(t *testing.T) {
	e, _, _ := finalFixture(t, "ACTIVE", Millis()+5400000)
	if _, err := e.Call("override-access", Request{ID: finalID, Reason: "forged emergency"}); err == nil {
		t.Fatal("gateway override")
	}
	if _, err := e.OverrideAccess(finalID, "operator emergency"); err == nil {
		t.Fatal("unsecured/nonroot override succeeded")
	}
}
func gateTestListener(t *testing.T, e *Engine) string {
	t.Helper()
	socket := filepath.Join(t.TempDir(), "gate.sock")
	l, err := net.ListenUnix("unix", &net.UnixAddr{Name: socket, Net: "unix"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { l.Close() })
	go func() {
		for {
			c, err := l.AcceptUnix()
			if err != nil {
				return
			}
			go e.local(c)
		}
	}()
	return socket
}
func TestActualPeerGateBlocksAllOrdinaryRoutesAfterEarlyFinish(t *testing.T) {
	e, c, _ := finalFixture(t, "ACTIVE", Millis()+5400000)
	e.Config.Accounts = map[string]Account{"student": {UID: os.Getuid(), Shell: "/bin/bash", Home: t.TempDir()}}
	e.WithState(func() error { e.state.Attempts[finalID].UID = os.Getuid(); return nil })
	socket := gateTestListener(t, e)
	if _, err := e.Call("finalize-attempt", Request{ID: finalID, Reason: "student finish"}); err != nil {
		t.Fatal(err)
	}
	for _, route := range []string{"shell", "remote-command", "sftp", "scp", "existing-multiplex-channel", "forged-EXAM_ID", "browser-reload"} {
		t.Run(route, func(t *testing.T) {
			conn, err := net.DialUnix("unix", nil, &net.UnixAddr{Name: socket, Net: "unix"})
			if err != nil {
				t.Fatal(err)
			}
			defer conn.Close()
			data, _ := json.Marshal(LocalRequest{Ordinary: true})
			if _, _, err = conn.WriteMsgUnix(data, nil, nil); err != nil {
				t.Fatal(err)
			}
			var response map[string]string
			if err = json.NewDecoder(conn).Decode(&response); err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(response["error"], "restricted") || response["shell"] != "" {
				t.Fatalf("%s bypass: %v", route, response)
			}
		})
	}
	second, _ := New(c)
	second.Config.Accounts = e.Config.Accounts
	second.WithState(func() error {
		if second.ordinaryAccess(os.Getuid()) == nil {
			t.Fatal("restart bypass")
		}
		return nil
	})
}

func TestEveryNewWorkloadChannelRequiresCurrentAttemptAuthorization(t *testing.T) {
	a := &Attempt{State: "ACTIVE", Start: Millis() - 1000, Deadline: Millis() + 5400000, Lease: Millis() + 15000, AccessState: "HELD", Boot: boot(), UptimeDeadline: uptime() + 5400}
	if err := workloadAllowed(a, "exam"); err != nil {
		t.Fatal(err)
	} // Reused authenticated transport/panes remain supported.
	if workloadAllowed(a, "practice") == nil || workloadAllowed(a, "forged") == nil {
		t.Fatal("stale practice/forged purpose admitted")
	}
	for _, state := range []string{"LOCKED", "FINALIZING", "COLLECTION_FAILED", "COMPLETED"} {
		a.State = state
		if workloadAllowed(a, "exam") == nil {
			t.Fatalf("channel admitted in %s", state)
		}
	}
	a.State = "ACTIVE"
	a.Lease = Millis() - 1
	if workloadAllowed(a, "exam") == nil {
		t.Fatal("stale monitoring lease admitted")
	}
}
func TestUnfinishedAuthorizedRecoveryKeepsOriginalDeadline(t *testing.T) {
	e, _, _ := finalFixture(t, "LOCKED", Millis()+5400000)
	deadline := inspectFinal(t, e).Deadline
	if _, err := e.Call("authorize-continuation", Request{ID: finalID, Expires: Millis() + 60000}); err != nil {
		t.Fatal(err)
	}
	if err := e.WithState(func() error { return e.registrationAllowed(1001) }); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Call("consume-continuation", Request{ID: finalID}); err == nil {
		t.Fatal("continued without fresh SSH")
	}
	e.WithState(func() error {
		a := e.state.Attempts[finalID]
		a.Transport = "old"
		e.state.Registrations["old"] = "student"
		e.state.Registrations["fresh"] = "student"
		return nil
	})
	if _, err := e.Call("attach-transport", Request{ID: finalID, Username: "student", Transport: "old"}); err == nil {
		t.Fatal("old transport reused")
	}
	if _, err := e.Call("attach-transport", Request{ID: finalID, Username: "student", Transport: "fresh"}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Call("consume-continuation", Request{ID: finalID}); err != nil {
		t.Fatal(err)
	}
	a := inspectFinal(t, e)
	if a.State != "ACTIVE" || a.Deadline != deadline || a.AccessState != "HELD" {
		t.Fatalf("recovery changed policy %+v", a)
	}
}

func TestAuditedEmergencyOverrideNeverReopensExamOrChangesDeadline(t *testing.T) {
	e, c, _ := finalFixture(t, "ACTIVE", Millis()+5400000)
	deadline := inspectFinal(t, e).Deadline
	if _, err := e.Call("finalize-attempt", Request{ID: finalID, Reason: "student finish"}); err != nil {
		t.Fatal(err)
	}
	// Private safe-disposition routine; public root authorization is tested separately.
	if _, err := e.overrideSecuredAccess(finalID, "Emergency course account recovery approved by administrator"); err != nil {
		t.Fatal(err)
	}
	a := inspectFinal(t, e)
	if a.AccessState != "OVERRIDDEN" || a.Deadline != deadline || a.State != "COMPLETED" {
		t.Fatalf("override changed exam %+v", a)
	}
	audit, _ := os.ReadFile(filepath.Join(c.State, "audit.ndjson"))
	if !strings.Contains(string(audit), "emergency-access-override") || !strings.Contains(string(audit), "original_deadline") || !strings.Contains(string(audit), "Emergency course account") {
		t.Fatal("override not durably audited")
	}
	if _, err := e.Call("consume-continuation", Request{ID: finalID}); err == nil {
		t.Fatal("override reopened finished exam")
	}
}
func TestFailedOverrideAuditRetainsHold(t *testing.T) {
	e, c, _ := finalFixture(t, "ACTIVE", Millis()+5400000)
	if _, err := e.Call("finalize-attempt", Request{ID: finalID, Reason: "student finish"}); err != nil {
		t.Fatal(err)
	}
	os.Remove(filepath.Join(c.State, "audit.ndjson"))
	os.Mkdir(filepath.Join(c.State, "audit.ndjson"), 0700)
	if _, err := e.overrideSecuredAccess(finalID, "Emergency course account recovery"); err == nil {
		t.Fatal("unaudited override succeeded")
	}
	if inspectFinal(t, e).AccessState != "HELD" {
		t.Fatal("failed audit released hold")
	}
}
