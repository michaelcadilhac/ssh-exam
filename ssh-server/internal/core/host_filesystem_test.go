package core

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestHostFilesystemRejectsUncoveredSockets(t *testing.T) {
	c := Config{HostFilesystem: true, Rootfs: "/", State: "/var/lib/exam-agent", Work: "/srv/exam-workspace/work", Templates: "/var/lib/exam-agent/templates", HostFilesystemHiddenPaths: []string{"/var/lib/sss/pipes", "/var/opt/azcmagent/socks"}}
	if err := validateHostFilesystem(c); err != nil {
		t.Fatal(err)
	}
	table := `Num RefCount Protocol Flags Type St Inode Path
1: 2 0 10000 1 01 1 /run/dbus/system_bus_socket
8: 2 0 10000 1 01 8 /var/run/systemd/private
2: 2 0 10000 1 01 2 /var/lib/sss/pipes/nss
3: 2 0 10000 1 01 3 /var/opt/azcmagent/socks/himds.sock
4: 2 0 10000 1 01 4 /tmp/tmux-user/default
5: 2 0 10000 1 01 5 @abstract-host-socket
6: 2 0 10000 1 01 6 /unreviewed/service.sock
7: 2 0 10000 1 01 7 /var/lib/sss/pipes-other/escape.sock
`
	uncovered := uncoveredHostSockets(table, hostFilesystemMasks(c))
	if len(uncovered) != 2 || uncovered[0] != "/unreviewed/service.sock" || uncovered[1] != "/var/lib/sss/pipes-other/escape.sock" {
		t.Fatal(uncovered)
	}
	for _, path := range []string{"/", "/usr", "/usr/lib", "/work", "/etc", "/home", "/tmp", "/var/tmp", "/etc/../usr"} {
		c.HostFilesystemHiddenPaths = []string{path}
		if validateHostFilesystem(c) == nil {
			t.Fatal("unsafe exclusion accepted", path)
		}
	}
}

func TestHostFilesystemLaunchUsesHostProgramsAndActualReadOnlyHome(t *testing.T) {
	e, a, home := homeFixture(t)
	e.Config.Rootfs = "/"
	e.Config.HostFilesystem = true
	e.Config.HostFilesystemHiddenPaths = []string{"/var/lib/sss/pipes"}
	// No real namespace is launched here; verify the intended bind sources.
	account, _ := e.account(a.Username)
	args := sandboxWorkloadArgs("test.scope", a.Username, account, "/work-source", a, "pane", true, e.Config, temporaryPaths{Tmp: "/temp-source", VarTmp: "/var-temp-source", Application: "/app-source"})
	joined := strings.Join(args, "\n")
	for _, expected := range []string{"--ro-bind\n/\n/", "--ro-bind\n" + home + "\n/home/student", "--tmpfs\n/run", "--tmpfs\n/sys", "--proc\n/proc", "--dev\n/dev", "--setenv\nXDG_STATE_HOME\n/run/exam-state/state"} {
		if !strings.Contains(joined, expected) {
			t.Fatal("missing isolation/runtime setting", expected)
		}
	}
	if strings.Contains(joined, "--ro-bind\n"+filepath.Join(e.Config.State, "homes", a.ID)+"\n/home/student") {
		t.Fatal("home still limited to copied preferences")
	}
}

func TestLiveHomeRejectsRedirects(t *testing.T) {
	home := t.TempDir()
	account := Account{UID: os.Getuid(), Home: home}
	redirected := filepath.Join(t.TempDir(), "home")
	if err := os.Symlink(home, redirected); err != nil {
		t.Fatal(err)
	}
	account.Home = redirected
	if validateLiveHome(account) == nil {
		t.Fatal("home symlink accepted")
	}
	account.Home = "/"
	if validateLiveHome(account) == nil {
		t.Fatal("root accepted as home")
	}
}

func TestApplicationMountsCannotFollowWritableOverlayLinks(t *testing.T) {
	source := t.TempDir()
	if err := os.MkdirAll(filepath.Join(source, ".local/share/emacs"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(".local/share/emacs", filepath.Join(source, ".emacs.d")); err != nil {
		t.Fatal(err)
	}
	mounts, err := applicationHomeMounts(source, "/home/student", true)
	if err != nil || len(mounts) != 1 || mounts[0].destination != "/home/student/.local/share/emacs" {
		t.Fatal(mounts, err)
	}
	// Legacy mode would overlay .local/share before traversing the Emacs link.
	if _, err := applicationHomeMounts(source, "/home/student", false); err == nil {
		t.Fatal("writable parent overlap accepted")
	}
	os.Remove(filepath.Join(source, ".emacs.d"))
	os.Symlink("/usr/lib", filepath.Join(source, ".emacs.d"))
	if _, err := applicationHomeMounts(source, "/home/student", true); err == nil {
		t.Fatal("software-tree redirection accepted")
	}
}
