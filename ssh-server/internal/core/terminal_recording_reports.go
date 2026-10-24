package core

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"sort"
	"strings"

	"golang.org/x/sys/unix"
)

const terminalRecordingReportLimit = 32 * 1024
const terminalRecordingReportEntries = 16

type TerminalRecordingReportView struct {
	Pane                string `json:"pane"`
	Unit                string `json:"unit"`
	Owner               string `json:"owner"`
	Version             uint64 `json:"version"`
	At                  int64  `json:"at"`
	Fault               string `json:"fault"`
	FaultStage          string `json:"fault_stage,omitempty"`
	Closed              bool   `json:"closed"`
	RecordingComplete   bool   `json:"recording_complete"`
	CleanupComplete     bool   `json:"cleanup_complete"`
	DeliveryComplete    bool   `json:"delivery_complete"`
	Generation          int    `json:"recording_generation"`
	ContinuedGeneration int    `json:"continued_generation,omitempty"`
}

type TerminalRecordingReportsSnapshot struct {
	Attempt            string                        `json:"attempt"`
	ReadOnly           bool                          `json:"read_only"`
	Complete           bool                          `json:"complete"`
	UnknownEntries     int                           `json:"unknown_entries"`
	Reports            []TerminalRecordingReportView `json:"reports"`
	CanonicalAvailable bool                          `json:"canonical_available"`
	PendingCaptured    []TerminalRecordingReportView `json:"pending_captured"`
	Note               string                        `json:"note"`
}

// Bounded private metadata inspection, even when the global state is a FIFO or
// its coordinator is gone. No Engine/config/key load, lock, repair or manager.
func ObserveTerminalRecordingReports(state, id string) (TerminalRecordingReportsSnapshot, error) {
	result := TerminalRecordingReportsSnapshot{Attempt: id, ReadOnly: true, Complete: true, Reports: []TerminalRecordingReportView{}, PendingCaptured: []TerminalRecordingReportView{}, Note: "Captured producer receipts and optional canonical tracking are separate observations, not an atomic snapshot; absence is UNKNOWN, not recording success, cleanup proof, misconduct or execution permission. Canonical acknowledgements are applied by examctl reconcile with matching configuration. Preserve pending/unsafe files; never clear them to admit a pane."}
	if root, err := readOnlyRoot(state); err == nil {
		if captured, _, err := readOnlyStateFile(root); err == nil {
			result.CanonicalAvailable = true
			for unit, proof := range captured.PaneInstances {
				if proof.Attempt == id && proof.Recording != "" {
					result.PendingCaptured = append(result.PendingCaptured, TerminalRecordingReportView{Pane: proof.Pane, Unit: unit, Owner: proof.RecordingOwner, Version: proof.RecordingRevision, Closed: proof.RecordingClosed, Generation: proof.RecordingIdentity.Generation, ContinuedGeneration: proof.RecordingContinuedGeneration})
				}
			}
			sort.Slice(result.PendingCaptured, func(i, j int) bool { return result.PendingCaptured[i].Unit < result.PendingCaptured[j].Unit })
			if len(result.PendingCaptured) > terminalRecordingReportEntries {
				result.PendingCaptured = result.PendingCaptured[:terminalRecordingReportEntries]
				result.Complete = false
			}
		}
		root.Close()
	}
	dir, err := terminalReportDirectory(state, id)
	if err != nil {
		return result, errTerminalRecordingReport
	}
	defer dir.Close()
	entries, err := dir.ReadDir(terminalRecordingReportEntries + 1)
	if err != nil && err != io.EOF {
		return result, errTerminalRecordingReport
	}
	if len(entries) > terminalRecordingReportEntries {
		result.Complete = false
		result.UnknownEntries = len(entries) - terminalRecordingReportEntries
		entries = entries[:terminalRecordingReportEntries]
	}
	for _, entry := range entries {
		report, _, err := readTerminalRecordingReport(dir, entry.Name())
		if err != nil || report.Context.Attempt != id {
			result.Complete = false
			result.UnknownEntries++
			continue
		}
		result.Reports = append(result.Reports, TerminalRecordingReportView{Pane: report.Context.Pane, Unit: report.Context.Unit, Owner: report.Owner, Version: report.Version, At: report.At, Fault: report.Fault, FaultStage: report.FaultStage, Closed: report.Closed, RecordingComplete: report.RecordingComplete, CleanupComplete: report.CleanupComplete, DeliveryComplete: report.DeliveryComplete, Generation: report.Context.Generation})
	}
	sort.Slice(result.Reports, func(i, j int) bool { return result.Reports[i].Unit < result.Reports[j].Unit })
	return result, nil
}

