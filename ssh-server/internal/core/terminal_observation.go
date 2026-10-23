package core

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"sort"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
)

const terminalObservationPurpose = "terminal-supervisor-observation/v1"

var errTerminalObservation = errors.New("terminal-supervisor observation unavailable or changed; no process death, monitoring loss or work permission inferred; preserve records and inspect examctl panes list ATTEMPT --state DIR and examctl help panes; do not clear state or restart an active agent")

// Diagnostic metadata only. Neither the root sender nor a live pidfd proves the
// student's SSH ownership, current monitoring, freeze or execution authority.
type TerminalSupervisorObservation struct {
	Purpose              string   `json:"purpose"`
	Attempt              string   `json:"attempt"`
	Supervisor           string   `json:"supervisor"`
	PID                  int      `json:"pid"`
	Boot                 string   `json:"boot"`
	At                   int64    `json:"at"`
	AttachedPanes        int      `json:"attached_panes"`
	AttachedUnits        []string `json:"attached_units"`
	ReportedStartedUnits []string `json:"reported_started_units"`
	ObservationOnly      bool     `json:"observation_only"`
}

func (s *terminalSupervisor) observation() TerminalSupervisorObservation {
	s.mu.Lock()
	defer s.mu.Unlock()
	v := TerminalSupervisorObservation{Purpose: terminalObservationPurpose, Attempt: s.id, Supervisor: s.unit, PID: os.Getpid(), Boot: boot(), At: Millis(), AttachedPanes: s.active, AttachedUnits: []string{}, ReportedStartedUnits: []string{}, ObservationOnly: true}
	for unit, reported := range s.panes {
		v.AttachedUnits = append(v.AttachedUnits, unit)
		if reported {
			v.ReportedStartedUnits = append(v.ReportedStartedUnits, unit)
		}
	}
	sort.Strings(v.AttachedUnits)
	sort.Strings(v.ReportedStartedUnits)
	return v
}

// ObserveTerminalSupervisor never initializes directories/Engine or reads global
// attempt state/keys. The CLI requires real/effective root; installed supervisors
// also require kernel root peers. Owner-UID fixtures test the same read path.
func ObserveTerminalSupervisor(state, id string) (TerminalSupervisorObservation, error) {
	var result TerminalSupervisorObservation
	if !attemptID.MatchString(id) {
		return result, errTerminalObservation
	}
	root, err := readOnlyRoot(state)
	if err != nil {
		return result, errTerminalObservation
	}
	defer root.Close()
	dir, err := readOnlyOpenAt(root, "terminal-supervisors", true)
	if err != nil {
		return result, errTerminalObservation
	}
	defer dir.Close()
	pinned, err := templatePinnedRoot(dir)
	if err != nil {
		return result, errTerminalObservation
	}
	defer pinned.Close()
	info, err := pinned.Lstat(id + ".sock")
	if err != nil || info.Mode()&os.ModeSocket == 0 || info.Mode().Perm() != 0600 || info.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) {
		return result, errTerminalObservation
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	var dialer net.Dialer
	connection, err := dialer.DialContext(ctx, "unixpacket", fmt.Sprintf("/proc/self/fd/%d/%s.sock", dir.Fd(), id))
	if err != nil {
		return result, errTerminalObservation
	}
	defer connection.Close()
	c, ok := connection.(*net.UnixConn)
	if !ok {
		return result, errTerminalObservation
	}
	deadline, _ := ctx.Deadline()
	if c.SetDeadline(deadline) != nil {
		return result, errTerminalObservation
	}
	// SO_PEERCRED names the inherited listener's CREATOR, not its accepting
	// supervisor. Authenticate the actual reply sender with SCM_CREDENTIALS.
	raw, err := c.SyscallConn()
	if err != nil {
		return result, errTerminalObservation
	}
	setCredentials := func(enabled int) error {
		var optionErr error
		err := raw.Control(func(fd uintptr) { optionErr = unix.SetsockoptInt(int(fd), unix.SOL_SOCKET, unix.SO_PASSCRED, enabled) })
		if err != nil {
			return err
		}
		return optionErr
	}
	if setCredentials(1) != nil {
		return result, errTerminalObservation
	}
	if _, err = c.Write([]byte{0}); err != nil {
		return result, errTerminalObservation
	}
	var hello [2]byte
	oob := make([]byte, unix.CmsgSpace(unix.SizeofUcred)+unix.CmsgSpace(5*4))
	n, on, flags, _, err := c.ReadMsgUnix(hello[:], oob)
	rights, _ := receiveBoundedDescriptors(oob[:on], flags, 0)
	rights.close() // Own unexpected installed rights even on malformed replies.
	if err != nil || n != 1 || hello[0] != 1 || flags&(unix.MSG_TRUNC|unix.MSG_CTRUNC) != 0 || len(rights.files) != 0 {
		return result, errTerminalObservation
	}
	frames, err := unix.ParseSocketControlMessage(oob[:on])
	if err != nil || len(frames) != 1 {
		return result, errTerminalObservation
	}
	cred, err := unix.ParseUnixCredentials(&frames[0])
	if err != nil || cred.Uid != uint32(os.Geteuid()) || cred.Pid <= 1 {
		return result, errTerminalObservation
	}
	process, err := pinUIDProcess(int(cred.Pid), os.Geteuid())
	if err != nil || process == nil {
		return result, errTerminalObservation
	}
	defer process.close()
	if setCredentials(0) != nil {
		return result, errTerminalObservation
	}
	request, _ := json.Marshal(map[string]string{"purpose": terminalObservationPurpose, "attempt": id})
	if _, err = c.Write(request); err != nil {
		return result, errTerminalObservation
	}
	buf := make([]byte, terminalSupervisorBytes+1)
	oob = make([]byte, unix.CmsgSpace(5*4))
	n, on, flags, _, err = c.ReadMsgUnix(buf, oob)
	rights, descriptorErr := receiveBoundedDescriptors(oob[:on], flags, 0)
	rights.close()
	if err != nil || descriptorErr != nil || terminalDecode(buf[:n], &result) != nil {
		return TerminalSupervisorObservation{}, errTerminalObservation
	}
	live, lerr := process.live()
	if lerr != nil || !live || result.Purpose != terminalObservationPurpose || result.Attempt != id || result.Supervisor != terminalSupervisorUnit(state, id) || result.PID != int(cred.Pid) || result.Boot == "" || result.Boot != boot() || result.At <= 0 || !result.ObservationOnly || result.AttachedPanes < 0 || result.AttachedPanes > 4 || len(result.AttachedUnits) != result.AttachedPanes || result.AttachedUnits == nil {
		return TerminalSupervisorObservation{}, errTerminalObservation
	}
	previous := ""
	units := map[string]bool{}
	for _, unit := range result.AttachedUnits {
		_, kind, incarnation, valid := recordedPaneIdentity(id, unit)
		if !valid || kind != "scope" || incarnation == "" || unit <= previous {
			return TerminalSupervisorObservation{}, errTerminalObservation
		}
		previous = unit
		units[unit] = true
	}
	if result.ReportedStartedUnits == nil || len(result.ReportedStartedUnits) > len(result.AttachedUnits) {
		return TerminalSupervisorObservation{}, errTerminalObservation
	}
	previous = ""
	for _, unit := range result.ReportedStartedUnits {
		if !units[unit] || unit <= previous {
			return TerminalSupervisorObservation{}, errTerminalObservation
		}
		previous = unit
	}
	return result, nil
}
