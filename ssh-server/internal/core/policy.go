package core

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type policyReceipt struct {
	Attempt     string  `json:"attempt"`
	Generation  string  `json:"generation"`
	Phase       string  `json:"phase"`
	ReadyBoot   string  `json:"ready_boot"`
	ReadyUptime float64 `json:"ready_uptime"`
}

func (e *Engine) account(name string) (Account, bool) {
	if a, ok := e.Config.Accounts[name]; ok {
		return a, true
	}
	e.accountMu.RLock()
	defer e.accountMu.RUnlock()
	a, ok := e.accounts[name]
	return a, ok
}
func (e *Engine) temporaryPolicy(a *Attempt) bool {
	_, explicit := e.Config.Accounts[a.Username]
	return e.Config.TemporaryAccountPolicy && !explicit
}
func processUptime(pid int) (float64, error) {
	if pid <= 1 {
		return 0, errors.New("verified SSH monitor required")
	}
	b, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
	if err != nil {
		return 0, err
	}
	end := strings.LastIndex(string(b), ")")
	if end < 0 {
		return 0, errors.New("invalid SSH monitor")
	}
	fields := strings.Fields(string(b)[end+1:])
	if len(fields) < 20 {
		return 0, errors.New("invalid SSH monitor start")
	}
	ticks, err := strconv.ParseFloat(fields[19], 64)
	if err != nil {
		return 0, err
	}
	out, err := exec.Command("/usr/bin/getconf", "CLK_TCK").Output()
	if err != nil {
		return 0, err
	}
	hz, err := strconv.ParseFloat(strings.TrimSpace(string(out)), 64)
	if err != nil || hz <= 0 {
		return 0, errors.New("invalid kernel clock frequency")
	}
	return ticks / hz, nil
}
func peerAccount(uid int) (string, Account, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "/usr/bin/getent", "passwd", strconv.Itoa(uid)).Output()
	if err != nil {
		return "", Account{}, err
	}
	f := strings.Split(strings.TrimSpace(string(out)), ":")
	if len(f) != 7 || !identifier.MatchString(f[0]) || f[2] != strconv.Itoa(uid) || uid < 1000 {
		return "", Account{}, errors.New("SSH peer NSS identity rejected")
	}
	gid, err := strconv.Atoi(f[3])
	if err != nil || gid < 1000 {
		return "", Account{}, errors.New("SSH peer group rejected")
	}
	return f[0], Account{UID: uid, GID: gid, Home: f[5], Shell: f[6]}, nil
}
func (e *Engine) systemPolicy(op, user, id, generation string) ([]byte, error) {
	helper := "/usr/local/sbin/exam-account-policy"
	info, err := os.Lstat(helper)
	if err != nil || !info.Mode().IsRegular() || info.Sys().(*syscall.Stat_t).Uid != 0 || info.Mode().Perm()&0022 != 0 {
		return nil, errors.New("root-owned account policy helper unavailable")
	}
	if !identifier.MatchString(user) || (id != "" && !attemptID.MatchString(id)) || (generation != "" && len(generation) != 64) {
		return nil, errors.New("invalid account-policy scope")
	}
	if op != "identify" && op != "inspect" && op != "apply" && op != "restore" && op != "verify" {
		return nil, errors.New("unsupported account-policy operation")
	}
	args := []string{"--quiet", "--wait", "--pipe", "--collect", "--property=TimeoutStartSec=75", "--property=RuntimeMaxSec=75", "--property=TimeoutStopSec=5", "--property=KillMode=control-group", helper, op, "--username", user}
	if id != "" {
		args = append(args, "--attempt", id, "--generation", generation)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 80*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "/usr/bin/systemd-run", args...).CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("account policy %s failed: %s", op, strings.TrimSpace(string(out)))
	}
	return out, nil
}
func (e *Engine) identifyAccount(user string) (Account, error) {
	out, err := e.policyRun("identify", user, "", "")
	if err != nil {
		return Account{}, err
	}
	var a Account
	if json.Unmarshal(out, &a) != nil || a.UID < 1000 || a.GID < 1000 || !filepath.IsAbs(a.Home) || (a.Shell != "/bin/bash" && a.Shell != "/bin/zsh" && a.Shell != "/bin/sh") {
		return Account{}, errors.New("invalid verified account identity")
	}
	return a, nil
}
func (e *Engine) prepareAccountPolicy(id string) (any, error) {
	var snapshot Attempt
	err := e.WithState(func() error {
		a, err := e.Find(id)
		if err != nil {
			return err
		}
		if e.expirePreflight(a, Millis()) {
			return errors.New(PreflightExpiredReason)
		}
		if a.PreparationPending {
			return errors.New("account setup requires completed preflight checks; retry preflight after checks settle")
		}
		if !e.temporaryPolicy(a) {
			snapshot = *a
			return nil
		}
		if a.State != "PREPARING" || a.Start != 0 || a.Deadline != 0 || a.OriginalDeadline != 0 {
			return errors.New("account setup requires an unstarted attempt")
		}
		if a.PolicyState == "RESTORE_PENDING" || a.PolicyState == "RESTORING" || a.PolicyState == "RESTORE_FAILED" || a.PolicyState == "NORMAL" {
			return errors.New("account activation has ended; create fresh preflight")
		}
		if a.PolicyGeneration == "" {
			a.PolicyGeneration = Token()
			a.PolicyExpires = Millis() + 300000
			a.PolicyState = "APPLYING"
		}
		if a.PolicyExpires <= Millis() {
			return errors.New("account activation expired")
		}
		snapshot = *a
		return nil
	})
	if err != nil {
		return nil, err
	}
	if snapshot.PolicyGeneration == "" {
		return &snapshot, nil
	}
	out, runErr := e.policyRun("apply", snapshot.Username, snapshot.ID, snapshot.PolicyGeneration)
	var receipt policyReceipt
	if runErr == nil && (json.Unmarshal(out, &receipt) != nil || receipt.Attempt != id || receipt.Generation != snapshot.PolicyGeneration || receipt.Phase != "READY" || receipt.ReadyBoot != boot() || receipt.ReadyUptime <= 0) {
		runErr = errors.New("account policy acknowledgment rejected")
	}
	err = e.WithState(func() error {
		a, err := e.Find(id)
		if err != nil {
			return err
		}
		if a.PolicyGeneration != snapshot.PolicyGeneration || a.State != "PREPARING" || a.Start != 0 {
			return errors.New("account setup outcome changed; recovery pending")
		}
		if runErr != nil {
			a.PolicyState = "APPLY_FAILED"
			a.PolicyError = runErr.Error()
			snapshot = *a
			return nil
		}
		a.PolicyState = "READY"
		a.PolicyError = ""
		a.PolicyReadyBoot = receipt.ReadyBoot
		a.PolicyReadyUptime = receipt.ReadyUptime
		snapshot = *a
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &snapshot, runErr
}
func (e *Engine) freshPolicyTransport(a *Attempt, monitor int) error {
	if !e.temporaryPolicy(a) {
		return nil
	}
	if a.PolicyState != "READY" || a.PolicyReadyBoot != boot() || a.PolicyExpires <= Millis() {
		return errors.New("temporary account policy not ready; prepare exam access again")
	}
	started, err := e.transportUptime(monitor)
	if err != nil || started <= a.PolicyReadyUptime {
		return errors.New("fresh SSH sign-in required after temporary account policy is applied")
	}
	return nil
}

// No helper can have changed this account without a persisted policy generation.
// Explicitly acknowledge normal access for cancelled preparations that never applied
// a policy, including records written before this acknowledgement was introduced.
func (e *Engine) acknowledgeUnappliedCancellation(a *Attempt) {
	if a.State == "CANCELLED_BEFORE_START" && a.Start == 0 && a.Deadline == 0 && a.OriginalDeadline == 0 && a.PolicyGeneration == "" && a.PolicyError == "" && a.PolicyState == "" {
		a.PolicyState = "NORMAL"
		e.Audit("account-policy-unapplied", a.ID)
	}
}

// Slow OS policy changes run outside the shared attempt lock and deadline cutoff.
// The helper independently locks/fences the per-UID journal and reads root-owned
// restore authorization from committed attempt state before changing the account.
func (e *Engine) ReconcilePolicies() error { return e.reconcilePolicies("") }
func (e *Engine) reconcilePolicies(only string) error {
	if err := e.reconcileAccessOutside(only); err != nil {
		return err
	}
	if !e.Config.TemporaryAccountPolicy {
		return nil
	}
	var jobs []Attempt
	err := e.WithState(func() error {
		for _, a := range e.state.Attempts {
			if only == "" || a.ID == only {
				e.acknowledgeUnappliedCancellation(a)
			}
			if (only != "" && a.ID != only) || !e.temporaryPolicy(a) || a.PolicyGeneration == "" || a.PolicyState == "NORMAL" {
				continue
			}
			if a.Start == 0 && a.Deadline == 0 && a.OriginalDeadline == 0 && (a.State == "PREPARING" || a.State == "CANCELLED_BEFORE_START") && (a.State == "CANCELLED_BEFORE_START" || a.PolicyExpires <= Millis() || a.PolicyState == "APPLY_FAILED") {
				if err := e.terminate(a); err != nil {
					a.PolicyError = err.Error()
					continue
				}
				a.State = "CANCELLED_BEFORE_START"
				a.PolicyRestoreAuthorized = true
				a.PolicyState = "RESTORE_PENDING"
			}
			if a.PolicyRestoreAuthorized && a.PolicyState != "NORMAL" {
				jobs = append(jobs, *a)
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	var failures []error
	for _, job := range jobs {
		out, opErr := e.policyRun("restore", job.Username, job.ID, job.PolicyGeneration)
		var receipt policyReceipt
		if opErr == nil && (json.Unmarshal(out, &receipt) != nil || receipt.Attempt != job.ID || receipt.Generation != job.PolicyGeneration || receipt.Phase != "NORMAL") {
			opErr = errors.New("account restoration acknowledgment rejected")
		}
		err = e.WithState(func() error {
			a, err := e.Find(job.ID)
			if err != nil {
				return err
			}
			if a.PolicyGeneration != job.PolicyGeneration || !a.PolicyRestoreAuthorized {
				return errors.New("stale account restoration")
			}
			if opErr != nil {
				a.PolicyState = "RESTORE_FAILED"
				a.PolicyError = opErr.Error()
				a.AccessError = opErr.Error()
				return nil
			}
			a.PolicyState = "NORMAL"
			a.PolicyError = ""
			a.AccessError = ""
			if a.Start > 0 {
				a.AccessState = "RELEASED"
				if a.PolicyOverride {
					a.AccessState = "OVERRIDDEN"
				}
				a.AccessReleasedAt = Millis()
			}
			e.Audit("account-policy-restored", a.ID)
			return nil
		})
		if err != nil {
			failures = append(failures, err)
		}
		if opErr != nil {
			failures = append(failures, opErr)
		}
	}
	return errors.Join(failures...)
}
