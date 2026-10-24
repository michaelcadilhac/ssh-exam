package core

// Runtime caller: the attempt supervisor's hold RPC. This holds its current
// registered writers and PTY input; it does not authorize Continue or restore
// permission after restart. Incomplete retained-mode admission stays disabled.

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/sys/unix"
)

var errTerminalHold = errors.New("retained workload hold is unverified; admissions and input remain revoked; preserve the original attempt and inspect panes supervisor before recovery")

// Only the compiled local test child narrows this inventory to its owned
// synthetic scopes. Production ALWAYS inventories the complete student UID.
var terminalHoldProcesses = func(uid int, units []string) ([]*uidProcess, error) { return pinUIDProcesses(uid) }

func (s *terminalSupervisor) observeAuthorityExpiry() {
	s.mu.Lock()
	r := s.workAuthority
	s.mu.Unlock()
	if r == nil || !r.live.Load() {
		return
	}
	view := r.authority.check()
	if view.ExecutionAuthorized {
		return
	}
	technical := false
	for _, cause := range view.Causes {
		if cause == "technical-expiry" || cause == "clock-unknown" || cause == "ownership-unknown" || cause == "deadline" {
			technical = true
		}
	}
	if !technical || !r.holdRunning.CompareAndSwap(false, true) {
		return
	}
	go func() { defer r.holdRunning.Store(false); _, _ = s.holdAuthority(r.owner, "native-expiry") }()
}

type terminalHoldGroup struct {
	process         *uidProcess
	originalStopped bool
	signalled       bool
}

type terminalHold struct {
	mu     sync.Mutex
	phase  string
	error  string
	groups map[int]*terminalHoldGroup
	scopes map[string]*os.File
	input  map[string]*paneInputDrain
	resize map[string]*paneInputDrain
}

type terminalHoldView struct {
	Phase string `json:"phase"`
	Error string `json:"error,omitempty"`
}

func (h *terminalHold) close() {
	if h == nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, g := range h.groups {
		g.process.close()
	}
	for _, scope := range h.scopes {
		scope.Close()
	}
}

func terminalScopeHandle(unit string) (*os.File, error) {
	group, err := terminalWorkloadGroup(unit)
	name := strings.TrimSuffix(strings.TrimPrefix(group, "0::"), "\n")
	if err != nil || name == "" || !strings.HasPrefix(name, "/") || filepath.Clean(name) != name || filepath.Base(name) != unit {
		return nil, errTerminalHold
	}
	root, err := os.OpenRoot("/sys/fs/cgroup")
	if err != nil {
		return nil, err
	}
	defer root.Close()
	f, err := root.OpenFile(strings.TrimPrefix(name, "/"), os.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW, 0)
	if err != nil {
		return nil, err
	}
	if _, err := retainedScopeStat(f); err != nil {
		f.Close()
		return nil, err
	}
	return f, nil
}

func terminalScopeWrite(scope *os.File, name, value string) error {
	if name != "cgroup.freeze" || (value != "0" && value != "1") {
		return errTerminalHold
	}
	if _, err := retainedScopeStat(scope); err != nil {
		return err
	}
	fd, err := unix.Openat(int(scope.Fd()), name, unix.O_WRONLY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return err
	}
	f := os.NewFile(uintptr(fd), "owned-retained-freeze")
	_, writeErr := f.WriteString(value)
	return errors.Join(writeErr, f.Close())
}

func terminalScopeFrozen(scope *os.File) (bool, error) {
	if _, err := retainedScopeStat(scope); err != nil {
		return false, err
	}
	fd, err := unix.Openat(int(scope.Fd()), "cgroup.events", unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return false, err
	}
	f := os.NewFile(uintptr(fd), "owned-retained-events")
	defer f.Close()
	data := make([]byte, 4097)
	n, err := f.Read(data)
	if err != nil || n > 4096 {
		return false, errTerminalHold
	}
	for _, line := range strings.Split(string(data[:n]), "\n") {
		if line == "frozen 1" {
			return true, nil
		}
	}
	return false, nil
}

