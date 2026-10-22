package core

import (
	"bytes"
	"context"
	"encoding/hex"
	"errors"
	"io"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"
)

const testInputPane = "12345678-1234-1234-1234-123456789abc"

func paneGateFixture(t *testing.T) (*paneInputGate, *atomic.Int64, string) {
	t.Helper()
	clock := &atomic.Int64{}
	clock.Store(1000)
	g, err := newPaneInputGate(testInputPane, func() (int64, error) { return clock.Load(), nil })
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { g.revoke() })
	epoch := strings.Repeat("a", 64)
	if err := g.arm(g.revoke(), epoch, 16000, 90000); err != nil {
		t.Fatal(err)
	}
	return g, clock, epoch
}

func paneGateFrame(epoch string, seq uint64, data string) framedInput {
	return framedInput{Epoch: epoch, Pane: testInputPane, Sequence: seq, Data: []byte(data)}
}

func requirePaneDrain(t *testing.T, d *paneInputDrain) {
	t.Helper()
	select {
	case <-d.done:
	case <-time.After(time.Second):
		t.Fatal("input drain not acknowledged")
	}
}

func TestPaneInputGateStartsRevokedAndConsumesOnlyCurrentDrain(t *testing.T) {
	clock := func() (int64, error) { return 1000, nil }
	g, err := newPaneInputGate(testInputPane, clock)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { g.revoke() })
	a, b := strings.Repeat("a", 64), strings.Repeat("b", 64)
	write := func(context.Context, []byte) (int, error) { t.Fatal("held input escaped"); return 0, nil }
	if _, err := g.forward(paneGateFrame(a, 1, "private"), write); err != errPaneInputHeld {
		t.Fatal("new gate did not start closed", err)
	}
	d := g.revoke()
	if d != g.revoke() {
		t.Fatal("repeated revoke replaced current receipt")
	}
	other, _ := newPaneInputGate(testInputPane, clock)
	for _, wrong := range []*paneInputDrain{nil, {}, other.revoke()} {
		if err := g.arm(wrong, a, 5000, 90000); err == nil {
			t.Fatal("invalid receipt armed gate")
		}
	}
	for _, bad := range []struct {
		epoch           string
		until, deadline int64
	}{{"", 5000, 90000}, {strings.Repeat("A", 64), 5000, 90000}, {a, 1000, 90000}, {a, 5000, 4999}, {a, 16001, 90000}} {
		if err := g.arm(d, bad.epoch, bad.until, bad.deadline); err == nil {
			t.Fatal("invalid permit armed gate")
		}
	}
	if err := g.arm(d, a, 5000, 90000); err != nil {
		t.Fatal(err)
	}
	if err := g.arm(d, b, 5000, 90000); err == nil {
		t.Fatal("consumed receipt reused")
	}
	current := g.revoke()
	if err := g.arm(d, b, 5000, 90000); err == nil {
		t.Fatal("old receipt crossed revocation")
	}
	if err := g.arm(current, a, 5000, 90000); err == nil {
		t.Fatal("same epoch reset sequence after hold")
	}
	if err := g.arm(current, b, 5000, 90000); err != nil {
		t.Fatal(err)
	}
}

func TestPaneInputGateRejectsWrongReplayAndOversizedFramesWithoutBlockingHealthyInput(t *testing.T) {
	g, _, epoch := paneGateFixture(t)
	var out bytes.Buffer
	write := func(_ context.Context, p []byte) (int, error) {
		if len(p) > 2 {
			p = p[:2]
		}
		return out.Write(p)
	}
	for _, seq := range []uint64{1, 4, 5} {
		f := paneGateFrame(epoch, seq, "\x00\x03漢\xff")
		if n, err := g.forward(f, write); err != nil || n != len(f.Data) {
			t.Fatal("legitimate binary/Unicode input rejected", n, err)
		}
	}
	before := out.Len()
	for _, f := range []framedInput{
		paneGateFrame(epoch, 0, "private"), paneGateFrame(epoch, 5, "private"), paneGateFrame(epoch, framedInputMaxSequence+1, "private"),
		paneGateFrame(strings.Repeat("b", 64), 6, "private"), {Epoch: epoch, Pane: "wrong", Sequence: 6, Data: []byte("private")},
		paneGateFrame(epoch, 6, strings.Repeat("x", framedInputMaxData+1)),
	} {
		if n, err := g.forward(f, write); n != 0 || err != errPaneInputScope || strings.Contains(err.Error(), "private") {
			t.Fatal("invalid input admitted or leaked", n, err)
		}
	}
	if out.Len() != before {
		t.Fatal("rejected input reached writer")
	}
	if n, err := g.forward(paneGateFrame(epoch, 8, ""), write); n != 0 || err != nil {
		t.Fatal("empty no-op refused", err)
	}
	if n, err := g.forward(paneGateFrame(epoch, 9, "new"), write); n != 3 || err != nil {
		t.Fatal("rejected stale frames locked healthy epoch", n, err)
	}
}

