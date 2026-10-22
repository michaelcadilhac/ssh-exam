package core

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"strings"
	"syscall"
	"testing"
	"time"
)

func panePTYFixture(t *testing.T) (*paneInputGate, *panePTYInput, string) {
	return panePTYFixtureMode(t, true)
}

func panePTYFixtureMode(t *testing.T, raw bool) (*paneInputGate, *panePTYInput, string) {
	t.Helper()
	g, _, epoch := paneGateFixture(t)
	m, s, err := openPTYMasterFlags(syscall.O_NONBLOCK)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { m.Close(); s.Close() })
	if raw {
		restore, err := rawTerminal(s.Fd())
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { restore() })
	}
	w, err := newPanePTYInput(g, m, s)
	if err != nil {
		t.Fatal(err)
	}
	return g, w, epoch
}

func fillPanePTY(t *testing.T, w *panePTYInput) {
	t.Helper()
	fd := int(w.master.Fd()) // Explicit O_NONBLOCK must survive trusted Fd access.
	data := bytes.Repeat([]byte{'A'}, framedInputMaxData)
	for range 1024 {
		if _, err := syscall.Write(fd, data); err == syscall.EAGAIN {
			return
		} else if err != nil && err != syscall.EINTR {
			t.Fatal(err)
		}
	}
	t.Fatal("PTY did not reach actual kernel backpressure")
}

func readPanePTY(t *testing.T, file *os.File, want []byte) {
	t.Helper()
	type outcome struct {
		b   []byte
		err error
	}
	read := make(chan outcome, 1)
	go func() { b := make([]byte, len(want)); _, err := io.ReadFull(file, b); read <- outcome{b, err} }()
	select {
	case got := <-read:
		if got.err != nil || !bytes.Equal(got.b, want) {
			t.Fatal("PTY bytes missing/changed or old input survived discard", got.err)
		}
	case <-time.After(time.Second):
		t.Fatal("PTY IO did not complete")
	}
}

func TestPanePTYInputRejectsLegacyBlockingWrongAndClosedDescriptors(t *testing.T) {
	g, w, _ := panePTYFixture(t)
	otherMaster, otherSlave, err := openPTYMasterFlags(syscall.O_NONBLOCK)
	if err != nil {
		t.Fatal(err)
	}
	defer otherMaster.Close()
	defer otherSlave.Close()
	legacyMaster, legacySlave, err := openPTY()
	if err != nil {
		t.Fatal(err)
	}
	defer legacyMaster.Close()
	defer legacySlave.Close()
	regular, err := os.CreateTemp(t.TempDir(), "not-a-PTY-")
	if err != nil {
		t.Fatal(err)
	}
	defer regular.Close()
	for _, c := range []struct {
		g             *paneInputGate
		master, slave *os.File
	}{
		{nil, w.master, w.slave}, {g, nil, w.slave}, {g, w.master, nil}, {g, w.master, w.master},
		{g, w.master, otherSlave}, {g, legacyMaster, legacySlave}, {g, regular, w.slave}, {g, w.master, regular},
	} {
		if got, err := newPanePTYInput(c.g, c.master, c.slave); got != nil || err != errPaneInputPTY {
			t.Fatal("unsafe PTY adapter accepted", err)
		}
	}
	otherMaster.Close()
	if got, err := newPanePTYInput(g, otherMaster, otherSlave); got != nil || err != errPaneInputPTY {
		t.Fatal("closed PTY adapter accepted", err)
	}
}

func TestPanePTYInputDiscardRemovesBackpressuredInputWithoutDiscardingOutput(t *testing.T) {
	g, w, _ := panePTYFixture(t)
	fillPanePTY(t, w)
	if _, err := w.slave.Write([]byte("OUTPUT")); err != nil {
		t.Fatal(err)
	}
	d := g.revoke()
	requirePaneDrain(t, d)
	if err := w.discardKernelInput(d); err != nil {
		t.Fatal("backpressured input discard failed", err)
	}
	readPanePTY(t, w.master, []byte("OUTPUT"))
	epoch := strings.Repeat("b", 64)
	if err := g.arm(d, epoch, 5000, 90000); err != nil {
		t.Fatal(err)
	}
	data := "Z\x03\x00漢\xff"
	if n, err := g.forward(paneGateFrame(epoch, 1, data), w.write); err != nil || n != len(data) {
		t.Fatal("new input after discard refused", n, err)
	}
	readPanePTY(t, w.slave, []byte(data))
}

