package core

// Integration WIP: the typed native Begin caller is wired here, but admission
// stays disabled until the input/writer/expiry/Continue boundary is complete.
// There is no configuration/environment switch to enable an incomplete mode.

import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/sys/unix"
)

const terminalAuthorityPurpose = "terminal-monitoring-authority/v1"

var terminalAuthorityReadiness = func() error {
	return errors.New("retained monitoring admission is disabled until the complete native input/writer/expiry/Continue workflow is qualified; preserve the current grant and inspect examctl help panes; no interval committed")
}

type terminalAuthorityBegin struct {
	Attempt      string          `json:"attempt"`
	Nonce        string          `json:"nonce"`
	Owner        monitoringOwner `json:"owner"`
	IssuedBootMS int64           `json:"issued_boot_ms"`
}

type terminalAuthorityRequest struct {
	Purpose             string           `json:"purpose"`
	Op                  string           `json:"op"`
	Attempt             string           `json:"attempt"`
	Owner               monitoringOwner  `json:"owner"`
	Agent               string           `json:"agent,omitempty"`
	GatewayKey          []byte           `json:"gateway_key,omitempty"` // Public verification key only.
	Grant               *GrantBinding    `json:"grant,omitempty"`
	Intent              string           `json:"intent,omitempty"`
	Nonce               string           `json:"nonce,omitempty"`
	Frame               *SignedFrame     `json:"frame,omitempty"`
	State               string           `json:"state,omitempty"`
	Start               int64            `json:"start,omitempty"`
	Deadline            int64            `json:"deadline,omitempty"`
	OriginalDeadline    int64            `json:"original_deadline,omitempty"`
	DeadlineBootMS      int64            `json:"deadline_boot_ms,omitempty"`
	VerifiedUntilBootMS int64            `json:"verified_until_boot_ms,omitempty"`
	Cause               string           `json:"cause,omitempty"`
	Unit                string           `json:"unit,omitempty"`
	Proof               *PaneInstance    `json:"proof,omitempty"`
	NextOwner           *monitoringOwner `json:"next_owner,omitempty"`
	Generation          int              `json:"generation,omitempty"`
	Clock               *ClockReset      `json:"clock,omitempty"`
}

type terminalAuthorityReply struct {
	Purpose     string                      `json:"purpose"`
	Attempt     string                      `json:"attempt"`
	Begin       *terminalAuthorityBegin     `json:"begin,omitempty"`
	View        *monitoringAuthorityView    `json:"view,omitempty"`
	Challenge   *monitoringChallenge        `json:"challenge,omitempty"`
	Receipt     *monitoringCommitReceipt    `json:"receipt,omitempty"`
	Error       string                      `json:"error,omitempty"`
	Panes       []terminalAuthorityPaneView `json:"panes,omitempty"`
	Hold        *terminalHoldView           `json:"hold,omitempty"`
	Resume      *terminalResumePrepared     `json:"resume,omitempty"`
	InputEpochs map[string]string           `json:"input_epochs,omitempty"`
	HeldOwner   *monitoringOwner            `json:"held_owner,omitempty"`
	Cutoff      *monitoringCutoffDescriptor `json:"cutoff,omitempty"`
	cutoffFile  *os.File
	cutoffPeer  *uidProcess
}

type terminalAuthorityPaneView struct {
	Unit            string `json:"unit"`
	Pane            string `json:"pane"`
	Held            bool   `json:"held"`
	DiscardedInput  uint64 `json:"discarded_input"`
	DiscardedResize uint64 `json:"discarded_resize"`
}

type terminalAuthorityPending struct {
	begin     terminalAuthorityBegin
	agent     string
	key       ed25519.PublicKey
	grant     *GrantBinding
	intent    string
	caller    *uidProcess
	peer      *monitoringProcessGuard
	claim     *monitoringOwnerClaim
	cutoff    *monitoringSharedCutoff
	ready     bool
	cancelled atomic.Bool
	mu        sync.Mutex
}

