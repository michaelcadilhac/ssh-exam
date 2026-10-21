package core

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"syscall"
)

var errCollectionPending = errors.New("collection worker busy; request remains pending; inspect the attempt and retry")

// Lock order is attempt job -> worker slot -> short state transaction. Never
// acquire a job/slot lock or wait for an OS operation inside WithState.
func (e *Engine) collectionLock(name string) (*os.File, error) {
	dir := filepath.Join(e.Config.State, "collection-locks")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(filepath.Join(dir, name), os.O_CREATE|os.O_RDWR|syscall.O_NOFOLLOW, 0600)
	if err != nil {
		return nil, err
	}
	if err = syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		f.Close()
		if errors.Is(err, syscall.EWOULDBLOCK) {
			return nil, errCollectionPending
		}
		return nil, err
	}
	return f, nil // Closing also unlocks, including after fatal worker death.
}

func (e *Engine) attemptCollectionLock(id string) (*os.File, error) {
	if !attemptID.MatchString(id) {
		return nil, errors.New("invalid collection attempt UUID")
	}
	return e.collectionLock(id)
}

func collectionFence(a, snapshot *Attempt) bool {
	return protectedIdentity(a, snapshot) && a.CollectionJob == snapshot.CollectionJob && a.Generation == snapshot.Generation && a.State == snapshot.State && a.Checksum == snapshot.Checksum && a.Protected == snapshot.Protected
}

// Runs in a resource-bounded worker, not a PTY-owning agent. The worker holds a
// persistent per-attempt lock across publication and cleanup, so coordinator
// death cannot allow overlapping collectors or mutable-work recollection.
func (e *Engine) runCollectionJob(action, id string) error {
	var err error
	if action != "check-release" && action != "check-delete" {
		lock, lockErr := e.attemptCollectionLock(id)
		if lockErr != nil {
			return lockErr
		}
		defer lock.Close()
	}
	var slot *os.File
	for i := range 2 {
		slot, err = e.collectionLock(fmt.Sprintf("slot-%d", i))
		if err == nil {
			break
		}
		if !errors.Is(err, errCollectionPending) {
			return err
		}
	}
	if slot == nil {
		return errCollectionPending
	}
	defer slot.Close()
	var snapshot Attempt
	err = e.WithState(func() error {
		a, err := e.Find(id)
		if err != nil {
			return err
		}
		if a.ID != id {
			return errors.New("collection attempt identity mismatch; administrator recovery required")
		}
		if action == "finalize" {
			if a.State == "COMPLETED" {
				snapshot = *a
				return nil
			}
			if a.Start == 0 || (a.State != "FINALIZING" && a.State != "COLLECTION_FAILED") || (expired(a) && e.timingRequired(a)) {
				return errors.New("collection state changed or deadline timing verification required; inspect and retry")
			}
			a.State = "FINALIZING"
			if a.CollectionJob == "" {
				a.CollectionJob = Token() // Adopt interrupted pre-upgrade finalization.
			}
		}
		snapshot = *a
		return nil
	})
	if err != nil {
		return err
	}
	// e.state is a private, loaded snapshot in this worker, including the trusted
	// SSH registrations used by writer verification. No shared-state lock is held.
	switch action {
	case "check-delete":
		if err := submissionDeleteEligible(&snapshot); err != nil {
			return err
		}
		return e.checkSubmissionDependencies(&snapshot)
	case "workspace-prepare":
		return e.stageWorkspace(&snapshot)
	case "finalize":
		if snapshot.State == "COMPLETED" {
			return nil
		}
		return e.collectAndComplete(&snapshot)
	case "manifest":
		if !snapshot.Protected {
			return errors.New("protected submission unavailable")
		}
		m, err := ReadProtected(filepath.Join(e.Config.State, "submissions", id), &snapshot)
		if err != nil {
			e.invalidateManifestReceipt(&snapshot, err)
			return err
		}
		return e.WithState(func() error {
			a, err := e.Find(id)
			if err != nil || !collectionFence(a, &snapshot) {
				return errors.New("protected submission changed during verification; inspect and retry")
			}
			e.rememberManifest(m)
			return nil
		})
	case "release":
		before := snapshot
		e.reconcileAccess(&snapshot) // Hashing, termination and /proc checks outside WithState.
		return e.WithState(func() error {
			a, err := e.Find(id)
			if err != nil || !collectionFence(a, &before) || a.AccessState != before.AccessState || a.PolicyGeneration != before.PolicyGeneration || a.PolicyState != before.PolicyState {
				return errors.New("access state changed during verification; inspect and reconcile again")
			}
			a.AccessState, a.AccessError, a.AccessReleasedAt = snapshot.AccessState, snapshot.AccessError, snapshot.AccessReleasedAt
			a.PolicyRestoreAuthorized, a.PolicyState = snapshot.PolicyRestoreAuthorized, snapshot.PolicyState
			return nil
		})
	case "check-release":
		// Read-only verification for emergency override. The root coordinator
		// owns the attempt lock across this call and its fenced audited commit.
		return e.verifyRelease(&snapshot)
	default:
		return errors.New("unsupported collection worker action")
	}
}

