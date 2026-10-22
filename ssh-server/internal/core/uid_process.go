package core

// A leader in State Z can still own live threads and writable descriptors.
// Keep the process pidfd (not PIDFD_THREAD) from observation through signalling.
// These observations do not close admission or prove an entire UID is quiescent.
import (
	"errors"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"

	"golang.org/x/sys/unix"
)

type uidProcess struct {
	pid    int
	handle *os.File
	proc   *os.File
}

// Readiness probes only this process. Signal 0 delivers NO signal; it checks
// that the required pinned-signal syscall is allowed, not merely pidfd_open.
func writerProcessLifetimeReady() error {
	p, err := pinUIDProcess(os.Getpid(), os.Geteuid())
	if err == nil && p != nil {
		defer p.close()
		err = p.control(func(fd int) error { return unix.PidfdSendSignal(fd, 0, nil, 0) })
		if live, lifetimeErr := p.live(); lifetimeErr != nil || !live {
			err = errors.New("own process lifetime unverified")
		}
	} else if err == nil {
		err = errors.New("own process lifetime unavailable")
	}
	if err != nil {
		return fmt.Errorf("kernel process-lifetime isolation unavailable: %w; require working Linux pidfd_open/poll/pidfd_send_signal (Linux 5.3 or newer) and procfs in the agent security policy; repair and rerun examctl health in drained maintenance, never fall back to numeric PID signals", err)
	}
	return nil
}

func (p *uidProcess) close() {
	if p.proc != nil {
		_ = p.proc.Close()
	}
	if p.handle != nil {
		_ = p.handle.Close()
	}
}

// os.File's RawConn holds the descriptor across poll/signal, including a
// concurrent Close. Never fall back to kill(numericPID) on an unsupported kernel.
func (p *uidProcess) control(fn func(int) error) error {
	if p == nil || p.handle == nil {
		return errors.New("process lifetime handle unavailable")
	}
	raw, err := p.handle.SyscallConn()
	if err != nil {
		return err
	}
	var inner error
	if err := raw.Control(func(fd uintptr) { inner = fn(int(fd)) }); err != nil {
		return err
	}
	return inner
}

func (p *uidProcess) live() (bool, error) {
	var events int16
	err := p.control(func(fd int) error {
		fds := []unix.PollFd{{Fd: int32(fd), Events: unix.POLLIN}}
		var err error
		for n := 0; n < 4; n++ {
			_, err = unix.Poll(fds, 0)
			if !errors.Is(err, unix.EINTR) {
				break
			}
		}
		events = fds[0].Revents
		return err
	})
	if err != nil || events & ^int16(unix.POLLIN|unix.POLLHUP) != 0 {
		return false, errors.New("process lifetime unverified; writer isolation cannot be confirmed")
	}
	return events == 0, nil
}