func (p *terminalAuthorityPending) close() {
	if p == nil {
		return
	}
	p.cancelled.Store(true)
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.caller != nil {
		p.caller.close()
		p.caller = nil
	}
	if p.peer != nil {
		p.peer.close()
		p.peer = nil
	}
	if p.claim != nil {
		p.claim.close()
		p.claim = nil
	}
	if p.cutoff != nil {
		p.cutoff.close()
		p.cutoff = nil
	}
}

type terminalAuthorityRuntime struct {
	owner                                             monitoringOwner
	beginNonce                                        string
	key                                               ed25519.PublicKey
	peer                                              *monitoringProcessGuard
	claim                                             *monitoringOwnerClaim
	live                                              atomic.Bool
	holdRunning                                       atomic.Bool
	authority                                         *monitoringAuthority
	hold                                              *terminalHold           // Protected by supervisor.mu; worker contents by hold.mu.
	launches                                          map[string]PaneInstance // Includes pending scopes before manager startup.
	resume                                            *terminalResumePrepared
	resumeNonce                                       string
	clockReset                                        *ClockReset      // Exact durable clock intent; lost replies never apply it twice.
	cancelledResumeOwner                              *monitoringOwner // Negative-control alias only; never positive permission.
	start, deadline, originalDeadline, deadlineBootMS int64
}

func (r *terminalAuthorityRuntime) close() {
	if r == nil {
		return
	}
	r.live.Store(false)
	if r.authority != nil && r.authority.context.cutoff != nil {
		r.authority.context.cutoff.close()
	}
	r.hold.close()
	r.peer.close()
	r.claim.close()
}

// The original socket is inherited from the real native command gate, never
// supplied as a PID in JSON. Pending resources confer no execution permission.
func (s *terminalSupervisor) prepareAuthority(q terminalAuthorityRequest, original *os.File, caller *uidProcess) (terminalAuthorityBegin, error) {
	if err := terminalAuthorityReadiness(); err != nil {
		return terminalAuthorityBegin{}, err
	}
	if !validMonitoringOwner(q.Owner) || q.Owner.Boot != boot() || q.Attempt != s.id || q.Owner.Attempt != s.id || !identifier.MatchString(q.Agent) || len(q.GatewayKey) != ed25519.PublicKeySize || !validGrant(q.Grant) || !attemptID.MatchString(q.Intent) || original == nil || caller == nil {
		return terminalAuthorityBegin{}, errMonitoringScope
	}
	issued, err := monitoringBootMillis()
	if err != nil {
		return terminalAuthorityBegin{}, err
	}
	p := &terminalAuthorityPending{begin: terminalAuthorityBegin{Attempt: s.id, Nonce: Token(), Owner: q.Owner, IssuedBootMS: issued}, agent: q.Agent, key: append(ed25519.PublicKey(nil), q.GatewayKey...), grant: q.Grant, intent: q.Intent}
	p.cutoff, err = newMonitoringSharedCutoff(q.Owner, 0, 0) // Probe/allocate BEFORE any clock/material release.
	if err != nil {
		return terminalAuthorityBegin{}, err
	}
	s.mu.Lock()
	if s.authorityPending != nil || s.workAuthority != nil || s.active != 0 || len(s.requests) != 0 {
		s.mu.Unlock()
		p.close()
		return terminalAuthorityBegin{}, errMonitoringBusy
	}
	s.authorityPending, s.last = p, time.Now()
	s.mu.Unlock()
	accepted, err := net.FileConn(original)
	if err != nil {
		s.cancelAuthorityPending(p.begin.Nonce)
		return terminalAuthorityBegin{}, err
	}
	defer accepted.Close()
	connection, ok := accepted.(*net.UnixConn)
	if !ok {
		s.cancelAuthorityPending(p.begin.Nonce)
		return terminalAuthorityBegin{}, errMonitoringProcess
	}
	credentials, err := peer(connection)
	if err != nil || credentials.Uid != uint32(q.Owner.UID) {
		s.cancelAuthorityPending(p.begin.Nonce)
		return terminalAuthorityBegin{}, errMonitoringProcess
	}
	ssh, err := terminalSupervisorSSHProcess(int(credentials.Pid), q.Owner.UID, q.Owner.TransportHash)
	if err != nil {
		s.cancelAuthorityPending(p.begin.Nonce)
		return terminalAuthorityBegin{}, err
	}
	claim, err := claimMonitoringOwner(s.state, s.id)
	if err != nil {
		ssh.close()
		s.cancelAuthorityPending(p.begin.Nonce)
		return terminalAuthorityBegin{}, err
	}
	coordinator, err := pinUIDProcess(caller.pid, os.Geteuid())
	current, currentErr := caller.live()
	if err != nil || coordinator == nil || currentErr != nil || !current {
		if coordinator != nil {
			coordinator.close()
		}
		claim.close()
		ssh.close()
		s.cancelAuthorityPending(p.begin.Nonce)
		return terminalAuthorityBegin{}, errMonitoringProcess
	}
	now, err := monitoringBootMillis()
	s.mu.Lock()
	if err != nil || now < issued || now-issued >= 15000 || s.authorityPending != p || p.cancelled.Load() {
		s.mu.Unlock()
		coordinator.close()
		claim.close()
		ssh.close()
		s.cancelAuthorityPending(p.begin.Nonce)
		return terminalAuthorityBegin{}, errMonitoringAuthority
	}
	p.mu.Lock()
	p.caller, p.peer, p.claim, p.ready = coordinator, ssh, claim, true
	p.mu.Unlock()
	s.mu.Unlock()
	return p.begin, nil
}

