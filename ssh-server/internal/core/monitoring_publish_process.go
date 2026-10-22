package core

// No live runtime caller exists. This connects the private authority model to a
// bounded provisional-metadata child; it is not a lease or freeze/thaw workflow.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"syscall"
	"time"
)

type monitoringPublishOptions struct {
	command func(string) []string // Private test dependency only, never config/env/IPC.
	timeout time.Duration
}

func monitoringPublishScopeArgs(unit, executable string) []string {
	// Scope mode preserves inherited descriptors. Service mode, --pipe and
	// --wait are not interchangeable here. Require supported scope properties.
	return []string{"/usr/bin/systemd-run", "--scope", "--quiet", "--collect", "--unit=" + unit,
		"--property=Slice=exam-publish.slice", "--property=MemoryMax=64M", "--property=MemorySwapMax=0", "--property=TasksMax=16",
		"--property=RuntimeMaxSec=2s", "--property=TimeoutStopSec=1s", "--property=OOMPolicy=kill", "--property=KillMode=control-group",
		"--property=CPUQuota=100%", "--", executable, monitoringPublisherFlag}
}

func validateMonitoringPublishSlice(output string) error {
	// This is a smaller independent pool, not collection/template capacity.
	properties := map[string]string{}
	for _, line := range bytes.Split([]byte(output), []byte{'\n'}) {
		key, value, ok := bytes.Cut(line, []byte{'='})
		if ok {
			properties[string(key)] = string(value)
		}
	}
	memory, memoryErr := strconv.ParseUint(properties["MemoryMax"], 10, 64)
	tasks, tasksErr := strconv.ParseUint(properties["TasksMax"], 10, 64)
	if properties["LoadState"] != "loaded" || memoryErr != nil || tasksErr != nil || memory < uint64(128*mib) || memory > uint64(256*mib) || tasks < 16 || tasks > 64 || properties["MemorySwapMax"] != "0" {
		return errMonitoringPublishIO
	}
	return nil
}

func monitoringPublisherExecutable() (string, error) {
	if os.Getuid() != 0 || os.Geteuid() != 0 {
		return "", errMonitoringPublishIO
	}
	executable, err := os.Executable()
	if err != nil {
		return "", errMonitoringPublishIO
	}
	executable, err = filepath.EvalSymlinks(executable)
	if err != nil || !filepath.IsAbs(executable) {
		return "", errMonitoringPublishIO
	}
	info, err := os.Stat(executable)
	actual, actualErr := os.Stat("/proc/self/exe")
	if err != nil || actualErr != nil || !os.SameFile(info, actual) || !info.Mode().IsRegular() || info.Mode()&(os.ModeSetuid|os.ModeSetgid) != 0 || info.Sys().(*syscall.Stat_t).Uid != 0 || info.Mode().Perm()&0022 != 0 {
		return "", errMonitoringPublishIO
	}
	// A protected file inside a replaceable parent is not a protected launch.
	// Canonicalize first, then require every ancestor to be root-controlled.
	for dir := filepath.Dir(executable); ; dir = filepath.Dir(dir) {
		info, err := os.Lstat(dir)
		if err != nil || !info.IsDir() || info.Sys().(*syscall.Stat_t).Uid != 0 || info.Mode().Perm()&0022 != 0 {
			return "", errMonitoringPublishIO
		}
		if dir == "/" {
			break
		}
	}
	return executable, nil
}

func monitoringPublisherCommand(ctx context.Context, unit string) ([]string, error) {
	executable, err := monitoringPublisherExecutable()
	if err != nil {
		return nil, err
	}
	probe, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	output, err := exec.CommandContext(probe, "/usr/bin/systemctl", "show", "exam-publish.slice", "--property=LoadState", "--property=MemoryMax", "--property=MemorySwapMax", "--property=TasksMax").Output()
	if err != nil || validateMonitoringPublishSlice(string(output)) != nil {
		return nil, errMonitoringPublishIO
	}
	return monitoringPublishScopeArgs(unit, executable), nil
}

func decodeMonitoringPublishReply(data []byte, r monitoringPublishRequest) error {
	var reply monitoringPublishReply
	if len(data) > monitoringPublishLimit || !validReadOnlyJSON(data) {
		return errMonitoringPublication
	}
	if _, err := decodeMonitoringObject(data, &reply, []string{"version", "purpose", "attempt", "incarnation", "nonce", "hash", "durable"}); err != nil {
		return errMonitoringPublication
	}
	publication, _ := json.Marshal(r.Publication)
	if reply.Version != 1 || reply.Purpose != r.Purpose || reply.Attempt != r.Publication.Owner.Attempt || reply.Incarnation != r.Publication.Incarnation || reply.Nonce != r.Publication.Nonce || reply.Hash != Hash(publication) || !reply.Durable {
		return errMonitoringPublication
	}
	return nil
}

