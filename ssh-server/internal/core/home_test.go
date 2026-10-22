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

func homeFixture(t *testing.T) (*Engine, *Attempt, string) {
	t.Helper()
	state, home := t.TempDir(), t.TempDir()
	e, err := New(Config{State: state, Accounts: map[string]Account{"student": {UID: os.Getuid(), GID: os.Getgid(), Home: home, Shell: "/bin/bash"}}})
	if err != nil {
		t.Fatal(err)
	}
	return e, &Attempt{ID: finalID, Username: "student", UID: os.Getuid(), State: "PREPARING", WorkPath: "/work"}, home
}
func putConfig(t *testing.T, home, name, text string) {
	t.Helper()
	p := filepath.Join(home, name)
	if err := os.MkdirAll(filepath.Dir(p), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(text), 0600); err != nil {
		t.Fatal(err)
	}
}
func TestHomePreservesConfigurationTreesAndInternalSymlinks(t *testing.T) {
	e, a, home := homeFixture(t)
	for name, text := range map[string]string{".bashrc": "export SHELL_PREFERENCE=yes\n", ".emacs": "(setq exam-test t)", ".emacs.d/init.el": "(setq plugin-test t)", ".emacs.d/elpa/example/example.el": ";; plugin", ".config/nvim/init.lua": "vim.g.exam=true", ".local/share/nvim/site/plugin/example.lua": "-- plugin", "dotfiles/zshrc": "export ZSH_PREFERENCE=yes\n"} {
		putConfig(t, home, name, text)
	}
	os.Symlink(filepath.Join(home, "dotfiles/zshrc"), filepath.Join(home, ".zshrc"))
	putConfig(t, home, "private-document.txt", "do not copy")
	putConfig(t, home, ".ssh/id_ed25519", "do not copy")
	if err := e.prepareHome(a); err != nil {
		t.Fatal(err)
	}
	snapshot := filepath.Join(e.Config.State, "homes", a.ID)
	for _, name := range []string{".bashrc", ".emacs", ".emacs.d/init.el", ".emacs.d/elpa/example/example.el", ".config/nvim/init.lua", ".local/share/nvim/site/plugin/example.lua", ".zshrc"} {
		if data, err := os.ReadFile(filepath.Join(snapshot, name)); err != nil || len(data) == 0 {
			t.Fatal(name, err)
		}
	}
	link, err := os.Readlink(filepath.Join(snapshot, ".zshrc"))
	if err != nil || filepath.IsAbs(link) {
		t.Fatal("home link was not confined/relocated", err)
	}
	for _, name := range []string{"private-document.txt", ".ssh"} {
		if _, err := os.Stat(filepath.Join(snapshot, name)); !os.IsNotExist(err) {
			t.Fatal("unrelated/private home data copied", name)
		}
	}
	putConfig(t, home, ".bashrc", "changed outside snapshot")
	if err = e.prepareHome(a); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(filepath.Join(snapshot, ".bashrc"))
	if !strings.Contains(string(data), "SHELL_PREFERENCE") {
		t.Fatal("panes/restart refreshed configuration")
	}
}
func TestHomeRejectsOutsideLinksAndOmitsSpecialFiles(t *testing.T) {
	for _, kind := range []string{"outside", "metadata", "fifo", "hardlink", "oversize"} {
		t.Run(kind, func(t *testing.T) {
			e, a, home := homeFixture(t)
			outside := filepath.Join(t.TempDir(), "secret")
			os.WriteFile(outside, []byte("sentinel"), 0600)
			switch kind {
			case "outside":
				os.Symlink(outside, filepath.Join(home, ".bashrc"))
			case "metadata":
				os.Symlink(".exam-passwd", filepath.Join(home, ".bashrc"))
			case "fifo":
				os.Mkdir(filepath.Join(home, ".config"), 0700)
				syscall.Mkfifo(filepath.Join(home, ".config", "pipe"), 0600)
			case "hardlink":
				os.Link(outside, filepath.Join(home, ".bashrc"))
			case "oversize":
				f, _ := os.Create(filepath.Join(home, ".bashrc"))
				f.Truncate(homeFileLimit + 1)
				f.Close()
			}
			err := e.prepareHome(a)
			if kind == "fifo" {
				if err != nil {
					t.Fatal(err)
				}
				if _, err = os.Lstat(filepath.Join(e.Config.State, "homes", a.ID, ".config/pipe")); !os.IsNotExist(err) {
					t.Fatal("FIFO copied")
				}
			} else if err == nil {
				t.Fatal("unsafe home configuration accepted")
			}
			data, _ := os.ReadFile(outside)
			if string(data) != "sentinel" {
				t.Fatal("outside file changed")
			}
		})
	}
}
func TestApplicationStateIsSeededSharedPrivateAndDisposable(t *testing.T) {
	e, a, home := homeFixture(t)
	putConfig(t, home, ".emacs.d/init.el", ";; original init")
	putConfig(t, home, ".config/nvim/init.lua", "-- original config")
	putConfig(t, home, ".local/share/nvim/site/plugin/test.lua", "-- original plugin")
	if err := e.prepareHome(a); err != nil {
		t.Fatal(err)
	}
	prepare := func(practice bool) temporaryPaths {
		p, err := e.prepareTemporary(a, practice)
		if err != nil {
			t.Fatal(err)
		}
		p, err = e.prepareApplication(a, p)
		if err != nil {
			t.Fatal(err)
		}
		return p
	}
	p := prepare(false)
	for _, name := range applicationLeaves {
		info, err := os.Stat(filepath.Join(p.Application, name))
		if err != nil || info.Mode().Perm() != 0700 || info.Sys().(*syscall.Stat_t).Uid != uint32(a.UID) {
			t.Fatal("unsafe application root", name, err)
		}
	}
	if data, err := os.ReadFile(filepath.Join(p.Application, "emacs/init.el")); err != nil || string(data) != ";; original init" {
		t.Fatal("Emacs config not seeded", err)
	}
	if data, err := os.ReadFile(filepath.Join(p.Application, "data/nvim/site/plugin/test.lua")); err != nil || string(data) != "-- original plugin" {
		t.Fatal("editor plugins not seeded", err)
	}
	os.WriteFile(filepath.Join(p.Application, "emacs/init.el"), []byte(";; transient change"), 0600)
	again := prepare(false)
	if again != p {
		t.Fatal("pane changed app state")
	}
	data, _ := os.ReadFile(filepath.Join(again.Application, "emacs/init.el"))
	if string(data) != ";; transient change" {
		t.Fatal("pane overwrote transient state")
	}
	practice := prepare(true)
	data, _ = os.ReadFile(filepath.Join(practice.Application, "emacs/init.el"))
	if string(data) != ";; original init" {
		t.Fatal("practice/exam share state")
	}
	data, _ = os.ReadFile(filepath.Join(home, ".emacs.d/init.el"))
	if string(data) != ";; original init" {
		t.Fatal("real home modified")
	}
	os.Symlink(home, filepath.Join(p.Application, "state", "outside"))
	if err := e.cleanupTemporary(a); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{p.Application, practice.Application, filepath.Join(e.Config.State, "homes", a.ID)} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatal("disposable data retained", path)
		}
	}
	data, _ = os.ReadFile(filepath.Join(home, ".emacs.d/init.el"))
	if string(data) != ";; original init" {
		t.Fatal("cleanup escaped application state")
	}
}
func TestAdministratorSandboxDoesNotPrepareOrRedirectHome(t *testing.T) {
	e, a, home := homeFixture(t)
	account := e.Config.Accounts[a.Username]
	account.SandboxOnly = true
	e.Config.Accounts[a.Username] = account
	a.Exam = SandboxExamID
	a.AdministratorSandbox = true
	putConfig(t, home, ".emacs", ";; administrator config")
	if err := e.prepareHome(a); err != nil {
		t.Fatal(err)
	}
	paths := temporaryPaths{Tmp: "/private/tmp", VarTmp: "/private/var-tmp"}
	got, err := e.prepareApplication(a, paths)
	if err != nil || got != paths {
		t.Fatal("administrator home redirected", err)
	}
	if _, err = os.Stat(filepath.Join(e.Config.State, "homes")); !os.IsNotExist(err) {
		t.Fatal("administrator home snapshot created")
	}
	a.Settings.Template = "v1"
	args := strings.Join(functionalHostArgs("exam-test.service", a.Username, account, "/work", a, "pane", false, Config{Templates: "/materials"}, paths), "\n")
	if strings.Contains(args, "XDG_") || strings.Contains(args, "/run/exam") || !strings.Contains(args, "--setenv=HOME="+home) {
		t.Fatal("administrator environment restricted")
	}
}

