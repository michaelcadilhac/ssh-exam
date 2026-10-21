package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

func sparseCollectionFile(t *testing.T, p string, size int64) {
	t.Helper()
	f, err := os.Create(p)
	if err != nil {
		t.Fatal(err)
	}
	err = f.Truncate(size)
	closeErr := f.Close()
	if err != nil || closeErr != nil {
		t.Fatal(err, closeErr)
	}
}

func TestCollectionLimitsLegacyAndExplicitSnapshots(t *testing.T) {
	for _, tc := range []struct {
		s           Settings
		file, total int64
		invalid     bool
	}{
		{Settings{}, 32, 64, false},
		{Settings{CollectionFileMiB: DefaultCollectionFileMiB, CollectionTotalMiB: DefaultCollectionTotalMiB}, 128, 512, false},
		{Settings{CollectionFileMiB: 1, CollectionTotalMiB: 2}, 1, 2, false},
		{Settings{CollectionFileMiB: 128}, 0, 0, true},
		{Settings{CollectionTotalMiB: 512}, 0, 0, true},
		{Settings{CollectionFileMiB: 2, CollectionTotalMiB: 1}, 0, 0, true},
		{Settings{CollectionFileMiB: -1, CollectionTotalMiB: 2}, 0, 0, true},
		{Settings{CollectionFileMiB: 4097, CollectionTotalMiB: 16384}, 0, 0, true},
		{Settings{CollectionFileMiB: 4096, CollectionTotalMiB: 16385}, 0, 0, true},
	} {
		bounds, err := limitsForSettings(tc.s)
		if (err != nil) != tc.invalid || (!tc.invalid && (bounds.File != tc.file*mib || bounds.Total != tc.total*mib)) {
			t.Fatalf("wrong snapshot bounds %+v %+v %v", tc, bounds, err)
		}
	}
	// Omitting new scalar fields must preserve pre-existing private receipt hashes.
	s := Settings{Name: "old", ID: "exam", Duration: 5400, Template: "v1", Terminals: 4, Latest: 123}
	b, _ := json.Marshal(s)
	if string(b) != `{"name":"old","id":"exam","duration":5400,"webcam":false,"template":"v1","terminals":4,"earliest":0,"latest":123}` {
		t.Fatal("legacy settings encoding changed", string(b))
	}
}

func TestCollectionRejectsMemoryBackedProductionStorage(t *testing.T) {
	for _, kind := range []int64{0x01021994, 0x858458f6} {
		if !memoryBackedFilesystem(kind) {
			t.Fatal("memory-backed filesystem accepted", kind)
		}
	}
	for _, kind := range []int64{0xef53, 0x58465342, 0x9123683e} {
		if memoryBackedFilesystem(kind) {
			t.Fatal("disk filesystem mislabeled as memory-backed", kind)
		}
	}
	dir := t.TempDir()
	var stat syscall.Statfs_t
	if err := syscall.Statfs(dir, &stat); err != nil {
		t.Fatal(err)
	}
	issues := collectionStorageIssues(Config{State: dir, Work: dir})
	if memoryBackedFilesystem(stat.Type) && (len(issues) != 2 || !strings.Contains(issues[0], "preserve all state/work/bundles")) {
		t.Fatal("memory-backed readiness refusal missing", issues)
	}
}