var errTerminalRecordingReport = errors.New("timed recording report unavailable or unsafe; preserve recording/tracking and inspect examctl panes reports ATTEMPT, then reconcile after storage/metadata repair; no permission or new clock inferred")
var errTerminalReportBusy = errors.New("timed recording reconciliation busy: another local consumer holds this attempt; preserve reports/tracking, inspect examctl panes reports ATTEMPT and retry examctl reconcile after it settles; no permission or new clock inferred")

// Never an execution permit. Files are produced only by the authenticated owner
// under the scoped private directory handed off before closed exec is released.
type terminalRecordingReport struct {
	Context           terminalRecordingContext `json:"context"`
	Owner             string                   `json:"owner"`
	Version           uint64                   `json:"version"`
	At                int64                    `json:"at"`
	Fault             string                   `json:"fault"`
	FaultStage        string                   `json:"fault_stage,omitempty"`
	Closed            bool                     `json:"closed"`
	RecordingComplete bool                     `json:"recording_complete"`
	CleanupComplete   bool                     `json:"cleanup_complete"`
	DeliveryComplete  bool                     `json:"delivery_complete"`
}

func (r terminalRecordingReport) name() string {
	_, _, instance, _ := recordedPaneIdentity(r.Context.Attempt, r.Context.Unit)
	return instance + ".json"
}

func (r terminalRecordingReport) valid() bool {
	stageValid := r.FaultStage == "" || (r.Fault != "" && (r.FaultStage == "capture" || r.FaultStage == "capture_read" || r.FaultStage == "delivery_read" || r.FaultStage == "delivery_frame" || r.FaultStage == "delivery_context" || r.FaultStage == "delivery_data" || r.FaultStage == "resize" || r.FaultStage == "close" || r.FaultStage == "descriptor_close"))
	return stageValid && r.Context.valid() && nativeCapabilityHash.MatchString(r.Owner) && r.Version > 0 &&
		r.Version <= 32 && r.At > 0 &&
		(r.Fault == "" || r.Fault == "recording_io" || r.Fault == "owner_exit") &&
		(!r.RecordingComplete || r.Closed) && (!r.CleanupComplete || r.Closed) &&
		(!r.Closed || r.RecordingComplete || r.Fault != "")
}

func terminalReportDirectory(state, id string) (*os.File, error) {
	if !attemptID.MatchString(id) {
		return nil, errTerminalRecordingReport
	}
	root, err := readOnlyRoot(state)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	supervisors, err := readOnlyOpenAt(root, "terminal-supervisors", true)
	if err != nil {
		return nil, err
	}
	defer supervisors.Close()
	return readOnlyOpenAt(supervisors, id, true)
}

func readTerminalRecordingReport(dir *os.File, name string) (terminalRecordingReport, string, error) {
	var report terminalRecordingReport
	data, err := privateControlFile(dir, name, terminalRecordingReportLimit)
	if err != nil {
		return report, "", err
	}
	if terminalDecode(data, &report) != nil || !report.valid() || report.name() != name {
		return report, "", errTerminalRecordingReport
	}
	return report, Hash(data), nil
}

func terminalOwnerStart(process *uidProcess) (uint64, error) {
	if process == nil || process.proc == nil {
		return 0, errTerminalRecordingReport
	}
	status, err := retainedProcRead(process.proc, "status", 16384)
	if err != nil {
		return 0, err
	}
	stat, err := retainedProcRead(process.proc, "stat", 4096)
	if err != nil {
		return 0, err
	}
	identity, _, err := retainedTaskSnapshot(status, stat)
	live, lifetimeErr := process.live()
	if err != nil || lifetimeErr != nil || !live || identity.TID != process.pid || identity.TGID != process.pid {
		return 0, errTerminalRecordingReport
	}
	return identity.Start, nil
}

func terminalOwnerEpoch(unit string, pid int, start uint64) string {
	return Hash([]byte(fmt.Sprintf("%s:%s:%d:%d", boot(), unit, pid, start)))
}

