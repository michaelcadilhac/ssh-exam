package core

// Actual consume-monitored-continuation caller. Same live SSH/held writers,
// explicit current approval and fresh challenged capture; no new grant/clock.
// Default admission remains disabled until the complete workflow is qualified.

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"reflect"
	"time"

	"golang.org/x/sys/unix"
)

// Compiled synthetic roles may force a failure after an ACTUAL transition.
// Installed executables never set this; no config/environment switch exists.
var terminalResumeTransitionCheckpoint func(stage, attempt, state string) error

type terminalResumePrepared struct {
	Nonce         string            `json:"nonce"`
	PreviousOwner monitoringOwner   `json:"previous_owner"`
	Owner         monitoringOwner   `json:"owner"`
	IssuedBootMS  int64             `json:"issued_boot_ms"`
	InputEpochs   map[string]string `json:"input_epochs"`
	PreviousNonce string            `json:"previous_nonce,omitempty"`
}

type monitoringContinueRequest struct {
	Type          string          `json:"type"`
	Agent         string          `json:"agent"`
	Nonce         string          `json:"nonce"`
	PreviousOwner monitoringOwner `json:"previous_owner"`
	Owner         monitoringOwner `json:"owner"`
}

type monitoringContinueReply struct {
	Type                 string               `json:"type"`
	Audience             string               `json:"audience"`
	Nonce                string               `json:"nonce"`
	PreviousOwner        monitoringOwner      `json:"previous_owner"`
	Owner                monitoringOwner      `json:"owner"`
	AuthorizationExpires int64                `json:"authorization_expires"`
	Expires              int64                `json:"expires"`
	CaptureValidFor      int64                `json:"capture_valid_for_ms"`
	Bootstrap            *monitoringBootstrap `json:"bootstrap"`
}

func decodeMonitoringContinuation(frame SignedFrame, key ed25519.PublicKey) (monitoringContinueReply, error) {
	var result monitoringContinueReply
	if len(frame.Payload) > base64.StdEncoding.EncodedLen(monitoringEvidenceMaxBytes) || len(frame.Signature) != base64.StdEncoding.EncodedLen(ed25519.SignatureSize) {
		return result, errMonitoringEvidence
	}
	payload, err := base64.StdEncoding.Strict().DecodeString(frame.Payload)
	signature, signatureErr := base64.StdEncoding.Strict().DecodeString(frame.Signature)
	if err != nil || signatureErr != nil || len(key) != ed25519.PublicKeySize || !ed25519.Verify(key, payload, signature) {
		return result, errMonitoringEvidence
	}
	fields, err := decodeMonitoringObject(payload, &result, []string{"type", "audience", "nonce", "previous_owner", "owner", "authorization_expires", "expires", "capture_valid_for_ms", "bootstrap"})
	if err != nil {
		return result, err
	}
	ownerKeys := []string{"attempt", "exam", "username", "uid", "transport_hash", "boot", "page_epoch", "input_epoch", "generation", "clock_revision"}
	if _, err := decodeMonitoringObject(fields["previous_owner"], &result.PreviousOwner, ownerKeys); err != nil {
		return result, err
	}
	if _, err := decodeMonitoringObject(fields["owner"], &result.Owner, ownerKeys); err != nil {
		return result, err
	}
	var seed monitoringBootstrap
	seedFields, err := decodeMonitoringObject(fields["bootstrap"], &seed, []string{"type", "control_retention", "owner", "coverage_epoch", "sequence"})
	if err != nil {
		return result, err
	}
	if _, err := decodeMonitoringObject(seedFields["owner"], &seed.Owner, ownerKeys); err != nil {
		return result, err
	}
	result.Bootstrap = &seed
	if result.Type != "monitoring-continue/v1" || !identifier.MatchString(result.Audience) || !monitoringDigest.MatchString(result.Nonce) || !validMonitoringOwner(result.PreviousOwner) || !validMonitoringOwner(result.Owner) || result.Expires <= Millis() || result.Expires > result.AuthorizationExpires || result.CaptureValidFor <= 0 || result.CaptureValidFor > 15000 || seed.Type != "monitoring-bootstrap/v1" || seed.ControlRetention != "v1" || seed.Owner != result.Owner || seed.Sequence != 1 || !monitoringDigest.MatchString(seed.CoverageEpoch) {
		return result, errMonitoringEvidence
	}
	return result, nil
}

