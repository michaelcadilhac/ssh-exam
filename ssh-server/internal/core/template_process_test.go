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

// Fault switches exist only in the test executable; production CLI/config has
// no way to bypass root checks, resource isolation, or publication verification.
func TestTemplateChild(t *testing.T) {
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
	input, err := io.ReadAll(io.LimitReader(os.Stdin, 16385))
	if err != nil {
		os.Exit(20)
	}
	var req templateWorkerRequest
	if decodeWorkerFrame(bytes.NewReader(input), 16384, &req) != nil {
		os.Exit(21)
	}
	if strings.HasPrefix(mode, "reply-") {
		var out bytes.Buffer
		if runTemplateWorker(bytes.NewReader(input), &out, nil) != nil {
			os.Exit(22)
		}
		var wire map[string]any
		if json.Unmarshal(out.Bytes(), &wire) != nil {
			os.Exit(23)
		}
		result, ok := wire["result"].(map[string]any)
		if !ok {
			os.Exit(24)
		}
		switch mode {
		case "reply-truncated":
			_, _ = io.WriteString(os.Stdout, `{"schema":1`)
			os.Exit(0)
		case "reply-oversized":
			_, _ = io.WriteString(os.Stdout, strings.Repeat("x", templateReplyLimit+1))
			os.Exit(0)
		case "reply-nonce":
			wire["nonce"] = Token()
		case "reply-action":
			wire["action"] = "install"
		case "reply-id":
			wire["id"] = ManagementID()
		case "reply-missing-confirmed":
			delete(result, "gateway_confirmed")
		case "reply-null-verified":
			result["verified"] = nil
		case "reply-confirmed":
			result["gateway_confirmed"] = true
		case "reply-scope":
			result["action"] = "install"
		case "reply-unknown":
			result["private_payload"] = "MUST-NOT-PRINT"
		case "reply-error-control":
			delete(wire, "result")
			wire["error"] = "unsafe\x1b[31m"
		case "reply-error-oversized":
			delete(wire, "result")
			wire["error"] = strings.Repeat("x", 12001)
		case "reply-conflicting":
			wire["error"] = "both error and result"
		}
		_ = json.NewEncoder(os.Stdout).Encode(wire)
		if mode == "reply-trailing" {
			_, _ = io.WriteString(os.Stdout, `{}`)
		}
		os.Exit(0)
	}
	if mode == "disk-full" || mode == "read-only" {
		// Fresh user/mount namespace only; never fill or remount host storage.
		if syscall.Mount("tmpfs", req.State, "tmpfs", 0, "size=32k,nr_inodes=128,mode=0700") != nil {
			os.Exit(25)
		}
		if mode == "read-only" {
			if syscall.Mount("", req.State, "", syscall.MS_REMOUNT|syscall.MS_RDONLY, "") != nil {
				os.Exit(26)
			}
		} else if os.WriteFile(filepath.Join(req.State, "synthetic-fill"), make([]byte, 32*1024), 0600) != nil {
			os.Exit(27)
		}
	}
	if strings.HasPrefix(mode, "cleanup-bind-") {
		stage := filepath.Join(req.State, "template-catalog", "jobs", req.Command.Job, "publish")
		from, to := filepath.Join(req.State, "submissions"), stage
		if mode == "cleanup-bind-nested" {
			to = filepath.Join(stage, "content", "work")
		}
		if mode == "cleanup-bind-file" {
			from = filepath.Join(from, "protected")
			to = filepath.Join(stage, "content", "work", "main.c")
		}
		if syscall.Mount(from, to, "", syscall.MS_BIND, "") != nil {
			os.Exit(31)
		}
	}
	err = runTemplateWorker(bytes.NewReader(input), os.Stdout, func(at string) error {
		if at == "verify-started" && strings.HasPrefix(mode, "verify-") {
			if err := os.WriteFile(filepath.Join(req.State, "template-child-entered"), []byte("verify ready"), 0600); err != nil {
				return err
			}
			switch mode {
			case "verify-kill":
				_ = syscall.Kill(os.Getpid(), syscall.SIGKILL)
			case "verify-panic":
				panic("synthetic template verifier panic")
			case "verify-hang":
				for {
					time.Sleep(time.Hour)
				}
			}
		}
		if mode == "kill-job-created" && at == "job-created" {
			_ = syscall.Kill(os.Getpid(), syscall.SIGKILL)
		}
		if mode == "kill-published" && at == "published" {
			_ = syscall.Kill(os.Getpid(), syscall.SIGKILL)
		}
		if at != "before-publish" {
			return nil
		}
		if err := os.WriteFile(filepath.Join(req.State, "template-child-entered"), []byte("ready"), 0600); err != nil {
			return err
		}
		switch mode {
		case "panic":
			panic("synthetic template worker panic")
		case "exit":
			os.Exit(17)
		case "kill":
			_ = syscall.Kill(os.Getpid(), syscall.SIGKILL)
		case "hang":
			for {
				time.Sleep(time.Hour)
			}
		case "memory-bound":
			if syscall.Setrlimit(syscall.RLIMIT_AS, &syscall.Rlimit{Cur: uint64(64 * mib), Max: uint64(64 * mib)}) != nil {
				os.Exit(28)
			}
			b := make([]byte, 256*mib)
			runtime.KeepAlive(b)
			os.Exit(29)
		case "cgroup-memory":
			b := make([]byte, 512*mib)
			for i := range b {
				b[i] = byte(i)
			}
			runtime.KeepAlive(b)
			os.Exit(29)
		case "observe-default":
			groups, err := os.ReadFile("/proc/self/cgroup")
			if err != nil {
				return err
			}
			var group string
			for _, line := range strings.Split(string(groups), "\n") {
				if path, ok := strings.CutPrefix(line, "0::"); ok {
					group = path
				}
			}
			if !filepath.IsAbs(group) || filepath.Clean(group) != group || group == "/" {
				return errors.New("invalid test worker cgroup")
			}
			values := map[string]string{}
			for _, key := range []string{"memory.max", "memory.swap.max", "pids.max", "memory.oom.group", "memory.peak"} {
				data, err := os.ReadFile(filepath.Join("/sys/fs/cgroup", strings.TrimPrefix(group, "/"), key))
				if err != nil {
					return err
				}
				values[key] = string(data)
			}
			data, _ := json.Marshal(values)
			return os.WriteFile(filepath.Join(req.State, "template-live-controls.json"), data, 0600)
		case "file-bound":
			return syscall.Setrlimit(syscall.RLIMIT_FSIZE, &syscall.Rlimit{Cur: 1, Max: 1})
		case "barrier-error":
			return errors.New("synthetic incomplete import")
		}
		return nil
	})
	if err != nil {
		os.Exit(30)
	}
	os.Exit(0)
}