func terminalRecordingOwnerGone(proof PaneInstance) (bool, error) {
	if proof.RecordingPID <= 1 || proof.RecordingStart == 0 || proof.Boot == "" {
		return false, errTerminalRecordingReport
	}
	if current := boot(); current != "" && proof.Boot != current {
		return true, nil
	}
	process, err := pinUIDProcess(proof.RecordingPID, os.Geteuid())
	if err != nil {
		return false, err
	}
	if process == nil {
		return true, nil
	}
	defer process.close()
	live, err := process.live()
	if err != nil || !live {
		return !live && err == nil, err
	}
	start, err := terminalOwnerStart(process)
	return err == nil && start != proof.RecordingStart, err
}

// Only after positive producer death: no live writer can race a recovered
// receipt. A durable, exact final log marker is affirmative evidence; neither a
// missing row nor an idle owner's exit is recording-loss proof by itself.
func terminalRecordingClosedLog(state string, proof PaneInstance) (terminalRecordingReport, error) {
	report := terminalRecordingReport{Context: proof.RecordingIdentity, Owner: proof.RecordingOwner, Version: 32, At: Millis(), Closed: true, CleanupComplete: true}
	root, err := readOnlyRoot(state)
	if err != nil {
		return report, err
	}
	defer root.Close()
	monitoring, err := readOnlyOpenAt(root, "monitoring", true)
	if err != nil {
		return report, err
	}
	defer monitoring.Close()
	dir, err := readOnlyOpenAt(monitoring, proof.Attempt, true)
	if err != nil {
		return report, err
	}
	defer dir.Close()
	file, err := readOnlyOpenAt(dir, proof.Pane+".ndjson", false)
	if err != nil {
		return report, err
	}
	defer file.Close()
	if err := privateRecordingFile(file); err != nil {
		return report, err
	}
	info, err := file.Stat()
	if err != nil || info.Size() <= 0 {
		return report, errTerminalRecordingReport
	}
	start := max(int64(0), info.Size()-terminalRecordingReportLimit)
	tail := make([]byte, info.Size()-start)
	if _, err := file.ReadAt(tail, start); err != nil {
		return report, err
	}
	if tail[len(tail)-1] != '\n' {
		return report, errTerminalRecordingReport
	}
	rows := bytes.Split(bytes.TrimSuffix(tail, []byte{'\n'}), []byte{'\n'})
	var closeEvent struct {
		Event    string `json:"event"`
		Source   string `json:"source"`
		Instance string `json:"recording_instance"`
		Complete bool   `json:"recording_complete"`
		Cleanup  bool   `json:"cleanup_complete"`
		Delivery bool   `json:"delivery_complete"`
	}
	if json.Unmarshal(rows[len(rows)-1], &closeEvent) != nil || closeEvent.Event != "close" || closeEvent.Source != "class-agent" || closeEvent.Instance != proof.Recording || !closeEvent.Cleanup {
		return report, errTerminalRecordingReport
	}
	if err := file.Sync(); err != nil {
		return report, err
	}
	if err := dir.Sync(); err != nil {
		return report, err
	}
	report.RecordingComplete = closeEvent.Complete
	report.DeliveryComplete = closeEvent.Delivery
	if !closeEvent.Complete {
		report.Fault = "recording_io"
	}
	return report, nil
}

// Called only after positive pinned-owner exit (live parent) or a rechecked
// persisted boot/PID/start identity (restart). A successful existing close is
// never rewritten as a fault merely because its finished producer has exited.
func (e *Engine) publishTerminalOwnerExit(unit string, cleanup bool) error {
	var proof PaneInstance
	if err := e.WithState(func() error { proof = e.state.PaneInstances[unit]; return nil }); err != nil {
		return err
	}
	if proof.Recording == "" || proof.RecordingClosed || !nativeCapabilityHash.MatchString(proof.RecordingOwner) {
		return nil
	}
	dir, err := terminalReportDirectory(e.Config.State, proof.Attempt)
	if err != nil {
		return err
	}
	defer dir.Close()
	previous, _, err := readTerminalRecordingReport(dir, proof.ID+".json")
	if err == nil && (previous.Context != proof.RecordingIdentity || previous.Owner != proof.RecordingOwner || previous.Version < proof.RecordingRevision) {
		return errTerminalRecordingReport
	}
	if err == nil && previous.Closed {
		return nil
	}
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if cleanup {
		if completed, err := terminalRecordingClosedLog(e.Config.State, proof); err == nil {
			if previous.Fault != "" {
				completed.Fault = previous.Fault
			}
			return publishTerminalRecordingReport(dir, completed)
		}
	}
	version := uint64(30)
	if cleanup {
		version = 31
	}
	if err == nil && previous.Version == version {
		return nil
	}
	fault := "owner_exit"
	if previous.Fault != "" {
		fault = previous.Fault
	}
	return publishTerminalRecordingReport(dir, terminalRecordingReport{Context: proof.RecordingIdentity, Owner: proof.RecordingOwner, Version: version, At: Millis(), Fault: fault, Closed: cleanup, CleanupComplete: cleanup})
}

