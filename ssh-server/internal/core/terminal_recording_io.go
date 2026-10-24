package core

// C12b runtime caller: terminalSupervisor.attach for a timed pane. Keep PTY
// lifetime/recording here and canonical fault decisions in the coordinator.
import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"os"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
)

type supervisedRecordingResult struct {
	RecordingComplete bool
	DeliveryComplete  bool
	Fault             string
	FaultStage        string
}

type supervisedRecordingIO struct {
	inputEpoch                      string // Immutable pane-incarnation fence, not monitoring authority.
	inputSequence                   uint64 // Owned only by the input decoder goroutine.
	resizes                         chan supervisedResize
	inputGate, resizeGate           *paneInputGate
	inputPTY                        *panePTYInput
	inputSlave                      *os.File
	inputScope                      atomic.Pointer[supervisedInputScope]
	currentAuthority                atomic.Pointer[monitoringAuthority]
	discardedInput, discardedResize atomic.Uint64
	recorder                        *terminalRecorder
	original, master                *os.File
	originalFD, masterFD            int
	inputEnded                      chan struct{}
	stopInput                       chan struct{}
	inputDone                       chan struct{}
	resizeDone                      chan struct{}
	outputDone                      chan struct{}
	deliveryDone                    chan struct{}
	deliveryOffset                  int64
	stopOnce, endOnce               sync.Once
	faultOnce                       sync.Once
	mu                              sync.Mutex
	fault                           string
	faultStage                      string
	forwardUntil                    atomic.Int64
	deliveryComplete                atomic.Bool
	onFault                         func()
}

type supervisedResize struct {
	size  windowSize
	frame framedInput
}
type supervisedInputScope struct{ epoch string }

func recordingPTYCopy(f *os.File) (*os.File, error) {
	if f == nil {
		return nil, errors.New("recording PTY unavailable")
	}
	fd, err := unix.FcntlInt(f.Fd(), unix.F_DUPFD_CLOEXEC, 3)
	if err != nil {
		return nil, err
	}
	if err := unix.SetNonblock(fd, true); err != nil {
		unix.Close(fd)
		return nil, err
	}
	return os.NewFile(uintptr(fd), "owned-recording-pty"), nil
}

func recordingPoll(fd int, events int16) error {
	items := []unix.PollFd{{Fd: int32(fd), Events: events}}
	_, err := unix.Poll(items, 50)
	if errors.Is(err, unix.EINTR) {
		return nil
	}
	if err == nil && items[0].Revents&unix.POLLNVAL != 0 {
		return errors.New("recording descriptor changed")
	}
	return err
}

