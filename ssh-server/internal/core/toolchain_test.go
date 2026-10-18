package core

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Opt in on an installed class server. Uses the real launcher and an otherwise
// unused UID, without enrolling or changing any real student's account.
func TestInstalledStudentToolchain(t *testing.T) {
	root := os.Getenv("EXAM_TOOLCHAIN_ROOTFS")
	if root == "" {
		t.Skip("set EXAM_TOOLCHAIN_ROOTFS to test the installed student filesystem")
	}
	if os.Geteuid() != 0 {
		t.Fatal("installed namespace qualification requires root")
	}
	const uid = 29999
	if exec.Command("getent", "passwd", fmt.Sprint(uid)).Run() == nil {
		t.Fatal("qualification UID is already assigned")
	}
	state, home, work := t.TempDir(), t.TempDir(), t.TempDir()
	if root == "/" {
		var err error
		state, err = os.MkdirTemp("/var/lib/exam-agent", ".toolchain-qualification-")
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { os.RemoveAll(state) })
	}
	account := Account{UID: uid, GID: uid, Home: home, Shell: "/bin/bash"}
	config := Config{Rootfs: root, State: state, Accounts: map[string]Account{"toolchaincheck": account}}
	if root == "/" {
		filename := os.Getenv("EXAM_TOOLCHAIN_CONFIG")
		if filename == "" {
			filename = "/etc/exam-agent/agent.json"
		}
		raw, err := os.ReadFile(filename)
		if err != nil {
			t.Fatal(err)
		}
		var installed Config
		if err = json.Unmarshal(raw, &installed); err != nil {
			t.Fatal(err)
		}
		config.HostFilesystem = true
		config.HostFilesystemHiddenPaths = append(installed.HostFilesystemHiddenPaths, installed.State, installed.Work, installed.Templates)
	}
	e, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	if root == "/" {
		if issues := hostFilesystemIssues(e.Config); len(issues) != 0 {
			t.Fatal(issues)
		}
	}
	a := &Attempt{ID: "12345678-1234-4234-9234-123456789abc", Username: "toolchaincheck", UID: uid, State: "PREPARING", WorkPath: "/work"}
	putConfig(t, home, ".bash_profile", "export EXAM_TEST_PROFILE=yes\n")
	if err := os.Chown(filepath.Join(home, ".bash_profile"), uid, uid); err != nil {
		t.Fatal(err)
	}
	if err := os.Chown(home, uid, uid); err != nil {
		t.Fatal(err)
	}
	if root == "/" {
		if err := os.WriteFile(filepath.Join(home, "ordinary-home-file"), []byte("home-readable\n"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	if err := e.prepareHome(a); err != nil {
		t.Fatal(err)
	}
	paths, err := e.prepareTemporary(a, true)
	if err != nil {
		t.Fatal(err)
	}
	paths, err = e.prepareApplication(a, paths)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chown(work, uid, uid); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(work, 0700); err != nil {
		t.Fatal(err)
	}
	unit := fmt.Sprintf("exam-toolchain-check-%d.scope", os.Getpid())
	defer exec.Command("systemctl", "stop", unit).Run()
	args := sandboxWorkloadArgs(unit, a.Username, account, work, a, "check", true, e.Config, paths)
	script := `set -eu
 test "$(id -u)" = 29999
 test "$EXAM_TEST_PROFILE" = yes
 test "$(id -un)" = toolchaincheck
 for tool in gcc g++ gdb python python3 make emacs vim javac; do command -v "$tool"; done
 printf '#include <stdio.h>\nint main(void) { puts("toolchain-ok"); return 0; }\n' > hello.c
 gcc -g -O0 hello.c -o hello
 test "$(./hello)" = toolchain-ok
 gdb --batch -ex 'break main' -ex run -ex bt ./hello > gdb.txt 2>&1
 grep -q 'Breakpoint 1, main' gdb.txt
 printf '#include <iostream>\nint main() { std::cout << "c++-ok"; }\n' > hello.cc
 g++ hello.cc -o hello-cpp
 test "$(./hello-cpp)" = c++-ok
 python -c 'import ctypes, ssl, sqlite3; print("python-ok")'
 python3 -c 'import ctypes, ssl, sqlite3; print("python3-ok")'
 printf 'public class Hello { public static void main(String[] a) { System.out.println("java-ok"); }}\n' > Hello.java
 javac Hello.java
 test "$(java Hello)" = java-ok
 emacs --batch --quick --eval '(princ "emacs-ok\n")'
 vim -Nu NONE -n -es -c 'qall!'
 test ! -e /etc/exam-agent/agent.json
 test ! -e /var/lib/exam-agent/state.json
 test ! -S /run/systemd/private
 test ! -S /run/dbus/system_bus_socket
 test ! -S /var/lib/sss/pipes/nss
 test ! -S /var/opt/azcmagent/socks/himds.sock
 if touch /usr/bin/exam-should-not-write 2>/dev/null; then exit 40; fi
 if touch "$HOME/exam-should-not-write" 2>/dev/null; then exit 41; fi
 touch /tmp/toolchain-check /var/tmp/toolchain-check "$XDG_STATE_HOME/toolchain-check"
 for capability in CapInh CapPrm CapEff CapBnd CapAmb; do grep -Eq "^$capability:[[:space:]]+0+$" /proc/self/status; done
 grep -Eq '^NoNewPrivs:[[:space:]]+1$' /proc/self/status
 # Compare every world-executable public command against the host inventory.
 while IFS= read -r path; do test -x "$path" || { echo "Missing executable: $path"; exit 42; }; done < executable-inventory.txt
 echo STUDENT_TOOLCHAIN_VERIFIED
 `
	// Inventory regular command entries, resolving alternatives on the host. Do
	// not enumerate administrator-only paths or claim privileged tools can run.
	var inventory strings.Builder
	for _, directory := range []string{"/usr/bin", "/usr/sbin", "/usr/local/bin", "/usr/local/sbin", "/usr/games", "/usr/local/games"} {
		entries, err := os.ReadDir(directory)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			t.Fatal(err)
		}
		for _, entry := range entries {
			path := filepath.Join(directory, entry.Name())
			info, err := os.Stat(path)
			if err == nil && info.Mode().IsRegular() && info.Mode().Perm()&0001 != 0 {
				fmt.Fprintln(&inventory, path)
			}
		}
	}
	if err := os.WriteFile(filepath.Join(work, "executable-inventory.txt"), []byte(inventory.String()), 0644); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, "systemd-run", args...)
	if root == "/" {
		script += "test \"$(cat \"$HOME/ordinary-home-file\")\" = home-readable\n"
	}
	command.Stdin = strings.NewReader(script)
	out, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("student toolchain failed: %v\n%s", err, out)
	}
	if !strings.Contains(string(out), "STUDENT_TOOLCHAIN_VERIFIED") {
		t.Fatalf("qualification did not complete: %s", out)
	}
	t.Logf("Verified %d installed commands as UID %d\n%s", strings.Count(inventory.String(), "\n"), uid, out)
}