func TestTemplateProcessDefaultSizeImportUnderActualUserSystemdControls(t *testing.T) {
	if os.Getenv("EXAM_COLLECTION_USER_SYSTEMD") != "1" {
		t.Skip("set EXAM_COLLECTION_USER_SYSTEMD=1 for 128 MiB import under actual worker controls")
	}
	f := templateCatalogFixture(t)
	large, err := os.OpenFile(filepath.Join(f.source, "work", "large"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0644)
	if err != nil {
		t.Fatal(err)
	}
	err = large.Truncate(128 * mib)
	closeErr := large.Close()
	if err != nil || closeErr != nil {
		t.Fatal(err, closeErr)
	}
	m, err := inspectTemplateSource(f.source, collectionBounds{File: 128 * mib, Total: 512 * mib}, nil)
	if err != nil {
		t.Fatal(err)
	}
	b := templateInstallCommand(f)
	b.Hash = m.Hash
	b.FileMiB = 128
	b.TotalMiB = 512
	unit := "ssh-exam-template-size-test-" + Token()[:12] + ".service"
	t.Cleanup(func() {
		_ = exec.Command("/usr/bin/systemctl", "--user", "stop", unit).Run()
		_ = exec.Command("/usr/bin/systemctl", "--user", "reset-failed", unit).Run()
	})
	opts := templateProcessOptions{timeout: 130 * time.Second, command: func(string) []string {
		base := templateServiceArgs(unit, os.Args[0])
		args := []string{"/usr/bin/env", "XDG_RUNTIME_DIR=" + os.Getenv("XDG_RUNTIME_DIR"), "DBUS_SESSION_BUS_ADDRESS=" + os.Getenv("DBUS_SESSION_BUS_ADDRESS"), base[0], "--user"}
		for _, arg := range base[1:] {
			if arg == "--collect" || arg == "--property=Slice=exam-template.slice" {
				continue
			}
			if arg == templateWorkerFlag {
				args = append(args, "-test.run=^TestTemplateChild$", "--", "observe-default")
				continue
			}
			args = append(args, arg)
		}
		return args
	}}
	result, err := runTemplateProcess(templateProcessRequest(f, b, ManagementID()), opts)
	if err != nil || !result.Installed || !result.Verified || result.Info.Bytes < 128*mib {
		t.Fatal("bounded default-size import failed", result, err)
	}
	data, err := os.ReadFile(filepath.Join(f.state, "template-live-controls.json"))
	if err != nil {
		t.Fatal(err)
	}
	values := map[string]string{}
	if err := json.Unmarshal(data, &values); err != nil {
		t.Fatal(err)
	}
	peak, err := validateLargeWorkerMemoryObservation(values)
	if err != nil {
		t.Fatal("actual live template controls wrong", values, err)
	}
	if _, err := templateRun(t, f, TemplateCommand{Action: "verify", Name: b.Name, Hash: b.Hash}, ""); err != nil {
		t.Fatal("installed large bytes do not verify", err)
	}
	t.Logf("actual 128 MiB import; live memory.max=256 MiB swap.max=0 pids.max=32 oom.group=1; observed peak=%d (not an exact ceiling)", peak)
}

func templateChildOptions(mode string) templateProcessOptions {
	return templateProcessOptions{command: func(string) []string { return []string{os.Args[0], "-test.run=^TestTemplateChild$", "--", mode} }, timeout: 2 * time.Second}
}
func templateProcessRequest(f templateFixture, b TemplateCommand, id string) templateWorkerRequest {
	return templateWorkerRequest{Schema: 1, Nonce: Token(), ID: id, State: f.state, Command: b}
}

func TestTemplateProcessRejectsMalformedAndMismatchedRepliesBeforeReturningMetadata(t *testing.T) {
	for _, mode := range []string{"truncated", "oversized", "nonce", "action", "id", "missing-confirmed", "null-verified", "confirmed", "scope", "unknown", "error-control", "error-oversized", "conflicting", "trailing"} {
		t.Run(mode, func(t *testing.T) {
			f := templateCatalogFixture(t)
			r := templateProcessRequest(f, TemplateCommand{Action: "jobs", Limit: 5}, ManagementID())
			result, err := runTemplateProcess(r, templateChildOptions("reply-"+mode))
			if err == nil || result.Action != "" || strings.Contains(err.Error(), "MUST-NOT-PRINT") {
				t.Fatal("untrusted metadata/error escaped", result, err)
			}
		})
	}
}

func TestTemplateProcessDeathsAndTimeoutPreserveAuthorityAndRequireExplicitRecovery(t *testing.T) {
	for _, mode := range []string{"panic", "exit", "kill", "hang", "memory-bound", "file-bound", "barrier-error", "kill-published", "kill-job-created"} {
		t.Run(mode, func(t *testing.T) {
			f := templateCatalogFixture(t)
			b, id := templateInstallCommand(f), ManagementID()
			r := templateProcessRequest(f, b, id)
			_, err := runTemplateProcess(r, templateChildOptions(mode))
			if err == nil {
				t.Fatal("failed worker reported success")
			}
			want := map[string]string{"panic": "exit status 2", "exit": "exit status 17", "kill": "signal: killed", "hang": "signal: killed", "memory-bound": "exit status 2", "file-bound": "file too large", "barrier-error": "synthetic incomplete import", "kill-published": "signal: killed", "kill-job-created": "signal: killed"}[mode]
			if !strings.Contains(err.Error(), want) {
				t.Fatal("wrong fault", mode, err)
			}
			if mode == "kill-published" || mode == "file-bound" {
				if err := os.WriteFile(filepath.Join(f.source, "work", "main.c"), []byte("author edited after publication"), 0644); err != nil {
					t.Fatal(err)
				}
				if _, err := templateRun(t, f, b, id); err != nil {
					t.Fatal("published exact retry failed", err)
				}
				return
			}
			if _, err := templateRun(t, f, b, id); err == nil {
				t.Fatal("incomplete staging silently recopied")
			}
			if _, err := templateRun(t, f, TemplateCommand{Action: "clean", Job: id, Reason: "Reviewed isolated worker failure"}, ""); err != nil {
				t.Fatal(err)
			}
			if _, err := templateRun(t, f, b, ""); err != nil {
				t.Fatal("fresh request failed after cleanup", err)
			}
		})
	}
}

func TestTemplateProcessBulkLockSurvivesCoordinatorBoundAndHealthySignedAdmissionContinues(t *testing.T) {
	f := templateCatalogFixture(t)
	b, id := templateInstallCommand(f), ManagementID()
	opts := templateChildOptions("hang")
	opts.timeout = 4 * time.Second
	finished := make(chan error, 1)
	go func() { _, err := runTemplateProcess(templateProcessRequest(f, b, id), opts); finished <- err }()
	drained := false
	defer func() {
		if !drained {
			select {
			case <-finished:
			case <-time.After(8 * time.Second):
				t.Error("template child did not drain")
			}
		}
	}()
	until := time.Now().Add(2 * time.Second)
	for {
		if _, err := os.Stat(filepath.Join(f.state, "template-child-entered")); err == nil {
			break
		}
		if time.Now().After(until) {
			t.Fatal("worker never reached real publication barrier")
		}
		time.Sleep(5 * time.Millisecond)
	}
	// A different coordinator cannot bypass the real child's retained flock.
	if _, err := templateRun(t, f, b, ""); err == nil || !strings.Contains(err.Error(), "worker busy") {
		t.Fatal("cross-coordinator bulk slot bypass", err)
	}
	if _, err := templateRun(t, f, TemplateCommand{Action: "jobs", Limit: 5}, ""); err != nil {
		t.Fatal("metadata waited on bulk lock", err)
	}
	e, key, _ := leaseFixture(t)
	if err := e.WithState(func() error { e.state.Attempts[finalID].Settings.Terminals = 4; return nil }); err != nil {
		t.Fatal(err)
	}
	before := inspectFinal(t, e)
	for _, c := range []Command{
		{Op: "renew-execution-lease", Username: before.Username, Transport: before.Transport, Body: Request{ID: finalID}},
		{Op: "issue-channel-admission", Username: before.Username, Transport: before.Transport, Body: Request{ID: finalID, Username: before.Username, Transport: before.Transport, Pane: finalID, Purpose: "exam"}},
	} {
		c.Audience, c.Nonce, c.Expires = "class", Token(), Millis()+20000
		at := time.Now()
		if _, err := e.Command(signedCommand(key, c), c.Username, c.Transport); err != nil {
			t.Fatal("template job disrupted signed healthy operation", c.Op, err)
		}
		if time.Since(at) > time.Second {
			t.Fatal("template job blocked signed admission")
		}
	}
	after := inspectFinal(t, e)
	if after.Deadline != before.Deadline || after.OriginalDeadline != before.OriginalDeadline || after.Generation != before.Generation || after.AccessState != before.AccessState || after.State != "ACTIVE" {
		t.Fatal("template worker changed attempt authority")
	}
	if err := <-finished; err == nil {
		t.Fatal("hung worker reported success")
	}
	drained = true
	if _, err := templateRun(t, f, TemplateCommand{Action: "clean", Job: id, Reason: "Reviewed hung synthetic import only"}, ""); err != nil {
		t.Fatal("slot not released at actual death", err)
	}
}

func TestTemplateProcessUserSystemdOOMAndRuntimeBounds(t *testing.T) {
	if os.Getenv("EXAM_COLLECTION_USER_SYSTEMD") != "1" {
		t.Skip("set EXAM_COLLECTION_USER_SYSTEMD=1 for actual local disposable cgroup OOM/runtime tests")
	}
	for _, mode := range []string{"cgroup-memory", "hang"} {
		t.Run(mode, func(t *testing.T) {
			f := templateCatalogFixture(t)
			unit := "ssh-exam-template-test-" + Token()[:12] + ".service"
			t.Cleanup(func() {
				_ = exec.Command("/usr/bin/systemctl", "--user", "stop", unit).Run()
				_ = exec.Command("/usr/bin/systemctl", "--user", "reset-failed", unit).Run()
			})
			opts := templateProcessOptions{timeout: 12 * time.Second, command: func(string) []string {
				base := templateServiceArgs(unit, os.Args[0])
				// Production deliberately strips session-bus environment. Restore
				// it only through this test command, for the local USER manager.
				args := []string{"/usr/bin/env", "XDG_RUNTIME_DIR=" + os.Getenv("XDG_RUNTIME_DIR"), "DBUS_SESSION_BUS_ADDRESS=" + os.Getenv("DBUS_SESSION_BUS_ADDRESS"), base[0], "--user"}
				for _, arg := range base[1:] {
					switch arg {
					case "--collect", "--property=Slice=exam-template.slice":
						continue // Private user manager, not installed system pool.
					case "--property=MemoryMax=256M":
						arg = "--property=MemoryMax=64M"
					case "--property=RuntimeMaxSec=120":
						arg = "--property=RuntimeMaxSec=2"
					case templateWorkerFlag:
						args = append(args, "-test.run=^TestTemplateChild$", "--", mode)
						continue
					}
					args = append(args, arg)
				}
				return args
			}}
			_, workerErr := runTemplateProcess(templateProcessRequest(f, templateInstallCommand(f), ManagementID()), opts)
			if workerErr == nil {
				t.Fatal("resource-failing template worker reported success")
			}
			result, err := exec.Command("/usr/bin/systemctl", "--user", "show", unit, "--property=Result", "--value").Output()
			want := "oom-kill"
			if mode == "hang" {
				want = "timeout"
			}
			if err != nil || strings.TrimSpace(string(result)) != want {
				t.Fatal("wrong actual systemd failure", string(result), err, workerErr)
			}
			t.Log("actual template worker cgroup result:", want)
		})
	}
}

func TestTemplateProcessUserNamespaceStorageFailures(t *testing.T) {
	if os.Getenv("EXAM_COLLECTION_USERNS") != "1" {
		t.Skip("set EXAM_COLLECTION_USERNS=1 for private mount ENOSPC/read-only checks")
	}
	for _, mode := range []string{"disk-full", "read-only"} {
		t.Run(mode, func(t *testing.T) {
			f := templateCatalogFixture(t)
			opts := templateChildOptions(mode)
			opts.command = func(string) []string {
				return []string{"/usr/bin/unshare", "--user", "--map-root-user", "--mount", os.Args[0], "-test.run=^TestTemplateChild$", "--", mode}
			}
			_, err := runTemplateProcess(templateProcessRequest(f, templateInstallCommand(f), ManagementID()), opts)
			want := "no space left on device"
			if mode == "read-only" {
				want = "read-only file system"
			}
			if err == nil || !strings.Contains(err.Error(), want) {
				t.Fatal("did not exercise real storage failure", err)
			}
			if _, err := templateRun(t, f, templateInstallCommand(f), ""); err != nil {
				t.Fatal("storage fault escaped private namespace", err)
			}
		})
	}
}

func TestTemplateSliceAndServiceHaveIndependentStrictBounds(t *testing.T) {
	valid := "LoadState=loaded\nMemoryMax=268435456\nMemorySwapMax=0\nTasksMax=32\n"
	if err := validateTemplateSlice(valid); err != nil {
		t.Fatal(err)
	}
	for _, invalid := range []string{strings.ReplaceAll(valid, "loaded", "not-found"), strings.ReplaceAll(valid, "268435456", "infinity"), strings.ReplaceAll(valid, "268435456", "536870912"), strings.ReplaceAll(valid, "TasksMax=32", "TasksMax=33"), strings.ReplaceAll(valid, "MemorySwapMax=0", "MemorySwapMax=1")} {
		if validateTemplateSlice(invalid) == nil {
			t.Fatal("unbounded template pool accepted", invalid)
		}
	}
	args := strings.Join(templateServiceArgs("synthetic.service", "/private/examctl"), " ")
	for _, field := range []string{"Slice=exam-template.slice", "MemoryMax=256M", "MemorySwapMax=0", "TasksMax=32", "RuntimeMaxSec=120", "KillMode=control-group", "OOMPolicy=kill", "--template-worker"} {
		if !strings.Contains(args, field) {
			t.Fatal("lost worker bound", field)
		}
	}
	if strings.Contains(args, "exam-collection.slice") {
		t.Fatal("template work shares protected collection capacity")
	}
}

func TestTemplateProcessUserNamespaceCleanupRefusesRootNestedAndFileBindMounts(t *testing.T) {
	if os.Getenv("EXAM_COLLECTION_USERNS") != "1" {
		t.Skip("set EXAM_COLLECTION_USERNS=1 for real cleanup mount-boundary checks")
	}
	for _, mode := range []string{"cleanup-bind-root", "cleanup-bind-nested", "cleanup-bind-file"} {
		t.Run(mode, func(t *testing.T) {
			f := templateCatalogFixture(t)
			id := ManagementID()
			c, err := openTemplateCatalog(f.state, true)
			if err != nil {
				t.Fatal(err)
			}
			hit := false
			_, err = c.install(templateInstallCommand(f), id, func(at string) error {
				if at == "before-publish" {
					hit = true
					return errors.New("synthetic incomplete publication")
				}
				return nil
			})
			c.close()
			if err == nil || !hit {
				t.Fatal("failed to create real owned staging", err)
			}
			opts := templateChildOptions(mode)
			opts.command = func(string) []string {
				return []string{"/usr/bin/unshare", "--user", "--map-root-user", "--mount", os.Args[0], "-test.run=^TestTemplateChild$", "--", mode}
			}
			b := TemplateCommand{Action: "clean", Job: id, Reason: "Synthetic exact staged job cleanup"}
			if _, err := runTemplateProcess(templateProcessRequest(f, b, ManagementID()), opts); err == nil || !strings.Contains(err.Error(), "mount") {
				t.Fatal("real mounted tree accepted for cleanup", err)
			}
			// The protected tree is checked by the fixture cleanup; do not require
			// unrelated private scratch leaves to survive a failed partial cleanup.
		})
	}
}
