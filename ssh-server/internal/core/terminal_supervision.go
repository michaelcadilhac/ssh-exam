package core

// Terminal lifetime is separate from admission/metadata authority. The private
// supervisor owns descriptors, not passwords, signing keys or an execution
// permit. No record on disk can recreate a closed bootstrap's one-use release.
import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/unix"
)

const terminalSupervisorRole = "--terminal-supervisor-v1"
const terminalSupervisorBytes = 32768

var errTerminalSupervisor = errors.New("independent terminal supervision unavailable; no exec permission granted by this check; preserve work/tracking and inspect examctl panes show ATTEMPT PANE; verify matching loaded native roles before retrying")

type terminalSupervisorInit struct {
	Attempt string `json:"attempt"`
	State   string `json:"state"`
}
type terminalSupervisorAttach struct {
	RegisteredOwner monitoringOwner          `json:"registered_owner,omitzero"`
	Attempt         string                   `json:"attempt"`
	Pane            string                   `json:"pane"`
	Unit            string                   `json:"unit"`
	PID             int                      `json:"pid"`
	UID             int                      `json:"uid"`
	Username        string                   `json:"username"`
	Purpose         string                   `json:"purpose"`
	Expires         int64                    `json:"expires"`
	Proof           PaneInstance             `json:"proof"`
	Recording       terminalRecordingContext `json:"recording,omitzero"`
	RecordingLimit  int64                    `json:"recording_limit,omitempty"`
}

func terminalSupervisorUnit(state, id string) string {
	return "exam-terminal-" + id + "-" + Hash([]byte(state))[:32] + ".scope"
}

// A ready ordinary PRACTICE scope cannot be created later: the parent already
// verified the closed bootstrap inside that exact non-restarting scope before
// releasing it. Reap only positively empty/gone current-boot practice records;
// never infer emptiness from an IO error, pending start or a timed attempt.
func (e *Engine) reapSupervisedPracticePanes() {
	for _, a := range e.state.Attempts {
		if a.State != "PREPARING" || a.Start != 0 {
			continue
		}
		for _, unit := range append([]string(nil), a.Units...) {
			proof := e.state.PaneInstances[unit]
			if proof.Supervisor != terminalSupervisorUnit(e.Config.State, a.ID) || !paneInstanceReady(e.state, a, unit, boot()) {
				continue
			}
			empty, err := emptyRecordedScope("/sys/fs/cgroup/exam.slice/" + unit)
			if err == nil && empty {
				removePaneUnit(e.state.PaneInstances, a, unit)
			}
		}
	}
}

// Only tests replace these system-manager/entry seams. No configuration or
// environment switch can select the test namespace or a different executable.
var terminalSupervisorCommand = func(unit string, files []*os.File) *exec.Cmd {
	cmd := exec.Command("/usr/bin/systemd-run", "--scope", "--quiet", "--slice=examterminal.slice", "--unit="+unit,
		"--property=MemoryMax=64M", "--property=MemorySwapMax=0", "--property=TasksMax=64", "--",
		"/proc/self/fd/4", terminalSupervisorRole, strings.TrimPrefix(unit, "exam-terminal-")[:36], unit)
	cmd.ExtraFiles = files
	cmd.Env = []string{"PATH=/usr/bin:/bin", "GOMAXPROCS=2", "GOMEMLIMIT=48MiB"}
	return cmd
}
var terminalSupervisorGroup = func(unit string) (string, error) { return "0::/examterminal.slice/" + unit + "\n", nil }
var terminalWorkloadGroup = func(unit string) (string, error) { return "0::/exam.slice/" + unit + "\n", nil }

func validateTerminalSlice(data string) error {
	properties := map[string]string{}
	for _, line := range strings.Split(data, "\n") {
		key, value, ok := strings.Cut(line, "=")
		if ok {
			if _, duplicate := properties[key]; duplicate {
				return errTerminalSupervisor
			}
			properties[key] = value
		}
	}
	if properties["LoadState"] != "loaded" || properties["FragmentPath"] == "" || properties["MemoryAccounting"] != "yes" || properties["TasksAccounting"] != "yes" {
		return errors.New("independent terminal slice is not installed/loaded with resource accounting; inspect the supplied examterminal.slice in separately authorized drained maintenance, then rerun examctl health; do not restart an active agent or relax containment")
	}
	return nil
}

func terminalSupervisorReadiness() error {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	data, err := exec.CommandContext(ctx, "/usr/bin/systemctl", "show", "examterminal.slice", "--property=LoadState", "--property=FragmentPath", "--property=MemoryAccounting", "--property=TasksAccounting").Output()
	if err != nil {
		return errors.New("cannot inspect independent terminal slice; preserve work and inspect examctl health during authorized maintenance, never restart an active agent to bypass this refusal")
	}
	return validateTerminalSlice(string(data))
}

func terminalSupervisorCaller(c *net.UnixConn, exe *os.File) (*uidProcess, error) {
	cred, err := peer(c)
	if err != nil || cred.Uid != uint32(os.Geteuid()) {
		return nil, errTerminalSupervisor
	}
	caller, err := pinUIDProcess(int(cred.Pid), os.Geteuid())
	if err != nil || caller == nil {
		return nil, errTerminalSupervisor
	}
	expected, err := exe.Stat()
	actual, aerr := os.Stat(fmt.Sprintf("/proc/%d/exe", cred.Pid))
	live, lerr := caller.live()
	if err != nil || aerr != nil || !os.SameFile(expected, actual) || lerr != nil || !live {
		caller.close()
		return nil, errTerminalSupervisor
	}
	return caller, nil
}