func (s *terminalSupervisor) cancelAuthorityPending(nonce string) {
	s.mu.Lock()
	p := s.authorityPending
	if p == nil || p.begin.Nonce != nonce {
		s.mu.Unlock()
		return
	}
	s.authorityPending = nil
	s.mu.Unlock()
	p.close() // Cancels ONLY pending; never revokes a committed live authority.
}

func (s *terminalSupervisor) expireAuthorityPending() {
	now, err := monitoringBootMillis()
	s.mu.Lock()
	p := s.authorityPending
	if p == nil || (err == nil && now >= p.begin.IssuedBootMS && now-p.begin.IssuedBootMS < 15000) {
		s.mu.Unlock()
		return
	}
	s.authorityPending = nil
	s.mu.Unlock()
	p.close()
}

func (s *terminalSupervisor) commitAuthority(q terminalAuthorityRequest, caller *uidProcess) (monitoringAuthorityView, error) {
	if err := terminalAuthorityReadiness(); err != nil {
		return monitoringAuthorityView{}, err
	}
	s.mu.Lock()
	if r := s.workAuthority; r != nil {
		s.mu.Unlock()
		if r.beginNonce != q.Nonce || r.owner != q.Owner {
			return monitoringAuthorityView{}, errMonitoringScope
		}
		return r.authority.check(), nil // Original live result; never re-create it.
	}
	p := s.authorityPending
	if p == nil || !p.ready || p.cancelled.Load() || p.begin.Nonce != q.Nonce || p.begin.Owner != q.Owner {
		s.mu.Unlock()
		return monitoringAuthorityView{}, errMonitoringScope
	}
	p.mu.Lock()
	if p.caller == nil || caller == nil || p.caller.pid != caller.pid || p.peer == nil || p.claim == nil {
		p.mu.Unlock()
		s.mu.Unlock()
		return monitoringAuthorityView{}, errMonitoringScope
	}
	rootCaller, ssh, claim, cutoff := p.caller, p.peer, p.claim, p.cutoff
	p.mu.Unlock()
	s.mu.Unlock()
	current, err := rootCaller.live()
	if err != nil || !current || q.Frame == nil || q.State != "ACTIVE" || q.Start <= 0 || q.Deadline <= q.Start || q.OriginalDeadline != q.Deadline || q.DeadlineBootMS <= 0 || q.Owner.Boot != boot() {
		return monitoringAuthorityView{}, errMonitoringAuthority
	}
	if len(q.Frame.Payload) > base64.StdEncoding.EncodedLen(4096) {
		return monitoringAuthorityView{}, errMonitoringEvidence
	}
	payload, err := base64.StdEncoding.Strict().DecodeString(q.Frame.Payload)
	signature, signatureErr := base64.StdEncoding.Strict().DecodeString(q.Frame.Signature)
	if err != nil || signatureErr != nil || !ed25519.Verify(p.key, payload, signature) || !validReadOnlyJSON(payload) {
		return monitoringAuthorityView{}, errMonitoringEvidence
	}
	var reply grantBeginReply
	d := json.NewDecoder(bytes.NewReader(payload))
	d.DisallowUnknownFields()
	if d.Decode(&reply) != nil || reply.Type != "grant-begin/v3" || reply.Audience != p.agent || reply.Nonce != p.begin.Nonce || reply.Attempt != s.id || reply.Intent != p.intent || !sameGrant(reply.Grant, p.grant) || reply.Transport != q.Owner.TransportHash || reply.Boot != q.Owner.Boot || reply.PageEpoch != q.Owner.PageEpoch || reply.Bootstrap == nil || reply.Bootstrap.Type != "monitoring-bootstrap/v1" || reply.Bootstrap.ControlRetention != "v1" || reply.Bootstrap.PolicyReports != "v1" || reply.Bootstrap.Owner != q.Owner || reply.Bootstrap.Sequence != 1 || !monitoringDigest.MatchString(reply.Bootstrap.CoverageEpoch) || reply.CaptureValidFor <= 0 || reply.CaptureValidFor > 15000 || reply.Expires <= Millis() {
		return monitoringAuthorityView{}, errMonitoringEvidence
	}
	now, err := monitoringBootMillis()
	until := min(p.begin.IssuedBootMS+reply.CaptureValidFor, q.VerifiedUntilBootMS, q.DeadlineBootMS)
	if err != nil || now < p.begin.IssuedBootMS || now >= until {
		return monitoringAuthorityView{}, errMonitoringAuthority
	}
	r := &terminalAuthorityRuntime{owner: q.Owner, beginNonce: q.Nonce, key: append(ed25519.PublicKey(nil), p.key...), peer: ssh, claim: claim, launches: map[string]PaneInstance{}, start: q.Start, deadline: q.Deadline, originalDeadline: q.OriginalDeadline, deadlineBootMS: q.DeadlineBootMS}
	r.live.Store(true)
	if cutoff == nil || cutoff.initialize(until, q.DeadlineBootMS) != nil {
		return monitoringAuthorityView{}, errMonitoringCutoff
	}
	context := monitoringActiveContext{Agent: p.agent, PolicyReports: reply.Bootstrap.PolicyReports, Owner: q.Owner, CoverageEpoch: reply.Bootstrap.CoverageEpoch, Sequence: 1, AuthorityUntilMS: until, DeadlineUptimeMS: q.DeadlineBootMS, cutoff: cutoff}
	context.verified = &monitoringActiveSeal{fingerprint: monitoringContextHash(context), current: func() bool { return r.live.Load() && !p.cancelled.Load() && claim.current() && ssh.current() }}
	r.authority, err = newMonitoringAuthority(context, monitoringBootMillis)
	if err != nil {
		r.live.Store(false)
		return monitoringAuthorityView{}, err
	}
	s.mu.Lock()
	if s.authorityPending != p || p.cancelled.Load() || s.workAuthority != nil {
		s.mu.Unlock()
		r.live.Store(false)
		return monitoringAuthorityView{}, errMonitoringAuthority
	}
	p.mu.Lock()
	p.peer, p.claim = nil, nil // Transfer lifetime handles exactly once.
	p.cutoff = nil
	p.mu.Unlock()
	s.workAuthority, s.authorityPending, s.ssh = r, nil, ssh
	owner := q.Owner
	s.registeredOwner = &owner
	s.mu.Unlock()
	// Closing the pending coordinator handle must not invalidate the committed
	// authority's seal. It is independent of coordinator process lifetime.
	p.mu.Lock()
	if p.caller != nil {
		p.caller.close()
		p.caller = nil
	}
	p.mu.Unlock()
	return r.authority.check(), nil
}

