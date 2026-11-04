package core

// Runtime caller: the distinct signed student files-only Resume command. No
// archived-source grant, activation, clock reset or legacy thaw is involved.
import (
	"context"
	"errors"
	"net"
	"os"
	"path/filepath"
	"reflect"
	"slices"
)

const monitoringFilesContinue = "monitoring-files-continue/v1"

var errFilesResume = errors.New("files-only resume is unavailable or changed; preserve the attempt, saved files, deadline and account hold; check the current approval, confirmed old SSH exit and examctl panes supervisor ATTEMPT before retrying Resume")

// An independently authorized clock revision cannot make an exited SSH
// lifetime live again. All transport/page/input/generation identity stays exact.
func sameExitedLifetime(recorded, current monitoringOwner) bool {
	if recorded.ClockRevision > current.ClockRevision {
		return false
	}
	recorded.ClockRevision, current.ClockRevision = 0, 0
	return recorded == current
}

func validFilesReplacement(previous, next monitoringOwner) bool {
	return validMonitoringOwner(previous) && validMonitoringOwner(next) &&
		previous.Attempt == next.Attempt && previous.Exam == next.Exam &&
		previous.Username == next.Username && previous.UID == next.UID &&
		previous.Boot == next.Boot && previous.TransportHash != next.TransportHash &&
		previous.PageEpoch != next.PageEpoch && previous.InputEpoch != next.InputEpoch &&
		next.Generation > previous.Generation && next.ClockRevision >= previous.ClockRevision
}

// Called only after the coordinator has terminated the old recorded scopes.
// A live/unknown pinned SSH peer cannot be displaced. A lost reply may leave a
// NEW, empty authority; reuse only its actual live result, never saved metadata.
func (s *terminalSupervisor) prepareFilesReplacement(q terminalAuthorityRequest, reply *terminalAuthorityReply) (bool, error) {
	if q.PreviousOwner == nil || !validFilesReplacement(*q.PreviousOwner, q.Owner) {
		return false, errMonitoringScope
	}
	s.mu.Lock()
	r := s.workAuthority
	if s.active != 0 || len(s.requests) != 0 {
		s.mu.Unlock()
		return false, errTerminalHold
	}
	if r != nil {
		if r.filesPreviousOwner != nil && sameExitedLifetime(*r.filesPreviousOwner, *q.PreviousOwner) {
			existing, requested := r.owner, q.Owner
			existing.InputEpoch, requested.InputEpoch = "", ""
			if *r.filesPreviousOwner == *q.PreviousOwner && existing == requested && r.live.Load() && r.peer.current() && r.claim.current() {
				view := r.authority.check()
				if view.ExecutionAuthorized {
					reply.Begin = &terminalAuthorityBegin{Attempt: s.id, Nonce: r.beginNonce, Owner: r.owner}
					reply.View = &view
					s.mu.Unlock()
					return true, nil
				}
			}
		} else if !sameExitedLifetime(r.owner, *q.PreviousOwner) || r.peer.observation() != "exited" {
			s.mu.Unlock()
			return false, errMonitoringProcess
		}
		for unit := range r.launches {
			if _, err := os.Stat(filepath.Join("/sys/fs/cgroup/exam.slice", unit)); !os.IsNotExist(err) {
				s.mu.Unlock()
				return false, errTerminalHold
			}
		}
		s.workAuthority, s.ssh, s.registeredOwner = nil, nil, nil
	}
	p := s.authorityPending
	if p != nil && p.previous != nil && sameExitedLifetime(*p.previous, *q.PreviousOwner) {
		s.authorityPending = nil
	} else {
		p = nil
	}
	s.mu.Unlock()
	r.close()
	p.close()
	return false, nil
}

func filesResumeFence(current, snapshot *Attempt) bool {
	return current != nil && snapshot != nil && current.State == snapshot.State &&
		current.Username == snapshot.Username && current.UID == snapshot.UID &&
		current.MonitoringMode == "v1" && current.RegisteredOwner != nil && snapshot.RegisteredOwner != nil &&
		*current.RegisteredOwner == *snapshot.RegisteredOwner &&
		reflect.DeepEqual(current.SSHExitedOwner, snapshot.SSHExitedOwner) &&
		current.Transport == snapshot.Transport && current.Generation == snapshot.Generation &&
		current.Authorization == snapshot.Authorization && current.Authorization > Millis() &&
		current.Start == snapshot.Start && current.Deadline == snapshot.Deadline &&
		current.OriginalDeadline == snapshot.OriginalDeadline && current.ClockRevision == snapshot.ClockRevision &&
		current.Boot == snapshot.Boot && current.UptimeDeadline == snapshot.UptimeDeadline &&
		current.AccessState == "HELD" && !current.Protected && current.Checksum == "" &&
		current.WorkPath == snapshot.WorkPath && reflect.DeepEqual(current.Workspace, snapshot.Workspace) &&
		reflect.DeepEqual(current.Settings, snapshot.Settings) && slices.Equal(current.Units, snapshot.Units) && !expired(current)
}

