package core

import (
	"encoding/json"
	"errors"
	"os"
	"regexp"
	"sort"
	"strings"
	"syscall"
	"unicode/utf8"
)

type NativePaneQuery struct {
	Attempt, Pane, After string
	Limit                int
}
type NativePane struct {
	ID                string   `json:"id"`
	Revision          string   `json:"revision,omitempty"`
	RecordedKinds     []string `json:"recorded_kinds"`
	Incarnations      []string `json:"incarnations"`
	PendingAdmissions int      `json:"pending_admissions"`
	PendingUnexpired  int      `json:"pending_unexpired_at_read"`
	ClosedStartups    int      `json:"closed_startups"`
	CancelledStartups int      `json:"cancelled_startups"`
	StartupExpires    int64    `json:"earliest_startup_expiry,omitempty"`
	Present           bool     `json:"recorded_present"`
	Unsafe            bool     `json:"unsafe_metadata"`
}
type NativePanesSnapshot struct {
	Version           int          `json:"version"`
	ReadOnly          bool         `json:"read_only"`
	Complete          bool         `json:"complete"`
	ObservedAt        int64        `json:"observed_at"`
	Attempt           string       `json:"attempt"`
	Exam              string       `json:"exam"`
	Username          string       `json:"username"`
	UID               int          `json:"uid"`
	State             string       `json:"state"`
	Generation        int          `json:"generation"`
	ClockRevision     int          `json:"clock_revision"`
	Start             int64        `json:"start"`
	Deadline          int64        `json:"deadline"`
	OriginalDeadline  int64        `json:"original_deadline"`
	AccessState       string       `json:"access_state"`
	RecordedProtected bool         `json:"recorded_protected"`
	UnknownUnits      int          `json:"unknown_unit_count"`
	UnknownAdmissions int          `json:"unknown_admission_count"`
	Panes             []NativePane `json:"panes"`
	Next              string       `json:"next,omitempty"`
	Note              string       `json:"note"`
}

var nativePaneRevision = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)
var nativeCapabilityHash = regexp.MustCompile(`^[a-f0-9]{64}$`)

func (q NativePaneQuery) Validate() error {
	if !monitoringUUID.MatchString(q.Attempt) || q.Limit < 1 || q.Limit > 200 || (q.Pane != "" && (!monitoringUUID.MatchString(q.Pane) || q.After != "")) || (q.After != "" && !monitoringUUID.MatchString(q.After)) {
		return errors.New("select one attempt UUID and optional pane UUID, or list --limit 1..200 --after PANE; see examctl help panes")
	}
	return nil
}

type nativePaneSource struct {
	Device, Inode uint64
	Boot          string
}

func nativePaneSourceAt(root *os.File) (nativePaneSource, error) {
	info, err := root.Stat()
	if err != nil {
		return nativePaneSource{}, errReadOnlySnapshot
	}
	stat := info.Sys().(*syscall.Stat_t)
	return nativePaneSource{Device: uint64(stat.Dev), Inode: stat.Ino, Boot: boot()}, nil
}

func recordedPaneIdentity(attempt, unit string) (string, string, string, bool) {
	value, ok := strings.CutPrefix(unit, "exam-"+attempt+"-")
	if !ok {
		return "", "", "", false
	}
	for _, kind := range []string{"scope", "service"} {
		pane, ok := strings.CutSuffix(value, "."+kind)
		if ok && monitoringUUID.MatchString(pane) {
			return pane, kind, "", true
		}
		if ok && len(pane) == 73 && pane[36] == '-' && monitoringUUID.MatchString(pane[:36]) && monitoringUUID.MatchString(pane[37:]) {
			return pane[:36], kind, pane[37:], true
		}
	}
	return "", "", "", false
}
func paneInstanceReady(state State, a *Attempt, unit, currentBoot string) bool {
	pane, _, instance, ok := recordedPaneIdentity(a.ID, unit)
	proof, found := state.PaneInstances[unit]
	return ok && instance != "" && currentBoot != "" && found && proof.Attempt == a.ID && proof.Pane == pane && proof.ID == instance && proof.Boot == currentBoot && proof.ReadyAt > 0 && proof.ClosedUntil == 0 && proof.ClosedBootUntil == 0 && !proof.Cancelled
}

