package core

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const collectionWorkerFlag = "--collection-worker"

type collectionRequest struct {
	Version int    `json:"version"`
	Nonce   string `json:"nonce"`
	Action  string `json:"action"`
	ID      string `json:"id"`
	Config  Config `json:"config"`
}

type collectionReply struct {
	Version int    `json:"version"`
	Nonce   string `json:"nonce"`
	Action  string `json:"action"`
	ID      string `json:"id"`
	Error   string `json:"error,omitempty"`
	Pending bool   `json:"pending,omitempty"`
}

// This entry is wired only into the ordinary root exam-agent/examctl binaries,
// never package init or the setuid exam-login launcher. Input is a private pipe
// from a root coordinator, not a path/command supplied by a student.
func CollectionWorkerMain(args []string) bool {
	if len(args) != 1 || args[0] != collectionWorkerFlag {
		return false
	}
	if os.Getuid() != 0 || os.Geteuid() != 0 {
		fmt.Fprintln(os.Stderr, "collection worker requires a root coordinator")
		os.Exit(1)
	}
	if err := runCollectionWorker(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "collection worker protocol failed")
		os.Exit(1)
	}
	return true
}

func decodeWorkerFrame(in io.Reader, limit int64, target any) error {
	b, err := io.ReadAll(io.LimitReader(in, limit+1))
	if err != nil {
		return err
	}
	if int64(len(b)) > limit {
		return errors.New("collection worker frame too large")
	}
	d := json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	if err = d.Decode(target); err != nil {
		return err
	}
	if err = d.Decode(new(any)); err != io.EOF {
		return errors.New("unexpected trailing collection worker data")
	}
	return nil
}

func runCollectionWorker(in io.Reader, out io.Writer) error {
	return runCollectionWorkerWith(in, out, New)
}

func runCollectionWorkerWith(in io.Reader, out io.Writer, newEngine func(Config) (*Engine, error)) error {
	var request collectionRequest
	if err := decodeWorkerFrame(in, 8*1024*1024, &request); err != nil {
		return err
	}
	if request.Version != 1 || len(request.Nonce) != 64 || !attemptID.MatchString(request.ID) || (request.Action != "finalize" && request.Action != "manifest" && request.Action != "release" && request.Action != "check-release" && request.Action != "workspace-prepare") || !filepath.IsAbs(request.Config.State) || !filepath.IsAbs(request.Config.Work) {
		return errors.New("invalid collection worker request")
	}
	e, err := newEngine(request.Config)
	if err == nil {
		err = e.runCollectionJob(request.Action, request.ID)
	}
	reply := collectionReply{Version: 1, Nonce: request.Nonce, Action: request.Action, ID: request.ID}
	if errors.Is(err, errCollectionPending) {
		reply.Pending = true
	} else if err != nil {
		reply.Error = err.Error()
		if len(reply.Error) > 2000 {
			reply.Error = reply.Error[:2000]
		}
	}
	return json.NewEncoder(out).Encode(reply)
}

func collectionServiceArgs(unit, executable string) []string {
	return []string{"/usr/bin/systemd-run", "--quiet", "--pipe", "--wait", "--collect", "--service-type=exec", "--unit=" + unit,
		"--property=Slice=exam-collection.slice", "--property=MemoryMax=256M", "--property=MemorySwapMax=0", "--property=TasksMax=32",
		"--property=RuntimeMaxSec=120", "--property=TimeoutStopSec=5s", "--property=OOMPolicy=kill", "--property=KillMode=control-group",
		"--property=CPUQuota=100%", "--property=Nice=10", "--property=UMask=0077", "--", executable, collectionWorkerFlag}
}

func validateCollectionSlice(output string) error {
	properties := map[string]string{}
	for _, line := range strings.Split(output, "\n") {
		key, value, ok := strings.Cut(line, "=")
		if ok {
			properties[key] = value
		}
	}
	memory, memoryErr := strconv.ParseUint(properties["MemoryMax"], 10, 64)
	tasks, tasksErr := strconv.ParseUint(properties["TasksMax"], 10, 64)
	if properties["LoadState"] != "loaded" || memoryErr != nil || tasksErr != nil || memory == 0 || memory > 512*1024*1024 || tasks < 2 || tasks > 96 {
		return errors.New("collection resource slice unavailable or unbounded: install exam-collection.slice, run systemctl daemon-reload, then retry collection; account remains restricted")
	}
	return nil
}

