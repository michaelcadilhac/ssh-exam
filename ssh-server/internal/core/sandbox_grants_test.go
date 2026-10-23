package core

import (
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func practiceSettings(s *Settings) {
	s.ID = SandboxExamID
	s.Duration = SandboxDurationSeconds
	s.Webcam = false
	s.Terminals = 4
	s.Earliest = Millis() - 60000
	s.Latest = Millis() + 600000
}

func TestPracticeGrantSignedWorkerFreshBeginAndOneUse(t *testing.T) {
	for _, history := range []bool{false, true} {
		t.Run(map[bool]string{false: "first", true: "repeat"}[history], func(t *testing.T) {
			e, key, r := initialGrantUnpreparedFixture(t, practiceSettings)
			r.Exam = SandboxExamID
			r.Grant.Kind = "PRACTICE"
			r.Grant.Order = 2
			var prior *Attempt
			if history {
				start := Millis() - 600000
				prior = &Attempt{ID: "99999999-1234-4234-8234-123456789abc", Exam: SandboxExamID, Username: r.Username, UID: r.UID, State: "COMPLETED", Settings: r.Settings, Start: start, Deadline: start + 300000, OriginalDeadline: start + 300000, Protected: true, AccessState: "RELEASED", Grant: &GrantBinding{ID: "88888888-1234-4234-8234-123456789abc", Revision: 1, Hash: strings.Repeat("b", 64), Kind: "PRACTICE", Order: 1}, GrantBeginIntent: "77777777-1234-4234-8234-123456789abc"}
				if err := e.WithState(func() error { e.state.Attempts[prior.ID] = prior; return nil }); err != nil {
					t.Fatal(err)
				}
			}
			cmd := preparationCommand(r)
			cmd.Op = "prepare-grant-attempt"
			if _, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport); err == nil {
				t.Fatal("practice type accepted under initial purpose")
			}
			cmd.Op, cmd.Nonce = "prepare-practice-grant-attempt", Token()
			if _, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport); err != nil {
				t.Fatal(err)
			}
			childCollections(e, "success")
			e.workerTimeout = 10 * time.Second
			cmd.Op, cmd.Nonce = "prepare-workspace", Token()
			if _, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport); err != nil {
				t.Fatal("real practice worker", err)
			}
			a := assertUnstartedWorkspace(t, e, r.ID)
			if a.Workspace == nil || !sameGrant(a.Workspace.Grant, r.Grant) {
				t.Fatal("practice receipt lost type/authority")
			}
			// Retry an abandoned unstarted preflight on fresh authenticated SSH.
			// Fresh C15 verification must use the replacement transport, while the
			// same private workspace, grant and complete allowance remain saved.
			if err := e.WithState(func() error { e.state.Registrations["ssh-retry"] = r.Username; return nil }); err != nil {
				t.Fatal(err)
			}
			r.Transport = "ssh-retry"
			cmd = preparationCommand(r)
			cmd.Op = "prepare-practice-grant-attempt"
			retried, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport)
			if err != nil || retried.(*Attempt).Transport != r.Transport || !sameGrant(retried.(*Attempt).Workspace.Grant, r.Grant) || retried.(*Attempt).Start != 0 {
				t.Fatal("fresh transport did not retain unstarted practice authority", err)
			}
			var calls atomic.Int32
			initialGrantServer(t, e, key, func(reply grantBeginReply) (grantBeginReply, int) {
				calls.Add(1)
				if reply.Grant.Kind != "PRACTICE" {
					t.Error("fresh practice type lost")
				}
				return reply, 200
			})
			r.GrantBeginIntent = "44444444-1234-4234-8234-123456789abc"
			cmd = preparationCommand(r)
			cmd.Op = "activate-practice-grant-attempt"
			at := Millis()
			result, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport)
			if err != nil {
				t.Fatal(err)
			}
			started := result.(*Attempt)
			if started.Start < at || started.Deadline-started.Start != 300000 || started.OriginalDeadline != started.Deadline {
				t.Fatal("practice allowance/interval changed", started)
			}
			cmd.Nonce = Token()
			again, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport)
			if err != nil || again.(*Attempt).Start != started.Start || calls.Load() != 1 {
				t.Fatal("retry consumed another practice interval", err, calls.Load())
			}
			result, err = e.Call("finalize-attempt", Request{ID: r.ID, Reason: "Synthetic practice completion"})
			if err != nil {
				t.Fatal(err)
			}
			completed := result.(*Attempt)
			manifest, err := ReadProtected(filepath.Join(e.Config.State, "submissions", r.ID), completed)
			if err != nil || !sameGrant(manifest.Attempt.Grant, r.Grant) || completed.OriginalDeadline != started.OriginalDeadline || !accessHeld(completed) {
				t.Fatal("practice protection or original hold lost", err)
			}
			if prior != nil {
				if err := e.WithState(func() error {
					p := e.state.Attempts[prior.ID]
					if p.Start != prior.Start || p.OriginalDeadline != prior.OriginalDeadline || !p.Protected {
						t.Fatal("repeat rewrote historical interval/source")
					}
					return nil
				}); err != nil {
					t.Fatal(err)
				}
			}
			e.Config.Accounts["other"] = Account{UID: os.Getuid() + 1, GID: os.Getgid() + 1}
			if err := e.WithState(func() error { e.state.Registrations["ssh-b"] = "other"; return nil }); err != nil {
				t.Fatal(err)
			}
			r.ID, r.Username, r.UID, r.Transport, r.GrantBeginIntent = "66666666-1234-4234-8234-123456789abc", "other", os.Getuid()+1, "ssh-b", ""
			cmd = preparationCommand(r)
			cmd.Op = "prepare-practice-grant-attempt"
			if _, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport); err == nil || !strings.Contains(err.Error(), "consumed") {
				t.Fatal("one-use refusal not reached independently of held UID", err)
			}
		})
	}
}

