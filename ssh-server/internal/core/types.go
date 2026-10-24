package core

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"
)

type Account struct {
	SandboxOnly bool   `json:"sandbox_only,omitempty"`
	UID         int    `json:"uid"`
	GID         int    `json:"gid"`
	Shell       string `json:"shell"`
	Home        string `json:"home"`
}
type Config struct {
	HostFilesystem            bool               `json:"host_filesystem,omitempty"`
	HostFilesystemHiddenPaths []string           `json:"host_filesystem_hidden_paths,omitempty"`
	HandoffCA                 string             `json:"handoff_ca,omitempty"`
	HomeConfigPaths           []string           `json:"home_config_paths,omitempty"`
	TemporaryAccountPolicy    bool               `json:"temporary_account_policy,omitempty"`
	TerminalRecordingLimitMiB int64              `json:"terminal_recording_limit_mib,omitempty"`
	FunctionalHostAccess      bool               `json:"functional_host_access,omitempty"`
	FunctionalTestAccount     string             `json:"functional_test_account,omitempty"`
	FunctionalTestUntil       int64              `json:"functional_test_until,omitempty"`
	ExamDirectory             string             `json:"exam_directory"`
	State                     string             `json:"state"`
	Work                      string             `json:"work"`
	Rootfs                    string             `json:"rootfs"`
	Templates                 string             `json:"templates"`
	Accounts                  map[string]Account `json:"accounts"`
	AgentID                   string             `json:"agent_id"`
	GatewayPublicKey          string             `json:"gateway_public_key"`
	CallbackURL               string             `json:"callback_url"`
	CallbackKey               string             `json:"callback_key"`
	CallbackCA                string             `json:"callback_ca,omitempty"`
	Socket                    string             `json:"socket"`
	GuardReport               string             `json:"guard_report"`
}
type Settings struct {
	Name               string `json:"name"`
	ID                 string `json:"id"`
	Duration           int64  `json:"duration"`
	Webcam             bool   `json:"webcam"`
	Template           string `json:"template"`
	TemplateVersion    string `json:"template_version,omitempty"`
	Terminals          int    `json:"terminals"`
	Earliest           int64  `json:"earliest"`
	Latest             int64  `json:"latest"`
	CollectionFileMiB  int64  `json:"collection_file_mib,omitempty"`
	CollectionTotalMiB int64  `json:"collection_total_mib,omitempty"`
}
type ClockReset struct {
	ExtendSeconds    int64  `json:"extend_seconds,omitempty"`
	ID               string `json:"id"`
	Actor            string `json:"actor"`
	RequestedAt      int64  `json:"requested_at"`
	AppliedAt        int64  `json:"applied_at"`
	PreviousDeadline int64  `json:"previous_deadline"`
	Deadline         int64  `json:"deadline"`
	RemainingSeconds int64  `json:"remaining_seconds"`
	Revision         int    `json:"revision"`
}
type SSHHandoff struct {
	ID             string `json:"id"`
	Principal      string `json:"principal"`
	Certificate    string `json:"certificate"`
	CertificateKey string `json:"certificate_key"`
	Expires        int64  `json:"expires"`
	Consumed       string `json:"consumed,omitempty"`
}
type Attempt struct {
	MonitoringMode              string               `json:"monitoring_mode,omitempty"`
	RetainedHold                string               `json:"retained_hold,omitempty"` // Observation only; not a restored kernel receipt.
	MonitoringResumeNonce       string               `json:"monitoring_resume_nonce,omitempty"`
	MonitoringHoldKind          string               `json:"monitoring_hold_kind,omitempty"`
	RegisteredOwner             *monitoringOwner     `json:"registered_owner,omitempty"`
	Grant                       *GrantBinding        `json:"grant,omitempty"`
	GrantBeginIntent            string               `json:"grant_begin_intent,omitempty"`
	ExpectedRecovery            string               `json:"expected_recovery,omitempty"`
	PreparationPending          bool                 `json:"preparation_pending,omitempty"`
	PreparationPendingSince     int64                `json:"preparation_pending_since,omitempty"`
	CancellationCleanupComplete bool                 `json:"cancellation_cleanup_complete,omitempty"`
	Workspace                   *WorkspaceReceipt    `json:"workspace,omitempty"`
	Handoff                     *SSHHandoff          `json:"ssh_handoff,omitempty"`
	PolicyRequired              bool                 `json:"account_policy_required,omitempty"`
	PolicyTransport             string               `json:"policy_transport,omitempty"`
	PolicyGeneration            string               `json:"policy_generation,omitempty"`
	PolicyState                 string               `json:"policy_state,omitempty"`
	PolicyExpires               int64                `json:"policy_expires,omitempty"`
	PolicyReadyBoot             string               `json:"policy_ready_boot,omitempty"`
	PolicyReadyUptime           float64              `json:"policy_ready_uptime,omitempty"`
	PolicyRestoreAuthorized     bool                 `json:"policy_restore_authorized,omitempty"`
	PolicyOverride              bool                 `json:"policy_override,omitempty"`
	PolicyError                 string               `json:"policy_error,omitempty"`
	TimingPendingSince          int64                `json:"timing_pending_since,omitempty"`
	TimingNextCheck             int64                `json:"timing_next_check,omitempty"`
	TimingVerifiedAt            int64                `json:"timing_verified_at,omitempty"`
	TimingVerifiedDeadline      int64                `json:"timing_verified_deadline,omitempty"`
	TimingVerifiedRevision      int                  `json:"timing_verified_revision,omitempty"`
	OriginalDeadline            int64                `json:"original_deadline,omitempty"`
	OriginalUptimeDeadline      float64              `json:"original_uptime_deadline,omitempty"`
	ClockRevision               int                  `json:"clock_revision,omitempty"`
	ClockResets                 []ClockReset         `json:"clock_resets,omitempty"`
	BrowserSSH                  bool                 `json:"browser_ssh,omitempty"`
	TerminalSupervised          bool                 `json:"terminal_supervised,omitempty"`
	AdministratorSandbox        bool                 `json:"administrator_sandbox,omitempty"`
	FunctionalTest              bool                 `json:"functional_test,omitempty"`
	ID                          string               `json:"id"`
	Exam                        string               `json:"exam"`
	Username                    string               `json:"username"`
	UID                         int                  `json:"uid"`
	Settings                    Settings             `json:"settings"`
	State                       string               `json:"state"`
	PreflightStartedAt          int64                `json:"preflight_started_at,omitempty"`
	Start                       int64                `json:"start"`
	Deadline                    int64                `json:"deadline"`
	Ended                       int64                `json:"ended"`
	CompletedAt                 int64                `json:"completed_at"`
	CollectedAt                 int64                `json:"collected_at"`
	SecuredAt                   int64                `json:"secured_at"`
	Lease                       int64                `json:"lease"`
	WorkPath                    string               `json:"work_path"`
	Transport                   string               `json:"transport"`
	ResumeTransport             string               `json:"resume_transport,omitempty"`
	Generation                  int                  `json:"generation"`
	Authorization               int64                `json:"authorization"`
	Reason                      string               `json:"reason"`
	Checksum                    string               `json:"checksum"`
	Units                       []string             `json:"units"`
	Errors                      []string             `json:"errors"`
	Boot                        string               `json:"boot"`
	UptimeDeadline              float64              `json:"uptime_deadline"`
	Protected                   bool                 `json:"protected"`
	AccessState                 string               `json:"access_state"`
	AccessHeldAt                int64                `json:"access_held_at"`
	AccessReleasedAt            int64                `json:"access_released_at"`
	AccessOverride              string               `json:"access_override,omitempty"`
	AccessError                 string               `json:"access_error,omitempty"`
	DeniedSSHTransports         []DeniedSSHTransport `json:"denied_ssh_transports,omitempty"`
	CollectionJob               string               `json:"collection_job,omitempty"`
}
type DeniedSSHTransport struct {
	Identity string `json:"identity"`
	Monitor  int    `json:"monitor"`
}
type Capability struct {
	InputEpoch      string          `json:"input_epoch,omitempty"`
	RegisteredOwner monitoringOwner `json:"registered_owner,omitzero"`
	Username        string          `json:"username"`
	ID              string          `json:"id"`
	Pane            string          `json:"pane"`
	Purpose         string          `json:"purpose"`
	Transport       string          `json:"transport"`
	Expires         int64           `json:"expires"`
}
type State struct {
	PaneInstances    map[string]PaneInstance `json:"pane_instances,omitempty"`
	Accounts         map[string]Account      `json:"accounts,omitempty"`
	Attempts         map[string]*Attempt     `json:"attempts"`
	Caps             map[string]Capability   `json:"capabilities"`
	Registrations    map[string]string       `json:"registrations"`
	Commands         map[string]int64        `json:"commands,omitempty"`
	Sequence         int64                   `json:"sequence,omitempty"`
	Events           []CallbackEvent         `json:"events,omitempty"`
	Reported         map[string]string       `json:"reported,omitempty"`
	Exports          map[string]bool         `json:"exports,omitempty"`
	ExportPauses     map[string]string       `json:"export_pauses,omitempty"`
	RecordingOffsets map[string]int64        `json:"recording_offsets,omitempty"`
	ManifestReceipts map[string]string       `json:"manifest_receipts,omitempty"`
}