func (e *Engine) rememberManifest(m *Manifest) {
	if e.state.ManifestReceipts == nil {
		e.state.ManifestReceipts = map[string]string{}
	}
	// Keep a small anchor, not every historical file inventory in state.json.
	// Only the isolated verifier installs this after hashing the archive bytes.
	e.state.ManifestReceipts[m.Attempt.ID] = m.metadataHash
}

func (e *Engine) invalidateManifestReceipt(snapshot *Attempt, cause error) {
	_ = e.WithState(func() error {
		a, err := e.Find(snapshot.ID)
		if err != nil || !collectionFence(a, snapshot) {
			return errors.New("protected verification result superseded")
		}
		delete(e.state.ManifestReceipts, a.ID)
		a.Errors = appendError(a.Errors, "Protected verification failed: "+cause.Error())
		e.Audit("protected-verification-failed", a.ID)
		return nil
	})
}

// Read bounded root-private metadata anchored by a worker's archive-verification
// commit. This never decompresses/hashes submission bytes under the global lock.
// Legacy records have no anchor until an explicit worker verification succeeds.
func (e *Engine) manifestReceipt(a *Attempt) (*Manifest, error) {
	anchor := e.state.ManifestReceipts[a.ID]
	if !a.Protected || len(anchor) != 64 {
		return nil, errors.New("verified protected receipt unavailable; run examctl manifest ATTEMPT")
	}
	root, err := os.OpenRoot(filepath.Join(e.Config.State, "submissions", a.ID))
	if err != nil {
		return nil, err
	}
	defer root.Close()
	f, err := root.OpenFile("manifest.json", os.O_RDONLY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > 4*1024*1024 {
		return nil, errors.New("invalid protected receipt metadata")
	}
	b, err := io.ReadAll(io.LimitReader(f, 4*1024*1024+1))
	if err != nil || len(b) > 4*1024*1024 || Hash(b) != anchor {
		return nil, errors.New("protected receipt metadata changed; verify the bundle before retrying")
	}
	var m Manifest
	if err := json.Unmarshal(b, &m); err != nil || !protectedIdentity(m.Attempt, a) || (m.Checksum != "" && m.Checksum != a.Checksum) || len(m.Files)+len(m.Omissions) > 10000 {
		return nil, errors.New("protected receipt identity mismatch")
	}
	m.Checksum, m.metadataHash = a.Checksum, anchor
	return &m, nil
}

func (e *Engine) collectAndComplete(snapshot *Attempt) error {
	fail := func(cause error) error {
		err := e.WithState(func() error {
			a, err := e.Find(snapshot.ID)
			if err != nil || !collectionFence(a, snapshot) {
				return errors.New("collection result superseded; inspect and retry")
			}
			a.State = "COLLECTION_FAILED"
			a.Errors = appendError(a.Errors, cause.Error())
			e.Audit("collection-failed", a.ID)
			return nil
		})
		return errors.Join(cause, err)
	}
	dest := filepath.Join(e.Config.State, "submissions", snapshot.ID)
	if _, err := os.Lstat(dest); os.IsNotExist(err) {
		if snapshot.Protected {
			cause := errors.New("recorded protected archive missing; recollection forbidden")
			e.invalidateManifestReceipt(snapshot, cause)
			return fail(cause)
		}
		if err = e.quiesce(snapshot); err != nil {
			return fail(err)
		}
		// CompletedAt is part of the immutable receipt, not the coordinator's
		// mutable fence. Keep the original fence until publication is committed.
		collected := *snapshot
		if collected.CompletedAt == 0 {
			collected.CompletedAt = Millis()
		}
		if _, err = Collect(filepath.Join(e.Config.Work, snapshot.ID, "work"), dest, &collected); err != nil {
			return fail(err)
		}
	} else if err != nil {
		return fail(err)
	}
	// A crash may have published the bundle before recording protection. Adopt
	// exactly those verified bytes; never reopen the live working directory.
	m, err := ReadProtected(dest, snapshot)
	if err != nil {
		e.invalidateManifestReceipt(snapshot, err)
		return fail(err)
	}
	err = e.WithState(func() error {
		a, err := e.Find(snapshot.ID)
		if err != nil || !collectionFence(a, snapshot) {
			return errors.New("collection publication superseded; inspect and retry")
		}
		a.Checksum, a.Protected = m.Checksum, true
		a.CollectedAt, a.SecuredAt, a.CompletedAt = m.Collected, m.Secured, m.Attempt.CompletedAt
		a.Ended, a.Reason = m.Attempt.Ended, m.Attempt.Reason
		e.rememberManifest(m)
		*snapshot = *a
		return nil
	})
	if err != nil {
		return err // Published bytes remain recoverable even if state storage fails.
	}
	if err = e.terminate(snapshot); err != nil {
		return fail(err)
	}
	if err = e.cleanupTemporary(snapshot); err != nil {
		return fail(err)
	}
	return e.WithState(func() error {
		a, err := e.Find(snapshot.ID)
		if err != nil || !collectionFence(a, snapshot) {
			return errors.New("collection cleanup superseded; inspect and retry")
		}
		a.Units = []string{}
		a.State = "COMPLETED"
		e.Audit("protected-collection-complete", a.ID)
		return nil
	})
}

// A failed supervisor may not have received any reply. Only the matching attempt
// is failed, and only after the worker's persistent lock has actually gone away.
func (e *Engine) collectionProcessFailed(id, job string, cause error) {
	lock, err := e.attemptCollectionLock(id)
	if err != nil {
		return
	}
	defer lock.Close()
	_ = e.WithState(func() error {
		a, err := e.Find(id)
		if err == nil && a.State == "FINALIZING" && a.CollectionJob == job {
			a.State = "COLLECTION_FAILED"
			a.Errors = appendError(a.Errors, cause.Error())
			e.Audit("collection-worker-failed", id)
		}
		return err
	})
}

// Explicit reconciliation replaces hidden archive hashing/systemd waits on
// every shared-state read. Unknown/unverified records remain held until this
// independently verified, fenced operation succeeds.
func (e *Engine) reconcileAccessOutside(only string) error {
	var ids []string
	if err := e.WithState(func() error {
		for _, a := range e.state.Attempts {
			if (only == "" || a.ID == only) && a.Start > 0 && a.State == "COMPLETED" && accessHeld(a) && ((sandboxAttempt(a) && !e.temporaryPolicy(a)) || restrictionElapsed(a)) {
				ids = append(ids, a.ID)
			}
		}
		return nil
	}); err != nil {
		return err
	}
	var failures []error
	for _, id := range ids {
		if err := e.collectionRun("release", id); err != nil && !errors.Is(err, errCollectionPending) {
			failures = append(failures, err)
		}
	}
	return errors.Join(failures...)
}

func (e *Engine) finishCollection(id string) (any, error) {
	runErr := e.collectionRun("finalize", id)
	if errors.Is(runErr, errCollectionPending) {
		runErr = nil // Durable FINALIZING state is honest pending status, not completion.
	}
	var result *Attempt
	err := e.WithState(func() error {
		a, err := e.Find(id)
		if err == nil {
			result = publicAttempt(a)
		}
		return err
	})
	return result, errors.Join(runErr, err)
}

func (e *Engine) verifiedManifest(id string) (*Manifest, error) {
	if err := e.collectionRun("manifest", id); err != nil {
		return nil, err
	}
	var result *Manifest
	err := e.WithState(func() error {
		a, err := e.Find(id)
		if err != nil {
			return err
		}
		m, err := e.manifestReceipt(a)
		if err != nil {
			return err
		}
		v := *m
		v.Attempt = publicAttempt(m.Attempt)
		result = &v
		return nil
	})
	return result, err
}
