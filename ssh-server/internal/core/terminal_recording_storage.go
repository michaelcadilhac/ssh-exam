package core

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
)

// Runtime caller: timed terminal handoff sends these three scoped descriptors,
// not an Engine/configuration/key. The owner retains one storage set per attempt.
func terminalRecordingResources(state, id string) ([]*os.File, error) {
	if !attemptID.MatchString(id) {
		return nil, errTerminalSupervisor
	}
	root, err := readOnlyRoot(state)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	monitoring, err := templateEnsureDirectory(root, "monitoring")
	if err != nil {
		return nil, err
	}
	defer monitoring.Close()
	dir, err := templateEnsureDirectory(monitoring, id)
	if err != nil {
		return nil, err
	}
	failed := true
	files := []*os.File{dir}
	defer func() {
		if failed {
			for _, f := range files {
				f.Close()
			}
		}
	}()
	fd, err := unix.Openat(int(monitoring.Fd()), id+".lock", unix.O_RDWR|unix.O_CREAT|unix.O_NONBLOCK|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0600)
	if err != nil {
		return nil, err
	}
	quota := os.NewFile(uintptr(fd), "attempt-recording-quota")
	files = append(files, quota)
	if err := privateRecordingFile(quota); err != nil {
		return nil, err
	}
	supervisors, err := terminalSupervisorDirectory(state)
	if err != nil {
		return nil, err
	}
	defer supervisors.Close()
	reports, err := templateEnsureDirectory(supervisors, id)
	if err != nil {
		return nil, err
	}
	files = append(files, reports)
	failed = false
	return files, nil
}

func privateRecordingFile(file *os.File) error {
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || info.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) || info.Sys().(*syscall.Stat_t).Nlink != 1 {
		return errors.New("private recording file unsafe; preserve storage and inspect native pane status")
	}
	return nil
}

type supervisedRecordingStorage struct {
	mu                  sync.Mutex
	dir, quota, reports *os.File
	state, id           string
	limit               int64
}

func newSupervisedRecordingStorage(state, id string, limit int64, resources []*os.File) (*supervisedRecordingStorage, error) {
	if len(resources) != 3 || limit <= 0 || !attemptID.MatchString(id) || readOnlyPrivateDir(resources[0]) != nil || privateRecordingFile(resources[1]) != nil || readOnlyPrivateDir(resources[2]) != nil {
		return nil, errTerminalSupervisor
	}
	s := &supervisedRecordingStorage{state: state, id: id, limit: limit}
	var files []*os.File
	for _, source := range resources {
		fd, err := unix.FcntlInt(source.Fd(), unix.F_DUPFD_CLOEXEC, 3)
		if err != nil {
			for _, file := range files {
				file.Close()
			}
			return nil, err
		}
		files = append(files, os.NewFile(uintptr(fd), "scoped-recording-storage"))
	}
	s.dir, s.quota, s.reports = files[0], files[1], files[2]
	if err := s.current(); err != nil {
		s.close()
		return nil, err
	}
	return s, nil
}

func (s *supervisedRecordingStorage) close() {
	for _, f := range []*os.File{s.dir, s.quota, s.reports} {
		if f != nil {
			f.Close()
		}
	}
}

func (s *supervisedRecordingStorage) current() error {
	for _, item := range []struct {
		file *os.File
		path string
	}{{s.dir, filepath.Join(s.state, "monitoring", s.id)},
		{s.quota, filepath.Join(s.state, "monitoring", s.id+".lock")},
		{s.reports, filepath.Join(s.state, "terminal-supervisors", s.id)}} {
		pinned, err := item.file.Stat()
		if err != nil {
			return err
		}
		current, err := os.Lstat(item.path)
		if err != nil || current.Mode()&os.ModeSymlink != 0 || !os.SameFile(pinned, current) {
			return errors.New("recording storage changed; preserve original handles and inspect native pane status")
		}
	}
	return nil
}

func (s *supervisedRecordingStorage) newRecorder(pane, instance string) (*terminalRecorder, error) {
	digest, digestErr := hex.DecodeString(instance)
	if !attemptID.MatchString(pane) || digestErr != nil || len(digest) != 32 || hex.EncodeToString(digest) != instance {
		return nil, errTerminalSupervisor
	}
	if err := s.current(); err != nil {
		return nil, err
	}
	fd, err := unix.Openat(int(s.dir.Fd()), pane+".ndjson", unix.O_RDWR|unix.O_APPEND|unix.O_CREAT|unix.O_NONBLOCK|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0600)
	if err != nil {
		return nil, err
	}
	file := os.NewFile(uintptr(fd), "owned-terminal-recording")
	if err := privateRecordingFile(file); err != nil {
		file.Close()
		return nil, err
	}
	r := &terminalRecorder{limit: s.limit, file: file, id: s.id, pane: pane, started: time.Now(), storage: s, instance: instance}
	info, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, err
	}
	r.committed.Store(info.Size())
	if err := r.record(map[string]any{"event": "open"}); err != nil {
		file.Close()
		return nil, err
	}
	if err := s.dir.Sync(); err != nil {
		file.Close()
		return nil, err
	}
	return r, nil
}

func (s *supervisedRecordingStorage) record(r *terminalRecorder, value map[string]any) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.current(); err != nil {
		return err
	}
	if err := privateRecordingFile(r.file); err != nil {
		return err
	}
	for {
		err := unix.Flock(int(s.quota.Fd()), unix.LOCK_EX|unix.LOCK_NB)
		if err == nil {
			break
		}
		if err != unix.EINTR && err != unix.EAGAIN {
			return err
		}
		time.Sleep(10 * time.Millisecond)
	}
	defer unix.Flock(int(s.quota.Fd()), unix.LOCK_UN)
	// Open another directory description, not Dup's shared readdir offset.
	dir, err := os.Open(fmt.Sprintf("/proc/self/fd/%d", s.dir.Fd()))
	if err != nil {
		return err
	}
	entries, err := dir.ReadDir(-1)
	dir.Close()
	if err != nil {
		return err
	}
	var total int64
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			return err
		}
		total += info.Size()
	}
	value["at"], value["monotonic_ms"], value["source"] = Millis(), time.Since(r.started).Milliseconds(), "class-agent"
	value["recording_instance"] = r.instance
	line, err := json.Marshal(value)
	if err != nil {
		return err
	}
	line = append(line, '\n')
	if total+int64(len(line)) > s.limit {
		return errors.New("terminal recording limit reached")
	}
	if n, err := r.file.Write(line); err != nil || n != len(line) {
		return errors.New("terminal recording append incomplete")
	}
	if err := r.file.Sync(); err != nil {
		return err
	}
	r.committed.Add(int64(len(line)))
	return nil
}