func publishTerminalRecordingReport(dir *os.File, report terminalRecordingReport) error {
	if !report.valid() || readOnlyPrivateDir(dir) != nil {
		return errTerminalRecordingReport
	}
	data, err := json.Marshal(report)
	if err != nil || len(data) > terminalRecordingReportLimit {
		return errTerminalRecordingReport
	}
	// The immutable incarnation filename has one producer; rename publishes a
	// complete snapshot. A newer revision retains earlier fault information.
	name := report.name()
	temporary := strings.TrimSuffix(name, ".json") + ".stage-" + ManagementID()
	fd, err := unix.Openat(int(dir.Fd()), temporary, unix.O_WRONLY|unix.O_CREAT|unix.O_EXCL|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0600)
	if err != nil {
		return err
	}
	file := os.NewFile(uintptr(fd), "private-recording-report")
	defer unix.Unlinkat(int(dir.Fd()), temporary, 0)
	if n, writeErr := file.Write(data); writeErr != nil || n != len(data) {
		file.Close()
		return errTerminalRecordingReport
	}
	err = file.Sync()
	closeErr := file.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if err := unix.Renameat(int(dir.Fd()), temporary, int(dir.Fd()), name); err != nil {
		return err
	}
	return dir.Sync()
}

// Snapshot reads stay outside the canonical lock; exact identity/revision is
// rechecked inside it. Tick and explicit native reconcile use this same path.
func (e *Engine) reconcileTerminalRecordingReports() error {
	type expected struct {
		unit  string
		proof PaneInstance
	}
	var pending []expected
	if err := e.WithState(func() error {
		for unit, proof := range e.state.PaneInstances {
			if proof.Recording != "" {
				pending = append(pending, expected{unit, proof})
			}
		}
		return nil
	}); err != nil {
		return err
	}
	var problems []error
	sort.Slice(pending, func(i, j int) bool {
		if pending[i].proof.Attempt != pending[j].proof.Attempt {
			return pending[i].proof.Attempt < pending[j].proof.Attempt
		}
		return pending[i].unit < pending[j].unit
	})
	var claim *os.File
	var claimed string
	defer func() {
		if claim != nil {
			claim.Close()
		}
	}()
	for _, entry := range pending {
		if claimed != entry.proof.Attempt {
			if claim != nil {
				claim.Close()
				claim = nil
			}
			claimed = entry.proof.Attempt
			root, err := terminalSupervisorDirectory(e.Config.State)
			if err == nil {
				claim, err = terminalSupervisorLock(root, claimed+".reports")
				root.Close()
			}
			if err != nil {
				if errors.Is(err, unix.EWOULDBLOCK) || errors.Is(err, unix.EAGAIN) {
					problems = append(problems, errTerminalReportBusy)
				} else {
					problems = append(problems, errTerminalRecordingReport)
				}
			}
		}
		if claim == nil {
			continue
		} // Another canonical consumer owns this attempt; never wait/drop evidence.
		dir, err := terminalReportDirectory(e.Config.State, entry.proof.Attempt)
		if err != nil {
			problems = append(problems, errTerminalRecordingReport)
			continue
		}
		name := entry.proof.ID + ".json"
		report, digest, err := readTerminalRecordingReport(dir, name)
		if err == nil && entry.proof.ReadyAt == 0 && !entry.proof.Cancelled && entry.proof.ClosedUntil > Millis() && !report.Closed && report.Fault == "" {
			// Initial attachment is inspectable, not an acknowledgement which
			// may mutate the parent's still-CLOSED final-release proof. Cancelled/
			// expired starts still reconcile/reap; this never extends their bound.
			dir.Close()
			continue
		}
		if entry.proof.RecordingOwner == "" && !(err == nil && report.Closed && report.CleanupComplete && entry.proof.ReadyAt == 0 && entry.proof.Cancelled) {
			dir.Close()
			continue
		}
		// A completed valid producer receipt wins over its later idle exit.
		// Missing replies/reports never prove death; only kernel lifetime does.
		if !entry.proof.RecordingClosed && (errors.Is(err, os.ErrNotExist) || (err == nil && !report.Closed)) {
			gone, probeErr := terminalRecordingOwnerGone(entry.proof)
			if probeErr == nil && gone {
				var closed *Attempt
				_ = e.WithState(func() error {
					if a := e.state.Attempts[entry.proof.Attempt]; a != nil {
						copy := *a
						copy.Units = []string{entry.unit}
						closed = &copy
					}
					return nil
				})
				if closed != nil {
					cleanupErr := e.terminate(closed)
					if publishErr := e.publishTerminalOwnerExit(entry.unit, cleanupErr == nil); publishErr != nil {
						problems = append(problems, publishErr)
					}
					report, digest, err = readTerminalRecordingReport(dir, name)
				}
			}
		}
		alreadyRemoved := errors.Is(err, os.ErrNotExist) && entry.proof.RecordingClosed && entry.proof.RecordingAck != ""
		if err != nil && !alreadyRemoved {
			dir.Close()
			// Absence is not a successful recording/cleanup receipt or a fault.
			if !errors.Is(err, os.ErrNotExist) {
				problems = append(problems, errTerminalRecordingReport)
			}
			continue
		}
		// Establish report durability before recording its canonical acknowledgement.
		if err := dir.Sync(); err != nil {
			dir.Close()
			problems = append(problems, err)
			continue
		}
		acknowledged := PaneInstance{}
		if report.Fault != "" && e.terminalFailureCheckpoint != nil {
			e.terminalFailureCheckpoint("before-state")
		}
		err = e.WithState(func() error {
			proof, ok := e.state.PaneInstances[entry.unit]
			if !ok || proof != entry.proof {
				return nil // A simultaneous exact close/reconciliation won.
			}
			if alreadyRemoved {
				acknowledged = proof
				return nil
			}
			if proof.RecordingOwner == "" && proof.ReadyAt == 0 && proof.Cancelled && report.Closed && report.CleanupComplete {
				proof.RecordingOwner = report.Owner
			}
			if proof.RecordingIdentity.hash() != proof.Recording || report.Context != proof.RecordingIdentity || report.Context.Unit != entry.unit ||
				report.Owner != proof.RecordingOwner || report.Version < proof.RecordingRevision ||
				(report.Version == proof.RecordingRevision && proof.RecordingAck != digest) {
				return errTerminalRecordingReport
			}
			if report.Version == proof.RecordingRevision {
				if proof.RecordingClosed {
					acknowledged = proof
				}
				return nil
			}
			if report.Fault != "" && proof.ReadyAt > 0 {
				if err := e.recordingFaultLocked(report.Context); err != nil {
					return err
				}
			}
			proof.RecordingRevision, proof.RecordingAck = report.Version, digest
			if report.Closed && report.CleanupComplete {
				// A failed recording is acknowledged as a failure, never relabelled
				// successful. Its normal containment/audit persists independently.
				proof.RecordingClosed = true
			}
			e.state.PaneInstances[entry.unit] = proof
			e.Audit("terminal-recording-report", proof.Attempt, proof.Pane, entry.unit,
				fmt.Sprintf("revision=%d recording_complete=%t cleanup_complete=%t delivery_complete=%t fault=%s stage=%s", report.Version, report.RecordingComplete, report.CleanupComplete, report.DeliveryComplete, report.Fault, report.FaultStage))
			if proof.RecordingClosed {
				acknowledged = proof
			}
			return nil
		})
		if report.Fault != "" && e.terminalFailureCheckpoint != nil {
			e.terminalFailureCheckpoint("after-state")
		}
		// Only a durable canonical final acknowledgement permits deleting the
		// finished producer's report. Keep its proof through unlink+directory sync;
		// a crash at either boundary retries without inventing success from absence.
		if err == nil && acknowledged.RecordingClosed && acknowledged.RecordingAck != "" {
			if !alreadyRemoved {
				err = unix.Unlinkat(int(dir.Fd()), name, 0)
			}
			if err == nil {
				err = dir.Sync()
			}
			if err == nil {
				err = e.WithState(func() error {
					if current := e.state.PaneInstances[entry.unit]; current == acknowledged {
						if a := e.state.Attempts[current.Attempt]; a != nil {
							removePaneUnit(e.state.PaneInstances, a, entry.unit)
							delete(e.state.PaneInstances, entry.unit) // Final ack + unlink + directory sync completed above.
						}
					}
					return nil
				})
			}
		}
		dir.Close()
		if err != nil {
			problems = append(problems, err)
		}
	}
	return errors.Join(problems...)
}
