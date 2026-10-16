package core

import (
	"bufio"
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
)

const defaultTerminalRecordingLimitMiB int64 = 2048

func (e *Engine) terminalRecordingLimit() int64 {
	limit := e.Config.TerminalRecordingLimitMiB
	if limit == 0 {
		limit = defaultTerminalRecordingLimitMiB
	}
	return limit * 1024 * 1024
}

type terminalRecorder struct {
	e        *Engine
	mu       sync.Mutex
	file     *os.File
	id, pane string
	started  time.Time
}

func (e *Engine) newRecorder(id, pane string) (*terminalRecorder, error) {
	if !attemptID.MatchString(id) || !attemptID.MatchString(pane) {
		return nil, errors.New("invalid recording scope")
	}
	dir := filepath.Join(e.Config.State, "monitoring", id)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	file, err := os.OpenFile(filepath.Join(dir, pane+".ndjson"), os.O_CREATE|os.O_APPEND|os.O_WRONLY|syscall.O_NOFOLLOW, 0600)
	if err != nil {
		return nil, err
	}
	r := &terminalRecorder{e: e, file: file, id: id, pane: pane, started: time.Now()}
	if err := r.record(map[string]any{"event": "open"}); err != nil {
		file.Close()
		return nil, err
	}
	for _, directory := range []string{dir, filepath.Dir(dir), e.Config.State} {
		f, err := os.Open(directory)
		if err != nil {
			file.Close()
			return nil, err
		}
		err = f.Sync()
		f.Close()
		if err != nil {
			file.Close()
			return nil, err
		}
	}
	return r, nil
}
func (r *terminalRecorder) record(v map[string]any) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.e.monitorMu.Lock()
	defer r.e.monitorMu.Unlock()
	// Every pane has its own agent process: a process-local mutex alone cannot
	// enforce the shared quota. Keep this lock outside the delivered log tree.
	lock, err := os.OpenFile(filepath.Join(r.e.Config.State, "monitoring", r.id+".lock"), os.O_CREATE|os.O_RDWR|syscall.O_NOFOLLOW, 0600)
	if err != nil {
		return err
	}
	defer lock.Close()
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX); err != nil {
		return err
	}
	defer syscall.Flock(int(lock.Fd()), syscall.LOCK_UN)
	var total int64
	entries, err := os.ReadDir(filepath.Dir(r.file.Name()))
	if err != nil {
		return err
	}
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			return err
		}
		total += info.Size()
	}
	v["at"] = Millis()
	v["monotonic_ms"] = time.Since(r.started).Milliseconds()
	v["source"] = "class-agent"
	line, err := json.Marshal(v)
	if err != nil {
		return err
	}
	line = append(line, '\n')
	if total+int64(len(line)) > r.e.terminalRecordingLimit() {
		return errors.New("terminal recording limit reached")
	}
	if _, err = r.file.Write(line); err != nil {
		return err
	}
	return r.file.Sync()
}

type recordedWriter struct {
	r      *terminalRecorder
	target io.Writer
	event  string
	failed func()
}

