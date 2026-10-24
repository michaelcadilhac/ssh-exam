package core

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"syscall"
	"unicode/utf8"

	"golang.org/x/sys/unix"
)

func workspaceFence(a, snapshot *Attempt) bool {
	return protectedIdentity(a, snapshot) && a.State == "PREPARING" && a.Start == 0 && a.Deadline == 0 && a.OriginalDeadline == 0 && a.Transport == snapshot.Transport && a.Generation == snapshot.Generation && a.PreflightStartedAt == snapshot.PreflightStartedAt && a.PreparationPending == snapshot.PreparationPending && a.PreparationPendingSince == snapshot.PreparationPendingSince
}

func recoveryReferenceHash(r *RecoveryPreparation) string {
	if r == nil {
		return ""
	}
	b, _ := json.Marshal(r)
	return Hash(b)
}

func (e *Engine) workspaceSource(a *Attempt) (WorkspaceSource, string, error) {
	r, err := e.recoveryReference(a)
	if err != nil {
		return WorkspaceSource{}, "", err
	}
	if r != nil {
		return WorkspaceSource{Kind: "saved", Attempt: r.SourceAttempt, Checksum: r.Checksum}, recoveryReferenceHash(r), nil
	}
	if a.Grant != nil && a.Grant.Work != nil {
		if !validGrant(a.Grant) {
			return WorkspaceSource{}, "", errors.New("invalid grant workspace source; preserve issued authority, no fallback permitted")
		}
		w := a.Grant.Work
		if w.Kind == "saved" {
			pin, err := e.grantSourceForAttempt(a)
			if err != nil {
				return WorkspaceSource{}, "", err
			}
			return WorkspaceSource{Kind: "saved", Attempt: w.Attempt, Checksum: w.Checksum}, pin.RetentionHash, nil
		}
		return WorkspaceSource{Kind: w.Kind, Template: w.Name, Version: w.Hash}, "", nil
	}
	if !identifier.MatchString(a.Settings.Template) {
		return WorkspaceSource{}, "", errors.New("versioned workspace template unavailable")
	}
	if !validTemplateBinding(a.Settings) {
		return WorkspaceSource{}, "", errors.New("invalid recorded workspace template/version")
	}
	return WorkspaceSource{Kind: "template", Template: a.Settings.Template, Version: a.Settings.TemplateVersion}, "", nil
}

func (e *Engine) workspaceBase(id string) string { return filepath.Join(e.Config.Work, id) }

// A cancelled preparation may release its reservation while its old OS check is
// still unwinding. New preparations for that UID must not enter that gap and be
// caught by the old purge. Nonblocking: unrelated UIDs/control stay responsive.
func (e *Engine) accountWorkLock(uid int) (*os.File, error) {
	if uid < 0 {
		return nil, errors.New("invalid account UID")
	}
	lock, err := e.collectionLock(fmt.Sprintf("account-%d", uid))
	if err != nil {
		return nil, fmt.Errorf("account workflow is changing; retry preflight after it settles: %w", err)
	}
	return lock, nil
}

func readWorkspaceReceipt(base string) (*WorkspaceReceipt, error) {
	root, err := readOnlyRoot(base)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	ready, err := readOnlyOpenAt(root, "workspace-ready", true)
	if err != nil {
		return nil, err
	}
	defer ready.Close()
	b, err := privateControlFile(ready, "receipt.json", 16384)
	if err != nil {
		return nil, err
	}
	return decodeWorkspaceReceipt(b)
}

var errWorkspaceReceiptMetadata = errors.New("unsafe private workspace receipt; preserve staging/work and inspect the attempt read-only; use examctl help workspace-prepare and examctl help workspace-repair, never replace work or fabricate a receipt")

