package core

// Existing coordinator/watchdog: authenticated outbound evidence and bounded
// coalesced bridges. No private key, configuration or global Engine enters the
// attempt supervisor. Its live authority still owns the cutoff/writer barrier.

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type terminalMonitoringBridge struct {
	once     sync.Once
	ready    atomic.Bool
	initErr  error
	key      ed25519.PrivateKey
	client   *http.Client
	mu       sync.Mutex
	targets  map[string]terminalMonitoringTarget
	inflight map[string]bool
	cancel   context.CancelFunc
	done     chan struct{}
	workers  sync.WaitGroup
	watchMu  sync.Mutex
	watched  map[string]*terminalCutoffWatch
}

type terminalMonitoringTarget struct {
	owner          monitoringOwner
	deadlineBootMS int64
}

// Actual Watch caller: discover identities outside its deadline/policy/state
// work. A saved owner selects a challenge target; only the live supervisor and
// freshly signed complete evidence can establish any execution permission.
func (e *Engine) watchTerminalMonitoring(stop <-chan struct{}) {
	// Cache the existing role's credential before later disk stalls/removal.
	// Failure cannot block the independent cutoff loop or grant permission.
	_ = e.prepareTerminalMonitoring()
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	nextLog := time.Time{}
	ctx, cancel := context.WithCancel(context.Background())
	var technicalWorkers sync.WaitGroup
	defer func() { cancel(); technicalWorkers.Wait() }()
	technicalActive, technicalSeen, technicalUntil := map[string]bool{}, map[string]string{}, map[string]int64{}
	completed := make(chan string, 16)
	for {
		select {
		case <-stop:
			return
		case id := <-completed:
			delete(technicalActive, id)
		case <-ticker.C:
			if err := e.syncTerminalMonitoringTargets(); err != nil && !time.Now().Before(nextLog) {
				log.Printf("watchdog monitoring bridge unavailable; existing live cutoffs remain authoritative: %v", err)
				nextLog = time.Now().Add(30 * time.Second)
			}
			// These separate bounded workers may wait on audit/state fsync. They
			// never occupy a live evidence-renewal worker or the cutoff loop.
			state, err := readStateSnapshot(e.Config.State)
			at, clockErr := monitoringBootMillis()
			if err != nil || clockErr != nil {
				continue
			}
			for id, a := range state.Attempts {
				if !technicalRecoveryCandidate(a) {
					delete(technicalSeen, id)
					delete(technicalUntil, id)
					continue
				}
				if a.State == "LOCKED" || a.RetainedHold == "resuming" || technicalSeen[id] != a.MonitoringResumeNonce {
					technicalUntil[id] = at + 30000
					technicalSeen[id] = a.MonitoringResumeNonce
				}
				if technicalActive[id] || len(technicalActive) >= 16 || at >= technicalUntil[id] {
					continue
				}
				technicalActive[id] = true
				technicalWorkers.Add(1)
				go func(a *Attempt) {
					defer technicalWorkers.Done()
					defer func() {
						select {
						case completed <- a.ID:
						case <-ctx.Done():
						}
					}()
					_ = e.pollTechnicalRecovery(ctx, a)
				}(a)
			}
		}
	}
}

func (e *Engine) syncTerminalMonitoringTargets() error {
	state, err := readStateSnapshot(e.Config.State)
	if os.IsNotExist(err) {
		return nil // Absence never constructs authority or retires a live peer.
	}
	if err != nil {
		return err
	}
	wanted := map[string]terminalMonitoringTarget{}
	for id, a := range state.Attempts {
		if a == nil || a.ID != id || a.State != "ACTIVE" || a.MonitoringMode != "v1" || a.RetainedHold != "" || a.Start <= 0 || !currentRegisteredOwner(a) || expired(a) {
			continue
		}
		wanted[id] = terminalMonitoringTarget{owner: *a.RegisteredOwner, deadlineBootMS: int64(a.UptimeDeadline * 1000)}
	}
	if len(wanted) > 0 {
		if err := e.prepareTerminalMonitoring(); err != nil {
			return err
		}
	}
	b := &e.terminalMonitoring
	b.mu.Lock()
	for id := range b.targets {
		if _, current := wanted[id]; !current {
			delete(b.targets, id)
		}
	}
	b.mu.Unlock()
	for id, target := range wanted {
		e.registerTerminalMonitoring(id, target.owner, target.deadlineBootMS)
	}
	return nil
}

func (e *Engine) prepareTerminalMonitoring() error {
	b := &e.terminalMonitoring
	b.once.Do(func() {
		key, err := privateKey(e.Config.CallbackKey)
		if err != nil {
			b.initErr = err
			return
		}
		client, err := e.callbackClient()
		if err != nil {
			for i := range key {
				key[i] = 0
			}
			b.initErr = err
			return
		}
		client.Timeout = 5 * time.Second
		if transport, ok := client.Transport.(*http.Transport); ok {
			transport.MaxIdleConns, transport.MaxIdleConnsPerHost, transport.MaxConnsPerHost = 64, 64, 64
		}
		b.key, b.client = key, client
		b.ready.Store(true)
	})
	return b.initErr
}