func TestReadOnlyHomeAndEditorsInRealNamespace(t *testing.T) {
	if _, err := exec.LookPath("bwrap"); err != nil {
		t.Skip("bubblewrap unavailable")
	}
	if out, err := exec.Command("bwrap", "--unshare-user", "--unshare-pid", "--unshare-net", "--ro-bind", "/", "/", "--", "/bin/true").CombinedOutput(); err != nil {
		t.Skipf("user namespaces unavailable: %s", out)
	}
	e, a, home := homeFixture(t)
	e.Config.Rootfs = "/"
	a.WorkPath = "/mnt"
	e.Config.Templates = t.TempDir()
	putConfig(t, home, ".bash_profile", "export HOME_CONFIG_LOADED=yes\n")
	putConfig(t, home, ".emacs", "(setq exam-config-preserved t)\n")
	putConfig(t, home, ".config/nvim/init.lua", "-- nvim configuration\n")
	if err := e.prepareHome(a); err != nil {
		t.Fatal(err)
	}
	paths, err := e.prepareTemporary(a, false)
	if err != nil {
		t.Fatal(err)
	}
	paths, err = e.prepareApplication(a, paths)
	if err != nil {
		t.Fatal(err)
	}
	account, _ := e.account(a.Username)
	work := t.TempDir()
	args := sandboxWorkloadArgs("test.scope", a.Username, account, work, a, "pane", true, e.Config, paths)
	start, end := -1, -1
	for i, v := range args {
		if v == "/usr/bin/bwrap" {
			start = i + 1
		}
		if v == "/usr/bin/setpriv" {
			end = i - 1
			break
		}
	}
	if start < 0 || end < start {
		t.Fatal("missing sandbox boundary")
	}
	command := []string{"--unshare-user"}
	command = append(command, args[start:end]...)
	script := `set -eu
 test "$HOME_CONFIG_LOADED" = yes
 test "$(getent passwd "$(id -u)" | cut -d: -f6)" = "$HOME"
 if echo private-copy > "$HOME/exam-copy" 2>/dev/null; then exit 41; fi
 if echo changed >> "$HOME/.bash_profile" 2>/dev/null; then exit 42; fi
 test -d "$XDG_CONFIG_HOME/nvim"
 test -w "$XDG_CACHE_HOME" && test -w "$XDG_DATA_HOME" && test -w "$XDG_STATE_HOME" && test -w "$XDG_RUNTIME_DIR"
 echo transient > "$XDG_STATE_HOME/state-marker"
 echo submission > /mnt/answer.txt
 if test -x /usr/bin/emacs; then
   /usr/local/bin/emacs --fg-daemon=exam-state-test --eval '(progn (unless (bound-and-true-p exam-config-preserved) (kill-emacs 51)) (unless (string-prefix-p (getenv "XDG_STATE_HOME") custom-file) (kill-emacs 52)) (write-region "disposable" nil custom-file nil (quote silent)) (kill-emacs 0))'
 fi
 if test -x /usr/bin/vim; then
   /usr/local/bin/vim -es -c 'qall!'
 fi
 `
	command = append(command, "--", "/bin/bash", "-l", "-c", script)
	if out, err := exec.Command("bwrap", command...).CombinedOutput(); err != nil {
		t.Fatalf("real namespace failed: %v\n%s", err, out)
	}
	if data, err := os.ReadFile(filepath.Join(work, "answer.txt")); err != nil || string(data) != "submission\n" {
		t.Fatal("exam work not writable", err)
	}
	if _, err := os.Stat(filepath.Join(home, "exam-copy")); !os.IsNotExist(err) {
		t.Fatal("private copy reached real home")
	}
	if data, err := os.ReadFile(filepath.Join(paths.Application, "state/state-marker")); err != nil || string(data) != "transient\n" {
		t.Fatal("state did not reach disposable storage", err)
	}
}