func (e *Engine) resumeFiles(snapshot *Attempt, request Request, original *net.UnixConn) (any, error) {
	if original == nil || snapshot == nil || snapshot.RegisteredOwner == nil || snapshot.MonitoringMode != "v1" ||
		request.Generation != snapshot.Generation || !monitoringDigest.MatchString(request.PageEpoch) || expired(snapshot) {
		return snapshot, errFilesResume
	}
	if snapshot.State == "ACTIVE" && snapshot.MonitoringResumeKind == "reviewed" &&
		snapshot.Transport == request.Transport && snapshot.RegisteredOwner.PageEpoch == request.PageEpoch && currentRegisteredOwner(snapshot) {
		result, err := e.callTerminalAuthority(terminalAuthorityRequest{Op: "files-result", Attempt: snapshot.ID, Owner: *snapshot.RegisteredOwner, Nonce: snapshot.MonitoringResumeNonce}, nil, false)
		if err != nil || result.View == nil || !result.View.ExecutionAuthorized {
			return snapshot, errors.Join(errFilesResume, err)
		}
		return map[string]any{"attempt": snapshot, "input_epochs": map[string]string{}, "files_only": true}, nil
	}
	previous := *snapshot.RegisteredOwner
	owner := previous
	owner.TransportHash, owner.PageEpoch, owner.InputEpoch = request.Transport, request.PageEpoch, Token()
	owner.Generation, owner.ClockRevision = snapshot.Generation, snapshot.ClockRevision
	if snapshot.State != "LOCKED" || snapshot.Start <= 0 || snapshot.Authorization <= Millis() ||
		snapshot.SSHExitedOwner == nil || !sameExitedLifetime(*snapshot.SSHExitedOwner, previous) || !validFilesReplacement(previous, owner) ||
		snapshot.AccessState != "HELD" || snapshot.Protected || snapshot.Checksum != "" || snapshot.Boot != boot() ||
		previous.Attempt != snapshot.ID || previous.Exam != snapshot.Exam || previous.Username != snapshot.Username ||
		previous.UID != snapshot.UID || previous.TransportHash != snapshot.Transport || previous.Boot != snapshot.Boot {
		return snapshot, errFilesResume
	}
	roles, err := e.prepareNativeRoles()
	if err != nil {
		return snapshot, err
	}
	defer roles.close()
	if err := e.prepareTerminalMonitoring(); err != nil {
		return snapshot, err
	}
	accountLock, err := e.accountWorkLock(snapshot.UID)
	if err != nil {
		return snapshot, err
	}
	defer accountLock.Close()
	check := func() error {
		return e.WithState(func() error {
			current, err := e.Find(snapshot.ID)
			if err != nil || !filesResumeFence(current, snapshot) || e.state.Registrations[request.Transport] != snapshot.Username {
				return errFilesResume
			}
			return nil
		})
	}
	if err := check(); err != nil {
		return snapshot, err
	}
	// Durable exit evidence alone cannot displace a contradictory live owner.
	// An absent supervisor is harmless only WITH the exact recorded exit above;
	// exclusive owner claiming still occurs before any positive publication.
	if _, err := e.callTerminalAuthority(terminalAuthorityRequest{Op: "check-files-exit", Attempt: snapshot.ID, Owner: previous}, nil, true); err != nil {
		return snapshot, err
	}
	// terminateWriters verifies actual scope removal. It does not collect, replace
	// /work, restore ordinary access or signal the new authenticated entry stubs.
	if err := e.terminate(snapshot); err != nil {
		return snapshot, err
	}
	if err := check(); err != nil {
		return snapshot, err
	}
	key, err := publicKey(e.Config.GatewayPublicKey)
	if err != nil {
		return snapshot, err
	}
	prepared, err := e.callTerminalAuthority(terminalAuthorityRequest{Op: "prepare-files", Attempt: snapshot.ID, Owner: owner, PreviousOwner: &previous, Agent: e.Config.AgentID, GatewayKey: key}, original, true)
	if err != nil || prepared.Begin == nil || !validFilesReplacement(previous, prepared.Begin.Owner) {
		return snapshot, errors.Join(errFilesResume, err)
	}
	p := prepared.Begin
	requested, actual := owner, p.Owner
	requested.InputEpoch, actual.InputEpoch = "", ""
	if requested != actual {
		return snapshot, errMonitoringScope
	}
	defer e.cancelTerminalAuthority(p)
	view := prepared.View
	if view == nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5e9)
		defer cancel()
		frame, err := e.exchangeTerminalMonitoring(ctx, "/api/agent/monitoring-continue", monitoringContinueRequest{Type: monitoringFilesContinue, Agent: e.Config.AgentID, Nonce: p.Nonce, PreviousOwner: previous, Owner: p.Owner})
		if err != nil {
			return snapshot, err
		}
		proof, err := decodeMonitoringContinuation(frame, key)
		if err != nil || proof.Type != monitoringFilesContinue || proof.Audience != e.Config.AgentID || proof.Nonce != p.Nonce || proof.PreviousOwner != previous || proof.Owner != p.Owner || proof.AuthorizationExpires != snapshot.Authorization {
			return snapshot, errors.Join(errMonitoringEvidence, err)
		}
		if err := check(); err != nil {
			return snapshot, err
		}
		committed, err := e.callTerminalAuthority(terminalAuthorityRequest{Op: "commit-files", Attempt: snapshot.ID, Owner: p.Owner, PreviousOwner: &previous, Nonce: p.Nonce, Frame: &frame, State: "ACTIVE", Start: snapshot.Start, Deadline: snapshot.Deadline, OriginalDeadline: snapshot.OriginalDeadline, DeadlineBootMS: int64(snapshot.UptimeDeadline * 1000), VerifiedUntilBootMS: p.IssuedBootMS + proof.CaptureValidFor}, nil, false)
		if err != nil {
			return snapshot, err
		}
		view = committed.View
	}
	if view == nil || !view.ExecutionAuthorized || view.DeadlineUptimeMS != int64(snapshot.UptimeDeadline*1000) || !roles.current() {
		return snapshot, errMonitoringAuthority
	}
	if terminalResumeTransitionCheckpoint != nil {
		if err := terminalResumeTransitionCheckpoint("files-authority-committed", snapshot.ID, e.Config.State); err != nil {
			return snapshot, err
		}
	}
	// No pane exists in the new authority. Canonical ACTIVE is published only
	// AFTER live verification, and every fence is rechecked before any mutation.
	var result *Attempt
	err = e.WithState(func() error {
		a, err := e.Find(snapshot.ID)
		if err != nil || !filesResumeFence(a, snapshot) || !roles.current() {
			return errFilesResume
		}
		for hash, cap := range e.state.Caps {
			if cap.ID == a.ID {
				delete(e.state.Caps, hash)
			}
		}
		for unit, pane := range e.state.PaneInstances {
			if pane.Attempt == a.ID {
				pane.Cancelled = true
				e.state.PaneInstances[unit] = pane
			}
		}
		a.Units = []string{}
		a.Transport, a.ResumeTransport = request.Transport, request.Transport
		a.RegisteredOwner, a.SSHExitedOwner = &p.Owner, nil
		a.State, a.RetainedHold, a.MonitoringHoldKind = "ACTIVE", "", ""
		a.MonitoringResumeKind, a.MonitoringResumeNonce = "reviewed", p.Nonce
		a.Authorization, a.Lease = 0, 0
		copy := *a
		result = &copy
		e.Audit("files-only-continuation-committed", a.ID)
		return nil
	})
	if err != nil {
		_, _ = e.callTerminalAuthority(terminalAuthorityRequest{Op: "revoke", Attempt: snapshot.ID, Owner: p.Owner, Cause: "resume-unverified"}, nil, false)
		return snapshot, err
	}
	e.registerTerminalMonitoring(result.ID, p.Owner, int64(result.UptimeDeadline*1000))
	// State sync can outlive the verified sample window. Re-read actual live
	// authority before reporting success; the saved outcome itself is no permit.
	fresh, err := e.callTerminalAuthority(terminalAuthorityRequest{Op: "files-result", Attempt: result.ID, Owner: p.Owner, Nonce: p.Nonce}, nil, false)
	at, clockErr := monitoringBootMillis()
	if err != nil || clockErr != nil || fresh.View == nil || !fresh.View.ExecutionAuthorized || at >= fresh.View.AuthorityUntilMS {
		return result, errors.Join(errMonitoringAuthority, err, clockErr)
	}
	return map[string]any{"attempt": result, "input_epochs": map[string]string{}, "files_only": true, "monitoring_remaining_ms": fresh.View.AuthorityUntilMS - at}, nil
}
