package core

// Runtime callers: the live attempt authority publishes verified cutoffs, and
// the existing independent watchdog observes/revokes that SAME word. A stale
// disk lease or timer cannot overwrite a newer accepted live renewal.

import (
	"bytes"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"sync"
	"sync/atomic"
	"unsafe"

	"golang.org/x/sys/unix"
)

const monitoringCutoffBytes = 4096
const monitoringCutoffSeals = unix.F_SEAL_GROW | unix.F_SEAL_SHRINK | unix.F_SEAL_SEAL

var errMonitoringCutoff = errors.New("current root monitoring cutoff is unavailable or replaced; no permission or student violation inferred")

type monitoringCutoffDescriptor struct {
	Version        int             `json:"version"`
	Owner          monitoringOwner `json:"owner"`
	DeadlineBootMS int64           `json:"deadline_boot_ms"`
	SupervisorPID  int             `json:"supervisor_pid"`
}

type monitoringSharedCutoff struct {
	mu       sync.RWMutex // Mapping lifetime only; never held over disk/network IO.
	file     *os.File
	page     []byte
	word     *atomic.Uint64
	owner    monitoringOwner
	deadline int64
	closed   bool
	owned    bool
}

func monitoringCutoffOwnerHash(owner monitoringOwner) []byte {
	data, _ := json.Marshal(owner)
	digest, _ := hex.DecodeString(Hash(data))
	return digest
}

func newMonitoringSharedCutoff(owner monitoringOwner, until, deadline int64) (*monitoringSharedCutoff, error) {
	if !validMonitoringOwner(owner) || until < 0 || deadline < until || (until == 0) != (deadline == 0) {
		return nil, errMonitoringCutoff
	}
	fd, err := unix.MemfdCreate("exam-live-cutoff-v1", unix.MFD_CLOEXEC|unix.MFD_ALLOW_SEALING)
	if err != nil {
		return nil, err
	}
	f := os.NewFile(uintptr(fd), "owned-live-cutoff")
	if err := f.Chmod(0600); err != nil {
		f.Close()
		return nil, err
	}
	if err := f.Truncate(monitoringCutoffBytes); err != nil {
		f.Close()
		return nil, err
	}
	if _, err := unix.FcntlInt(f.Fd(), unix.F_ADD_SEALS, monitoringCutoffSeals); err != nil {
		f.Close()
		return nil, err
	}
	page, err := unix.Mmap(fd, 0, monitoringCutoffBytes, unix.PROT_READ|unix.PROT_WRITE, unix.MAP_SHARED)
	if err != nil {
		f.Close()
		return nil, err
	}
	copy(page[16:24], "EXCUT001")
	binary.LittleEndian.PutUint64(page[8:16], uint64(deadline))
	copy(page[24:56], monitoringCutoffOwnerHash(owner))
	s := &monitoringSharedCutoff{file: f, page: page, word: (*atomic.Uint64)(unsafe.Pointer(&page[0])), owner: owner, deadline: deadline, owned: true}
	s.word.Store(uint64(until)) // Fault/touch RAM before exposing this live context.
	return s, nil
}

func importMonitoringSharedCutoff(f *os.File, descriptor monitoringCutoffDescriptor) (*monitoringSharedCutoff, error) {
	if f == nil || descriptor.Version != 1 || !validMonitoringOwner(descriptor.Owner) || descriptor.DeadlineBootMS <= 0 || descriptor.SupervisorPID <= 1 {
		return nil, errMonitoringCutoff
	}
	info, err := f.Stat()
	seals, sealErr := unix.FcntlInt(f.Fd(), unix.F_GET_SEALS, 0)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || info.Size() != monitoringCutoffBytes || sealErr != nil || seals&monitoringCutoffSeals != monitoringCutoffSeals {
		return nil, errMonitoringCutoff
	}
	page, err := unix.Mmap(int(f.Fd()), 0, monitoringCutoffBytes, unix.PROT_READ|unix.PROT_WRITE, unix.MAP_SHARED)
	if err != nil {
		return nil, err
	}
	if string(page[16:24]) != "EXCUT001" || binary.LittleEndian.Uint64(page[8:16]) != uint64(descriptor.DeadlineBootMS) || !bytes.Equal(page[24:56], monitoringCutoffOwnerHash(descriptor.Owner)) {
		unix.Munmap(page)
		return nil, errMonitoringCutoff
	}
	return &monitoringSharedCutoff{file: f, page: page, word: (*atomic.Uint64)(unsafe.Pointer(&page[0])), owner: descriptor.Owner, deadline: descriptor.DeadlineBootMS}, nil
}

func (s *monitoringSharedCutoff) close() {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return
	}
	s.closed = true
	if s.owned {
		s.word.Store(0)
	} // Retiring a watchdog's mapping never revokes its live owner.
	_ = unix.Munmap(s.page)
	_ = s.file.Close()
}

func (s *monitoringSharedCutoff) initialize(until, deadline int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || !s.owned || until <= 0 || deadline < until {
		return errMonitoringCutoff
	}
	if s.deadline != 0 {
		if s.deadline == deadline && s.word.Load() == uint64(until) {
			return nil
		}
		return errMonitoringCutoff
	}
	s.deadline = deadline
	binary.LittleEndian.PutUint64(s.page[8:16], uint64(deadline))
	s.word.Store(uint64(until))
	return nil
}

func (s *monitoringSharedCutoff) until() int64 {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.closed {
		return 0
	}
	value := s.word.Load()
	if value > uint64(s.deadline) {
		return 0
	}
	return int64(value)
}

func (s *monitoringSharedCutoff) revoke() {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if !s.closed {
		s.word.Store(0)
	}
}

// Only the verified authority calls publish, under its existing memory mutex.
// Expiry is a competing CAS: an old observer cannot zero a newer live cutoff.
func (s *monitoringSharedCutoff) publish(previous, until int64) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return !s.closed && previous > 0 && until >= previous && until <= s.deadline && s.word.CompareAndSwap(uint64(previous), uint64(until))
}

func (s *monitoringSharedCutoff) expire(now int64) (int64, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.closed || now < 0 {
		return 0, false
	}
	for {
		value := s.word.Load()
		if value == 0 {
			return 0, true
		}
		if value > uint64(s.deadline) {
			return 0, false
		}
		if uint64(now) < value {
			return int64(value), false
		}
		if s.word.CompareAndSwap(value, 0) {
			return 0, true
		}
	}
}

func (s *monitoringSharedCutoff) descriptor() (*os.File, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.closed {
		return nil, errMonitoringCutoff
	}
	fd, err := unix.FcntlInt(s.file.Fd(), unix.F_DUPFD_CLOEXEC, 3)
	if err != nil {
		return nil, err
	}
	return os.NewFile(uintptr(fd), "shared-live-cutoff"), nil
}
