package core

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

func TestTemporaryDirectoriesPrivateSharedAndRestartSafe(t *testing.T) {
	e, err := New(Config{State: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	a := &Attempt{ID: finalID}
	paths, err := e.prepareTemporary(a, false)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{paths.Tmp, paths.VarTmp} {
		info, err := os.Stat(p)
		if err != nil || info.Mode().Perm() != 0777 || info.Mode()&os.ModeSticky == 0 || info.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) {
			t.Fatalf("invalid temp leaf %s: %v %v", p, info, err)
		}
		if err := os.WriteFile(filepath.Join(p, "marker"), []byte("pane one"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	for _, rel := range []string{"temporary", "temporary/" + a.ID, "temporary/" + a.ID + "/exam"} {
		info, err := os.Stat(filepath.Join(e.Config.State, rel))
		if err != nil || info.Mode().Perm() != 0700 {
			t.Fatalf("exposed parent %s: %v %v", rel, info, err)
		}
	}
	second, _ := New(e.Config)
	shared, err := second.prepareTemporary(a, false)
	if err != nil || shared != paths {
		t.Fatalf("panes/restart changed backing: %+v %v", shared, err)
	}
	for _, p := range []string{shared.Tmp, shared.VarTmp} {
		b, err := os.ReadFile(filepath.Join(p, "marker"))
		if err != nil || string(b) != "pane one" {
			t.Fatal("temp lost across panes/restart", err)
		}
	}
	practice, err := e.prepareTemporary(a, true)
	if err != nil || practice == paths {
		t.Fatal("practice shares exam temp", err)
	}
	other, err := e.prepareTemporary(&Attempt{ID: "22345678-1234-1234-1234-123456789abc"}, false)
	if err != nil || other == paths {
		t.Fatal("attempts share temp", err)
	}
	for _, p := range []string{practice.Tmp, practice.VarTmp, other.Tmp, other.VarTmp} {
		if _, err := os.Stat(filepath.Join(p, "marker")); !os.IsNotExist(err) {
			t.Fatal("temp leaked across attempt/phase", err)
		}
	}
}

func TestTemporaryStorageRejectsLinksAndUnsafeParents(t *testing.T) {
	for _, component := range []string{"temporary", finalID, "exam", "tmp", "var-tmp"} {
		t.Run(component, func(t *testing.T) {
			e, _ := New(Config{State: t.TempDir()})
			outside := t.TempDir()
			os.WriteFile(filepath.Join(outside, "keep"), []byte("private"), 0600)
			parent := e.Config.State
			for _, name := range []string{"temporary", finalID, "exam", "tmp", "var-tmp"} {
				p := filepath.Join(parent, name)
				if name == component {
					if err := os.Symlink(outside, p); err != nil {
						t.Fatal(err)
					}
					break
				}
				if name != "tmp" {
					if err := os.Mkdir(p, 0700); err != nil {
						t.Fatal(err)
					}
					parent = p
				}
			}
			if _, err := e.prepareTemporary(&Attempt{ID: finalID}, false); err == nil {
				t.Fatal("followed storage symlink")
			}
			if b, err := os.ReadFile(filepath.Join(outside, "keep")); err != nil || string(b) != "private" {
				t.Fatal("symlink target modified", err)
			}
		})
	}
	e, _ := New(Config{State: t.TempDir()})
	os.Mkdir(filepath.Join(e.Config.State, "temporary"), 0755)
	if _, err := e.prepareTemporary(&Attempt{ID: finalID}, false); err == nil {
		t.Fatal("accepted traversable parent")
	}
	for _, id := range []string{"../outside", "", finalID + "/../outside"} {
		if _, err := e.prepareTemporary(&Attempt{ID: id}, false); err == nil {
			t.Fatal("unsafe temp ID")
		}
		if err := e.cleanupTemporary(&Attempt{ID: id}); err == nil {
			t.Fatal("unsafe cleanup ID")
		}
	}
}

func TestTemporaryCleanupNeverFollowsStudentLinks(t *testing.T) {
	e, _ := New(Config{State: t.TempDir()})
	a := &Attempt{ID: finalID}
	p, err := e.prepareTemporary(a, false)
	if err != nil {
		t.Fatal(err)
	}
	outside := t.TempDir()
	sentinel := filepath.Join(outside, "keep")
	os.WriteFile(sentinel, []byte("outside"), 0600)
	os.Symlink(outside, filepath.Join(p.Tmp, "link"))
	os.Symlink("../../../../", filepath.Join(p.VarTmp, "escape"))
	if err := e.cleanupTemporary(a); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(e.Config.State, "temporary", a.ID)); !os.IsNotExist(err) {
		t.Fatal("temp remains", err)
	}
	if b, err := os.ReadFile(sentinel); err != nil || string(b) != "outside" {
		t.Fatal("cleanup followed link", err)
	}
	if err := e.cleanupTemporary(a); err != nil {
		t.Fatal("cleanup not idempotent", err)
	}
}

func TestTemporaryDirectoriesSurviveFailedTerminationThenCleanAfterSecuring(t *testing.T) {
	e, c, _ := finalFixture(t, "ACTIVE", Millis()+5400000)
	a := inspectFinal(t, e)
	p, err := e.prepareTemporary(a, false)
	if err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(p.Tmp, "scratch"), []byte("not a submission"), 0600)
	os.WriteFile(filepath.Join(p.VarTmp, "scratch"), []byte("not a submission"), 0600)
	e.terminate = func(*Attempt) error { return errors.New("termination not confirmed") }
	if _, err := e.Call("finalize-attempt", Request{ID: finalID, Reason: "student finish"}); err == nil {
		t.Fatal("termination failure ignored")
	}
	if _, err := os.Stat(filepath.Join(p.Tmp, "scratch")); err != nil {
		t.Fatal("temp removed before termination", err)
	}
	secured := inspectFinal(t, e)
	checksum := secured.Checksum
	if !secured.Protected || secured.State != "COLLECTION_FAILED" {
		t.Fatal("protected failure lost")
	}
	e.terminate = func(*Attempt) error { return nil }
	if _, err := e.Call("finalize-attempt", Request{ID: finalID, Reason: "retry"}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(p.Tmp); !os.IsNotExist(err) {
		t.Fatal("temp remains after termination", err)
	}
	secured = inspectFinal(t, e)
	m, err := ReadProtected(filepath.Join(c.State, "submissions", finalID), secured)
	if err != nil || secured.Checksum != checksum || len(m.Files) != 1 || m.Files[0].Path != "answer.txt" {
		t.Fatal("temp entered or replaced submission", err)
	}
}

func TestCancelledPracticeTemporaryCleanupAndRetry(t *testing.T) {
	e, _ := New(Config{State: t.TempDir()})
	a := &Attempt{ID: finalID, State: "PREPARING"}
	p, err := e.prepareTemporary(a, true)
	if err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(p.Tmp, "scratch"), []byte("practice"), 0600)
	e.WithState(func() error { e.state.Attempts[a.ID] = a; return nil })
	if _, err := e.Call("cancel-attempt", Request{ID: a.ID}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(p.Tmp); !os.IsNotExist(err) {
		t.Fatal("cancelled temp remains", err)
	}
	if _, err := e.prepareTemporary(a, true); err != nil {
		t.Fatal(err)
	}
	if err := e.Tick(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(p.Tmp); !os.IsNotExist(err) {
		t.Fatal("restart did not retry cleanup", err)
	}
}

func TestTemporaryMountDestinationsMustBeDirectories(t *testing.T) {
	root := t.TempDir()
	if len(temporaryMountIssues(root)) != 3 {
		t.Fatal("missing mount points not reported")
	}
	os.MkdirAll(filepath.Join(root, "var/tmp"), 0755)
	os.Mkdir(filepath.Join(root, "tmp"), 0755)
	if issues := temporaryMountIssues(root); len(issues) != 0 {
		t.Fatal(issues)
	}
	os.Remove(filepath.Join(root, "var/tmp"))
	os.Symlink("../tmp", filepath.Join(root, "var/tmp"))
	if issues := temporaryMountIssues(root); len(issues) != 1 {
		t.Fatal("symlink mount accepted", issues)
	}
}

func TestBothLaunchModesMountOnlyAttemptTemporaryStorage(t *testing.T) {
	a := &Attempt{ID: finalID, Username: "student", WorkPath: "/work"}
	temp := temporaryPaths{Tmp: "/private/exam/tmp", VarTmp: "/private/exam/var-tmp"}
	args := sandboxWorkloadArgs("exam-test.scope", "student", Account{UID: 1001, GID: 1001, Shell: "/bin/bash"}, "/private/work", a, "pane", false, Config{State: "/private", Rootfs: "/rootfs", Templates: "/templates"}, temp)
	joined := strings.Join(args, "\n")
	for _, want := range []string{"--bind\n/private/exam/tmp\n/tmp", "--bind\n/private/exam/var-tmp\n/var/tmp", "--setenv\nTMPDIR\n/tmp"} {
		if !strings.Contains(joined, want) {
			t.Fatal("sandbox missing private temp", want)
		}
	}
	if strings.Contains(joined, "--tmpfs\n/tmp") {
		t.Fatal("per-pane tmpfs masks attempt temp")
	}
	host := strings.Join(functionalHostArgs("exam-test.service", "student", Account{GID: 1001, Shell: "/bin/bash"}, "/private/work", a, "pane", false, "/templates", temp), "\n")
	if !strings.Contains(host, "--property=BindPaths=/private/work:/work /private/exam/tmp:/tmp /private/exam/var-tmp:/var/tmp") || !strings.Contains(host, "--setenv=TMPDIR=/tmp") {
		t.Fatal("host terminal exposes ordinary temp")
	}
}

func TestTemporaryMountsInRealBubblewrap(t *testing.T) {
	if _, err := exec.LookPath("bwrap"); err != nil {
		t.Skip("bubblewrap unavailable")
	}
	probe := exec.Command("bwrap", "--unshare-user", "--ro-bind", "/", "/", "--", "/bin/true")
	if out, err := probe.CombinedOutput(); err != nil {
		t.Skipf("namespace integration unavailable: %v: %s", err, out)
	}
	e, _ := New(Config{State: t.TempDir()})
	a := &Attempt{ID: finalID}
	p, err := e.prepareTemporary(a, false)
	if err != nil {
		t.Fatal(err)
	}
	run := func(paths temporaryPaths, script string) {
		t.Helper()
		cmd := exec.Command("bwrap", "--unshare-user", "--unshare-pid", "--unshare-net", "--ro-bind", "/", "/", "--bind", paths.Tmp, "/tmp", "--bind", paths.VarTmp, "/var/tmp", "--proc", "/proc", "--dev", "/dev", "--clearenv", "--setenv", "PATH", "/usr/bin:/bin", "--setenv", "TMPDIR", "/tmp", "--", "/bin/sh", "-ec", script)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("temporary mount failed: %v: %s", err, out)
		}
	}
	run(p, `test "$TMPDIR" = /tmp; printf pane-one > /tmp/shared; printf var-data > /var/tmp/shared; touch /tmp/not-var; test ! -e /var/tmp/not-var`)
	run(p, `test "$(cat /tmp/shared)" = pane-one; test "$(cat /var/tmp/shared)" = var-data; printf pane-two >> /tmp/shared`)
	other, err := e.prepareTemporary(&Attempt{ID: "22345678-1234-1234-1234-123456789abc"}, false)
	if err != nil {
		t.Fatal(err)
	}
	run(other, `test ! -e /tmp/shared; test ! -e /var/tmp/shared`)
	practice, err := e.prepareTemporary(a, true)
	if err != nil {
		t.Fatal(err)
	}
	run(practice, `test ! -e /tmp/shared; test ! -e /var/tmp/shared`)
	if b, err := os.ReadFile(filepath.Join(p.Tmp, "shared")); err != nil || string(b) != "pane-onepane-two" {
		t.Fatal("panes did not share temp", err)
	}
}

func TestTemporaryPermissionsSurvivePrivateAgentUmask(t *testing.T) {
	if os.Getenv("EXAM_TEMP_UMASK_CHILD") == "1" {
		syscall.Umask(0077)
		e, _ := New(Config{State: os.Getenv("EXAM_TEMP_STATE")})
		p, err := e.prepareTemporary(&Attempt{ID: finalID}, false)
		if err != nil {
			t.Fatal(err)
		}
		for _, path := range []string{p.Tmp, p.VarTmp} {
			info, err := os.Stat(path)
			if err != nil || info.Mode().Perm() != 0777 || info.Mode()&os.ModeSticky == 0 {
				t.Fatal("umask made temp unusable", info, err)
			}
		}
		return
	}
	cmd := exec.Command(os.Args[0], "-test.run=^TestTemporaryPermissionsSurvivePrivateAgentUmask$")
	cmd.Env = append(os.Environ(), "EXAM_TEMP_UMASK_CHILD=1", "EXAM_TEMP_STATE="+t.TempDir())
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("%v: %s", err, out)
	}
}

func TestPrivateTemporaryMountsWritableByUnprivilegedStudent(t *testing.T) {
	if os.Geteuid() != 0 {
		t.Skip("root namespace test: run the focused native test binary as root")
	}
	if out, err := exec.Command("bwrap", "--unshare-pid", "--unshare-net", "--ro-bind", "/", "/", "--proc", "/proc", "--", "/bin/true").CombinedOutput(); err != nil {
		t.Skipf("root mount namespaces unavailable: %v: %s", err, out)
	}
	e, _ := New(Config{State: t.TempDir()})
	p, err := e.prepareTemporary(&Attempt{ID: finalID}, false)
	if err != nil {
		t.Fatal(err)
	}
	run := func(script string) {
		t.Helper()
		cmd := exec.Command("bwrap", "--unshare-pid", "--unshare-net", "--ro-bind", "/", "/", "--bind", p.Tmp, "/tmp", "--bind", p.VarTmp, "/var/tmp", "--proc", "/proc", "--dev", "/dev", "--clearenv", "--setenv", "PATH", "/usr/bin:/bin", "--setenv", "TMPDIR", "/tmp", "--", "/usr/bin/setpriv", "--reuid=10001", "--regid=10001", "--clear-groups", "--inh-caps=-all", "--ambient-caps=-all", "--bounding-set=-all", "--no-new-privs", "--", "/bin/sh", "-ec", script)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("student temp mount failed: %v: %s", err, out)
		}
	}
	run(`test "$(id -u)" = 10001; test "$TMPDIR" = /tmp; printf editor > /tmp/shared; printf compiler > /var/tmp/shared; mktemp /tmp/editor.XXXXXX; mktemp /var/tmp/compiler.XXXXXX; test ! -e /var/tmp/editor`)
	run(`test "$(cat /tmp/shared)" = editor; test "$(cat /var/tmp/shared)" = compiler; printf second-pane >> /tmp/shared; ! chmod 0700 /tmp 2>/dev/null`)
	for _, path := range []string{p.Tmp, p.VarTmp} {
		info, err := os.Stat(filepath.Join(path, "shared"))
		if err != nil || info.Sys().(*syscall.Stat_t).Uid != 10001 {
			t.Fatal("file not owned by student", info, err)
		}
	}
	if err := e.cleanupTemporary(&Attempt{ID: finalID}); err != nil {
		t.Fatal(err)
	}
}

func TestPrivateTemporaryMountsInSystemdHostLaunch(t *testing.T) {
	if os.Geteuid() != 0 {
		t.Skip("root systemd test: run the focused native test binary as root")
	}
	if _, err := os.Stat("/run/systemd/system"); err != nil {
		t.Skip("systemd service manager unavailable")
	}
	e, _ := New(Config{State: t.TempDir()})
	a := &Attempt{ID: finalID, WorkPath: "/work"}
	p, err := e.prepareTemporary(a, false)
	if err != nil {
		t.Fatal(err)
	}
	// A disposable unprivileged service, with no login startup files or ordinary
	// account/session changes. Only this attempt's temporary bind mounts are writable.
	run := func(script string) {
		t.Helper()
		unit := "exam-temporary-check-" + Token()[:12] + ".service"
		args := functionalHostArgs(unit, "nobody", Account{GID: 65534, Home: "/nonexistent", Shell: "/bin/sh"}, p.Tmp, a, "pane", true, "/unused", p)
		// Keep the normal namespace/UID/env options, replacing only the interactive shell.
		args[len(args)-1] = "-ec"
		args = append(args, script)
		if out, err := exec.Command("systemd-run", args...).CombinedOutput(); err != nil {
			t.Fatalf("private systemd temp launch failed: %v: %s", err, out)
		}
	}
	run(`test "$(id -u)" = 65534; test "$TMPDIR" = /tmp; printf host-pane > /tmp/shared; printf var-data > /var/tmp/shared; mktemp /tmp/editor.XXXXXX; mktemp /var/tmp/compiler.XXXXXX`)
	run(`test "$(cat /tmp/shared)" = host-pane; test "$(cat /var/tmp/shared)" = var-data; printf second >> /tmp/shared`)
	if b, err := os.ReadFile(filepath.Join(p.Tmp, "shared")); err != nil || string(b) != "host-panesecond" {
		t.Fatal("host panes did not share private temp", err)
	}
	if err := e.cleanupTemporary(a); err != nil {
		t.Fatal(err)
	}
}
