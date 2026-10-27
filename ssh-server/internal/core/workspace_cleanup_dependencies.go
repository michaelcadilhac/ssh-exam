package core

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// This runs in the isolated source-deletion worker under the source attempt/job
// fence, never in the renewal loop or while holding shared state for disk work.
func (e *Engine) checkWorkspaceCleanupDependency(a *Attempt) error {
	j, data, err := e.readCleanupJob(a.ID, "")
	if err != nil {
		return err
	}
	if err := e.checkCleanupQuarantine(e.state); err != nil {
		return err
	}
	if j == nil {
		return nil
	}
	if j.Exam != a.Exam || j.Username != a.Username || j.UID != a.UID || j.Start != a.Start || j.OriginalDeadline != a.OriginalDeadline || j.Checksum != a.Checksum {
		return errWorkspaceCleanupRecord
	}
	if cleanupPending(j) {
		return fmt.Errorf("protected archive is pinned by interrupted workspace cleanup %s (%s); run examctl workspaces cleanup-status %s --request %s; complete/reversibly cancel it before submission deletion", j.Request, j.Phase, a.ID, j.Request)
	}
	canonical, err := cleanupPathIdentity(e.workspaceBase(a.ID))
	if err != nil {
		return err
	}
	q, err := cleanupPathIdentity(e.cleanupQuarantinePath(j))
	if err != nil {
		return err
	}
	if q.Exists || j.Phase == "COMPLETED" && canonical.Exists || j.Phase == "CANCELLED" && (!canonical.Exists || canonical.Device != j.Base.Device || canonical.Inode != j.Base.Inode) {
		return errors.New("workspace cleanup terminal receipt contradicts physical files; preserve archive and inspect cleanup-status")
	}
	// A visible terminal rename is not yet durable release of its recovery pin.
	if err := syncCleanupReceipt(filepath.Join(e.cleanupDirectory(), a.ID+".json")); err != nil {
		return err
	}
	current, err := os.ReadFile(filepath.Join(e.cleanupDirectory(), a.ID+".json"))
	if err != nil || string(current) != string(data) {
		return errWorkspaceCleanupRecord
	}
	if err := syncDirectory(e.Config.Work); err != nil {
		return err
	}
	if _, err := os.Lstat(e.cleanupQuarantine()); err == nil {
		return syncDirectory(e.cleanupQuarantine())
	} else if !os.IsNotExist(err) {
		return err
	}
	return nil
}

// The reserved directory cannot hide unknown or no-start crash evidence. Each
// child must name the exact positive started/protected job and original inode.
func (e *Engine) checkCleanupQuarantine(state State) error {
	if _, err := os.Lstat(e.cleanupQuarantine()); os.IsNotExist(err) {
		return nil
	} else if err != nil {
		return err
	}
	f, err := readOnlyRoot(e.cleanupQuarantine())
	if err != nil {
		return err
	}
	defer f.Close()
	entries, err := f.ReadDir(20001)
	if err != nil && err != io.EOF || len(entries) > 20000 {
		return errWorkspaceCleanupRecord
	}
	for _, entry := range entries {
		parts := strings.Split(entry.Name(), ".")
		if len(parts) != 2 || !entry.IsDir() || !attemptID.MatchString(parts[0]) || !attemptID.MatchString(parts[1]) {
			return errors.New("unknown cleanup quarantine residue; preserve it and inspect cleanup-status before source deletion or no-start cancellation")
		}
		j, _, err := e.readCleanupJob(parts[0], "")
		if err != nil || j == nil || j.Request != parts[1] || !cleanupPending(j) {
			return errWorkspaceCleanupRecord
		}
		a := state.Attempts[j.Attempt]
		if a == nil || a.ID != j.Attempt || a.Exam != j.Exam || a.Username != j.Username || a.UID != j.UID || a.State != "COMPLETED" || !a.Protected || a.Checksum != j.Checksum || a.Start != j.Start || a.OriginalDeadline != j.OriginalDeadline {
			return errWorkspaceCleanupRecord
		}
		identity, err := cleanupPathIdentity(filepath.Join(e.cleanupQuarantine(), entry.Name()))
		if err != nil || identity.Device != j.Base.Device || identity.Inode != j.Base.Inode || identity.OwnerUID != 0 {
			return errWorkspaceCleanupRecord
		}
	}
	return nil
}

// No-start/definition-retirement proof must include independent cleanup history
// even after BOTH the live folder and an explicitly retired archive are absent.
func (e *Engine) checkCleanupHistoryAuthority(state State) error {
	root, err := readOnlyRoot(e.Config.State)
	if err != nil {
		return err
	}
	defer root.Close()
	initialized, err := e.workspaceRetentionMarker("workspace-cleanups-initialized", []byte("Workspace cleanup catalog v1\n"), false)
	if err != nil {
		return err
	}
	rows, err := root.ReadDir(20001)
	if err != nil && err != io.EOF || len(rows) > 20000 {
		return errWorkspaceCleanupRecord
	}
	known := map[string]bool{}
	for _, row := range rows {
		if strings.HasPrefix(row.Name(), "workspace-cleanup-known-") {
			id := strings.TrimPrefix(row.Name(), "workspace-cleanup-known-")
			if !attemptID.MatchString(id) {
				return errWorkspaceCleanupRecord
			}
			known[id] = true
		}
	}
	dir, err := readOnlyOpenAt(root, "workspace-cleanups", true)
	if os.IsNotExist(err) && !initialized && len(known) == 0 {
		return nil
	}
	if err != nil {
		return errWorkspaceCleanupRecord
	}
	defer dir.Close()
	entries, err := dir.ReadDir(20001)
	if err != nil && err != io.EOF || len(entries) > 20000 {
		return errWorkspaceCleanupRecord
	}
	for _, entry := range entries {
		id := strings.TrimSuffix(entry.Name(), ".json")
		if id == entry.Name() || !attemptID.MatchString(id) {
			return errors.New("unknown workspace cleanup crash residue; preserve it and restore consistent verified metadata before no-start/definition retirement")
		}
		j, _, err := e.readCleanupJob(id, "")
		if err != nil || j == nil {
			return errWorkspaceCleanupRecord
		}
		delete(known, id)
		a := state.Attempts[id]
		if a == nil || a.ID != id || a.Exam != j.Exam || a.Username != j.Username || a.UID != j.UID || a.State != "COMPLETED" || a.Start != j.Start || a.OriginalDeadline != j.OriginalDeadline || (cleanupPending(j) && (!a.Protected || a.Checksum != j.Checksum)) {
			return errors.New("workspace cleanup history contradicts native attempt history; preserve receipts/archives; no no-start or unused-definition proof is available")
		}
	}
	if len(known) != 0 {
		return errWorkspaceCleanupRecord
	}
	return nil
}