func TestPracticeGrantModeFencesLegacyBeginAtActualCommit(t *testing.T) {
	e, key, r := initialGrantUnpreparedFixture(t, practiceSettings)
	r.Exam, r.Grant = SandboxExamID, nil
	cmd := preparationCommand(r)
	cmd.Op = "prepare-attempt"
	if _, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport); err != nil {
		t.Fatal("legacy compatibility before mode activation", err)
	}
	cmd.Op, cmd.Nonce = "prepare-workspace", Token()
	if _, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport); err != nil {
		t.Fatal(err)
	}
	if err := e.WithState(func() error {
		e.state.Attempts["99999999-1234-4234-8234-123456789abc"] = &Attempt{ID: "99999999-1234-4234-8234-123456789abc", Exam: SandboxExamID, Username: "other", UID: os.Getuid() + 1, State: "COMPLETED", Settings: r.Settings, Start: Millis() - 600000, Deadline: Millis() - 300000, OriginalDeadline: Millis() - 300000, Protected: true, AccessState: "RELEASED", Grant: &GrantBinding{ID: "88888888-1234-4234-8234-123456789abc", Revision: 1, Hash: strings.Repeat("b", 64), Kind: "PRACTICE", Order: 1}}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	cmd.Op, cmd.Nonce = "activate-versioned-attempt", Token()
	if _, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport); err == nil || !strings.Contains(err.Error(), "saved practice grant required") {
		t.Fatal("legacy final-commit refusal not reached", err)
	}
	assertUnstartedWorkspace(t, e, r.ID)
	e.Config.Accounts["another"] = Account{UID: os.Getuid() + 2, GID: os.Getgid() + 2}
	if err := e.WithState(func() error { e.state.Registrations["ssh-other"] = "another"; return nil }); err != nil {
		t.Fatal(err)
	}
	r.ID, r.Username, r.UID, r.Transport = "66666666-1234-4234-8234-123456789abc", "another", os.Getuid()+2, "ssh-other"
	cmd = preparationCommand(r)
	cmd.Op = "prepare-attempt"
	if _, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport); err == nil || !strings.Contains(err.Error(), "saved practice grant required") {
		t.Fatal("cross-account legacy preparation fence not reached", err)
	}
	if err := e.WithState(func() error {
		if e.state.Attempts[r.ID] != nil {
			t.Fatal("rejected legacy preparation reserved another account")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestPracticeGrantRejectsWrongExamOrFixedPolicy(t *testing.T) {
	for _, changed := range []string{"exam", "duration", "webcam", "terminals"} {
		t.Run(changed, func(t *testing.T) {
			e, key, r := initialGrantUnpreparedFixture(t, practiceSettings)
			r.Exam = SandboxExamID
			r.Grant.Kind = "PRACTICE"
			r.Grant.Order = 1
			switch changed {
			case "exam":
				r.Exam = "exam"
			case "duration":
				r.Settings.Duration = 301
			case "webcam":
				r.Settings.Webcam = true
			case "terminals":
				r.Settings.Terminals = 3
			}
			cmd := preparationCommand(r)
			cmd.Op = "prepare-practice-grant-attempt"
			if _, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport); err == nil {
				t.Fatal("practice policy/type bypass accepted")
			}
			if err := e.WithState(func() error {
				if e.state.Attempts[r.ID] != nil {
					t.Fatal("rejected practice scope reserved account")
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestPracticeGrantWindowClosesDuringFreshVerificationBeforeCommit(t *testing.T) {
	e, key, r := initialGrantUnpreparedFixture(t, practiceSettings)
	r.Exam = SandboxExamID
	r.Grant.Kind = "PRACTICE"
	r.Grant.Order = 1
	r.Settings.Latest = Millis() + 4000
	cmd := preparationCommand(r)
	cmd.Op = "prepare-practice-grant-attempt"
	if _, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport); err != nil {
		t.Fatal(err)
	}
	cmd.Op, cmd.Nonce = "prepare-workspace", Token()
	if _, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport); err != nil {
		t.Fatal(err)
	}
	var reached atomic.Bool
	initialGrantServer(t, e, key, func(reply grantBeginReply) (grantBeginReply, int) {
		reached.Store(true)
		if wait := r.Settings.Latest - Millis() + 10; wait > 0 {
			time.Sleep(time.Duration(wait) * time.Millisecond)
		}
		reply.Expires = Millis() + 30000
		return reply, 200
	})
	r.GrantBeginIntent = "44444444-1234-4234-8234-123456789abc"
	cmd = preparationCommand(r)
	cmd.Op = "activate-practice-grant-attempt"
	if _, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport); err == nil || !strings.Contains(err.Error(), "window") || !reached.Load() {
		t.Fatal("actual post-verification window fence not reached", err, reached.Load())
	}
	assertUnstartedWorkspace(t, e, r.ID)
}