func newSupervisedRecordingIO(r *terminalRecorder, original, master *os.File, inputEpoch string, onFault func(), live ...*monitoringAuthority) (*supervisedRecordingIO, error) {
	if r == nil || onFault == nil || (inputEpoch != "" && !monitoringDigest.MatchString(inputEpoch)) {
		return nil, errors.New("recording setup incomplete")
	}
	input, err := recordingPTYCopy(original)
	if err != nil {
		return nil, err
	}
	output, err := recordingPTYCopy(master)
	if err != nil {
		input.Close()
		return nil, err
	}
	s := &supervisedRecordingIO{recorder: r, original: input, master: output,
		inputEpoch: inputEpoch, resizes: make(chan supervisedResize, 1),
		inputEnded: make(chan struct{}), stopInput: make(chan struct{}),
		inputDone: make(chan struct{}), resizeDone: make(chan struct{}), outputDone: make(chan struct{}), deliveryDone: make(chan struct{}), deliveryOffset: r.committed.Load(), onFault: onFault}
	s.originalFD, s.masterFD = int(input.Fd()), int(output.Fd())
	if unix.SetNonblock(s.originalFD, true) != nil || unix.SetNonblock(s.masterFD, true) != nil {
		input.Close()
		output.Close()
		return nil, errors.New("recording PTYs cannot be made cancellable")
	}
	if len(live) != 0 {
		if len(live) != 1 || live[0] == nil || inputEpoch == "" {
			input.Close()
			output.Close()
			return nil, errMonitoringScope
		}
		authority := live[0]
		s.currentAuthority.Store(authority)
		view := authority.check()
		if !view.ExecutionAuthorized {
			input.Close()
			output.Close()
			return nil, errMonitoringAuthority
		}
		s.inputGate, err = newPaneInputGate(r.pane, monitoringBootMillis)
		if err == nil {
			s.resizeGate, err = newPaneInputGate(r.pane, monitoringBootMillis)
		}
		if err == nil {
			err = s.inputGate.arm(s.inputGate.revoke(), inputEpoch, view.AuthorityUntilMS, view.DeadlineUptimeMS)
		}
		if err == nil {
			err = s.resizeGate.arm(s.resizeGate.revoke(), inputEpoch, view.AuthorityUntilMS, view.DeadlineUptimeMS)
		}
		if err == nil {
			for _, gate := range []*paneInputGate{s.inputGate, s.resizeGate} {
				gate.live = func() (int64, int64, bool) {
					v := s.currentAuthority.Load().check()
					return v.AuthorityUntilMS, v.DeadlineUptimeMS, v.ExecutionAuthorized
				}
			}
			var fd uintptr
			var errno syscall.Errno
			fd, _, errno = unix.Syscall(unix.SYS_IOCTL, uintptr(s.masterFD), uintptr(unix.TIOCGPTPEER), uintptr(unix.O_RDWR|unix.O_NOCTTY|unix.O_CLOEXEC|unix.O_NONBLOCK))
			if errno != 0 {
				err = errPaneInputPTY
			} else {
				s.inputSlave = os.NewFile(fd, "owned-input-peer")
				s.inputPTY, err = newPanePTYInput(s.inputGate, output, s.inputSlave)
			}
		}
		if err != nil {
			if s.inputSlave != nil {
				s.inputSlave.Close()
			}
			input.Close()
			output.Close()
			return nil, err
		}
	}
	s.inputScope.Store(&supervisedInputScope{epoch: inputEpoch})
	s.deliveryComplete.Store(true)
	go s.input()
	go s.output()
	go s.deliver()
	go s.resize()
	return s, nil
}

func (s *supervisedRecordingIO) cancelInput() { s.stopOnce.Do(func() { close(s.stopInput) }) }

func (s *supervisedRecordingIO) failed(stage string) {
	s.faultOnce.Do(func() {
		s.mu.Lock()
		s.fault = "recording_io"
		s.faultStage = stage
		s.mu.Unlock()
		s.cancelInput()
		// The caller contains this attempt's owned scopes BEFORE potentially
		// blocking report publication. No global Engine or signing key is here.
		s.onFault()
	})
}

func (s *supervisedRecordingIO) input() {
	defer close(s.inputDone)
	defer close(s.inputEnded)
	if s.inputEpoch != "" {
		s.framedInput()
		return
	}
	buffer := make([]byte, 32*1024)
	for {
		select {
		case <-s.stopInput:
			return
		default:
		}
		n, err := unix.Read(s.originalFD, buffer)
		if n > 0 {
			for at := 0; at < n; {
				select {
				case <-s.stopInput:
					return
				default:
				}
				written, writeErr := unix.Write(s.masterFD, buffer[at:n])
				if written > 0 {
					at += written
				}
				if writeErr == nil {
					continue
				}
				if writeErr != unix.EINTR && writeErr != unix.EAGAIN {
					return
				}
				if recordingPoll(s.masterFD, unix.POLLOUT) != nil {
					return
				}
			}
		}
		if err == unix.EINTR {
			continue
		}
		if err == unix.EAGAIN {
			if recordingPoll(s.originalFD, unix.POLLIN) == nil {
				continue
			}
		}
		if err != nil || n == 0 {
			return
		}
	}
}