func decodeWorkspaceReceipt(b []byte) (*WorkspaceReceipt, error) {
	if len(b) > 16384 || !utf8.Valid(b) || !validReadOnlyJSON(b) {
		return nil, errWorkspaceReceiptMetadata
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(b, &fields) != nil || fields == nil {
		return nil, errWorkspaceReceiptMetadata
	}
	for key := range fields {
		switch key {
		case "grant", "version", "attempt", "exam", "username", "uid", "settings_hash", "source", "prepared_at", "recovery_hash", "content_hash", "work_device", "work_inode":
		default:
			return nil, errWorkspaceReceiptMetadata
		}
	}
	var source map[string]json.RawMessage
	if json.Unmarshal(fields["source"], &source) != nil || source == nil {
		return nil, errWorkspaceReceiptMetadata
	}
	for key := range source {
		switch key {
		case "kind", "template", "version", "attempt", "checksum":
		default:
			return nil, errWorkspaceReceiptMetadata
		}
	}
	var r WorkspaceReceipt
	if err := decodeWorkerFrame(bytes.NewReader(b), 16384, &r); err != nil {
		return nil, errWorkspaceReceiptMetadata
	}
	if raw, ok := fields["grant"]; ok {
		var binding map[string]json.RawMessage
		if json.Unmarshal(raw, &binding) != nil || len(binding) < 3 || len(binding) > 7 || !validGrant(r.Grant) {
			return nil, errWorkspaceReceiptMetadata
		}
		for key := range binding {
			if key != "id" && key != "revision" && key != "hash" && key != "kind" && key != "issuance_order" && key != "initial_grant" && key != "work" {
				return nil, errWorkspaceReceiptMetadata
			}
		}
		if _, present := binding["kind"]; present && r.Grant.Kind != "ADDITIONAL" && r.Grant.Kind != "PRACTICE" {
			return nil, errWorkspaceReceiptMetadata
		}
		if _, present := binding["issuance_order"]; present && r.Grant.Order < 1 {
			return nil, errWorkspaceReceiptMetadata
		}
		if _, present := binding["initial_grant"]; present && r.Grant.Initial == "" {
			return nil, errWorkspaceReceiptMetadata
		}
		if rawWork, present := binding["work"]; present {
			var work map[string]json.RawMessage
			if !validGrantWork(r.Grant.Work) || json.Unmarshal(rawWork, &work) != nil || work == nil {
				return nil, errWorkspaceReceiptMetadata
			}
			if r.Grant.Work.Kind == "empty" && len(work) != 1 || (r.Grant.Work.Kind == "template" || r.Grant.Work.Kind == "saved") && len(work) != 3 {
				return nil, errWorkspaceReceiptMetadata
			}
			for key := range work {
				if key != "kind" && !((r.Grant.Work.Kind == "template" && (key == "name" || key == "hash")) || (r.Grant.Work.Kind == "saved" && (key == "attempt" || key == "checksum"))) {
					return nil, errWorkspaceReceiptMetadata
				}
			}
		}
	}
	return &r, nil
}

func privateWorkspaceDirectory(p string) error {
	i, err := os.Lstat(p)
	if err != nil {
		return err
	}
	if !i.IsDir() || i.Mode()&os.ModeSymlink != 0 || i.Mode().Perm()&0077 != 0 || i.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) {
		return errors.New("workspace staging parent must be a real root-private directory")
	}
	return nil
}

func (e *Engine) workspaceBarrier(phase string) error {
	if e.workspaceCheckpoint != nil {
		return e.workspaceCheckpoint(phase)
	}
	return nil
}

func (e *Engine) checkWorkspaceReceipt(a *Attempt, r *WorkspaceReceipt) error {
	source, recoveryHash, err := e.workspaceSource(a)
	if err != nil {
		return err
	}
	settings, _ := json.Marshal(a.Settings)
	if !sameGrant(r.Grant, a.Grant) || r.Version != 1 || r.Attempt != a.ID || r.Exam != a.Exam || r.Username != a.Username || r.UID != a.UID || r.SettingsHash != Hash(settings) || r.Source != source || r.RecoveryHash != recoveryHash || r.PreparedAt <= 0 || r.WorkInode == 0 {
		return errors.New("private workspace no longer matches this preparation/source; inspect before retrying preflight")
	}
	if a.Workspace != nil {
		expected, _ := json.Marshal(a.Workspace)
		actual, _ := json.Marshal(r)
		if !bytes.Equal(expected, actual) {
			return errors.New("private workspace receipt changed; administrator inspection required")
		}
	}
	return nil
}

func workspaceDirectoryMatches(p string, r *WorkspaceReceipt) error {
	i, err := os.Lstat(p)
	if err != nil || !i.IsDir() || i.Mode()&os.ModeSymlink != 0 {
		return errors.New("staged workspace directory unavailable; retry preflight without starting the clock")
	}
	s := i.Sys().(*syscall.Stat_t)
	if uint64(s.Dev) != r.WorkDevice || s.Ino != r.WorkInode {
		return errors.New("workspace directory identity changed; refusing to replace student work")
	}
	return nil
}

