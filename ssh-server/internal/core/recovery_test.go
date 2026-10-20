package core

import (
	"archive/tar"
	"compress/gzip"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const recoveryID = "11111111-1234-1234-1234-123456789abc"
const retryRecoveryID = "22222222-1234-1234-1234-123456789abc"

func recoveryFixture(t *testing.T) (*Engine, *Attempt, RecoveryPreparation) {
	t.Helper()
	e, _, _ := finalFixture(t, "LOCKED", Millis()+5400000)
	e.Config.Accounts = map[string]Account{"student": {UID: os.Getuid(), GID: os.Getgid()}}
	if err := e.WithState(func() error {
		e.state.Attempts[finalID].UID = os.Getuid()
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	result, err := e.Call("finalize-attempt", Request{ID: finalID, Reason: "secured incident original"})
	if err != nil {
		t.Fatal(err)
	}
	source := result.(*Attempt)
	r := RecoveryPreparation{Exam: "recovery", Username: "student", UID: os.Getuid(), Duration: 1385, SourceAttempt: finalID, Checksum: source.Checksum, CreatedAt: Millis() - 86400000, Reason: "Instructor approved outage recovery"}
	a := &Attempt{ID: recoveryID, Exam: r.Exam, Username: r.Username, UID: r.UID, State: "PREPARING", Settings: Settings{ID: r.Exam, Duration: r.Duration}}
	writeRecoveryFixture(t, e, a, r)
	return e, a, r
}

func writeRecoveryFixture(t *testing.T, e *Engine, a *Attempt, r RecoveryPreparation) {
	t.Helper()
	p := filepath.Join(e.Config.State, recoveryName(a))
	if err := os.MkdirAll(filepath.Dir(p), 0700); err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(r)
	if err := os.WriteFile(p, b, 0600); err != nil {
		t.Fatal(err)
	}
}

func TestRecoveryWaitsForActualStartAcrossRestartAndExpiredPreflight(t *testing.T) {
	e, a, r := recoveryFixture(t)
	// No attempt exists merely because an allowance was staged yesterday.
	restarted, err := New(e.Config)
	if err != nil {
		t.Fatal(err)
	}
	if err := restarted.WithState(func() error {
		if len(restarted.state.Attempts) != 1 {
			t.Fatal("staging created a countdown")
		}
		if _, _, err := restarted.recoveryPreparation(a); err != nil {
			return err
		}
		a.PreflightStartedAt = Millis() - PreflightTimeoutMillis
		restarted.state.Attempts[a.ID] = a
		if !restarted.expirePreflight(a, Millis()) {
			t.Fatal("expected abandoned preflight expiry")
		}
		if a.Start != 0 || a.Deadline != 0 {
			t.Fatal("abandoned preflight consumed recovery time")
		}
		fresh := *a
		fresh.ID, fresh.State, fresh.PreflightStartedAt = retryRecoveryID, "PREPARING", Millis()
		if _, _, err := restarted.recoveryPreparation(&fresh); err != nil {
			return err
		}
		started := Millis() + 86400000
		commitStart(&fresh, started, 123, "later-boot")
		if fresh.Deadline != started+r.Duration*1000 || fresh.OriginalDeadline != fresh.Deadline || fresh.UptimeDeadline != 123+float64(r.Duration) {
			t.Fatal("waiting or preflight reduced the recovery allowance")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestRecoveryRestoresProtectedFilesOnlyAtStartAndCannotBeReused(t *testing.T) {
	e, a, r := recoveryFixture(t)
	if err := e.WithState(func() error {
		if _, err := os.Stat(filepath.Join(e.Config.Work, a.ID)); !os.IsNotExist(err) {
			t.Fatal("staging exposed saved work")
		}
		commitStart(a, Millis(), 1, "boot")
		e.state.Attempts[a.ID] = a
		if err := e.initialize(a); err != nil {
			return err
		}
		answer, err := os.ReadFile(filepath.Join(e.Config.Work, a.ID, "work", "answer.txt"))
		if err != nil || string(answer) != "saved answer" {
			t.Fatalf("saved work not restored: %q, %v", answer, err)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	restarted, _ := New(e.Config)
	if err := restarted.WithState(func() error {
		fresh := *a
		fresh.ID = retryRecoveryID
		if _, _, err := restarted.recoveryPreparation(&fresh); err == nil {
			t.Fatal("consumed recovery could be reused after restart")
		}
		source, _ := restarted.Find(r.SourceAttempt)
		manifest, err := ReadProtected(filepath.Join(e.Config.State, "submissions", r.SourceAttempt), source)
		if err != nil || manifest.Checksum != r.Checksum {
			t.Fatal("original submission changed")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestRecoveryRejectsWrongIdentityAllowanceAndDamagedSource(t *testing.T) {
	for _, kind := range []string{"user", "uid", "exam", "duration", "checksum", "unsafe-mode", "damaged-archive"} {
		t.Run(kind, func(t *testing.T) {
			e, a, r := recoveryFixture(t)
			switch kind {
			case "user":
				r.Username = "someone-else"
			case "uid":
				r.UID++
			case "exam":
				r.Exam = "other-exam"
			case "duration":
				r.Duration++
			case "checksum":
				r.Checksum = strings.Repeat("0", 64)
			}
			writeRecoveryFixture(t, e, a, r)
			if kind == "unsafe-mode" {
				os.Chmod(filepath.Join(e.Config.State, recoveryName(a)), 0644)
			}
			if kind == "damaged-archive" {
				os.WriteFile(filepath.Join(e.Config.State, "submissions", r.SourceAttempt, "submission.tar.gz"), []byte("damaged"), 0600)
			}
			if err := e.WithState(func() error {
				if _, _, err := e.recoveryPreparation(a); err == nil {
					t.Fatal("invalid recovery admitted")
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestRecoveryRejectsUnsafeArchiveEntriesWithoutPublishingWork(t *testing.T) {
	for _, kind := range []string{"symlink", "hardlink", "traversal", "absolute", "wrong-hash", "missing", "duplicate"} {
		t.Run(kind, func(t *testing.T) {
			e, a, r := recoveryFixture(t)
			p := filepath.Join(e.Config.State, "submissions", r.SourceAttempt, "submission.tar.gz")
			f, err := os.Create(p)
			if err != nil {
				t.Fatal(err)
			}
			gz := gzip.NewWriter(f)
			tw := tar.NewWriter(gz)
			h := &tar.Header{Name: "answer.txt", Typeflag: tar.TypeReg, Mode: 0600, Size: 12}
			switch kind {
			case "symlink":
				h.Typeflag, h.Linkname, h.Size = tar.TypeSymlink, "/etc/passwd", 0
			case "hardlink":
				h.Typeflag, h.Linkname, h.Size = tar.TypeLink, "outside", 0
			case "traversal":
				h.Name = "../outside"
			case "absolute":
				h.Name = "/outside"
			}
			if kind != "missing" {
				if err := tw.WriteHeader(h); err != nil {
					t.Fatal(err)
				}
				if h.Size > 0 {
					answer := "wrong answer"
					if kind == "duplicate" {
						answer = "saved answer"
					}
					if _, err := tw.Write([]byte(answer)); err != nil {
						t.Fatal(err)
					}
				}
				if kind == "duplicate" {
					if err := tw.WriteHeader(h); err != nil {
						t.Fatal(err)
					}
					if _, err := tw.Write([]byte("saved answer")); err != nil {
						t.Fatal(err)
					}
				}
			}
			tw.Close()
			gz.Close()
			f.Close()
			// Exercise the extractor independently of the outer archive checksum:
			// even imported, root-owned archive entries must obey the manifest.
			manifest := &Manifest{Files: []FileEntry{{Path: "answer.txt", Size: 12, Hash: Hash([]byte("saved answer"))}}}
			base := filepath.Join(e.Config.Work, a.ID)
			dest := filepath.Join(base, "work")
			if err := os.MkdirAll(dest, 0700); err != nil {
				t.Fatal(err)
			}
			if err := e.initializeRecovery(a, &r, manifest, dest); err == nil {
				t.Fatal("unsafe archive restored")
			}
			if _, err := os.Stat(filepath.Join(base, "initialized")); !os.IsNotExist(err) {
				t.Fatal("unsafe recovery published")
			}
			if entries, _ := os.ReadDir(dest); len(entries) != 0 {
				t.Fatal("failed restore exposed partial files")
			}
		})
	}
}

func TestRecoveryStartedIntervalFencesCrashBeforeConsumptionMarker(t *testing.T) {
	e, a, _ := recoveryFixture(t)
	if err := e.WithState(func() error {
		commitStart(a, Millis(), 1, "boot")
		e.state.Attempts[a.ID] = a
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	restarted, _ := New(e.Config)
	if err := restarted.WithState(func() error {
		fresh := *a
		fresh.ID, fresh.Start = retryRecoveryID, 0
		if _, _, err := restarted.recoveryPreparation(&fresh); err == nil {
			t.Fatal("crash granted a second countdown")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}
