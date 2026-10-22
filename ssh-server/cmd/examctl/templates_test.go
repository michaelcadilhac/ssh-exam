package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"examworkspace/agent/internal/core"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

func TestTemplateHelpAndRefusalsAreDiscoverableBeforeRootOrConfiguration(t *testing.T) {
	for _, args := range [][]string{{"help", "templates"}, {"templates", "help"}, {"--config", "/missing", "templates", "--help"}, {"templates", "install", "--help"}} {
		out, code := cliProcess(t, args...)
		for _, want := range []string{"Usage:", "--expected", "--request", "--confirm", "--reason", "gateway_confirmed=false", "exam-template.slice", "unrecorded", "Exit status:"} {
			if code != 0 || !strings.Contains(out, want) {
				t.Fatal("undiscoverable template workflow", want, code, out)
			}
		}
	}
	id := "12345678-1234-4234-8234-123456789abc"
	for _, args := range [][]string{
		{"templates"}, {"templates", "delete", "name"}, {"templates", "validate"}, {"templates", "validate", "/"},
		{"templates", "validate", "/private", "--file-mib", "0"}, {"templates", "validate", "/private", "--total-mib", "127"},
		{"templates", "install", "name", "/private"}, {"templates", "install", "name", "/private", "--expected", strings.Repeat("a", 64), "--reason", "short"},
		{"templates", "show", "name", "latest"}, {"templates", "list", "--limit", "201"}, {"templates", "jobs", "--name", "name"},
		{"templates", "list", "--after", id}, {"templates", "clean", id, "--reason", "Reviewed synthetic job"},
		{"templates", "clean", id, "--confirm", core.ManagementID(), "--reason", "Reviewed synthetic job"},
		{"templates", "list", "--request", id}, {"templates", "verify", "name", strings.Repeat("a", 64), "--file-mib", "128"},
	} {
		out, code := cliProcess(t, args...)
		if code != 2 || !strings.Contains(out, "help") || strings.Contains(out, "Cannot load") {
			t.Fatal("invalid template syntax reached configuration/authority", args, code, out)
		}
	}
	out, code := cliProcess(t, "help")
	if code != 0 || !strings.Contains(out, "templates validate/install/list/show/verify/jobs/clean") {
		t.Fatal("templates absent from root help", out)
	}
	if os.Getuid() != 0 {
		out, code := cliProcess(t, "templates", "list", "--config", "/missing/configuration")
		if code != 1 || !strings.Contains(out, "root") || strings.Contains(out, "Cannot load") {
			t.Fatal("root-only refusal used wrong next step", code, out)
		}
	}
}

// Real root-mapped CLI and ordinary worker executable, with only the manager
// interface replaced by private bind mounts in this child's mount namespace.
// This tests CLI/IPC/storage workflows, NOT real system-manager cgroup controls;
// the separate user-systemd resource tests and privileged guest gate cover those.
func TestTemplateCLIContainer(t *testing.T) {
	if os.Getenv("EXAM_TEMPLATE_CLI_CONTAINER") != "1" {
		return
	}
	var args []string
	for i, arg := range os.Args {
		if arg == "--" {
			args = os.Args[i+1:]
			break
		}
	}
	if len(args) < 2 || os.Getuid() != 0 || os.Geteuid() != 0 {
		os.Exit(90)
	}
	if err := syscall.Mount("", "/", "", syscall.MS_REC|syscall.MS_PRIVATE, ""); err != nil {
		t.Fatal(err)
	}
	if state := os.Getenv("EXAM_TEMPLATE_TEST_TMPFS_STATE"); state != "" {
		if err := syscall.Mount("tmpfs", state, "tmpfs", 0, "size=32k,mode=0700"); err != nil {
			t.Fatal(err)
		}
	}
	for _, target := range []string{"/usr/bin/systemctl", "/usr/bin/systemd-run"} {
		if err := syscall.Mount(args[0], target, "", syscall.MS_BIND, ""); err != nil {
			t.Fatal(err)
		}
	}
	if err := syscall.Exec(args[1], args[1:], os.Environ()); err != nil {
		t.Fatal(err)
	}
}

