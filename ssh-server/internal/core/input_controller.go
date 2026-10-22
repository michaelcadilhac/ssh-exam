package core

// UNWIRED C3/H4 primitive. No bridge, lease consumer or attempt transition calls
// this controller. A drained receipt is NOT a freeze, peer/owner, queue-discard
// or held-recovery proof. Those must be established by the native caller before
// arming, with durable all-pane/admission and epoch/authority fences.

import (
	"context"
	"errors"
	"sync"
	"time"
)

var (
	errPaneInputHeld    = errors.New("terminal input is revoked; native recovery required")
	errPaneInputScope   = errors.New("terminal input scope or sequence rejected; no input admitted")
	errPaneInputBusy    = errors.New("terminal input delivery already in progress; input not queued")
	errPaneInputWrite   = errors.New("terminal input delivery failed; permission revoked")
	errPaneInputBarrier = errors.New("terminal input barrier or native authorization rejected")
)

type paneInputDelivery struct {
	cancel context.CancelFunc
	done   chan struct{}
	wake   chan struct{}
}

// Identity is private and scoped to this controller's current revocation. Never
// deserialize a browser-supplied receipt or use channel readiness as freeze proof.
type paneInputDrain struct {
	gate     *paneInputGate
	revision uint64
	done     <-chan struct{}
}

type paneInputGate struct {
	mu                  sync.Mutex
	pane, epoch         string
	now                 func() int64 // Trusted boot-monotonic milliseconds.
	lastNow, until      int64
	deadline            int64
	sequence, revision  uint64
	held, exhausted     bool
	discarding, faulted bool
	flight              *paneInputDelivery
	drain               *paneInputDrain
}

func newPaneInputGate(pane string, now func() int64) (*paneInputGate, error) {
	if !monitoringUUID.MatchString(pane) || now == nil {
		return nil, errPaneInputBarrier
	}
	g := &paneInputGate{pane: pane, now: now, lastNow: -1}
	g.revokeLocked()
	return g, nil
}

// revoke never waits for a reader, writer, shared state transaction or clock.
// Work may not thaw until the returned drain AND the independent native freeze/
// input-discard barriers are verified. A blocked uncooperative writer cannot make
// its drain ready and therefore cannot be treated as safely stopped.
func (g *paneInputGate) revoke() *paneInputDrain {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.revokeLocked()
}

func (g *paneInputGate) revokeLocked() *paneInputDrain {
	if g.held {
		return g.drain
	}
	g.held = true
	if g.revision == framedInputMaxSequence {
		g.exhausted = true
	} else {
		g.revision++
	}
	var done <-chan struct{}
	if g.flight != nil {
		g.flight.cancel()
		done = g.flight.done
	} else {
		ready := make(chan struct{})
		close(ready)
		done = ready
	}
	g.drain = &paneInputDrain{gate: g, revision: g.revision, done: done}
	return g.drain
}

func (g *paneInputGate) clockLocked() (int64, bool) {
	now := g.now()
	if now < 0 || now < g.lastNow {
		g.revokeLocked()
		return 0, false
	}
	g.lastNow = now
	return now, true
}

// arm consumes ONLY the current local drain; the caller remains responsible for
// actual native authorization, all-pane freeze/discard and fresh durable epochs.
// The supplied cutoff is the verified permit's original cutoff, NOT now+15s.
func (g *paneInputGate) arm(drain *paneInputDrain, epoch string, until, deadline int64) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	if drain == nil || !g.held || g.exhausted || g.faulted || g.discarding || g.drain != drain || drain.gate != g || drain.revision != g.revision || !monitoringDigest.MatchString(epoch) || epoch == g.epoch {
		return errPaneInputBarrier
	}
	select {
	case <-drain.done:
	default:
		return errPaneInputBarrier
	}
	now, ok := g.clockLocked()
	if !ok || until <= now || deadline < until || until-now > 15000 {
		return errPaneInputBarrier
	}
	g.epoch, g.until, g.deadline = epoch, until, deadline
	g.sequence, g.held, g.drain = 0, false, nil
	return nil
}

