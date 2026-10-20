package core

import (
	"os"
	"path/filepath"
	"testing"
)

func preflightFixture(t *testing.T, age int64) (*Engine, Config) {
	t.Helper()
	e, c, _ := finalFixture(t, "PREPARING", Millis()+5400000)
	if err := e.WithState(func() error {
		a := e.state.Attempts[finalID]
		a.Start, a.Deadline, a.OriginalDeadline = 0, 0, 0
		a.PreflightStartedAt = Millis() - age
		a.AccessState = ""
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return e, c
}

func TestPreflightTimeoutWithoutBrowserSurvivesAgentRestart(t *testing.T) {
	e, c := preflightFixture(t, PreflightTimeoutMillis+1000)
	var initial int64
	if err := e.WithState(func() error {
		a := e.state.Attempts[finalID]
		initial = a.PreflightStartedAt
		e.state.Caps["old"] = Capability{ID: a.ID, Purpose: "practice"}
		a.Handoff = &SSHHandoff{ID: "unused"}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	// A fresh engine, with no browser or gateway and no persisted timer reset.
	restarted, err := New(c)
	if err != nil {
		t.Fatal(err)
	}
	if err := restarted.Tick(); err != nil {
		t.Fatal(err)
	}
	a := inspectFinal(t, restarted)
	if a.State != "CANCELLED_BEFORE_START" || a.PreflightStartedAt != initial || a.Start != 0 || a.Deadline != 0 || a.OriginalDeadline != 0 || a.Reason != PreflightExpiredReason || a.Ended == 0 || a.Handoff != nil {
		t.Fatalf("bad expired preflight: %+v", a)
	}
	if err := restarted.WithState(func() error {
		if len(restarted.state.Caps) != 0 || restarted.Busy(a.UID) != nil {
			t.Fatal("expired preflight still reserves the account or capabilities")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(c.State, "submissions", finalID)); !os.IsNotExist(err) {
		t.Fatal("unstarted expiry attempted submission collection")
	}
}

func TestExpiredPreflightCannotActivateOrIssuePracticeEvenBeforeTick(t *testing.T) {
	for _, op := range []string{"activate-attempt", "issue-channel-admission"} {
		t.Run(op, func(t *testing.T) {
			e, _ := preflightFixture(t, PreflightTimeoutMillis)
			a := inspectFinal(t, e)
			if err := workloadAllowed(a, "practice"); err == nil {
				t.Fatal("expired practice admitted")
			}
			if _, err := e.Call(op, Request{ID: finalID, Username: a.Username, Transport: a.Transport, Pane: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", Purpose: "practice"}); err == nil {
				t.Fatal("expired preparation admitted")
			}
			if a := inspectFinal(t, e); a.Start != 0 || a.Deadline != 0 || a.State != "CANCELLED_BEFORE_START" {
				t.Fatalf("expired preparation acquired an exam interval: %+v", a)
			}
		})
	}
}

func TestPreflightTimerNotRenewedAndNeverCancelsStartedExam(t *testing.T) {
	if PreflightTimeoutMillis != 15*60*1000 {
		t.Fatal("preflight timeout must be fifteen minutes")
	}
	e, _ := preflightFixture(t, 5*60*1000+1000)
	before := inspectFinal(t, e).PreflightStartedAt
	if err := e.Tick(); err != nil {
		t.Fatal(err)
	}
	if a := inspectFinal(t, e); a.State != "PREPARING" || a.PreflightStartedAt != before {
		t.Fatal("fresh preparation expired or timer renewed")
	}
	if err := e.WithState(func() error {
		a := e.state.Attempts[finalID]
		a.PreflightStartedAt = Millis() - 10*PreflightTimeoutMillis
		commitStart(a, Millis(), uptime(), boot())
		a.State = "ACTIVE"
		a.Lease = Millis() + 15000
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := e.Tick(); err != nil {
		t.Fatal(err)
	}
	if a := inspectFinal(t, e); a.State != "ACTIVE" || a.Deadline-a.Start != 5400000 {
		t.Fatal("preflight timeout changed the timed exam or consumed exam time")
	}
}

func TestPreflightReauthenticationAndLegacyRestartDoNotRenewTimer(t *testing.T) {
	e, c := preflightFixture(t, 10000)
	before := inspectFinal(t, e).PreflightStartedAt
	if err := e.WithState(func() error {
		e.state.Registrations["replacement"] = "student"
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Call("prepare-attempt", Request{ID: finalID, Username: "student", UID: 1001, Transport: "replacement"}); err != nil {
		t.Fatal(err)
	}
	if a := inspectFinal(t, e); a.PreflightStartedAt != before {
		t.Fatal("reattaching preparation renewed its timer")
	}
	if err := e.WithState(func() error {
		e.state.Attempts[finalID].PreflightStartedAt = 0
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := e.Tick(); err != nil {
		t.Fatal(err)
	}
	before = inspectFinal(t, e).PreflightStartedAt
	if before == 0 {
		t.Fatal("legacy timer not initialized")
	}
	restarted, err := New(c)
	if err != nil {
		t.Fatal(err)
	}
	if err := restarted.Tick(); err != nil {
		t.Fatal(err)
	}
	if a := inspectFinal(t, restarted); a.PreflightStartedAt != before {
		t.Fatal("legacy grace period renewed on restart")
	}
}

func TestExpiredPreflightRestoresAppliedSetupOnlyAfterConfirmation(t *testing.T) {
	e := temporaryFixture(t, "PREPARING", Millis()+5400000)
	if err := e.WithState(func() error {
		e.state.Attempts[finalID].PreflightStartedAt = Millis() - PreflightTimeoutMillis
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := e.Tick(); err != nil {
		t.Fatal(err)
	}
	if a := inspectFinal(t, e); a.State != "CANCELLED_BEFORE_START" || !accessHeld(a) {
		t.Fatal("expired applied setup was not cancelled or was prematurely restored")
	}
	restores := 0
	e.policyRun = func(op, user, id, generation string) ([]byte, error) {
		if op != "restore" || user != "student" || id != finalID {
			t.Fatal("expiry touched an unrelated account or operation")
		}
		restores++
		return policyOK(op, user, id, generation)
	}
	if err := e.ReconcilePolicies(); err != nil {
		t.Fatal(err)
	}
	if a := inspectFinal(t, e); a.PolicyState != "NORMAL" || accessHeld(a) || a.Start != 0 || a.Deadline != 0 || restores != 1 {
		t.Fatal("unstarted account setup did not restore for fresh login")
	}
}