func TestPaneInputGateRevokeIsIndependentOfBlockedWriteButDrainIsNot(t *testing.T) {
	g, _, epoch := paneGateFixture(t)
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	t.Cleanup(func() { once.Do(func() { close(release) }) })
	finished := make(chan error, 1)
	go func() {
		_, err := g.forward(paneGateFrame(epoch, 1, "old"), func(context.Context, []byte) (int, error) {
			close(entered)
			<-release // Deliberately violate the eventual adapter's cancellation contract.
			return 1, nil
		})
		finished <- err
	}()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("writer did not enter")
	}
	if _, err := g.forward(paneGateFrame(epoch, 2, "not-queued"), func(context.Context, []byte) (int, error) {
		t.Fatal("concurrent input queued/written")
		return 0, nil
	}); err != errPaneInputBusy {
		t.Fatal("busy gate not bounded", err)
	}
	revoked := make(chan *paneInputDrain, 1)
	go func() { revoked <- g.revoke() }()
	var d *paneInputDrain
	select {
	case d = <-revoked:
	case <-time.After(time.Second):
		t.Fatal("revocation waited for blocked writer")
	}
	select {
	case <-d.done:
		t.Fatal("blocked writer falsely acknowledged as drained")
	default:
	}
	if err := g.arm(d, strings.Repeat("b", 64), 5000, 90000); err == nil {
		t.Fatal("undrained writer rearmed")
	}
	once.Do(func() { close(release) })
	if err := <-finished; err != errPaneInputHeld {
		t.Fatal("old prefix gained current authority", err)
	}
	requirePaneDrain(t, d)
	if err := g.arm(d, strings.Repeat("b", 64), 5000, 90000); err != nil {
		t.Fatal(err)
	}
	if n, err := g.forward(paneGateFrame(epoch, 100, "late-old"), func(context.Context, []byte) (int, error) {
		t.Fatal("retired epoch reached writer after arm")
		return 0, nil
	}); n != 0 || err != errPaneInputScope {
		t.Fatal("retired epoch not fenced", n, err)
	}
}

func TestPaneInputGateWriteFailureRevokesAndCannotReplayPartiallyDeliveredFrame(t *testing.T) {
	for _, result := range []struct {
		n   int
		err error
	}{{0, nil}, {1, io.ErrClosedPipe}, {-1, nil}, {20, nil}} {
		g, _, epoch := paneGateFixture(t)
		f := paneGateFrame(epoch, 1, "private")
		if _, err := g.forward(f, func(context.Context, []byte) (int, error) { return result.n, result.err }); err != errPaneInputWrite || strings.Contains(err.Error(), "private") {
			t.Fatal("write failure not safely reported", err)
		}
		requirePaneDrain(t, g.revoke())
		if _, err := g.forward(f, func(context.Context, []byte) (int, error) { t.Fatal("partial input replayed"); return 0, nil }); err != errPaneInputHeld {
			t.Fatal("failed epoch regained input", err)
		}
	}
}

