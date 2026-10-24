package core

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

func sourceRetentionFixture(t *testing.T) (*Engine, SourceRetentionPlan) {
	t.Helper()
	e, _, _ := finalFixture(t, "LOCKED", Millis()+5400000)
	e.Config.AgentID = "class"
	if err := e.WithState(func() error { e.state.Attempts[finalID].UID = os.Getuid(); return nil }); err != nil {
		t.Fatal(err)
	}
	finished, err := e.Call("finalize-attempt", Request{ID: finalID, Reason: "Synthetic protected source for unified grant retention"})
	if err != nil {
		t.Fatal(err)
	}
	source := finished.(*Attempt)
	if err := e.WithState(func() error { e.state.Attempts[finalID].AccessState = "RELEASED"; return nil }); err != nil {
		t.Fatal(err)
	} // Synthetic metadata eligibility; no OS release claim.
	settings := Settings{ID: "source-retake", Name: "Synthetic saved source", Duration: 5400, Webcam: true, Terminals: 4, Template: "v1", TemplateVersion: strings.Repeat("a", 64), Earliest: Millis() - 1000, Latest: Millis() + 600000}
	grant := &GrantBinding{ID: "44444444-1234-4234-8234-123456789abc", Revision: 1, Hash: strings.Repeat("c", 64), Kind: "ADDITIONAL", Order: 2, Work: &GrantWork{Kind: "saved", Attempt: source.ID, Checksum: source.Checksum}}
	plan := SourceRetentionPlan{Version: 1, Agent: "class", Grant: grant, Exam: settings.ID, Username: source.Username, UID: source.UID, Settings: settings, Source: SourceRetentionSource{Attempt: source.ID, Checksum: source.Checksum}, Action: "retain", CurrentRevision: 1, Status: "PENDING_NATIVE"}
	return e, plan
}

func TestSavedSourcePinBlocksBothPublicDeletionEntriesAndReleasesOnlyOnExplicitRetirement(t *testing.T) {
	for _, admin := range []bool{false, true} {
		t.Run(map[bool]string{false: "native-call", true: "root-admin"}[admin], func(t *testing.T) {
			e, plan := sourceRetentionFixture(t)
			archive := filepath.Join(e.Config.State, "submissions", finalID, "submission.tar.gz")
			before, _ := os.ReadFile(archive)
			pin, err := e.RetainGrantSource(plan)
			if err != nil {
				t.Fatal(err)
			}
			if pin.Phase != "retained" || pin.MetadataHash == "" || len(pin.Consumers) != 0 {
				t.Fatal(pin)
			}
			retry, err := e.RetainGrantSource(plan)
			if err != nil || retry.RetentionHash != pin.RetentionHash || retry.RetainedAt != pin.RetainedAt {
				t.Fatal("retry replaced durable pin", retry, err)
			}
			if admin {
				_, err = e.Admin("delete", finalID, "Synthetic protected dependency refusal")
			} else {
				_, err = e.Call("delete-submission", Request{ID: finalID})
			}
			if err == nil || !strings.Contains(err.Error(), "submission retained by saved-source grant") {
				t.Fatal("public deletion did not reach the actual saved-source dependency refusal", err)
			}
			after, _ := os.ReadFile(archive)
			if !bytes.Equal(before, after) {
				t.Fatal("refusal changed archive")
			}
			closing := plan
			closing.Action, closing.Status = "release", "REVOKED"
			released, err := e.ReleaseGrantSource(closing)
			if err != nil || released.Phase != "released" {
				t.Fatal(released, err)
			}
			if err := e.checkGrantSourceDependencies(finalID); err != nil {
				t.Fatal("explicit retired unused pin still blocks source", err)
			}
			if _, err := e.RetainGrantSource(plan); err == nil {
				t.Fatal("stale plan revived released authority")
			}
		})
	}
}

