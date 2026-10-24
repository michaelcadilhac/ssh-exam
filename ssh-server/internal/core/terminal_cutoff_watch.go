package core

// Actual existing Engine.Tick/watchdog caller, not another daemon. The native
// supervisor owns all positive publication. This observer can only expire a
// current shared word and request the existing verified writer hold.

import (
	"os"
	"sync"
)

type terminalCutoffWatch struct {
	slot *monitoringSharedCutoff
	peer *uidProcess
}

func (w *terminalCutoffWatch) close() { w.slot.close(); w.peer.close() }

type terminalCutoffFact struct {
	owner monitoringOwner
	view  *monitoringAuthorityView
	held  bool
	error error
}

func (e *Engine) terminalCutoffFor(a *Attempt) (*terminalCutoffWatch, error) {
	if a.RegisteredOwner == nil || !currentRegisteredOwner(a) {
		return nil, errMonitoringScope
	}
	b := &e.terminalMonitoring
	b.watchMu.Lock()
	previous := b.watched[a.ID]
	if previous != nil && previous.slot.owner == *a.RegisteredOwner && previous.slot.deadline == int64(a.UptimeDeadline*1000) {
		live, err := previous.peer.live()
		if err == nil && live {
			b.watchMu.Unlock()
			return previous, nil
		}
	}
	delete(b.watched, a.ID)
	b.watchMu.Unlock()
	if previous != nil {
		previous.close()
	}
	watch, err := e.openTerminalCutoff(a)
	if err != nil {
		return nil, err
	}
	b.watchMu.Lock()
	if b.watched == nil {
		b.watched = map[string]*terminalCutoffWatch{}
	}
	if other := b.watched[a.ID]; other != nil {
		b.watchMu.Unlock()
		watch.close()
		return other, nil
	}
	b.watched[a.ID] = watch
	b.watchMu.Unlock()
	return watch, nil
}

// Actual callers: watchdog cache and one closed pane launch. Each launch owns
// its observation until both final exec checks finish; cache retirement cannot
// close it, and descriptor acquisition never runs under the state transaction.
func (e *Engine) openTerminalCutoff(a *Attempt) (*terminalCutoffWatch, error) {
	if a == nil || a.RegisteredOwner == nil || !currentRegisteredOwner(a) {
		return nil, errMonitoringScope
	}
	response, err := e.callTerminalAuthority(terminalAuthorityRequest{Op: "live-cutoff", Attempt: a.ID, Owner: *a.RegisteredOwner}, nil, false)
	if err != nil {
		return nil, err
	}
	if response.cutoffFile == nil || response.cutoffPeer == nil || response.Cutoff == nil || response.Cutoff.Owner != *a.RegisteredOwner || response.Cutoff.DeadlineBootMS != int64(a.UptimeDeadline*1000) {
		if response.cutoffFile != nil {
			response.cutoffFile.Close()
		}
		if response.cutoffPeer != nil {
			response.cutoffPeer.close()
		}
		return nil, errMonitoringCutoff
	}
	slot, err := importMonitoringSharedCutoff(response.cutoffFile, *response.Cutoff)
	if err != nil {
		response.cutoffFile.Close()
		response.cutoffPeer.close()
		return nil, err
	}
	return &terminalCutoffWatch{slot: slot, peer: response.cutoffPeer}, nil
}

func (e *Engine) observeTerminalSharedCutoffs() (map[string]terminalCutoffFact, error) {
	state, err := readStateSnapshot(e.Config.State)
	if os.IsNotExist(err) {
		return map[string]terminalCutoffFact{}, nil
	}
	if err != nil {
		return nil, err
	}
	facts := map[string]terminalCutoffFact{}
	var mu sync.Mutex
	var workers sync.WaitGroup
	slots := make(chan struct{}, 16)
	for _, a := range state.Attempts {
		if a.MonitoringMode != "v1" || a.State != "ACTIVE" || a.RetainedHold == "resuming" || a.RegisteredOwner == nil {
			continue
		}
		slots <- struct{}{}
		workers.Add(1)
		go func(a *Attempt) {
			defer workers.Done()
			defer func() { <-slots }()
			fact := terminalCutoffFact{owner: *a.RegisteredOwner}
			watch, err := e.terminalCutoffFor(a)
			if err == nil {
				var now int64
				now, err = monitoringBootMillis()
				if err == nil {
					_, revoked := watch.slot.expire(now)
					if revoked {
						reply, holdErr := e.callTerminalAuthority(terminalAuthorityRequest{Op: "expire", Attempt: a.ID, Owner: fact.owner}, nil, false)
						err, fact.view = holdErr, reply.View
						fact.held = holdErr == nil && reply.Hold != nil && reply.Hold.Phase == "held"
					}
				}
			}
			fact.error = err
			mu.Lock()
			facts[a.ID] = fact
			mu.Unlock()
		}(a)
	}
	workers.Wait()
	// Cache retirement does not revoke live words; only the owning authority or
	// exact expiry CAS can do that. No pending operation reserves another account.
	b := &e.terminalMonitoring
	b.watchMu.Lock()
	for id, watch := range b.watched {
		a := state.Attempts[id]
		if a == nil || a.MonitoringMode != "v1" || a.State == "COMPLETED" || a.State == "CANCELLED_BEFORE_START" {
			delete(b.watched, id)
			watch.close()
		}
	}
	b.watchMu.Unlock()
	return facts, nil
}

func terminalTechnicalHoldReason(f terminalCutoffFact) string {
	if f.view != nil {
		for _, cause := range f.view.Causes {
			if cause == "recording-failure" {
				return "Class-server terminal recording failure"
			}
			if cause == "policy-condition" || cause == "operator-pause" {
				return "Verified class-server policy/operator pause"
			}
		}
	}
	return "Monitoring verification unavailable; technical safety hold, not a student violation"
}

func terminalCutoffPolicyCause(f terminalCutoffFact) bool {
	if f.view != nil {
		for _, cause := range f.view.Causes {
			if cause == "recording-failure" || cause == "policy-condition" || cause == "operator-pause" {
				return true
			}
		}
	}
	return false
}
