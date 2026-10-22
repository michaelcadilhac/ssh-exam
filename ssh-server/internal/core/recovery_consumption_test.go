package core

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"testing"
)

func TestPrivateMarkerPublishesCompleteSingleLinkWithoutReplacing(t *testing.T) {
	path := t.TempDir()
	if err := os.Chmod(path, 0700); err != nil {
		t.Fatal(err)
	}
	root, err := readOnlyRoot(path)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	checkpointCount := 0
	if err := publishPrivateMarkerNew(root, "student.json.consumed", []byte(recoveryID), func(string) error {
		checkpointCount++
		entries, err := os.ReadDir(path)
		if err != nil || len(entries) != 0 {
			t.Fatal("unflushed/unpublished authority became named", err)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if checkpointCount != 2 {
		t.Fatal("write/flush boundaries not exercised", checkpointCount)
	}
	data, err := privateControlFile(root, "student.json.consumed", 36)
	info, statErr := os.Lstat(filepath.Join(path, "student.json.consumed"))
	if err != nil || statErr != nil || string(data) != recoveryID || info.Sys().(*syscall.Stat_t).Nlink != 1 || info.Mode().Perm() != 0600 {
		t.Fatal("published metadata is incomplete, linked or not private", err, statErr)
	}
	if err := publishPrivateMarkerNew(root, "student.json.consumed", []byte(retryRecoveryID), func(string) error {
		t.Fatal("existing destination caused new writes")
		return nil
	}); !errors.Is(err, os.ErrExist) {
		t.Fatal("replacement publication was not refused", err)
	}
	after, err := privateControlFile(root, "student.json.consumed", 36)
	if err != nil || !bytes.Equal(data, after) {
		t.Fatal("refused publication changed the original authority", err)
	}
}

func TestPrivateMarkerCompetingPublishersHaveExactlyOneWinner(t *testing.T) {
	path := t.TempDir()
	if err := os.Chmod(path, 0700); err != nil {
		t.Fatal(err)
	}
	root, err := readOnlyRoot(path)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	const count = 16
	results := make(chan error, count)
	values := map[string]bool{}
	var ready sync.WaitGroup
	gate := make(chan struct{})
	for range count {
		id := ManagementID()
		values[id] = true
		ready.Add(1)
		go func() {
			defer ready.Done()
			<-gate
			results <- publishPrivateMarkerNew(root, "student.json.consumed", []byte(id), nil)
		}()
	}
	close(gate)
	ready.Wait()
	close(results)
	winners := 0
	for err := range results {
		if err == nil {
			winners++
		} else if !errors.Is(err, os.ErrExist) {
			t.Fatal("unexpected competing-publication outcome", err)
		}
	}
	data, err := privateControlFile(root, "student.json.consumed", 36)
	entries, dirErr := os.ReadDir(path)
	if winners != 1 || err != nil || !values[string(data)] || dirErr != nil || len(entries) != 1 {
		t.Fatal("competing writers replaced authority or left named orphans", winners, err, dirErr, len(entries))
	}
}

func TestPrivateMarkerFailureBeforeLinkLeavesNoNamedAuthority(t *testing.T) {
	for _, phase := range []string{"written", "flushed"} {
		t.Run(phase, func(t *testing.T) {
			path := t.TempDir()
			if err := os.Chmod(path, 0700); err != nil {
				t.Fatal(err)
			}
			root, err := readOnlyRoot(path)
			if err != nil {
				t.Fatal(err)
			}
			defer root.Close()
			failure := errors.New("synthetic publication stop")
			err = publishPrivateMarkerNew(root, "student.json.consumed", []byte(recoveryID), func(at string) error {
				if at == phase {
					return failure
				}
				return nil
			})
			entries, dirErr := os.ReadDir(path)
			if !errors.Is(err, failure) || dirErr != nil || len(entries) != 0 {
				t.Fatal("failed unpublished inode leaked into catalog", err, dirErr, len(entries))
			}
		})
	}
}

func TestPrivateMarkerNamesDataAndUmaskCannotWeakenPrivacy(t *testing.T) {
	path := t.TempDir()
	if err := os.Chmod(path, 0700); err != nil {
		t.Fatal(err)
	}
	root, err := readOnlyRoot(path)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	for _, name := range []string{"", ".", "..", "../escape", "/absolute", "nested/file", "nul\x00name"} {
		if err := publishPrivateMarkerNew(root, name, []byte(recoveryID), nil); err == nil {
			t.Fatal("unsafe marker name accepted")
		}
	}
	for _, data := range [][]byte{nil, make([]byte, 4097)} {
		if err := publishPrivateMarkerNew(root, "student.json.consumed", data, nil); err == nil {
			t.Fatal("empty/oversized authority accepted")
		}
	}
	priorMask := syscall.Umask(0777)
	defer syscall.Umask(priorMask)
	if err := publishPrivateMarkerNew(root, "student.json.consumed", []byte(recoveryID), nil); err != nil {
		t.Fatal(err)
	}
	if data, err := privateControlFile(root, "student.json.consumed", 36); err != nil || string(data) != recoveryID {
		t.Fatal("restrictive umask made new private metadata unreadable", err)
	}
}

func TestRecoveryConsumptionNeverRepairsRetainedUnsafeOrForeignMarkers(t *testing.T) {
	for _, kind := range []string{"matching", "foreign", "empty", "fifo", "symlink", "hardlink", "public"} {
		t.Run(kind, func(t *testing.T) {
			e, target, _ := recoveryFixture(t)
			commitStart(target, Millis(), uptime(), boot())
			if err := e.WithState(func() error { e.state.Attempts[target.ID] = target; return nil }); err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(e.Config.State, recoveryName(target)+".consumed")
			switch kind {
			case "fifo":
				if err := syscall.Mkfifo(path, 0600); err != nil {
					t.Fatal(err)
				}
			case "symlink":
				secret := filepath.Join(t.TempDir(), "private-source")
				if err := os.WriteFile(secret, []byte("SYNTHETIC-PRIVATE-DO-NOT-ECHO"), 0600); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(secret, path); err != nil {
					t.Fatal(err)
				}
			default:
				data := []byte(target.ID)
				if kind == "empty" {
					data = nil
				} else if kind == "foreign" {
					data = []byte(retryRecoveryID)
				}
				if err := os.WriteFile(path, data, 0600); err != nil {
					t.Fatal(err)
				}
				if kind == "hardlink" {
					if err := os.Link(path, path+".retained-alias"); err != nil {
						t.Fatal(err)
					}
				} else if kind == "public" {
					if err := os.Chmod(path, 0644); err != nil {
						t.Fatal(err)
					}
				}
			}
			before, err := os.Lstat(path)
			if err != nil {
				t.Fatal(err)
			}
			e.workspaceCheckpoint = func(string) error { t.Error("retained marker dispatched new publication"); return nil }
			err = e.commitRecoveryConsumption(target)
			if (err == nil) != (kind == "matching") || (err != nil && strings.Contains(err.Error(), "SYNTHETIC-PRIVATE")) {
				t.Fatal("unsafe/foreign marker was overwritten or leaked", err)
			}
			after, statErr := os.Lstat(path)
			if statErr != nil || !os.SameFile(before, after) || before.Mode() != after.Mode() || before.Size() != after.Size() || before.Sys().(*syscall.Stat_t).Nlink != after.Sys().(*syscall.Stat_t).Nlink {
				t.Fatal("retained marker was replaced, truncated or repaired", statErr)
			}
			state, err := readStateSnapshot(e.Config.State)
			if err != nil || state.Attempts[target.ID].Start != target.Start || state.Attempts[target.ID].OriginalDeadline != target.OriginalDeadline {
				t.Fatal("marker refusal reset the committed interval", err)
			}
		})
	}
}

func TestPrivateMarkerRefusesPublicDirectoryWithoutRepairingIt(t *testing.T) {
	path := t.TempDir()
	if err := os.Chmod(path, 0755); err != nil {
		t.Fatal(err)
	}
	root, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	if err := publishPrivateMarkerNew(root, "student.json.consumed", []byte(recoveryID), nil); err == nil {
		t.Fatal("public metadata directory accepted")
	}
	info, err := os.Stat(path)
	entries, dirErr := os.ReadDir(path)
	if err != nil || dirErr != nil || info.Mode().Perm() != 0755 || len(entries) != 0 {
		t.Fatal("refusal changed directory mode or created files", err, dirErr)
	}
}

func TestRecordedRecoveryConsumptionWithoutOriginalIntervalCannotBeginAgain(t *testing.T) {
	e, target, grant := recoveryFixture(t)
	key := commandKeys(t, e)
	e.Config.Accounts["student"] = Account{UID: os.Getuid(), GID: os.Getgid()}
	target.Transport, target.PreflightStartedAt = "ssh-target", Millis()
	target.Settings.Terminals, target.Settings.Earliest, target.Settings.Latest = 4, Millis()-1000, Millis()+600000
	if err := e.WithState(func() error {
		e.state.Attempts[target.ID] = target
		e.state.Registrations[target.Transport] = target.Username
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Call("prepare-workspace", Request{ID: target.ID}); err != nil {
		t.Fatal(err)
	}
	// Models mismatched recovery/backup metadata, NOT a normal newly committed
	// publication. The retained consumed UUID is evidence of prior use, not a
	// license to invent a new start when its original interval is unavailable.
	path := filepath.Join(e.Config.State, recoveryName(target)+".consumed")
	if err := os.WriteFile(path, []byte(target.ID), 0600); err != nil {
		t.Fatal(err)
	}
	rows, err := e.RecoveryGrants(grant.Exam)
	if err != nil || len(rows) != 1 || rows[0].Disposition != "uncertain" {
		t.Fatal("fixture did not reach the catalog's uncertain-consumption state", err)
	}
	guardCalled := false
	e.activationPrepare = func(*Attempt) error { guardCalled = true; return nil }
	cmd := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "activate-attempt", Username: target.Username, Transport: target.Transport, Body: Request{ID: target.ID}}
	_, err = e.Command(signedCommand(key, cmd), target.Username, target.Transport)
	if err == nil || guardCalled || !strings.Contains(err.Error(), "original interval") || !strings.Contains(err.Error(), "--read-only") {
		t.Fatal("uncertain consumed metadata could reach Begin or lacked safe guidance", err, guardCalled)
	}
	assertUnstartedWorkspace(t, e, target.ID)
	if data, err := os.ReadFile(path); err != nil || string(data) != target.ID {
		t.Fatal("refusal rewrote the consumed record", err)
	}
}

func TestConsumedRecoveryIntervalRequiresKnownChronologyNotFreshTime(t *testing.T) {
	r := &RecoveryPreparation{CreatedAt: 1000}
	for _, tc := range []struct {
		name                      string
		start, deadline, original int64
		known                     bool
	}{
		{"missing-start", 0, 0, 0, false},
		{"predates-grant", 999, 2000, 2000, false},
		{"missing-deadline", 1000, 0, 2000, false},
		{"missing-original", 1000, 2000, 0, false},
		{"invalid-current", 1000, 1000, 2000, false},
		{"invalid-original", 1000, 2000, 1000, false},
		{"expired-but-known", 1000, 2000, 2000, true},
		{"explicitly-reset-current", 1000, 3000, 2000, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			a := &Attempt{Start: tc.start, Deadline: tc.deadline, OriginalDeadline: tc.original}
			if recoveryConsumedIntervalKnown(a, r) != tc.known {
				t.Fatal("unknown interval accepted or historical/reset interval rewritten")
			}
		})
	}
	if recoveryConsumedIntervalKnown(nil, r) || recoveryConsumedIntervalKnown(&Attempt{}, nil) {
		t.Fatal("missing interval/grant treated as known")
	}
}