// PaneInstance records observed system-manager activation of one unique unit.
// It is not live execution/monitoring authority, freeze proof or restart recovery.
// Never backfill this observation from a legacy unit name or restored snapshot.
type PaneInstance struct {
	InputEpoch        string                   `json:"input_epoch,omitempty"`
	Attempt           string                   `json:"attempt"`
	Pane              string                   `json:"pane"`
	ID                string                   `json:"id"`
	Boot              string                   `json:"boot"`
	ReadyAt           int64                    `json:"ready_at"`
	Supervisor        string                   `json:"supervisor,omitempty"`
	Recording         string                   `json:"recording_context,omitempty"`
	RecordingIdentity terminalRecordingContext `json:"recording_identity,omitzero"`
	RecordingOwner    string                   `json:"recording_owner,omitempty"`
	RecordingPID      int                      `json:"recording_pid,omitempty"`
	RecordingStart    uint64                   `json:"recording_start,omitempty"`
	RecordingAck      string                   `json:"recording_ack,omitempty"`
	RecordingRevision uint64                   `json:"recording_revision,omitempty"`
	RecordingClosed   bool                     `json:"recording_closed,omitempty"`
	// ClosedUntil is a bounded bootstrap observation, never exec permission.
	// Only the live parent's final transaction can change it to ReadyAt.
	ClosedUntil     int64 `json:"closed_until,omitempty"`
	ClosedBootUntil int64 `json:"closed_boot_until,omitempty"`
	Cancelled       bool  `json:"cancelled,omitempty"`
}
type Engine struct {
	terminalMonitoring        terminalMonitoringBridge
	renewalReceiptMu          sync.Mutex
	renewalReceiptConfirmed   map[string]executionRenewalConfirmation
	accountMu                 sync.RWMutex
	accounts                  map[string]Account
	policyRun                 func(string, string, string, string) ([]byte, error)
	transportUptime           func(int) (float64, error)
	Config                    Config
	mu                        sync.Mutex
	healthMu                  sync.Mutex
	paneSetupMu               sync.Mutex
	paneLaunchMu              sync.Mutex
	state                     State
	quiesce                   func(*Attempt) error
	terminate                 func(*Attempt) error
	cutoff                    func(*Attempt) error
	collectionRun             func(string, string) error
	workerCommand             func(string) []string
	workerTimeout             time.Duration
	workspaceCheckpoint       func(string) error // Test-only fault barriers, never configurable.
	activationPrepare         func(*Attempt) error
	preparationReady          func() (bool, []string)
	preparationHome           func(*Attempt) error
	paneIdentity              func(int, int) (string, error) // Test-only dependency seams, never configurable.
	paneSetupCheckpoint       func() error
	paneStart                 func() error
	paneBootstrapStart        func(*exec.Cmd, *net.UnixConn, *os.File, string, PaneInstance) (*paneBootstrapPeer, bool, error)
	terminalFailureCheckpoint func(string)            // Test-only recorder fault barriers; never configurable.
	terminalHandoffCheckpoint func()                  // Test-only actual admission boundary; never configurable.
	healthProbe               func() (bool, []string) // Test-only dependency seam; never configurable.
	templateVerify            func(Settings) error    // Test replacement never exposed in config/environment.
}

