package core

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func closedPaneFixture(t *testing.T) (*Engine, string, *paneLaunchAdmission, string, PaneInstance) {
	t.Helper()
	e, _, _, token, pending := paneAdmissionFixture(t)
	unit := "exam-" + finalID + "-" + finalID + "-" + ManagementID() + ".scope"
	proof, err := e.reserveClosedPane(pending, token, "student", unit, func(Account) (string, error) { return "ssh-a", nil })
	if err != nil {
		t.Fatal(err)
	}
	return e, token, pending, unit, proof
}

func TestClosedPaneFinalReleaseIsDurableOneUseAndDoesNotReconstructOnRestart(t *testing.T) {
	e, token, p, unit, proof := closedPaneFixture(t)
	view := observeTestPane(t, e, finalID)
	if view.Unsafe || view.ClosedStartups != 1 || view.CancelledStartups != 0 || view.StartupExpires != p.capability.Expires || view.Revision == "" {
		t.Fatal("closed startup not safely inspectable/cancellable", view)
	}
	permitted := 0
	release := func() error {
		s, err := readStateSnapshot(e.Config.State)
		if err != nil {
			return err
		}
		if _, exists := s.Caps[Hash([]byte(token))]; exists || !paneInstanceReady(s, s.Attempts[finalID], unit, boot()) || s.PaneInstances[unit].ClosedUntil != 0 {
			return errors.New("exec released before durable one-use tracking/activation")
		}
		permitted++
		return nil
	}
	if err := e.releaseClosedPane(p, "student", unit, proof, func(Account) (string, error) { return "ssh-a", nil }, func() bool { return true }, release); err != nil || permitted != 1 {
		t.Fatal("valid live release failed", err, permitted)
	}
	if after := observeTestPane(t, e, finalID); after.ClosedStartups != 0 || after.Revision == view.Revision {
		t.Fatal("activation did not fence the old close review", after)
	}
	restarted, err := New(e.Config)
	if err != nil {
		t.Fatal(err)
	}
	if err := restarted.releaseClosedPane(p, "student", unit, proof, func(Account) (string, error) { return "ssh-a", nil }, func() bool { return true }, release); err == nil || permitted != 1 {
		t.Fatal("restart/replay released a persisted bootstrap", err, permitted)
	}
}

func TestClosedPaneFinalReleaseRefusesStaleAuthorityAndFailedDurability(t *testing.T) {
	changes := map[string]func(*Engine, *Attempt, string){
		"close": func(e *Engine, a *Attempt, _ string) {
			if _, err := e.closePaneLocked(a, finalID); err != nil {
				t.Fatal(err)
			}
		},
		"lock":         func(_ *Engine, a *Attempt, _ string) { a.State = "LOCKED" },
		"generation":   func(_ *Engine, a *Attempt, _ string) { a.Generation++ },
		"owner":        func(_ *Engine, a *Attempt, _ string) { a.Transport = "replacement" },
		"registration": func(e *Engine, _ *Attempt, _ string) { delete(e.state.Registrations, "ssh-a") },
		"account": func(e *Engine, _ *Attempt, _ string) {
			v := e.Config.Accounts["student"]
			v.Home = "/different"
			e.Config.Accounts["student"] = v
		},
		"uid":               func(_ *Engine, a *Attempt, _ string) { a.UID++ },
		"policy":            func(_ *Engine, a *Attempt, _ string) { a.PolicyGeneration = "different" },
		"settings":          func(_ *Engine, a *Attempt, _ string) { a.Settings.Webcam = !a.Settings.Webcam },
		"clock":             func(_ *Engine, a *Attempt, _ string) { a.ClockRevision++; a.Deadline++ },
		"deadline":          func(_ *Engine, a *Attempt, _ string) { a.Deadline = Millis() - 1 },
		"original-deadline": func(_ *Engine, a *Attempt, _ string) { a.OriginalDeadline++ },
		"lease":             func(_ *Engine, a *Attempt, _ string) { a.Lease = Millis() - 1 },
		"hold":              func(_ *Engine, a *Attempt, _ string) { a.AccessState = "RELEASED" },
		"pending-cancelled": func(e *Engine, _ *Attempt, u string) {
			v := e.state.PaneInstances[u]
			v.Cancelled = true
			e.state.PaneInstances[u] = v
		},
		"pending-expired": func(e *Engine, _ *Attempt, u string) {
			v := e.state.PaneInstances[u]
			v.ClosedUntil = Millis() - 1
			e.state.PaneInstances[u] = v
		},
		"pending-boot-expired": func(e *Engine, _ *Attempt, u string) {
			v := e.state.PaneInstances[u]
			v.ClosedBootUntil = 1
			e.state.PaneInstances[u] = v
		},
		"pending-missing": func(e *Engine, _ *Attempt, u string) { delete(e.state.PaneInstances, u) },
		"pending-replaced": func(e *Engine, _ *Attempt, u string) {
			v := e.state.PaneInstances[u]
			v.ID = ManagementID()
			e.state.PaneInstances[u] = v
		},
		"unit-missing": func(_ *Engine, a *Attempt, _ string) { a.Units = nil },
		"over-capacity": func(_ *Engine, a *Attempt, _ string) {
			a.Units = append(a.Units, "other1", "other2", "other3", "other4")
		},
		"no-change": func(_ *Engine, _ *Attempt, _ string) {},
	}
	for name, change := range changes {
		t.Run(name, func(t *testing.T) {
			e, _, p, unit, proof := closedPaneFixture(t)
			if err := e.WithState(func() error { change(e, e.state.Attempts[finalID], unit); return nil }); err != nil {
				t.Fatal(err)
			}
			if name == "no-change" {
				// Failed final persistence must not send even one permit byte.
				if err := os.Mkdir(filepath.Join(e.Config.State, "state.json.tmp"), 0700); err != nil {
					t.Fatal(err)
				}
			}
			called := false
			err := e.releaseClosedPane(p, "student", unit, proof, func(Account) (string, error) { return "ssh-a", nil }, func() bool { return true }, func() error { called = true; return nil })
			if err == nil || called {
				t.Fatal("stale/undurable startup released exec", err, called)
			}
		})
	}
	for _, name := range []string{"peer-gone", "ancestry-gone", "permit-failed", "peer-gone-after-save"} {
		t.Run(name, func(t *testing.T) {
			e, _, p, unit, proof := closedPaneFixture(t)
			checks, permits := 0, 0
			err := e.releaseClosedPane(p, "student", unit, proof, func(Account) (string, error) {
				if name == "ancestry-gone" {
					return "", errors.New("gone")
				}
				return "ssh-a", nil
			}, func() bool { checks++; return name != "peer-gone" && (name != "peer-gone-after-save" || checks == 1) }, func() error { permits++; return errors.New("private IPC failed") })
			if err == nil || (name != "permit-failed" && permits != 0) {
				t.Fatal("unsafe final release", err, permits)
			}
			if name == "peer-gone-after-save" && checks != 2 {
				t.Fatal("failed to exercise final post-save fence", checks)
			}
		})
	}
}