func terminalDecode(data []byte, value any) error {
	if len(data) == 0 || len(data) > terminalSupervisorBytes || !validReadOnlyJSON(data) {
		return errTerminalSupervisor
	}
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if d.Decode(value) != nil {
		return errTerminalSupervisor
	}
	if d.Decode(new(any)) != io.EOF {
		return errTerminalSupervisor
	}
	return nil
}

func terminalSupervisorPeer(c *net.UnixConn, executable *os.File, unit string) (*paneBootstrapPeer, error) {
	// The listener was inherited: SO_PEERCRED would name its creator (the
	// coordinator), NOT the current accepting supervisor. Authenticate the real
	// sender's kernel SCM_CREDENTIALS after enabling them and sending a hello.
	raw, err := c.SyscallConn()
	if err != nil {
		return nil, errTerminalSupervisor
	}
	var optionErr error
	setCred := func(value int) error {
		return raw.Control(func(fd uintptr) { optionErr = unix.SetsockoptInt(int(fd), unix.SOL_SOCKET, unix.SO_PASSCRED, value) })
	}
	if setCred(1) != nil || optionErr != nil {
		return nil, errTerminalSupervisor
	}
	_ = c.SetDeadline(time.Now().Add(3 * time.Second))
	if _, err := c.Write([]byte{0}); err != nil {
		return nil, errTerminalSupervisor
	}
	group, err := terminalSupervisorGroup(unit)
	if err != nil {
		return nil, errTerminalSupervisor
	}
	now, err := monitoringBootMillis()
	if err != nil {
		return nil, errTerminalSupervisor
	}
	result, err := awaitPaneBootstrapIdentity(c, executable, group, os.Geteuid(), Millis()+3000, now+3000)
	if err != nil {
		return nil, errTerminalSupervisor
	}
	if setCred(0) != nil || optionErr != nil {
		result.process.close()
		return nil, errTerminalSupervisor
	}
	base := "/sys/fs/cgroup" + strings.TrimSuffix(strings.TrimPrefix(group, "0::"), "\n")
	for leaf, want := range map[string]string{"memory.max": "67108864", "memory.swap.max": "0", "pids.max": "64"} {
		b, err := os.ReadFile(base + "/" + leaf)
		if err != nil || strings.TrimSpace(string(b)) != want {
			result.process.close()
			return nil, errTerminalSupervisor
		}
	}
	return result, nil
}

func terminalSupervisorDirectory(state string) (*os.File, error) {
	root, err := readOnlyRoot(state)
	if err != nil {
		return nil, errTerminalSupervisor
	}
	defer root.Close()
	dir, err := templateEnsureDirectory(root, "terminal-supervisors")
	if err != nil {
		return nil, errTerminalSupervisor
	}
	return dir, nil
}

func terminalSupervisorDial(dir *os.File, state, id string, exe *os.File) (*net.UnixConn, *paneBootstrapPeer, error) {
	c, err := net.DialUnix("unixpacket", nil, &net.UnixAddr{Name: fmt.Sprintf("/proc/self/fd/%d/%s.sock", dir.Fd(), id), Net: "unixpacket"})
	if err != nil {
		return nil, nil, err
	}
	p, err := terminalSupervisorPeer(c, exe, terminalSupervisorUnit(state, id))
	if err != nil {
		c.Close()
		return nil, nil, err
	}
	return c, p, nil
}

// Root-only lifetime claim; unlike the metadata actor claim, it is inherited by
// precisely this attempt's supervisor. It cannot exclude coordinator replacement.
func terminalSupervisorLock(dir *os.File, id string) (*os.File, error) {
	if !attemptID.MatchString(strings.TrimSuffix(id, ".reports")) {
		return nil, errTerminalSupervisor
	}
	fd, err := unix.Openat(int(dir.Fd()), id+".lock", unix.O_CREAT|unix.O_RDWR|unix.O_NOFOLLOW|unix.O_CLOEXEC|unix.O_NONBLOCK, 0600)
	if err != nil {
		return nil, errTerminalSupervisor
	}
	f := os.NewFile(uintptr(fd), "attempt-terminal-lifetime")
	i, err := f.Stat()
	if err != nil || !i.Mode().IsRegular() || i.Mode().Perm() != 0600 || i.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) || i.Sys().(*syscall.Stat_t).Nlink != 1 {
		f.Close()
		return nil, errTerminalSupervisor
	}
	if err := unix.Flock(fd, unix.LOCK_EX|unix.LOCK_NB); err != nil {
		f.Close()
		return nil, errors.Join(errTerminalSupervisor, err)
	}
	return f, nil
}