// renew cannot recover a revoked/expired epoch or change its fixed deadline.
// Out-of-order valid permits do not shorten a later committed cutoff.
func (g *paneInputGate) renew(epoch string, until int64) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	now, ok := g.clockLocked()
	if !ok || g.held || now >= g.until || now >= g.deadline {
		g.revokeLocked()
		return errPaneInputHeld
	}
	if epoch != g.epoch || until <= now || until > g.deadline || until-now > 15000 {
		return errPaneInputBarrier
	}
	if until > g.until {
		g.until = until
		if g.flight != nil {
			select {
			case g.flight.wake <- struct{}{}:
			default:
			}
		}
	}
	return nil
}

// forward has no internal input queue. The single decoder must call it serially.
// write must be cancellation-aware and bounded in the eventual production
// adapter. It runs outside the mutex: even a broken adapter cannot block revoke,
// but it DOES withhold the drain until its final write returns.
func (g *paneInputGate) forward(frame framedInput, write func(context.Context, []byte) (int, error)) (int, error) {
	g.mu.Lock()
	now, ok := g.clockLocked()
	if !ok || g.held || now >= g.until || now >= g.deadline {
		g.revokeLocked()
		g.mu.Unlock()
		return 0, errPaneInputHeld
	}
	if frame.Epoch != g.epoch || frame.Pane != g.pane || frame.Sequence <= g.sequence || frame.Sequence > framedInputMaxSequence || len(frame.Data) > framedInputMaxData || write == nil {
		g.mu.Unlock()
		return 0, errPaneInputScope
	}
	if g.flight != nil {
		g.mu.Unlock()
		return 0, errPaneInputBusy
	}
	// Reserve before any write. A failed/partial delivery must never be replayed.
	g.sequence = frame.Sequence
	if len(frame.Data) == 0 {
		g.mu.Unlock()
		return 0, nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	delivery := &paneInputDelivery{cancel: cancel, done: make(chan struct{}), wake: make(chan struct{}, 1)}
	g.flight = delivery
	g.mu.Unlock()
	go g.watchDelivery(ctx, delivery)
	defer func() {
		g.mu.Lock()
		g.flight = nil
		close(delivery.done)
		cancel()
		g.mu.Unlock()
	}()
	count := 0
	for count < len(frame.Data) {
		g.mu.Lock()
		now, ok := g.clockLocked()
		allowed := ok && !g.held && ctx.Err() == nil && now < g.until && now < g.deadline
		if !allowed {
			g.revokeLocked()
		}
		g.mu.Unlock()
		if !allowed {
			return count, errPaneInputHeld
		}
		n, err := write(ctx, frame.Data[count:])
		if n < 0 || n > len(frame.Data)-count {
			g.revoke()
			return count, errPaneInputWrite
		}
		count += n
		if err != nil || n == 0 {
			g.revoke()
			return count, errPaneInputWrite
		}
	}
	// A complete write can race a revoke/expiry. Do not report it as current input
	// authority; the count records delivery only, not authorization for more work.
	g.mu.Lock()
	now, ok = g.clockLocked()
	allowed := ok && !g.held && ctx.Err() == nil && now < g.until && now < g.deadline
	if !allowed {
		g.revokeLocked()
	}
	g.mu.Unlock()
	if !allowed {
		return count, errPaneInputHeld
	}
	return count, nil
}

// Always recheck the current cutoff. A timer armed before a valid renewal is not
// evidence that permission expired. Bounded wake coalescing keeps one timer and
// one watcher per in-flight pane, not one goroutine per renewal/frame fragment.
func (g *paneInputGate) watchDelivery(ctx context.Context, delivery *paneInputDelivery) {
	for {
		g.mu.Lock()
		if g.flight != delivery {
			g.mu.Unlock()
			return
		}
		now, ok := g.clockLocked()
		if !ok || g.held || now >= g.until || now >= g.deadline {
			g.revokeLocked()
			g.mu.Unlock()
			return
		}
		remaining := g.until - now
		g.mu.Unlock()
		timer := time.NewTimer(time.Duration(remaining) * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-delivery.wake:
			timer.Stop()
		case <-timer.C:
		}
	}
}