func workspaceCollectionNameReady(id, work string) error {
	_, err := os.Lstat(filepath.Join(work, "MANIFEST.json"))
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("staged workspace collection-name inspection failed; preserve preparation and retry inspection: %w", err)
	}
	return fmt.Errorf("staged workspace MANIFEST.json is reserved for protected collection metadata; no clock has started. Inspect examctl info %s, correct the authored template, then cancel only this unstarted preparation with examctl cancel %s --reason 'Reviewed invalid starter before Begin' and retry student preflight. Do not overwrite its frozen private receipt or reopen a started attempt", id, id)
}

// Called by the same resource-bounded, two-slot worker boundary as collection.
// The attempt lock is already held. Student-owned contents stay below a root-
// private parent, never mounted by practice, until a later explicit Begin.
func (e *Engine) stageWorkspace(snapshot *Attempt) error {
	if !workspaceFence(snapshot, snapshot) || preflightExpired(snapshot, Millis()) {
		return errors.New("workspace staging requires a current unstarted preparation")
	}
	if snapshot.Settings.TemplateVersion != "" {
		// This is already a bounded actual-attempt staging worker, not the
		// shared agent. Verify materials even for saved/retained starter work.
		if _, err := templateContent(e.Config, snapshot.Settings, true); err != nil {
			return err
		}
	}
	source, recoveryHash, err := e.workspaceSource(snapshot)
	if err != nil {
		return err
	}
	if source.Kind == "saved" && snapshot.Grant == nil {
		if err := e.probeRecoveryConsumptionStorage(snapshot); err != nil {
			return fmt.Errorf("saved-work consumption storage unavailable before Begin; no interval consumed; verify writable supported storage and retry examctl workspace-prepare %s without changing grants/markers: %w", snapshot.ID, err)
		}
	}
	if source.Kind == "saved" {
		// No wait while holding a state transaction; source deletion/export shares
		// this lock. Completed sources cannot form cyclic staging dependencies.
		lock, err := e.attemptCollectionLock(source.Attempt)
		if err != nil {
			return err
		}
		defer lock.Close()
	}
	base := e.workspaceBase(snapshot.ID)
	if err := os.MkdirAll(base, 0700); err != nil {
		return err
	}
	if err := privateWorkspaceDirectory(base); err != nil {
		return err
	}
	if _, err := os.Lstat(filepath.Join(base, "work")); !os.IsNotExist(err) {
		return errors.New("unstarted preparation already has live work; refusing to overwrite it; inspect with examctl info")
	}
	r, err := readWorkspaceReceipt(base)
	if os.IsNotExist(err) {
		private, err := os.MkdirTemp(base, ".workspace-stage-")
		if err != nil {
			return err
		}
		defer os.RemoveAll(private) // Only this worker's exact unpublished directory.
		r, err = e.buildPrivateWorkspace(snapshot, source, filepath.Join(private, "work"))
		if err != nil {
			return err
		}
		r.RecoveryHash = recoveryHash
		if err := e.workspaceBarrier("copied"); err != nil {
			return err
		}
		b, err := json.Marshal(r)
		if err != nil {
			return err
		}
		if err := durableFile(filepath.Join(private, "receipt.json"), b); err != nil {
			return err
		}
		if err := syncDirectory(private); err != nil {
			return err
		}
		if err := unix.Renameat2(unix.AT_FDCWD, private, unix.AT_FDCWD, filepath.Join(base, "workspace-ready"), unix.RENAME_NOREPLACE); err != nil {
			return err
		}
		if err := syncDirectory(base); err != nil {
			return err
		}
		if err := e.workspaceBarrier("published-private"); err != nil {
			return err
		}
	} else if err != nil {
		return err
	}
	if err := e.checkWorkspaceReceipt(snapshot, r); err != nil {
		return err
	}
	if err := workspaceDirectoryMatches(filepath.Join(base, "workspace-ready", "work"), r); err != nil {
		return err
	}
	if err := workspaceCollectionNameReady(snapshot.ID, filepath.Join(base, "workspace-ready", "work")); err != nil {
		return err
	}
	return e.WithState(func() error {
		a, err := e.Find(snapshot.ID)
		if err != nil || !workspaceFence(a, snapshot) || e.expirePreflight(a, Millis()) {
			return errors.New("preparation expired, cancelled or changed during staging; no clock/grant consumed")
		}
		if err := e.checkWorkspaceReceipt(a, r); err != nil {
			return err
		}
		a.Workspace = r
		e.Audit("workspace-staged", a.ID)
		return nil
	})
}