func TestPanePTYInputDiscardRemovesUnsubmittedCanonicalLineNotJustReadableBytes(t *testing.T) {
	g, w, epoch := panePTYFixtureMode(t, false)
	if n, err := g.forward(paneGateFrame(epoch, 1, "old-incomplete-line"), w.write); n != len("old-incomplete-line") || err != nil {
		t.Fatal(err)
	}
	d := g.revoke()
	if err := w.discardKernelInput(d); err != nil {
		t.Fatal(err)
	}
	epoch = strings.Repeat("b", 64)
	if err := g.arm(d, epoch, 5000, 90000); err != nil {
		t.Fatal(err)
	}
	if n, err := g.forward(paneGateFrame(epoch, 1, "NEW\n"), w.write); n != 4 || err != nil {
		t.Fatal(err)
	}
	readPanePTY(t, w.slave, []byte("NEW\n"))
}

func TestPanePTYInputRealBackpressureCancellationAndNewEpochDoNotClosePTYOrRetainOldDeadlines(t *testing.T) {
	g, w, epoch := panePTYFixture(t)
	for cycle := 1; cycle <= 20; cycle++ {
		fillPanePTY(t, w)
		entered := make(chan struct{})
		finished := make(chan error, 1)
		go func() {
			_, err := g.forward(paneGateFrame(epoch, 1, strings.Repeat("B", framedInputMaxData)), func(ctx context.Context, data []byte) (int, error) {
				close(entered)
				return w.write(ctx, data)
			})
			finished <- err
		}()
		select {
		case <-entered:
		case <-time.After(time.Second):
			t.Fatal("input delivery did not start")
		}
		select {
		case err := <-finished:
			t.Fatal("PTY was not genuinely backpressured", err)
		case <-time.After(5 * time.Millisecond):
		}
		d := g.revoke()
		requirePaneDrain(t, d)
		select {
		case err := <-finished:
			if err != errPaneInputWrite && err != errPaneInputHeld {
				t.Fatal("blocked PTY write did not retire safely", err)
			}
		case <-time.After(time.Second):
			t.Fatal("real PTY cancellation did not complete")
		}
		if err := w.discardKernelInput(d); err != nil {
			t.Fatal(err)
		}
		epoch = fmt.Sprintf("%064x", cycle)
		if err := g.arm(d, epoch, 5000, 90000); err != nil {
			t.Fatal(err)
		}
		if n, err := g.forward(paneGateFrame(epoch, 1, "Z"), w.write); n != 1 || err != nil {
			t.Fatal("old deadline poisoned new epoch", n, err)
		}
		readPanePTY(t, w.slave, []byte("Z"))
		// A fresh active epoch is needed for the next backpressure delivery.
		d = g.revoke()
		if err := w.discardKernelInput(d); err != nil {
			t.Fatal(err)
		}
		epoch = fmt.Sprintf("%064x", cycle+100)
		if err := g.arm(d, epoch, 5000, 90000); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := w.slave.Write([]byte("LIVE")); err != nil {
		t.Fatal(err)
	}
	readPanePTY(t, w.master, []byte("LIVE"))
}

func TestPanePTYInputDiscardRefusesStaleUndrainedAndActiveGates(t *testing.T) {
	g, w, epoch := panePTYFixture(t)
	other, _, _ := paneGateFixture(t)
	for _, d := range []*paneInputDrain{nil, {}, other.revoke()} {
		if err := w.discardKernelInput(d); err != errPaneInputBarrier {
			t.Fatal("unsafe discard accepted", err)
		}
	}
	entered, release := make(chan struct{}), make(chan struct{})
	finished := make(chan struct{})
	go func() {
		defer close(finished)
		g.forward(paneGateFrame(epoch, 1, "x"), func(context.Context, []byte) (int, error) { close(entered); <-release; return 1, nil })
	}()
	<-entered
	d := g.revoke()
	if err := w.discardKernelInput(d); err != errPaneInputBarrier {
		t.Fatal("undrained input discarded", err)
	}
	close(release)
	<-finished
	if err := w.discardKernelInput(d); err != nil {
		t.Fatal(err)
	}
	if err := g.arm(d, strings.Repeat("b", 64), 5000, 90000); err != nil {
		t.Fatal(err)
	}
	if err := w.discardKernelInput(d); err != errPaneInputBarrier {
		t.Fatal("active new epoch discarded by stale receipt", err)
	}
}

func TestPanePTYInputDiscardDoesNotBlockRevokeAndCannotRaceArm(t *testing.T) {
	g, w, _ := panePTYFixture(t)
	d := g.revoke()
	w.mu.Lock()
	finished := make(chan error, 1)
	go func() { finished <- w.discardKernelInput(d) }()
	deadline := time.Now().Add(time.Second)
	for {
		g.mu.Lock()
		discarding := g.discarding
		g.mu.Unlock()
		if discarding {
			break
		}
		if time.Now().After(deadline) {
			w.mu.Unlock()
			t.Fatal("discard did not reserve barrier")
		}
		time.Sleep(time.Millisecond)
	}
	if err := g.arm(d, strings.Repeat("b", 64), 5000, 90000); err != errPaneInputBarrier {
		w.mu.Unlock()
		t.Fatal("arm raced unfinished discard", err)
	}
	revoked := make(chan *paneInputDrain, 1)
	go func() { revoked <- g.revoke() }()
	select {
	case got := <-revoked:
		if got != d {
			w.mu.Unlock()
			t.Fatal("discard changed current revocation")
		}
	case <-time.After(time.Second):
		w.mu.Unlock()
		t.Fatal("discard waited under controller lock")
	}
	w.mu.Unlock()
	if err := <-finished; err != nil {
		t.Fatal(err)
	}
}

func TestPanePTYInputFailedDiscardPoisonsArmEvenIfCallerIgnoresError(t *testing.T) {
	g, w, _ := panePTYFixture(t)
	d := g.revoke()
	w.slave.Close()
	if err := w.discardKernelInput(d); err != errPaneInputPTY {
		t.Fatal("failed discard not reported", err)
	}
	if err := g.arm(d, strings.Repeat("b", 64), 5000, 90000); err != errPaneInputBarrier {
		t.Fatal("failed discard followed by arm", err)
	}
}

func TestPanePTYInputBlockedPaneDoesNotDelayAnotherPaneOrChangeItsAuthority(t *testing.T) {
	g, w, epoch := panePTYFixture(t)
	other, otherPTY, otherEpoch := panePTYFixture(t)
	fillPanePTY(t, w)
	entered := make(chan struct{})
	finished := make(chan error, 1)
	go func() {
		_, err := g.forward(paneGateFrame(epoch, 1, strings.Repeat("B", framedInputMaxData)), func(ctx context.Context, data []byte) (int, error) { close(entered); return w.write(ctx, data) })
		finished <- err
	}()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("blocked pane did not start")
	}
	for seq := uint64(1); seq <= 2; seq++ {
		if n, err := other.forward(paneGateFrame(otherEpoch, seq, "OTHER"), otherPTY.write); n != 5 || err != nil {
			t.Fatal("other pane delayed or revoked", n, err)
		}
		readPanePTY(t, otherPTY.slave, []byte("OTHER"))
		if seq == 1 {
			d := g.revoke()
			requirePaneDrain(t, d)
			select {
			case <-finished:
			case <-time.After(time.Second):
				t.Fatal("blocked pane failed to retire")
			}
			if err := w.discardKernelInput(d); err != nil {
				t.Fatal(err)
			}
		}
	}
	other.mu.Lock()
	defer other.mu.Unlock()
	if other.held || other.epoch != otherEpoch || other.until != 16000 || other.deadline != 90000 {
		t.Fatal("another pane's hold altered healthy authority")
	}
}
