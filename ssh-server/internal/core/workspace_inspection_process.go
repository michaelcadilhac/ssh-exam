package core

// Root CLI only. Heavy archive/kernel observation is isolated from the agent and
// uses the already qualified collection resource profile, not a student RPC.
import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"syscall"
	"time"
)

const workspaceInspectionFlag = "--workspace-inspection-worker"
const workspaceInspectionPurpose = "workspace-inspection/v1"

type WorkspaceUse struct {
	PID        int    `json:"pid"`
	TID        int    `json:"tid"`
	Kind       string `json:"kind"`
	Descriptor int    `json:"descriptor,omitempty"`
}
type WorkspaceCleanupPreview struct {
	WorkspaceRetentionStatus
	UsageObserved bool           `json:"usage_observed"`
	SnapshotClear bool           `json:"snapshot_clear"`
	Review        string         `json:"review"`
	Uses          []WorkspaceUse `json:"uses"`
}
type workspaceInspectionRequest struct {
	Purpose string `json:"purpose"`
	Nonce   string `json:"nonce"`
	ID      string `json:"id"`
	Config  Config `json:"config"`
	Action  string `json:"action,omitempty"`
	Request string `json:"request,omitempty"`
	Review  string `json:"review,omitempty"`
	Reason  string `json:"reason,omitempty"`
}
type workspaceInspectionReply struct {
	Purpose string                   `json:"purpose"`
	Nonce   string                   `json:"nonce"`
	ID      string                   `json:"id"`
	Preview *WorkspaceCleanupPreview `json:"preview,omitempty"`
	Cleanup *WorkspaceCleanupView    `json:"cleanup,omitempty"`
	Error   string                   `json:"error,omitempty"`
}

func WorkspaceInspectionWorkerMain(args []string) bool {
	if len(args) != 1 || args[0] != workspaceInspectionFlag {
		return false
	}
	if os.Getuid() != 0 || os.Geteuid() != 0 {
		fmt.Fprintln(os.Stderr, "workspace inspection requires a root coordinator")
		os.Exit(1)
	}
	var request workspaceInspectionRequest
	if decodeWorkerFrame(os.Stdin, 65536, &request) != nil || request.Purpose != workspaceInspectionPurpose || !templateDigest.MatchString(request.Nonce) || !attemptID.MatchString(request.ID) {
		fmt.Fprintln(os.Stderr, "invalid private workspace inspection request")
		os.Exit(1)
	}
	e := &Engine{Config: request.Config}
	reply := workspaceInspectionReply{Purpose: request.Purpose, Nonce: request.Nonce, ID: request.ID}
	var err error
	if request.Action == "" {
		preview, inspectErr := e.inspectWorkspaceCleanup(request.ID)
		err = inspectErr
		if err == nil {
			reply.Preview = &preview
		}
	} else {
		result, cleanupErr := e.workspaceCleanupControl(request)
		err = cleanupErr
		if err == nil {
			reply.Cleanup = &result
		}
	}
	if err != nil {
		reply.Error = "Workspace inspection unavailable: " + err.Error()
	}
	data, err := json.Marshal(reply)
	if err != nil || len(data) > 8192 {
		fmt.Fprintln(os.Stderr, "workspace inspection reply exceeds safe bound; no eligibility established")
		os.Exit(1)
	}
	if _, err := os.Stdout.Write(data); err != nil {
		os.Exit(1)
	}
	return true
}