func (e *Engine) workspaceForBegin(a *Attempt) error {
	if a.Workspace == nil {
		return errors.New("private workspace not ready; retry student preflight or run examctl workspace-prepare ATTEMPT; no clock has started")
	}
	base := e.workspaceBase(a.ID)
	if _, err := os.Lstat(filepath.Join(base, "work")); !os.IsNotExist(err) {
		return errors.New("unstarted attempt has unexpected live work; administrator inspection required; no clock has started")
	}
	r, err := readWorkspaceReceipt(base)
	if err != nil {
		return fmt.Errorf("private workspace receipt unavailable or unsafe; preserve staging/work and inspect examctl info %s --read-only and examctl help workspace-prepare; no new authorization established", a.ID)
	}
	if err := e.checkWorkspaceReceipt(a, r); err != nil {
		return err
	}
	if err := workspaceDirectoryMatches(filepath.Join(base, "workspace-ready", "work"), r); err != nil {
		return err
	}
	return workspaceCollectionNameReady(a.ID, filepath.Join(base, "workspace-ready", "work"))
}

func (e *Engine) prepareActivation(a *Attempt) error {
	if ready, missing := e.Ready(); !ready {
		return fmt.Errorf("guards unavailable: %v", missing)
	}
	return e.quiesceOrdinary(a)
}

// All entry points own the per-attempt lock, but no global state lock is held
// during OS guard checks or ordinary-session termination. Never auto-start from
// staging completion: only this later, explicit Begin can commit an interval.
func (e *Engine) activatePrepared(snapshot *Attempt, expires int64, grantIntent ...string) (any, error) {
	return e.activatePreparedNative(snapshot, expires, nil, grantIntent...)
}

