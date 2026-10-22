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
	"syscall"
	"testing"
	"time"
)

func TestWorkspaceReceiptSafetyChild(t *testing.T) {
	path := os.Getenv("EXAM_WORKSPACE_RECEIPT_FIXTURE")
	if path == "" {
		return
	}
	var fixture struct {
		Config Config
		Valid  bool
	}
	data, err := os.ReadFile(path)
	if err != nil || json.Unmarshal(data, &fixture) != nil {
		t.Fatal("private receipt fixture unavailable")
	}
	e, err := New(fixture.Config)
	if err != nil {
		t.Fatal(err)
	}
	reachedGuards := false
	e.activationPrepare = func(*Attempt) error {
		reachedGuards = true
		return errors.New("synthetic guard boundary; never start an interval")
	}
	_, err = e.Call("activate-attempt", Request{ID: finalID})
	if err == nil || reachedGuards != fixture.Valid {
		t.Fatal("Begin accepted unsafe workspace receipt or failed valid control", reachedGuards, err)
	}
	if err := e.WithState(func() error { return nil }); err != nil {
		t.Fatal("unrelated transaction failed after receipt refusal", err)
	}
}

func TestWorkspaceReceiptUnsafeFilesCannotStallOrReachBeginGuards(t *testing.T) {
	for _, kind := range []string{"valid", "fifo", "hardlink", "duplicate", "case-alias", "source-alias", "public", "oversize", "symlink"} {
		t.Run(kind, func(t *testing.T) {
			e, source := workspaceFixture(t)
			if _, err := e.Call("prepare-workspace", Request{ID: finalID}); err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(e.Config.Work, finalID, "workspace-ready", "receipt.json")
			data, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			switch kind {
			case "fifo":
				if err := os.Remove(path); err != nil {
					t.Fatal(err)
				}
				if err := syscall.Mkfifo(path, 0600); err != nil {
					t.Fatal(err)
				}
			case "hardlink":
				if err := os.Link(path, path+".alias"); err != nil {
					t.Fatal(err)
				}
			case "duplicate":
				data = bytes.TrimSpace(data)
				data = append(data[:len(data)-1], []byte(`,"attempt":"`+finalID+`"}`)...)
				if err := os.WriteFile(path, data, 0600); err != nil {
					t.Fatal(err)
				}
			case "case-alias":
				data = bytes.TrimSpace(data)
				data = append(data[:len(data)-1], []byte(`,"Attempt":"`+finalID+`"}`)...)
				if err := os.WriteFile(path, data, 0600); err != nil {
					t.Fatal(err)
				}
			case "source-alias":
				modified := bytes.Replace(data, []byte(`"source":{`), []byte(`"source":{"Kind":"template",`), 1)
				if bytes.Equal(data, modified) {
					t.Fatal("fixture did not alter source object")
				}
				if err := os.WriteFile(path, modified, 0600); err != nil {
					t.Fatal(err)
				}
			case "public":
				if err := os.Chmod(path, 0644); err != nil {
					t.Fatal(err)
				}
			case "oversize":
				data = append(data, bytes.Repeat([]byte{' '}, 16384)...)
				if err := os.WriteFile(path, data, 0600); err != nil {
					t.Fatal(err)
				}
			case "symlink":
				if err := os.Rename(path, path+".original"); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink("receipt.json.original", path); err != nil {
					t.Fatal(err)
				}
			}
			stateBefore, _ := os.ReadFile(filepath.Join(e.Config.State, "state.json"))
			sourceBefore, _ := os.ReadFile(filepath.Join(source, "src", "main.c"))
			fixture, _ := json.Marshal(struct {
				Config Config
				Valid  bool
			}{e.Config, kind == "valid"})
			fixturePath := filepath.Join(e.Config.State, "synthetic-receipt-fixture.json")
			if err := os.WriteFile(fixturePath, fixture, 0600); err != nil {
				t.Fatal(err)
			}
			executable, err := os.Executable()
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			child := exec.CommandContext(ctx, executable, "-test.run=^TestWorkspaceReceiptSafetyChild$", "-test.v")
			child.Env = append(os.Environ(), "EXAM_WORKSPACE_RECEIPT_FIXTURE="+fixturePath)
			output, err := child.CombinedOutput()
			if ctx.Err() != nil {
				t.Fatal("workspace receipt stalled Begin under the shared lock; owned child terminated")
			}
			if err != nil {
				t.Fatal("receipt refusal failed", err, string(output))
			}
			stateAfter, _ := os.ReadFile(filepath.Join(e.Config.State, "state.json"))
			sourceAfter, _ := os.ReadFile(filepath.Join(source, "src", "main.c"))
			if !bytes.Equal(stateBefore, stateAfter) || !bytes.Equal(sourceBefore, sourceAfter) {
				t.Fatal("receipt refusal changed authority or source")
			}
		})
	}
}

func FuzzDecodeWorkspaceReceipt(f *testing.F) {
	r := WorkspaceReceipt{Version: 1, Attempt: finalID, Exam: "midterm", Username: "student", UID: 20001, SettingsHash: "synthetic", Source: WorkspaceSource{Kind: "template", Template: "v1"}, PreparedAt: 1234, WorkDevice: 1, WorkInode: 2}
	seed, _ := json.Marshal(r)
	f.Add(seed)
	f.Add([]byte(`{"source":{"Kind":"template"}}`))
	f.Add([]byte(`{"private":"must not enter diagnostics"}`))
	f.Fuzz(func(t *testing.T, b []byte) {
		decoded, err := decodeWorkspaceReceipt(b)
		if err != nil {
			if !errors.Is(err, errWorkspaceReceiptMetadata) {
				t.Fatal("decoder leaked untrusted diagnostics")
			}
			return
		}
		canonical, err := json.Marshal(decoded)
		if err != nil {
			t.Fatal(err)
		}
		again, err := decodeWorkspaceReceipt(canonical)
		if err != nil || !reflect.DeepEqual(decoded, again) {
			t.Fatal("unstable accepted receipt", err)
		}
	})
}