func TestPaneInputGateRenewalCannotRecoverExpiryOrChangeDeadline(t *testing.T) {
	g, clock, epoch := paneGateFixture(t)
	clock.Store(2000)
	if err := g.renew(epoch, 17000); err != nil {
		t.Fatal(err)
	}
	if err := g.renew(epoch, 10000); err != nil || g.until != 17000 {
		t.Fatal("out-of-order permit shortened current cutoff", err)
	}
	for _, c := range []struct {
		epoch string
		until int64
	}{{strings.Repeat("b", 64), 17000}, {epoch, 17001}, {epoch, 2000}, {epoch, 90001}} {
		if err := g.renew(c.epoch, c.until); err == nil || g.until != 17000 || g.deadline != 90000 {
			t.Fatal("invalid renewal changed authority", err)
		}
	}
	clock.Store(17000)
	if err := g.renew(epoch, 18000); err != errPaneInputHeld {
		t.Fatal("renewal recovered exact-boundary expiry", err)
	}
	clock.Store(17500)
	if err := g.renew(epoch, 18000); err != errPaneInputHeld {
		t.Fatal("later fresh permit thawed expired gate", err)
	}
}

func TestPaneInputGateBackwardsClockAndExhaustedRevisionFailClosed(t *testing.T) {
	g, clock, epoch := paneGateFixture(t)
	clock.Store(999)
	if err := g.renew(epoch, 5000); err != errPaneInputHeld {
		t.Fatal("backwards monotonic clock accepted", err)
	}
	clock.Store(1000)
	g.revision = framedInputMaxSequence
	d := g.revoke()
	// Force a fresh transition at the bound, without requiring quadrillions of holds.
	g.held, g.drain = false, nil
	d = g.revoke()
	if err := g.arm(d, strings.Repeat("b", 64), 5000, 90000); err == nil {
		t.Fatal("exhausted gate rearmed")
	}
}

func TestPaneInputGateHealthyRenewalDoesNotLetAnOldWriteTimerRevokeCurrentAuthority(t *testing.T) {
	started := time.Now()
	g, err := newPaneInputGate(testInputPane, func() (int64, error) { return 1000 + time.Since(started).Milliseconds(), nil })
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { g.revoke() })
	epoch := strings.Repeat("a", 64)
	if err := g.arm(g.revoke(), epoch, 1250, 90000); err != nil {
		t.Fatal(err)
	}
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	t.Cleanup(func() { once.Do(func() { close(release) }) })
	finished := make(chan error, 1)
	go func() {
		_, err := g.forward(paneGateFrame(epoch, 1, "x"), func(ctx context.Context, b []byte) (int, error) {
			close(entered)
			select {
			case <-ctx.Done():
				return 0, ctx.Err()
			case <-release:
				return len(b), nil
			}
		})
		finished <- err
	}()
	<-entered
	if err := g.renew(epoch, 6000); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-finished:
		t.Fatal("old timer revoked valid renewed authority", err)
	case <-time.After(350 * time.Millisecond):
	}
	once.Do(func() { close(release) })
	if err := <-finished; err != nil {
		t.Fatal("healthy renewed input refused", err)
	}
}

func TestPaneInputGateNativeCutoffCancelsEvenAnUnresponsiveDelivery(t *testing.T) {
	started := time.Now()
	g, err := newPaneInputGate(testInputPane, func() (int64, error) { return 1000 + time.Since(started).Milliseconds(), nil })
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { g.revoke() })
	epoch := strings.Repeat("a", 64)
	if err := g.arm(g.revoke(), epoch, 1250, 1250); err != nil {
		t.Fatal(err)
	}
	finished := make(chan error, 1)
	go func() {
		_, err := g.forward(paneGateFrame(epoch, 1, "x"), func(ctx context.Context, _ []byte) (int, error) {
			<-ctx.Done()
			return 0, errors.New("private writer failure")
		})
		finished <- err
	}()
	select {
	case err := <-finished:
		if err != errPaneInputWrite {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("native cutoff failed to cancel delivery")
	}
	requirePaneDrain(t, g.revoke())
	if err := g.renew(epoch, 5000); err != errPaneInputHeld {
		t.Fatal("expired delivery regained permission", err)
	}
}