// Only the explicit signed framed admission reaches this decoder. It fences
// pane incarnation/sequence, not live monitoring or the future C3 held state.
// Legacy cutoff/policy enforcement remains unchanged until that full workflow.
func (s *supervisedRecordingIO) framedInput() {
	reader := supervisedFrameReader{s}
	var previous *supervisedInputScope
	for {
		frame, err := readFramedInput(reader)
		if err != nil {
			return // No malformed body is reinterpreted as terminal bytes.
		}
		scope := s.inputScope.Load()
		if scope != previous {
			s.inputSequence, previous = 0, scope
		}
		if scope == nil || frame.Epoch != scope.epoch || frame.Pane != s.recorder.pane || frame.Sequence <= s.inputSequence {
			continue // Captured stale input is discarded, never relabelled.
		}
		s.inputSequence = frame.Sequence // Consume before any partial delivery.
		if frame.Kind == 1 {
			size := windowSize{Row: uint16(binary.BigEndian.Uint32(frame.Data)), Col: uint16(binary.BigEndian.Uint32(frame.Data[4:]))}
			resize := supervisedResize{size: size, frame: frame}
			// Existing resize sampling already coalesces intermediate sizes.
			// Preserve record-before-apply in its independent storage worker;
			// the decoder/next key never waits for a recorder's disk lock.
			select {
			case s.resizes <- resize:
			default:
				select {
				case <-s.resizes:
				default:
				}
				select {
				case s.resizes <- resize:
				default:
				}
			}
			continue
		}
		if s.inputGate != nil {
			if _, err := s.inputGate.forward(frame, s.inputPTY.write); err != nil {
				s.discardedInput.Store(frame.Sequence)
			}
			continue // A held gate discards input while keeping the decoder/SSH alive.
		}
		for at := 0; at < len(frame.Data); {
			select {
			case <-s.stopInput:
				return
			default:
			}
			n, writeErr := unix.Write(s.masterFD, frame.Data[at:])
			if n > 0 {
				at += n
			}
			if writeErr == nil {
				continue
			}
			if writeErr != unix.EAGAIN && writeErr != unix.EINTR {
				return
			}
			if recordingPoll(s.masterFD, unix.POLLOUT) != nil {
				return
			}
		}
	}
}

type supervisedFrameReader struct{ stream *supervisedRecordingIO }

func (r supervisedFrameReader) Read(p []byte) (int, error) {
	for {
		select {
		case <-r.stream.stopInput:
			return 0, io.EOF
		default:
		}
		n, err := unix.Read(r.stream.originalFD, p)
		if n > 0 {
			return n, nil
		}
		if err == unix.EINTR {
			continue
		}
		if err == unix.EAGAIN {
			if err = recordingPoll(r.stream.originalFD, unix.POLLIN); err == nil {
				continue
			}
		}
		if err != nil {
			return 0, err
		}
		return 0, io.EOF
	}
}

func (s *supervisedRecordingIO) forward(data []byte) {
	if !s.deliveryComplete.Load() {
		return
	}
	for len(data) > 0 {
		until := s.forwardUntil.Load()
		if until > 0 && time.Since(s.recorder.started).Nanoseconds() >= until {
			s.deliveryComplete.Store(false)
			return
		}
		n, err := unix.Write(s.originalFD, data)
		if n > 0 {
			data = data[n:]
		}
		if err == nil {
			continue
		}
		if err != unix.EINTR && err != unix.EAGAIN {
			s.deliveryComplete.Store(false)
			return
		}
		if recordingPoll(s.originalFD, unix.POLLOUT) != nil {
			s.deliveryComplete.Store(false)
			return
		}
	}
}

func (s *supervisedRecordingIO) output() {
	defer close(s.outputDone)
	buffer := make([]byte, 32*1024)
	writer := recordedWriter{s.recorder, io.Discard, "output", func() { s.failed("capture") }}
	for {
		n, err := unix.Read(s.masterFD, buffer)
		if n > 0 {
			if _, err := writer.Write(buffer[:n]); err != nil {
				return
			}
			// Delivery reads only the synced prefix in its own bounded loop.
			// Slow display cannot block capture or prevent the shell from exiting.
		}
		if err == unix.EINTR {
			continue
		}
		if err == unix.EAGAIN {
			if recordingPoll(s.masterFD, unix.POLLIN) == nil {
				continue
			}
		}
		if err != nil || n == 0 {
			if err != nil && err != unix.EIO {
				s.failed("capture_read")
			}
			return
		}
	}
}