func (w recordedWriter) Write(p []byte) (int, error) {
	if err := w.r.record(map[string]any{"event": w.event, "data": base64.StdEncoding.EncodeToString(p)}); err != nil {
		w.failed()
		return 0, err
	}
	return w.target.Write(p)
}
func (e *Engine) bridgeRecordedPTY(original, master *os.File, done <-chan struct{}, id, pane, unit string) error {
	r, err := e.newRecorder(id, pane)
	if err != nil {
		return err
	}
	failed := func() {
		master.Close()
		go func() {
			exec.Command("/usr/bin/systemctl", "kill", "--signal=KILL", unit).Run()
			e.WithState(func() error {
				_, err := e.callLocked("lock-attempt", Request{ID: id, Reason: "Class-server terminal recording failure"})
				return err
			})
		}()
	}
	var wg sync.WaitGroup
	// Preserve the existing privacy policy: record terminal output, not raw keys.
	wg.Go(func() { io.Copy(master, original); master.Close() })
	wg.Go(func() { io.Copy(recordedWriter{r, original, "output", failed}, master) })
	go func() {
		<-done
		master.Close()
		original.Close()
		wg.Wait()
		if err := r.record(map[string]any{"event": "close"}); err != nil {
			failed()
		}
		r.file.Close()
	}()
	go func() {
		timer := time.NewTicker(100 * time.Millisecond)
		defer timer.Stop()
		var last windowSize
		for {
			select {
			case <-done:
				return
			case <-timer.C:
				var size windowSize
				if ioctl(original.Fd(), syscall.TIOCGWINSZ, unsafePointer(&size)) == nil && size.Row > 1 && size.Col > 1 && size != last {
					if err := r.record(map[string]any{"event": "resize", "rows": size.Row, "cols": size.Col}); err != nil {
						failed()
						return
					}
					ioctl(master.Fd(), syscall.TIOCSWINSZ, unsafePointer(&size))
					last = size
				}
			}
		}
	}()
	return nil
}

// Push trusted recorded bytes only. Offsets are durable, deliveries idempotent;
// a browser neither supplies these bytes nor acknowledges their delivery.
func (e *Engine) deliverRecordings(client *http.Client, key ed25519.PrivateKey) error {
	var attempts []*Attempt
	if err := e.WithState(func() error {
		for _, a := range e.state.Attempts {
			if a.Start > 0 {
				v := *a
				attempts = append(attempts, &v)
			}
		}
		return nil
	}); err != nil {
		return err
	}
	sent := 0
	for _, a := range attempts {
		dir := filepath.Join(e.Config.State, "monitoring", a.ID)
		if a.Ended > 0 && a.Ended < Millis()-60*86400000 {
			if err := os.RemoveAll(dir); err != nil {
				return err
			}
			continue
		}
		entries, err := os.ReadDir(dir)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return err
		}
		for _, entry := range entries {
			pane := strings.TrimSuffix(entry.Name(), ".ndjson")
			if !attemptID.MatchString(pane) || entry.IsDir() {
				return errors.New("invalid private recording entry")
			}
			name := a.ID + ":" + pane
			var offset int64
			if err := e.WithState(func() error { offset = e.state.RecordingOffsets[name]; return nil }); err != nil {
				return err
			}
			f, err := os.Open(filepath.Join(dir, entry.Name()))
			if err != nil {
				return err
			}
			f.Seek(offset, io.SeekStart)
			reader := bufio.NewReader(f)
			var batch bytes.Buffer
			for batch.Len() < 128*1024 {
				line, err := reader.ReadBytes('\n')
				if err == io.EOF {
					break
				}
				if err != nil {
					f.Close()
					return err
				}
				if len(line) > 128*1024 {
					f.Close()
					return errors.New("recording event oversized")
				}
				batch.Write(line)
			}
			f.Close()
			if batch.Len() == 0 {
				continue
			}
			payload, _ := json.Marshal(map[string]any{"agent": e.Config.AgentID, "attempt": a.ID, "pane": pane, "offset": offset, "data": base64.StdEncoding.EncodeToString(batch.Bytes())})
			if err := e.postCallback(client, key, "/api/agent/recordings", payload, bytes.NewReader(payload), "application/vnd.ssh-exam-event"); err != nil {
				return err
			}
			if err := e.WithState(func() error {
				if e.state.RecordingOffsets == nil {
					e.state.RecordingOffsets = map[string]int64{}
				}
				if e.state.RecordingOffsets[name] != offset {
					return errors.New("recording offset conflict")
				}
				e.state.RecordingOffsets[name] = offset + int64(batch.Len())
				return nil
			}); err != nil {
				return err
			}
			sent++
			if sent >= 20 {
				return nil
			}
		}
	}
	return nil
}