func TestAdditionalConfigurationPathsAndXDGEmacs(t *testing.T) {
	e, a, home := homeFixture(t)
	e.Config.HomeConfigPaths = []string{"custom-editor"}
	putConfig(t, home, "custom-editor/theme.el", ";; custom")
	putConfig(t, home, ".config/emacs/init.el", ";; XDG init")
	if err := e.prepareHome(a); err != nil {
		t.Fatal(err)
	}
	snapshot := filepath.Join(e.Config.State, "homes", a.ID)
	if _, err := os.Stat(filepath.Join(snapshot, ".emacs.d")); !os.IsNotExist(err) {
		t.Fatal("legacy directory changed XDG Emacs precedence")
	}
	if data, err := os.ReadFile(filepath.Join(snapshot, "custom-editor/theme.el")); err != nil || string(data) != ";; custom" {
		t.Fatal("custom configuration missing", err)
	}
	paths, err := e.prepareTemporary(a, false)
	if err != nil {
		t.Fatal(err)
	}
	paths, err = e.prepareApplication(a, paths)
	if err != nil {
		t.Fatal(err)
	}
	if data, err := os.ReadFile(filepath.Join(paths.Application, "emacs-xdg/init.el")); err != nil || string(data) != ";; XDG init" {
		t.Fatal("XDG Emacs init lost", err)
	}
	for _, name := range []string{"../escape", "/etc/shadow", ".ssh", ".gnupg/key", ".exam-passwd", ".", "custom/../config"} {
		if validPreferencePath(name) {
			t.Fatal("invalid extra path accepted", name)
		}
	}
}
func TestApplicationMountRootsCannotBeSubstituted(t *testing.T) {
	e, a, _ := homeFixture(t)
	if err := e.prepareHome(a); err != nil {
		t.Fatal(err)
	}
	paths, err := e.prepareTemporary(a, false)
	if err != nil {
		t.Fatal(err)
	}
	paths, err = e.prepareApplication(a, paths)
	if err != nil {
		t.Fatal(err)
	}
	outside := t.TempDir()
	os.RemoveAll(filepath.Join(paths.Application, "emacs"))
	os.Symlink(outside, filepath.Join(paths.Application, "emacs"))
	if _, err = e.prepareApplication(a, paths); err == nil {
		t.Fatal("application root symlink accepted")
	}
}

