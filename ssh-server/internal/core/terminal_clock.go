package core

// The existing signed instructor clock entry persists its ClockReset before
// commit-clock. The same attempt supervisor transfers only an unchanged owner's
// already verified facts; neither a disk lease nor this RPC mints fresh capture.

import (
	"errors"
	"fmt"
	"sort"
)

var errTerminalClock = errors.New("retained clock handover is unconfirmed; retry the SAME instructor clock intent and inspect the original attempt/supervisor; no new monitoring freshness or continuation granted")

func (s *terminalSupervisor) changeAuthorityClock(q terminalAuthorityRequest) (monitoringAuthorityView, error) {
	if q.Clock == nil || q.NextOwner == nil || !attemptID.MatchString(q.Clock.ID) || q.Clock.Revision != q.Owner.ClockRevision+1 || q.Clock.Deadline != q.Deadline || q.Clock.AppliedAt <= 0 || q.Clock.Actor == "" || q.DeadlineBootMS <= 0 {
		return monitoringAuthorityView{}, errMonitoringScope
	}
	expected := q.Owner
	expected.ClockRevision++
	if expected != *q.NextOwner || !validMonitoringOwner(expected) || expected.Boot != boot() {
		return monitoringAuthorityView{}, errMonitoringScope
	}
	// Allocate only private, expired storage/entropy before locking live authority.
	// The memory word is not published until every current gate is bound to it.
	var cutoff *monitoringSharedCutoff
	var err error
	incarnation := ""
	if q.Op == "commit-clock" {
		cutoff, err = newMonitoringSharedCutoff(expected, 1, q.DeadlineBootMS)
		if err != nil {
			return monitoringAuthorityView{}, err
		}
		defer func() {
			if cutoff != nil {
				cutoff.close()
			}
		}()
		incarnation = Token()
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	r := s.workAuthority
	if r == nil {
		return monitoringAuthorityView{}, errTerminalClock
	}
	if q.Op == "commit-clock" && r.owner == expected && r.clockReset != nil && *r.clockReset == *q.Clock && r.deadline == q.Deadline && r.deadlineBootMS == q.DeadlineBootMS {
		return r.authority.check(), nil // Original result, even if it has since expired.
	}
	if r.owner != q.Owner || q.Clock.PreviousDeadline != r.deadline || q.Start != r.start || q.OriginalDeadline != r.originalDeadline || q.Deadline <= q.Start || (r.resume != nil && r.resumeNonce != r.resume.Nonce) || r.holdRunning.Load() || len(r.launches) != len(s.timed) {
		return monitoringAuthorityView{}, errTerminalClock
	}
	// Both clocks describe the SAME adjustment. Float serialization of the
	// existing uptime field can round by one millisecond, never by an allowance.
	drift := (q.DeadlineBootMS - r.deadlineBootMS) - (q.Deadline - r.deadline)
	if drift < -1 || drift > 1 {
		return monitoringAuthorityView{}, errMonitoringScope
	}
	if r.hold != nil {
		if !r.hold.mu.TryLock() {
			return monitoringAuthorityView{}, errTerminalClock
		}
		defer r.hold.mu.Unlock()
		if r.hold.phase != "held" || q.State != "LOCKED" {
			return monitoringAuthorityView{}, errTerminalClock
		}
	} else if q.State != "ACTIVE" {
		return monitoringAuthorityView{}, errTerminalClock
	}
	units := make([]string, 0, len(s.timed))
	for unit, stream := range s.timed {
		if _, ok := r.launches[unit]; !ok || stream.inputGate == nil || stream.resizeGate == nil || stream.currentAuthority.Load() != r.authority {
			return monitoringAuthorityView{}, errTerminalClock
		}
		units = append(units, unit)
	}
	sort.Strings(units)
	// Input/resize readers already take gate -> authority. Keep that order and
	// hold ALL gates across the single pointer/deadline handover, including idle
	// panes and in-flight cancellation-aware writes. Epochs/sequences do not reset.
	for _, unit := range units {
		stream := s.timed[unit]
		stream.inputGate.mu.Lock()
		defer stream.inputGate.mu.Unlock()
		stream.resizeGate.mu.Lock()
		defer stream.resizeGate.mu.Unlock()
	}
	prior := r.authority
	prior.mu.Lock()
	defer prior.mu.Unlock()
	now, valid := prior.tickLocked()
	if !valid || (q.Op == "check-clock" && r.hold == nil && prior.phase != "active") || prior.revision >= monitoringEvidenceMaxSequence {
		return prior.viewLocked(), errTerminalClock
	}
	for _, unit := range units {
		for _, gate := range []*paneInputGate{s.timed[unit].inputGate, s.timed[unit].resizeGate} {
			if gate.deadline != r.deadlineBootMS || gate.faulted || (r.hold == nil && (gate.held || gate.exhausted || gate.discarding)) {
				return prior.viewLocked(), errTerminalClock
			}
		}
	}
	if q.Op == "check-clock" {
		return prior.viewLocked(), nil // No reservation or permission mutation.
	}
	// The old observer/proof can now act only on its old word. A fresh deadline
	// mapping fences delayed watchdogs; all facts keep their original cutoff/age.
	next := &terminalAuthorityRuntime{owner: expected, beginNonce: r.beginNonce, key: r.key, peer: r.peer, claim: r.claim, hold: r.hold, launches: r.launches, clockReset: q.Clock, start: r.start, deadline: q.Deadline, originalDeadline: r.originalDeadline, deadlineBootMS: q.DeadlineBootMS}
	next.live.Store(true)
	c := prior.context
	c.Owner, c.DeadlineUptimeMS, c.cutoff = expected, q.DeadlineBootMS, cutoff
	c.AuthorityUntilMS = min(c.AuthorityUntilMS, q.DeadlineBootMS)
	phase := prior.phase
	if now >= c.DeadlineUptimeMS {
		phase = "revoking"
	}
	if phase == "active" && (now >= c.AuthorityUntilMS || !cutoff.publish(1, c.AuthorityUntilMS)) {
		next.live.Store(false)
		return prior.viewLocked(), errTerminalClock
	}
	if phase != "active" {
		cutoff.revoke() // A clock edit never thaws a held workload.
	}
	c.verified = &monitoringActiveSeal{fingerprint: monitoringContextHash(c), current: func() bool { return next.live.Load() && next.peer.current() && next.claim.current() }}
	c.verified.consumed.Store(true)
	causes := make(map[string]bool, len(prior.causes))
	for cause, present := range prior.causes {
		causes[cause] = present
	}
	if now >= c.DeadlineUptimeMS {
		causes["deadline"] = true
	}
	next.authority = &monitoringAuthority{context: c, incarnation: incarnation, clock: prior.clock, lastNow: now, phase: phase, revision: prior.revision + 1, causes: causes, challenges: map[string]monitoringChallenge{}, committed: map[string]monitoringCommitted{}, publicationFailureObserved: prior.publicationFailureObserved}
	for _, unit := range units {
		stream := s.timed[unit]
		for _, gate := range []*paneInputGate{stream.inputGate, stream.resizeGate} {
			gate.deadline = q.DeadlineBootMS
			gate.until = c.AuthorityUntilMS
			if phase != "active" {
				gate.revokeLocked()
			}
		}
		stream.currentAuthority.Store(next.authority)
	}
	r.live.Store(false)
	s.workAuthority = next
	s.registeredOwner = &next.owner
	if old := prior.context.cutoff; old != nil {
		old.close()
	}
	cutoff = nil // Lifetime belongs to the new runtime, not the request.
	return next.authority.viewLocked(), nil
}

func (e *Engine) terminalClockRequest(a *Attempt, change ClockReset) (terminalAuthorityRequest, error) {
	if a.RegisteredOwner == nil {
		return terminalAuthorityRequest{}, errTerminalClock
	}
	next := *a.RegisteredOwner
	next.ClockRevision = change.Revision
	previous := next
	previous.ClockRevision--
	return terminalAuthorityRequest{Op: "check-clock", Attempt: a.ID, Owner: previous, NextOwner: &next, Clock: &change, State: a.State, Start: a.Start, Deadline: change.Deadline, OriginalDeadline: a.OriginalDeadline, DeadlineBootMS: int64(a.UptimeDeadline * 1000)}, nil
}

func (e *Engine) commitTerminalClock(a *Attempt, change ClockReset) error {
	if err := e.prepareTerminalMonitoring(); err != nil {
		return fmt.Errorf("%w: %v", errTerminalClock, err)
	}
	q, err := e.terminalClockRequest(a, change)
	if err != nil {
		return err
	}
	q.Op = "commit-clock"
	if _, err := e.callTerminalAuthority(q, nil, false); err != nil {
		return fmt.Errorf("%w: %v", errTerminalClock, err)
	}
	if a.State == "ACTIVE" {
		e.registerTerminalMonitoring(a.ID, *q.NextOwner, q.DeadlineBootMS)
	}
	return nil
}