// Fingerprint ONLY scoped nonsecret control facts, never generic attempt JSON
// (which contains handoff private keys). Source identity fences cloned backups.
func nativePaneRecord(state State, a *Attempt, pane string, source nativePaneSource, at int64) NativePane {
	v := NativePane{ID: pane, RecordedKinds: []string{}, Incarnations: []string{}}
	units := []string{}
	proofs := map[string]PaneInstance{}
	for _, unit := range a.Units {
		id, kind, instance, ok := recordedPaneIdentity(a.ID, unit)
		if ok && id == pane {
			v.RecordedKinds = append(v.RecordedKinds, kind)
			v.Incarnations = append(v.Incarnations, instance)
			units = append(units, unit)
			proof := state.PaneInstances[unit]
			proofs[unit] = proof
			if paneInstanceClosed(state, a, unit, source.Boot) {
				v.ClosedStartups++
				if proof.Cancelled {
					v.CancelledStartups++
				}
				if v.StartupExpires == 0 || proof.ClosedUntil < v.StartupExpires {
					v.StartupExpires = proof.ClosedUntil
				}
			} else if !paneInstanceReady(state, a, unit, source.Boot) {
				v.Unsafe = true
			}
		}
	}
	sort.Strings(v.RecordedKinds)
	sort.Strings(v.Incarnations)
	sort.Strings(units)
	type pendingFact struct {
		Hash                                       string
		Expires                                    int64
		Practice, Exam, OwnerMatch, TransportMatch bool
	}
	facts := []pendingFact{}
	for hash, cap := range state.Caps {
		if cap.ID != a.ID || cap.Pane != pane {
			continue
		}
		v.PendingAdmissions++
		if cap.Expires > at {
			v.PendingUnexpired++
		}
		if !nativeCapabilityHash.MatchString(hash) {
			v.Unsafe = true
			continue
		}
		facts = append(facts, pendingFact{Hash: hash, Expires: cap.Expires, Practice: cap.Purpose == "practice", Exam: cap.Purpose == "exam", OwnerMatch: cap.Username == a.Username, TransportMatch: cap.Transport == a.Transport})
	}
	v.Present = len(v.RecordedKinds) > 0 || v.PendingAdmissions > 0
	if v.Unsafe {
		return v
	}
	sort.Slice(facts, func(i, j int) bool { return facts[i].Hash < facts[j].Hash })
	owner := struct {
		Attempt, Exam, Username, Transport, Boot, State, Access, Policy, PolicyGeneration string
		UID, Generation, ClockRevision                                                    int
		Start, Deadline, OriginalDeadline                                                 int64
	}{a.ID, a.Exam, a.Username, a.Transport, a.Boot, a.State, a.AccessState, a.PolicyState, a.PolicyGeneration, a.UID, a.Generation, a.ClockRevision, a.Start, a.Deadline, a.OriginalDeadline}
	b, _ := json.Marshal(struct {
		Source  nativePaneSource
		Owner   any
		Pane    string
		Kinds   []string
		Units   []string
		Pending []pendingFact
		Proofs  map[string]PaneInstance
	}{source, owner, pane, v.RecordedKinds, units, facts, proofs})
	v.Revision = "sha256:" + Hash(b)
	return v
}

func nativePanesSnapshot(state State, source nativePaneSource, q NativePaneQuery) (NativePanesSnapshot, error) {
	var result NativePanesSnapshot
	a := state.Attempts[q.Attempt]
	if a == nil || a.ID != q.Attempt || !identifier.MatchString(a.Exam) || !identifier.MatchString(a.Username) || a.UID < 1000 || a.Generation < 0 || a.ClockRevision < 0 {
		return result, errors.New("attempt unavailable or unsafe in captured native state; preserve records and use examctl list --read-only; see examctl help panes")
	}
	result = NativePanesSnapshot{Version: 1, ReadOnly: true, Complete: true, ObservedAt: Millis(), Attempt: a.ID, Exam: a.Exam, Username: a.Username, UID: a.UID, State: a.State, Generation: a.Generation, ClockRevision: a.ClockRevision, Start: a.Start, Deadline: a.Deadline, OriginalDeadline: a.OriginalDeadline, AccessState: a.AccessState, RecordedProtected: a.Protected, Panes: []NativePane{}, Note: "Captured native pane metadata only, not live SSH, monitoring, writer absence, archive verification, cleanup eligibility or work permission. No keys, tokens, input bytes or raw state. Read paths never initialize/reconcile/repair or contact a manager. A reviewed close targets recorded scopes/admissions only, never the entire account."}
	ids := map[string]bool{}
	for _, unit := range a.Units {
		pane, _, _, ok := recordedPaneIdentity(a.ID, unit)
		if ok {
			ids[pane] = true
		} else {
			result.UnknownUnits++
			result.Complete = false
		}
	}
	for hash, cap := range state.Caps {
		if cap.ID != a.ID {
			continue
		}
		if monitoringUUID.MatchString(cap.Pane) {
			ids[cap.Pane] = true
		} else {
			result.UnknownAdmissions++
			result.Complete = false
		}
		if !nativeCapabilityHash.MatchString(hash) {
			result.Complete = false
		}
	}
	if q.Pane != "" {
		result.Panes = append(result.Panes, nativePaneRecord(state, a, q.Pane, source, result.ObservedAt))
		if result.Panes[0].Unsafe {
			result.Complete = false
		}
		return result, nil
	}
	ordered := []string{}
	for id := range ids {
		if id > q.After {
			ordered = append(ordered, id)
		}
	}
	sort.Strings(ordered)
	if len(ordered) > q.Limit {
		result.Next = ordered[q.Limit-1]
		ordered = ordered[:q.Limit]
	}
	for _, id := range ordered {
		result.Panes = append(result.Panes, nativePaneRecord(state, a, id, source, result.ObservedAt))
		if result.Panes[len(result.Panes)-1].Unsafe {
			result.Complete = false
		}
	}
	return result, nil
}