// Must run in a bounded per-attempt supervisor task, never the authority event
// loop/mutex or a PTY-owning shared agent handler. Metadata setup itself may
// encounter stalled filesystem IO; the actor's independent cutoff must continue.
// After launch, timeout does not wait for a potentially uninterruptible child.
// Inherited persistent claims keep it counted/exclusive until it really exits.
func publishMonitoringTicket(parent context.Context, claim *monitoringOwnerClaim, state string, ticket *monitoringCommitTicket, opts monitoringPublishOptions) (receipt monitoringCommitReceipt, runErr error) {
	if parent == nil || ticket == nil || ticket.authority == nil || !claim.current() {
		return receipt, errMonitoringAuthority
	}
	if !ticket.workerStarted.CompareAndSwap(false, true) {
		return receipt, errMonitoringBusy
	}
	defer func() {
		if runErr != nil {
			_ = ticket.authority.publicationFailed(ticket)
		}
	}()
	current := ticket.authority.check()
	if (current.Phase != "active" && current.Phase != "awaiting-evidence") || !current.PublicationPending {
		return receipt, errMonitoringAuthority
	}
	timeout := 2 * time.Second
	if opts.timeout > 0 {
		timeout = opts.timeout
	}
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()
	dir, err := openMonitoringControl(state)
	if err != nil {
		return receipt, err
	}
	defer dir.Close()
	attempt := ticket.publication.Owner.Attempt
	owner, err := claim.publisherHandle()
	if err != nil {
		return receipt, err
	}
	defer owner.Close()
	if verifyMonitoringInheritedClaim(dir, owner, attempt+".lock") != nil {
		return receipt, errMonitoringPublishIO
	}
	local, err := monitoringPublishLock(dir, attempt+".publisher.lock")
	if err != nil {
		return receipt, err
	}
	defer local.Close()
	var slot *os.File
	slotIndex := -1
	for n := range 2 {
		slot, err = monitoringPublishLock(dir, fmt.Sprintf("publish-slot-%d.lock", n))
		if err == nil {
			slotIndex = n
			break
		}
		if err != errMonitoringBusy {
			return receipt, err
		}
	}
	if slot == nil {
		return receipt, errMonitoringBusy
	}
	defer slot.Close()
	r := monitoringPublishRequest{1, "monitoring-provisional-publication-v1", state, slotIndex, ticket.publication}
	input, err := json.Marshal(r)
	if err != nil {
		return receipt, errMonitoringPublishIO
	}
	if _, err := decodeMonitoringPublishRequest(input); err != nil {
		return receipt, err
	}
	unit := "exam-monitoring-publish-" + attempt + "-" + ticket.proof.Nonce[:12] + ".scope"
	var command []string
	if opts.command != nil {
		command = opts.command(unit)
	} else {
		command, err = monitoringPublisherCommand(ctx, unit)
		if err != nil {
			return receipt, err
		}
	}
	if len(command) == 0 {
		return receipt, errMonitoringPublishIO
	}
	select {
	case <-ctx.Done():
		return receipt, errMonitoringPublishIO
	default:
	}
	cmd := exec.Command(command[0], command[1:]...)
	cmd.Env = []string{"PATH=/usr/bin:/bin", "LANG=C.UTF-8", "GOMAXPROCS=2", "GOMEMLIMIT=48MiB"}
	cmd.ExtraFiles = []*os.File{owner, slot, local}
	cmd.Stdin = bytes.NewReader(input)
	var out workerOutput
	cmd.Stdout, cmd.Stderr = &out, io.Discard
	cmd.WaitDelay = 100 * time.Millisecond
	if cmd.Start() != nil {
		return receipt, errMonitoringPublishIO
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case err := <-done:
		if err != nil || out.overflow || decodeMonitoringPublishReply(out.Bytes(), r) != nil {
			return receipt, errMonitoringPublication
		}
	case <-ctx.Done():
		// Kill this exact owned child (Go uses pidfds where supported), never a
		// process-name search. Its scope also has an independent runtime bound.
		_ = cmd.Process.Kill()
		return receipt, errMonitoringPublishIO
	}
	if !claim.current() {
		return receipt, errMonitoringAuthority
	}
	return ticket.authority.published(ticket, ticket.publicationHash)
}