func (e *Engine) callTerminalAuthority(q terminalAuthorityRequest, original *net.UnixConn, create bool) (terminalAuthorityReply, error) {
	var result terminalAuthorityReply
	exe, err := paneBootstrapExecutable()
	if err != nil {
		return result, err
	}
	defer exe.Close()
	negativePID := 0
	if q.Op == "hold" {
		// examctl is a different executable. Negative control authenticates the
		// current root supervisor sender/scope, never weakens positive-role checks.
		observed, err := ObserveTerminalSupervisor(e.Config.State, q.Attempt)
		if err != nil {
			return result, err
		}
		loaded, err := os.Open(fmt.Sprintf("/proc/%d/exe", observed.PID))
		if err != nil {
			return result, err
		}
		defer loaded.Close()
		exe = loaded
		negativePID = observed.PID
	}
	var c *net.UnixConn
	var process *paneBootstrapPeer
	if create {
		c, process, err = e.connectTerminalSupervisor(q.Attempt)
	} else {
		root, rerr := readOnlyRoot(e.Config.State)
		if rerr != nil {
			return result, rerr
		}
		defer root.Close()
		dir, rerr := readOnlyOpenAt(root, "terminal-supervisors", true)
		if rerr != nil {
			return result, rerr
		}
		defer dir.Close()
		c, process, err = terminalSupervisorDial(dir, e.Config.State, q.Attempt, exe)
	}
	if err != nil {
		return result, err
	}
	defer c.Close()
	retainPeer := false
	defer func() {
		if !retainPeer {
			process.process.close()
		}
	}()
	if negativePID != 0 && process.process.pid != negativePID {
		return result, errTerminalObservation
	}
	bound := 3 * time.Second
	if q.Op == "hold" || q.Op == "expire" {
		bound = 5 * time.Second
	}
	_ = c.SetDeadline(time.Now().Add(bound))
	q.Purpose = terminalAuthorityPurpose
	b, err := json.Marshal(q)
	if err != nil || len(b) > terminalSupervisorBytes {
		return result, errMonitoringScope
	}
	var rights []byte
	if original != nil {
		file, err := original.File()
		if err != nil {
			return result, err
		}
		defer file.Close()
		rights = unix.UnixRights(int(file.Fd()))
	}
	if _, _, err := c.WriteMsgUnix(b, rights, nil); err != nil {
		return result, err
	}
	buffer := make([]byte, terminalSupervisorBytes+1)
	oob := make([]byte, unix.CmsgSpace(4*4))
	n, on, flags, _, err := c.ReadMsgUnix(buffer, oob)
	limit := 0
	if q.Op == "live-cutoff" {
		limit = 1
	}
	owned, descriptorErr := receiveBoundedDescriptors(oob[:on], flags, limit)
	defer owned.close()
	if err != nil || descriptorErr != nil || flags&(unix.MSG_TRUNC|unix.MSG_CTRUNC) != 0 || terminalDecode(buffer[:n], &result) != nil || result.Purpose != terminalAuthorityPurpose || result.Attempt != q.Attempt || !process.current() {
		return result, errMonitoringAuthority
	}
	if result.Error != "" {
		return result, errors.New(result.Error)
	}
	if q.Op == "live-cutoff" {
		if len(owned.files) != 1 || result.Cutoff == nil || result.Cutoff.Version != 1 || result.Cutoff.Owner != q.Owner || result.Cutoff.SupervisorPID != process.process.pid {
			return result, errMonitoringCutoff
		}
		result.cutoffFile, result.cutoffPeer, retainPeer = owned.files[0], process.process, true
		owned.files[0] = nil
	}
	return result, nil
}