// Tests replace this factory in test-only code. There is no configuration or
// environment switch that can disable production process/resource isolation.
var collectionRunner = func(e *Engine) func(string, string) error { return e.runCollectionProcess }

var identifier = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)
var attemptID = regexp.MustCompile(`^[a-f0-9-]{36}$`)

func Millis() int64        { return time.Now().UnixMilli() }
func Hash(b []byte) string { d := sha256.Sum256(b); return hex.EncodeToString(d[:]) }
func Token() string {
	b := make([]byte, 32)
	if _, e := rand.Read(b); e != nil {
		panic(e)
	}
	return hex.EncodeToString(b)
}
func LoadConfig(p string) (Config, error) {
	var c Config
	b, e := os.ReadFile(p)
	if e != nil {
		return c, e
	}
	e = json.Unmarshal(b, &c)
	if e != nil {
		return c, e
	}
	return validateNativeConfig(c, true)
}

// Legacy runtime keeps every existing key/filesystem check. Explicit offline
// observation reuses structural policy, then checks its own bounded pinned key
// descriptors rather than reopening unbounded files through the legacy loader.
func validateNativeConfig(c Config, checkKeyFiles bool) (Config, error) {
	if !identifier.MatchString(c.AgentID) || c.GatewayPublicKey == "" || c.CallbackKey == "" {
		return c, errors.New("configure agent_id, gateway_public_key and callback_key; the old control API is unsupported")
	}
	if c.TerminalRecordingLimitMiB < 0 || c.TerminalRecordingLimitMiB > 1048576 {
		return c, errors.New("terminal_recording_limit_mib must be 1..1048576, or omitted for 2048 MiB")
	}
	for _, name := range c.HomeConfigPaths {
		if !validPreferencePath(name) {
			return c, errors.New("home_config_paths must contain clean home-relative configuration paths, excluding private/reserved stores")
		}
	}
	u, err := url.Parse(c.CallbackURL)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return c, errors.New("callback_url must be a fixed HTTPS origin")
	}
	if checkKeyFiles {
		if _, err = publicKey(c.GatewayPublicKey); err != nil {
			return c, err
		}
		key, err := privateKey(c.CallbackKey)
		if err != nil {
			return c, err
		}
		for i := range key {
			key[i] = 0
		}
	}
	if (len(c.Accounts) == 0 && !c.TemporaryAccountPolicy) || !filepath.IsAbs(c.State) || !filepath.IsAbs(c.Work) || !filepath.IsAbs(c.Rootfs) {
		return c, errors.New("absolute paths and locally approved accounts required")
	}
	if err := validateHostFilesystem(c); err != nil {
		return c, err
	}
	if c.TemporaryAccountPolicy {
		if c.FunctionalTestAccount != "" {
			return c, errors.New("temporary policy cannot use legacy functional-test access")
		}
		for _, a := range c.Accounts {
			if !a.SandboxOnly {
				return c, errors.New("temporary policy requires ordinary students to be dynamically resolved; static accounts are administrator exceptions only")
			}
		}
	}
	if c.FunctionalTestAccount != "" {
		if len(c.Accounts) != 1 || c.FunctionalTestUntil <= 0 {
			return c, errors.New("functional test requires one explicit account and expiration")
		}
		if _, ok := c.Accounts[c.FunctionalTestAccount]; !ok {
			return c, errors.New("functional test account not approved")
		}
	}
	if c.FunctionalHostAccess && c.FunctionalTestAccount == "" {
		return c, errors.New("host access requires the explicit single-account functional test")
	}
	if c.ExamDirectory != "" {
		p := c.ExamDirectory
		if !filepath.IsAbs(p) || filepath.Clean(p) != p || p == "/" {
			return c, errors.New("exam_directory must be a clean absolute directory")
		}
		if p == "/var" {
			return c, errors.New("exam_directory overlaps private /var/tmp")
		}
		for _, reserved := range []string{"/proc", "/dev", "/sys", "/run", "/tmp", "/var/tmp", "/home", "/etc", "/usr", "/bin", "/sbin", "/lib", "/lib64"} {
			if p == reserved || strings.HasPrefix(p, reserved+"/") {
				return c, errors.New("exam_directory overlaps a reserved sandbox path")
			}
		}
	}
	if checkKeyFiles && os.Geteuid() == 0 {
		for _, p := range []string{c.GatewayPublicKey, c.CallbackKey} {
			info, err := os.Stat(p)
			if err != nil || !filepath.IsAbs(p) || !info.Mode().IsRegular() || info.Sys().(*syscall.Stat_t).Uid != 0 || info.Mode().Perm()&0022 != 0 || (p == c.CallbackKey && info.Mode().Perm()&0077 != 0) {
				return c, errors.New("signature keys must be root-owned, protected regular files at absolute paths")
			}
		}
	}
	seenUIDs := map[int]bool{}
	for n, a := range c.Accounts {
		if seenUIDs[a.UID] {
			return c, errors.New("duplicate approved UID; isolation must be per account")
		}
		seenUIDs[a.UID] = true
		if !identifier.MatchString(n) || a.UID < 1000 || a.GID < 1000 || !filepath.IsAbs(a.Home) || !(a.Shell == "/bin/bash" || a.Shell == "/bin/zsh" || a.Shell == "/bin/sh") {
			return c, fmt.Errorf("unsupported account %s", n)
		}
	}
	return c, nil
}
func (e *Engine) directory() string {
	if e.Config.ExamDirectory == "" {
		return "/work"
	}
	return e.Config.ExamDirectory
}
func New(c Config) (*Engine, error) {
	if e := os.MkdirAll(c.State, 0700); e != nil {
		return nil, e
	}
	if err := os.Chmod(c.State, 0700); err != nil {
		return nil, err
	}
	e := &Engine{Config: c, accounts: map[string]Account{}}
	e.policyRun = e.systemPolicy
	e.transportUptime = processUptime
	e.quiesce = e.quiesceWriters
	e.terminate = e.terminateWriters
	e.cutoff = func(a *Attempt) error { return e.freeze(a, true) }
	e.collectionRun = collectionRunner(e)
	e.activationPrepare = e.prepareActivation
	e.preparationReady = e.Ready
	e.preparationHome = e.prepareHome
	e.paneIdentity = transportIdentity
	e.templateVerify = func(s Settings) error {
		if s.TemplateVersion == "" {
			return nil
		}
		_, err := TemplateCall(c, TemplateCommand{Action: "verify", Name: s.Template, Hash: s.TemplateVersion}, ManagementID())
		return err
	}
	return e, nil
}
func (e *Engine) WithState(fn func() error) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	lock, err := os.OpenFile(filepath.Join(e.Config.State, "lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	defer lock.Close()
	if err = syscall.Flock(int(lock.Fd()), syscall.LOCK_EX); err != nil {
		return err
	}
	defer syscall.Flock(int(lock.Fd()), syscall.LOCK_UN)
	e.state = State{Attempts: map[string]*Attempt{}, Caps: map[string]Capability{}, Registrations: map[string]string{}}
	b, err := os.ReadFile(filepath.Join(e.Config.State, "state.json"))
	if err == nil {
		if err = json.Unmarshal(b, &e.state); err != nil {
			return err
		}
	} else if !os.IsNotExist(err) {
		return err
	} else if _, markerErr := os.Stat(filepath.Join(e.Config.State, "initialized")); !os.IsNotExist(markerErr) {
		return errors.New("administrator state missing; account access denied pending recovery")
	}
	if e.state.Attempts == nil || e.state.Caps == nil || e.state.Registrations == nil {
		return errors.New("invalid administrator state; access denied")
	}
	if e.state.Accounts == nil {
		e.state.Accounts = map[string]Account{}
	}
	e.accountMu.Lock()
	e.accounts = make(map[string]Account, len(e.state.Accounts))
	for name, a := range e.state.Accounts {
		e.accounts[name] = a
	}
	e.accountMu.Unlock()
	// Upgrade old records conservatively. Completion never implies access release.
	for _, a := range e.state.Attempts {
		if err := e.applyExecutionLease(a); err != nil {
			return err
		}
		if a.AccessState == "" && a.Start > 0 {
			a.AccessState = "HELD"
			a.AccessHeldAt = a.Start
		}
	}
	err = fn()
	if saveErr := e.save(); err == nil {
		err = saveErr
	}
	return err
}
func (e *Engine) save() error {
	if err := e.queueChanges(); err != nil {
		return err
	}
	marker, err := os.OpenFile(filepath.Join(e.Config.State, "initialized"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err == nil {
		_, err = marker.WriteString("Do not remove state: original access intervals survive restarts.\n")
		if err == nil {
			err = marker.Sync()
		}
		marker.Close()
		if err != nil {
			return err
		}
	} else if !os.IsExist(err) {
		return err
	}
	b, err := json.MarshalIndent(e.state, "", "  ")
	if err != nil {
		return err
	}
	p := filepath.Join(e.Config.State, "state.json")
	f, err := os.OpenFile(p+".tmp", os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	if _, err = f.Write(b); err != nil {
		f.Close()
		return err
	}
	err = f.Sync()
	f.Close()
	if err != nil {
		return err
	}
	if err = os.Rename(p+".tmp", p); err != nil {
		return err
	}
	d, err := os.Open(e.Config.State)
	if err == nil {
		err = d.Sync()
		d.Close()
	}
	return err
}
func (e *Engine) Audit(action, id string, reason ...string) {
	event := map[string]any{"at": Millis(), "action": action, "attempt": id}
	if len(reason) > 0 {
		event["reason"] = reason[0]
	}
	// Legacy callers remain best-effort. Explicit root management calls use the
	// checked helper directly and refuse before their destructive side effect.
	_ = e.appendNativeManagementAudit(event)
}
func (e *Engine) Find(id string) (*Attempt, error) {
	a := e.state.Attempts[id]
	if a == nil {
		return nil, errors.New("unknown attempt")
	}
	return a, nil
}
func (e *Engine) Busy(uid int) *Attempt {
	for _, a := range e.state.Attempts {
		if a.UID == uid && accessHeld(a) {
			return a
		}
	}
	return nil
}