func (e *Engine) activatePreparedNative(snapshot *Attempt, expires int64, original *net.UnixConn, grantIntent ...string) (any, error) {
	page, epoch := "", ""
	var initialOwner *monitoringOwner
	if original != nil {
		if err := terminalAuthorityReadiness(); err != nil {
			return nil, err
		}
	}
	// Registration is committed only with actual start. Contradictory restored
	// preparation metadata must refuse before commitStart, since WithState also
	// persists safety transitions on a returned error.
	if snapshot.Start == 0 && snapshot.RegisteredOwner != nil {
		return nil, errRegisteredOwner
	}
	if len(grantIntent) > 2 {
		return nil, errRegisteredOwner
	}
	if len(grantIntent) == 2 && snapshot.Grant != nil && snapshot.BrowserSSH && snapshot.UID >= 1000 {
		page = grantIntent[1]
		if page != "" {
			if !monitoringDigest.MatchString(page) {
				return nil, errRegisteredOwner
			}
			epoch = Token() // Entropy failure precedes one-use publication/clock commit.
			probe := *snapshot
			if err := registerPageOwner(&probe, page, epoch); err != nil {
				return nil, err
			}
			initialOwner = probe.RegisteredOwner
		}
	}
	if snapshot.Start > 0 {
		if err := requireRegisteredPage(snapshot, page); err != nil {
			return nil, err
		}
		return snapshot, nil
	}
	intent := ""
	if snapshot.Grant != nil {
		if len(grantIntent) < 1 || !attemptID.MatchString(grantIntent[0]) {
			return nil, errors.New("grant Begin requires its original intent and fresh authenticated outbound verification; no interval committed")
		}
		intent = grantIntent[0]
	}
	accountLock, err := e.accountWorkLock(snapshot.UID)
	if err != nil {
		return nil, err
	}
	defer accountLock.Close()
	if snapshot.Settings.TemplateVersion != "" {
		if e.templateVerify == nil {
			return nil, errors.New("recorded template verifier unavailable; no interval consumed; inspect matching native binaries and exam-template.slice")
		}
		if err := e.templateVerify(snapshot.Settings); err != nil {
			return nil, fmt.Errorf("recorded template verification failed before Begin; no interval or grant consumed; inspect templates verify NAME HASH and retry only after repair: %w", err)
		}
	}
	// Recheck after acquiring the UID fence and before destructive OS work.
	if err := e.WithState(func() error {
		a, err := e.Find(snapshot.ID)
		if err != nil || !workspaceFence(a, snapshot) {
			return errors.New("preparation changed before activation checks; inspect and retry Begin")
		}
		return nil
	}); err != nil {
		return nil, err
	}
	if err := e.activationPrepare(snapshot); err != nil {
		return nil, err
	}
	var pending *terminalAuthorityBegin
	var verified verifiedGrantBegin
	if original != nil {
		if initialOwner == nil {
			return nil, errRegisteredOwner
		}
		pending, err = e.prepareTerminalAuthority(original, snapshot, *initialOwner, intent)
		if err != nil {
			return nil, err
		}
		defer e.cancelTerminalAuthority(pending)
	}
	verifiedUntil := int64(0)
	if snapshot.Grant != nil {
		var err error
		var nonce []string
		if pending != nil {
			nonce = []string{pending.Nonce}
		}
		verified, err = e.verifyGrantBeginContext(snapshot, intent, page, initialOwner, nonce...)
		if err != nil {
			return nil, err
		}
		if pending != nil {
			// The supervisor owns the nonce's ORIGINAL issue time. Charge setup
			// before the HTTPS request too, and refuse before starting the clock.
			verified.until = min(verified.until, pending.IssuedBootMS+verified.captureValidFor)
		}
		verifiedUntil = verified.until
	}
	if snapshot.Workspace != nil && snapshot.Workspace.Source.Kind == "saved" {
		lock, err := e.recoveryCatalogLock()
		if err != nil {
			return nil, err
		}
		defer lock.Close()
	}
	var result any
	err = e.WithState(func() error {
		a, err := e.Find(snapshot.ID)
		if err != nil || !workspaceFence(a, snapshot) {
			return errors.New("preparation changed during activation checks; no interval committed; inspect and retry Begin")
		}
		if err := e.practiceGrantMode(a); err != nil {
			return err
		}
		if expires > 0 && expires <= Millis() {
			return errors.New("Begin command expired during setup; no interval committed; restore monitoring and retry Begin")
		}
		if a.Grant != nil {
			verifiedNow, err := monitoringBootMillis()
			if err != nil {
				return err
			}
			if verifiedUntil <= verifiedNow {
				return errors.New("fresh grant verification expired during setup; inspect original intent and retry; no interval committed")
			}
			for _, other := range e.state.Attempts {
				if other.ID != a.ID && other.Grant != nil && other.Grant.ID == a.Grant.ID && other.Start > 0 {
					return errors.New("grant already consumed by another original interval; no reopening/refund authorized")
				}
			}
		}
		if _, err := e.callLocked("activate-attempt", Request{ID: a.ID}); err != nil {
			return err
		}
		if a.Grant != nil {
			if err := e.workspaceBarrier("grant-before-start"); err != nil {
				return err
			}
		}
		startedAt := Millis()
		if a.Grant != nil {
			if expires > 0 && expires <= startedAt {
				return errors.New("Begin command expired after final metadata checks; no interval committed; retry the original intent after inspection")
			}
			verifiedNow, err := monitoringBootMillis()
			if err != nil {
				return err
			}
			if verifiedUntil <= verifiedNow {
				return errors.New("fresh grant verification expired after final metadata checks; no interval committed; retry the original intent after inspection")
			}
			if startedAt < a.Settings.Earliest || startedAt > a.Settings.Latest {
				return errors.New("outside grant Begin window after final metadata checks; no interval committed")
			}
			e.expirePreflight(a, startedAt)
			if a.State != "PREPARING" {
				return errors.New("preparation expired before actual grant start; no interval committed; confirm cancellation before retry")
			}
		}
		commitStart(a, startedAt, uptime(), boot())
		if pending != nil {
			a.MonitoringMode = "v1"
		}
		if err := registerPageOwner(a, page, epoch); err != nil {
			return err
		}
		if a.Grant != nil {
			a.GrantBeginIntent = intent
		}
		if e.temporaryPolicy(a) {
			a.PolicyState, a.PolicyExpires = "HELD", 0
		}
		a.State, a.Reason = "ACTIVATING", "Activation in progress"
		if err := e.save(); err != nil {
			return err
		}
		if err := e.workspaceBarrier("start-committed"); err != nil {
			return err
		}
		if err := e.publishWorkspace(a); err != nil {
			a.State, a.Reason = "COLLECTION_FAILED", "Activation failed after access hold was committed"
			a.Errors, a.Lease = appendError(a.Errors, err.Error()), 0
			return err
		}
		a.State, a.Reason = "ACTIVE", ""
		e.Audit("activate-attempt", a.ID)
		result = a
		return nil
	})
	if err == nil && pending != nil {
		if err := e.commitTerminalAuthority(pending, result.(*Attempt), verified); err != nil {
			return result, fmt.Errorf("original interval committed but live monitoring bootstrap is unconfirmed; inspect the same attempt and supervisor, never restart its clock: %w", err)
		}
	}
	return result, err
}