func (s *terminalSupervisor) serveAuthority(c *net.UnixConn, exe *os.File, body []byte, files []*os.File) {
	reply := terminalAuthorityReply{Purpose: terminalAuthorityPurpose, Attempt: s.id}
	var outgoing *os.File
	defer func() {
		if outgoing != nil {
			defer outgoing.Close()
		}
		if outgoing != nil && reply.Error == "" {
			data, _ := json.Marshal(reply)
			_, _, _ = c.WriteMsgUnix(data, unix.UnixRights(int(outgoing.Fd())), nil)
		} else {
			_ = json.NewEncoder(c).Encode(reply)
		}
	}()
	var q terminalAuthorityRequest
	if terminalDecode(body, &q) != nil || q.Purpose != terminalAuthorityPurpose || q.Attempt != s.id || !validMonitoringOwner(q.Owner) || q.Owner.Attempt != s.id {
		reply.Error = errMonitoringScope.Error()
		return
	}
	caller, err := terminalSupervisorCaller(c, exe, q.Op == "hold")
	if err != nil || caller == nil {
		reply.Error = errTerminalSupervisor.Error()
		return
	}
	defer caller.close()
	if q.Op == "prepare" {
		if len(files) != 1 {
			reply.Error = "original native Begin control socket required; no positive authority created"
			return
		}
		begin, err := s.prepareAuthority(q, files[0], caller)
		if err != nil {
			reply.Error = err.Error()
			return
		}
		reply.Begin = &begin
		return
	}
	if len(files) != 0 {
		reply.Error = "authority control does not accept descriptors"
		return
	}
	if q.Op == "hold" || q.Op == "expire" {
		_ = c.SetDeadline(time.Now().Add(5 * time.Second))
	}
	switch q.Op {
	case "check-clock", "commit-clock":
		view, err := s.changeAuthorityClock(q)
		if err != nil {
			reply.Error = err.Error()
			return
		}
		reply.View = &view
	case "live-cutoff":
		s.mu.Lock()
		runtime := s.workAuthority
		s.mu.Unlock()
		if runtime == nil || runtime.owner != q.Owner || runtime.authority.context.cutoff == nil {
			reply.Error = errMonitoringCutoff.Error()
			return
		}
		var err error
		outgoing, err = runtime.authority.context.cutoff.descriptor()
		if err != nil {
			reply.Error = err.Error()
			return
		}
		reply.Cutoff = &monitoringCutoffDescriptor{Version: 1, Owner: runtime.owner, DeadlineBootMS: runtime.deadlineBootMS, SupervisorPID: os.Getpid()}
	case "expire":
		s.mu.Lock()
		runtime := s.workAuthority
		s.mu.Unlock()
		if runtime == nil || runtime.owner != q.Owner {
			reply.Error = errMonitoringScope.Error()
			return
		}
		view := runtime.authority.check()
		reply.View = &view
		if view.ExecutionAuthorized {
			return
		} // Old observer cannot revoke a newer verified renewal.
		held, err := s.holdAuthority(q.Owner, "native-expiry")
		reply.Hold = &held
		if err != nil {
			reply.Error = err.Error()
		}
	case "prepare-resume", "prepare-resume-recovery":
		var resume terminalResumePrepared
		var err error
		if q.Op == "prepare-resume" {
			resume, err = s.prepareAuthorityResume(q.Owner, q.Generation)
		} else {
			resume, err = s.prepareAuthorityResumeRecovery(q.Owner, q.Nonce)
		}
		if err != nil {
			reply.Error = err.Error()
			return
		}
		s.mu.Lock()
		runtime := s.workAuthority
		if runtime == nil || runtime.resume == nil || runtime.resume.Nonce != resume.Nonce || runtime.resume.Owner != resume.Owner {
			s.mu.Unlock()
			reply.Error = errMonitoringScope.Error()
			return
		}
		// The original policy authorization owner may predate a partially
		// installed transition. Return the ACTUAL held actor separately.
		owner := runtime.owner
		s.mu.Unlock()
		reply.Resume, reply.HeldOwner = &resume, &owner
	case "commit-resume", "resume-result":
		view, epochs, err := s.commitAuthorityResume(q)
		if err != nil {
			reply.Error = err.Error()
			return
		}
		reply.View, reply.InputEpochs = &view, epochs
	case "register-launch", "cancel-launch", "launch-ready":
		s.mu.Lock()
		runtime := s.workAuthority
		if runtime == nil || runtime.owner != q.Owner || q.Proof == nil || q.Proof.Attempt != s.id || q.Proof.Boot != boot() {
			s.mu.Unlock()
			reply.Error = errMonitoringScope.Error()
			return
		}
		pane, kind, incarnation, valid := recordedPaneIdentity(s.id, q.Unit)
		if !valid || kind != "scope" || q.Proof.Pane != pane || q.Proof.ID != incarnation || q.Proof.InputEpoch == "" {
			s.mu.Unlock()
			reply.Error = errMonitoringScope.Error()
			return
		}
		prior, exists := runtime.launches[q.Unit]
		if q.Op == "register-launch" {
			if !runtime.authority.check().ExecutionAuthorized || q.Proof.ReadyAt != 0 || q.Proof.Cancelled || q.Proof.ClosedUntil <= Millis() || (exists && prior != *q.Proof) || (!exists && len(runtime.launches) >= 4) {
				s.mu.Unlock()
				reply.Error = errMonitoringAuthority.Error()
				return
			}
			runtime.launches[q.Unit] = *q.Proof
		} else if !exists || prior.ID != q.Proof.ID || prior.InputEpoch != q.Proof.InputEpoch {
			s.mu.Unlock()
			reply.Error = errMonitoringScope.Error()
			return
		} else if q.Op == "cancel-launch" {
			if _, attached := s.requests[q.Unit]; attached {
				s.mu.Unlock()
				reply.Error = "attached pane requires actual scope cleanup before retirement"
				return
			}
			delete(runtime.launches, q.Unit) // Caller positively closed or never started its exact bootstrap.
		} else if !runtime.authority.check().ExecutionAuthorized {
			s.mu.Unlock()
			reply.Error = errMonitoringAuthority.Error()
			return
		}
		s.mu.Unlock()
	case "hold":
		view, err := s.holdAuthority(q.Owner, q.Cause)
		reply.Hold = &view
		if err != nil {
			reply.Error = err.Error()
		} else {
			s.mu.Lock()
			if r := s.workAuthority; r != nil {
				owner := r.owner
				reply.HeldOwner = &owner
			}
			s.mu.Unlock()
		}
	case "cancel-pending":
		s.cancelAuthorityPending(q.Nonce)
	case "commit":
		view, err := s.commitAuthority(q, caller)
		if err != nil {
			reply.Error = err.Error()
			return
		}
		reply.View = &view
	case "view", "revoke":
		s.mu.Lock()
		runtime := s.workAuthority
		s.mu.Unlock()
		if runtime == nil || runtime.owner != q.Owner {
			reply.Error = errMonitoringAuthority.Error()
			return
		}
		view := runtime.authority.check()
		if q.Op == "revoke" {
			var err error
			view, err = runtime.authority.revokeForVerifiedCause(q.Cause)
			if err != nil {
				reply.Error = err.Error()
				return
			}
		}
		reply.View = &view
		s.mu.Lock()
		hold := runtime.hold
		streams := make(map[string]*supervisedRecordingIO, len(s.timed))
		for unit, stream := range s.timed {
			streams[unit] = stream
		}
		s.mu.Unlock()
		if hold != nil {
			reply.Hold = &terminalHoldView{Phase: "pending"}
			if hold.mu.TryLock() {
				reply.Hold.Phase, reply.Hold.Error = hold.phase, hold.error
				hold.mu.Unlock()
			}
		}
		for unit, stream := range streams {
			if stream.inputGate == nil {
				continue
			}
			if q.Op == "revoke" {
				stream.inputGate.revoke()
				stream.resizeGate.revoke()
			}
			stream.inputGate.mu.Lock()
			held := stream.inputGate.held
			stream.inputGate.mu.Unlock()
			reply.Panes = append(reply.Panes, terminalAuthorityPaneView{Unit: unit, Pane: stream.recorder.pane, Held: held, DiscardedInput: stream.discardedInput.Load(), DiscardedResize: stream.discardedResize.Load()})
		}
	case "challenge", "proof":
		s.mu.Lock()
		runtime := s.workAuthority
		s.mu.Unlock()
		if runtime == nil || runtime.owner != q.Owner {
			reply.Error = errMonitoringAuthority.Error()
			return
		}
		if q.Op == "challenge" {
			challenge, err := runtime.authority.challenge()
			if err != nil {
				reply.Error = err.Error()
				return
			}
			reply.Challenge = &challenge
			return
		}
		if q.Frame == nil || len(q.Frame.Payload) > base64.StdEncoding.EncodedLen(monitoringEvidenceMaxBytes) {
			reply.Error = errMonitoringEvidence.Error()
			return
		}
		payload, err := base64.StdEncoding.Strict().DecodeString(q.Frame.Payload)
		var envelope struct {
			Nonce string `json:"nonce"`
		}
		if err != nil || json.Unmarshal(payload, &envelope) != nil {
			reply.Error = errMonitoringEvidence.Error()
			return
		}
		runtime.authority.mu.Lock()
		challenge, found := runtime.authority.challenges[envelope.Nonce]
		runtime.authority.mu.Unlock()
		now, clockErr := monitoringBootMillis()
		if !found || clockErr != nil {
			reply.Error = errMonitoringAuthority.Error()
			return
		}
		candidate, err := verifyMonitoringEvidence(*q.Frame, runtime.key, challenge, now)
		if err != nil {
			reply.Error = err.Error()
			return
		}
		receipt, err := runtime.authority.accept(candidate)
		if err != nil {
			reply.Error = err.Error()
			return
		}
		reply.Receipt = &receipt
		view := runtime.authority.check()
		reply.View = &view
	default:
		reply.Error = "unsupported authority operation; no work permission changed"
	}
}

