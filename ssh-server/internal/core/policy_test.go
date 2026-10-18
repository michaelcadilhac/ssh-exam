package core

import (
	"encoding/json"
	"errors"
	"testing"
	"time"
)

func temporaryFixture(t *testing.T, state string, deadline int64) *Engine {
	t.Helper()
	e, _, _ := finalFixture(t, state, deadline)
	e.Config.TemporaryAccountPolicy = true
	e.Config.Accounts = map[string]Account{}
	if err := e.WithState(func() error {
		e.state.Accounts["student"] = Account{UID: 1001, GID: 1001, Home: "/home/student", Shell: "/bin/bash"}
		a := e.state.Attempts[finalID]
		a.PolicyGeneration = Token()
		a.PolicyState = "HELD"
		a.AccessState = "HELD"
		a.OriginalDeadline = a.Deadline
		a.OriginalUptimeDeadline = a.UptimeDeadline
		if state == "PREPARING" {
			a.Start = 0
			a.Deadline = 0
			a.OriginalDeadline = 0
			a.UptimeDeadline = 0
			a.OriginalUptimeDeadline = 0
			a.PolicyState = "READY"
			a.PolicyExpires = Millis() + 300000
			a.PolicyReadyBoot = boot()
			a.PolicyReadyUptime = 10
			a.Transport = "old"
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return e
}
func policyOK(op, user, id, generation string) ([]byte, error) {
	return json.Marshal(policyReceipt{Attempt: id, Generation: generation, Phase: "NORMAL"})
}

func TestTemporaryEarlyFinishDoesNotRestoreEvenInSandbox(t *testing.T) {
	for _, exam := range []string{"exam", SandboxExamID} {
		t.Run(exam, func(t *testing.T) {
			e := temporaryFixture(t, "ACTIVE", Millis()+5400000)
			e.WithState(func() error { e.state.Attempts[finalID].Exam = exam; return nil })
			calls := 0
			e.policyRun = func(op, user, id, generation string) ([]byte, error) {
				calls++
				return policyOK(op, user, id, generation)
			}
			if _, err := e.Call("finalize-attempt", Request{ID: finalID, Reason: "student finish"}); err != nil {
				t.Fatal(err)
			}
			if err := e.ReconcilePolicies(); err != nil {
				t.Fatal(err)
			}
			a := inspectFinal(t, e)
			if calls != 0 || a.AccessState != "HELD" || a.PolicyState != "HELD" || !a.Protected {
				t.Fatalf("early finish released policy: %+v", a)
			}
		})
	}
}
func TestTemporaryReleaseRequiresActualRestorationAndRetries(t *testing.T) {
	e := temporaryFixture(t, "ACTIVE", Millis()-1000)
	e.WithState(func() error {
		a := e.state.Attempts[finalID]
		a.UptimeDeadline = uptime() - 1
		a.OriginalUptimeDeadline = a.UptimeDeadline
		return nil
	})
	if _, err := e.Call("finalize-attempt", Request{ID: finalID, Reason: "deadline"}); err != nil {
		t.Fatal(err)
	}
	if a := inspectFinal(t, e); a.AccessState != "HELD" || a.PolicyState != "RESTORE_PENDING" {
		t.Fatalf("released without restoration: %+v", a)
	}
	e.policyRun = func(string, string, string, string) ([]byte, error) { return nil, errors.New("NSS cache unavailable") }
	if e.ReconcilePolicies() == nil {
		t.Fatal("restoration failure hidden")
	}
	if a := inspectFinal(t, e); a.AccessState != "HELD" || a.PolicyState != "RESTORE_FAILED" {
		t.Fatal("failure released account")
	}
	restarted, err := New(e.Config)
	if err != nil {
		t.Fatal(err)
	}
	restarted.terminate = func(*Attempt) error { return nil }
	restarted.policyRun = policyOK
	if err := restarted.ReconcilePolicies(); err != nil {
		t.Fatal(err)
	}
	if a := inspectFinal(t, restarted); a.AccessState != "RELEASED" || a.PolicyState != "NORMAL" {
		t.Fatalf("retry failed: %+v", a)
	}
}
func TestTemporaryAbandonedSetupAndHelperDoNotHoldGlobalLock(t *testing.T) {
	e := temporaryFixture(t, "PREPARING", Millis()+5400000)
	e.WithState(func() error { e.state.Attempts[finalID].PolicyExpires = Millis() - 1; return nil })
	entered := make(chan struct{})
	release := make(chan struct{})
	done := make(chan error, 1)
	e.policyRun = func(op, user, id, generation string) ([]byte, error) {
		close(entered)
		<-release
		return policyOK(op, user, id, generation)
	}
	go func() { done <- e.ReconcilePolicies() }()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("helper not called")
	}
	read := make(chan error, 1)
	go func() { read <- e.WithState(func() error { return nil }) }()
	select {
	case err := <-read:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		close(release)
		t.Fatal("slow helper held global state/deadline lock")
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	a := inspectFinal(t, e)
	if a.Start != 0 || a.State != "CANCELLED_BEFORE_START" || a.PolicyState != "NORMAL" || accessHeld(a) {
		t.Fatalf("abandoned setup not restored: %+v", a)
	}
}
func TestTemporaryBootstrapAndMultiplexedTransportRejected(t *testing.T) {
	e := temporaryFixture(t, "PREPARING", Millis()+5400000)
	a := inspectFinal(t, e)
	e.transportUptime = func(int) (float64, error) { return 9, nil }
	if e.freshPolicyTransport(a, 123) == nil {
		t.Fatal("old SSH monitor accepted")
	}
	e.transportUptime = func(int) (float64, error) { return 11, nil }
	if err := e.freshPolicyTransport(a, 123); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Call("activate-attempt", Request{ID: finalID}); err == nil {
		t.Fatal("bootstrap activated without protected transport")
	}
}
func TestTemporarySignedRegistrationDoesNotApplyPolicy(t *testing.T) {
	e, _, _ := finalFixture(t, "ACTIVE", Millis()+5400000)
	key := commandKeys(t, e)
	e.Config.Accounts = map[string]Account{}
	e.Config.TemporaryAccountPolicy = true
	e.WithState(func() error { delete(e.state.Attempts, finalID); return nil })
	calls := []string{}
	e.policyRun = func(op, user, id, generation string) ([]byte, error) {
		calls = append(calls, op)
		return json.Marshal(Account{UID: 1001, GID: 1001, Home: "/home/student", Shell: "/bin/bash"})
	}
	cmd := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "register", Username: "student", Body: Request{Exam: "exam"}}
	if _, err := e.command(signedCommand(key, cmd), "student", "bootstrap", 123); err != nil {
		t.Fatal(err)
	}
	if len(calls) != 1 || calls[0] != "identify" {
		t.Fatal("sign-in changed account policy", calls)
	}
	e.WithState(func() error {
		if a := e.state.Accounts["student"]; a.UID != 1001 {
			t.Fatal("identity not persisted")
		}
		return nil
	})
}
func TestTemporaryStaleRestorationReceiptDoesNotRelease(t *testing.T) {
	e := temporaryFixture(t, "PREPARING", Millis()+5400000)
	e.WithState(func() error { e.state.Attempts[finalID].PolicyExpires = 1; return nil })
	e.policyRun = func(op, user, id, generation string) ([]byte, error) { return policyOK(op, user, id, Token()) }
	if e.ReconcilePolicies() == nil {
		t.Fatal("stale generation accepted")
	}
	if a := inspectFinal(t, e); a.PolicyState != "RESTORE_FAILED" || !accessHeld(a) {
		t.Fatal("stale helper receipt released account")
	}
}

func TestTemporaryUncertainStartNeverRestoresAsAbandoned(t *testing.T) {
	e := temporaryFixture(t, "PREPARING", Millis()+5400000)
	e.WithState(func() error { a := e.state.Attempts[finalID]; a.State = "ACTIVATING"; a.PolicyExpires = 1; return nil })
	e.policyRun = func(string, string, string, string) ([]byte, error) {
		t.Fatal("uncertain activation restored")
		return nil, nil
	}
	if err := e.ReconcilePolicies(); err != nil {
		t.Fatal(err)
	}
	if a := inspectFinal(t, e); a.PolicyRestoreAuthorized || a.State != "ACTIVATING" {
		t.Fatal("uncertain start discarded")
	}
	if _, err := e.Call("cancel-attempt", Request{ID: finalID}); err == nil {
		t.Fatal("uncertain activation cancelled")
	}
}
