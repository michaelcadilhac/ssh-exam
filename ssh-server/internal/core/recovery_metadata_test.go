package core

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"syscall"
	"testing"
	"time"
)

// Use a real separate process: a blocking FIFO open under WithState must not
// strand this test's goroutines/locks or require weakening its timeout assertion.
func TestRecoveryMetadataPreparationChild(t *testing.T) {
	path := os.Getenv("EXAM_RECOVERY_METADATA_FIXTURE")
	if path == "" {
		return
	}
	var fixture struct {
		Config  Config
		Request Request
		Valid   bool
	}
	data, err := os.ReadFile(path)
	if err != nil || json.Unmarshal(data, &fixture) != nil {
		t.Fatal("private metadata fixture unavailable")
	}
	e, err := New(fixture.Config)
	if err != nil {
		t.Fatal(err)
	}
	reachedGuards := false
	e.activationPrepare = func(*Attempt) error {
		reachedGuards = true
		return errors.New("synthetic guard boundary: never start an interval")
	}
	_, err = e.Call("activate-attempt", fixture.Request)
	if err == nil || reachedGuards != fixture.Valid {
		t.Fatal("Begin reached the wrong side of recovery metadata validation", reachedGuards, err)
	}
	if !fixture.Valid && (!strings.Contains(err.Error(), "examctl recovery-grants --exam "+fixture.Request.Exam) || !strings.Contains(err.Error(), "examctl info "+fixture.Request.ID+" --read-only")) {
		t.Fatal("unsafe metadata refusal lacks exact supported diagnostic commands", err)
	}
	if err := e.WithState(func() error { return nil }); err != nil {
		t.Fatal("unrelated native transaction unavailable after refusal", err)
	}
}

func FuzzDecodeRecoveryMetadata(f *testing.F) {
	r := RecoveryPreparation{Exam: "retake", Username: "student", UID: 20001, Duration: 5400, SourceAttempt: finalID, Checksum: strings.Repeat("a", 64), CreatedAt: 1234, Reason: "Explicit synthetic saved work allowance"}
	seed, _ := json.Marshal(r)
	f.Add(seed)
	f.Add([]byte(`{"exam":"retake","exam":"retake"}`))
	f.Add([]byte(`{"private":"must not enter errors"}`))
	f.Fuzz(func(t *testing.T, b []byte) {
		decoded, err := decodeRecoveryMetadata(b)
		if err != nil {
			if err.Error() != errRecoveryMetadata.Error() {
				t.Fatal("decoder exposed untrusted field/value diagnostics")
			}
			return
		}
		canonical, err := json.Marshal(decoded)
		if err != nil {
			t.Fatal(err)
		}
		again, err := decodeRecoveryMetadata(canonical)
		if err != nil || !reflect.DeepEqual(decoded, again) {
			t.Fatal("accepted authority lacks stable canonical round trip", err)
		}
	})
}