func InspectWorkspaceCleanup(c Config, id string) (WorkspaceCleanupPreview, error) {
	var result WorkspaceCleanupPreview
	if !attemptID.MatchString(id) || os.Getuid() != 0 || os.Geteuid() != 0 {
		return result, errors.New("run workspace dry-run as root with one exact attempt UUID; see examctl help workspaces")
	}
	e := &Engine{Config: c}
	if _, err := e.recoveryRevocationState(); err != nil {
		return result, err
	}
	executable, err := os.Executable()
	if err != nil {
		return result, err
	}
	info, err := os.Stat(executable)
	if err != nil || info.Sys().(*syscall.Stat_t).Uid != 0 || info.Mode().Perm()&0022 != 0 {
		return result, errors.New("inspection requires a root-owned non-writable examctl executable; do not relax ownership")
	}
	if err := collectionResourceBounds(); err != nil {
		return result, err
	}
	request := workspaceInspectionRequest{Purpose: workspaceInspectionPurpose, Nonce: Token(), ID: id, Config: c}
	payload, err := json.Marshal(request)
	if err != nil || len(payload) > 65536 {
		return result, errors.New("private workspace inspection request exceeds safe bound")
	}
	unit := "exam-workspace-inspection-" + id + "-" + request.Nonce[:12] + ".service"
	args := collectionServiceArgs(unit, executable)
	args[len(args)-1] = workspaceInspectionFlag
	ctx, cancel := context.WithTimeout(context.Background(), 130*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, args[0], args[1:]...)
	cmd.Stdin = bytes.NewReader(payload)
	var output workerOutput
	cmd.Stdout = &output
	cmd.Stderr = io.Discard
	cmd.WaitDelay = 5 * time.Second
	err = cmd.Run()
	if ctx.Err() != nil {
		stop, stopCancel := context.WithTimeout(context.Background(), 7*time.Second)
		_ = exec.CommandContext(stop, "/usr/bin/systemctl", "stop", unit).Run()
		stopCancel()
	}
	if err != nil {
		return result, fmt.Errorf("bounded inspection worker exited; no cleanup eligibility or queued action: %w; inspect workspaces show and retry dry-run", err)
	}
	var reply workspaceInspectionReply
	if output.overflow || !validReadOnlyJSON(output.Bytes()) || decodeWorkerFrame(bytes.NewReader(output.Bytes()), 8192, &reply) != nil || reply.Purpose != request.Purpose || reply.Nonce != request.Nonce || reply.ID != id || reply.Cleanup != nil || (reply.Error != "" && reply.Preview != nil) {
		return result, errors.New("invalid private inspection reply; no eligibility established; preserve evidence and retry dry-run")
	}
	if reply.Error != "" {
		return result, errors.New(reply.Error)
	}
	if reply.Preview == nil || reply.Preview.Attempt != id || reply.Preview.Eligible || reply.Preview.SnapshotClear && (!reply.Preview.Candidate || !reply.Preview.ArchiveVerified || !reply.Preview.UsageObserved || len(reply.Preview.Blockers) != 0 || len(reply.Preview.Uses) != 0) || !templateDigest.MatchString(reply.Preview.Review) {
		return result, errors.New("inspection result is incomplete or contradictory; no eligibility established")
	}
	return *reply.Preview, nil
}

func (e *Engine) workspaceCleanupLocks(id string) (func(), error) {
	if !attemptID.MatchString(id) {
		return nil, errors.New("invalid exact workspace attempt identifier")
	}
	state, err := e.recoveryRevocationState()
	if err != nil {
		return nil, err
	}
	a := state.Attempts[id]
	if a == nil || a.ID != id {
		return nil, errors.New("known native attempt required; preserve orphan folders and inspect list --read-only")
	}
	job, err := e.attemptCollectionLock(id)
	if err != nil {
		return nil, errors.New("attempt job busy; operation NOT accepted or queued; retry after staging/collection settles")
	}
	account, err := e.accountWorkLock(a.UID)
	if err != nil {
		job.Close()
		return nil, errors.New("account workflow busy; retry without interrupting work")
	}
	var slot *os.File
	for i := range 2 {
		slot, err = e.collectionLock(fmt.Sprintf("slot-%d", i))
		if err == nil {
			break
		}
		if !errors.Is(err, errCollectionPending) {
			account.Close()
			job.Close()
			return nil, err
		}
	}
	if slot == nil {
		account.Close()
		job.Close()
		return nil, errors.New("verification workers busy; operation not queued; retry after existing workers finish")
	}
	return func() { slot.Close(); account.Close(); job.Close() }, nil
}