func TestPaneInputGateNoticesElapsedBootClockWhileItsOldTimerHasNotFired(t *testing.T) {
	clock := &atomic.Int64{}
	clock.Store(1000)
	calls := &atomic.Int64{}
	g, err := newPaneInputGate(testInputPane, func() (int64, error) { now := clock.Load(); calls.Add(1); return now, nil })
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { g.revoke() })
	epoch := strings.Repeat("a", 64)
	if err := g.arm(g.revoke(), epoch, 16000, 90000); err != nil {
		t.Fatal(err)
	}
	entered := make(chan struct{})
	finished := make(chan error, 1)
	go func() {
		_, err := g.forward(paneGateFrame(epoch, 1, "x"), func(ctx context.Context, _ []byte) (int, error) { close(entered); <-ctx.Done(); return 0, ctx.Err() })
		finished <- err
	}()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("delivery not entered")
	}
	// Arm, initial forward, pre-write and watcher clock reads all occur before
	// advancing boot time. The watcher has computed a long original timer; this
	// is deterministic clock-source fault injection, not a host suspend/change.
	deadline := time.Now().Add(time.Second)
	for calls.Load() < 4 {
		if time.Now().After(deadline) {
			t.Fatal("watcher did not sample initial cutoff")
		}
		time.Sleep(time.Millisecond)
	}
	g.mu.Lock()
	clock.Store(16001)
	g.mu.Unlock()
	select {
	case err := <-finished:
		if err != errPaneInputWrite && err != errPaneInputHeld {
			t.Fatal("elapsed clock did not revoke input", err)
		}
	case <-time.After(time.Second):
		t.Fatal("old timer concealed elapsed native boot-clock authority")
	}
	requirePaneDrain(t, g.revoke())
}

func TestPaneInputGateClockReadFailureRevokesWithoutInventingTimeOrLeakingDetails(t *testing.T) {
	failed := &atomic.Bool{}
	g, err := newPaneInputGate(testInputPane, func() (int64, error) {
		if failed.Load() {
			return 1234, errors.New("PRIVATE-CLOCK-DETAIL")
		}
		return 1000, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { g.revoke() })
	epoch := strings.Repeat("a", 64)
	if err := g.arm(g.revoke(), epoch, 16000, 90000); err != nil {
		t.Fatal(err)
	}
	entered := make(chan struct{})
	finished := make(chan error, 1)
	go func() {
		_, err := g.forward(paneGateFrame(epoch, 1, "x"), func(ctx context.Context, _ []byte) (int, error) { close(entered); <-ctx.Done(); return 0, ctx.Err() })
		finished <- err
	}()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("delivery not entered")
	}
	failed.Store(true)
	select {
	case err := <-finished:
		if err == nil || strings.Contains(err.Error(), "PRIVATE-CLOCK-DETAIL") {
			t.Fatal("clock failure ignored/leaked", err)
		}
	case <-time.After(time.Second):
		t.Fatal("clock failure left input running")
	}
	requirePaneDrain(t, g.revoke())
	if err := g.renew(epoch, 5000); err != errPaneInputHeld {
		t.Fatal("unknown clock renewed permission", err)
	}
	if err := g.arm(g.revoke(), strings.Repeat("b", 64), 5000, 90000); err != errPaneInputBarrier {
		t.Fatal("unknown clock armed new epoch", err)
	}
}

