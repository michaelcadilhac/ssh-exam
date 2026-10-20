package core

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type Request struct {
	PublicKey        string   `json:"public_key"`
	Handoff          string   `json:"handoff"`
	ExtendSeconds    int64    `json:"extend_seconds,omitempty"`
	ResetID          string   `json:"reset_id,omitempty"`
	Actor            string   `json:"actor,omitempty"`
	RequestedAt      int64    `json:"requested_at,omitempty"`
	RemainingSeconds int64    `json:"remaining_seconds,omitempty"`
	ClockRevision    int      `json:"clock_revision,omitempty"`
	Deadline         int64    `json:"deadline,omitempty"`
	BrowserSSH       bool     `json:"browser_ssh,omitempty"`
	Continuation     *Request `json:"continuation,omitempty"`
	ID               string   `json:"id"`
	Exam             string   `json:"exam"`
	Username         string   `json:"username"`
	UID              int      `json:"uid"`
	Settings         Settings `json:"settings"`
	Transport        string   `json:"transport"`
	Pane             string   `json:"pane"`
	Purpose          string   `json:"purpose"`
	Reason           string   `json:"reason"`
	Generation       int      `json:"generation"`
	Expires          int64    `json:"expires"`
	Usernames        []string `json:"usernames"`
}

func (e *Engine) productionReady() (bool, []string) {
	missing := []string{}
	if !setupCapabilitiesAvailable() {
		missing = append(missing, "root launcher requires SETUID, SETGID and SETPCAP setup capabilities")
	}
	if e.Config.FunctionalTestAccount != "" {
		missing = append(missing, "privileged functional test never qualifies for production isolation")
	}
	for _, p := range []string{"/usr/bin/bwrap", "/usr/bin/systemd-run", "/sys/fs/cgroup/cgroup.controllers", filepath.Join(e.Config.Rootfs, "bin/bash"), filepath.Join(e.Config.Rootfs, "usr/bin/setpriv"), filepath.Join(e.Config.Rootfs, "home/student"), filepath.Join(e.Config.Rootfs, "materials"), filepath.Join(e.Config.Rootfs, strings.TrimPrefix(e.directory(), "/")), e.Config.GuardReport} {
		if p == "" {
			missing = append(missing, "guard report absent")
			continue
		}
		if _, err := os.Stat(p); err != nil {
			missing = append(missing, p)
		}
	}
	missing = append(missing, temporaryMountIssues(e.Config.Rootfs)...)
	missing = append(missing, homeMountIssues(e.Config.Rootfs)...)
	missing = append(missing, hostFilesystemIssues(e.Config)...)
	if os.Geteuid() != 0 {
		missing = append(missing, "agent must run as root")
	}
	for _, p := range []string{e.Config.State, e.Config.Work, e.Config.Rootfs, e.Config.Templates, e.Config.GuardReport} {
		info, err := os.Stat(p)
		if err != nil || info.Sys().(*syscall.Stat_t).Uid != 0 || info.Mode().Perm()&0022 != 0 {
			missing = append(missing, "path must be root-owned and not writable by students: "+p)
		}
	}
	var disk syscall.Statfs_t
	if syscall.Statfs(e.Config.State, &disk) != nil || disk.Bavail*uint64(disk.Bsize) < 1024*1024*1024 {
		missing = append(missing, "at least 1 GiB free protected storage required")
	}
	if !clockSynchronized() {
		missing = append(missing, "clock synchronization not verified")
	}
	for name, account := range e.Config.Accounts {
		output, err := exec.Command("/usr/bin/getent", "passwd", name).Output()
		fields := strings.Split(strings.TrimSpace(string(output)), ":")
		valid := err == nil && len(fields) == 7
		if valid {
			uid, parseErr := strconv.Atoi(fields[2])
			valid = parseErr == nil && uid == account.UID
		}
		if valid && account.SandboxOnly {
			valid = fields[5] == account.Home && fields[6] == account.Shell
		} else if valid {
			valid = fields[6] == "/usr/local/libexec/exam-login"
		}
		if !valid {
			missing = append(missing, "account UID/login policy differs from root registry: "+name)
		}
	}
	if e.Config.TemporaryAccountPolicy {
		if _, err := e.handoffSigner(); err != nil {
			missing = append(missing, "protected SSH handoff CA unavailable")
		}
		info, err := os.Lstat("/usr/local/sbin/exam-account-policy")
		if err != nil || !info.Mode().IsRegular() || info.Sys().(*syscall.Stat_t).Uid != 0 || info.Mode().Perm()&0022 != 0 {
			missing = append(missing, "root-owned temporary account policy helper unavailable")
		}
	}
	checker := "/usr/local/sbin/exam-check-isolation"
	info, checkerErr := os.Lstat(checker)
	if checkerErr != nil || !info.Mode().IsRegular() || info.Sys().(*syscall.Stat_t).Uid != 0 || info.Mode().Perm()&0022 != 0 {
		missing = append(missing, "root-owned isolation checker unavailable")
	} else {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		command := exec.CommandContext(ctx, checker, "-")
		config, _ := json.Marshal(e.Config)
		command.Stdin = strings.NewReader(string(config))
		if output, err := command.CombinedOutput(); err != nil {
			missing = append(missing, "machine isolation checks failed: "+strings.TrimSpace(string(output)))
		}
		cancel()
	}
	var report map[string]bool
	b, _ := os.ReadFile(e.Config.GuardReport)
	json.Unmarshal(b, &report)
	for _, k := range []string{"sshdGate", "pamRoutes", "scheduledJobs", "preexistingSessions", "rootfsIsolation", "transportBinding", "clockSync", "storage", "collection", "browserMatrix", "institutionalSSH", "sshCommandTransport", "statusCallbacks", "intervalAccessHold", "allSessionChannels", "alternateServices", "schedulerIsolation"} {
		if !report[k] {
			missing = append(missing, "unverified guard: "+k)
		}
	}
	if e.Config.TemporaryAccountPolicy && !report["temporaryAccountPolicy"] {
		missing = append(missing, "unverified guard: temporaryAccountPolicy")
	}
	return len(missing) == 0, missing
}
func uptime() float64 {
	b, _ := os.ReadFile("/proc/uptime")
	v, _ := strconv.ParseFloat(strings.Fields(string(b))[0], 64)
	return v
}
func boot() string {
	b, _ := os.ReadFile("/proc/sys/kernel/random/boot_id")
	return strings.TrimSpace(string(b))
}
func (e *Engine) Call(op string, r Request) (any, error) {
	var result any
	err := e.WithState(func() error { var err error; result, err = e.callLocked(op, r); return err })
	return result, err
}
func (e *Engine) callLocked(op string, r Request) (any, error) {
	var result any
	err := func() error {
		if op == "health" {
			ready, missing := e.Ready()
			productionReady := ready
			if e.Config.FunctionalTestAccount != "" {
				productionReady = false
			}
			result = map[string]any{"ready": ready, "production_ready": productionReady, "functional_test": e.Config.FunctionalTestAccount != "", "host_filesystem": e.Config.HostFilesystem, "administrator_sandbox_accounts": e.sandboxAdministrators(), "missing": missing, "capabilities": []string{"single-sign-in-handoff", "read-only-home", "disposable-application-state", "temporary-account-policy", "browser-ssh-receipts", "agent-terminal-recording", "clock-reset", "clock-extend", "server-only-submissions", "deadline-timing-check", "signed-pane-close", "signed-ssh-control", "durable-status-callbacks", "peer-verified-gate", "fixed-deadline", "interval-access-hold", "all-session-channel-gate", "cgroup-freeze", "isolated-filesystem", "private-network", "protected-collection"}}
			return nil
		}
		if op == "resolve-course-accounts" {
			if len(r.Usernames) > 10000 {
				return errors.New("too many accounts")
			}
			out := map[string]int{}
			for _, n := range r.Usernames {
				a, ok := e.account(n)
				if !ok {
					return fmt.Errorf("account not locally approved: %s", n)
				}
				if a.SandboxOnly && r.Exam != SandboxExamID {
					return errors.New("administrator account is approved only for sandbox")
				}
				out[n] = a.UID
			}
			result = out
			return nil
		}
		if !attemptID.MatchString(r.ID) {
			return errors.New("invalid attempt identifier")
		}
		if op == "prepare-attempt" {
			if a := e.state.Attempts[r.ID]; a != nil {
				if a.Username != r.Username || a.UID != r.UID || e.state.Registrations[r.Transport] != r.Username {
					return errors.New("preparation ownership mismatch")
				}
				e.expirePreflight(a, Millis())
				if a.State == "PREPARING" {
					a.PolicyRequired = e.temporaryPolicy(a)
					if a.Transport != r.Transport {
						if err := e.terminateWriters(a); err != nil {
							return err
						}
						a.Units = nil
					}
					a.Transport = r.Transport
					a.BrowserSSH = r.BrowserSSH
				}
				result = a
				return nil
			}
			ready, missing := e.Ready()
			if !ready {
				return fmt.Errorf("server guards unavailable: %v", missing)
			}
			account, ok := e.account(r.Username)
			if !ok || account.UID != r.UID || e.state.Registrations[r.Transport] != r.Username {
				return errors.New("identity/transport not approved")
			}
			if account.SandboxOnly && r.Exam != SandboxExamID {
				return errors.New("administrator account is approved only for sandbox")
			}
			if e.Busy(account.UID) != nil {
				return errors.New("account already reserved")
			}
			if !identifier.MatchString(r.Exam) || !identifier.MatchString(r.Settings.Template) || r.Settings.Duration < 60 || r.Settings.Duration > 21600 || r.Settings.Terminals < 1 || r.Settings.Terminals > 4 {
				return errors.New("invalid exam settings")
			}
			a := &Attempt{BrowserSSH: r.BrowserSSH, ID: r.ID, Exam: r.Exam, Username: r.Username, UID: r.UID, Settings: r.Settings, State: "PREPARING", PreflightStartedAt: Millis(), Transport: r.Transport, WorkPath: e.directory(), Units: []string{}, Errors: []string{}}
			a.PolicyRequired = e.temporaryPolicy(a)
			if sandboxAttempt(a) {
				a.Settings.Duration = SandboxDurationSeconds
			}
			a.AdministratorSandbox = account.SandboxOnly && sandboxAttempt(a)
			if a.AdministratorSandbox {
				e.Audit("administrator-sandbox-preparation", a.ID)
			}
			a.FunctionalTest = e.functionalAccount(a)
			if a.FunctionalTest {
				e.Audit("trusted-functional-test-preparation", a.ID)
			}
			if err := e.prepareHome(a); err != nil {
				return err
			}
			e.state.Attempts[r.ID] = a
			e.Audit(op, r.ID)
			result = a
			return nil
		}
		a, err := e.Find(r.ID)
		if err != nil {
			return err
		}
		e.expirePreflight(a, Millis())
		switch op {
		case "submission-manifest":
			if !a.Protected {
				return errors.New("protected submission unavailable")
			}
			manifest, err := ReadProtected(filepath.Join(e.Config.State, "submissions", a.ID), a)
			if err != nil {
				return err
			}
			manifest.Attempt = publicAttempt(manifest.Attempt)
			result = manifest
		case "inspect-attempt", "reconcile-operation", "submission-status":
			result = a
		case "activate-attempt":
			if a.Start > 0 {
				result = a
				break
			}
			if a.State != "PREPARING" {
				return errors.New("not preparing")
			}
			if e.temporaryPolicy(a) && (a.PolicyState != "READY" || a.PolicyTransport == "" || a.PolicyTransport != a.Transport || a.PolicyReadyBoot != boot() || a.PolicyExpires <= Millis()) {
				return errors.New("fresh SSH authentication under temporary account policy required before exam start")
			}
			if !sandboxAttempt(a) && (Millis() < a.Settings.Earliest || Millis() > a.Settings.Latest) {
				return errors.New("outside start window")
			}
			ready, _ := e.Ready()
			if !ready {
				return errors.New("guards unavailable")
			}
			if err = e.quiesceOrdinary(a); err != nil {
				return err
			}
			if e.expirePreflight(a, Millis()) {
				return errors.New(PreflightExpiredReason)
			}
			// Commit the original interval and hold BEFORE releasing material. A crash
			// during initialization leaves a locked, started attempt, never an ordinary login.
			commitStart(a, Millis(), uptime(), boot())
			if e.temporaryPolicy(a) {
				a.PolicyState = "HELD"
				a.PolicyExpires = 0
			}
			a.State = "ACTIVATING"
			a.Reason = "Activation in progress"
			if err = e.save(); err != nil {
				return err
			}
			if err = e.initialize(a); err != nil {
				a.State = "COLLECTION_FAILED"
				a.Reason = "Activation failed after access hold was committed"
				a.Errors = appendError(a.Errors, err.Error())
				a.Lease = 0
				return err
			}
			a.Reason = ""
			a.State = "ACTIVE"
			e.Audit(op, a.ID)
			result = a
		case "issue-channel-admission":
			if r.Username != a.Username || r.Transport != a.Transport || !attemptID.MatchString(r.Pane) {
				return errors.New("pane identity mismatch")
			}
			if r.Purpose == "practice" && a.State == "PREPARING" {
				if len(a.Units) >= a.Settings.Terminals {
					return errors.New("practice terminal limit")
				}
				result = e.issue(Capability{Username: a.Username, ID: a.ID, Pane: r.Pane, Purpose: r.Purpose, Transport: r.Transport, Expires: Millis() + 15000})
				break
			}
			if a.State != "ACTIVE" || expired(a) || a.Lease <= Millis() {
				return errors.New("attempt not active")
			}
			if len(a.Units) >= a.Settings.Terminals {
				return errors.New("terminal limit")
			}
			result = e.issue(Capability{Username: a.Username, ID: a.ID, Pane: r.Pane, Purpose: "exam", Transport: r.Transport, Expires: Millis() + 15000})
		case "close-pane":
			if !attemptID.MatchString(r.Pane) {
				return errors.New("invalid pane identity")
			}
			closed := *a
			closed.Units = nil
			remaining := []string{}
			for _, unit := range a.Units {
				if unit == "exam-"+a.ID+"-"+r.Pane+".scope" || unit == "exam-"+a.ID+"-"+r.Pane+".service" {
					closed.Units = append(closed.Units, unit)
				} else {
					remaining = append(remaining, unit)
				}
			}
			if err := e.terminateWriters(&closed); err != nil {
				return err
			}
			a.Units = remaining
			result = map[string]bool{"closed": true}
		case "lock-attempt":
			if a.State == "LOCKED" && r.Generation > a.Generation {
				a.Generation = r.Generation
				a.Authorization = 0
				a.Reason = r.Reason
				e.Audit("superseded-continuation", a.ID)
			}
			if a.State == "ACTIVE" {
				a.State = "LOCKED"
				a.Generation++
				if r.Generation > a.Generation {
					a.Generation = r.Generation
				}
				a.Reason = r.Reason
				a.Authorization = 0
				e.Audit(op, a.ID)
			}
			if a.State == "LOCKED" {
				err = e.disconnectPausedWorkload(a)
			}
			result = a
		case "reset-clock":
			if err := e.resetClock(a, r, false); err != nil {
				return err
			}
			result = a
		case "renew-execution-lease":
			if a.State != "ACTIVE" || expired(a) || a.Lease <= Millis() {
				return errors.New("cannot renew locked/ended workload")
			}
			a.Lease = Millis() + 15000
			result = a
		case "authorize-continuation":
			if a.State != "LOCKED" || len(a.Units) > 0 || expired(a) || r.Generation != a.Generation || r.Expires > Millis()+300000 || r.Expires > a.Deadline {
				return errors.New("stale continuation")
			}
			a.Authorization = r.Expires
			e.Audit(op, a.ID)
			result = a
		case "attach-transport":
			if a.State != "LOCKED" || expired(a) || a.Authorization <= Millis() || a.Generation != r.Generation || e.state.Registrations[r.Transport] != a.Username || r.Username != a.Username {
				return errors.New("replacement transport not authorized")
			}
			if r.Transport == a.Transport && a.ResumeTransport != r.Transport {
				return errors.New("fresh SSH authentication required after pause")
			}
			a.Transport = r.Transport
			a.ResumeTransport = r.Transport
			e.Audit(op, a.ID)
			result = a
		case "consume-continuation":
			if a.State != "LOCKED" || a.Authorization <= Millis() || a.Generation != r.Generation || expired(a) {
				return errors.New("continuation expired")
			}
			if a.ResumeTransport == "" || a.ResumeTransport != a.Transport {
				return errors.New("fresh SSH connection must be attached before continuation")
			}
			a.Authorization = 0
			a.Lease = Millis() + 15000
			if err = e.freeze(a, false); err != nil {
				return err
			}
			a.State = "ACTIVE"
			e.Audit(op, a.ID)
			result = a
		case "finalize-attempt":
			if a.Start == 0 {
				return errors.New("attempt not started")
			}
			err = e.finalize(a, r.Reason)
			result = a
		case "delete-submission":
			if a.State != "COMPLETED" || accessHeld(a) {
				return errors.New("submission cannot be deleted until the account restriction is released")
			}
			if err = os.RemoveAll(filepath.Join(e.Config.State, "submissions", a.ID)); err != nil {
				return err
			}
			a.Protected = false
			e.Audit(op, a.ID)
			result = a
		case "cancel-attempt":
			if a.Start != 0 || a.Deadline != 0 || a.OriginalDeadline != 0 || (a.State != "PREPARING" && a.State != "CANCELLED_BEFORE_START") {
				return errors.New("cannot cancel started attempt")
			}
			a.State = "CANCELLED_BEFORE_START"
			if a.Reason == "" {
				a.Reason = r.Reason
			}
			if a.Ended == 0 {
				a.Ended = Millis()
			}
			if err := e.terminateWriters(a); err != nil {
				a.Errors = appendError(a.Errors, err.Error())
				return err
			}
			a.Units = nil
			if err := e.cleanupTemporary(a); err != nil {
				return err
			}
			e.acknowledgeUnappliedCancellation(a)
			e.Audit(op, a.ID)
			result = a
		default:
			return errors.New("unsupported operation")
		}
		return err
	}()
	if op == "cancel-attempt" && err != nil && attemptID.MatchString(r.ID) {
		log.Printf("preflight cancellation failed attempt=%s operation=cancel-attempt: %v", r.ID, err)
	}
	return result, err
}
func (e *Engine) issue(c Capability) any {
	token := Token()
	for k, v := range e.state.Caps {
		if v.Expires < Millis() {
			delete(e.state.Caps, k)
		}
	}
	e.state.Caps[Hash([]byte(token))] = c
	return map[string]string{"token": token}
}
func (e *Engine) initialize(a *Attempt) error {
	base := filepath.Join(e.Config.Work, a.ID)
	if err := os.MkdirAll(base, 0700); err != nil {
		return err
	}
	dest := filepath.Join(base, "work")
	if err := os.Mkdir(dest, 0700); err != nil && !os.IsExist(err) {
		return err
	}
	if _, err := os.Stat(filepath.Join(base, "initialized")); err == nil {
		return nil
	}
	if err := copyTemplate(filepath.Join(e.Config.Templates, a.Settings.Template, "work"), dest); err != nil {
		return err
	}
	account, _ := e.account(a.Username)
	if err := filepath.WalkDir(dest, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		return os.Lchown(p, account.UID, account.GID)
	}); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(base, "initialized"), []byte("1"), 0600)
}
func copyTemplate(source, dest string) error {
	return filepath.WalkDir(source, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(source, p)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil
		}
		target := filepath.Join(dest, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0700)
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return errors.New("template contains special file or symlink")
		}
		b, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		return os.WriteFile(target, b, info.Mode().Perm()&0777)
	})
}
func (e *Engine) quiesceOrdinary(a *Attempt) error { // Administrator's PAM/job policy must already close all alternate entry routes.
	if e.trustedAdministratorAttempt(a) {
		e.Audit("trusted-administrator-retains-ordinary-access", a.ID)
		return nil
	}
	// Preserve only SSH transport/session ancestors identified at registration. The verified guard suite must
	// demonstrate that configured PAM does not place the gateway transport in the killed user slice.
	pids, err := uidProcesses(a.UID)
	if err != nil {
		return err
	}
	trusted := func(pid int) bool {
		identity, err := transportIdentity(pid, a.UID)
		return err == nil && identity == a.Transport && trustedEntryExecutable(pid)
	}
	var entries []int
	seen := map[int]bool{}
	for _, pid := range pids {
		if trusted(pid) {
			_, monitor, err := transportInfo(pid, a.UID)
			if err != nil {
				return err
			}
			for _, entry := range []int{pid, monitor} {
				if !seen[entry] {
					entries = append(entries, entry)
					seen[entry] = true
				}
			}
		}
	}
	if len(entries) > 0 {
		if err := protectEntryScope(entries, "exam-entry-"+a.ID+"-"+Token()[:12]+".scope"); err != nil {
			return err
		}
	}
	if err := terminateLoggedInUser(a.UID); err != nil {
		return fmt.Errorf("terminate existing login/user-service sessions: %w", err)
	}
	for _, pid := range pids {
		if trusted(pid) {
			continue
		}
		// Go uses pidfds on supported Linux; avoid signalling a recycled PID.
		process, err := os.FindProcess(pid)
		if err != nil {
			return err
		}
		err = process.Kill()
		process.Release()
		if err != nil && !errors.Is(err, os.ErrProcessDone) && !errors.Is(err, syscall.ESRCH) {
			return err
		}
	}
	for i := 0; i < 50; i++ {
		pids, err = uidProcesses(a.UID)
		if err != nil {
			return err
		}
		clean := true
		for _, pid := range pids {
			if !trusted(pid) {
				clean = false
			}
		}
		if clean {
			return nil
		}
		time.Sleep(20 * time.Millisecond)
	}
	return errors.New("uncontained pre-existing process remains; activation denied")
}
func (e *Engine) freeze(a *Attempt, frozen bool) error {
	value := "0"
	expected := "frozen 0"
	if frozen {
		value = "1"
		expected = "frozen 1"
	}
	freezeUnit := func(unit string) error {
		if !e.recordedUnitAllowed(a, unit) {
			return errors.New("invalid recorded workload unit")
		}
		base := filepath.Join("/sys/fs/cgroup/exam.slice", unit)
		if _, err := os.Stat(base); os.IsNotExist(err) {
			return nil
		} else if err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(base, "cgroup.freeze"), []byte(value), 0600); err != nil {
			return err
		}
		confirmed := false
		for i := 0; i < 50; i++ {
			events, err := os.ReadFile(filepath.Join(base, "cgroup.events"))
			if os.IsNotExist(err) {
				confirmed = true
				break
			}
			if err != nil {
				return err
			}
			if strings.Contains(string(events), expected) {
				confirmed = true
				break
			}
			time.Sleep(10 * time.Millisecond)
		}
		if !confirmed {
			return errors.New("workload freeze/thaw not confirmed")
		}
		return nil
	}
	var failures []error
	for _, unit := range a.Units {
		if err := freezeUnit(unit); err != nil {
			failures = append(failures, err)
		}
	}
	err := errors.Join(failures...)
	if err != nil && !frozen {
		e.freeze(a, true)
	} // Partial thaw is never an authorized continuation.
	return err
}
func (e *Engine) Tick() error {
	return e.WithState(func() error {
		// Cancellation must close practice shells even when their browser/old
		// entry process disappeared. No started attempt is cancelled here.
		for _, a := range e.state.Attempts {
			if a.State == "PREPARING" && a.Start == 0 && a.PreflightStartedAt == 0 {
				// Legacy records have no reliable native preparation date. Give
				// them one bounded grace period, never renewed on later restarts.
				a.PreflightStartedAt = Millis()
			}
			e.expirePreflight(a, Millis())
			if a.Start == 0 && a.State == "CANCELLED_BEFORE_START" {
				if err := e.terminateWriters(a); err != nil {
					a.Errors = appendError(a.Errors, err.Error())
				} else {
					a.Units = nil
					if err := e.cleanupTemporary(a); err != nil {
						a.Errors = appendError(a.Errors, err.Error())
					}
					e.acknowledgeUnappliedCancellation(a)
				}
			}
		}
		// Revoke/freeze ALL expired workloads before spending time compressing any archive.
		for _, a := range e.state.Attempts {
			if a.Start > 0 && a.State != "COMPLETED" && a.State != "CANCELLED_BEFORE_START" && expired(a) {
				if e.timingRequired(a) {
					if err := e.quiesce(a); err != nil {
						a.Errors = appendError(a.Errors, err.Error())
					}
					continue
				}
				if a.Boot != boot() {
					a.Units = []string{}
				}
				if a.State != "FINALIZING" && a.State != "COLLECTION_FAILED" {
					a.Reason = "expiration"
				}
				a.State = "FINALIZING"
				if a.Ended == 0 {
					a.Ended = a.Deadline
				}
				if err := e.quiesce(a); err != nil {
					a.State = "COLLECTION_FAILED"
					a.Errors = appendError(a.Errors, err.Error())
				} else if a.CompletedAt == 0 {
					a.CompletedAt = Millis()
				}
			}
		}
		for _, a := range e.state.Attempts {
			if a.Start == 0 || a.State == "COMPLETED" || a.State == "CANCELLED_BEFORE_START" {
				continue
			}
			if a.State == "ACTIVATING" {
				a.State = "COLLECTION_FAILED"
				a.Reason = "Activation interrupted after access hold; administrator recovery required"
			}
			if a.Boot != boot() {
				a.Units = []string{}
				a.Errors = append(a.Errors, "Infrastructure outage: server reboot; prior workload ended")
			}
			isExpired := expired(a)
			if isExpired && e.timingRequired(a) {
				// HTTP runs separately. An in-flight healthy check must not
				// block unrelated leases or generate false outage alerts.
				if a.TimingPendingSince == 0 && (a.State != "ACTIVE" || (a.Lease > Millis() && a.Boot == boot())) {
					continue
				}
				if a.State == "ACTIVE" {
					a.State = "LOCKED"
					a.Generation++
					a.Authorization = 0
					a.ResumeTransport = ""
					a.Lease = 0
				}
				a.Reason = "Collection pending: deadline timing verification unavailable"
				if a.TimingPendingSince == 0 {
					a.TimingPendingSince = Millis()
				}
				if len(a.Units) > 0 {
					if err := e.disconnectPausedWorkload(a); err != nil {
						a.Errors = appendError(a.Errors, err.Error())
					}
				}
				continue
			}
			if isExpired || a.State == "FINALIZING" || a.State == "COLLECTION_FAILED" {
				if err := e.finalize(a, "expiration"); err != nil {
					e.Audit("collection-failed", a.ID)
				}
				continue
			}
			if a.State == "ACTIVE" && (Millis() > a.Lease || a.Boot != boot()) {
				a.State = "LOCKED"
				a.Generation++
				a.Reason = "Monitoring authorization expired after 15 seconds without renewal"
				if a.Boot != boot() {
					a.Reason = "Class server restarted; exam access paused"
				}
				a.Authorization = 0
				a.ResumeTransport = ""
				a.Lease = 0
				e.Audit("watchdog-lock", a.ID, a.Reason)
			}
			if a.State == "LOCKED" && len(a.Units) > 0 {
				if err := e.disconnectPausedWorkload(a); err != nil {
					a.Errors = appendError(a.Errors, err.Error())
				}
			}
		}
		return nil
	})
}

