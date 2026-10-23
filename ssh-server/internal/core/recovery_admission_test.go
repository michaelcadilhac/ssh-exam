package core

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestRejectedRecoveryPreparationCanBeCancelledAndFencedAcrossRestart(t *testing.T) {
	e, a, grant := recoveryFixture(t)
	key := commandKeys(t, e)
	e.Config.Accounts["student"] = Account{UID: os.Getuid(), GID: os.Getgid()}
	r := Request{ID: a.ID, Exam: a.Exam, Username: a.Username, UID: a.UID, Transport: "ssh-recovery", Settings: Settings{Duration: 4500, Template: "v1", Terminals: 2}}
	grant.Duration = 3600
	writeRecoveryFixture(t, e, a, grant)
	if err := e.WithState(func() error {
		e.state.Attempts[finalID].AccessState = "OVERRIDDEN"
		e.state.Registrations[r.Transport] = r.Username
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	cmd := preparationCommand(r)
	if _, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport); err == nil || !strings.Contains(err.Error(), "allowance") {
		t.Fatalf("did not reach strict allowance refusal: %v", err)
	}
	if err := e.WithState(func() error {
		if e.state.Attempts[r.ID] != nil {
			t.Fatal("refused preparation unexpectedly exists")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	cmd.Op, cmd.Nonce, cmd.Body.Reason = "cancel-attempt", Token(), "Signed out before starting"
	result, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport)
	if err != nil {
		t.Fatal("absent preparation cannot be safely cancelled:", err)
	}
	cancelled := result.(*Attempt)
	if cancelled.State != "CANCELLED_BEFORE_START" || cancelled.Start != 0 || cancelled.Deadline != 0 || cancelled.OriginalDeadline != 0 || cancelled.UID != r.UID || cancelled.Exam != r.Exam {
		t.Fatalf("invalid cancellation confirmation: %+v", cancelled)
	}
	restarted, err := New(e.Config)
	if err != nil {
		t.Fatal(err)
	}
	restarted.preparationReady = func() (bool, []string) { t.Fatal("cancelled ID reached readiness"); return false, nil }
	cmd = preparationCommand(r)
	result, err = restarted.Command(signedCommand(key, cmd), r.Username, r.Transport)
	if err != nil || result.(*Attempt).State != "CANCELLED_BEFORE_START" {
		t.Fatalf("late preparation revived cancelled ID: %v %v", result, err)
	}
	if _, err := os.Stat(filepath.Join(e.Config.State, recoveryName(a)+".consumed")); !os.IsNotExist(err) {
		t.Fatal("failure consumed grant", err)
	}
	if err := restarted.WithState(func() error {
		got, err := restarted.recoveryReference(&Attempt{ID: retryRecoveryID, Exam: a.Exam, Username: a.Username, UID: a.UID, Settings: Settings{Duration: 3600}})
		if err != nil || *got != grant {
			t.Fatalf("grant/source changed: %v %v", got, err)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	// Explicit signed operator edit, not implicit grant resnapshotting.
	// Exercise real reconciliation/prepare/stage/Begin with OS setup seams;
	// archive verification/copy/publication and consumption remain real.
	archive := filepath.Join(e.Config.State, "submissions", grant.SourceAttempt, "submission.tar.gz")
	beforeArchive, err := os.ReadFile(archive)
	if err != nil {
		t.Fatal(err)
	}
	r.ID, r.Settings.Earliest, r.Settings.Latest = retryRecoveryID, Millis()-60000, Millis()+600000
	r.AllowanceEdit = &RecoveryAllowanceEdit{Revision: 1, Duration: 4500, Actor: "fixture-instructor", At: Millis()}
	cmd = preparationCommand(r)
	cmd.Op = "reconcile-recovery-allowance"
	result, err = restarted.Command(signedCommand(key, cmd), r.Username, r.Transport)
	if err != nil {
		t.Fatal("signed allowance repair failed", err)
	}
	r.ExpectedRecovery = result.(recoveryAllowanceReply).Recovery.GrantHash
	grant.Duration, grant.AllowanceRevision = 4500, r.AllowanceEdit
	restarted.preparationReady = func() (bool, []string) { return true, nil }
	restarted.preparationHome = func(*Attempt) error { return nil }
	cmd = preparationCommand(r)
	cmd.Op = "prepare-recovery-attempt"
	if _, err := restarted.Command(signedCommand(key, cmd), r.Username, r.Transport); err != nil {
		t.Fatal(err)
	}
	cmd.Op, cmd.Nonce = "prepare-workspace", Token()
	result, err = restarted.Command(signedCommand(key, cmd), r.Username, r.Transport)
	if err != nil {
		t.Fatal(err)
	}
	staged := result.(*Attempt)
	if staged.Workspace == nil || staged.Workspace.Source.Kind != "saved" || staged.Workspace.Source.Attempt != grant.SourceAttempt || staged.Workspace.Source.Checksum != grant.Checksum {
		t.Fatalf("retry lost saved-work source: %+v", staged.Workspace)
	}
	assertUnstartedWorkspace(t, restarted, r.ID)
	if _, err := os.Stat(filepath.Join(e.Config.State, recoveryName(a)+".consumed")); !os.IsNotExist(err) {
		t.Fatal("retry preflight consumed grant", err)
	}
	entered, release := make(chan struct{}), make(chan struct{})
	restarted.activationPrepare = func(*Attempt) error { close(entered); <-release; return nil }
	cmd.Op, cmd.Nonce = "activate-recovery-attempt", Token()
	finished := make(chan error, 1)
	drained := false
	defer drainWorkspaceTask(t, release, finished, &drained)
	go func() { _, err := restarted.Command(signedCommand(key, cmd), r.Username, r.Transport); finished <- err }()
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		t.Fatal("Begin did not reach setup barrier")
	}
	assertUnstartedWorkspace(t, restarted, r.ID)
	if _, err := os.Stat(filepath.Join(e.Config.State, recoveryName(a)+".consumed")); !os.IsNotExist(err) {
		t.Fatal("Begin setup consumed grant", err)
	}
	actualBegin := Millis()
	close(release)
	select {
	case err := <-finished:
		drained = true
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Begin did not finish")
	}
	if err := restarted.WithState(func() error {
		active := restarted.state.Attempts[r.ID]
		if active.State != "ACTIVE" || active.Start < actualBegin || active.Deadline-active.Start != 4500000 || active.OriginalDeadline != active.Deadline || active.AccessState != "HELD" {
			t.Fatalf("retry did not receive full actual-Begin allowance: %+v", active)
		}
		source := restarted.state.Attempts[grant.SourceAttempt]
		if source.State != "COMPLETED" || !source.Protected || source.Checksum != grant.Checksum {
			t.Fatal("source history changed")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	answer, err := os.ReadFile(filepath.Join(e.Config.Work, r.ID, "work", "answer.txt"))
	if err != nil || string(answer) != "saved answer" {
		t.Fatal("retry did not publish saved answer", err)
	}
	afterArchive, err := os.ReadFile(archive)
	if err != nil || !bytes.Equal(beforeArchive, afterArchive) {
		t.Fatal("retry changed protected archive", err)
	}
	marker, err := os.ReadFile(filepath.Join(e.Config.State, recoveryName(a)+".consumed"))
	if err != nil || string(marker) != r.ID {
		t.Fatal("Begin did not consume exact new attempt", err)
	}
}

func TestAbsentPreparationCancellationRequiresAuthenticatedExactIdentity(t *testing.T) {
	for _, kind := range []string{"uid", "exam", "username", "missing-identity", "transport", "foreign-existing", "started-existing"} {
		t.Run(kind, func(t *testing.T) {
			e, key, r := preparationFixture(t)
			cmd := preparationCommand(r)
			cmd.Op = "cancel-attempt"
			switch kind {
			case "uid":
				cmd.Body.UID++
			case "exam":
				cmd.Body.Exam = "../unsafe"
			case "username":
				cmd.Body.Username = "student"
			case "missing-identity":
				cmd.Body = Request{ID: r.ID}
			case "transport":
				cmd.Transport = "another"
			case "foreign-existing", "started-existing":
				cmd.Body.ID = finalID
			}
			if kind == "started-existing" {
				cmd.Username, cmd.Transport = "student", "ssh-a"
				cmd.Body.Username, cmd.Body.UID, cmd.Body.Transport = "student", os.Getuid()+1, "ssh-a"
			}
			if _, err := e.Command(signedCommand(key, cmd), cmd.Username, cmd.Transport); err == nil {
				t.Fatal("unsafe cancellation accepted")
			}
			if err := e.WithState(func() error {
				if e.state.Attempts[r.ID] != nil {
					t.Fatal("refused cancellation reserved account")
				}
				if a := e.state.Attempts[finalID]; a.State != "ACTIVE" || a.Start == 0 {
					t.Fatal("existing interval changed")
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestRootAbsentCancellationDoesNotInitializeMissingAuthority(t *testing.T) {
	c := Config{State: t.TempDir(), Accounts: map[string]Account{"student": {UID: os.Getuid(), GID: os.Getgid()}}}
	e, err := New(c)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.CancelAbsentPreparation(recoveryID, "recovery", "student", "Synthetic missing authority refusal"); err == nil || !strings.Contains(err.Error(), "state unavailable or unsafe") {
		t.Fatal("missing authority treated as no-start proof", err)
	}
	entries, err := os.ReadDir(c.State)
	if err != nil || len(entries) != 0 {
		t.Fatal("refusal initialized/wrote authority", entries, err)
	}
}

func TestAbsentPreparationCancellationRefusesSurvivingStartEvidence(t *testing.T) {
	for _, kind := range []string{"workspace", "submission", "consumption"} {
		t.Run(kind, func(t *testing.T) {
			e, key, r := preparationFixture(t)
			var evidence string
			switch kind {
			case "workspace":
				evidence = filepath.Join(e.Config.Work, r.ID)
			case "submission":
				evidence = filepath.Join(e.Config.State, "submissions", r.ID)
			case "consumption":
				evidence = filepath.Join(e.Config.State, "recovery-preparations", r.Exam, r.Username+".json.consumed")
			}
			if err := os.MkdirAll(filepath.Dir(evidence), 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(evidence, []byte(r.ID), 0600); err != nil {
				t.Fatal(err)
			}
			cmd := preparationCommand(r)
			cmd.Op = "cancel-attempt"
			if _, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport); err == nil || !strings.Contains(err.Error(), "evidence exists") {
				t.Fatal("surviving start evidence treated as no-start proof", err)
			}
			if _, err := e.CancelAbsentPreparation(r.ID, r.Exam, r.Username, "Synthetic surviving history refusal"); err == nil {
				t.Fatal("root workflow bypassed surviving history")
			}
			if err := e.WithState(func() error {
				if e.state.Attempts[r.ID] != nil {
					t.Fatal("unsafe no-start tombstone created")
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			b, err := os.ReadFile(evidence)
			if err != nil || string(b) != r.ID {
				t.Fatal("surviving evidence changed", err)
			}
		})
	}
}