func TestPaneInputGateLatePartialFrameCannotCrossEpochOverActualPTY(t *testing.T) {
	g, _, epoch := paneGateFixture(t)
	want, wire := framedInputFixture(t)
	master, slave, err := openPTY()
	if err != nil {
		t.Fatal(err)
	}
	defer master.Close()
	defer slave.Close()
	restore, err := rawTerminal(slave.Fd())
	if err != nil {
		t.Fatal(err)
	}
	defer restore()
	r, w := io.Pipe()
	defer r.Close()
	defer w.Close()
	type result struct {
		n   int
		err error
	}
	results := make(chan result, 4)
	var writes atomic.Int64
	go func() {
		for {
			f, err := readFramedInput(r)
			if err != nil {
				return
			}
			n, err := g.forward(f, func(_ context.Context, b []byte) (int, error) { writes.Add(1); return master.Write(b) })
			results <- result{n, err}
		}
	}()
	// The parser is blocked mid-frame, outside the controller. Holding input
	// must not wait for the remainder of this attacker/transport-controlled read.
	if _, err := w.Write(wire[:len(wire)-2]); err != nil {
		t.Fatal(err)
	}
	d := g.revoke()
	requirePaneDrain(t, d)
	newEpoch := strings.Repeat("b", 64)
	// Test only the local barrier: no workload exists here to freeze. This is NOT
	// authorization for a real native transition to skip freeze/queue discard.
	if err := g.arm(d, newEpoch, 5000, 90000); err != nil {
		t.Fatal(err)
	}
	if _, err := w.Write(wire[len(wire)-2:]); err != nil {
		t.Fatal(err)
	}
	select {
	case got := <-results:
		if got.n != 0 || got.err != errPaneInputScope || writes.Load() != 0 {
			t.Fatal("old delayed input crossed new epoch", got.n, got.err)
		}
	case <-time.After(time.Second):
		t.Fatal("old frame did not settle")
	}
	newWire := append([]byte{}, wire...)
	newEpochBytes, _ := hex.DecodeString(newEpoch)
	copy(newWire[8:40], newEpochBytes)
	if _, err := w.Write(newWire); err != nil {
		t.Fatal(err)
	}
	select {
	case got := <-results:
		if got.n != len(want.Data) || got.err != nil || writes.Load() != 1 {
			t.Fatal("new input not forwarded", got.n, got.err)
		}
	case <-time.After(time.Second):
		t.Fatal("new frame did not settle")
	}
	input := make(chan []byte, 1)
	go func() {
		b := make([]byte, len(want.Data))
		if _, err := io.ReadFull(slave, b); err == nil {
			input <- b
		}
	}()
	select {
	case got := <-input:
		if !bytes.Equal(got, want.Data) {
			t.Fatal("control/binary/UTF8 input changed over PTY")
		}
	case <-time.After(time.Second):
		t.Fatal("actual PTY input missing")
	}
	requirePaneDrain(t, g.revoke())
	output := make(chan []byte, 1)
	go func() {
		b := make([]byte, 4)
		if _, err := io.ReadFull(master, b); err == nil {
			output <- b
		}
	}()
	if _, err := slave.Write([]byte("LIVE")); err != nil {
		t.Fatal(err)
	}
	select {
	case got := <-output:
		if string(got) != "LIVE" || epoch == newEpoch {
			t.Fatal("output channel lost/changed during input revocation")
		}
	case <-time.After(time.Second):
		t.Fatal("output blocked by input hold")
	}
}

func TestPaneInputGateCancelsActualPTYBackpressureWithoutPretendingQueuesAreFlushed(t *testing.T) {
	g, _, epoch := paneGateFixture(t)
	master, slave, err := openPTY()
	if err != nil {
		t.Fatal(err)
	}
	defer master.Close()
	defer slave.Close()
	restore, err := rawTerminal(slave.Fd())
	if err != nil {
		t.Fatal(err)
	}
	defer restore()
	fd := int(master.Fd())
	if err := syscall.SetNonblock(fd, true); err != nil {
		t.Fatal(err)
	}
	data := bytes.Repeat([]byte{'x'}, framedInputMaxData)
	pressured := false
	for range 1024 {
		if _, err := syscall.Write(fd, data); err == syscall.EAGAIN {
			pressured = true
			break
		} else if err != nil && err != syscall.EINTR {
			t.Fatal(err)
		}
	}
	if !pressured {
		t.Fatal("could not establish real PTY backpressure")
	}
	entered := make(chan struct{})
	finished := make(chan error, 1)
	go func() {
		var once sync.Once
		_, err := g.forward(paneGateFrame(epoch, 1, string(data)), func(ctx context.Context, b []byte) (int, error) {
			once.Do(func() { close(entered) })
			for {
				if ctx.Err() != nil {
					return 0, ctx.Err()
				}
				n, err := syscall.Write(fd, b)
				if err != syscall.EAGAIN && err != syscall.EINTR {
					if n < 0 {
						n = 0
					}
					return n, err
				}
				select {
				case <-ctx.Done():
					return 0, ctx.Err()
				case <-time.After(time.Millisecond):
				}
			}
		})
		finished <- err
	}()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("backpressured writer not started")
	}
	d := g.revoke()
	requirePaneDrain(t, d)
	select {
	case err := <-finished:
		if err != errPaneInputWrite && err != errPaneInputHeld {
			t.Fatal("backpressured input not safely retired", err)
		}
	case <-time.After(time.Second):
		t.Fatal("backpressured delivery did not cancel")
	}
	// No arm/thaw: the PTY's unread kernel queue still contains prior bytes.
	// This drain proves the bridge stopped writing, not that input was discarded.
}