func (s *supervisedRecordingIO) deliver() {
	defer close(s.deliveryDone)
	buffer := make([]byte, 64*1024)
	for {
		remaining := s.recorder.committed.Load() - s.deliveryOffset
		if remaining > 0 {
			n, err := s.recorder.file.ReadAt(buffer[:min(int64(len(buffer)), remaining)], s.deliveryOffset)
			if err != nil && err != io.EOF {
				s.failed("delivery_read")
				return
			}
			end := bytes.IndexByte(buffer[:n], '\n')
			if end < 0 {
				s.failed("delivery_frame")
				return
			}
			var event struct {
				Event    string `json:"event"`
				Data     string `json:"data"`
				Instance string `json:"recording_instance"`
			}
			if json.Unmarshal(buffer[:end], &event) != nil || event.Instance != s.recorder.instance {
				s.failed("delivery_context")
				return
			}
			s.deliveryOffset += int64(end + 1)
			if event.Event == "output" {
				decoded, err := base64.StdEncoding.DecodeString(event.Data)
				if err != nil {
					s.failed("delivery_data")
					return
				}
				s.forward(decoded)
				if !s.deliveryComplete.Load() {
					return
				}
			}
			continue
		}
		select {
		case <-s.outputDone:
			// Output can commit between the empty-prefix observation above and
			// this receive. Recheck before claiming complete display delivery.
			if s.deliveryOffset == s.recorder.committed.Load() {
				return
			}
		case <-time.After(20 * time.Millisecond):
		}
	}
}

func (s *supervisedRecordingIO) resize() {
	defer close(s.resizeDone)
	if s.inputEpoch != "" {
		for {
			select {
			case <-s.stopInput:
				return
			case resize := <-s.resizes:
				size := resize.size
				if s.recorder.record(map[string]any{"event": "resize", "rows": size.Row, "cols": size.Col}) != nil {
					s.failed("resize")
					return
				}
				select {
				case <-s.stopInput:
					return // Late storage completion cannot apply a retired resize.
				default:
				}
				if s.resizeGate != nil {
					frame := resize.frame
					frame.Kind = 0 // Same captured scope/sequence; apply only inside its gate.
					_, err := s.resizeGate.forward(frame, func(ctx context.Context, data []byte) (int, error) {
						if ctx.Err() != nil {
							return 0, ctx.Err()
						}
						if err := ioctl(uintptr(s.masterFD), syscall.TIOCSWINSZ, unsafePointer(&size)); err != nil {
							return 0, err
						}
						return len(data), nil
					})
					if err != nil {
						s.discardedResize.Store(frame.Sequence)
					}
					continue
				}
				if ioctl(uintptr(s.masterFD), syscall.TIOCSWINSZ, unsafePointer(&size)) != nil {
					return
				}
			}
		}
	}
	timer := time.NewTicker(100 * time.Millisecond)
	defer timer.Stop()
	var last windowSize
	for {
		select {
		case <-s.stopInput:
			return
		case <-timer.C:
			var size windowSize
			if ioctl(uintptr(s.originalFD), syscall.TIOCGWINSZ, unsafePointer(&size)) == nil && size.Row > 1 && size.Col > 1 && size != last {
				if s.recorder.record(map[string]any{"event": "resize", "rows": size.Row, "cols": size.Col}) != nil {
					s.failed("resize")
					return
				}
				ioctl(uintptr(s.masterFD), syscall.TIOCSWINSZ, unsafePointer(&size))
				last = size
			}
		}
	}
}

// Caller has positively ended/contained its exact scope first. Stop input and
// resize independently; drain trusted output, then durably close the log. File
// descriptors stay owned until all their users stop, so no stale numeric FD can
// alias a later pane. Storage IO may remain pending; it is not fake completion.
func (s *supervisedRecordingIO) finish() supervisedRecordingResult {
	s.endOnce.Do(func() {
		s.cancelInput()
		s.forwardUntil.Store(time.Since(s.recorder.started).Nanoseconds() + int64(2*time.Second))
	})
	<-s.inputDone
	<-s.resizeDone
	// The queue-discard peer is a real slave reference. Close it after its
	// final input user, before waiting for master EOF/output drain.
	if s.inputSlave != nil {
		s.inputSlave.Close()
	}
	<-s.outputDone
	<-s.deliveryDone
	s.original.Close()
	s.master.Close()
	s.mu.Lock()
	complete := s.fault == ""
	s.mu.Unlock()
	if s.recorder.record(map[string]any{"event": "close", "recording_complete": complete, "cleanup_complete": true, "delivery_complete": s.deliveryComplete.Load()}) != nil {
		s.failed("close")
	}
	if s.recorder.file.Close() != nil {
		s.failed("descriptor_close")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return supervisedRecordingResult{RecordingComplete: s.fault == "", DeliveryComplete: s.deliveryComplete.Load(), Fault: s.fault, FaultStage: s.faultStage}
}