func TestCollectionExactLogicalBoundsAndLegacyCompatibility(t *testing.T) {
	for _, tc := range []struct {
		name     string
		sizes    []int64
		legacy   bool
		expected string
	}{
		{"file-exact", []int64{mib}, false, ""},
		{"file-above", []int64{mib + 1}, false, "per-file logical size exceeded"},
		{"total-exact", []int64{mib, mib}, false, ""},
		{"total-above", []int64{mib, mib, 1}, false, "total logical size exceeded"},
		{"legacy-rejects-large", []int64{33 * mib}, true, "per-file logical size exceeded"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			work := t.TempDir()
			for i, size := range tc.sizes {
				sparseCollectionFile(t, filepath.Join(work, string(rune('a'+i))), size)
			}
			a := &Attempt{ID: finalID, Settings: Settings{CollectionFileMiB: 1, CollectionTotalMiB: 2}}
			if tc.legacy {
				a.Settings = Settings{}
			}
			dest := filepath.Join(t.TempDir(), "protected")
			_, err := Collect(work, dest, a)
			if tc.expected != "" {
				if err == nil || !strings.Contains(err.Error(), tc.expected) {
					t.Fatal("wrong limit failure", err)
				}
				if _, err := os.Lstat(dest); !os.IsNotExist(err) {
					t.Fatal("limit failure published partial success")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			manifest, err := ReadProtected(dest, a)
			if err != nil || len(manifest.Files) != len(tc.sizes) {
				t.Fatal("snapshot verifier disagrees", manifest, err)
			}
			changed := *a
			changed.Settings.CollectionTotalMiB++
			if _, err := ReadProtected(dest, &changed); err == nil {
				t.Fatal("verifier silently changed immutable limits")
			}
		})
	}
}

func TestModernCollectionAcceptsPreviouslyOversizedWork(t *testing.T) {
	work := t.TempDir()
	sparseCollectionFile(t, filepath.Join(work, "object.o"), 40*mib)
	a := &Attempt{ID: finalID, Settings: Settings{CollectionFileMiB: 128, CollectionTotalMiB: 512}}
	dest := filepath.Join(t.TempDir(), "protected")
	if _, err := Collect(work, dest, a); err != nil {
		t.Fatal(err)
	}
	m, err := ReadProtected(dest, a)
	if err != nil || len(m.Files) != 1 || m.Files[0].Size != 40*mib {
		t.Fatal("larger snapshotted work not verified", err)
	}
}

func TestSavedRestoreMustFitSourceAndTargetLimitsBeforeBegin(t *testing.T) {
	e, _, source := finalFixture(t, "LOCKED", Millis()+5400000)
	e.Config.Accounts = map[string]Account{"student": {UID: os.Getuid(), GID: os.Getgid()}}
	if err := e.WithState(func() error {
		a := e.state.Attempts[finalID]
		a.UID = os.Getuid()
		a.Settings.CollectionFileMiB = 2
		a.Settings.CollectionTotalMiB = 4
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	sparseCollectionFile(t, filepath.Join(source, "object.o"), 2*mib)
	result, err := e.Call("finalize-attempt", Request{ID: finalID, Reason: "Synthetic bounded source"})
	if err != nil {
		t.Fatal(err)
	}
	prior := result.(*Attempt)
	r := RecoveryPreparation{Exam: "recovery", Username: "student", UID: os.Getuid(), Duration: 5400, SourceAttempt: finalID, Checksum: prior.Checksum, CreatedAt: Millis(), Reason: "Explicit bounded saved-work allowance"}
	a := &Attempt{ID: recoveryID, Exam: r.Exam, Username: r.Username, UID: r.UID, State: "PREPARING", PreflightStartedAt: Millis(), Settings: Settings{ID: r.Exam, Duration: r.Duration, CollectionFileMiB: 1, CollectionTotalMiB: 4}}
	writeRecoveryFixture(t, e, a, r)
	if err := e.WithState(func() error { e.state.Attempts[a.ID] = a; return nil }); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Call("prepare-workspace", Request{ID: a.ID}); err == nil {
		t.Fatal("saved file exceeds target allowance but was staged")
	}
	assertUnstartedWorkspace(t, e, a.ID)
	if _, err := os.Stat(filepath.Join(e.Config.State, recoveryName(a)+".consumed")); !os.IsNotExist(err) {
		t.Fatal("failed restore consumed allowance")
	}
	if err := e.WithState(func() error {
		if len(e.state.Attempts[finalID].Errors) != 0 || !e.state.Attempts[finalID].Protected {
			t.Fatal("target limit failure mislabeled a valid protected source")
		}
		e.state.Attempts[a.ID].Settings.CollectionFileMiB = 2
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Call("prepare-workspace", Request{ID: a.ID}); err != nil {
		t.Fatal("explicit corrected unused target limits did not restore", err)
	}
	assertUnstartedWorkspace(t, e, a.ID)
}