func TestSavedSourceMissingConsumerAndContradictoryWorkNeverBecomeNoStartProof(t *testing.T) {
	e, plan := sourceRetentionFixture(t)
	if _, err := e.RetainGrantSource(plan); err != nil {
		t.Fatal(err)
	}
	r := Request{ID: recoveryID, Grant: plan.Grant, Exam: plan.Exam, Username: plan.Username, UID: plan.UID, Settings: plan.Settings}
	foreign := r
	foreign.ID = finalID
	if err := e.registerGrantSourceConsumer(foreign); err == nil {
		t.Fatal("existing foreign history was linked to a new grant")
	}
	if err := os.MkdirAll(e.workspaceBase(r.ID), 0700); err != nil {
		t.Fatal(err)
	}
	if err := e.registerGrantSourceConsumer(r); err == nil {
		t.Fatal("orphan workspace was adopted as a new consumer")
	}
	if err := os.Remove(e.workspaceBase(r.ID)); err != nil {
		t.Fatal(err)
	}
	before, err := e.SourceRetention(plan.Grant.ID, plan.Grant.Revision)
	if err != nil || len(before.Consumers) != 0 {
		t.Fatal("rejected registration changed original pin", before, err)
	}
	if err := e.registerGrantSourceConsumer(r); err != nil {
		t.Fatal(err)
	}
	closing := plan
	closing.Action, closing.Status = "release", "REVOKED"
	if _, err := e.ReleaseGrantSource(closing); err == nil || !strings.Contains(err.Error(), "absence alone is not no-start proof") {
		t.Fatal("missing consumer was released", err)
	}
	if err := e.registerGrantSourceConsumer(Request{ID: retryRecoveryID, Grant: plan.Grant, Exam: plan.Exam, Username: plan.Username, UID: plan.UID, Settings: plan.Settings}); err == nil {
		t.Fatal("closing pin admitted new preparation")
	}
	if err := e.WithState(func() error {
		e.state.Attempts[r.ID] = &Attempt{ID: r.ID, Exam: r.Exam, Username: r.Username, UID: r.UID, State: "CANCELLED_BEFORE_START", CancellationCleanupComplete: true}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(e.workspaceBase(r.ID), 0700); err != nil {
		t.Fatal(err)
	}
	if _, err := e.ReleaseGrantSource(closing); err == nil || !strings.Contains(err.Error(), "contradictory work/submission") {
		t.Fatal("contradictory work accepted as no-start", err)
	}
	if err := os.Remove(e.workspaceBase(r.ID)); err != nil {
		t.Fatal(err)
	} // Exact empty synthetic counterexample only.
	if _, err := e.ReleaseGrantSource(closing); err != nil {
		t.Fatal(err)
	}
}

func TestSavedSourceMalformedPinCannotAuthorizeSourceDeletion(t *testing.T) {
	for _, mode := range []string{"case-alias", "null-consumers", "unproved-release", "fifo", "hardlink"} {
		t.Run(mode, func(t *testing.T) {
			e, plan := sourceRetentionFixture(t)
			if _, err := e.RetainGrantSource(plan); err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(e.Config.State, "source-retentions", sourceRetentionName(plan.Grant.ID, plan.Grant.Revision))
			data, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			switch mode {
			case "fifo":
				if err := os.Remove(path); err != nil {
					t.Fatal(err)
				}
				if err := syscall.Mkfifo(path, 0600); err != nil {
					t.Fatal(err)
				}
			case "hardlink":
				if err := os.Link(path, filepath.Join(e.Config.State, "synthetic-pin-alias")); err != nil {
					t.Fatal(err)
				}
			default:
				var object map[string]any
				if json.Unmarshal(data, &object) != nil {
					t.Fatal("fixture decode")
				}
				if mode == "case-alias" {
					object["Phase"] = object["phase"]
					delete(object, "phase")
				}
				if mode == "null-consumers" {
					object["consumers"] = nil
				}
				if mode == "unproved-release" {
					object["phase"] = "released"
				}
				changed, _ := json.Marshal(object)
				if err := os.WriteFile(path, changed, 0600); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := e.Call("delete-submission", Request{ID: finalID}); err == nil || !strings.Contains(err.Error(), "native saved-source retention is unavailable or unsafe") {
				t.Fatal("malformed pin did not reach exact dependency refusal", err)
			}
			if _, err := os.Stat(filepath.Join(e.Config.State, "submissions", finalID, "submission.tar.gz")); err != nil {
				t.Fatal("refusal changed protected source", err)
			}
		})
	}
}

func TestSavedSourceKnownRecordLossBlocksDeletionWithoutRecreatingAuthority(t *testing.T) {
	e, plan := sourceRetentionFixture(t)
	if _, err := e.RetainGrantSource(plan); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(e.Config.State, "source-retentions", sourceRetentionName(plan.Grant.ID, plan.Grant.Revision))); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Call("delete-submission", Request{ID: finalID}); err == nil || !strings.Contains(err.Error(), "native saved-source retention is unavailable or unsafe") {
		t.Fatal("missing known pin allowed deletion", err)
	}
	if _, err := e.RetainGrantSource(plan); err == nil {
		t.Fatal("lost consumer history was silently recreated")
	}
}