func TestHomeAndApplicationStateRetainedUntilTerminationConfirmed(t *testing.T) {
	e, _, _ := finalFixture(t, "ACTIVE", Millis()+5400000)
	home := t.TempDir()
	putConfig(t, home, ".emacs.d/init.el", ";; persistent original")
	e.Config.Accounts = map[string]Account{"student": {UID: os.Getuid(), GID: os.Getgid(), Home: home, Shell: "/bin/bash"}}
	e.WithState(func() error { e.state.Attempts[finalID].UID = os.Getuid(); return nil })
	a := inspectFinal(t, e)
	if err := e.prepareHome(a); err != nil {
		t.Fatal(err)
	}
	paths, err := e.prepareTemporary(a, false)
	if err != nil {
		t.Fatal(err)
	}
	paths, err = e.prepareApplication(a, paths)
	if err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(paths.Application, "state", "scratch"), []byte("editor state"), 0600)
	e.terminate = func(*Attempt) error { return errors.New("termination unconfirmed") }
	if _, err = e.Call("finalize-attempt", Request{ID: a.ID, Reason: "student finish"}); err == nil {
		t.Fatal("termination failure hidden")
	}
	snapshot := filepath.Join(e.Config.State, "homes", a.ID)
	for _, path := range []string{snapshot, paths.Application} {
		if _, err = os.Stat(path); err != nil {
			t.Fatal("state deleted before termination", err)
		}
	}
	checksum := inspectFinal(t, e).Checksum
	e.terminate = func(*Attempt) error { return nil }
	if _, err = e.Call("finalize-attempt", Request{ID: a.ID, Reason: "retry"}); err != nil {
		t.Fatal(err)
	}
	secured := inspectFinal(t, e)
	if secured.Checksum != checksum {
		t.Fatal("retry changed submission")
	}
	manifest, err := ReadProtected(filepath.Join(e.Config.State, "submissions", a.ID), secured)
	if err != nil || len(manifest.Files) != 1 || manifest.Files[0].Path != "answer.txt" {
		t.Fatal("application state entered submission", err)
	}
	for _, path := range []string{snapshot, paths.Application} {
		if _, err = os.Stat(path); !os.IsNotExist(err) {
			t.Fatal("disposable state retained", path)
		}
	}
	data, _ := os.ReadFile(filepath.Join(home, ".emacs.d/init.el"))
	if string(data) != ";; persistent original" {
		t.Fatal("real home changed during cleanup")
	}
}