func (e *Engine) connectTerminalSupervisor(id string) (connection *net.UnixConn, supervisor *paneBootstrapPeer, resultErr error) {
	stage := "identity"
	defer func() {
		if resultErr != nil {
			resultErr = fmt.Errorf("%w (supervisor setup: %s)", errTerminalSupervisor, stage)
		}
	}()
	if !attemptID.MatchString(id) {
		return nil, nil, errTerminalSupervisor
	}
	stage = "private-directory"
	dir, err := terminalSupervisorDirectory(e.Config.State)
	if err != nil {
		return nil, nil, err
	}
	defer dir.Close()
	stage = "loaded-executable"
	exe, err := paneBootstrapExecutable()
	if err != nil {
		return nil, nil, err
	}
	defer exe.Close()
	if c, p, err := terminalSupervisorDial(dir, e.Config.State, id, exe); err == nil {
		return c, p, nil
	}
	stage = "lifetime-claim"
	lock, err := terminalSupervisorLock(dir, id)
	if err != nil {
		return nil, nil, err
	}
	defer lock.Close()
	// Another coordinator may have finished startup before our lock attempt.
	if c, p, err := terminalSupervisorDial(dir, e.Config.State, id, exe); err == nil {
		return c, p, nil
	}
	stage = "pinned-directory"
	root, err := templatePinnedRoot(dir)
	if err != nil {
		return nil, nil, errTerminalSupervisor
	}
	defer root.Close()
	stage = "stale-socket"
	name := id + ".sock"
	if info, err := root.Lstat(name); err == nil {
		if info.Mode()&os.ModeSocket == 0 || info.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) || info.Mode().Perm() != 0600 {
			return nil, nil, errTerminalSupervisor
		}
		if root.Remove(name) != nil {
			return nil, nil, errTerminalSupervisor
		}
	} else if !os.IsNotExist(err) {
		return nil, nil, errTerminalSupervisor
	}
	stage = "private-listener"
	listener, err := net.ListenUnix("unixpacket", &net.UnixAddr{Name: fmt.Sprintf("/proc/self/fd/%d/%s", dir.Fd(), name), Net: "unixpacket"})
	if err != nil {
		return nil, nil, errTerminalSupervisor
	}
	listener.SetUnlinkOnClose(false)
	defer listener.Close()
	stage = "listener-mode"
	if root.Chmod(name, 0600) != nil {
		return nil, nil, errTerminalSupervisor
	}
	stage = "listener-descriptor"
	lf, err := listener.File()
	if err != nil {
		return nil, nil, errTerminalSupervisor
	}
	defer lf.Close()
	stage = "handshake-descriptors"
	control, child, err := paneBootstrapSocket()
	if err != nil {
		return nil, nil, errTerminalSupervisor
	}
	defer control.Close()
	defer child.Close()
	stage = "manager-start"
	cmd := terminalSupervisorCommand(terminalSupervisorUnit(e.Config.State, id), []*os.File{lf, exe, lock, child})
	if err := cmd.Start(); err != nil {
		return nil, nil, errTerminalSupervisor
	}
	go func() { _ = cmd.Wait() }() // Reap only; supervisor lifetime is independent.
	child.Close()
	stage = "initial-configuration"
	if err := control.SetDeadline(time.Now().Add(3 * time.Second)); err != nil {
		return nil, nil, errTerminalSupervisor
	}
	// No configuration, keys, credentials, global attempt map or live permit
	// enters the practice supervisor. State identifies its private lifetime claim.
	b, _ := json.Marshal(terminalSupervisorInit{Attempt: id, State: e.Config.State})
	if len(b) > terminalSupervisorBytes {
		return nil, nil, errTerminalSupervisor
	}
	if _, err := control.Write(b); err != nil {
		return nil, nil, errTerminalSupervisor
	}
	stage = "scope-observation"
	group, err := terminalSupervisorGroup(terminalSupervisorUnit(e.Config.State, id))
	if err != nil {
		return nil, nil, errTerminalSupervisor
	}
	now, err := monitoringBootMillis()
	if err != nil {
		return nil, nil, errTerminalSupervisor
	}
	stage = "ready-handshake"
	p, err := awaitPaneBootstrapIdentity(control, exe, group, os.Geteuid(), Millis()+3000, now+3000)
	if err != nil {
		return nil, nil, errTerminalSupervisor
	}
	p.process.close()
	stage = "verified-connection"
	return terminalSupervisorDial(dir, e.Config.State, id, exe)
}