func TestTemplateCLICompiledInstallRetryInspectAndCleanupInPrivateNamespace(t *testing.T) {
	if os.Getenv("EXAM_MANAGEMENT_USERNS") != "1" {
		t.Skip("set EXAM_MANAGEMENT_USERNS=1 for compiled root-mapped CLI/private manager interface workflows")
	}
	dir := t.TempDir()
	if scratch := os.Getenv("EXAM_COLLECTION_TEST_ROOT"); scratch != "" {
		var err error
		dir, err = os.MkdirTemp(scratch, "template-cli-test-")
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			if err := os.RemoveAll(dir); err != nil {
				t.Error(err)
			}
		})
	}
	var fs syscall.Statfs_t
	if err := syscall.Statfs(dir, &fs); err != nil {
		t.Fatal(err)
	}
	if fs.Type == 0x01021994 || fs.Type == 0x858458f6 {
		t.Skip("compiled install workflow needs disk scratch: set EXAM_COLLECTION_TEST_ROOT; native tmpfs/ramfs refusal remains enforced")
	}
	if err := os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	binary := filepath.Join(dir, "examctl")
	build := exec.Command("go", "build", "-o", binary, ".")
	build.Env = append(os.Environ(), "CGO_ENABLED=0")
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatal("build actual CLI", err, string(out))
	}
	pub, key, _ := ed25519.GenerateKey(rand.Reader)
	pubDER, _ := x509.MarshalPKIXPublicKey(pub)
	keyDER, _ := x509.MarshalPKCS8PrivateKey(key)
	write := func(path string, b []byte, mode os.FileMode) {
		t.Helper()
		if err := os.WriteFile(path, b, mode); err != nil {
			t.Fatal(err)
		}
	}
	pubPath, keyPath := filepath.Join(dir, "gateway.pub"), filepath.Join(dir, "agent.key")
	write(pubPath, pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pubDER}), 0600)
	write(keyPath, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER}), 0600)
	c := core.Config{State: filepath.Join(dir, "state"), Work: filepath.Join(dir, "work"), Rootfs: dir, Templates: dir, AgentID: "class", CallbackURL: "https://unused.example.edu", CallbackKey: keyPath, GatewayPublicKey: pubPath, Accounts: map[string]core.Account{"synthetic": {UID: 29999, GID: 29999, Home: dir, Shell: "/bin/bash"}}}
	for _, p := range []string{c.State, c.Work, filepath.Join(dir, "source", "work"), filepath.Join(dir, "source", "materials")} {
		if err := os.MkdirAll(p, 0700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Chmod(filepath.Join(dir, "source", "materials"), 0755); err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(dir, "source")
	write(filepath.Join(source, "work", "starter"), []byte("SYNTHETIC STARTER\n"), 0644)
	write(filepath.Join(source, "materials", "WELCOME.txt"), []byte("SYNTHETIC MATERIAL\n"), 0644)
	config := filepath.Join(dir, "config.json")
	configData, _ := json.Marshal(c)
	write(config, configData, 0600)
	sentinel := []byte(`{"attempts":{"synthetic":{"state":"ACTIVE","deadline":1234,"original_deadline":1234,"access_state":"HELD","protected":true}}}`)
	write(filepath.Join(c.State, "state.json"), sentinel, 0600)
	manager := filepath.Join(dir, "private-manager.py")
	write(manager, []byte(`#!/usr/bin/python3
import os,subprocess,sys
args=sys.argv[1:]
if os.path.basename(sys.argv[0])=='systemctl':
    assert args==['show','exam-template.slice','--property=LoadState','--property=MemoryMax','--property=MemorySwapMax','--property=TasksMax'], args
    print('LoadState='+('not-found' if os.getenv('EXAM_TEMPLATE_TEST_POOL_MISSING')=='1' else 'loaded')+'\nMemoryMax=268435456\nMemorySwapMax=0\nTasksMax=32')
else:
    assert '--property=Slice=exam-template.slice' in args and '--property=MemoryMax=256M' in args and '--property=RuntimeMaxSec=120' in args, args
    command=args[args.index('--')+1:]
    assert len(command)==2 and command[1]=='--template-worker', command
    raise SystemExit(subprocess.run(command,stdin=sys.stdin.buffer,stdout=sys.stdout.buffer,stderr=sys.stderr.buffer).returncode)
`), 0700)
	invoke := func(args ...string) ([]byte, []byte, int) {
		t.Helper()
		argv := []string{"--user", "--map-root-user", "--mount", os.Args[0], "-test.run=^TestTemplateCLIContainer$", "--", manager, binary, "--config", config, "templates"}
		cmd := exec.Command("/usr/bin/unshare", append(argv, args...)...)
		cmd.Env = append(os.Environ(), "EXAM_TEMPLATE_CLI_CONTAINER=1", "GORACE=atexit_sleep_ms=0")
		var stdout, stderr bytes.Buffer
		cmd.Stdout = &stdout
		cmd.Stderr = &stderr
		err := cmd.Run()
		code := 0
		if err != nil {
			if status, ok := err.(*exec.ExitError); ok {
				code = status.ExitCode()
			} else {
				t.Fatal(err)
			}
		}
		return stdout.Bytes(), stderr.Bytes(), code
	}
	run := func(args ...string) core.TemplateResult {
		t.Helper()
		out, errOut, code := invoke(args...)
		var result core.TemplateResult
		if code != 0 || json.Unmarshal(out, &result) != nil {
			t.Fatal("actual CLI workflow failed", args, code, string(out), string(errOut))
		}
		if result.GatewayConfirmed {
			t.Fatal("local operation claimed gateway confirmation")
		}
		return result
	}
	validated := run("validate", source, "--file-mib", "1", "--total-mib", "2")
	if !validated.Verified || validated.Installed || validated.Info == nil {
		t.Fatal("wrong source phase", validated)
	}
	id := core.ManagementID()
	install := []string{"install", "midterm", source, "--expected", validated.Info.Hash, "--reason", "Reviewed synthetic source package", "--request", id, "--file-mib", "1", "--total-mib", "2"}
	installed := run(install...)
	if !installed.Installed || !installed.Verified || installed.Job != id {
		t.Fatal(installed)
	}
	write(filepath.Join(source, "work", "starter"), []byte("Author subsequently edited source"), 0644)
	if again := run(install...); again.Info.Hash != installed.Info.Hash {
		t.Fatal("retry recollected mutable bytes")
	}
	if shown := run("show", "midterm", installed.Info.Hash); shown.Verified || !shown.Installed {
		t.Fatal("show claimed fresh verification")
	}
	if verified := run("verify", "midterm", installed.Info.Hash); !verified.Verified {
		t.Fatal("verify not verified")
	}
	if page := run("list", "--name", "midterm", "--limit", "1"); len(page.Versions) != 1 {
		t.Fatal(page)
	}
	if page := run("jobs", "--limit", "1"); len(page.Jobs) != 1 || page.Jobs[0].ID != id {
		t.Fatal(page)
	}
	run("clean", id, "--confirm", id, "--reason", "Reviewed already published job only")
	run("verify", "midterm", installed.Info.Hash)
	conflict := append([]string{}, install...)
	for i := range conflict {
		if conflict[i] == "Reviewed synthetic source package" {
			conflict[i] = "Different reviewed install reason"
		}
	}
	if out, errOut, code := invoke(conflict...); code != 1 || len(out) != 0 || !bytes.Contains(errOut, []byte("conflicts")) {
		t.Fatal("conflict leaked success or lacks guidance", code, string(out), string(errOut))
	}
	write(filepath.Join(c.State, "template-catalog", "versions", "midterm", installed.Info.Hash, "content", "work", "starter"), []byte("Corrupted synthetic installed content"), 0644)
	if out, errOut, code := invoke("verify", "midterm", installed.Info.Hash); code != 1 || len(out) != 0 || !bytes.Contains(errOut, []byte("preserve")) {
		t.Fatal("corrupted version yielded metadata success", code, string(out), string(errOut))
	}
	t.Setenv("EXAM_TEMPLATE_TEST_POOL_MISSING", "1")
	if out, errOut, code := invoke("list"); code != 1 || len(out) != 0 || !bytes.Contains(errOut, []byte("authorized drained maintenance")) {
		t.Fatal("missing pool refusal lacks bounded repair guidance", code, string(out), string(errOut))
	}
	t.Setenv("EXAM_TEMPLATE_TEST_POOL_MISSING", "")
	t.Setenv("EXAM_TEMPLATE_TEST_TMPFS_STATE", c.State)
	if out, errOut, code := invoke(install...); code != 1 || len(out) != 0 || !bytes.Contains(errOut, []byte("not tmpfs/ramfs")) {
		t.Fatal("memory-backed state accepted or misleading refusal", code, string(out), string(errOut))
	}
	t.Setenv("EXAM_TEMPLATE_TEST_TMPFS_STATE", "")
	after, err := os.ReadFile(filepath.Join(c.State, "state.json"))
	if err != nil || !bytes.Equal(after, sentinel) {
		t.Fatal("CLI rewrote protected/live authority", err)
	}
}