func TestClosedPaneOrphanExpiresOnBootClockAndCloseRevokesDespiteCleanupFailure(t *testing.T) {
	for _, mode := range []string{"expired-wall", "expired-boot", "old-boot", "cancelled", "fresh"} {
		t.Run(mode, func(t *testing.T) {
			e, _, p, unit, proof := closedPaneFixture(t)
			if err := e.WithState(func() error {
				v := e.state.PaneInstances[unit]
				switch mode {
				case "expired-wall":
					v.ClosedUntil = Millis() - 1
				case "expired-boot":
					v.ClosedBootUntil = 1
				case "old-boot":
					v.Boot = "old"
				case "cancelled":
					v.Cancelled = true
				}
				e.state.PaneInstances[unit] = v
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			if err := e.Tick(); err != nil {
				t.Fatal("actual watchdog pending-start reconciliation", err)
			}
			s, err := readStateSnapshot(e.Config.State)
			if err != nil {
				t.Fatal(err)
			}
			if paneRecorded(s.Attempts[finalID], finalID) != (mode == "fresh") {
				t.Fatal("pending capacity not bounded", mode)
			}
			if mode != "fresh" {
				if err := e.releaseClosedPane(p, "student", unit, proof, func(Account) (string, error) { return "ssh-a", nil }, func() bool { return true }, func() error { t.Fatal("expired orphan released"); return nil }); err == nil {
					t.Fatal("orphan reconstructed permission")
				}
			}
		})
	}
}

func TestClosedPaneCloseFailureStillRevokesPendingExec(t *testing.T) {
	e, _, p, unit, proof := closedPaneFixture(t)
	legacy := "exam-" + finalID + "-" + finalID + ".scope"
	if err := e.WithState(func() error {
		e.state.Attempts[finalID].Units = append(e.state.Attempts[finalID].Units, legacy)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := e.WithState(func() error { _, err := e.closePaneLocked(e.state.Attempts[finalID], finalID); return err }); err == nil {
		t.Fatal("unverified legacy scope falsely closed")
	}
	s, err := readStateSnapshot(e.Config.State)
	if err != nil || !s.PaneInstances[unit].Cancelled || len(s.Attempts[finalID].Units) != 2 {
		t.Fatal("close failure lost revocation/tracking", err)
	}
	if err := e.releaseClosedPane(p, "student", unit, proof, func(Account) (string, error) { return "ssh-a", nil }, func() bool { return true }, func() error { t.Fatal("failed close allowed pending exec"); return nil }); err == nil {
		t.Fatal("failed close granted exec")
	}
}

func TestClosedPaneExpiryDuringCommitCannotReleaseAndConsumedTokenCannotRebind(t *testing.T) {
	e, token, p, unit, proof := closedPaneFixture(t)
	restarted, err := New(e.Config)
	if err != nil {
		t.Fatal(err)
	}
	if err := restarted.WithState(func() error {
		account, _ := restarted.account("student")
		_, _, err := restarted.paneAdmission(token, "student", "ssh-a", account)
		return err
	}); err == nil {
		t.Fatal("restart reconstituted closed launch from consumed admission")
	}
	proof.ClosedUntil = Millis() + 100
	p.capability.Expires = proof.ClosedUntil
	if err := e.WithState(func() error { e.state.PaneInstances[unit] = proof; return nil }); err != nil {
		t.Fatal(err)
	}
	checks, permits := 0, 0
	err = e.releaseClosedPane(p, "student", unit, proof, func(Account) (string, error) { return "ssh-a", nil }, func() bool {
		checks++
		if checks == 1 {
			time.Sleep(130 * time.Millisecond)
		}
		return true
	}, func() error { permits++; return nil })
	if err == nil || permits != 0 || checks != 1 {
		t.Fatal("post-save expiry did not deny exec", err, checks, permits)
	}
}
