package core

import (
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

func recoveryAllowanceFixture(t *testing.T) (*Engine, *Attempt, RecoveryPreparation, ed25519.PrivateKey, Request) {
	t.Helper()
	e, a, grant := recoveryFixture(t)
	key := commandKeys(t, e)
	e.Config.Accounts["student"] = Account{UID: os.Getuid(), GID: os.Getgid()}
	grant.Duration = 3600
	writeRecoveryFixture(t, e, a, grant)
	r := Request{ID: a.ID, Exam: a.Exam, Username: a.Username, UID: a.UID, Transport: "ssh-recovery", AllowanceEdit: &RecoveryAllowanceEdit{Revision: 1, Duration: 4500, Actor: "fixture-instructor", At: Millis()}}
	if err := e.WithState(func() error {
		e.state.Registrations[r.Transport] = r.Username
		e.state.Attempts[finalID].AccessState = "OVERRIDDEN"
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return e, a, grant, key, r
}

func TestSignedRecoveryAllowanceReconcilesUnusedGrant(t *testing.T) {
	e, a, grant, key, r := recoveryAllowanceFixture(t)
	cmd := preparationCommand(r)
	cmd.Op = "reconcile-recovery-allowance"
	result, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport)
	if err != nil {
		t.Fatal("explicit allowance edit did not reconcile unused recovery grant:", err)
	}
	b, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	var reply struct {
		Version  int `json:"version"`
		Recovery struct {
			Duration int64  `json:"duration"`
			Source   string `json:"source_attempt"`
			Hash     string `json:"grant_hash"`
		} `json:"recovery"`
	}
	if json.Unmarshal(b, &reply) != nil || reply.Version != 1 || reply.Recovery.Duration != 4500 || reply.Recovery.Source != grant.SourceAttempt || len(reply.Recovery.Hash) != 64 {
		t.Fatalf("invalid recovery reconciliation receipt: %s", b)
	}
	bytes, err := os.ReadFile(filepath.Join(e.Config.State, recoveryName(a)))
	if err != nil {
		t.Fatal(err)
	}
	var revised RecoveryPreparation
	if json.Unmarshal(bytes, &revised) != nil || revised.Duration != 4500 || revised.AllowanceRevision == nil || *revised.AllowanceRevision != *r.AllowanceEdit {
		t.Fatal("native unused allowance unchanged or lacks provenance", string(bytes))
	}
	revised.Duration, revised.AllowanceRevision = grant.Duration, nil
	if revised != grant {
		t.Fatal("duration revision changed immutable source/identity/reason")
	}
	if _, err := os.Stat(filepath.Join(e.Config.State, recoveryName(a)+".consumed")); !os.IsNotExist(err) {
		t.Fatal("revision consumed grant", err)
	}
	if err := e.WithState(func() error {
		if e.state.Attempts[a.ID] != nil {
			t.Fatal("revision created an attempt/countdown")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestRecoveryAllowanceRefusesUnsafeScopePreparedConsumedAndStaleEdits(t *testing.T) {
	for _, kind := range []string{"uid", "username", "transport", "expired", "invalid-edit", "prepared", "started", "consumed", "bad-source", "stale", "conflicting", "predates"} {
		t.Run(kind, func(t *testing.T) {
			e, a, grant, key, r := recoveryAllowanceFixture(t)
			cmd := preparationCommand(r)
			cmd.Op = "reconcile-recovery-allowance"
			switch kind {
			case "uid":
				cmd.Body.UID++
			case "username":
				cmd.Body.Username = "other"
			case "transport":
				cmd.Transport = "unregistered"
			case "expired":
				cmd.Expires = Millis() - 1
			case "invalid-edit":
				cmd.Body.AllowanceEdit.Duration = 4501
			case "prepared", "started":
				if err := e.WithState(func() error {
					other := *a
					other.ID = retryRecoveryID
					if kind == "started" {
						other.State, other.Start, other.Deadline = "ACTIVE", Millis(), Millis()+3600000
					}
					e.state.Attempts[other.ID] = &other
					return nil
				}); err != nil {
					t.Fatal(err)
				}
			case "consumed":
				if err := os.WriteFile(filepath.Join(e.Config.State, recoveryName(a)+".consumed"), []byte(retryRecoveryID), 0600); err != nil {
					t.Fatal(err)
				}
			case "bad-source":
				grant.Checksum = strings.Repeat("f", 64)
				writeRecoveryFixture(t, e, a, grant)
			case "stale", "conflicting":
				copy := *r.AllowanceEdit
				copy.Duration = grant.Duration
				copy.Revision = 2
				grant.AllowanceRevision = &copy
				writeRecoveryFixture(t, e, a, grant)
				if kind == "conflicting" {
					cmd.Body.AllowanceEdit.Revision = 2
				}
			case "predates":
				cmd.Body.AllowanceEdit.At = grant.CreatedAt - 1
			}
			path := filepath.Join(e.Config.State, recoveryName(a))
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := e.Command(signedCommand(key, cmd), cmd.Username, cmd.Transport); err == nil {
				t.Fatal("unsafe allowance revision accepted")
			}
			after, err := os.ReadFile(path)
			if err != nil || string(before) != string(after) {
				t.Fatal("refusal changed grant/source/provenance", err)
			}
			if err := e.WithState(func() error {
				if e.state.Attempts[a.ID] != nil {
					t.Fatal("refusal reserved a preparation")
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestRecoveryAllowancePublicationFailureRestartRetryAndInspection(t *testing.T) {
	for _, phase := range []string{"allowance-written", "allowance-published", "allowance-replaced"} {
		t.Run(phase, func(t *testing.T) {
			e, a, grant, key, r := recoveryAllowanceFixture(t)
			reached := false
			e.workspaceCheckpoint = func(at string) error {
				if at == phase {
					reached = true
					return errors.New("synthetic allowance publication failure")
				}
				return nil
			}
			cmd := preparationCommand(r)
			cmd.Op = "reconcile-recovery-allowance"
			if _, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport); err == nil || !reached {
				t.Fatal("publication fault not reached/refused", err)
			}
			rows, err := e.RecoveryGrants(r.Exam)
			if err != nil || len(rows) != 1 || rows[0].SourceAttempt != grant.SourceAttempt {
				t.Fatal("crash residue not inspectable", rows, err)
			}
			if phase == "allowance-published" {
				if rows[0].Duration != 3600 || rows[0].PendingAllowanceRevision == nil || rows[0].PendingAllowanceRevision.Duration != 4500 {
					t.Fatal("unpublished revision became authority or disappeared", rows)
				}
				if err := e.WithState(func() error {
					_, err := e.recoveryReference(&Attempt{ID: a.ID, Exam: a.Exam, Username: a.Username, UID: a.UID, Settings: Settings{Duration: 3600}})
					if err == nil {
						t.Fatal("pending publication permitted legacy admission")
					}
					return nil
				}); err != nil {
					t.Fatal(err)
				}
			}
			restarted, err := New(e.Config)
			if err != nil {
				t.Fatal(err)
			}
			cmd.Nonce = Token()
			result, err := restarted.Command(signedCommand(key, cmd), r.Username, r.Transport)
			if err != nil || result.(recoveryAllowanceReply).Recovery.Duration != 4500 {
				t.Fatal("restart/idempotent revision retry failed", result, err)
			}
			if _, err := os.Stat(filepath.Join(e.Config.State, recoveryName(a)+".pending")); !os.IsNotExist(err) {
				t.Fatal("retry retained unpublished metadata", err)
			}
			if _, err := os.Stat(filepath.Join(e.Config.State, recoveryName(a)+".consumed")); !os.IsNotExist(err) {
				t.Fatal("revision failure/retry consumed allowance", err)
			}
		})
	}
}

func TestRecoveryExpectedGrantPreventsMissingChangedOrLegacyFallback(t *testing.T) {
	for _, kind := range []string{"missing", "changed", "legacy-purpose"} {
		t.Run(kind, func(t *testing.T) {
			e, a, grant, key, r := recoveryAllowanceFixture(t)
			cmd := preparationCommand(r)
			cmd.Op = "reconcile-recovery-allowance"
			result, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport)
			if err != nil {
				t.Fatal(err)
			}
			r.ExpectedRecovery = result.(recoveryAllowanceReply).Recovery.GrantHash
			r.Settings = Settings{Duration: 4500, Template: "v1", Terminals: 2}
			cmd = preparationCommand(r)
			cmd.Op = "prepare-recovery-attempt"
			switch kind {
			case "missing":
				if err := os.Rename(filepath.Join(e.Config.State, recoveryName(a)), filepath.Join(e.Config.State, "retained-grant.json")); err != nil {
					t.Fatal(err)
				}
			case "changed":
				grant.Duration = 4500
				grant.Reason = "Different explicit source authority reason"
				writeRecoveryFixture(t, e, a, grant)
			case "legacy-purpose":
				cmd.Op, cmd.Body.ExpectedRecovery = "prepare-attempt", ""
			}
			e.preparationReady = func() (bool, []string) { t.Fatal("unsafe grant reached readiness/template staging"); return false, nil }
			if _, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport); err == nil {
				t.Fatal("expected saved source silently fell back")
			}
			if _, err := os.Stat(filepath.Join(e.Config.Work, a.ID)); !os.IsNotExist(err) {
				t.Fatal("unsafe fallback created/exposed work", err)
			}
		})
	}
}

func TestRecoveryBeginRequiresDistinctPurposeAndExactSavedSettings(t *testing.T) {
	for _, kind := range []string{"legacy-purpose", "versioned-purpose", "missing-hash", "changed-hash", "changed-settings", "non-recovery"} {
		t.Run(kind, func(t *testing.T) {
			e, a, _, key, r := recoveryAllowanceFixture(t)
			a.Transport, a.ExpectedRecovery = r.Transport, strings.Repeat("a", 64)
			r.ExpectedRecovery, r.Settings = a.ExpectedRecovery, a.Settings
			cmd := preparationCommand(r)
			cmd.Op = "activate-recovery-attempt"
			switch kind {
			case "legacy-purpose":
				cmd.Op, cmd.Body.ExpectedRecovery = "activate-attempt", ""
			case "versioned-purpose":
				cmd.Op = "activate-versioned-attempt"
			case "missing-hash":
				cmd.Body.ExpectedRecovery = ""
			case "changed-hash":
				cmd.Body.ExpectedRecovery = strings.Repeat("b", 64)
			case "changed-settings":
				cmd.Body.Settings.Duration++
			case "non-recovery":
				a.ExpectedRecovery = ""
			}
			if err := e.WithState(func() error { e.state.Attempts[a.ID] = a; return nil }); err != nil {
				t.Fatal(err)
			}
			e.activationPrepare = func(*Attempt) error {
				t.Error("stale recovery Begin reached OS setup")
				return errors.New("unsafe setup")
			}
			if _, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport); err == nil || !strings.Contains(err.Error(), "saved-work") {
				t.Fatal("stale/mixed-role Begin did not reach saved-work refusal", err)
			}
			assertUnstartedWorkspace(t, e, a.ID)
			if _, err := os.Stat(filepath.Join(e.Config.State, recoveryName(a)+".consumed")); !os.IsNotExist(err) {
				t.Fatal("refused Begin consumed saved-work grant", err)
			}
		})
	}
}

func TestRecoveryAllowanceBusyAuditRefusesWithoutPublication(t *testing.T) {
	e, a, _, key, r := recoveryAllowanceFixture(t)
	f, err := os.OpenFile(filepath.Join(e.Config.State, "audit.ndjson"), os.O_RDWR|os.O_CREATE, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(e.Config.State, recoveryName(a))
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	cmd := preparationCommand(r)
	cmd.Op = "reconcile-recovery-allowance"
	if _, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport); err == nil || !strings.Contains(err.Error(), "audit busy") {
		t.Fatal("busy audit did not refuse revision", err)
	}
	after, err := os.ReadFile(path)
	if err != nil || string(before) != string(after) {
		t.Fatal("busy audit changed grant", err)
	}
	if _, err := os.Stat(path + ".pending"); !os.IsNotExist(err) {
		t.Fatal("busy audit published intermediate authority", err)
	}
}

func TestRecoveryAllowancePendingAuthorityAndRevisionCannotBeReplacedSilently(t *testing.T) {
	for _, kind := range []string{"older", "same-revision-conflict", "foreign-source", "orphan", "newer"} {
		t.Run(kind, func(t *testing.T) {
			e, a, grant, key, r := recoveryAllowanceFixture(t)
			pending := grant
			edit := *r.AllowanceEdit
			pending.Duration, pending.AllowanceRevision = edit.Duration, &edit
			switch kind {
			case "older":
				edit.Revision++
			case "same-revision-conflict":
				edit.Actor = "other-instructor"
			case "foreign-source":
				pending.SourceAttempt = retryRecoveryID
			case "newer":
				r.AllowanceEdit.Revision++
				r.AllowanceEdit.Duration = 5400
			}
			data, err := json.Marshal(pending)
			if err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(e.Config.State, recoveryName(a))
			if err := os.WriteFile(path+".pending", data, 0600); err != nil {
				t.Fatal(err)
			}
			if kind == "orphan" {
				if err := os.Rename(path, path+".retained"); err != nil {
					t.Fatal(err)
				}
			}
			cmd := preparationCommand(r)
			cmd.Op = "reconcile-recovery-allowance"
			result, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport)
			if kind == "newer" {
				if err != nil || result.(recoveryAllowanceReply).Recovery.Duration != 5400 {
					t.Fatal("new explicit edit could not supersede unpublished metadata", result, err)
				}
			} else {
				if err == nil {
					t.Fatal("unsafe pending authority was accepted")
				}
				after, err := os.ReadFile(path + ".pending")
				if err != nil || string(data) != string(after) {
					t.Fatal("refusal discarded pending authority", err)
				}
			}
		})
	}
}

func TestRecoveryAllowanceMetadataRequiresCompleteUnambiguousProvenance(t *testing.T) {
	_, _, grant, _, r := recoveryAllowanceFixture(t)
	grant.Duration, grant.AllowanceRevision = r.AllowanceEdit.Duration, r.AllowanceEdit
	valid, err := json.Marshal(grant)
	if err != nil {
		t.Fatal(err)
	}
	if decoded, err := decodeRecoveryMetadata(valid); err != nil || *decoded.AllowanceRevision != *r.AllowanceEdit {
		t.Fatal("valid revision provenance refused", err)
	}
	for _, raw := range []string{`null`, `{}`, `{"revision":1,"duration":4500,"actor":"fixture","at":null}`, `{"revision":1,"duration":4500,"actor":"fixture","at":1,"extra":true}`, `{"revision":1,"Revision":2,"duration":4500,"actor":"fixture","at":1}`, `{"revision":1,"revision":2,"duration":4500,"actor":"fixture","at":1}`, `{"revision":0,"duration":4500,"actor":"fixture","at":1}`, `{"revision":1,"duration":5400,"actor":"fixture","at":1}`} {
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(valid, &fields); err != nil {
			t.Fatal(err)
		}
		fields["allowance_revision"] = json.RawMessage(raw)
		data, err := json.Marshal(fields)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := decodeRecoveryMetadata(data); err == nil {
			t.Fatalf("ambiguous/incomplete provenance accepted: %s", raw)
		}
	}
}
