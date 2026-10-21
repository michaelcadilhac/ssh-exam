package core

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"testing"
	"time"
)

// This helper is compiled only into the test executable. It uses the production
// framed protocol/job/archive implementation; privileged writer operations are
// replaced only here. Fatal failures are real child process deaths, not errors
// returned by an in-process collector.
func TestCollectionChild(t *testing.T) {
	mode := ""
	for i, arg := range os.Args {
		if arg == "--" && i+1 < len(os.Args) {
			mode = os.Args[i+1]
			break
		}
	}
	if mode == "" {
		return
	}
	if mode == "truncated" {
		_, _ = io.WriteString(os.Stdout, `{"version":1`)
		os.Exit(0)
	}
	if mode == "oversized" {
		_, _ = io.WriteString(os.Stdout, strings.Repeat("x", 16384))
		os.Exit(0)
	}
	if mode == "wrong-reply" {
		_ = json.NewEncoder(os.Stdout).Encode(collectionReply{Version: 1, ID: finalID, Action: "finalize", Nonce: Token()})
		os.Exit(0)
	}
	err := runCollectionWorkerWith(os.Stdin, os.Stdout, func(c Config) (*Engine, error) {
		e, err := New(c)
		if err != nil {
			return nil, err
		}
		e.workspaceCheckpoint = func(phase string) error {
			if mode == "workspace-kill-private" && phase == "published-private" {
				_ = syscall.Kill(os.Getpid(), syscall.SIGKILL)
			}
			if phase == "copied" && (mode == "workspace-hang" || mode == "workspace-file-bound") {
				if err := os.WriteFile(filepath.Join(c.State, "child-entered"), []byte("workspace copied"), 0600); err != nil {
					return err
				}
				if mode == "workspace-file-bound" {
					return syscall.Setrlimit(syscall.RLIMIT_FSIZE, &syscall.Rlimit{Cur: 1, Max: 1})
				}
				for {
					time.Sleep(time.Hour)
				}
			}
			return nil
		}
		if mode == "disk-full" || mode == "read-only" {
			mountpoint := filepath.Join(c.State, "submissions")
			if err := os.MkdirAll(mountpoint, 0700); err != nil {
				return nil, err
			}
			// The helper is launched inside a fresh user+mount namespace.
			// This mount and its failure cannot consume host disk or escape it.
			if err := syscall.Mount("tmpfs", mountpoint, "tmpfs", 0, "size=32k,nr_inodes=128"); err != nil {
				return nil, err
			}
			if mode == "read-only" {
				if err := syscall.Mount("", mountpoint, "", syscall.MS_REMOUNT|syscall.MS_RDONLY, ""); err != nil {
					return nil, err
				}
			} else if err := os.WriteFile(filepath.Join(mountpoint, "synthetic-fill"), make([]byte, 32*1024), 0600); err != nil {
				return nil, err
			}
		}
		e.quiesce = func(*Attempt) error {
			if err := os.WriteFile(filepath.Join(c.State, "child-entered"), []byte("ready"), 0600); err != nil {
				return err
			}
			switch mode {
			case "panic":
				panic("synthetic collector panic")
			case "exit":
				os.Exit(17)
			case "kill":
				_ = syscall.Kill(os.Getpid(), syscall.SIGKILL)
			case "hang":
				for {
					time.Sleep(time.Hour)
				}
			case "memory-bound":
				if err := syscall.Setrlimit(syscall.RLIMIT_AS, &syscall.Rlimit{Cur: 64 * 1024 * 1024, Max: 64 * 1024 * 1024}); err != nil {
					os.Exit(18)
				}
				b := make([]byte, 256*1024*1024) // Fatal runtime allocation failure inside this child only.
				runtime.KeepAlive(b)
				os.Exit(19) // Must still fail closed if a platform satisfies the allocation.
			case "cgroup-memory":
				b := make([]byte, 512*1024*1024)
				for i := range b {
					b[i] = byte(i)
				}
				runtime.KeepAlive(b)
				os.Exit(19)
			case "file-bound":
				return syscall.Setrlimit(syscall.RLIMIT_FSIZE, &syscall.Rlimit{Cur: 1, Max: 1})
			case "barrier-error":
				return errors.New("synthetic uncontained writer")
			case "permission":
				if os.Geteuid() == 0 {
					return errors.New("permission fixture must run unprivileged")
				}
				parent := filepath.Join(c.State, "submissions")
				if err := os.MkdirAll(parent, 0700); err != nil {
					return err
				}
				return os.Chmod(parent, 0500)
			case "published-before-state":
				// Model worker death in the publication->state gap using the
				// actual atomic publisher and exact durable job snapshot.
				s := e.state.Attempts[finalID]
				v := *s
				v.CompletedAt = Millis()
				if _, err := Collect(filepath.Join(c.Work, finalID, "work"), filepath.Join(c.State, "submissions", finalID), &v); err != nil {
					return err
				}
				_ = syscall.Kill(os.Getpid(), syscall.SIGKILL)
			}
			return nil
		}
		e.terminate = func(*Attempt) error {
			if mode == "kill-after-protection" {
				_ = syscall.Kill(os.Getpid(), syscall.SIGKILL)
			}
			return nil
		}
		return e, nil
	})
	if err != nil {
		os.Exit(20)
	}
	os.Exit(0)
}

