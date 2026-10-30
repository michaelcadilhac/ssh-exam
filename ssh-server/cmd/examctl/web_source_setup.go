package main

import (
	"context"
	"encoding/json"
	"errors"
	"examworkspace/agent/internal/core"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"
)

type sourceSetupStatus struct {
	ID              string `json:"id"`
	Revision        int64  `json:"revision"`
	CurrentRevision int64  `json:"current_revision"`
	GrantStatus     string `json:"grant_status"`
	Status          string `json:"status"`
	Tries           int64  `json:"tries"`
	Error           string `json:"error"`
	Updated         *int64 `json:"updated"`
}

func decodeSetupStatus(raw json.RawMessage, id string, revision int64) (sourceSetupStatus, error) {
	var s sourceSetupStatus
	err := catalogDecode(raw, &s, []string{"id", "revision", "current_revision", "grant_status", "status", "tries", "error", "updated"})
	if err != nil || s.ID != id || s.Revision != revision || s.CurrentRevision < 1 || s.Tries < 0 || len(s.Error) > 4096 || !strings.Contains("|NOT_QUEUED|QUEUED|RUNNING|FAILED|READY|CANCELLED|", "|"+s.Status+"|") || !strings.Contains("|PENDING_NATIVE|AVAILABLE|REVOKED|CONSUMED|", "|"+s.GrantStatus+"|") || (s.Status == "READY" && (s.CurrentRevision != revision || (s.GrantStatus != "AVAILABLE" && s.GrantStatus != "CONSUMED"))) {
		return s, errors.New("invalid saved-work setup status; inspect the same grant/revision before retry")
	}
	return s, nil
}

type sourceSetupTask struct {
	ID         string `json:"id"`
	Revision   int64  `json:"revision"`
	Request    string `json:"request"`
	Lease      string `json:"lease"`
	LeaseUntil int64  `json:"lease_until"`
}

// Bound child diagnostics even if a malfunctioning tool writes indefinitely.
type sourceOutput struct {
	mu   sync.Mutex
	data []byte
}

func (b *sourceOutput) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if len(b.data) < 4096 {
		n := 4096 - len(b.data)
		if n > len(p) {
			n = len(p)
		}
		b.data = append(b.data, p[:n]...)
	}
	return len(p), nil
}
func (b *sourceOutput) String() string { b.mu.Lock(); defer b.mu.Unlock(); return string(b.data) }

