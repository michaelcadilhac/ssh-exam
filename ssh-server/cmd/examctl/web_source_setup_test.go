package main

import (
	"bytes"
	"context"
	"encoding/json"
	"examworkspace/agent/internal/core"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
)

func TestSourceSetupWorkerActualChildRetentionReplyLossRevocationAndDeath(t *testing.T) {
	if os.Getenv("EXAM_MANAGEMENT_USERNS") != "1" {
		t.Skip("requires explicit isolated root-mapped CLI/TLS qualification")
	}
	const id = "55555555-1234-4234-8234-123456789abc"
	const sourceID = "22222222-1234-4234-8234-123456789abc"
	const request = "88888888-1234-4234-8234-123456789abc"
	const lease = "99999999-1234-4234-8234-123456789abc"
	var mu sync.Mutex
	mode := "healthy"
	confirmed := false
	reports := 0
	confirmations := 0
	entered, release := make(chan struct{}, 1), make(chan struct{})
	resourceEntered, resourceRelease := make(chan struct{}, 1), make(chan struct{})
	var resourceReleaseOnce, releaseOnce sync.Once
	var plan core.SourceRetentionPlan
	var c core.Config
	var pinPath string
	status := func(value string) map[string]any {
		grantStatus := "PENDING_NATIVE"
		if confirmed {
			grantStatus = "AVAILABLE"
		}
		if mode == "revoked" {
			grantStatus = "REVOKED"
		}
		return map[string]any{"id": id, "revision": 1, "current_revision": 1, "grant_status": grantStatus, "status": value, "tries": 1, "error": "", "updated": core.Millis()}
	}
	f := newScriptCLIFixture(t, func(r map[string]any) (any, string, bool) {
		mu.Lock()
		defer mu.Unlock()
		body := r["body"].(map[string]any)
		switch r["operation"] {
		case "grants.source-status":
			return status("QUEUED"), "", false
		case "grants.source-next":
			return map[string]any{"task": map[string]any{"id": id, "revision": 1, "request": request, "lease": lease, "lease_until": core.Millis() + 180000}}, "", false
		case "grants.source-plan":
			if mode == "resource" {
				resourceEntered <- struct{}{}
				mu.Unlock()
				<-resourceRelease
				mu.Lock()
			}
			if mode == "blocked" {
				entered <- struct{}{}
				mu.Unlock()
				<-release
				mu.Lock()
			}
			p := plan
			if mode == "revoked" {
				p.Action = "release"
				p.Status = "REVOKED"
			}
			return p, "", false
		case "grants.source-confirm":
			confirmations++
			stored, err := os.ReadFile(pinPath)
			var pin core.GrantSourceRetention
			if err != nil || json.Unmarshal(stored, &pin) != nil || pin.Phase != "retained" || body["retention_hash"] != pin.RetentionHash || body["retained_at"] != float64(pin.RetainedAt) || body["state"] != "RETAINED" || r["request"] != request {
				t.Error("confirmation preceded exact durable retain-only pin", err, body)
			}
			confirmed = true
			if mode == "lost" {
				return nil, "", true
			}
			return map[string]any{"id": id, "revision": 1, "state": "RETAINED", "retention_hash": pin.RetentionHash, "status": "AVAILABLE"}, "", false
		case "grants.source-report":
			reports++
			if body["id"] != id || body["lease"] != lease {
				t.Error("wrong report scope", body)
			}
			value := "FAILED"
			if confirmed {
				value = "READY"
			}
			if mode == "revoked" {
				value = "CANCELLED"
			}
			return status(value), "", false
		}
		return nil, "unexpected operation", false
	})
	t.Cleanup(func() {
		resourceReleaseOnce.Do(func() { close(resourceRelease) })
		releaseOnce.Do(func() { close(release) })
	})
	raw, err := os.ReadFile(f.config)
	if err != nil || json.Unmarshal(raw, &c) != nil {
		t.Fatal(err)
	}
	for _, dir := range []string{c.State, c.Work, filepath.Join(c.State, "submissions"), filepath.Join(f.dir, "source")} {
		if err := os.MkdirAll(dir, 0700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(f.dir, "source", "answer.c"), []byte("/* synthetic saved work */\n"), 0600); err != nil {
		t.Fatal(err)
	}
	a := &core.Attempt{ID: sourceID, Exam: "original", Username: "synthetic", UID: 29999, State: "COMPLETED", Settings: core.Settings{ID: "original", Duration: 3600}, Start: core.Millis() - 7200000, Deadline: core.Millis() - 3600000, AccessState: "RELEASED", PolicyState: "NORMAL"}
	a.OriginalDeadline = a.Deadline
	a.Checksum, err = core.Collect(filepath.Join(f.dir, "source"), filepath.Join(c.State, "submissions", sourceID), a)
	if err != nil {
		t.Fatal(err)
	}
	a.Protected = true
	native := core.State{Attempts: map[string]*core.Attempt{sourceID: a}, Caps: map[string]core.Capability{}, Registrations: map[string]string{}}
	before, _ := json.Marshal(native)
	statePath := filepath.Join(c.State, "state.json")
	if err := os.WriteFile(statePath, before, 0600); err != nil {
		t.Fatal(err)
	}
	settings := core.Settings{ID: "retake", Name: "Synthetic retry", Template: "v1", TemplateVersion: strings.Repeat("a", 64), Duration: 5400, Webcam: false, Terminals: 4, Earliest: core.Millis() - 1000, Latest: core.Millis() + 600000}
	work := &core.GrantWork{Kind: "saved", Attempt: sourceID, Checksum: a.Checksum}
	plan = core.SourceRetentionPlan{Version: 1, Agent: "class", Grant: &core.GrantBinding{ID: id, Revision: 1, Hash: strings.Repeat("b", 64), Kind: "ADDITIONAL", Order: 2, Work: work}, Exam: settings.ID, Username: "synthetic", UID: 29999, Settings: settings, Source: core.SourceRetentionSource{Attempt: sourceID, Checksum: a.Checksum}, Action: "retain", CurrentRevision: 1, Status: "PENDING_NATIVE"}
	pinPath = filepath.Join(c.State, "source-retentions", id+"-1.json")
	binary := filepath.Join(f.dir, "examctl")
	build := exec.Command("go", "build", "-o", binary, ".")
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatal(err, string(out))
	}
	// Publish the fully initialized fixture through its existing synchronization.
	if out, stderr, code := f.invoke("grants", "source-status", id, "--revision", "1"); code != 0 || !strings.Contains(out, "QUEUED") {
		t.Fatal(code, out, stderr)
	}
	worker := func(ctx context.Context) *exec.Cmd {
		return exec.CommandContext(ctx, "/usr/bin/unshare", "--user", "--map-root-user", binary, "web", "grants", "source-worker", "--once", "--config", f.config, "--worker-state", filepath.Join(f.dir, "worker"))
	}
	run := func() string {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		cmd := worker(ctx)
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatal(err, string(out))
		}
		return string(out)
	}
	if out := run(); !strings.Contains(out, `"status":"READY"`) {
		t.Fatal(out)
	}
	first, err := os.ReadFile(pinPath)
	if err != nil {
		t.Fatal(err)
	}
	if os.Getenv("EXAM_COLLECTION_USER_SYSTEMD") == "1" {
		unit := "ssh-exam-source-setup-test-" + core.ManagementID()[:12] + ".service"
		mu.Lock()
		mode = "resource"
		mu.Unlock()
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		args := []string{"--user", "--quiet", "--wait", "--pipe", "--unit=" + unit, "--service-type=exec", "--property=MemoryMax=256M", "--property=MemorySwapMax=0", "--property=TasksMax=32", "--property=CPUQuota=50%", "--property=KillMode=control-group", "--property=OOMPolicy=kill", "--property=RuntimeMaxSec=25s", "--", "/usr/bin/unshare", "--user", "--map-root-user", binary, "web", "grants", "source-worker", "--once", "--config", f.config, "--worker-state", filepath.Join(f.dir, "worker")}
		bounded := exec.CommandContext(ctx, "/usr/bin/systemd-run", args...)
		var output bytes.Buffer
		bounded.Stdout = &output
		bounded.Stderr = &output
		if err := bounded.Start(); err != nil {
			t.Fatal(err)
		}
		done := make(chan error, 1)
		go func() { done <- bounded.Wait() }()
		t.Cleanup(func() {
			cleanup, stop := context.WithTimeout(context.Background(), 5*time.Second)
			defer stop()
			_ = exec.CommandContext(cleanup, "/usr/bin/systemctl", "--user", "stop", unit).Run()
		})
		select {
		case <-resourceEntered:
		case err := <-done:
			t.Fatal("resource service ended before actual child readiness", err, output.String())
		case <-time.After(6 * time.Second):
			t.Fatal("resource service did not reach signed plan")
		}
		group, err := exec.CommandContext(ctx, "/usr/bin/systemctl", "--user", "show", unit, "--property=ControlGroup", "--value").Output()
		path := strings.TrimSpace(string(group))
		if err != nil || !filepath.IsAbs(path) || filepath.Clean(path) != path || filepath.Base(path) != unit {
			t.Fatal("owned service cgroup unverified", err, path)
		}
		for leaf, want := range map[string]string{"memory.max": "268435456", "memory.swap.max": "0", "pids.max": "32", "memory.oom.group": "1"} {
			data, err := os.ReadFile("/sys/fs/cgroup" + path + "/" + leaf)
			if err != nil || strings.TrimSpace(string(data)) != want {
				t.Fatal("wrong live service resource bound", leaf, string(data), err)
			}
		}
		cpu, err := os.ReadFile("/sys/fs/cgroup" + path + "/cpu.max")
		fields := strings.Fields(string(cpu))
		if err != nil || len(fields) != 2 {
			t.Fatal("CPU bound unavailable", err, string(cpu))
		}
		quota, e1 := strconv.Atoi(fields[0])
		period, e2 := strconv.Atoi(fields[1])
		if e1 != nil || e2 != nil || quota <= 0 || 2*quota != period {
			t.Fatal("wrong live CPU bound", string(cpu))
		}
		pids, err := os.ReadFile("/sys/fs/cgroup" + path + "/cgroup.procs")
		if err != nil || len(strings.Fields(string(pids))) < 2 {
			t.Fatal("coordinator and archive child not in owned resource group", err, string(pids))
		}
		for _, word := range strings.Fields(string(pids)) {
			if word == strconv.Itoa(os.Getpid()) {
				t.Fatal("test parent placed in worker resource group")
			}
		}
		resourceReleaseOnce.Do(func() { close(resourceRelease) })
		select {
		case err := <-done:
			if err != nil {
				t.Fatal(err, output.String())
			}
		case <-time.After(6 * time.Second):
			t.Fatal("bounded service did not finish after release")
		}
		if !strings.Contains(output.String(), `"status":"READY"`) {
			t.Fatal("bounded service did not finish native retention", output.String())
		}
		if data, err := os.ReadFile("/sys/fs/cgroup" + path + "/cgroup.events"); !os.IsNotExist(err) && (err != nil || !strings.Contains(string(data), "populated 0")) {
			t.Fatal("owned service cleanup receipt not empty", err, string(data))
		}
		t.Log("actual worker + archive child: memory.max=256MiB swap=0 pids=32 cpu=50% oom.group=1; empty cleanup receipt")
	}
	mu.Lock()
	mode = "lost"
	confirmed = false
	mu.Unlock()
	if out := run(); !strings.Contains(out, `"status":"READY"`) {
		t.Fatal("lost native confirmation reply lost committed proof", out)
	}
	retried, _ := os.ReadFile(pinPath)
	if !bytes.Equal(first, retried) {
		t.Fatal("retry replaced durable pin identity")
	}
	mu.Lock()
	mode = "revoked"
	mu.Unlock()
	if out := run(); !strings.Contains(out, `"status":"CANCELLED"`) {
		t.Fatal(out)
	}
	still, _ := os.ReadFile(pinPath)
	if !bytes.Equal(first, still) {
		t.Fatal("worker followed a revoked release plan")
	}
	mu.Lock()
	mode = "blocked"
	beforeReports, beforeConfirmations := reports, confirmations
	mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	cmd := worker(ctx)
	var output bytes.Buffer
	cmd.Stdout = &output
	cmd.Stderr = &output
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if cmd.ProcessState == nil {
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
		}
	}()
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("child did not reach signed source plan", output.String())
	}
	// Find only this owned worker's direct child, across Go runtime threads.
	children := map[int]bool{}
	threads, err := os.ReadDir(fmt.Sprintf("/proc/%d/task", cmd.Process.Pid))
	if err != nil {
		t.Fatal(err)
	}
	for _, thread := range threads {
		data, _ := os.ReadFile(fmt.Sprintf("/proc/%d/task/%s/children", cmd.Process.Pid, thread.Name()))
		for _, word := range strings.Fields(string(data)) {
			pid, _ := strconv.Atoi(word)
			if pid > 0 {
				children[pid] = true
			}
		}
	}
	if len(children) != 1 {
		t.Fatal("expected exactly one isolated archive child", children)
	}
	if err := cmd.Process.Signal(syscall.SIGKILL); err != nil {
		t.Fatal(err)
	}
	err = cmd.Wait()
	exit, ok := err.(*exec.ExitError)
	if !ok || !exit.Sys().(syscall.WaitStatus).Signaled() || exit.Sys().(syscall.WaitStatus).Signal() != syscall.SIGKILL {
		t.Fatal("coordinator did not die by exact SIGKILL", err, output.String())
	}
	releaseOnce.Do(func() { close(release) })
	for pid := range children {
		deadline := time.Now().Add(3 * time.Second)
		for {
			data, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
			gone := os.IsNotExist(err)
			if err == nil {
				tail := string(data)[strings.LastIndexByte(string(data), ')')+1:]
				fields := strings.Fields(tail)
				gone = len(fields) > 0 && fields[0] == "Z"
			}
			if gone {
				break
			}
			if time.Now().After(deadline) {
				t.Fatal("archive child survived coordinator death", pid)
			}
			time.Sleep(5 * time.Millisecond)
		}
	}
	mu.Lock()
	if reports != beforeReports || confirmations != beforeConfirmations {
		t.Error("dead coordinator/child reported completion")
	}
	mu.Unlock()
	after, _ := os.ReadFile(statePath)
	if !bytes.Equal(before, after) {
		t.Fatal("worker changed native attempts, clocks or holds")
	}
	still, _ = os.ReadFile(pinPath)
	if !bytes.Equal(first, still) {
		t.Fatal("worker death changed source pin")
	}
	// A dead coordinator releases its exact private flock; restart can poll again.
	mu.Lock()
	mode = "healthy"
	mu.Unlock()
	if out := run(); !strings.Contains(out, `"status":"READY"`) {
		t.Fatal(out)
	}
}
