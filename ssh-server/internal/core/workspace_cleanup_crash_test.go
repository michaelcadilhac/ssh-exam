package core

// Real worker/file/lease/namespace/process-death boundaries. Only the phase
// checkpoint is synthetic. No host account, manager or production state is used.
import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

const cleanupTestID = "b1234567-1234-4234-8234-123456789abc"

func TestWorkspaceCleanupPhaseDriver(t *testing.T) {
	if os.Getenv("EXAM_CLEANUP_PHASE_DRIVER") != "1" {
		return
	}
	var r workspaceInspectionRequest
	data, err := os.ReadFile(os.Getenv("EXAM_CLEANUP_REQUEST"))
	if err != nil {
		t.Fatal(err)
	}
	if json.Unmarshal(data, &r) != nil {
		t.Fatal("bad request")
	}
	e := &Engine{Config: r.Config}
	e.workspaceCheckpoint = func(phase string) error {
		fault := os.Getenv("EXAM_CLEANUP_KILL_PHASE")
		if phase == "cleanup-quarantined" && fault == "cleanup-quarantined-live" {
			if err := os.WriteFile(filepath.Join(e.Config.State, "synthetic-live-ready"), []byte("QUARANTINED"), 0600); err != nil {
				return err
			}
			gate, err := os.Open(filepath.Join(e.Config.State, "synthetic-live-release"))
			if err != nil {
				return err
			}
			var b [1]byte
			_, err = gate.Read(b[:])
			gate.Close()
			if err != nil {
				return err
			}
			if err := syscall.Kill(os.Getpid(), syscall.SIGKILL); err != nil {
				panic(err)
			}
			for {
				time.Sleep(time.Second)
			}
		}
		if phase == "cleanup-sealed" && (fault == "cleanup-fault-read-only" || fault == "cleanup-fault-disk-full") {
			if fault == "cleanup-fault-read-only" {
				if err := unix.Mount(e.cleanupDirectory(), e.cleanupDirectory(), "", unix.MS_BIND, ""); err != nil {
					return err
				}
				return unix.Mount("", e.cleanupDirectory(), "", unix.MS_BIND|unix.MS_REMOUNT|unix.MS_RDONLY|unix.MS_NOSUID|unix.MS_NODEV|unix.MS_NOEXEC, "")
			}
			if err := unix.Mount("tmpfs", e.cleanupDirectory(), "tmpfs", unix.MS_NOSUID|unix.MS_NODEV|unix.MS_NOEXEC, "size=16k,mode=0700"); err != nil {
				return err
			}
			f, err := os.Create(filepath.Join(e.cleanupDirectory(), "synthetic-full"))
			if err != nil {
				return err
			}
			defer f.Close()
			block := make([]byte, 4096)
			full := false
			for range 16 {
				if _, err := f.Write(block); err != nil {
					if !errors.Is(err, unix.ENOSPC) {
						return err
					}
					full = true
					break
				}
			}
			if !full {
				return errors.New("synthetic target filesystem did not reach ENOSPC")
			}
			return nil
		}
		if phase == os.Getenv("EXAM_CLEANUP_KILL_PHASE") {
			if err := syscall.Kill(os.Getpid(), syscall.SIGKILL); err != nil {
				panic(err)
			}
			for {
				time.Sleep(time.Second)
			}
		}
		return nil
	}
	var result any
	switch r.Action {
	case "absence":
		state, err := e.recoveryRevocationState()
		if err != nil {
			t.Fatal(err)
		}
		original := state.Attempts[r.ID]
		uncertain := *original
		uncertain.Start = 0
		uncertain.Deadline = 0
		uncertain.OriginalDeadline = 0
		uncertain.Protected = false
		state.Attempts[r.ID] = &uncertain
		archive := filepath.Join(e.Config.State, "submissions", r.ID)
		saved := e.Config.State + ".synthetic-protected-backup"
		if err := os.Rename(archive, saved); err != nil {
			t.Fatal(err)
		}
		proofErr := e.recoveryNoStartFiles(state, &RecoveryPreparation{Exam: original.Exam, UID: original.UID})
		if err := os.Rename(saved, archive); err != nil {
			t.Fatal(err)
		}
		if proofErr == nil || !strings.Contains(proofErr.Error(), "cleanup history contradicts") {
			t.Fatalf("cleanup receipt failed to contradict no-start without live/archive folders: %v", proofErr)
		}
		result = map[string]bool{"history_preserved": true}
	case "restore":
		e, err = New(r.Config)
		if err != nil {
			t.Fatal(err)
		}
		e.Config.Accounts = map[string]Account{"synthetic": {UID: 29999, GID: 29999}}
		var source *Attempt
		if err := e.WithState(func() error { source = e.state.Attempts[r.ID]; return nil }); err != nil {
			t.Fatal(err)
		}
		grant := RecoveryPreparation{Exam: "cleanup-recovery", Username: source.Username, UID: source.UID, Duration: 1385, SourceAttempt: source.ID, Checksum: source.Checksum, CreatedAt: Millis(), Reason: "Reviewed NEW attempt after workspace cleanup"}
		target := &Attempt{ID: recoveryID, Exam: grant.Exam, Username: grant.Username, UID: grant.UID, State: "PREPARING", PreflightStartedAt: Millis(), Settings: Settings{ID: grant.Exam, Duration: grant.Duration}}
		writeRecoveryFixture(t, e, target, grant)
		if err := e.WithState(func() error { e.state.Attempts[target.ID] = target; return nil }); err != nil {
			t.Fatal(err)
		}
		_, err = e.Call("prepare-workspace", Request{ID: target.ID})
		if err != nil {
			t.Fatal("actual saved-work staging after cleanup", err)
		}
		assertUnstartedWorkspace(t, e, target.ID)
		staged := filepath.Join(e.workspaceBase(target.ID), "workspace-ready", "work", "answer.txt")
		content, readErr := os.ReadFile(staged)
		if readErr != nil || string(content) != "SYNTHETIC CLEANUP CRASH ANSWER\n" {
			t.Fatal("archive restore lost saved bytes", readErr)
		}
		if _, err := os.Lstat(e.workspaceBase(source.ID)); !os.IsNotExist(err) {
			t.Fatal("restore used retained source folder", err)
		}
		result = map[string]bool{"restored": true, "unstarted": true}
	case "preview":
		result, err = e.inspectWorkspaceCleanup(r.ID)
	case "delete":
		e, err = New(r.Config)
		if err == nil {
			_, err = e.Call("delete-submission", Request{ID: r.ID})
		}
		if err == nil || !strings.Contains(err.Error(), "pinned by interrupted workspace cleanup") {
			t.Fatalf("did not reach public archive-pin refusal: %v", err)
		}
		result = map[string]bool{"pinned": true}
		err = nil
	case "delete-for-source":
		e, err = New(r.Config)
		if err == nil {
			_, err = e.Call("delete-submission", Request{ID: r.ID})
		}
		if err == nil || !strings.Contains(err.Error(), "unfinished saved-work attempt") {
			t.Fatalf("completed cleanup pin did not release into the independent source dependency: %v", err)
		}
		result = map[string]bool{"source_preserved": true}
		err = nil
	case "quarantine":
		state, loadErr := e.recoveryRevocationState()
		err = loadErr
		if err == nil {
			err = e.checkCleanupQuarantine(state)
		}
		result = map[string]bool{"valid": err == nil}
	default:
		result, err = e.workspaceCleanupControl(r)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "CLEANUP_REFUSED:", err)
		os.Exit(19)
	}
	if err := json.NewEncoder(os.Stdout).Encode(result); err != nil {
		t.Fatal(err)
	}
	os.Exit(0)
}

