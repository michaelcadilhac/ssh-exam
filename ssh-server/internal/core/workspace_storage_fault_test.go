package core

// Actual per-target ENOSPC/EROFS, never a full host filesystem or host remount.
// OS/account/writer admission is fake; only metadata-only root CLI repair runs.
import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

type workspaceStorageFaultResult struct {
	Unstarted      bool   `json:"unstarted"`
	CausePreserved bool   `json:"cause_preserved"`
	FaultError     string `json:"fault_error"`
	PartialMarker  bool   `json:"partial_marker"`
	RepairError    string `json:"repair_error"`
	Start          int64  `json:"start"`
	Deadline       int64  `json:"deadline"`
	Original       int64  `json:"original_deadline"`
	Retained       string `json:"retained"`
}

func workspaceStorageNamespace(t *testing.T, path string) string {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	return strconv.FormatUint(info.Sys().(*syscall.Stat_t).Ino, 10)
}

func TestSavedWorkspaceActualStorageFaultsPreserveRepairAndHealthyPeer(t *testing.T) {
	if os.Getenv("EXAM_COLLECTION_USERNS") != "1" {
		t.Skip("requires explicitly authorized private user/mount namespace storage faults")
	}
	cli, base, key := workspaceCrashCompiledCLI(t)
	if cli == "" {
		cli = "--no-cli"
	}
	for _, fault := range []string{"preflight-staging-disk-full", "preflight-staging-read-only", "preflight-receipt-read-only", "preflight-consumption-read-only", "consumption-disk-full", "consumption-read-only", "rename-read-only", "initialized-read-only"} {
		t.Run(fault, func(t *testing.T) {
			e, target, grant := recoveryFixture(t)
			e.Config.AgentID, e.Config.CallbackURL = base.AgentID, base.CallbackURL
			e.Config.Rootfs, e.Config.Templates = base.Rootfs, base.Templates
			e.Config.GatewayPublicKey, e.Config.CallbackKey = base.GatewayPublicKey, base.CallbackKey
			e.Config.Accounts["student"] = Account{UID: os.Getuid(), GID: os.Getgid(), Home: e.Config.Work, Shell: "/bin/bash"}
			healthyID := ManagementID()
			healthy := &Attempt{ID: healthyID, Exam: "peer", Username: "healthy", UID: os.Getuid() + 10000, State: "ACTIVE", Transport: "ssh-healthy", Generation: 7, Start: Millis(), Deadline: Millis() + 3600000, OriginalDeadline: Millis() + 3600000, Lease: Millis() + 15000, Boot: boot(), UptimeDeadline: uptime() + 3600}
			e.Config.Accounts["healthy"] = Account{UID: healthy.UID, GID: os.Getgid() + 10000, Home: e.Config.Work, Shell: "/bin/bash"}
			target.PreflightStartedAt, target.Transport = Millis(), "ssh-target"
			target.Settings.Earliest, target.Settings.Latest, target.Settings.Terminals = Millis()-1000, Millis()+600000, 4
			if err := e.WithState(func() error {
				e.state.Attempts[target.ID], e.state.Attempts[healthyID] = target, healthy
				e.state.Registrations[target.Transport], e.state.Registrations[healthy.Transport] = target.Username, healthy.Username
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			if strings.HasPrefix(fault, "preflight-staging-") || fault == "preflight-receipt-read-only" {
				if err := os.MkdirAll(e.workspaceBase(target.ID), 0700); err != nil {
					t.Fatal(err)
				}
			} else {
				if _, err := e.Call("prepare-workspace", Request{ID: target.ID}); err != nil {
					t.Fatal(err)
				}
			}
			original := map[string][]byte{}
			for _, name := range []string{"submission.tar.gz", "manifest.json"} {
				path := filepath.Join(e.Config.State, "submissions", grant.SourceAttempt, name)
				data, err := os.ReadFile(path)
				if err != nil {
					t.Fatal(err)
				}
				original[path] = data
			}
			configPath := filepath.Join(t.TempDir(), "config.json")
			config, _ := json.Marshal(e.Config)
			if err := os.WriteFile(configPath, config, 0600); err != nil {
				t.Fatal(err)
			}
			gate := filepath.Join(e.Config.State, "synthetic-storage-gate")
			if err := syscall.Mkfifo(gate, 0600); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
			defer cancel()
			mapping := []string{"--map-root-user"}
			if strings.HasPrefix(fault, "preflight-staging-") || fault == "preflight-receipt-read-only" {
				// Real extraction must retain the fixture account's numeric UID/GID;
				// the root mapping used for metadata-only CLI repair cannot chown an
				// unmapped host UID. Retain namespace-only mount capabilities.
				mapping = []string{"--map-current-user", "--keep-caps"}
			}
			arguments := append([]string{"--user"}, mapping...)
			arguments = append(arguments, "--mount", os.Args[0], "-test.run=^TestSavedWorkspaceStorageFaultChild$", "--", configPath, target.ID, fault, workspaceStorageNamespace(t, "/proc/self/ns/user"), workspaceStorageNamespace(t, "/proc/self/ns/mnt"), cli)
			command := exec.CommandContext(ctx, "/usr/bin/unshare", arguments...)
			command.Env = append(os.Environ(), "EXAM_SAVED_WORKSPACE_STORAGE_CHILD=1", "GORACE=atexit_sleep_ms=0")
			var output bytes.Buffer
			command.Stdout, command.Stderr = &output, &output
			if err := command.Start(); err != nil {
				t.Fatal(err)
			}
			done := make(chan error, 1)
			go func() { done <- command.Wait() }()
			defer func() {
				cancel()
				select {
				case <-done:
				case <-time.After(2 * time.Second):
					t.Error("owned storage child did not stop")
				}
			}()
			until := time.Now().Add(4 * time.Second)
			for {
				if _, err := os.Stat(filepath.Join(e.Config.State, "synthetic-storage-entered")); err == nil {
					break
				}
				select {
				case err := <-done:
					done <- err
					t.Fatal("actual storage fault was not reached", err, output.String())
				default:
				}
				if time.Now().After(until) {
					t.Fatal("storage fault fixture did not enter")
				}
				time.Sleep(5 * time.Millisecond)
			}
			at := time.Now()
			cmd := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "renew-execution-lease", Username: healthy.Username, Transport: healthy.Transport, Body: Request{ID: healthyID}}
			value, controlErr := e.Command(signedCommand(key, cmd), healthy.Username, healthy.Transport)
			controlElapsed := time.Since(at)
			fd, err := syscall.Open(gate, syscall.O_WRONLY|syscall.O_NONBLOCK|syscall.O_CLOEXEC, 0)
			if err != nil {
				t.Fatal("release exact owned storage gate", err)
			}
			writer := os.NewFile(uintptr(fd), "private-storage-release")
			_, writeErr := writer.Write([]byte("1"))
			writer.Close()
			waitErr := <-done
			done <- waitErr
			if waitErr != nil || writeErr != nil || ctx.Err() != nil {
				t.Fatal("isolated actual storage workflow failed", waitErr, writeErr, output.String())
			}
			if controlErr != nil || controlElapsed > time.Second || value.(*Attempt).State != "ACTIVE" || value.(*Attempt).Deadline != healthy.Deadline || value.(*Attempt).Generation != healthy.Generation {
				t.Fatal("per-target storage fault interrupted signed healthy peer", controlErr, controlElapsed)
			}
			var result workspaceStorageFaultResult
			data, err := os.ReadFile(filepath.Join(e.Config.State, "synthetic-storage-result.json"))
			if err != nil || json.Unmarshal(data, &result) != nil || !result.CausePreserved || result.PartialMarker || result.RepairError != "" {
				t.Fatal("storage failure corrupted final consumption, hid its cause or prevented supported repair", err, string(data))
			}
			if result.Unstarted {
				assertUnstartedWorkspace(t, e, target.ID)
				if result.Start != 0 || result.Deadline != 0 || result.Original != 0 {
					t.Fatal("early storage failure consumed an interval")
				}
				for path, expected := range original {
					if data, err := os.ReadFile(path); err != nil || !bytes.Equal(data, expected) {
						t.Fatal("preflight storage refusal changed protected source", err)
					}
				}
				if state, err := readStateSnapshot(e.Config.State); err != nil || state.Attempts[target.ID].Workspace == nil {
					t.Fatal("storage repair did not complete private staging", err)
				}
				// The repaired stage must be usable in the parent view, not just a
				// receipt for a discarded private tmpfs inode.
				if err := e.WithState(func() error { return e.workspaceForBegin(e.state.Attempts[target.ID]) }); err != nil {
					t.Fatal("repaired unstarted workspace is not eligible for Begin", err)
				}
				t.Logf("actual %s refused before Begin; healthy signed renewal=%s, source/allowance unchanged, repaired stage verified", fault, controlElapsed)
				return
			}
			restarted, err := New(e.Config)
			if err != nil {
				t.Fatal(err)
			}
			restarted.quiesce, restarted.terminate = func(*Attempt) error { return nil }, func(*Attempt) error { return nil }
			if _, err := restarted.Admin("retry", target.ID, "Protect the repaired original storage-failure interval"); err != nil {
				t.Fatal(err)
			}
			state, err := readStateSnapshot(e.Config.State)
			if err != nil {
				t.Fatal(err)
			}
			a := state.Attempts[target.ID]
			if a.State != "COMPLETED" || !a.Protected || a.Start != result.Start || a.Deadline != result.Deadline || a.OriginalDeadline != result.Original || a.AccessState != "HELD" || state.Attempts[healthyID].Transport != healthy.Transport {
				t.Fatal("storage repair/protection changed original timing/holds/peer ownership")
			}
			manifest, err := ReadProtected(filepath.Join(e.Config.State, "submissions", target.ID), a)
			if err != nil || len(manifest.Files) != 1 || manifest.Files[0].Hash != Hash([]byte(result.Retained)) {
				t.Fatal("storage repair lost saved answer bytes", err)
			}
			for path, expected := range original {
				if data, err := os.ReadFile(path); err != nil || !bytes.Equal(data, expected) {
					t.Fatal("storage failure/repair changed the protected source", err)
				}
			}
			t.Logf("actual %s, healthy signed renewal=%s, original interval/hold/source and repaired answer verified; OS admission/writers fake", fault, controlElapsed)
		})
	}
}

func TestSavedWorkspaceStorageFaultChild(t *testing.T) {
	if os.Getenv("EXAM_SAVED_WORKSPACE_STORAGE_CHILD") != "1" {
		t.Skip("private namespace storage child only")
	}
	args := os.Args[len(os.Args)-6:]
	stagingFault := strings.HasPrefix(args[2], "preflight-staging-") || args[2] == "preflight-receipt-read-only"
	if os.Getuid() != os.Geteuid() || (!stagingFault && os.Getuid() != 0) || workspaceStorageNamespace(t, "/proc/self/ns/user") == args[3] || workspaceStorageNamespace(t, "/proc/self/ns/mnt") == args[4] {
		t.Fatal("refuse host user/mount namespace")
	}
	mapping, err := os.ReadFile("/proc/self/uid_map")
	fields := strings.Fields(string(mapping))
	if err != nil || len(fields) != 3 || fields[0] != strconv.Itoa(os.Getuid()) || fields[2] != "1" {
		t.Fatal("not a private single-UID mapping")
	}
	if err := syscall.Mount("", "/", "", syscall.MS_REC|syscall.MS_PRIVATE, ""); err != nil {
		t.Fatal(err)
	}
	var config Config
	data, err := os.ReadFile(args[0])
	if err != nil || json.Unmarshal(data, &config) != nil || !attemptID.MatchString(args[1]) {
		t.Fatal("invalid private storage fixture")
	}
	e, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	e.activationPrepare = func(*Attempt) error { return nil }
	e.quiesce, e.terminate = func(*Attempt) error { return nil }, func(*Attempt) error { return nil }
	state, err := readStateSnapshot(config.State)
	if err != nil || state.Attempts[args[1]] == nil {
		t.Fatal("private target missing", err)
	}
	target := state.Attempts[args[1]]
	catalog := filepath.Dir(filepath.Join(config.State, recoveryName(target)))
	base := e.workspaceBase(target.ID)
	var mounted string
	t.Cleanup(func() {
		if mounted != "" {
			if err := syscall.Unmount(mounted, 0); err != nil {
				t.Error("unmount exact private test view", err)
			}
		}
	})
	readOnly := func(path string) error {
		if err := syscall.Mount(path, path, "", syscall.MS_BIND, ""); err != nil {
			return err
		}
		mounted = path
		return syscall.Mount("", path, "", syscall.MS_REMOUNT|syscall.MS_BIND|syscall.MS_RDONLY|syscall.MS_NOSUID|syscall.MS_NODEV|syscall.MS_NOEXEC, "")
	}
	fillPath := ""
	switch args[2] {
	case "consumption-disk-full", "preflight-staging-disk-full":
		mountPath := catalog
		grantName := filepath.Base(recoveryName(target))
		grant, err := os.ReadFile(filepath.Join(catalog, grantName))
		if err != nil {
			t.Fatal(err)
		}
		if args[2] == "preflight-staging-disk-full" {
			mountPath = base
		}
		if err := syscall.Mount("tmpfs", mountPath, "tmpfs", syscall.MS_NOSUID|syscall.MS_NODEV|syscall.MS_NOEXEC, "size=8k,nr_inodes=64,mode=0700"); err != nil {
			t.Fatal(err)
		}
		mounted = mountPath
		if mountPath == catalog {
			if err := os.WriteFile(filepath.Join(catalog, grantName), grant, 0600); err != nil {
				t.Fatal(err)
			}
		}
		fillPath = filepath.Join(mountPath, "synthetic-owned-fill")
		fill, err := os.OpenFile(fillPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			t.Fatal(err)
		}
		for err == nil {
			_, err = fill.Write(make([]byte, 4096))
		}
		fill.Close()
		if !errors.Is(err, syscall.ENOSPC) {
			t.Fatal("private tmpfs did not reach actual ENOSPC", err)
		}
	case "consumption-read-only", "preflight-consumption-read-only":
		if err := readOnly(catalog); err != nil {
			t.Fatal(err)
		}
	case "preflight-staging-read-only":
		if err := readOnly(base); err != nil {
			t.Fatal(err)
		}
	case "preflight-receipt-read-only":
		e.workspaceCheckpoint = func(current string) error {
			if current == "copied" {
				return readOnly(base)
			}
			return nil
		}
	case "rename-read-only", "initialized-read-only":
		phase := "recovery-consumed"
		if args[2] == "initialized-read-only" {
			phase = "work-published"
		}
		e.workspaceCheckpoint = func(current string) error {
			if current == phase {
				return readOnly(base)
			}
			return nil
		}
	default:
		t.Fatal("unknown private storage mode")
	}
	op := "activate-attempt"
	if strings.HasPrefix(args[2], "preflight-") {
		op = "prepare-workspace"
	}
	_, faultErr := e.Call(op, Request{ID: target.ID})
	if faultErr == nil {
		t.Fatal("actual storage fault did not stop publication")
	}
	result := workspaceStorageFaultResult{Unstarted: op == "prepare-workspace", CausePreserved: errors.Is(faultErr, syscall.EROFS), FaultError: faultErr.Error(), Retained: "saved answer"}
	if strings.HasSuffix(args[2], "disk-full") {
		result.CausePreserved = errors.Is(faultErr, syscall.ENOSPC)
	}
	marker, markerErr := e.readRecoveryConsumption(target)
	result.PartialMarker = markerErr == nil && string(marker) != target.ID
	state, err = readStateSnapshot(config.State)
	if err != nil {
		t.Fatal(err)
	}
	a := state.Attempts[target.ID]
	result.Start, result.Deadline, result.Original = a.Start, a.Deadline, a.OriginalDeadline
	if result.Unstarted {
		if a.State != "PREPARING" || a.Start != 0 || a.Deadline != 0 || a.OriginalDeadline != 0 || !os.IsNotExist(markerErr) {
			t.Fatal("preflight storage probe consumed an allowance/interval")
		}
	} else if a.State != "COLLECTION_FAILED" || a.Start <= 0 || a.Deadline-a.Start != target.Settings.Duration*1000 || a.OriginalDeadline != a.Deadline || a.AccessState != "HELD" {
		t.Fatal("storage failure lost committed original interval/hold")
	}
	gate, err := unix.Open(filepath.Join(config.State, "synthetic-storage-gate"), unix.O_RDWR|unix.O_NONBLOCK|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer unix.Close(gate)
	if err := os.WriteFile(filepath.Join(config.State, "synthetic-storage-entered"), []byte(args[2]), 0600); err != nil {
		t.Fatal(err)
	}
	if count, err := unix.Poll([]unix.PollFd{{Fd: int32(gate), Events: unix.POLLIN}}, 10000); err != nil || count != 1 {
		t.Fatal("private storage release timed out", err)
	}
	var release [1]byte
	if n, err := unix.Read(gate, release[:]); err != nil || n != 1 || release[0] != '1' {
		t.Fatal("private storage release failed", err)
	}
	if fillPath != "" {
		// Exact test-created filler only; do not delete/replace the failed marker.
		if err := os.Remove(fillPath); err != nil {
			t.Fatal(err)
		}
	}
	if fillPath == "" || args[2] == "preflight-staging-disk-full" {
		if err := syscall.Unmount(mounted, 0); err != nil {
			t.Fatal(err)
		}
		mounted = ""
	}
	e.workspaceCheckpoint = nil
	if args[2] == "initialized-read-only" {
		result.Retained = "retained edits after failed initialized publication"
		if err := os.WriteFile(filepath.Join(base, "work", "answer.txt"), []byte(result.Retained), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if result.Unstarted {
		if _, err := e.Call("prepare-workspace", Request{ID: target.ID}); err != nil {
			result.RepairError = err.Error()
		}
	} else if args[5] != "--no-cli" {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		command := exec.CommandContext(ctx, args[5], "--config", args[0], "workspace-repair", target.ID, "--reason", "Recover the exact committed storage-failure publication")
		output, err := command.CombinedOutput()
		cancel()
		if err != nil {
			result.RepairError = "root CLI: " + string(output)
		}
	} else if _, err := e.Admin("workspace-repair", target.ID, "Recover the exact committed storage-failure publication"); err != nil {
		result.RepairError = err.Error()
	}
	if result.RepairError == "" && !result.Unstarted {
		state, err := readStateSnapshot(config.State)
		if err != nil {
			t.Fatal(err)
		}
		a := state.Attempts[target.ID]
		answer, err := os.ReadFile(filepath.Join(base, "work", "answer.txt"))
		if err != nil || string(answer) != result.Retained || a.State != "COLLECTION_FAILED" || a.Start != result.Start || a.Deadline != result.Deadline || a.OriginalDeadline != result.Original || a.AccessState != "HELD" || a.Lease != 0 {
			t.Fatal("supported repair reopened time/work or replaced saved bytes", err)
		}
	}
	data, _ = json.Marshal(result)
	if err := os.WriteFile(filepath.Join(config.State, "synthetic-storage-result.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
}