func (e *Engine) handoffTerminal(c *net.UnixConn, original, master *os.File, p *paneLaunchAdmission, unit string, process *uidProcess) (result *paneBootstrapPeer, resultErr error) {
	stage := "purpose"
	defer func() {
		if resultErr != nil {
			resultErr = fmt.Errorf("%w (terminal handoff: %s): %v", errTerminalSupervisor, stage, resultErr)
		}
	}()
	if p.capability.Purpose != "practice" && !(p.capability.Purpose == "exam" && p.authority.TerminalSupervised && p.authority.BrowserSSH) {
		return nil, errTerminalSupervisor
	}
	stage = "owner-connect"
	control, supervisor, err := e.connectTerminalSupervisor(p.authority.ID)
	if err != nil {
		return nil, err
	}
	failed := true
	defer func() {
		if failed {
			control.Close()
			supervisor.process.close()
		}
	}()
	if err := control.SetDeadline(time.Now().Add(3 * time.Second)); err != nil {
		return nil, errTerminalSupervisor
	}
	accepted, err := c.File()
	if err != nil {
		return nil, errTerminalSupervisor
	}
	defer accepted.Close()
	if process == nil || process.handle == nil || process.proc == nil {
		return nil, errTerminalSupervisor
	}
	request := terminalSupervisorAttach{Attempt: p.authority.ID, Pane: p.capability.Pane, Unit: unit, PID: process.pid, UID: p.account.UID, Username: p.authority.Username, Purpose: p.capability.Purpose, Expires: p.capability.Expires, Proof: PaneInstance{Attempt: p.authority.ID, Pane: p.capability.Pane}}
	_, _, request.Proof.ID, _ = recordedPaneIdentity(p.authority.ID, unit)
	request.Proof.Boot = boot()
	fds := []int{int(accepted.Fd()), int(original.Fd()), int(master.Fd()), int(process.handle.Fd()), int(process.proc.Fd())}
	if request.Purpose == "exam" {
		stage = "scoped-recording-storage"
		p.recordingPID = supervisor.process.pid
		p.recordingStart, err = terminalOwnerStart(supervisor.process)
		if err != nil || p.closedProof == nil {
			return nil, errTerminalSupervisor
		}
		p.recordingOwner = terminalOwnerEpoch(terminalSupervisorUnit(e.Config.State, p.authority.ID), p.recordingPID, p.recordingStart)
		// Persist the verified owner before any descriptor transfer. A crash or
		// lost ready reply leaves bounded, restart-inspectable CLOSED tracking,
		// never an unowned report or reconstructible exec permit.
		if err := e.WithState(func() error {
			proof := *p.closedProof
			if e.state.PaneInstances[unit] != proof || proof.Cancelled {
				return errTerminalSupervisor
			}
			proof.RecordingOwner, proof.RecordingPID, proof.RecordingStart = p.recordingOwner, p.recordingPID, p.recordingStart
			e.state.PaneInstances[unit], *p.closedProof = proof, proof
			return nil
		}); err != nil {
			return nil, err
		}
		request.Recording, request.RecordingLimit = recordingContext(p.authority, request.Pane, unit), e.terminalRecordingLimit()
		if p.authority.RegisteredOwner != nil {
			request.RegisteredOwner = *p.authority.RegisteredOwner
		}
		resources, err := terminalRecordingResources(e.Config.State, request.Attempt)
		if err != nil {
			return nil, err
		}
		defer func() {
			for _, f := range resources {
				f.Close()
			}
		}()
		for _, f := range resources {
			fds = append(fds, int(f.Fd()))
		}
	}
	b, _ := json.Marshal(request)
	stage = "descriptor-transfer"
	_, _, err = control.WriteMsgUnix(b, unix.UnixRights(fds...), nil)
	if err != nil {
		return nil, errTerminalSupervisor
	}
	var ready [128]byte
	stage = "recording-owner-ready"
	n, _, flags, _, err := control.ReadMsgUnix(ready[:], nil)
	if err != nil || flags&(unix.MSG_TRUNC|unix.MSG_CTRUNC) != 0 || !supervisor.current() {
		return nil, errTerminalSupervisor
	}
	if request.Purpose == "practice" {
		if n != 1 || ready[0] != 1 {
			return nil, errTerminalSupervisor
		}
	} else {
		var acknowledgement struct {
			Owner string `json:"owner"`
			Error string `json:"error,omitempty"`
		}
		if terminalDecode(ready[:n], &acknowledgement) != nil {
			return nil, errTerminalSupervisor
		}
		if acknowledgement.Error != "" {
			return nil, errors.New(acknowledgement.Error)
		}
		if acknowledgement.Owner != p.recordingOwner {
			return nil, errTerminalSupervisor
		}
	}
	if control.SetDeadline(time.UnixMilli(p.capability.Expires)) != nil {
		return nil, errTerminalSupervisor
	}
	p.supervisorUnit = terminalSupervisorUnit(e.Config.State, p.authority.ID)
	p.supervisor = supervisor
	p.supervisorControl = control
	if e.terminalHandoffCheckpoint != nil {
		e.terminalHandoffCheckpoint()
	}
	failed = false
	return supervisor, nil
}

// Physical owner death is a kernel pidfd exit, never a timeout or missing reply.
// While the coordinator is alive it independently contains a failed owner's
// exact pane, including detached writers. Natural-exit backup cleanup closes the
// small owner-death/metadata-completion race without touching any other pane.
func (e *Engine) waitSupervisedPane(p *paneLaunchAdmission, unit string, c *net.UnixConn, wait func()) {
	var finish sync.Once
	cleanup := func(ownerExited bool) {
		finish.Do(func() {
			ownedAtExit := p.recordingOwner != "" // Verified original socket owner; not current work authority.
			closed := p.authority
			closed.Units = []string{unit}
			terminationErr := e.terminate(&closed)
			if p.recordingOwner != "" && ownerExited {
				_ = e.reconcileTerminalRecordingReports()
			}
			if p.recordingOwner != "" && !ownerExited {
				// Scope exit precedes the independent recorder's final drain. Keep
				// canonical tracking until its durable completion is acknowledged.
				for until := time.Now().Add(3 * time.Second); time.Now().Before(until); {
					_ = e.reconcileTerminalRecordingReports()
					pending := false
					_ = e.WithState(func() error { _, pending = e.state.PaneInstances[unit]; return nil })
					if !pending {
						return
					}
					time.Sleep(20 * time.Millisecond)
				}
				return // Unknown completion remains visible for Tick/CLI retry.
			}
			_ = e.WithState(func() error {
				a := e.state.Attempts[closed.ID]
				proof := e.state.PaneInstances[unit]
				pane, _, instance, ok := recordedPaneIdentity(closed.ID, unit)
				if a == nil || !ok || proof.Attempt != closed.ID || proof.Pane != pane || proof.ID != instance || proof.Supervisor != p.supervisorUnit || proof.Boot != boot() {
					return nil
				}
				ownedAtExit = true
				if terminationErr != nil {
					a.Errors = appendError(a.Errors, "Terminal-owner cleanup unconfirmed; preserve the recorded pane and inspect matching native guards")
					if ownerExited && a.State == "ACTIVE" {
						_, err := e.callLocked("lock-attempt", Request{ID: a.ID, Reason: "Class-server terminal owner failed; containment unconfirmed (not a student violation)"})
						return err
					}
					return nil
				}
				if p.recordingOwner != "" {
					return nil
				}
				removePaneUnit(e.state.PaneInstances, a, unit)
				return nil
			})
			if ownerExited && ownedAtExit {
				e.Audit("terminal-supervisor-exited", closed.ID, "Verified terminal-owner process exit, not a student violation; exact pane cleanup attempted")
				_ = c.SetWriteDeadline(time.Now().Add(time.Second))
				_ = json.NewEncoder(c).Encode(map[string]string{"error": "class-server terminal owner exited; no student violation inferred; preserve the original attempt/deadline and inspect examctl panes show ATTEMPT PANE before reopening this pane"})
			}
		})
	}
	stop, done := make(chan struct{}), make(chan struct{})
	go func() {
		defer close(done)
		timer := time.NewTicker(50 * time.Millisecond)
		defer timer.Stop()
		for {
			select {
			case <-stop:
				return
			case <-timer.C:
				live, err := p.supervisor.process.live()
				if err == nil && !live {
					cleanup(true)
					return
				}
			}
		}
	}()
	wait()
	close(stop)
	<-done
	live, err := p.supervisor.process.live()
	cleanup(err == nil && !live)
}