func TestWorkspaceCleanupRealDeathAndExplicitRepair(t *testing.T) {
	if os.Getenv("EXAM_MANAGEMENT_USERNS") != "1" {
		t.Skip("requires authorized private user/mount/PID namespaces")
	}
	for _, phase := range []string{"prepared", "sealed", "quarantined", "removing", "unlinked", "root-removed", "completed", "fault-read-only", "fault-disk-full"} {
		t.Run(phase, func(t *testing.T) {
			base := t.TempDir()
			t.Cleanup(func() {
				_ = filepath.WalkDir(base, func(path string, entry fs.DirEntry, err error) error {
					if err == nil && entry.IsDir() {
						return os.Chmod(path, 0700)
					}
					return err
				})
			})
			c := Config{State: filepath.Join(base, "state"), Work: filepath.Join(base, "work")}
			e, err := New(c)
			if err != nil {
				t.Fatal(err)
			}
			work := filepath.Join(c.Work, cleanupTestID, "work")
			if err := os.MkdirAll(work, 0700); err != nil {
				t.Fatal(err)
			}
			answer := []byte("SYNTHETIC CLEANUP CRASH ANSWER\n")
			if err := os.WriteFile(filepath.Join(work, "answer.txt"), answer, 0600); err != nil {
				t.Fatal(err)
			}
			now := Millis()
			a := &Attempt{ID: cleanupTestID, Exam: "cleanup", Username: "synthetic", UID: 29999, State: "COMPLETED", Settings: Settings{Duration: 3600}, Start: now - 1000, Ended: now, Deadline: now + 3599000, OriginalDeadline: now + 3599000, Protected: true, AccessState: "RELEASED", WorkPath: "/work"}
			a.Checksum, err = Collect(work, filepath.Join(c.State, "submissions", a.ID), a)
			if err != nil {
				t.Fatal(err)
			}
			if err := e.WithState(func() error { e.state.Attempts[a.ID] = a; return nil }); err != nil {
				t.Fatal(err)
			}
			if _, err := e.WorkspaceRetention(a.ID); err != nil {
				t.Fatal(err)
			}
			beforeState, _ := os.ReadFile(filepath.Join(c.State, "state.json"))
			archivePath := filepath.Join(c.State, "submissions", a.ID, "submission.tar.gz")
			beforeArchive, _ := os.ReadFile(archivePath)
			invoke := func(r workspaceInspectionRequest, kill string) ([]byte, error) {
				t.Helper()
				r.Config = c
				r.ID = a.ID
				data, _ := json.Marshal(r)
				requestFile := filepath.Join(base, "request-"+ManagementID()+".json")
				if err := os.WriteFile(requestFile, data, 0600); err != nil {
					t.Fatal(err)
				}
				ctx, done := context.WithTimeout(context.Background(), 15*time.Second)
				defer done()
				mapping := []string{"--user", "--map-root-user"}
				if r.Action == "restore" {
					mapping = []string{"--user", "--map-user=29999", "--map-group=29999"}
				}
				// PID1 ignores self-directed SIGKILL in a PID namespace. Keep a
				// tiny reaper as PID1 so the real worker is an ordinary killable child.
				argv := append(mapping, "--mount", "--pid", "--kill-child", "--mount-proc", "/usr/bin/python3", "-c", "import subprocess,sys; p=subprocess.run(sys.argv[1:]); sys.exit(128-p.returncode if p.returncode<0 else p.returncode)", os.Args[0], "-test.run=^TestWorkspaceCleanupPhaseDriver$")
				cmd := exec.CommandContext(ctx, "/usr/bin/unshare", argv...)
				cmd.Env = append(os.Environ(), "EXAM_CLEANUP_PHASE_DRIVER=1", "EXAM_CLEANUP_REQUEST="+requestFile, "EXAM_CLEANUP_KILL_PHASE="+kill, "GOMAXPROCS=2", "GORACE=atexit_sleep_ms=0")
				cmd.WaitDelay = 2 * time.Second
				return cmd.CombinedOutput()
			}
			out, err := invoke(workspaceInspectionRequest{Action: "preview"}, "")
			var preview WorkspaceCleanupPreview
			if err != nil || json.Unmarshal(out, &preview) != nil || !preview.SnapshotClear {
				t.Fatal("preview failed", err, string(out))
			}
			r := workspaceInspectionRequest{Action: "cleanup", Request: ManagementID(), Review: preview.Review, Reason: "Reviewed synthetic crash and explicit repair workflow"}
			if phase == "quarantined" {
				gate := filepath.Join(c.State, "synthetic-live-release")
				if err := syscall.Mkfifo(gate, 0600); err != nil {
					t.Fatal(err)
				}
				type response struct {
					data []byte
					err  error
				}
				done := make(chan response, 1)
				go func() { data, err := invoke(r, "cleanup-quarantined-live"); done <- response{data, err} }()
				limit := time.Now().Add(4 * time.Second)
				for {
					if data, err := os.ReadFile(filepath.Join(c.State, "synthetic-live-ready")); err == nil && string(data) == "QUARANTINED" {
						break
					}
					select {
					case result := <-done:
						t.Fatal("worker ended before exact live checkpoint", result.err, string(result.data))
					default:
					}
					if time.Now().After(limit) {
						t.Fatal("worker did not reach exact live checkpoint")
					}
					time.Sleep(10 * time.Millisecond)
				}
				live, liveErr := invoke(workspaceInspectionRequest{Action: "cleanup-status", Request: r.Request}, "")
				var observed WorkspaceCleanupView
				if liveErr != nil || json.Unmarshal(live, &observed) != nil || observed.Phase != "QUARANTINED" || !observed.ArchivePinned {
					t.Fatal("status blocked behind active deletion fence", liveErr, string(live))
				}
				f, openErr := os.OpenFile(gate, os.O_WRONLY|syscall.O_NONBLOCK, 0)
				if openErr != nil {
					t.Fatal(openErr)
				}
				_, openErr = f.Write([]byte("R"))
				f.Close()
				if openErr != nil {
					t.Fatal(openErr)
				}
				result := <-done
				out, err = result.data, result.err
			} else {
				out, err = invoke(r, "cleanup-"+phase)
			}
			if err == nil {
				t.Fatal("phase did not kill actual worker", phase, string(out))
			}
			if !strings.HasPrefix(phase, "fault-") {
				var death *exec.ExitError
				if !errors.As(err, &death) || death.ExitCode() != 137 {
					t.Fatal("did not observe exact worker SIGKILL (panic/timeout is not a crash oracle)", phase, err, string(out))
				}
			}
			if strings.HasPrefix(phase, "fault-") {
				want := "read-only file system"
				if phase == "fault-disk-full" {
					want = "no space left on device"
				}
				if !strings.Contains(string(out), want) {
					t.Fatal("did not reach actual storage fault", phase, string(out))
				}
			}
			status := func() WorkspaceCleanupView {
				t.Helper()
				out, err := invoke(workspaceInspectionRequest{Action: "cleanup-status", Request: r.Request}, "")
				var v WorkspaceCleanupView
				if err != nil || json.Unmarshal(out, &v) != nil || v.Request != r.Request {
					t.Fatal("status lost accepted job", err, string(out))
				}
				return v
			}
			v := status()
			want := strings.ToUpper(phase)
			if phase == "unlinked" || phase == "root-removed" {
				want = "REMOVING"
			}
			if strings.HasPrefix(phase, "fault-") {
				want = "SEALED"
			}
			if v.Phase != want {
				t.Fatal("wrong crash phase", v, want)
			}
			if phase != "completed" {
				out, err = invoke(workspaceInspectionRequest{Action: "delete"}, "")
				if err != nil || !strings.Contains(string(out), `"pinned":true`) {
					t.Fatal("archive pin lost after death", err, string(out))
				}
			}
			out, err = invoke(workspaceInspectionRequest{Action: "quarantine"}, "")
			if err != nil {
				t.Fatal("positive quarantine rejected", err, string(out))
			}
			if phase == "prepared" {
				for _, name := range []string{"workspace-cleanups-initialized", "workspace-cleanup-known-" + a.ID} {
					if err := os.Remove(filepath.Join(c.State, name)); err != nil {
						t.Fatal(err)
					}
				}
				v = status()
				if !strings.Contains(v.Error, "marker durability repair") || !v.ArchivePinned {
					t.Fatal("incomplete acceptance cannot be inspected safely", v)
				}
			}
			if phase == "sealed" {
				if _, err := e.SetWorkspaceHold(a.ID, true, 0, "Synthetic hold while cleanup is interrupted"); err != nil {
					t.Fatal(err)
				}
				blocked := status()
				out, err = invoke(workspaceInspectionRequest{Action: "cleanup-retry", Request: r.Request, Review: blocked.Review, Reason: "Synthetic held cleanup refusal"}, "")
				if err == nil || !strings.Contains(string(out), "retention hold is active") {
					t.Fatal("held cleanup resumed", err, string(out))
				}
				if _, err := e.SetWorkspaceHold(a.ID, false, 1, "Synthetic explicit hold release before reviewed repair"); err != nil {
					t.Fatal(err)
				}
				out, err = invoke(workspaceInspectionRequest{Action: "cleanup-retry", Request: r.Request, Review: blocked.Review, Reason: "Synthetic stale held-review refusal"}, "")
				if err == nil || !strings.Contains(string(out), "stale cleanup review") {
					t.Fatal("stale pre-release review resumed", err, string(out))
				}
				v = status()
			}
			if phase == "quarantined" {
				q := filepath.Join(c.Work, ".workspace-cleanup-quarantine", a.ID+"."+r.Request)
				if err := os.Rename(q, q+".preserved"); err != nil {
					t.Fatal(err)
				}
				if err := os.Mkdir(q, 0500); err != nil {
					t.Fatal(err)
				}
				changed := status()
				out, err = invoke(workspaceInspectionRequest{Action: "cleanup-retry", Request: r.Request, Review: changed.Review, Reason: "Synthetic replacement-inode refusal"}, "")
				if err == nil || !strings.Contains(string(out), "inode missing or replaced") {
					t.Fatal("replacement inode adopted", err, string(out))
				}
				if err := os.Remove(q); err != nil {
					t.Fatal(err)
				}
				if err := os.Rename(q+".preserved", q); err != nil {
					t.Fatal(err)
				}
				v = status()
			}
			if phase == "prepared" || phase == "sealed" || phase == "quarantined" || strings.HasPrefix(phase, "fault-") {
				cancel := workspaceInspectionRequest{Action: "cleanup-cancel", Request: r.Request, Review: v.Review, Reason: "Reviewed intact cancellation before removal"}
				out, err = invoke(cancel, "")
				if err != nil {
					t.Fatal("reversible cancellation failed", err, string(out))
				}
				if v = status(); v.Phase != "CANCELLED" || v.ArchivePinned {
					t.Fatal("cancel did not settle", v)
				}
				actual, err := os.ReadFile(filepath.Join(work, "answer.txt"))
				if err != nil || !bytes.Equal(actual, answer) {
					t.Fatal("cancellation lost original work", err)
				}
				out, err = invoke(workspaceInspectionRequest{Action: "preview"}, "")
				if err != nil || json.Unmarshal(out, &preview) != nil || !preview.SnapshotClear {
					t.Fatal("cancelled work not re-reviewable", err, string(out))
				}
				r.Request = ManagementID()
				r.Review = preview.Review
				out, err = invoke(r, "")
				if err != nil {
					t.Fatal("new reviewed cleanup after cancellation failed", err, string(out))
				}
			} else if phase != "completed" {
				out, err = invoke(workspaceInspectionRequest{Action: "cleanup-cancel", Request: r.Request, Review: v.Review, Reason: "Synthetic irreversible cancellation refusal"}, "")
				if err == nil {
					t.Fatal("cancel recreated removed bytes", string(out))
				}
				out, err = invoke(workspaceInspectionRequest{Action: "cleanup-retry", Request: r.Request, Review: v.Review, Reason: "Reviewed explicit interrupted cleanup repair"}, "")
				if err != nil {
					t.Fatal("reviewed retry failed", err, string(out))
				}
			}
			if v = status(); v.Phase != "COMPLETED" || !v.Cleaned || v.ArchivePinned {
				t.Fatal("cleanup did not complete", v)
			}
			if _, err := os.Lstat(filepath.Join(c.Work, a.ID)); !os.IsNotExist(err) {
				t.Fatal("canonical folder remains", err)
			}
			afterArchive, _ := os.ReadFile(archivePath)
			afterState, _ := os.ReadFile(filepath.Join(c.State, "state.json"))
			if !bytes.Equal(beforeArchive, afterArchive) || !bytes.Equal(beforeState, afterState) {
				t.Fatal("cleanup or pin refusal changed archive/authority")
			}
			out, err = invoke(workspaceInspectionRequest{Action: "absence"}, "")
			if err != nil || !strings.Contains(string(out), `"history_preserved":true`) {
				t.Fatal("independent cleanup evidence disappeared from no-start proof", err, string(out))
			}
			out, err = invoke(workspaceInspectionRequest{Action: "restore"}, "")
			if err != nil || !strings.Contains(string(out), `"restored":true`) {
				t.Fatal("public saved-work staging failed after cleanup", err, string(out))
			}
			afterArchive, _ = os.ReadFile(archivePath)
			if !bytes.Equal(beforeArchive, afterArchive) {
				t.Fatal("new recovery changed protected source")
			}
			out, err = invoke(workspaceInspectionRequest{Action: "delete-for-source"}, "")
			if err != nil || !strings.Contains(string(out), `"source_preserved":true`) {
				t.Fatal("completed cleanup interfered with independent saved-source protection", err, string(out))
			}
		})
	}
}