// Cutoff reads atomically committed state without taking the collection lock. It only
// freezes; it never thaws, admits sessions, changes metadata or publishes submissions.
// This prevents compression/transfer requests from delaying another attempt's deadline.
func (e *Engine) Cutoff() error {
	guard, err := e.timingLock(syscall.LOCK_SH)
	if err != nil {
		return err
	}
	defer guard.Close()

	b, err := os.ReadFile(filepath.Join(e.Config.State, "state.json"))
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	var state State
	if err = json.Unmarshal(b, &state); err != nil {
		return err
	}
	var failures []error
	for _, a := range state.Attempts {
		if a.Start > 0 && a.State != "COMPLETED" && a.State != "CANCELLED_BEFORE_START" && expired(a) {
			if err = e.cutoff(a); err != nil {
				log.Printf("deadline freeze failed for attempt %s: %v", a.ID, err)
				failures = append(failures, err)
			}
		}
	}
	return errors.Join(failures...)
}
func (e *Engine) Watch() {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	policy := make(chan struct{}, 1)
	running := make(chan struct{}, 1)
	timing := make(chan struct{}, 1)
	delivery := make(chan struct{}, 1)
	nextDelivery := time.Time{}
	backoff := time.Second
	for range ticker.C {
		select {
		case policy <- struct{}{}:
			go func() {
				defer func() { <-policy }()
				if err := e.ReconcilePolicies(); err != nil {
					log.Printf("account policy recovery pending: %v", err)
				}
			}()
		default:
		}

		select {
		case timing <- struct{}{}:
			go func() {
				defer func() { <-timing }()
				if err := e.RefreshExpiredTiming(); err != nil {
					log.Printf("deadline timing verification pending: %v", err)
				}
			}()
		default:
		}
		if !time.Now().Before(nextDelivery) {
			select {
			case delivery <- struct{}{}:
				go func() {
					defer func() { <-delivery }()
					if err := e.DeliverCallbacks(); err != nil {
						log.Printf("agent callback delivery pending: %v", err)
					}
				}()
				// Delivery is attempted only for pending data; no idle HTTP request is made.
				nextDelivery = time.Now().Add(backoff)
				if backoff < 30*time.Second {
					backoff *= 2
				}
			default:
			}
		}
		if err := e.Cutoff(); err != nil {
			log.Printf("independent deadline cutoff failed: %v", err)
		}
		select {
		case running <- struct{}{}:
			go func() {
				defer func() { <-running }()
				if err := e.Tick(); err != nil {
					log.Printf("exam watchdog reconciliation failed: %v", err)
				}
			}()
		default:
		}
	}
}
func expired(a *Attempt) bool {
	return Millis() >= a.Deadline || (a.Boot == boot() && uptime() >= a.UptimeDeadline)
}

// One authoritative start/deadline pair; individual duration is already snapshotted.
func commitStart(a *Attempt, at int64, elapsed float64, bootID string) {
	a.Start = at
	a.AccessState = "HELD"
	a.AccessHeldAt = at
	a.Deadline = at + a.Settings.Duration*1000
	a.OriginalDeadline = a.Deadline
	a.Lease = at + 15000
	a.Boot = bootID
	a.UptimeDeadline = elapsed + float64(a.Settings.Duration)
	a.OriginalUptimeDeadline = a.UptimeDeadline
}