func (e *Engine) inspectWorkspaceCleanup(id string) (WorkspaceCleanupPreview, error) {
	release, err := e.workspaceCleanupLocks(id)
	if err != nil {
		return WorkspaceCleanupPreview{}, err
	}
	defer release()
	return e.inspectWorkspaceCleanupLocked(id)
}

func (e *Engine) inspectWorkspaceCleanupLocked(id string) (WorkspaceCleanupPreview, error) {
	result := WorkspaceCleanupPreview{Uses: []WorkspaceUse{}}
	state, err := e.recoveryRevocationState()
	if err != nil {
		return result, err
	}
	a := state.Attempts[id]
	if a == nil || a.ID != id {
		return result, errReadOnlySnapshot
	}
	status, err := e.workspaceRetentionStatus(a)
	if err != nil {
		return result, err
	}
	result.WorkspaceRetentionStatus = status
	result.Note = "Point-in-time fresh inspection only; not a deletion permit. Cleanup must repeat state/hold/archive/use and exact-inode checks under its own lifetime barrier. No process/account/clock/source change."
	for otherID, other := range state.Attempts {
		if other == nil {
			return result, errReadOnlySnapshot
		}
		if otherID != id && other.UID == a.UID && other.State != "COMPLETED" && other.State != "CANCELLED_BEFORE_START" {
			result.Blockers = append(result.Blockers, "Another attempt for this account is unfinished; inspect native list/info and defer cleanup; no exam interrupted")
		}
	}
	if len(result.Blockers) == 0 {
		if _, err := e.verifySourceRetentionArchive(a); err != nil {
			result.Blockers = append(result.Blockers, "Fresh protected archive verification failed; preserve work and inspect manifest before retrying")
		} else {
			result.ArchiveVerified = true
		}
	}
	if result.ArchiveVerified {
		uses, err := e.workspaceUseSnapshot(a, result.Base)
		if err != nil {
			result.Blockers = append(result.Blockers, "Current filesystem-use proof unavailable: "+err.Error())
		} else {
			result.UsageObserved = true
			result.Uses = uses
			if len(uses) > 0 {
				result.Blockers = append(result.Blockers, "Workspace/account still referenced; inspect reported PID/TID/reference kinds and defer cleanup; no process is signalled")
			}
		}
	}
	current, err := e.recoveryRevocationState()
	if err != nil {
		return result, err
	}
	before, _ := json.Marshal(a)
	after, _ := json.Marshal(current.Attempts[id])
	if !bytes.Equal(before, after) {
		return result, errors.New("attempt authority changed during inspection; no eligibility established; reread native info and retry")
	}
	hold, err := e.readWorkspaceHold(a)
	if err != nil {
		return result, err
	}
	h1, _ := json.Marshal(status.Hold)
	h2, _ := json.Marshal(hold)
	if !bytes.Equal(h1, h2) {
		return result, errors.New("workspace hold changed during verification; inspect current revision and review again")
	}
	// A sequential kernel observation is not a lifetime/admission barrier. Keep
	// the older authoritative eligibility field false until cleanup owns that
	// barrier; a clear snapshot is useful review evidence, never permission.
	result.SnapshotClear = result.Candidate && result.ArchiveVerified && result.UsageObserved && len(result.Blockers) == 0 && len(result.Uses) == 0
	data, _ := json.Marshal(struct {
		Attempt       *Attempt
		Hold          WorkspaceHold
		Base, Work    WorkspacePathIdentity
		SnapshotClear bool
		Blockers      []string
		Uses          []WorkspaceUse
	}{a, hold, result.Base, result.Work, result.SnapshotClear, result.Blockers, result.Uses})
	result.Review = Hash(data)
	return result, nil
}
