package core

// Existing coordinator only: authenticated outbound evidence and a bounded
// coalesced bridge. No private key, configuration or global Engine enters the
// attempt supervisor. This is NOT the independent shared cutoff/writer barrier.

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
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
	if !b.ready.Load() || (route != "/api/agent/monitoring-evidence" && route != "/api/agent/monitoring-continue") {
		return frame, errMonitoringScope
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return frame, err
	}
	if len(payload) > monitoringEvidenceMaxBytes {
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