func collectionResourceBounds() error {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	bounds, err := exec.CommandContext(ctx, "/usr/bin/systemctl", "show", "exam-collection.slice", "--property=LoadState", "--property=MemoryMax", "--property=TasksMax").Output()
	if err != nil {
		return fmt.Errorf("inspect collection resource slice before retrying: %w", err)
	}
	return validateCollectionSlice(string(bounds))
}

// Discard excess output without allocating or blocking the child. Overflow is
// still a protocol failure, never a truncated successful result.
type workerOutput struct {
	bytes.Buffer
	overflow bool
}

func (b *workerOutput) Write(p []byte) (int, error) {
	n := len(p)
	left := 8192 - b.Len()
	if n > left {
		b.overflow = true
		p = p[:left]
	}
	_, _ = b.Buffer.Write(p)
	return n, nil
}

func (e *Engine) runCollectionProcess(action, id string) (runErr error) {
	job := ""
	if action == "finalize" {
		if err := e.WithState(func() error {
			a, err := e.Find(id)
			if err == nil {
				job = a.CollectionJob
			}
			return err
		}); err != nil {
			return err
		}
		defer func() {
			if runErr != nil && !errors.Is(runErr, errCollectionPending) {
				e.collectionProcessFailed(id, job, runErr)
			}
		}()
	}
	request := collectionRequest{Version: 1, Nonce: Token(), Action: action, ID: id, Config: e.Config}
	payload, err := json.Marshal(request)
	if err != nil || len(payload) > 8*1024*1024 {
		return errors.New("collection worker request could not be encoded within its limit")
	}
	unit := "exam-collection-" + id + "-" + request.Nonce[:12] + ".service"
	var command []string
	if e.workerCommand != nil {
		command = e.workerCommand(unit) // Test-only injected executable, never config/env controlled.
	} else {
		executable, err := os.Executable()
		if err != nil {
			return err
		}
		info, err := os.Stat(executable)
		if err != nil || os.Getuid() != 0 || os.Geteuid() != 0 || info.Sys().(*syscall.Stat_t).Uid != 0 || info.Mode().Perm()&0022 != 0 {
			return errors.New("collection requires a root-owned, non-writable coordinator executable run as root")
		}
		if err := collectionResourceBounds(); err != nil {
			return err
		}
		command = collectionServiceArgs(unit, executable)
	}
	if len(command) == 0 {
		return errors.New("collection worker executable unavailable")
	}
	timeout := 130 * time.Second // systemd's own runtime+stop bounds expire first.
	if e.workerTimeout > 0 {
		timeout = e.workerTimeout
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, command[0], command[1:]...)
	cmd.Stdin = bytes.NewReader(payload)
	var output workerOutput
	cmd.Stdout = &output
	cmd.Stderr = io.Discard // No unbounded logs or accidental credential forwarding.
	cmd.WaitDelay = 5 * time.Second
	err = cmd.Run()
	if ctx.Err() != nil && e.workerCommand == nil {
		// Killing systemd-run alone does not prove its service died. The worker
		// also owns the per-attempt lock; retries cannot overlap surviving work.
		stopCtx, stopCancel := context.WithTimeout(context.Background(), 7*time.Second)
		_ = exec.CommandContext(stopCtx, "/usr/bin/systemctl", "stop", unit).Run()
		stopCancel()
	}
	if err != nil {
		err = fmt.Errorf("collection worker exited or exceeded its resource/time bound: %w; inspect the attempt and retry collection", err)
	} else {
		var reply collectionReply
		if output.overflow || decodeWorkerFrame(bytes.NewReader(output.Bytes()), 8192, &reply) != nil || reply.Version != 1 || reply.Nonce != request.Nonce || reply.Action != action || reply.ID != id || (reply.Pending && reply.Error != "") {
			err = errors.New("invalid collection worker reply; inspect the attempt and retry collection")
		} else if reply.Pending {
			return errCollectionPending
		} else if reply.Error != "" {
			err = errors.New(reply.Error)
		}
	}
	return err
}
