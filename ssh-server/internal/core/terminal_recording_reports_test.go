package core

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/sys/unix"
)

// These complement the real gate/owner tests: actual Tick and private files,
// synthetic canonical scopes, with only exact scope termination replaced.
func TestActualTickTimedRecordingReportCrashAndRefusalBoundaries(t *testing.T) {
	for _, mode := range []string{"success", "concurrent-consumers", "ack-diagnostics", "manual-close-after-ack", "ack-before-delete", "delete-before-retire", "closed-without-ack", "unattached-expired", "live-missing", "unsafe-fifo", "unsafe-symlink", "unsafe-proof-path", "foreign-owner", "foreign-context", "dead-foreign-owner", "dead-foreign-context", "replayed-revision", "dead-success-report", "dead-closed-log", "dead-lost-recording", "dead-cleanup-retry", "closed-cancelled"} {
		t.Run(mode, func(t *testing.T) {
			e, _, request := preparationFixture(t)
			e.preparationReady = func() (bool, []string) { return true, nil }
			if _, err := e.Call("prepare-attempt", request); err != nil {
				t.Fatal(err)
			}
			self, err := pinUIDProcess(os.Getpid(), os.Geteuid())
			if err != nil || self == nil {
				t.Fatal("fixture did not pin its live owner", err)
			}
			start, err := terminalOwnerStart(self)
			self.close()
			if err != nil {
				t.Fatal(err)
			}
			if strings.HasPrefix(mode, "dead-") {
				if start <= 1 {
					t.Fatal("fixture cannot model a retired owner start")
				}
				start--
			}
			unit := "exam-" + request.ID + "-" + finalID + "-" + ManagementID() + ".scope"
			proof := PaneInstance{Attempt: request.ID, Pane: finalID, Boot: boot(), ReadyAt: Millis(), Supervisor: terminalSupervisorUnit(e.Config.State, request.ID), RecordingPID: os.Getpid(), RecordingStart: start}
			_, _, proof.ID, _ = recordedPaneIdentity(request.ID, unit)
			proof.RecordingOwner = terminalOwnerEpoch(proof.Supervisor, proof.RecordingPID, start)
			var original Attempt
			if err := e.WithState(func() error {
				a := e.state.Attempts[request.ID]
				a.State = "ACTIVE"
				a.BrowserSSH = true
				commitStart(a, Millis(), uptime(), boot())
				a.Units = []string{unit}
				proof.RecordingIdentity = recordingContext(*a, finalID, unit)
				proof.Recording = proof.RecordingIdentity.hash()
				original = *a
				if mode == "closed-cancelled" {
					proof.ReadyAt = 0
					proof.Cancelled = true
					proof.ClosedUntil = Millis() - 1
					proof.ClosedBootUntil = 1
					a.Units = nil
				}
				if mode == "unattached-expired" {
					proof.ReadyAt = 0
					proof.ClosedUntil = Millis() - 1
					proof.ClosedBootUntil = 1
					proof.RecordingOwner = ""
					proof.RecordingPID = 0
					proof.RecordingStart = 0
				}
				if mode == "unsafe-proof-path" {
					proof.Attempt = "../escaped-report-claim"
				}
				e.state.PaneInstances = map[string]PaneInstance{unit: proof}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			cleanupCalls := 0
			e.terminate = func(a *Attempt) error {
				if a.ID != request.ID || len(a.Units) != 1 || a.Units[0] != unit {
					t.Error("termination escaped the exact synthetic pane", a.ID, a.Units)
				}
				cleanupCalls++
				if mode == "dead-cleanup-retry" && cleanupCalls == 1 {
					return errors.New("synthetic exact cleanup initially unconfirmed")
				}
				return nil
			}
			resources, err := terminalRecordingResources(e.Config.State, request.ID)
			if err != nil {
				t.Fatal(err)
			}
			defer func() {
				for _, f := range resources {
					f.Close()
				}
			}()
			report := terminalRecordingReport{Context: proof.RecordingIdentity, Owner: proof.RecordingOwner, Version: 2, At: Millis(), Closed: true, RecordingComplete: true, CleanupComplete: true, DeliveryComplete: true}
			if mode == "ack-diagnostics" {
				report.Version = 1
				report.Closed = false
				report.RecordingComplete = false
				report.CleanupComplete = false
			}
			var reviewed NativePanesSnapshot
			if mode == "ack-diagnostics" {
				var err error
				reviewed, err = ObserveNativePanes(e.Config.State, NativePaneQuery{Attempt: request.ID, Pane: finalID, Limit: 1})
				if err != nil || len(reviewed.Panes) != 1 || reviewed.Panes[0].Revision == "" {
					t.Fatal("recording diagnostic fixture missed reviewable pane", reviewed, err)
				}
			}
			name := filepath.Join(e.Config.State, "terminal-supervisors", request.ID, proof.ID+".json")
			unsafe := strings.HasPrefix(mode, "unsafe-") || strings.Contains(mode, "foreign-") || mode == "replayed-revision"
			switch mode {
			case "live-missing", "unattached-expired", "closed-without-ack", "dead-closed-log", "dead-lost-recording", "dead-cleanup-retry", "delete-before-retire":
			case "unsafe-fifo":
				if err := unix.Mkfifo(name, 0600); err != nil {
					t.Fatal(err)
				}
			case "unsafe-symlink":
				if err := os.Symlink(filepath.Join(e.Config.State, "state.json"), name); err != nil {
					t.Fatal(err)
				}
			default:
				if strings.Contains(mode, "foreign-owner") {
					report.Owner = Hash([]byte("foreign"))
				}
				if strings.Contains(mode, "foreign-context") {
					report.Context.Generation++
				}
				if mode == "replayed-revision" {
					report.Version = 1
				}
				if strings.HasPrefix(mode, "dead-foreign-") {
					report.Closed = false
					report.RecordingComplete = false
					report.CleanupComplete = false
				}
				if err := publishTerminalRecordingReport(resources[2], report); err != nil {
					t.Fatal(err)
				}
			}
			if mode == "ack-before-delete" || mode == "manual-close-after-ack" || mode == "delete-before-retire" || mode == "replayed-revision" || mode == "closed-without-ack" {
				data, _ := json.Marshal(report)
				proof.RecordingRevision, proof.RecordingAck = 2, Hash(data)
				proof.RecordingClosed = mode != "replayed-revision"
				if mode == "closed-without-ack" {
					proof.RecordingAck = ""
				}
				if err := e.WithState(func() error { e.state.PaneInstances[unit] = proof; return nil }); err != nil {
					t.Fatal(err)
				}
			}
			if mode == "manual-close-after-ack" {
				if _, err := e.Call("close-pane", Request{ID: request.ID, Pane: finalID}); err != nil {
					t.Fatal("actual exact close after durable acknowledgement failed", err)
				}
			}
			if mode == "dead-closed-log" {
				storage, err := newSupervisedRecordingStorage(e.Config.State, request.ID, e.terminalRecordingLimit(), resources)
				if err != nil {
					t.Fatal(err)
				}
				defer storage.close()
				recorder, err := storage.newRecorder(finalID, proof.Recording)
				if err != nil {
					t.Fatal(err)
				}
				if err := recorder.record(map[string]any{"event": "close", "recording_complete": true, "cleanup_complete": true, "delivery_complete": true}); err != nil {
					t.Fatal(err)
				}
				if err := recorder.file.Close(); err != nil {
					t.Fatal(err)
				}
			}
			if mode == "concurrent-consumers" {
				peer, err := New(e.Config)
				if err != nil {
					t.Fatal(err)
				}
				done := make(chan error, 2)
				go func() { done <- e.Tick() }()
				go func() { done <- peer.Tick() }()
				for range 2 {
					if err := <-done; err != nil && !errors.Is(err, errTerminalReportBusy) {
						t.Fatal("concurrent canonical consumer failed", err)
					}
				}
			}
			if err := e.Tick(); (err != nil) != unsafe {
				t.Fatal("actual Tick misreported recording reconciliation", mode, err)
			}
			if mode == "dead-cleanup-retry" {
				captured, err := readStateSnapshot(e.Config.State)
				if err != nil {
					t.Fatal(err)
				}
				if p := captured.PaneInstances[unit]; p.RecordingRevision != 30 || p.RecordingClosed {
					t.Fatal("unconfirmed cleanup was retired or not acknowledged", p)
				}
				restarted, err := New(e.Config)
				if err != nil {
					t.Fatal(err)
				}
				restarted.terminate = e.terminate
				if err := restarted.Tick(); err != nil {
					t.Fatal("positive cleanup revision could not complete after restart", err)
				}
			}
			state, err := readStateSnapshot(e.Config.State)
			if err != nil {
				t.Fatal(err)
			}
			a := state.Attempts[request.ID]
			wantLocked := mode == "dead-lost-recording" || mode == "dead-cleanup-retry"
			if (a.State == "LOCKED") != wantLocked || (!wantLocked && a.State != "ACTIVE") || a.Start != original.Start || a.Deadline != original.Deadline || a.OriginalDeadline != original.OriginalDeadline || a.AccessState != "HELD" {
				t.Fatal("report uncertainty manufactured a fault or altered original authority", mode, a)
			}
			_, pending := state.PaneInstances[unit]
			if mode == "ack-diagnostics" {
				current, err := ObserveNativePanes(e.Config.State, NativePaneQuery{Attempt: request.ID, Pane: finalID, Limit: 1})
				if err != nil || len(current.Panes) != 1 || current.Panes[0].Revision != reviewed.Panes[0].Revision || state.PaneInstances[unit].RecordingRevision != 1 || state.PaneInstances[unit].RecordingAck == "" {
					t.Fatal("non-authoritative acknowledgement spuriously changed reviewed pane revision", reviewed, current, err)
				}
				return
			}
			if pending != (unsafe || mode == "live-missing" || mode == "closed-without-ack") {
				t.Fatal("receipt retired before durable acknowledgement or stranded after it", mode, state.PaneInstances)
			}
			if pending {
				if state.PaneInstances[unit] != proof {
					t.Fatal("unsafe/absent report mutated its proof", mode)
				}
			} else if _, err := os.Lstat(name); !os.IsNotExist(err) {
				t.Fatal("acknowledged report retained capacity", mode, err)
			}
			if _, err := os.Lstat(filepath.Join(e.Config.State, "escaped-report-claim.reports.lock")); !os.IsNotExist(err) {
				t.Fatal("corrupt proof escaped its private claim directory", err)
			}
		})
	}
}