func TestRecoveryMetadataUnsafeFilesRefuseWithoutStallingOrStarting(t *testing.T) {
	for _, kind := range []string{"valid", "fifo-grant", "fifo-marker", "symlink-marker", "public-marker", "hardlink-grant", "trailing-grant", "unknown-grant", "duplicate-grant", "case-alias-grant", "symlink-exam", "public-exam", "symlink-parent", "public-parent", "oversize-marker", "hardlink-marker"} {
		t.Run(kind, func(t *testing.T) {
			e, a, _ := recoveryFixture(t)
			transport := "synthetic-recovery-metadata"
			a.Settings.Template, a.Settings.Terminals = "v1", 4
			a.Settings.Latest = Millis() + 600000
			a.Transport, a.PreflightStartedAt = transport, Millis()
			if err := e.WithState(func() error {
				e.state.Attempts[a.ID] = a
				e.state.Registrations[transport] = a.Username
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			if _, err := e.Call("prepare-workspace", Request{ID: a.ID}); err != nil {
				t.Fatal("valid saved source did not stage before fault injection", err)
			}
			grant := filepath.Join(e.Config.State, recoveryName(a))
			marker := grant + ".consumed"
			switch kind {
			case "fifo-grant":
				if err := os.Remove(grant); err != nil {
					t.Fatal(err)
				}
				if err := syscall.Mkfifo(grant, 0600); err != nil {
					t.Fatal(err)
				}
			case "fifo-marker":
				if err := syscall.Mkfifo(marker, 0600); err != nil {
					t.Fatal(err)
				}
			case "symlink-marker":
				if err := os.WriteFile(filepath.Join(e.Config.State, "synthetic-marker-target"), []byte(a.ID), 0600); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink("../../synthetic-marker-target", marker); err != nil {
					t.Fatal(err)
				}
			case "public-marker":
				if err := os.WriteFile(marker, []byte(a.ID), 0644); err != nil {
					t.Fatal(err)
				}
			case "hardlink-grant":
				if err := os.Link(grant, grant+".alias"); err != nil {
					t.Fatal(err)
				}
			case "symlink-exam", "symlink-parent":
				path := filepath.Dir(grant)
				if kind == "symlink-parent" {
					path = filepath.Dir(path)
				}
				target := filepath.Join(e.Config.State, "synthetic-relocated-metadata")
				if err := os.Rename(path, target); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(target, path); err != nil {
					t.Fatal(err)
				}
			case "public-exam", "public-parent":
				path := filepath.Dir(grant)
				if kind == "public-parent" {
					path = filepath.Dir(path)
				}
				if err := os.Chmod(path, 0755); err != nil {
					t.Fatal(err)
				}
			case "oversize-marker", "hardlink-marker":
				data := []byte(a.ID)
				if kind == "oversize-marker" {
					data = append(data, bytes.Repeat([]byte{'x'}, 65536)...)
				}
				if err := os.WriteFile(marker, data, 0600); err != nil {
					t.Fatal(err)
				}
				if kind == "hardlink-marker" {
					if err := os.Link(marker, marker+".alias"); err != nil {
						t.Fatal(err)
					}
				}
			case "trailing-grant", "unknown-grant", "duplicate-grant", "case-alias-grant":
				data, err := os.ReadFile(grant)
				if err != nil {
					t.Fatal(err)
				}
				switch kind {
				case "trailing-grant":
					data = append(data, []byte(` {"unexpected":"second record"}`)...)
				case "unknown-grant":
					data = append(data[:len(data)-1], []byte(`,"unexpected":"ambiguous authority"}`)...)
				case "duplicate-grant":
					data = append(data[:len(data)-1], []byte(`,"exam":"recovery"}`)...)
				case "case-alias-grant":
					data = append(data[:len(data)-1], []byte(`,"Exam":"recovery"}`)...)
				}
				if err := os.WriteFile(grant, data, 0600); err != nil {
					t.Fatal(err)
				}
			}
			before, err := os.ReadFile(filepath.Join(e.Config.State, "state.json"))
			if err != nil {
				t.Fatal(err)
			}
			archive := filepath.Join(e.Config.State, "submissions", finalID, "submission.tar.gz")
			protectedBefore, err := os.ReadFile(archive)
			if err != nil {
				t.Fatal(err)
			}
			request := Request{ID: a.ID, Exam: a.Exam, Username: a.Username, UID: a.UID, Transport: transport, Settings: a.Settings}
			data, _ := json.Marshal(struct {
				Config  Config
				Request Request
				Valid   bool
			}{e.Config, request, kind == "valid"})
			fixture := filepath.Join(e.Config.State, "synthetic-metadata-fixture.json")
			if err := os.WriteFile(fixture, data, 0600); err != nil {
				t.Fatal(err)
			}
			executable, err := os.Executable()
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			child := exec.CommandContext(ctx, executable, "-test.run=^TestRecoveryMetadataPreparationChild$", "-test.v")
			child.Env = append(os.Environ(), "EXAM_RECOVERY_METADATA_FIXTURE="+fixture)
			output, err := child.CombinedOutput()
			if ctx.Err() != nil {
				t.Fatal("recovery metadata stalled the shared native preparation transaction; owned test child terminated")
			}
			if err != nil {
				t.Fatal("unsafe recovery refusal failed", err, string(output))
			}
			after, _ := os.ReadFile(filepath.Join(e.Config.State, "state.json"))
			protectedAfter, _ := os.ReadFile(archive)
			if !bytes.Equal(before, after) || !bytes.Equal(protectedBefore, protectedAfter) {
				t.Fatal("refused metadata changed native authority or protected source")
			}
		})
	}
}