func terminalThreadGroup(tid, uid int) (int, error) {
	fd, err := unix.Open("/proc/"+strconv.Itoa(tid), unix.O_PATH|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return 0, err
	}
	f := os.NewFile(uintptr(fd), "retained-thread-group")
	defer f.Close()
	data, err := retainedProcRead(f, "status", 16384)
	id, _, parseErr := retainedStatus(data)
	if err != nil || parseErr != nil || id.TID != tid {
		return 0, errTerminalHold
	}
	for _, value := range id.UIDs {
		if value != uint32(uid) {
			return 0, errTerminalHold
		}
	}
	return id.TGID, nil
}

func (s *terminalSupervisor) holdAuthority(owner monitoringOwner, cause string) (terminalHoldView, error) {
	s.mu.Lock()
	runtime := s.workAuthority
	alias := runtime != nil && ((runtime.resume != nil && runtime.resume.Owner == owner) || (runtime.cancelledResumeOwner != nil && *runtime.cancelledResumeOwner == owner))
	if runtime == nil || (runtime.owner != owner && !alias) {
		s.mu.Unlock()
		return terminalHoldView{}, errMonitoringScope
	}
	if alias && runtime.owner != owner {
		cancelled := owner
		runtime.cancelledResumeOwner, runtime.resume = &cancelled, nil
	}
	// Linearize closed admission BEFORE inventory. Registration/attach use the
	// same supervisor mutex, so neither can enter between this close and copy.
	var revokeErr error
	if cause == "resume-unverified" || cause == "native-expiry" {
		_, revokeErr = runtime.authority.revokeForTechnicalCause(cause)
	} else {
		_, revokeErr = runtime.authority.revokeForVerifiedCause(cause)
	}
	if revokeErr != nil {
		s.mu.Unlock()
		return terminalHoldView{}, revokeErr
	}
	requests := make(map[string]terminalSupervisorAttach, len(s.requests))
	streams := make(map[string]*supervisedRecordingIO, len(s.timed))
	for unit, request := range s.requests {
		requests[unit] = request
	}
	for unit, stream := range s.timed {
		streams[unit] = stream
	}
	pendingLaunch := false
	for unit := range runtime.launches {
		if _, attached := requests[unit]; !attached {
			pendingLaunch = true
		}
	}
	if runtime.hold == nil {
		runtime.hold = &terminalHold{phase: "pending", groups: map[int]*terminalHoldGroup{}, scopes: map[string]*os.File{}, input: map[string]*paneInputDrain{}, resize: map[string]*paneInputDrain{}}
	}
	h := runtime.hold
	s.mu.Unlock()
	if !h.mu.TryLock() {
		return terminalHoldView{Phase: "pending"}, errTerminalHold
	}
	defer h.mu.Unlock()
	if h.phase == "held" {
		return terminalHoldView{Phase: "held"}, nil
	}
	h.phase, h.error = "pending", ""
	fail := func(err error) (terminalHoldView, error) {
		h.phase, h.error = "unverified", err.Error()
		return terminalHoldView{Phase: h.phase, Error: h.error}, errTerminalHold
	}
	for unit, stream := range streams {
		if stream.inputGate == nil || stream.resizeGate == nil || stream.inputPTY == nil {
			return fail(errPaneInputBarrier)
		}
		h.input[unit], h.resize[unit] = stream.inputGate.revoke(), stream.resizeGate.revoke()
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	for unit := range requests {
		if streams[unit] == nil {
			return fail(errors.New("pane handoff is still pending; no all-pane hold receipt"))
		}
		for _, drain := range []*paneInputDrain{h.input[unit], h.resize[unit]} {
			select {
			case <-drain.done:
			case <-ctx.Done():
				return fail(errors.New("pane input drain is still pending"))
			}
		}
		if h.scopes[unit] == nil {
			f, err := terminalScopeHandle(unit)
			if err != nil {
				return fail(err)
			}
			h.scopes[unit] = f
		}
	}
	units := make([]string, 0, len(requests))
	for unit := range requests {
		units = append(units, unit)
	}
	// SIGSTOP reaches the full pinned group BEFORE cgroup freezing. Repeat
	// inventory to include children created before their parent's stop completed.
	for {
		processes, err := terminalHoldProcesses(owner.UID, units)
		if err != nil {
			return fail(err)
		}
		for _, p := range processes {
			if h.groups[p.pid] != nil {
				p.close()
				continue
			}
			if len(h.groups) >= retainedThreadLimit {
				p.close()
				return fail(errors.New("retained writer inventory limit reached; hold remains unverified"))
			}
			cg, err := p.read("cgroup", 131072)
			contained := false
			for _, unit := range units {
				group, groupErr := terminalWorkloadGroup(unit)
				if groupErr == nil {
					prefix := strings.TrimSuffix(strings.TrimPrefix(group, "0::"), "\n")
					for _, line := range strings.Split(string(cg), "\n") {
						path := strings.TrimPrefix(line, "0::")
						contained = contained || path == prefix || strings.HasPrefix(path, prefix+"/")
					}
				}
			}
			if err != nil {
				p.close()
				return fail(err)
			}
			if !contained {
				exempt := false
				if trustedEntryExecutable(p.pid) {
					identity, err := transportIdentity(p.pid, owner.UID)
					exempt = err == nil && identity == owner.TransportHash && runtime.peer.current()
				}
				live, lifetimeErr := p.live()
				p.close()
				if lifetimeErr != nil || (live && !exempt) {
					return fail(errors.New("uncontained student UID process; retained hold unverified"))
				}
				continue
			}
			status, err := p.read("status", 16384)
			_, state, parseErr := retainedStatus(status)
			if err != nil || parseErr != nil {
				p.close()
				return fail(errTerminalHold)
			}
			h.groups[p.pid] = &terminalHoldGroup{process: p, originalStopped: state == 'T' || state == 't'}
		}
		allStopped := true
		for _, scope := range h.scopes {
			tree, err := observeRetainedScopeTree(scope)
			if err != nil {
				return fail(err)
			}
			for _, node := range tree {
				for _, tid := range node.Threads {
					tgid, err := terminalThreadGroup(tid, owner.UID)
					if err != nil {
						return fail(err)
					}
					g := h.groups[tgid]
					if g == nil {
						allStopped = false
						continue
					}
					observation, err := observeRetainedTask(g.process, tid, owner.UID)
					if err != nil {
						return fail(err)
					}
					for _, state := range observation.States {
						if state != 'T' && state != 't' && state != 'Z' {
							allStopped = false
						}
					}
					if !g.originalStopped && !g.signalled {
						if err := g.process.control(func(fd int) error { return unix.PidfdSendSignal(fd, unix.SIGSTOP, nil, 0) }); err != nil {
							return fail(err)
						}
						g.signalled, allStopped = true, false
					}
				}
			}
		}
		if allStopped {
			break
		}
		select {
		case <-ctx.Done():
			return fail(errors.New("all writer threads did not reach a verified stop"))
		case <-time.After(5 * time.Millisecond):
		}
	}
	for _, scope := range h.scopes {
		if err := terminalScopeWrite(scope, "cgroup.freeze", "1"); err != nil {
			return fail(err)
		}
	}
	for _, scope := range h.scopes {
		for {
			frozen, err := terminalScopeFrozen(scope)
			if err != nil {
				return fail(err)
			}
			if frozen {
				break
			}
			select {
			case <-ctx.Done():
				return fail(errTerminalHold)
			case <-time.After(5 * time.Millisecond):
			}
		}
	}
	for unit, stream := range streams {
		if err := stream.inputPTY.discardKernelInput(h.input[unit]); err != nil {
			return fail(err)
		}
	}
	// Recheck every live UID group AFTER freeze. A new or escaped process can
	// never be hidden by an earlier scope snapshot or an empty canonical row.
	check, err := terminalHoldProcesses(owner.UID, units)
	if err != nil {
		return fail(err)
	}
	defer closeUIDProcesses(check)
	for _, p := range check {
		if h.groups[p.pid] == nil {
			live, err := p.live()
			exempt := false
			if trustedEntryExecutable(p.pid) {
				identity, err := transportIdentity(p.pid, owner.UID)
				exempt = err == nil && identity == owner.TransportHash && runtime.peer.current()
			}
			if err != nil || (live && !exempt) {
				return fail(fmt.Errorf("new or uncontained student process %d after freeze", p.pid))
			}
		}
	}
	// Unresolved closed launchers forbid an all-writer receipt. They must not,
	// however, prevent containment of the positively known running workloads.
	if pendingLaunch {
		return fail(errors.New("registered closed pane launch is still pending; known writers frozen but no all-writer hold receipt"))
	}
	h.phase = "held"
	return terminalHoldView{Phase: "held"}, nil
}