type terminalSupervisor struct {
	registeredOwner *monitoringOwner
	id, unit        string
	state, owner    string
	mu              sync.Mutex
	storageMu       sync.Mutex
	storage         *supervisedRecordingStorage
	timed           map[string]*supervisedRecordingIO
	requests        map[string]terminalSupervisorAttach
	panes           map[string]bool
	active          int
	uid             int
	username        string
	last            time.Time
	cleanup         func(terminalSupervisorAttach) error
}

func (s *terminalSupervisor) cleanupPane(r terminalSupervisorAttach) error {
	// No global metadata reads/writes in a supervisor. The live coordinator
	// performs metadata cleanup; after its death, actual Tick/CLI handles the
	// preserved ready record and the original bounded preflight lifetime.
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return terminateRecordedScope(ctx, "/sys/fs/cgroup/exam.slice/"+r.Unit, r.Unit, func(ctx context.Context, args ...string) error {
		return exec.CommandContext(ctx, "/usr/bin/systemctl", args...).Run()
	})
}

func (s *terminalSupervisor) attach(c *net.UnixConn, exe *os.File) {
	defer c.Close()
	_ = c.SetDeadline(time.Now().Add(3 * time.Second))
	var hello [2]byte
	helloOOB := make([]byte, unix.CmsgSpace(5*4))
	hn, ho, hflags, _, herr := c.ReadMsgUnix(hello[:], helloOOB)
	helloRights, helloErr := receiveBoundedDescriptors(helloOOB[:ho], hflags, 0)
	helloRights.close()
	creator, cerr := peer(c)
	if herr != nil || helloErr != nil || hn != 1 || hello[0] != 0 || cerr != nil || creator.Uid != uint32(os.Geteuid()) {
		return
	}
	if _, err := c.Write([]byte{1}); err != nil {
		return
	}
	buf := make([]byte, terminalSupervisorBytes+1)
	oob := make([]byte, unix.CmsgSpace(8*4))
	n, on, flags, _, err := c.ReadMsgUnix(buf, oob)
	owned, descriptorErr := receiveBoundedDescriptors(oob[:on], flags, 8)
	defer owned.close()
	if err != nil || descriptorErr != nil {
		return
	}
	if len(owned.files) == 0 {
		var query struct {
			Purpose string `json:"purpose"`
			Attempt string `json:"attempt"`
		}
		if terminalDecode(buf[:n], &query) != nil || query.Purpose != terminalObservationPurpose || query.Attempt != s.id {
			return
		}
		// The hello already required a kernel owner-UID peer (root in installed
		// roles). Metadata-only CLI inspection needs no loaded-agent exec role;
		// it accepts NO descriptors and grants no work/control authority.
		_ = json.NewEncoder(c).Encode(s.observation())
		return
	}
	if len(owned.files) != 5 && len(owned.files) != 8 {
		return
	}
	caller, err := terminalSupervisorCaller(c, exe)
	if err != nil || caller == nil {
		return
	}
	defer caller.close()
	var r terminalSupervisorAttach
	if terminalDecode(buf[:n], &r) != nil || r.Attempt != s.id || !attemptID.MatchString(r.Pane) || r.PID <= 1 || r.UID < 0 || r.Proof.Attempt != s.id || r.Proof.Pane != r.Pane || r.Proof.Boot != boot() || r.Expires <= Millis() || r.Expires > Millis()+15000 {
		return
	}
	timed := r.Purpose == "exam"
	bound := r.RegisteredOwner != (monitoringOwner{})
	if bound && (!timed || !validMonitoringOwner(r.RegisteredOwner) || r.RegisteredOwner.Attempt != s.id || r.RegisteredOwner.Username != r.Username || r.RegisteredOwner.UID != r.UID || r.RegisteredOwner.Boot != r.Proof.Boot) {
		return
	}
	if timed {
		if bound && (r.RegisteredOwner.Generation != r.Recording.Generation || Hash([]byte(r.RegisteredOwner.TransportHash)) != r.Recording.TransportHash) {
			return
		}
		if len(owned.files) != 8 || !r.Recording.valid() || r.Recording.Attempt != r.Attempt || r.Recording.Pane != r.Pane || r.Recording.Unit != r.Unit || r.Recording.Username != r.Username || r.Recording.UID != r.UID || r.Recording.Boot != r.Proof.Boot || r.RecordingLimit <= 0 {
			return
		}
	} else if r.Purpose != "practice" || len(owned.files) != 5 || r.Recording != (terminalRecordingContext{}) || r.RecordingLimit != 0 {
		return
	}
	pane, kind, incarnation, ok := recordedPaneIdentity(s.id, r.Unit)
	if !ok || kind != "scope" || pane != r.Pane || incarnation != r.Proof.ID {
		return
	}
	accepted, err := net.FileConn(owned.files[0])
	if err != nil {
		return
	}
	defer accepted.Close()
	outer, ok := accepted.(*net.UnixConn)
	if !ok {
		return
	}
	student, err := peer(outer)
	if err != nil || student.Uid != uint32(r.UID) {
		return
	}
	for _, f := range owned.files[1:3] {
		var term syscall.Termios
		if ioctl(f.Fd(), syscall.TCGETS, unsafe.Pointer(&term)) != nil {
			return
		}
	}
	process := &uidProcess{pid: r.PID, handle: owned.files[3], proc: owned.files[4]}
	live, err := process.live()
	group, gerr := terminalWorkloadGroup(r.Unit)
	actualGroup, aerr := process.read("cgroup", 4096)
	if err != nil || !live || gerr != nil || aerr != nil || string(actualGroup) != group {
		return
	}
	current, cerr := caller.live()
	if cerr != nil || !current {
		return
	}
	s.mu.Lock()
	if s.registeredOwner != nil {
		old, next := *s.registeredOwner, r.RegisteredOwner
		old.ClockRevision, next.ClockRevision = 0, 0
		if !bound || (old != next && len(s.timed) != 0) || (old == next && r.RegisteredOwner.ClockRevision < s.registeredOwner.ClockRevision) {
			s.mu.Unlock()
			return
		}
	} else if bound && len(s.timed) != 0 {
		s.mu.Unlock()
		return
	}
	_, duplicate := s.panes[r.Unit]
	if s.active >= 4 || duplicate || (s.uid >= 0 && (s.uid != r.UID || s.username != r.Username)) {
		s.mu.Unlock()
		return
	}
	s.panes[r.Unit] = false // Attached, but no normal startup notice observed yet.
	s.uid, s.username = r.UID, r.Username
	if bound {
		owner := r.RegisteredOwner
		s.registeredOwner = &owner
	}
	s.active++
	s.last = time.Now()
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.panes, r.Unit)
		delete(s.timed, r.Unit)
		delete(s.requests, r.Unit)
		s.active--
		s.last = time.Now()
		s.mu.Unlock()
	}()
	original, master := owned.files[1], owned.files[2]
	if timed {
		s.attachRecorded(c, outer, original, master, process, caller, r, owned.files[5:])
		return
	}
	done := make(chan struct{})
	defer close(done)
	bridgePTY(original, master, done)
	if _, err := c.Write([]byte{1}); err != nil {
		return
	}
	// The coordinator decides who reports completion after its final durable
	// release attempt. This notice cannot authorize exec or change the deadline.
	_ = c.SetReadDeadline(time.UnixMilli(r.Expires))
	var notice [2]byte
	nn, _, noticeFlags, _, noticeErr := c.ReadMsgUnix(notice[:], nil)
	verdict := byte(0)
	if noticeErr == nil && nn == 1 && noticeFlags&(unix.MSG_TRUNC|unix.MSG_CTRUNC) == 0 && (notice[0] == 1 || notice[0] == 2) {
		verdict = notice[0]
	}
	s.mu.Lock()
	s.panes[r.Unit] = verdict == 1 // Reply ownership diagnostic, NEVER exec authority.
	s.mu.Unlock()
	for {
		live, err := process.live()
		if err != nil || !live {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	// Accepted socket/PTY lifetimes stay here even if the coordinator and its
	// duplicated descriptors die. No new input/permission is created by survival.
	cleanupErr := s.cleanup(r)
	if verdict == 2 {
		return
	} // Live coordinator reports its startup refusal.
	if verdict == 0 {
		if live, err := caller.live(); err == nil && live {
			return
		} // Failed handoff's live owner still reports.
		_ = json.NewEncoder(outer).Encode(map[string]string{"error": "terminal ended with an unconfirmed coordinator startup outcome; preserve the attempt/deadline and inspect examctl panes show ATTEMPT PANE; never infer a fresh allowance"})
		return
	}
	if cleanupErr != nil {
		_ = json.NewEncoder(outer).Encode(map[string]string{"error": "pane ended; exact workload cleanup unconfirmed; preserve tracking and inspect examctl panes show ATTEMPT PANE"})
		return
	}
	_ = json.NewEncoder(outer).Encode(map[string]bool{"ended": true})
}

// A recording fault revokes input and contains only panes of this exact saved
// authority. It is negative evidence, never a monitoring/exec permission source.
func (s *terminalSupervisor) containRecordingAuthority(r terminalSupervisorAttach) {
	s.mu.Lock()
	var targets []terminalSupervisorAttach
	for unit, request := range s.requests {
		if unit == r.Unit {
			if stream := s.timed[unit]; stream != nil {
				stream.cancelInput()
			}
			targets = append(targets, request)
		}
	}
	s.mu.Unlock()
	var workers sync.WaitGroup
	for _, target := range targets {
		workers.Go(func() { _ = s.cleanup(target) })
	}
	workers.Wait()
}

func (s *terminalSupervisor) attachRecorded(c, outer *net.UnixConn, original, master *os.File, process, caller *uidProcess, r terminalSupervisorAttach, resources []*os.File) {
	refusal := func(stage string) { _ = json.NewEncoder(c).Encode(map[string]string{"error": stage}) }
	candidate, err := newSupervisedRecordingStorage(s.state, s.id, r.RecordingLimit, resources)
	if err != nil {
		refusal("scoped recording storage validation failed")
		return
	}
	s.storageMu.Lock()
	if s.storage == nil {
		s.storage = candidate
	} else {
		candidate.close()
		if s.storage.limit != r.RecordingLimit {
			s.storageMu.Unlock()
			return
		}
	}
	storage := s.storage
	// A full/unreadable queue refuses another closed handoff. Never discard a
	// failure or stage file to create capacity for new execution.
	listing, err := os.Open(fmt.Sprintf("/proc/self/fd/%d", storage.reports.Fd()))
	if err != nil {
		s.storageMu.Unlock()
		return
	}
	entries, readErr := listing.ReadDir(terminalRecordingReportEntries + 1)
	listing.Close()
	if (readErr != nil && readErr != io.EOF) || len(entries) >= terminalRecordingReportEntries {
		s.storageMu.Unlock()
		refusal("recording report queue full or unsafe; inspect panes reports and reconcile")
		return
	}
	for _, entry := range entries {
		pending, _, err := readTerminalRecordingReport(storage.reports, entry.Name())
		if err != nil || (pending.Fault != "" && pending.Context.authorityHash() == r.Recording.authorityHash()) {
			s.storageMu.Unlock()
			refusal("pending recording reports require canonical reconciliation before another pane")
			return
		}
	}
	recorder, err := storage.newRecorder(r.Pane, r.Recording.hash())
	if err != nil {
		refusal("private timed recording initialization failed")
		s.storageMu.Unlock()
		return
	}
	report := terminalRecordingReport{Context: r.Recording, Owner: s.owner, Version: 1, At: Millis()}
	err = publishTerminalRecordingReport(storage.reports, report)
	s.storageMu.Unlock()
	if err != nil {
		recorder.file.Close()
		refusal("durable timed recording report initialization failed")
		return
	}
	fault := make(chan struct{}, 1)
	stream, err := newSupervisedRecordingIO(recorder, original, master, func() {
		// Fault containment cannot wait for the normal startup notice: the
		// coordinator may still be syncing final readiness or may have died.
		// This IO worker has no canonical lock and targets only its verified
		// exact scope, with the existing bounded cleanup procedure.
		_ = s.cleanup(r)
		select {
		case fault <- struct{}{}:
		default:
		}
	})
	if err != nil {
		recorder.file.Close()
		return
	}
	s.mu.Lock()
	s.timed[r.Unit], s.requests[r.Unit] = stream, r
	refused := false
	s.mu.Unlock()
	verdict := byte(0)
	if !refused {
		ready, _ := json.Marshal(struct {
			Owner string `json:"owner"`
		}{s.owner})
		_, err = c.Write(ready)
		if err == nil {
			_ = c.SetReadDeadline(time.UnixMilli(r.Expires))
			var notice [2]byte
			n, _, flags, _, noticeErr := c.ReadMsgUnix(notice[:], nil)
			if noticeErr == nil && n == 1 && flags&(unix.MSG_TRUNC|unix.MSG_CTRUNC) == 0 && (notice[0] == 1 || notice[0] == 2) {
				verdict = notice[0]
			}
		}
	}
	s.mu.Lock()
	s.panes[r.Unit] = verdict == 1
	s.mu.Unlock()
	// A missing notice is UNKNOWN. It does not revoke a shell whose final gate
	// may already have committed; actual lifetime/transport/fault evidence does.
	for !refused {
		live, probeErr := process.live()
		if probeErr == nil && !live {
			break
		}
		select {
		case <-fault:
			s.containRecordingAuthority(r)
			report.Version++
			report.At, report.Fault = Millis(), "recording_io"
			_ = publishTerminalRecordingReport(storage.reports, report)
			refused = true
		case <-stream.inputEnded:
			refused = true // Actual outer terminal EOF, not a reply timeout.
		case <-time.After(20 * time.Millisecond):
		}
	}
	stream.cancelInput()
	cleanupErr := s.cleanup(r)
	if cleanupErr != nil {
		report.Version++
		report.At = Millis()
		// Missing/failed cleanup confirmation is uncertainty, not recording
		// loss. Keep its scope/report pending without inventing a policy fault.
		// A previously observed real recording failure remains sticky.
		_ = publishTerminalRecordingReport(storage.reports, report)
		// Keep this handler/recording tracked until actual cleanup is confirmed;
		// no false close receipt or new exec slot from a timer/IO error.
		for cleanupErr != nil {
			time.Sleep(time.Second)
			cleanupErr = s.cleanup(r)
		}
	}
	result := stream.finish()
	report.FaultStage = result.FaultStage
	if result.Fault != "" {
		s.containRecordingAuthority(r)
		report.Fault = result.Fault
	}
	report.Version++
	report.At, report.Closed = Millis(), true
	report.RecordingComplete, report.CleanupComplete, report.DeliveryComplete = result.RecordingComplete, true, result.DeliveryComplete
	if err := publishTerminalRecordingReport(storage.reports, report); err != nil {
		_ = outer.SetWriteDeadline(time.Now().Add(time.Second))
		_ = json.NewEncoder(outer).Encode(map[string]string{"error": "pane ended; recording completion acknowledgement unavailable; preserve recording/tracking and inspect examctl panes reports ATTEMPT, then reconcile"})
		return
	}
	if verdict == 2 {
		return
	}
	_ = outer.SetWriteDeadline(time.Now().Add(time.Second))
	if verdict == 0 {
		if live, err := caller.live(); err == nil && live {
			return
		}
		_ = json.NewEncoder(outer).Encode(map[string]string{"error": "terminal ended with an unconfirmed coordinator startup outcome; preserve the attempt/deadline and inspect examctl panes reports ATTEMPT"})
		return
	}
	if report.Fault != "" {
		_ = json.NewEncoder(outer).Encode(map[string]string{"error": "class-server terminal recording/cleanup failed; no student violation inferred; preserve attempt/deadline and inspect examctl panes reports ATTEMPT"})
		return
	}
	_ = json.NewEncoder(outer).Encode(map[string]bool{"ended": true})
}

func runTerminalSupervisor(id, unit string, listener *net.UnixListener, control *net.UnixConn, exe, lock *os.File, cleanup func(*terminalSupervisor, terminalSupervisorAttach) error) error {
	if !attemptID.MatchString(id) || lock == nil {
		return errTerminalSupervisor
	}
	info, err := lock.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || info.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) || info.Sys().(*syscall.Stat_t).Nlink != 1 || unix.Flock(int(lock.Fd()), unix.LOCK_EX|unix.LOCK_NB) != nil {
		return errTerminalSupervisor
	}
	caller, err := terminalSupervisorCaller(control, exe)
	if err != nil {
		return errTerminalSupervisor
	}
	defer caller.close()
	_ = control.SetDeadline(time.Now().Add(3 * time.Second))
	b := make([]byte, terminalSupervisorBytes+1)
	n, _, flags, _, err := control.ReadMsgUnix(b, nil)
	var init terminalSupervisorInit
	if err != nil || flags&(unix.MSG_TRUNC|unix.MSG_CTRUNC) != 0 || terminalDecode(b[:n], &init) != nil || init.Attempt != id || unit != terminalSupervisorUnit(init.State, id) {
		return errTerminalSupervisor
	}
	root, err := readOnlyRoot(init.State)
	if err != nil {
		return errTerminalSupervisor
	}
	root.Close()
	self, err := pinUIDProcess(os.Getpid(), os.Geteuid())
	if err != nil || self == nil {
		return errTerminalSupervisor
	}
	start, err := terminalOwnerStart(self)
	self.close()
	if err != nil {
		return errTerminalSupervisor
	}
	s := &terminalSupervisor{id: id, unit: unit, state: init.State, owner: terminalOwnerEpoch(unit, os.Getpid(), start), uid: -1, panes: map[string]bool{}, timed: map[string]*supervisedRecordingIO{}, requests: map[string]terminalSupervisorAttach{}, last: time.Now()}
	defer func() {
		if s.storage != nil {
			s.storage.close()
		}
	}()
	s.cleanup = s.cleanupPane
	if cleanup != nil {
		s.cleanup = func(r terminalSupervisorAttach) error { return cleanup(s, r) }
	}
	if _, err := control.Write([]byte{1}); err != nil {
		return errTerminalSupervisor
	}
	control.Close()
	slots := make(chan struct{}, 16)
	for {
		_ = listener.SetDeadline(time.Now().Add(time.Second))
		c, err := listener.AcceptUnix()
		if err == nil {
			select {
			case slots <- struct{}{}:
				go func() { defer func() { <-slots }(); s.attach(c, exe) }()
			default:
				c.Close()
			}
			continue
		}
		if timeout, ok := err.(net.Error); !ok || !timeout.Timeout() {
			return errTerminalSupervisor
		}
		s.mu.Lock()
		idle := s.active == 0 && len(slots) == 0 && time.Since(s.last) > 30*time.Second
		s.mu.Unlock()
		if idle {
			return nil
		}
	}
}

