package core

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"syscall"
	"testing"
)

func snapshotFixture(t *testing.T) (string, State, string) {
	t.Helper()
	dir := t.TempDir()
	if err := os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	id := "12345678-1234-1234-1234-123456789abc"
	a := &Attempt{ID: id, Exam: "midterm", Username: "student", UID: 20001, State: "ACTIVE", Start: 1000, Deadline: Millis() + 600000, OriginalDeadline: Millis() + 600000, Lease: 1234, Generation: 2, Transport: "PRIVATE-TRANSPORT", Boot: boot(), Protected: true, AccessState: "HELD", Units: []string{"private-unit"}, ResumeTransport: "PRIVATE-RESUME", Authorization: 99999, Handoff: &SSHHandoff{CertificateKey: "PRIVATE-KEY", Certificate: "PRIVATE-CERT"}, Reason: "Recorded monitoring expiry is not proof of misconduct"}
	s := State{Attempts: map[string]*Attempt{id: a}, Caps: map[string]Capability{"PRIVATE-CAPABILITY": {ID: id}}, Registrations: map[string]string{a.Transport: a.Username}, Commands: map[string]int64{"PRIVATE-NONCE": 999999}, Events: []CallbackEvent{}}
	snapshotWrite(t, filepath.Join(dir, "state.json"), s)
	return dir, s, id
}
func snapshotWrite(t *testing.T, path string, v any) {
	t.Helper()
	b, err := json.Marshal(v)
	if err == nil {
		err = os.WriteFile(path, b, 0600)
	}
	if err != nil {
		t.Fatal(err)
	}
}
func snapshotLease(t *testing.T, dir string, s State, id string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(dir, "leases"), 0700); err != nil {
		t.Fatal(err)
	}
	a := s.Attempts[id]
	snapshotWrite(t, filepath.Join(dir, "leases", id+".json"), executionLease{ID: id, Username: a.Username, Transport: a.Transport, Boot: a.Boot, Generation: a.Generation, Until: Millis() + 10000, Nonces: map[string]int64{"PRIVATE-RENEWAL-NONCE": 999999}})
}
func snapshotTree(t *testing.T, dir string) map[string]string {
	t.Helper()
	out := map[string]string{}
	err := filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		i, err := os.Lstat(p)
		if err != nil {
			return err
		}
		s := i.Sys().(*syscall.Stat_t)
		meta := fmt.Sprintf("%v/%d/%d/%d/%v/%v", i.Mode(), s.Uid, s.Gid, i.Size(), s.Mtim, s.Ctim)
		if i.Mode().IsRegular() {
			f, err := os.OpenFile(p, os.O_RDONLY|syscall.O_NOATIME, 0)
			if err != nil {
				return err
			}
			var b []byte
			b, err = os.ReadFile(fmt.Sprintf("/proc/self/fd/%d", f.Fd()))
			f.Close()
			if err != nil {
				return err
			}
			meta += "/" + Hash(b)
		}
		out[p] = meta
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func TestReadOnlySnapshotHasNoStateSideEffectsOrPrivateAuthorityOutput(t *testing.T) {
	dir, s, id := snapshotFixture(t)
	snapshotLease(t, dir, s, id)
	before := snapshotTree(t, dir)
	v, err := ObserveNativeReadOnly(dir, ReadOnlyQuery{ID: id, Limit: 50})
	if err != nil || !v.ReadOnly || !v.Complete || len(v.Attempts) != 1 {
		t.Fatal(v, err)
	}
	a := v.Attempts[0]
	if a.RecordedLease != 1234 || !a.RecordedProtected || a.AccessState != "HELD" || !a.Lease.MatchesRecordedOwner || !a.Lease.MatchesCurrentBoot || !a.Lease.UnexpiredAtRead || !strings.Contains(v.Note, "NOT proof") {
		t.Fatal("observation was applied or overstated", v)
	}
	b, _ := json.Marshal(v)
	for _, secret := range []string{"PRIVATE-TRANSPORT", "PRIVATE-RESUME", "PRIVATE-KEY", "PRIVATE-CERT", "PRIVATE-CAPABILITY", "PRIVATE-NONCE", "PRIVATE-RENEWAL-NONCE", "private-unit"} {
		if strings.Contains(string(b), secret) {
			t.Fatal("private native authority leaked", secret)
		}
	}
	if after := snapshotTree(t, dir); !reflect.DeepEqual(before, after) {
		t.Fatal("read-only observation changed state tree", before, after)
	}
}

func TestReadOnlySnapshotFiltersAndPagesWithoutTreatingActiveAsConnected(t *testing.T) {
	dir, s, id := snapshotFixture(t)
	second := "22345678-1234-1234-1234-123456789abc"
	third := "32345678-1234-1234-1234-123456789abc"
	v := *s.Attempts[id]
	v.ID = second
	v.State = "LOCKED"
	s.Attempts[second] = &v
	w := v
	w.ID = third
	w.State = "COMPLETED"
	w.Exam = "other"
	s.Attempts[third] = &w
	snapshotWrite(t, filepath.Join(dir, "state.json"), s)
	p, err := ObserveNativeReadOnly(dir, ReadOnlyQuery{Exam: "midterm", Active: true, Limit: 1})
	if err != nil || len(p.Attempts) != 1 || p.Attempts[0].ID != id || p.Next != id {
		t.Fatal(p, err)
	}
	p, err = ObserveNativeReadOnly(dir, ReadOnlyQuery{Exam: "midterm", Active: true, Limit: 1, After: p.Next})
	if err != nil || len(p.Attempts) != 1 || p.Attempts[0].ID != second || p.Next != "" || p.Attempts[0].State != "LOCKED" {
		t.Fatal(p, err)
	}
	if _, err := ObserveNativeReadOnly(dir, ReadOnlyQuery{ID: third, Exam: "midterm", Limit: 50}); err == nil {
		t.Fatal("target scope mixed with filters")
	}
	if _, err := ObserveNativeReadOnly(dir, ReadOnlyQuery{ID: "42345678-1234-1234-1234-123456789abc", Limit: 50}); err == nil || !strings.Contains(err.Error(), "--read-only") {
		t.Fatal("missing target not actionable", err)
	}
}

func TestReadOnlySnapshotMalformedLeaseIsPartialNotFalseExpiryOrMisconduct(t *testing.T) {
	for _, data := range []string{`{"id":"PRIVATE-CONTENTS","until":0}`, `{"id":"x","id":"PRIVATE-CONTENTS"}`, `{"PRIVATE-CONTENTS":`, strings.Repeat("x", 65537)} {
		dir, s, id := snapshotFixture(t)
		snapshotLease(t, dir, s, id)
		if err := os.WriteFile(filepath.Join(dir, "leases", id+".json"), []byte(data), 0600); err != nil {
			t.Fatal(err)
		}
		v, err := ObserveNativeReadOnly(dir, ReadOnlyQuery{ID: id, Limit: 50})
		if err != nil || v.Complete || len(v.Attempts) != 1 || (v.Attempts[0].Lease.Status != "invalid" && v.Attempts[0].Lease.Status != "unavailable") || v.Attempts[0].State != "ACTIVE" {
			t.Fatal(v, err)
		}
		b, _ := json.Marshal(v)
		if strings.Contains(string(b), "PRIVATE-CONTENTS") {
			t.Fatal("corrupt journal contents leaked")
		}
	}
}

func TestReadOnlySnapshotRefusesMalformedStateWithoutRepairOrPrivateError(t *testing.T) {
	for _, data := range []string{`{"attempts":null}`, `{"attempts":{},"attempts":{},"PRIVATE":"PRIVATE-CONTENTS"}`, `{"PRIVATE-CONTENTS":`, `null`, `{}`, `[]`, strings.Repeat("[", 65) + strings.Repeat("]", 65)} {
		dir, _, _ := snapshotFixture(t)
		p := filepath.Join(dir, "state.json")
		if err := os.WriteFile(p, []byte(data), 0600); err != nil {
			t.Fatal(err)
		}
		before := snapshotTree(t, dir)
		v, err := ObserveNativeReadOnly(dir, ReadOnlyQuery{Limit: 50})
		if err == nil || len(v.Attempts) != 0 || strings.Contains(err.Error(), "PRIVATE-CONTENTS") {
			t.Fatal(v, err)
		}
		if !reflect.DeepEqual(before, snapshotTree(t, dir)) {
			t.Fatal("invalid state repaired during observation")
		}
	}
}

func TestReadOnlySnapshotRefusesSymlinksFIFOsModesAndOversizedStateWithoutBlocking(t *testing.T) {
	for _, kind := range []string{"symlink", "fifo", "directory", "public-state", "large"} {
		t.Run(kind, func(t *testing.T) {
			dir, _, _ := snapshotFixture(t)
			p := filepath.Join(dir, "state.json")
			if kind == "public-state" {
				if err := os.Chmod(dir, 0755); err != nil {
					t.Fatal(err)
				}
			} else {
				if err := os.Remove(p); err != nil {
					t.Fatal(err)
				}
				switch kind {
				case "symlink":
					if err := os.Symlink(filepath.Join(t.TempDir(), "PRIVATE-CONTENTS"), p); err != nil {
						t.Fatal(err)
					}
				case "fifo":
					if err := syscall.Mkfifo(p, 0600); err != nil {
						t.Fatal(err)
					}
				case "directory":
					if err := os.Mkdir(p, 0700); err != nil {
						t.Fatal(err)
					}
				case "large":
					f, err := os.OpenFile(p, os.O_CREATE|os.O_WRONLY, 0600)
					if err != nil {
						t.Fatal(err)
					}
					err = f.Truncate(readOnlyStateMaxBytes + 1)
					f.Close()
					if err != nil {
						t.Fatal(err)
					}
				}
			}
			if _, err := ObserveNativeReadOnly(dir, ReadOnlyQuery{Limit: 50}); err == nil || strings.Contains(err.Error(), "PRIVATE-CONTENTS") {
				t.Fatal("unsafe state accepted", err)
			}
		})
	}
	dir, _, _ := snapshotFixture(t)
	alias := filepath.Join(t.TempDir(), "state-link")
	if err := os.Symlink(dir, alias); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{alias, "/", "relative", dir + "/../" + filepath.Base(dir)} {
		if _, err := ObserveNativeReadOnly(p, ReadOnlyQuery{Limit: 50}); err == nil {
			t.Fatal("unsafe state directory accepted")
		}
	}
}

func TestReadOnlyConfiguredStateWorksWithoutKeysAndRejectsDuplicateOrUnsafeConfig(t *testing.T) {
	dir, _, _ := snapshotFixture(t)
	p := filepath.Join(t.TempDir(), "config.json")
	snapshotWrite(t, p, map[string]any{"state": dir, "callback_key": "/MISSING-PRIVATE-KEY", "unsupported_future_secret": "PRIVATE-CONFIG-CONTENTS"})
	got, err := ReadOnlyConfiguredState(p)
	if err != nil || got != dir {
		t.Fatal(got, err)
	}
	for _, b := range []string{`{"state":"/one","state":"/two"}`, `{"state":"/"}`, `{"state":"relative"}`, `{"state":2}`, `{"PRIVATE-CONFIG-CONTENTS":`, strings.Repeat("x", 65537)} {
		if err := os.WriteFile(p, []byte(b), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := ReadOnlyConfiguredState(p); err == nil || strings.Contains(err.Error(), "PRIVATE-CONFIG-CONTENTS") {
			t.Fatal("unsafe config accepted/leaked", err)
		}
	}
}

func TestReadOnlySnapshotRejectsInternalSymlinksAndUnsafeLeaseDirectories(t *testing.T) {
	for _, kind := range []string{"state-link", "lease-link", "lease-dir-link", "lease-dir-public", "lease-dir-file"} {
		t.Run(kind, func(t *testing.T) {
			dir, s, id := snapshotFixture(t)
			snapshotLease(t, dir, s, id)
			path := filepath.Join(dir, "state.json")
			if kind == "lease-link" {
				path = filepath.Join(dir, "leases", id+".json")
			}
			if strings.HasPrefix(kind, "lease-dir") {
				path = filepath.Join(dir, "leases")
			}
			if kind == "lease-dir-public" {
				if err := os.Chmod(path, 0755); err != nil {
					t.Fatal(err)
				}
			} else {
				preserved := path + "-preserved"
				if err := os.Rename(path, preserved); err != nil {
					t.Fatal(err)
				}
				if kind == "lease-dir-file" {
					if err := os.WriteFile(path, []byte("PRIVATE-CONTENTS"), 0600); err != nil {
						t.Fatal(err)
					}
				} else if err := os.Symlink(filepath.Base(preserved), path); err != nil {
					t.Fatal(err)
				}
			}
			v, err := ObserveNativeReadOnly(dir, ReadOnlyQuery{ID: id, Limit: 50})
			if kind == "state-link" {
				if err == nil {
					t.Fatal("internal state symlink followed")
				}
			} else if err != nil || v.Complete || len(v.Attempts) != 1 || v.Attempts[0].Lease.Status != "unavailable" {
				t.Fatal("unsafe lease source became absence/valid observation", v, err)
			}
		})
	}
}

func TestReadOnlyLeaseRequiresExplicitFieldsIncludingZeroGeneration(t *testing.T) {
	_, s, id := snapshotFixture(t)
	a := s.Attempts[id]
	base := map[string]any{"id": id, "username": a.Username, "transport": a.Transport, "boot": a.Boot, "generation": 0, "until": int64(0), "nonces": map[string]int64{}}
	b, _ := json.Marshal(base)
	if _, ok := decodeReadOnlyLease(b, id); !ok {
		t.Fatal("explicit zero metadata rejected")
	}
	for _, field := range []string{"id", "username", "transport", "boot", "generation", "until", "nonces"} {
		for _, null := range []bool{false, true} {
			copy := map[string]any{}
			for k, v := range base {
				copy[k] = v
			}
			if null {
				copy[field] = nil
			} else {
				delete(copy, field)
			}
			b, _ := json.Marshal(copy)
			if _, ok := decodeReadOnlyLease(b, id); ok {
				t.Fatal("missing/null metadata accepted", field, null)
			}
		}
	}
}

func FuzzReadOnlySnapshotJSON(f *testing.F) {
	f.Add([]byte(`{"attempts":{},"capabilities":{},"registrations":{}}`))
	f.Add([]byte(`{"duplicate":1,"duplicate":2}`))
	f.Add([]byte(`{"private":"\u0000"}`))
	f.Fuzz(func(t *testing.T, b []byte) {
		if len(b) > 8192 {
			return
		}
		if validReadOnlyJSON(b) && !json.Valid(b) {
			t.Fatal("invalid JSON accepted")
		}
	})
}