func sourceWorkerLock(dir string) (*os.File, error) {
	if !filepath.IsAbs(dir) {
		return nil, errors.New("worker-state must be an absolute private directory")
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	st, err := os.Lstat(dir)
	if err != nil {
		return nil, err
	}
	stat, ok := st.Sys().(*syscall.Stat_t)
	if !st.IsDir() || st.Mode().Perm()&0077 != 0 || !ok || stat.Uid != 0 {
		return nil, errors.New("worker-state must be root-owned, private and not a symlink")
	}
	fd, err := syscall.Open(filepath.Join(dir, "worker.lock"), syscall.O_CREAT|syscall.O_RDWR|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0600)
	if err != nil {
		return nil, err
	}
	f := os.NewFile(uintptr(fd), "worker.lock")
	st, err = f.Stat()
	if err != nil || !st.Mode().IsRegular() || st.Mode().Perm()&0077 != 0 {
		f.Close()
		return nil, errors.New("unsafe worker lock")
	}
	fileStat, ok := st.Sys().(*syscall.Stat_t)
	if !ok || fileStat.Uid != 0 || fileStat.Nlink != 1 {
		f.Close()
		return nil, errors.New("worker lock must be an unlinked-to, root-owned private file")
	}
	if err = syscall.Flock(fd, syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		f.Close()
		return nil, errors.New("another saved-work worker is running; inspect its service status")
	}
	return f, nil
}

// The coordinator only polls, supervises ONE bounded child and reports. Archive
// verification and durable pin writes happen in source-retain, never the agent.
func runSourceSetup(ctx context.Context, c core.Config, configPath string) (bool, error) {
	next, err := core.ManagementCall(c, "grants.source-next", map[string]any{}, "")
	if err != nil {
		return false, err
	}
	var reply struct {
		Task *sourceSetupTask `json:"task"`
	}
	if catalogDecode(next.Result, &reply, []string{"task"}) != nil {
		return false, errors.New("invalid saved-work task response")
	}
	if reply.Task == nil {
		return false, nil
	}
	task := reply.Task
	if !managementUUID.MatchString(task.ID) || !managementUUID.MatchString(task.Request) || !managementUUID.MatchString(task.Lease) || task.Revision < 1 || task.Revision > catalogSafeInteger || task.LeaseUntil < 1 {
		return false, errors.New("invalid saved-work task scope")
	}
	executable, err := os.Executable()
	if err != nil {
		return true, err
	}
	childCtx, cancel := context.WithTimeout(ctx, 120*time.Second)
	defer cancel()
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	cmd := exec.CommandContext(childCtx, executable, "web", "grants", "source-retain", task.ID, "--revision", fmt.Sprint(task.Revision), "--request", task.Request, "--config", configPath)
	cmd.SysProcAttr = &syscall.SysProcAttr{Pdeathsig: syscall.SIGKILL}
	output := &sourceOutput{}
	cmd.Stdout = output
	cmd.Stderr = output
	childErr := cmd.Run()
	if ctx.Err() != nil {
		return true, errors.New("saved-work worker interrupted; child stopped, inspect the same grant/revision before retry")
	}
	diagnostic := ""
	if childErr != nil {
		diagnostic = fmt.Sprintf("Saved-work child failed: %v. %s", childErr, output.String())
		if len(diagnostic) > 4096 {
			diagnostic = diagnostic[:4096]
		}
	}
	// Always reconcile authoritative native confirmation, including reply loss.
	report, err := core.ManagementCall(c, "grants.source-report", map[string]any{"id": task.ID, "revision": task.Revision, "lease": task.Lease, "error": diagnostic}, "")
	if err != nil {
		return true, fmt.Errorf("setup report unconfirmed for %s revision %d; inspect source-status: %w", task.ID, task.Revision, err)
	}
	status, err := decodeSetupStatus(report.Result, task.ID, task.Revision)
	if err != nil {
		return true, err
	}
	if status.Status != "READY" && status.Status != "FAILED" && status.Status != "CANCELLED" {
		return true, errors.New("saved-work completion unconfirmed; inspect source-status for this grant/revision")
	}
	if err = json.NewEncoder(os.Stdout).Encode(status); err != nil {
		return true, err
	}
	if status.Status == "FAILED" {
		return true, errors.New(status.Error)
	}
	return true, nil
}

func webSourceSetupMain(args []string) int {
	f := flag.NewFlagSet("examctl web grants source setup", flag.ContinueOnError)
	f.SetOutput(os.Stderr)
	configPath := f.String("config", "/etc/exam-agent/agent.json", "protected class-server configuration")
	revision := f.Int64("revision", 0, "exact saved-work revision")
	request := f.String("request", "", "management retry UUID")
	once := f.Bool("once", false, "process at most one task and exit")
	state := f.String("worker-state", "/run/exam-source-setup", "root-private coordinator lock directory")
	if err := f.Parse(ordered(args)); err != nil {
		return 2
	}
	w := f.Args()
	if len(w) < 2 || w[0] != "grants" || (w[1] != "source-worker" && w[1] != "source-status" && w[1] != "source-retry") {
		fmt.Fprintln(os.Stderr, "use examctl web grants help for saved-work setup")
		return 2
	}
	worker := w[1] == "source-worker"
	badFlag := false
	f.Visit(func(v *flag.Flag) {
		if v.Name != "config" && ((worker && v.Name != "worker-state" && v.Name != "once") || (!worker && v.Name != "revision" && v.Name != "request")) {
			badFlag = true
		}
	})
	if badFlag || (worker && (len(w) != 2 || *revision != 0 || *request != "")) || (!worker && (len(w) != 3 || !managementUUID.MatchString(w[2]) || *revision < 1 || *revision > catalogSafeInteger || *once)) || (*request != "" && !managementUUID.MatchString(*request)) {
		fmt.Fprintln(os.Stderr, "use source-status/source-retry GRANT --revision N, or source-worker [--once]")
		return 2
	}
	if os.Getuid() != 0 || os.Geteuid() != 0 {
		fmt.Fprintln(os.Stderr, "run saved-work setup as root on the class server")
		return 1
	}
	c, err := scriptLoadConfig(*configPath)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	if !worker {
		r, err := core.ManagementCall(c, "grants."+w[1], map[string]any{"id": w[2], "revision": *revision}, *request)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 1
		}
		s, err := decodeSetupStatus(r.Result, w[2], *revision)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 1
		}
		if err = json.NewEncoder(os.Stdout).Encode(s); err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 1
		}
		return 0
	}
	lock, err := sourceWorkerLock(*state)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer lock.Close()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	for ctx.Err() == nil {
		worked, err := runSourceSetup(ctx, c, *configPath)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
		}
		if *once {
			if err != nil {
				return 1
			}
			return 0
		}
		if !worked || err != nil {
			select {
			case <-ctx.Done():
			case <-time.After(5 * time.Second):
			}
		}
	}
	return 0
}