func TestCollectionPermissionFailureRetainsWork(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("requires an unprivileged permission-denied fixture")
	}
	e, c, source := finalFixture(t, "ACTIVE", Millis()+5400000)
	parent := filepath.Join(c.State, "submissions")
	t.Cleanup(func() { _ = os.Chmod(parent, 0700) })
	childCollections(e, "permission")
	if _, err := e.Call("finalize-attempt", Request{ID: finalID, Reason: "synthetic permission failure"}); err == nil || !strings.Contains(err.Error(), "permission denied") {
		t.Fatal("expected actual collection permission failure", err)
	}
	if a := inspectFinal(t, e); a.State != "COLLECTION_FAILED" || a.Protected || a.AccessState != "HELD" {
		t.Fatal("permission failure lost work/hold state", a)
	}
	if _, err := os.Stat(filepath.Join(source, "answer.txt")); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(parent, 0700); err != nil {
		t.Fatal(err)
	}
	childCollections(e, "success")
	if _, err := e.Call("finalize-attempt", Request{ID: finalID, Reason: "corrected synthetic permissions"}); err != nil {
		t.Fatal("failed to recover saved work after permission correction", err)
	}
}

func TestCollectionUserNamespaceDiskFailures(t *testing.T) {
	if os.Getenv("EXAM_COLLECTION_USERNS") != "1" {
		t.Skip("set EXAM_COLLECTION_USERNS=1 for isolated tmpfs ENOSPC/read-only publication tests")
	}
	for _, mode := range []string{"disk-full", "read-only"} {
		t.Run(mode, func(t *testing.T) {
			e, _, source := finalFixture(t, "ACTIVE", Millis()+5400000)
			e.workerCommand = func(string) []string {
				return []string{"/usr/bin/unshare", "--user", "--map-root-user", "--mount", os.Args[0], "-test.run=^TestCollectionChild$", "--", mode}
			}
			e.workerTimeout = 5 * time.Second
			e.collectionRun = e.runCollectionProcess
			_, err := e.Call("finalize-attempt", Request{ID: finalID, Reason: "synthetic isolated storage failure"})
			want := "no space left on device"
			if mode == "read-only" {
				want = "read-only file system"
			}
			if err == nil || !strings.Contains(err.Error(), want) {
				t.Fatalf("expected actual %s, got %v", want, err)
			}
			if a := inspectFinal(t, e); a.State != "COLLECTION_FAILED" || a.Protected || a.AccessState != "HELD" {
				t.Fatal("storage failure lost work/hold state", a)
			}
			if _, err := os.Stat(filepath.Join(source, "answer.txt")); err != nil {
				t.Fatal("storage failure lost saved work", err)
			}
			childCollections(e, "success")
			if _, err := e.Call("finalize-attempt", Request{ID: finalID, Reason: "retry outside failed test filesystem"}); err != nil {
				t.Fatal("storage failure prevented safe retry", err)
			}
			t.Log("actual isolated", want, "; source/hold preserved and retry completed")
		})
	}
}

func childCollections(e *Engine, mode string) {
	e.workerCommand = func(string) []string {
		return []string{os.Args[0], "-test.run=^TestCollectionChild$", "--", mode}
	}
	e.workerTimeout = 2 * time.Second
	e.collectionRun = e.runCollectionProcess
}