func (e *Engine) registerTerminalMonitoring(id string, owner monitoringOwner, deadlineBootMS int64) {
	b := &e.terminalMonitoring
	if !b.ready.Load() {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.targets == nil {
		b.targets, b.inflight = map[string]terminalMonitoringTarget{}, map[string]bool{}
	}
	b.targets[id] = terminalMonitoringTarget{owner: owner, deadlineBootMS: deadlineBootMS}
	if b.cancel != nil {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	b.cancel, b.done = cancel, make(chan struct{})
	go func() {
		defer close(b.done)
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		slots := make(chan struct{}, 16)
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
			now, clockErr := monitoringBootMillis()
			if clockErr != nil {
				continue
			}
			b.mu.Lock()
			for id, target := range b.targets {
				if now >= target.deadlineBootMS {
					delete(b.targets, id)
					continue
				}
				if b.inflight[id] {
					continue
				}
				select {
				case slots <- struct{}{}:
				default:
					continue
				}
				b.inflight[id] = true
				b.workers.Add(1)
				go func(id string, owner monitoringOwner) {
					defer b.workers.Done()
					defer func() { <-slots; b.mu.Lock(); delete(b.inflight, id); b.mu.Unlock() }()
					// A failed exchange preserves the original live cutoff. It is
					// not a policy/authentication failure, new allowance or grace.
					_ = e.refreshTerminalMonitoring(ctx, id, owner)
				}(id, target.owner)
			}
			b.mu.Unlock()
		}
	}()
}

func (e *Engine) refreshTerminalMonitoring(ctx context.Context, id string, owner monitoringOwner) error {
	b := &e.terminalMonitoring
	if !b.ready.Load() || ctx.Err() != nil {
		return errMonitoringAuthority
	}
	reply, err := e.callTerminalAuthority(terminalAuthorityRequest{Op: "challenge", Attempt: id, Owner: owner}, nil, false)
	if err != nil || reply.Challenge == nil {
		return errMonitoringAuthority
	}
	c := reply.Challenge
	if c.Owner != owner || c.Agent != e.Config.AgentID {
		return errMonitoringScope
	}
	body := map[string]any{"type": "monitoring-execution-challenge-v1", "agent": c.Agent, "nonce": c.Nonce, "owner": c.Owner, "after_sequence": c.AfterSequence, "coverage_epoch": c.CoverageEpoch}
	if c.PolicyReports != "" {
		body["policy_reports"] = c.PolicyReports
	}
	frame, err := e.exchangeTerminalMonitoring(ctx, "/api/agent/monitoring-evidence", body)
	if err != nil {
		return err
	}
	accepted, err := e.callTerminalAuthority(terminalAuthorityRequest{Op: "proof", Attempt: id, Owner: owner, Frame: &frame}, nil, false)
	if err != nil {
		return err
	}
	if accepted.Receipt == nil || accepted.Receipt.Nonce != c.Nonce || accepted.View == nil || !accepted.View.ExecutionAuthorized {
		return errMonitoringAuthority
	}
	return nil
}

func (e *Engine) exchangeTerminalMonitoring(ctx context.Context, route string, body any) (SignedFrame, error) {
	var frame SignedFrame
	b := &e.terminalMonitoring
	if !b.ready.Load() || (route != "/api/agent/monitoring-evidence" && route != "/api/agent/monitoring-continue" && route != "/api/agent/monitoring-technical") {
		return frame, errMonitoringScope
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return frame, err
	}
	limit := monitoringEvidenceMaxBytes
	if route == "/api/agent/monitoring-technical" {
		limit = 65536
	}
	if len(payload) > limit {
		return frame, errMonitoringScope
	}
	request, err := http.NewRequestWithContext(ctx, "POST", strings.TrimSuffix(e.Config.CallbackURL, "/")+route, bytes.NewReader(payload))
	if err != nil {
		return frame, err
	}
	request.Header.Set("Content-Type", "application/vnd.ssh-exam-event")
	request.Header.Set("X-Exam-Signature", base64.StdEncoding.EncodeToString(ed25519.Sign(b.key, payload)))
	response, err := b.client.Do(request)
	if err != nil {
		return frame, err
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return frame, errors.New("fresh complete monitoring evidence or continuation approval is unavailable; preserve the original interval and restore current monitoring/approval before retrying")
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, 8193))
	if err != nil || len(data) > 8192 || terminalDecode(data, &frame) != nil {
		return frame, errMonitoringEvidence
	}
	return frame, nil
}

func (e *Engine) stopTerminalMonitoring() {
	b := &e.terminalMonitoring
	b.watchMu.Lock()
	for id, watch := range b.watched {
		watch.close()
		delete(b.watched, id)
	}
	b.watchMu.Unlock()
	b.mu.Lock()
	cancel, done := b.cancel, b.done
	b.mu.Unlock()
	if cancel == nil {
		return
	}
	cancel()
	<-done // No further worker admission after the scheduler exits.
	b.workers.Wait()
	b.client.CloseIdleConnections()
}