func (s *terminalSupervisor) prepareAuthorityResume(owner monitoringOwner, generation int) (terminalResumePrepared, error) {
	s.mu.Lock()
	r := s.workAuthority
	if r == nil || r.owner != owner || !r.live.Load() || !r.peer.current() || !r.claim.current() || generation <= owner.Generation || generation < 0 || uint64(generation) > monitoringEvidenceMaxSequence || r.hold == nil {
		s.mu.Unlock()
		return terminalResumePrepared{}, errMonitoringAuthority
	}
	h := r.hold
	s.mu.Unlock()
	if !h.mu.TryLock() {
		return terminalResumePrepared{}, errTerminalHold
	}
	defer h.mu.Unlock()
	if h.phase != "held" {
		return terminalResumePrepared{}, errTerminalHold
	}
	now, err := monitoringBootMillis()
	if err != nil || now >= r.deadlineBootMS {
		return terminalResumePrepared{}, errMonitoringAuthority
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.workAuthority != r {
		return terminalResumePrepared{}, errMonitoringScope
	}
	active := make(map[string]bool, len(s.requests)+len(r.launches))
	for unit := range s.requests {
		active[unit] = true
	}
	for unit := range r.launches {
		active[unit] = true
	}
	if err := h.pruneExited(active); err != nil {
		return terminalResumePrepared{}, err
	}
	if p := r.resume; p != nil && p.Owner.Generation == generation && now >= p.IssuedBootMS && now-p.IssuedBootMS < 15000 {
		return *p, nil
	}
	if len(r.launches) != len(s.requests) || len(s.requests) != len(s.timed) {
		return terminalResumePrepared{}, errTerminalHold
	}
	next := owner
	next.Generation, next.InputEpoch = generation, Token()
	p := &terminalResumePrepared{Nonce: Token(), PreviousOwner: owner, Owner: next, IssuedBootMS: now, InputEpochs: map[string]string{}}
	for _, stream := range s.timed {
		p.InputEpochs[stream.recorder.pane] = Token()
	}
	r.resume = p
	return *p, nil
}

func (s *terminalSupervisor) prepareAuthorityResumeRecovery(owner monitoringOwner, nonce string) (terminalResumePrepared, error) {
	s.mu.Lock()
	r := s.workAuthority
	if r == nil || r.resume == nil || r.resume.Owner != owner || (r.resume.Nonce != nonce && r.resume.PreviousNonce != nonce) || r.hold == nil || !r.live.Load() || !r.peer.current() || !r.claim.current() {
		s.mu.Unlock()
		return terminalResumePrepared{}, errMonitoringAuthority
	}
	h := r.hold
	s.mu.Unlock()
	if !h.mu.TryLock() {
		return terminalResumePrepared{}, errTerminalHold
	}
	defer h.mu.Unlock()
	if h.phase != "held" {
		return terminalResumePrepared{}, errTerminalHold
	}
	now, err := monitoringBootMillis()
	if err != nil || now >= r.deadlineBootMS {
		return terminalResumePrepared{}, errMonitoringAuthority
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.workAuthority != r || r.resume == nil || r.resume.Owner != owner || (r.resume.Nonce != nonce && r.resume.PreviousNonce != nonce) || len(r.launches) != len(s.requests) || len(s.requests) != len(s.timed) {
		return terminalResumePrepared{}, errMonitoringScope
	}
	active := make(map[string]bool, len(s.requests)+len(r.launches))
	for unit := range s.requests {
		active[unit] = true
	}
	for unit := range r.launches {
		active[unit] = true
	}
	if err := h.pruneExited(active); err != nil {
		return terminalResumePrepared{}, err
	}
	if p := r.resume; p.PreviousNonce == nonce && now >= p.IssuedBootMS && now-p.IssuedBootMS < 15000 {
		return *p, nil
	}
	p := &terminalResumePrepared{Nonce: Token(), PreviousNonce: nonce, PreviousOwner: r.resume.PreviousOwner, Owner: owner, IssuedBootMS: now, InputEpochs: map[string]string{}}
	for _, stream := range s.timed {
		p.InputEpochs[stream.recorder.pane] = Token()
	}
	r.resume = p
	return *p, nil
}

func (s *terminalSupervisor) commitAuthorityResume(q terminalAuthorityRequest) (monitoringAuthorityView, map[string]string, error) {
	if err := terminalAuthorityReadiness(); err != nil {
		return monitoringAuthorityView{}, nil, err
	}
	s.mu.Lock()
	r := s.workAuthority
	if r == nil || q.NextOwner == nil {
		s.mu.Unlock()
		return monitoringAuthorityView{}, nil, errMonitoringScope
	}
	if r.owner == *q.NextOwner && r.resumeNonce == q.Nonce && r.resume != nil {
		s.mu.Unlock()
		view := r.authority.check()
		if !view.ExecutionAuthorized {
			return view, nil, errMonitoringAuthority
		}
		return view, r.resume.InputEpochs, nil
	}
	if q.Op == "resume-result" || r.owner != q.Owner || r.resume == nil || r.resume.Nonce != q.Nonce || r.resume.Owner != *q.NextOwner || r.hold == nil || q.Frame == nil || q.State != "ACTIVE" || q.Start != r.start || q.Deadline != r.deadline || q.OriginalDeadline != r.originalDeadline || q.DeadlineBootMS != r.deadlineBootMS {
		s.mu.Unlock()
		return monitoringAuthorityView{}, nil, errMonitoringScope
	}
	p, h := r.resume, r.hold
	streams := make(map[string]*supervisedRecordingIO, len(s.timed))
	active := make(map[string]bool, len(s.requests)+len(r.launches))
	for unit := range s.requests {
		active[unit] = true
	}
	for unit := range r.launches {
		active[unit] = true
	}
	for unit, stream := range s.timed {
		streams[unit] = stream
	}
	s.mu.Unlock()
	proof, err := decodeMonitoringContinuation(*q.Frame, r.key)
	if err != nil || proof.Audience != r.authority.context.Agent || proof.Nonce != p.Nonce || proof.PreviousOwner != p.PreviousOwner || proof.Owner != p.Owner {
		return monitoringAuthorityView{}, nil, errMonitoringEvidence
	}
	now, err := monitoringBootMillis()
	until := min(p.IssuedBootMS+proof.CaptureValidFor, r.deadlineBootMS)
	if err != nil || now < p.IssuedBootMS || now >= until {
		return monitoringAuthorityView{}, nil, errMonitoringAuthority
	}
	if !h.mu.TryLock() {
		return monitoringAuthorityView{}, nil, errTerminalHold
	}
	success, retryHold := false, false
	defer func() {
		h.mu.Unlock()
		if success {
			h.close()
		} else if retryHold {
			go func() { _, _ = s.holdAuthority(p.Owner, "resume-unverified") }()
		}
	}()
	if h.phase != "held" {
		return monitoringAuthorityView{}, nil, errTerminalHold
	}
	if err := h.pruneExited(active); err != nil {
		return monitoringAuthorityView{}, nil, err
	}
	epochs := make(map[string]string, len(streams))
	for unit, stream := range streams {
		if p.InputEpochs[stream.recorder.pane] == "" || h.scopes[unit] == nil || h.input[unit] == nil {
			return monitoringAuthorityView{}, nil, errTerminalHold
		}
		frozen, err := terminalScopeFrozen(h.scopes[unit])
		if err != nil || !frozen {
			return monitoringAuthorityView{}, nil, errTerminalHold
		}
		if err := stream.inputPTY.discardKernelInput(h.input[unit]); err != nil {
			return monitoringAuthorityView{}, nil, err
		}
		epochs[stream.recorder.pane] = p.InputEpochs[stream.recorder.pane]
	}
	// A pane may close after preparation. Narrow only the successful result;
	// keep the prepared nonce/owner/epochs immutable for concurrent replies.
	resumed := *p
	resumed.InputEpochs = epochs
	next := &terminalAuthorityRuntime{owner: p.Owner, beginNonce: r.beginNonce, key: r.key, peer: r.peer, claim: r.claim, hold: h, launches: map[string]PaneInstance{}, resume: &resumed, resumeNonce: p.Nonce, start: r.start, deadline: r.deadline, originalDeadline: r.originalDeadline, deadlineBootMS: r.deadlineBootMS}
	next.live.Store(true)
	cutoff, err := newMonitoringSharedCutoff(p.Owner, until, r.deadlineBootMS)
	if err != nil {
		return monitoringAuthorityView{}, nil, err
	}
	installed := false
	defer func() {
		if !installed {
			cutoff.close()
		}
	}()
	c := monitoringActiveContext{Agent: proof.Audience, Owner: p.Owner, CoverageEpoch: proof.Bootstrap.CoverageEpoch, Sequence: 1, AuthorityUntilMS: until, DeadlineUptimeMS: r.deadlineBootMS, cutoff: cutoff}
	c.verified = &monitoringActiveSeal{fingerprint: monitoringContextHash(c), current: func() bool { return next.live.Load() && next.peer.current() && next.claim.current() }}
	next.authority, err = newMonitoringAuthority(c, monitoringBootMillis)
	if err != nil {
		return monitoringAuthorityView{}, nil, err
	}
	s.mu.Lock()
	if s.workAuthority != r || r.resume != p || len(s.timed) != len(streams) || len(r.launches) != len(streams) {
		s.mu.Unlock()
		next.live.Store(false)
		return monitoringAuthorityView{}, nil, errMonitoringScope
	}
	for unit, stream := range streams {
		if s.timed[unit] != stream {
			s.mu.Unlock()
			next.live.Store(false)
			return monitoringAuthorityView{}, nil, errMonitoringScope
		}
	}
	for unit, prior := range r.launches {
		next.launches[unit] = prior
	}
	r.live.Store(false)
	s.workAuthority = next
	installed = true
	owner := p.Owner
	s.registeredOwner = &owner
	s.mu.Unlock()
	if old := r.authority.context.cutoff; old != nil {
		old.close()
	}
	h.phase = "resuming"
	defer func() {
		if success {
			return
		}
		_, _ = next.authority.revokeForTechnicalCause("resume-unverified")
		for _, stream := range streams {
			stream.inputGate.revoke()
			stream.resizeGate.revoke()
		}
		h.phase, h.error = "unverified", "continuation kernel/input transition unverified; permission revoked"
		// Kernel work can fail after an earlier scope thawed. Retry the SAME
		// stop-before-freeze barrier; never claim success or kill buffers here.
		retryHold = true // Admit the retry only AFTER releasing this hold worker.
	}()
	for unit, stream := range streams {
		epoch := p.InputEpochs[stream.recorder.pane]
		stream.currentAuthority.Store(next.authority)
		if err := stream.inputGate.arm(h.input[unit], epoch, until, r.deadlineBootMS); err != nil {
			return monitoringAuthorityView{}, nil, err
		}
		if err := stream.resizeGate.arm(h.resize[unit], epoch, until, r.deadlineBootMS); err != nil {
			return monitoringAuthorityView{}, nil, err
		}
		stream.inputScope.Store(&supervisedInputScope{epoch: epoch})
	}
	ordered, err := orderedTerminalHoldGroups(h.groups)
	if err != nil {
		return monitoringAuthorityView{}, nil, err
	}
	thawed := 0
	for _, scope := range h.scopes {
		if !next.authority.check().ExecutionAuthorized {
			return monitoringAuthorityView{}, nil, errMonitoringAuthority
		}
		if err := terminalScopeWrite(scope, "cgroup.freeze", "0"); err != nil {
			return monitoringAuthorityView{}, nil, err
		}
		thawed++
		if thawed == 1 && terminalResumeTransitionCheckpoint != nil {
			if err := terminalResumeTransitionCheckpoint("scope-thawed", s.id, s.state); err != nil {
				return monitoringAuthorityView{}, nil, err
			}
		}
	}
	continued := 0
	for index := len(ordered) - 1; index >= 0; index-- {
		g := ordered[index]
		if !g.signalled || g.originalStopped {
			continue
		}
		if !next.authority.check().ExecutionAuthorized {
			return monitoringAuthorityView{}, nil, errMonitoringAuthority
		}
		if err := g.process.control(func(fd int) error { return unix.PidfdSendSignal(fd, unix.SIGCONT, nil, 0) }); err != nil {
			return monitoringAuthorityView{}, nil, err
		}
		g.signalled = false // A failed later step must SIGSTOP this group again.
		continued++
		if continued == 1 && terminalResumeTransitionCheckpoint != nil {
			if err := terminalResumeTransitionCheckpoint("process-continued", s.id, s.state); err != nil {
				return monitoringAuthorityView{}, nil, err
			}
		}
	}
	view := next.authority.check()
	if !view.ExecutionAuthorized {
		return view, nil, errMonitoringAuthority
	}
	s.mu.Lock()
	if s.workAuthority == next {
		next.hold = nil
	}
	s.mu.Unlock()
	h.phase, success = "resumed", true
	return view, epochs, nil
}

// Both the initial successful RPC and a lost-reply retry must complete the same
// canonical metadata and reconnect the coordinator's live renewal bridge. This
// accepts only the current supervisor's verified result, never saved permission.
func (e *Engine) finishMonitoredResume(expected *Attempt, owner monitoringOwner, nonce string, result terminalAuthorityReply) (any, error) {
	if expected == nil || expected.RegisteredOwner == nil || *expected.RegisteredOwner != owner || expected.MonitoringResumeNonce != nonce || nonce == "" || result.View == nil || !result.View.ExecutionAuthorized || result.View.DeadlineUptimeMS != int64(expected.UptimeDeadline*1000) {
		return expected, errMonitoringAuthority
	}
	if err := e.prepareTerminalMonitoring(); err != nil {
		return expected, err
	}
	var committed *Attempt
	err := e.WithState(func() error {
		current, err := e.Find(expected.ID)
		if err != nil {
			return err
		}
		if current.State != "ACTIVE" || current.RegisteredOwner == nil || *current.RegisteredOwner != owner || current.MonitoringResumeNonce != nonce || (current.RetainedHold != "" && current.RetainedHold != "resuming") || current.Generation != expected.Generation || current.ClockRevision != expected.ClockRevision || current.Start != expected.Start || current.Deadline != expected.Deadline || current.OriginalDeadline != expected.OriginalDeadline || expired(current) {
			return errMonitoringScope
		}
		current.RetainedHold = ""
		copy := *current
		committed = &copy
		return nil
	})
	if err != nil {
		return expected, err
	}
	e.registerTerminalMonitoring(committed.ID, owner, int64(committed.UptimeDeadline*1000))
	return map[string]any{"attempt": committed, "input_epochs": result.InputEpochs}, nil
}

func (e *Engine) resumeMonitored(a *Attempt, request Request) (any, error) {
	if a == nil || a.MonitoringMode != "v1" || a.RegisteredOwner == nil || request.Generation != a.Generation || request.PageEpoch != a.RegisteredOwner.PageEpoch || expired(a) {
		return a, errMonitoringScope
	}
	recovering := a.State == "ACTIVE" && a.RetainedHold == "resuming" && a.MonitoringResumeNonce != ""
	if a.State == "ACTIVE" && a.MonitoringResumeNonce != "" {
		result, err := e.callTerminalAuthority(terminalAuthorityRequest{Op: "resume-result", Attempt: a.ID, Owner: *a.RegisteredOwner, NextOwner: a.RegisteredOwner, Nonce: a.MonitoringResumeNonce}, nil, false)
		if err == nil {
			return e.finishMonitoredResume(a, *a.RegisteredOwner, a.MonitoringResumeNonce, result)
		}
		if !recovering {
			return a, err
		}
	}
	if !recovering && (a.State != "LOCKED" || a.RetainedHold != "held" || a.ResumeTransport != a.Transport) {
		return a, errTerminalHold
	}
	if err := e.prepareTerminalMonitoring(); err != nil {
		return a, err
	}
	op := "prepare-resume"
	if recovering {
		op = "prepare-resume-recovery"
	}
	prepared, err := e.callTerminalAuthority(terminalAuthorityRequest{Op: op, Attempt: a.ID, Owner: *a.RegisteredOwner, Generation: a.Generation, Nonce: a.MonitoringResumeNonce}, nil, false)
	if err != nil || prepared.Resume == nil {
		return a, errors.Join(errMonitoringAuthority, err)
	}
	p := prepared.Resume
	if (!recovering && p.PreviousOwner != *a.RegisteredOwner) || (recovering && p.Owner != *a.RegisteredOwner) || p.Owner.Generation != a.Generation {
		return a, errMonitoringScope
	}
	if prepared.HeldOwner == nil || (*prepared.HeldOwner != p.PreviousOwner && (!recovering || *prepared.HeldOwner != p.Owner)) {
		return a, errMonitoringScope
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	frame, err := e.exchangeTerminalMonitoring(ctx, "/api/agent/monitoring-continue", monitoringContinueRequest{Type: "monitoring-continue/v1", Agent: e.Config.AgentID, Nonce: p.Nonce, PreviousOwner: p.PreviousOwner, Owner: p.Owner})
	if err != nil {
		return a, err
	}
	key, err := publicKey(e.Config.GatewayPublicKey)
	if err != nil {
		return a, err
	}
	proof, err := decodeMonitoringContinuation(frame, key)
	if err != nil || proof.Nonce != p.Nonce || proof.Audience != e.Config.AgentID || proof.PreviousOwner != p.PreviousOwner || proof.Owner != p.Owner {
		return a, errMonitoringEvidence
	}
	now, err := monitoringBootMillis()
	if err != nil || now < p.IssuedBootMS || now >= min(p.IssuedBootMS+proof.CaptureValidFor, int64(a.UptimeDeadline*1000)) {
		return a, errMonitoringAuthority
	}
	var committed *Attempt
	err = e.WithState(func() error {
		current, err := e.Find(a.ID)
		if err != nil {
			return err
		}
		if current.State != a.State || current.Generation != a.Generation || current.RegisteredOwner == nil || *current.RegisteredOwner != *a.RegisteredOwner || current.RetainedHold != a.RetainedHold || current.MonitoringResumeNonce != a.MonitoringResumeNonce || current.ResumeTransport != a.Transport || current.Start != a.Start || current.Deadline != a.Deadline || current.OriginalDeadline != a.OriginalDeadline || current.ClockRevision != a.ClockRevision || !reflect.DeepEqual(current.Units, a.Units) || expired(current) || proof.AuthorizationExpires <= Millis() {
			return errMonitoringScope
		}
		// Keep the immutable recorder/report identity. Only the reviewed,
		// signed same-pane Continue carries its negative fault association to
		// the new generation, in the SAME durable transaction as that owner.
		continued := make(map[string]PaneInstance, len(current.Units))
		for _, unit := range current.Units {
			pane := e.state.PaneInstances[unit]
			identity := pane.RecordingIdentity
			generation := identity.Generation
			if pane.RecordingContinuedGeneration != 0 {
				generation = pane.RecordingContinuedGeneration
			}
			if pane.Attempt != current.ID || pane.ReadyAt == 0 || pane.Cancelled || pane.RecordingClosed ||
				!identity.valid() || identity.Unit != unit || identity.Attempt != current.ID || identity.Pane != pane.Pane ||
				identity.Username != current.Username || identity.UID != current.UID || identity.Boot != current.Boot ||
				identity.Start != current.Start || identity.TransportHash != Hash([]byte(current.Transport)) ||
				pane.Recording != identity.hash() || (generation != p.PreviousOwner.Generation && !(recovering && generation == p.Owner.Generation)) || p.InputEpochs[pane.Pane] == "" {
				return errMonitoringScope
			}
			pane.RecordingContinuedGeneration = p.Owner.Generation
			continued[unit] = pane
		}
		for unit, pane := range continued {
			e.state.PaneInstances[unit] = pane
		}
		owner := p.Owner
		current.State, current.RetainedHold, current.RegisteredOwner, current.Authorization = "ACTIVE", "resuming", &owner, 0
		current.MonitoringHoldKind = ""
		current.MonitoringResumeNonce, current.Lease = p.Nonce, Millis()+proof.CaptureValidFor-(now-p.IssuedBootMS)
		copy := *current
		copy.Units = append([]string(nil), current.Units...)
		committed = &copy
		e.Audit("retained-continuation-committed", current.ID)
		return nil
	})
	if err != nil {
		return a, err
	}
	result, err := e.callTerminalAuthority(terminalAuthorityRequest{Op: "commit-resume", Attempt: a.ID, Owner: *prepared.HeldOwner, NextOwner: &p.Owner, Nonce: p.Nonce, Frame: &frame, State: committed.State, Start: committed.Start, Deadline: committed.Deadline, OriginalDeadline: committed.OriginalDeadline, DeadlineBootMS: int64(committed.UptimeDeadline * 1000)}, nil, false)
	if err != nil || result.View == nil || !result.View.ExecutionAuthorized {
		return committed, errors.Join(errMonitoringAuthority, err)
	}
	if terminalResumeTransitionCheckpoint != nil {
		if err := terminalResumeTransitionCheckpoint("coordinator-committed", a.ID, e.Config.State); err != nil {
			return committed, err
		}
	}
	return e.finishMonitoredResume(committed, p.Owner, p.Nonce, result)
}