func (e *Engine) prepareTerminalAuthority(original *net.UnixConn, a *Attempt, owner monitoringOwner, intent string) (*terminalAuthorityBegin, error) {
	key, err := publicKey(e.Config.GatewayPublicKey)
	if err != nil {
		return nil, err
	}
	reply, err := e.callTerminalAuthority(terminalAuthorityRequest{Op: "prepare", Attempt: a.ID, Owner: owner, Agent: e.Config.AgentID, GatewayKey: key, Grant: a.Grant, Intent: intent}, original, true)
	if err != nil {
		return nil, err
	}
	if reply.Begin == nil || reply.Begin.Attempt != a.ID || reply.Begin.Owner != owner || !monitoringDigest.MatchString(reply.Begin.Nonce) || reply.Begin.IssuedBootMS < 0 {
		return nil, errMonitoringScope
	}
	return reply.Begin, nil
}

func (e *Engine) cancelTerminalAuthority(p *terminalAuthorityBegin) {
	if p == nil {
		return
	}
	_, _ = e.callTerminalAuthority(terminalAuthorityRequest{Op: "cancel-pending", Attempt: p.Attempt, Owner: p.Owner, Nonce: p.Nonce}, nil, false)
}

func (e *Engine) commitTerminalAuthority(p *terminalAuthorityBegin, a *Attempt, verified verifiedGrantBegin) error {
	if p == nil || a == nil || a.State != "ACTIVE" || a.RegisteredOwner == nil || *a.RegisteredOwner != p.Owner || verified.bootstrap == nil {
		return errMonitoringScope
	}
	reply, err := e.callTerminalAuthority(terminalAuthorityRequest{Op: "commit", Attempt: p.Attempt, Owner: p.Owner, Nonce: p.Nonce, Frame: &verified.frame, State: a.State, Start: a.Start, Deadline: a.Deadline, OriginalDeadline: a.OriginalDeadline, DeadlineBootMS: int64(a.UptimeDeadline * 1000), VerifiedUntilBootMS: verified.until}, nil, false)
	if err != nil {
		return err
	}
	if reply.View == nil || !reply.View.ExecutionAuthorized {
		return fmt.Errorf("%w: bootstrap not live", errMonitoringAuthority)
	}
	e.registerTerminalMonitoring(p.Attempt, p.Owner, int64(a.UptimeDeadline*1000))
	return nil
}