func TerminalSupervisorMain(args []string) bool {
	if len(args) == 0 || args[0] != terminalSupervisorRole {
		return false
	}
	refuse := func() bool { os.Exit(1); return true }
	if os.Getuid() != 0 || os.Geteuid() != 0 || len(args) != 3 || !attemptID.MatchString(args[1]) || !strings.HasPrefix(args[2], "exam-terminal-"+args[1]+"-") || !strings.HasSuffix(args[2], ".scope") {
		return refuse()
	}
	for _, fd := range []int{3, 4, 5, 6} {
		unix.CloseOnExec(fd)
	}
	group, err := os.ReadFile("/proc/self/cgroup")
	expected, _ := terminalSupervisorGroup(args[2])
	if err != nil || string(group) != expected {
		return refuse()
	}
	lf := os.NewFile(3, "inherited-attempt-listener")
	defer lf.Close()
	listener, err := net.FileListener(lf)
	lf.Close()
	if err != nil {
		return refuse()
	}
	defer listener.Close()
	l, ok := listener.(*net.UnixListener)
	if !ok {
		return refuse()
	}
	exe := os.NewFile(4, "pinned-supervisor-executable")
	defer exe.Close()
	loaded, err := os.Stat("/proc/self/exe")
	pinned, perr := exe.Stat()
	if err != nil || perr != nil || !os.SameFile(loaded, pinned) {
		return refuse()
	}
	lock := os.NewFile(5, "inherited-attempt-lifetime")
	defer lock.Close()
	cf := os.NewFile(6, "inherited-supervisor-control")
	defer cf.Close()
	conn, err := net.FileConn(cf)
	cf.Close()
	if err != nil {
		return refuse()
	}
	defer conn.Close()
	control, ok := conn.(*net.UnixConn)
	if !ok {
		return refuse()
	}
	if runTerminalSupervisor(args[1], args[2], l, control, exe, lock, nil) != nil {
		return refuse()
	}
	return true
}