func ObserveNativePanes(stateDir string, q NativePaneQuery) (NativePanesSnapshot, error) {
	var empty NativePanesSnapshot
	if err := q.Validate(); err != nil {
		return empty, err
	}
	root, err := readOnlyRoot(stateDir)
	if err != nil {
		return empty, err
	}
	defer root.Close()
	state, _, err := readOnlyStateFile(root)
	if err != nil {
		return empty, err
	}
	source, err := nativePaneSourceAt(root)
	if err != nil {
		return empty, err
	}
	return nativePanesSnapshot(state, source, q)
}

type NativePaneCloseResult struct {
	Attempt                 string `json:"attempt"`
	Pane                    string `json:"pane"`
	ReviewedRevision        string `json:"reviewed_revision"`
	RecordedTargetsQuiesced bool   `json:"recorded_targets_quiesced"`
	AlreadyAbsent           bool   `json:"already_recorded_absent"`
	ClosedStartupsRevoked   int    `json:"closed_startups_revoked"`
	ClockChanged            bool   `json:"clock_changed"`
	AccessReleased          bool   `json:"access_released"`
	Note                    string `json:"note"`
}

func (e *Engine) CloseNativePane(id, pane, revision, reason string) (NativePaneCloseResult, error) {
	if os.Getuid() != 0 || os.Geteuid() != 0 {
		return NativePaneCloseResult{}, errors.New("pane close requires real/effective root; no action performed")
	}
	return e.closeNativePaneReviewed(id, pane, revision, reason)
}

func (e *Engine) closeNativePaneReviewed(id, pane, revision, reason string) (NativePaneCloseResult, error) {
	var result NativePaneCloseResult
	reason = strings.TrimSpace(reason)
	q := NativePaneQuery{Attempt: id, Pane: pane, Limit: 1}
	if err := q.Validate(); err != nil {
		return result, err
	}
	if pane == "" || !nativePaneRevision.MatchString(revision) || !utf8.ValidString(reason) || len(reason) < 8 || len(reason) > 1000 {
		return result, errors.New("pane close requires exact UUIDs, reviewed --revision and valid UTF-8 --reason 8..1000 bytes; see examctl help panes")
	}
	err := e.WithState(func() error {
		root, err := readOnlyRoot(e.Config.State)
		if err != nil {
			return err
		}
		defer root.Close()
		source, err := nativePaneSourceAt(root)
		if err != nil {
			return err
		}
		before, err := nativePanesSnapshot(e.state, source, q)
		if err != nil {
			return err
		}
		current := before.Panes[0]
		if current.Unsafe || current.Revision != revision {
			return errors.New("pane control snapshot changed or is unsafe; inspect fresh examctl panes show ATTEMPT PANE and explicitly review it; the old close request was not applied")
		}
		if err := e.appendNativeManagementAudit(map[string]any{"at": Millis(), "action": "administrator-pane-close-requested", "attempt": id, "pane": pane, "reviewed_revision": revision, "reason": reason, "actor_uid": os.Getuid(), "effective_uid": os.Geteuid(), "recorded_scopes": len(current.RecordedKinds), "pending_admissions": current.PendingAdmissions}); err != nil {
			return errors.New("pane close could not be durably audited; no revocation or termination requested; preserve native audit/storage and inspect permissions/capacity")
		}
		if _, err := e.closePaneLocked(e.state.Attempts[id], pane); err != nil {
			return errors.New("pane termination unconfirmed; pending admissions remain revoked and recorded scopes retained; preserve work, inspect native state and matching manager controls, then review a fresh pane snapshot")
		}
		result = NativePaneCloseResult{Attempt: id, Pane: pane, ReviewedRevision: revision, RecordedTargetsQuiesced: true, AlreadyAbsent: !current.Present, ClosedStartupsRevoked: current.ClosedStartups, Note: "Only recorded target scopes/admissions were closed. A cancelled trusted bootstrap can finish/refuse later, but cannot release student exec; this is not proof every root setup process is already gone. Other panes, clocks, account restrictions, grants and protected submissions are not released or deleted. This is not all-UID writer proof, cleanup eligibility, current monitoring or permission to work. After a lost reply inspect fresh read-only pane status; never silently adopt a replacement revision."}
		return nil
	})
	if err != nil {
		return NativePaneCloseResult{}, err
	}
	return result, nil
}