func TestFatalCollectionWorkersDoNotDisruptOtherAttempts(t *testing.T) {
	const healthyID = "98765432-1234-1234-1234-123456789abc"
	for _, mode := range []string{"panic", "exit", "kill", "hang", "memory-bound", "file-bound", "barrier-error", "truncated", "oversized", "wrong-reply"} {
		t.Run(mode, func(t *testing.T) {
			e, key, _ := leaseFixture(t)
			e.Config.Accounts["healthy"] = Account{UID: 1002, GID: 1002}
			e.Config.Accounts["newstudent"] = Account{UID: 1003, GID: 1003}
			if err := e.WithState(func() error {
				v := *e.state.Attempts[finalID]
				v.ID, v.Username, v.UID, v.Transport = healthyID, "healthy", 1002, "ssh-healthy"
				v.Settings.Terminals = 4
				e.state.Attempts[healthyID] = &v
				e.state.Registrations[v.Transport] = v.Username
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			before, err := e.Call("inspect-attempt", Request{ID: healthyID})
			if err != nil {
				t.Fatal(err)
			}
			childCollections(e, mode)
			finished := make(chan error, 1)
			drained := false
			defer func() {
				if !drained {
					select {
					case <-finished:
					case <-time.After(8 * time.Second):
						t.Error("worker did not drain before synthetic fixture cleanup")
					}
				}
			}()
			go func() {
				_, err := e.Call("finalize-attempt", Request{ID: finalID, Reason: "synthetic finish"})
				finished <- err
			}()
			if mode != "truncated" && mode != "oversized" && mode != "wrong-reply" {
				until := time.Now().Add(1500 * time.Millisecond)
				for {
					if _, err := os.Stat(filepath.Join(e.Config.State, "child-entered")); err == nil {
						break
					}
					if time.Now().After(until) {
						t.Fatal("faulting child never reached its actual collection barrier")
					}
					time.Sleep(5 * time.Millisecond)
				}
			}
			// Real signed monitoring, channel admission, new registration and
			// registration on a replacement SSH transport remain available.
			for _, c := range []Command{
				{Op: "renew-execution-lease", Username: "healthy", Transport: "ssh-healthy", Body: Request{ID: healthyID}},
				{Op: "issue-channel-admission", Username: "healthy", Transport: "ssh-healthy", Body: Request{ID: healthyID, Username: "healthy", Transport: "ssh-healthy", Pane: finalID, Purpose: "exam"}},
				{Op: "register", Username: "newstudent"},
				{Op: "register", Username: "newstudent"},
			} {
				c.Audience, c.Nonce, c.Expires = "class", Token(), Millis()+20000
				transport := c.Transport
				if transport == "" {
					transport = "fresh-" + c.Nonce[:12]
				}
				at := time.Now()
				if _, err := e.Command(signedCommand(key, c), c.Username, transport); err != nil {
					t.Fatal(c.Op, err)
				}
				if time.Since(at) > time.Second {
					t.Fatal("worker failure blocked healthy management/admission", c.Op)
				}
			}
			select {
			case err := <-finished:
				drained = true
				if err == nil {
					t.Fatal("failed worker reported success")
				}
				expected := map[string]string{"panic": "exit status 2", "exit": "exit status 17", "kill": "signal: killed", "hang": "signal: killed", "memory-bound": "exit status 2", "file-bound": "file too large", "barrier-error": "synthetic uncontained writer", "truncated": "invalid collection worker reply", "oversized": "invalid collection worker reply", "wrong-reply": "invalid collection worker reply"}
				if !strings.Contains(err.Error(), expected[mode]) {
					t.Fatalf("wrong failure mode: expected %q, got %v", expected[mode], err)
				}
			case <-time.After(8 * time.Second):
				t.Fatal("worker supervisor did not enforce its bound")
			}
			a := inspectFinal(t, e)
			if a.State != "COLLECTION_FAILED" || a.Protected || a.AccessState != "HELD" || len(a.Errors) == 0 {
				t.Fatalf("failed collection lost protection/hold/error state: %+v", a)
			}
			after, err := e.Call("inspect-attempt", Request{ID: healthyID})
			if err != nil || after.(*Attempt).State != "ACTIVE" || after.(*Attempt).Generation != before.(*Attempt).Generation || after.(*Attempt).Deadline != before.(*Attempt).Deadline {
				t.Fatal("worker failure changed another attempt", err)
			}
			if _, err := os.Stat(filepath.Join(e.Config.Work, finalID, "work", "answer.txt")); err != nil {
				t.Fatal("failed worker lost saved work", err)
			}
		})
	}
}

func TestKilledCollectionWorkerAdoptsPublishedBytesOnRetry(t *testing.T) {
	for _, mode := range []string{"published-before-state", "kill-after-protection"} {
		t.Run(mode, func(t *testing.T) {
			e, c, source := finalFixture(t, "ACTIVE", Millis()+5400000)
			childCollections(e, mode)
			if _, err := e.Call("finalize-attempt", Request{ID: finalID, Reason: "synthetic finish"}); err == nil {
				t.Fatal("killed worker reported success")
			}
			a := inspectFinal(t, e)
			if a.State != "COLLECTION_FAILED" || a.AccessState != "HELD" || (mode == "kill-after-protection" && !a.Protected) {
				t.Fatal("lost distinction between published protection and cleanup", a)
			}
			path := filepath.Join(c.State, "submissions", finalID, "submission.tar.gz")
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			// Removing the synthetic source proves restart uses only protected bytes.
			if err := os.RemoveAll(source); err != nil {
				t.Fatal(err)
			}
			restarted, err := New(c)
			if err != nil {
				t.Fatal(err)
			}
			childCollections(restarted, "success")
			if _, err := restarted.Call("finalize-attempt", Request{ID: finalID, Reason: "retry after worker crash"}); err != nil {
				t.Fatal(err)
			}
			after, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(before, after) || inspectFinal(t, restarted).State != "COMPLETED" {
				t.Fatal("retry replaced protected bytes or failed completion", err)
			}
		})
	}
}

func TestCollectionResourceAndProtocolContracts(t *testing.T) {
	args := strings.Join(collectionServiceArgs("exam-collection-test.service", "/root/exam-agent"), " ")
	for _, required := range []string{"Slice=exam-collection.slice", "MemoryMax=256M", "MemorySwapMax=0", "TasksMax=32", "RuntimeMaxSec=120", "OOMPolicy=kill", "KillMode=control-group", "--pipe", "--wait", "--collect", collectionWorkerFlag} {
		if !strings.Contains(args, required) {
			t.Fatal("resource boundary missing", required)
		}
	}
	for _, invalid := range []string{"", "LoadState=not-found", "LoadState=loaded\nMemoryMax=infinity\nTasksMax=96", "LoadState=loaded\nMemoryMax=1073741824\nTasksMax=96", "LoadState=loaded\nMemoryMax=536870912\nTasksMax=infinity"} {
		if validateCollectionSlice(invalid) == nil {
			t.Fatal("accepted missing/unbounded collection slice", invalid)
		}
	}
	if err := validateCollectionSlice("LoadState=loaded\nMemoryMax=536870912\nTasksMax=96"); err != nil {
		t.Fatal(err)
	}
	for _, invalid := range []string{`{`, `{}`, `{"version":1,"unknown":true}`, strings.Repeat("x", 8193)} {
		var reply collectionReply
		if decodeWorkerFrame(strings.NewReader(invalid), 8192, &reply) == nil && invalid != `{}` {
			t.Fatal("accepted invalid worker frame")
		}
	}
}

func TestFailedCutoffDoesNotSuppressOtherCollection(t *testing.T) {
	e, c, _ := finalFixture(t, "ACTIVE", Millis()-1000)
	const otherID = "98765432-1234-1234-1234-123456789abc"
	if err := e.WithState(func() error {
		v := *e.state.Attempts[finalID]
		v.ID, v.Username, v.UID = otherID, "other", 1002
		e.state.Attempts[otherID] = &v
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	work := filepath.Join(c.Work, otherID, "work")
	if err := os.MkdirAll(work, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(work, "answer"), []byte("other saved answer"), 0600); err != nil {
		t.Fatal(err)
	}
	barrier := func(a *Attempt) error {
		if a.ID == finalID {
			return errors.New("synthetic scope cannot freeze")
		}
		return nil
	}
	e.cutoff, e.quiesce = barrier, barrier
	if err := e.Tick(); err != nil {
		t.Fatal(err)
	}
	if a := inspectFinal(t, e); a.State != "COLLECTION_FAILED" || a.Protected {
		t.Fatal("failed barrier published collection", a)
	}
	r, err := e.Call("inspect-attempt", Request{ID: otherID})
	if err != nil || r.(*Attempt).State != "COMPLETED" || !r.(*Attempt).Protected {
		t.Fatal("one failed cutoff suppressed another student's protected collection", err)
	}
}

func TestVerifiedMetadataAnchorIsSmallAndInvalidatedOnCorruption(t *testing.T) {
	e, c, _ := finalFixture(t, "ACTIVE", Millis()+5400000)
	if _, err := e.Call("finalize-attempt", Request{ID: finalID, Reason: "synthetic finish"}); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(filepath.Join(c.State, "state.json"))
	if err != nil || bytes.Contains(b, []byte("answer.txt")) {
		t.Fatal("historical file inventory was duplicated into shared state", err)
	}
	if err := e.WithState(func() error {
		if len(e.state.ManifestReceipts[finalID]) != 64 {
			t.Fatal("worker verification did not install its bounded metadata anchor")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	archive := filepath.Join(c.State, "submissions", finalID, "submission.tar.gz")
	if err := os.WriteFile(archive, []byte("synthetic corruption"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Call("submission-manifest", Request{ID: finalID}); err == nil {
		t.Fatal("corrupt protected bytes passed explicit worker verification")
	}
	if err := e.WithState(func() error {
		if e.state.ManifestReceipts[finalID] != "" || len(e.state.Attempts[finalID].Errors) == 0 {
			t.Fatal("failed verification retained a trusted cached receipt")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

// Runs actual systemd/cgroup v2 OOM and runtime enforcement as the local user,
// in uniquely named disposable services. No class accounts/services/config are
// read or changed. Privileged writer hooks remain simulated, as in the helper.
func TestCollectionUserSystemdBounds(t *testing.T) {
	if os.Getenv("EXAM_COLLECTION_USER_SYSTEMD") != "1" {
		t.Skip("set EXAM_COLLECTION_USER_SYSTEMD=1 for disposable local user-systemd OOM/runtime qualification")
	}
	for _, mode := range []string{"cgroup-memory", "hang"} {
		t.Run(mode, func(t *testing.T) {
			e, _, _ := finalFixture(t, "ACTIVE", Millis()+5400000)
			unit := "ssh-exam-collection-test-" + Token()[:12] + ".service"
			t.Cleanup(func() {
				_ = exec.Command("/usr/bin/systemctl", "--user", "stop", unit).Run()
				_ = exec.Command("/usr/bin/systemctl", "--user", "reset-failed", unit).Run()
			})
			e.workerCommand = func(string) []string {
				base := collectionServiceArgs(unit, os.Args[0])
				args := []string{base[0], "--user"}
				for _, arg := range base[1:] {
					switch arg {
					case "--collect": // Keep failed result until inspected, then clean it up.
						continue
					case "--property=Slice=exam-collection.slice":
						continue // Local user manager, never the production slice.
					case "--property=MemoryMax=256M":
						arg = "--property=MemoryMax=64M"
					case "--property=RuntimeMaxSec=120":
						arg = "--property=RuntimeMaxSec=2"
					case collectionWorkerFlag:
						args = append(args, "-test.run=^TestCollectionChild$", "--", mode)
						continue
					}
					args = append(args, arg)
				}
				return args
			}
			e.workerTimeout = 12 * time.Second
			e.collectionRun = e.runCollectionProcess
			at := time.Now()
			if _, err := e.Call("finalize-attempt", Request{ID: finalID, Reason: "synthetic bounded collection"}); err == nil {
				t.Fatal("resource-failing child reported success")
			}
			result, err := exec.Command("/usr/bin/systemctl", "--user", "show", unit, "--property=Result", "--value").Output()
			want := "oom-kill"
			if mode == "hang" {
				want = "timeout"
			}
			if err != nil || strings.TrimSpace(string(result)) != want {
				t.Fatalf("actual systemd result=%q, want %s: %v", result, want, err)
			}
			if a := inspectFinal(t, e); a.State != "COLLECTION_FAILED" || a.Protected || a.AccessState != "HELD" {
				t.Fatal("systemd resource failure lost conservative state", a)
			}
			t.Logf("actual user-systemd %s; enforced result=%s; elapsed=%s; protected work/hold preserved", mode, want, time.Since(at))
		})
	}
}