func (p *uidProcess) read(name string, limit int64) ([]byte, error) {
	if p == nil || p.proc == nil || (name != "status" && name != "cgroup") {
		return nil, errors.New("process observation unavailable")
	}
	raw, err := p.proc.SyscallConn()
	if err != nil {
		return nil, err
	}
	var fd int
	var inner error
	err = raw.Control(func(parent uintptr) {
		fd, inner = unix.Openat(int(parent), name, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	})
	if err != nil {
		return nil, err
	}
	if inner != nil {
		return nil, inner
	}
	f := os.NewFile(uintptr(fd), "pinned-process-"+name)
	data, err := io.ReadAll(io.LimitReader(f, limit+1))
	closed := f.Close()
	if err != nil {
		return nil, err
	}
	if closed != nil {
		return nil, closed
	}
	if int64(len(data)) > limit {
		return nil, errors.New("process observation exceeds safe bound")
	}
	return data, nil
}

func statusHasUID(status []byte, uid int) (bool, error) {
	found, owns := false, false
	for _, line := range strings.Split(string(status), "\n") {
		if !strings.HasPrefix(line, "Uid:") {
			continue
		}
		values := strings.Fields(strings.TrimPrefix(line, "Uid:"))
		if found || len(values) != 4 {
			return false, errors.New("process UID observation malformed")
		}
		found = true
		for _, value := range values {
			n, err := strconv.ParseUint(value, 10, 32)
			if err != nil {
				return false, errors.New("process UID observation malformed")
			}
			owns = owns || n == uint64(uid)
		}
	}
	if !found {
		return false, errors.New("process UID observation unavailable")
	}
	return owns, nil
}

// Open the kernel handle BEFORE proc metadata. If the numeric PID is reused
// before/while opening proc, final pidfd exit observation rejects the new view.
func pinUIDProcess(pid, uid int) (*uidProcess, error) {
	fd, err := unix.PidfdOpen(pid, 0)
	if errors.Is(err, unix.ESRCH) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("pin process lifetime for writer isolation: %w", err)
	}
	p := &uidProcess{pid: pid, handle: os.NewFile(uintptr(fd), "writer-process-lifetime")}
	keep := false
	defer func() {
		if !keep {
			p.close()
		}
	}()
	fd, err = unix.Open("/proc/"+strconv.Itoa(pid), unix.O_PATH|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err == nil {
		p.proc = os.NewFile(uintptr(fd), "writer-process-view")
	}
	var data []byte
	if err == nil {
		data, err = p.read("status", 16384)
	}
	live, lifetimeErr := p.live()
	if lifetimeErr != nil {
		return nil, lifetimeErr
	}
	if !live {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("live process UID unavailable; writer isolation unverified: %w", err)
	}
	owns, err := statusHasUID(data, uid)
	if err != nil || !owns {
		return nil, err
	}
	keep = true
	return p, nil
}

func closeUIDProcesses(processes []*uidProcess) {
	for _, p := range processes {
		p.close()
	}
}

// Include real/effective/saved/filesystem UIDs. A bounded failed observation is
// an isolation error, not 'no processes'. Callers must close every returned pin.
func pinUIDProcesses(uid int) ([]*uidProcess, error) {
	if uid < 0 || uint64(uid) > 4294967294 {
		return nil, errors.New("invalid writer account UID")
	}
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return nil, err
	}
	var processes []*uidProcess
	for _, entry := range entries {
		pid, err := strconv.Atoi(entry.Name())
		if err != nil || pid < 1 {
			continue
		}
		p, err := pinUIDProcess(pid, uid)
		if err != nil {
			closeUIDProcesses(processes)
			return nil, err
		}
		if p != nil {
			processes = append(processes, p)
			if len(processes) > 4096 {
				closeUIDProcesses(processes)
				return nil, errors.New("writer process inventory exceeds safe bound; isolation unverified")
			}
		}
	}
	return processes, nil
}

// Recheck the pinned view immediately before signalling. No numeric PID is
// resolved again, even if the original process exited and its number was reused.
func (p *uidProcess) kill(uid int) error {
	data, readErr := p.read("status", 16384)
	live, err := p.live()
	if err != nil || !live {
		return err
	}
	if readErr != nil {
		return errors.New("live writer UID unavailable; no signal sent")
	}
	owns, err := statusHasUID(data, uid)
	if err != nil || !owns {
		return errors.New("writer UID changed or unverified; no signal sent")
	}
	err = p.control(func(fd int) error { return unix.PidfdSendSignal(fd, unix.SIGKILL, nil, 0) })
	if errors.Is(err, unix.ESRCH) {
		return nil
	}
	return err
}

// Read-only compatibility helper; mutation paths retain the returned handles.
func uidProcesses(uid int) ([]int, error) {
	processes, err := pinUIDProcesses(uid)
	if err != nil {
		return nil, err
	}
	defer closeUIDProcesses(processes)
	var pids []int
	for _, p := range processes {
		pids = append(pids, p.pid)
	}
	return pids, nil
}
