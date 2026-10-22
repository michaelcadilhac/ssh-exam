package core

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
)

// Read-only visibility for native-only legacy authorizations. These are NOT
// unified grants, nor proof that a recorded source still hashes correctly.
type RecoveryGrantView struct {
	RecoveryPreparation
	ConsumedBy              string `json:"consumed_by,omitempty"`
	Disposition             string `json:"disposition"`
	ConsumerState           string `json:"consumer_state,omitempty"`
	SourceRecordedProtected bool   `json:"source_recorded_protected"`
}

func (e *Engine) recoveryCatalogLock() (*os.File, error) {
	lock, err := e.collectionLock("recovery-catalog")
	if err != nil {
		return nil, fmt.Errorf("saved-work authorization catalog is changing; retry after the current workflow settles: %w", err)
	}
	return lock, nil
}

func catalogEntries(root *os.Root, name string, limit int) ([]os.DirEntry, error) {
	f, err := root.OpenFile(name, os.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	i, err := f.Stat()
	if err != nil || i.Mode().Perm()&0077 != 0 || i.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) {
		return nil, errors.New("legacy authorization directory must be root-private")
	}
	entries, err := f.ReadDir(limit + 1)
	if err != nil && err != io.EOF {
		return nil, err
	}
	if len(entries) > limit {
		return nil, errors.New("legacy authorization catalog exceeds safe entry bound; preserve it for migration")
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
	return entries, nil
}

func catalogFile(root *os.Root, name string, limit int64) ([]byte, error) {
	f, err := root.OpenFile(name, os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	i, err := f.Stat()
	if err != nil || !i.Mode().IsRegular() || i.Mode().Perm()&0077 != 0 || i.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) || i.Sys().(*syscall.Stat_t).Nlink != 1 || i.Size() > limit {
		return nil, errors.New("unsafe legacy authorization file; preserve catalog and diagnose before deletion")
	}
	b, err := io.ReadAll(io.LimitReader(f, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(b)) > limit {
		return nil, errors.New("legacy authorization file exceeds safe size")
	}
	return b, nil
}

// Run outside shared state; callers serialize supported catalog consumers and
// source deletion using the catalog flock. Unrecognized files/markers are not
// silently skipped: their dependencies cannot be proven safe to delete.
func (e *Engine) readRecoveryCatalog(state State) ([]RecoveryGrantView, error) {
	parent := filepath.Join(e.Config.State, "recovery-preparations")
	i, err := os.Lstat(parent)
	if os.IsNotExist(err) {
		return []RecoveryGrantView{}, nil
	}
	if err != nil {
		return nil, err
	}
	if !i.IsDir() || i.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("legacy authorization catalog must be a real private directory")
	}
	root, err := os.OpenRoot(parent)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	exams, err := catalogEntries(root, ".", 10000)
	if err != nil {
		return nil, err
	}
	result := []RecoveryGrantView{}
	var total int64
	entriesLeft := 20000
	for _, exam := range exams {
		if !identifier.MatchString(exam.Name()) || !exam.IsDir() {
			return nil, errors.New("unrecognized legacy authorization catalog entry; preserve it for inspection/migration")
		}
		entries, err := catalogEntries(root, exam.Name(), entriesLeft)
		if err != nil {
			return nil, err
		}
		entriesLeft -= len(entries)
		files := map[string]bool{}
		for _, entry := range entries {
			files[entry.Name()] = true
		}
		for _, entry := range entries {
			name := entry.Name()
			if strings.HasSuffix(name, ".json.consumed") {
				if !files[strings.TrimSuffix(name, ".consumed")] {
					return nil, errors.New("orphan legacy consumption marker; preserve it and inspect history before deletion")
				}
				continue
			}
			username := strings.TrimSuffix(name, ".json")
			if !strings.HasSuffix(name, ".json") || !identifier.MatchString(username) || entry.IsDir() {
				return nil, errors.New("unrecognized legacy authorization file; refusing dependency-blind deletion")
			}
			if len(result) >= 10000 {
				return nil, errors.New("legacy authorization record limit exceeded; preserve catalog for migration")
			}
			rel := filepath.Join(exam.Name(), name)
			b, err := catalogFile(root, rel, 16384)
			if err != nil {
				return nil, fmt.Errorf("legacy authorization %s/%s: %w", exam.Name(), username, err)
			}
			total += int64(len(b))
			if total > 16*1024*1024 {
				return nil, errors.New("legacy authorization metadata exceeds 16 MiB; preserve catalog for bounded migration")
			}
			r, err := decodeRecoveryMetadata(b)
			if err != nil {
				return nil, fmt.Errorf("malformed legacy authorization %s/%s; preserve catalog and diagnose before deletion", exam.Name(), username)
			}
			if r.Exam != exam.Name() || r.Username != username {
				return nil, fmt.Errorf("legacy authorization %s/%s identity/allowance invalid; preserve catalog before deletion", exam.Name(), username)
			}
			view := RecoveryGrantView{RecoveryPreparation: *r, Disposition: "unused"}
			if prior := state.Attempts[r.SourceAttempt]; prior != nil {
				view.SourceRecordedProtected = prior.Protected && prior.State == "COMPLETED" && prior.Username == r.Username && prior.UID == r.UID && prior.Checksum == r.Checksum
			}
			if files[name+".consumed"] {
				b, err := catalogFile(root, rel+".consumed", 36)
				if err != nil {
					return nil, fmt.Errorf("legacy consumption marker %s/%s: %w", exam.Name(), username, err)
				}
				if !attemptID.Match(b) {
					return nil, fmt.Errorf("invalid legacy consumption marker %s/%s; preserve history before deletion", exam.Name(), username)
				}
				view.ConsumedBy = string(b)
				view.Disposition = "uncertain"
				if a := state.Attempts[view.ConsumedBy]; a != nil {
					view.ConsumerState = a.State
					matches := a.Exam == r.Exam && a.Username == r.Username && a.UID == r.UID && a.Settings.Duration == r.Duration && recoveryConsumedIntervalKnown(a, r)
					if a.Workspace != nil {
						matches = matches && a.Workspace.Source.Kind == "saved" && a.Workspace.Source.Attempt == r.SourceAttempt && a.Workspace.Source.Checksum == r.Checksum && a.Workspace.RecoveryHash == recoveryReferenceHash(r)
					}
					if matches {
						view.Disposition = "consumed"
					}
				}
			}
			// A persisted interval can consume a legacy grant even if the process
			// died before writing its one-use marker. Never call that unused.
			if view.ConsumedBy == "" {
				for _, a := range state.Attempts {
					if a.Exam == r.Exam && a.Username == r.Username && a.UID == r.UID && a.Start >= r.CreatedAt {
						view.Disposition = "uncertain"
						break
					}
				}
			}
			result = append(result, view)
		}
	}
	return result, nil
}

func (e *Engine) RecoveryGrants(exam string) ([]RecoveryGrantView, error) {
	if exam != "" && !identifier.MatchString(exam) {
		return nil, errors.New("invalid exam ID; use examctl recovery-grants --exam EXAM")
	}
	lock, err := e.recoveryCatalogLock()
	if err != nil {
		return nil, err
	}
	defer lock.Close()
	state, err := readStateSnapshot(e.Config.State)
	if err != nil {
		return nil, fmt.Errorf("native history unavailable; preserve initialized/state/grant markers: %w", err)
	}
	rows, err := e.readRecoveryCatalog(state)
	if err != nil {
		return nil, err
	}
	if exam != "" {
		filtered := []RecoveryGrantView{}
		for _, r := range rows {
			if r.Exam == exam {
				filtered = append(filtered, r)
			}
		}
		rows = filtered
	}
	return rows, nil
}

// Isolated verification before source deletion. The root coordinator owns the
// source-attempt and catalog locks across this check and the final short commit.
func (e *Engine) checkSubmissionDependencies(source *Attempt) error {
	for _, a := range e.state.Attempts {
		if a.Workspace != nil && a.Workspace.Source.Kind == "saved" && a.Workspace.Source.Attempt == source.ID && a.State != "COMPLETED" && a.State != "CANCELLED_BEFORE_START" {
			return fmt.Errorf("submission is required by unfinished saved-work attempt %s (%s); inspect examctl info %s and examctl recovery-grants; preserve source and all intervals", a.ID, a.State, a.ID)
		}
	}
	rows, err := e.readRecoveryCatalog(e.state)
	if err != nil {
		return err
	}
	for _, r := range rows {
		if r.SourceAttempt != source.ID {
			continue
		}
		consumer := e.state.Attempts[r.ConsumedBy]
		if r.Disposition != "consumed" || consumer == nil || consumer.State != "COMPLETED" {
			return fmt.Errorf("submission is required by %s saved-work authorization for exam %s/account %s; inspect examctl recovery-grants --exam %s and examctl info %s; do not remove grants/consumed markers or release holds to force deletion", r.Disposition, r.Exam, r.Username, r.Exam, source.ID)
		}
	}
	return nil
}

func submissionDeleteEligible(a *Attempt) error {
	if a.State != "COMPLETED" || accessHeld(a) {
		return errors.New("submission cannot be deleted until the account restriction is released")
	}
	return nil
}

func (e *Engine) verifySubmissionDeletion(id string) error {
	if err := e.WithState(func() error {
		a, err := e.Find(id)
		if err != nil {
			return err
		}
		return submissionDeleteEligible(a)
	}); err != nil {
		return err
	}
	return e.collectionRun("check-delete", id)
}
