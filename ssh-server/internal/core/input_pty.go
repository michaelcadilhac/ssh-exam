package core

// UNWIRED C3/H4 adapter. No production admission/bridge/hold path calls this
// code. Discarding unread kernel input does not establish verified writer freeze,
// current ownership, full monitoring coverage or permission to re-arm/thaw.

import (
	"context"
	"errors"
	"os"
	"sync"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
)

var errPaneInputPTY = errors.New("terminal input adapter or queue-discard verification failed; retain revoked input and inspect native containment")

const panePTYNormalDiscipline = 0 // Linux N_TTY ABI; no alternate ldisc is qualified.

type panePTYInput struct {
	mu            sync.Mutex
	gate          *paneInputGate
	master, slave *os.File
	masterRaw     syscall.RawConn
	slaveRaw      syscall.RawConn
}

// The caller owns these descriptors exclusively. The master must be explicitly
// O_NONBLOCK and Go-poller supported; never retrofit a legacy live bridge or use
// a different PTY's slave to claim that this pane's unread input was discarded.
func newPanePTYInput(gate *paneInputGate, master, slave *os.File) (*panePTYInput, error) {
	if gate == nil || master == nil || slave == nil || master == slave {
		return nil, errPaneInputPTY
	}
	mr, err := master.SyscallConn()
	if err != nil {
		return nil, errPaneInputPTY
	}
	sr, err := slave.SyscallConn()
	if err != nil {
		return nil, errPaneInputPTY
	}
	w := &panePTYInput{gate: gate, master: master, slave: slave, masterRaw: mr, slaveRaw: sr}
	if err := w.verifyPair(); err != nil {
		return nil, err
	}
	if master.SetWriteDeadline(time.Time{}) != nil {
		return nil, errPaneInputPTY
	}
	return w, nil
}

func (w *panePTYInput) verifyPair() error {
	var inner error
	err := w.masterRaw.Control(func(fd uintptr) {
		flags, err := unix.FcntlInt(fd, unix.F_GETFL, 0)
		discipline, disciplineErr := unix.IoctlGetInt(int(fd), unix.TIOCGETD)
		if err != nil || flags&unix.O_NONBLOCK == 0 || disciplineErr != nil || discipline != panePTYNormalDiscipline {
			inner = errPaneInputPTY
			return
		}
		// Obtain the actual peer through the pinned master, not a path/PTS number
		// that can name a different terminal in another mount namespace.
		peer, _, errno := unix.Syscall(unix.SYS_IOCTL, fd, uintptr(unix.TIOCGPTPEER), uintptr(unix.O_RDWR|unix.O_NOCTTY|unix.O_CLOEXEC))
		if errno != 0 {
			inner = errPaneInputPTY
			return
		}
		defer unix.Close(int(peer))
		var actual, provided unix.Stat_t
		if unix.Fstat(int(peer), &actual) != nil {
			inner = errPaneInputPTY
			return
		}
		if err := w.slaveRaw.Control(func(slave uintptr) {
			discipline, disciplineErr := unix.IoctlGetInt(int(slave), unix.TIOCGETD)
			if unix.Fstat(int(slave), &provided) != nil || provided.Mode&unix.S_IFMT != unix.S_IFCHR || actual.Dev != provided.Dev || actual.Ino != provided.Ino || actual.Rdev != provided.Rdev || disciplineErr != nil || discipline != panePTYNormalDiscipline {
				inner = errPaneInputPTY
			}
		}); err != nil {
			inner = errPaneInputPTY
		}
	})
	if err != nil || inner != nil {
		return errPaneInputPTY
	}
	return nil
}

// Used only by gate.forward. Wait for an already-started cancellation callback
// and clear its write deadline BEFORE returning: a late callback must not poison
// a subsequent new-epoch delivery or masquerade as a fresh transport failure.
func (w *panePTYInput) write(ctx context.Context, data []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if ctx == nil || ctx.Err() != nil {
		return 0, errPaneInputPTY
	}
	if err := w.verifyPair(); err != nil {
		return 0, err
	}
	stopped := make(chan struct{})
	stop := context.AfterFunc(ctx, func() {
		w.master.SetWriteDeadline(time.Now())
		close(stopped)
	})
	n, err := w.master.Write(data)
	if !stop() {
		<-stopped
	}
	if w.master.SetWriteDeadline(time.Time{}) != nil || ctx.Err() != nil || err != nil {
		return n, errPaneInputPTY
	}
	return n, nil
}

// Requires the current local drain AND a separately verified native all-writer
// freeze/closed-admission barrier. This method proves only this pinned PTY's
// kernel input discard. It must not be used on a still-running workload.
func (w *panePTYInput) discardKernelInput(drain *paneInputDrain) error {
	g := w.gate
	g.mu.Lock()
	if !g.held || drain == nil || g.drain != drain || drain.gate != g || drain.revision != g.revision || g.discarding || g.faulted {
		g.mu.Unlock()
		return errPaneInputBarrier
	}
	select {
	case <-drain.done:
	default:
		g.mu.Unlock()
		return errPaneInputBarrier
	}
	g.discarding = true
	g.mu.Unlock()
	// No native state/controller mutex is held over ioctl or IO. Arming refuses
	// while discard is in progress, including when a kernel operation stalls.
	w.mu.Lock()
	err := w.verifyPair()
	if err == nil {
		var inner error
		err = w.slaveRaw.Control(func(fd uintptr) {
			inner = unix.IoctlSetInt(int(fd), unix.TCFLSH, unix.TCIFLUSH)
			if inner == nil {
				var waiting int
				waiting, inner = unix.IoctlGetInt(int(fd), unix.TIOCINQ)
				if waiting != 0 {
					inner = errPaneInputPTY
				}
			}
		})
		if inner != nil {
			err = inner
		}
	}
	w.mu.Unlock()
	g.mu.Lock()
	g.discarding = false
	if err != nil {
		// A failed discard is never eligible for local arm, even if a caller
		// incorrectly ignores the returned error. Native recovery must inspect it.
		g.faulted = true
	}
	g.mu.Unlock()
	if err != nil {
		return errPaneInputPTY
	}
	return nil
}