// A short, same-filesystem publication only, after the original interval/hold is
// durably committed. A restart may finish publication of that SAME interval, but
// must never recopy mutable sources, overwrite edits, reset time or reopen it.
func (e *Engine) publishWorkspace(a *Attempt) error {
	if a.Start == 0 || a.Deadline == 0 || a.OriginalDeadline == 0 || a.Workspace == nil {
		return errors.New("workspace publication requires an already committed interval and receipt")
	}
	base := e.workspaceBase(a.ID)
	r, err := readWorkspaceReceipt(base)
	if err != nil {
		return err
	}
	// RecoveryReference also fences consumption to this attempt and preserves
	// legacy administrator intent until unified grants replace it.
	if err := e.checkWorkspaceReceipt(a, r); err != nil {
		return err
	}
	if r.Source.Kind == "saved" && a.Grant == nil {
		if err := e.commitRecoveryConsumption(a); err != nil {
			return err
		}
		if err := e.workspaceBarrier("recovery-consumed"); err != nil {
			return err
		}
	}
	dest := filepath.Join(base, "work")
	if _, err := os.Lstat(dest); os.IsNotExist(err) {
		stage := filepath.Join(base, "workspace-ready", "work")
		if err := workspaceDirectoryMatches(stage, r); err != nil {
			return err
		}
		if err := unix.Renameat2(unix.AT_FDCWD, stage, unix.AT_FDCWD, dest, unix.RENAME_NOREPLACE); err != nil {
			return err
		}
	} else if err != nil {
		return err
	}
	if err := workspaceDirectoryMatches(dest, r); err != nil {
		return err
	}
	if err := syncDirectory(base); err != nil {
		return err
	}
	if err := syncDirectory(filepath.Join(base, "workspace-ready")); err != nil {
		return err
	}
	if err := e.workspaceBarrier("work-published"); err != nil {
		return err
	}
	marker := filepath.Join(base, "initialized")
	if err := durableFile(marker, []byte("1")); err != nil && !os.IsExist(err) {
		return err
	}
	if err := syncDirectory(base); err != nil {
		return err
	}
	return e.workspaceBarrier("initialized")
}

func (e *Engine) preparedWorkspace(id string) (any, error) {
	if err := e.collectionRun("workspace-prepare", id); err != nil {
		return nil, fmt.Errorf("private workspace staging failed (clock unchanged): %w; inspect examctl info %s and retry examctl workspace-prepare %s after repair", err, id, id)
	}
	var result any
	err := e.WithState(func() error { a, err := e.Find(id); result = a; return err })
	return result, err
}

// No live-state reopening: operator repair merely makes the already prepared
// files collectable after an interrupted publication. retry/finalization remains
// a separate, explicit action and original timing/access holds are preserved.
func (e *Engine) repairWorkspace(id string) (any, error) {
	lock, err := e.attemptCollectionLock(id)
	if err != nil {
		return nil, err
	}
	defer lock.Close()
	catalogLock, err := e.recoveryCatalogLock()
	if err != nil {
		return nil, err
	}
	defer catalogLock.Close()
	var result any
	err = e.WithState(func() error {
		a, err := e.Find(id)
		if err != nil {
			return err
		}
		if a.State != "ACTIVATING" && a.State != "COLLECTION_FAILED" {
			return errors.New("workspace repair only supports interrupted committed activation; inspect the attempt, do not reopen active/completed work")
		}
		if err := e.publishWorkspace(a); err != nil {
			return err
		}
		a.State = "COLLECTION_FAILED"
		a.Lease, a.Authorization = 0, 0
		a.Reason = "Interrupted workspace publication repaired; explicit protected finalization required"
		e.Audit("workspace-publication-repaired", a.ID)
		result = a
		return nil
	})
	return result, err
}
