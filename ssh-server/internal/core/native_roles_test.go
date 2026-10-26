package core

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

func TestLiveNativeRoleProbeAuthenticatesCurrentPeerAndFreshReply(t *testing.T) {
	exe, err := os.Stat("/proc/self/exe")
	if err != nil {
		t.Fatal(err)
	}
	group, err := os.ReadFile("/proc/self/cgroup")
	if err != nil {
		t.Fatal(err)
	}
	hash := strings.Repeat("a", 64)
	for _, mode := range []string{"current", "nonce", "purpose", "role", "boot", "config", "extra", "duplicate", "oversized", "malformed", "no-reply", "wrong-uid", "wrong-executable", "wrong-group"} {
		t.Run(mode, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "role.sock")
			listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: path, Net: "unix"})
			if err != nil {
				t.Fatal(err)
			}
			defer listener.Close()
			if err := listener.SetDeadline(time.Now().Add(time.Second)); err != nil {
				t.Fatal(err)
			}
			done := make(chan error, 1)
			stage := make(chan bool, 1)
			go func() {
				c, err := listener.AcceptUnix()
				if err != nil {
					done <- err
					return
				}
				defer c.Close()
				_ = c.SetDeadline(time.Now().Add(400 * time.Millisecond))
				data, err := bufio.NewReaderSize(c, 4097).ReadSlice('\n')
				if mode == "wrong-uid" || mode == "wrong-executable" || mode == "wrong-group" {
					stage <- len(data) == 0 && err != nil
					done <- nil
					return
				}
				var request struct {
					Nonce string `json:"native_role_nonce"`
				}
				if err != nil || json.Unmarshal(data, &request) != nil || !monitoringDigest.MatchString(request.Nonce) {
					done <- errors.New("fixture missed full fresh request")
					return
				}
				stage <- true
				reply := nativeRoleReply{nativeRolePurpose, "watchdog", request.Nonce, boot(), hash, terminalAuthorityReadiness() == nil}
				switch mode {
				case "nonce":
					reply.Nonce = Token()
				case "purpose":
					reply.Purpose = "old-native-role/v0"
				case "role":
					reply.Role = "agent"
				case "boot":
					reply.Boot = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
				case "config":
					reply.ConfigHash = strings.Repeat("b", 64)
				case "no-reply":
					done <- nil
					return
				}
				body, _ := json.Marshal(reply)
				switch mode {
				case "extra":
					body = append(body[:len(body)-1], []byte(",\"other\":true}")...)
				case "duplicate":
					body = append(body[:len(body)-1], []byte(",\"role\":\"watchdog\"}")...)
				case "oversized":
					body = []byte(strings.Repeat("x", 4097))
				case "malformed":
					body = []byte("{not-json}")
				}
				_, err = c.Write(body)
				done <- err
			}()
			expected, uid, scope := exe, os.Getuid(), string(group)
			if mode == "wrong-uid" {
				uid++
			}
			if mode == "wrong-executable" {
				expected, err = os.Stat("/bin/sh")
				if err != nil {
					t.Fatal(err)
				}
			}
			if mode == "wrong-group" {
				scope = "0::/unrelated.scope\n"
			}
			ctx, cancel := context.WithTimeout(context.Background(), 600*time.Millisecond)
			defer cancel()
			guard, err := probeNativeRole(ctx, path, "watchdog", scope, hash, expected, uid)
			if mode == "current" {
				if err != nil || guard == nil || !guard.current() {
					t.Fatal("matching live peer did not authenticate", err)
				}
				guard.close()
				if guard.current() {
					t.Fatal("closed live observation became current")
				}
			} else if err == nil || guard != nil || ctx.Err() != nil {
				t.Fatal("wrong/absent proof was not refused at the protocol boundary", err, ctx.Err())
			}
			select {
			case err := <-done:
				if err != nil {
					t.Fatal(err)
				}
			case <-time.After(time.Second):
				t.Fatal("owned responder did not finish")
			}
			select {
			case observed := <-stage:
				if !observed {
					t.Fatal("refusal missed intended request boundary")
				}
			case <-time.After(time.Second):
				t.Fatal("fixture never observed request/refusal stage")
			}
		})
	}
}

func TestNativeRoleFingerprintUsesLoadedConfigurationAndNoPersistedPermission(t *testing.T) {
	c := Config{State: "/private/state", Socket: "/private/runtime/agent.sock", Accounts: map[string]Account{"first": {UID: 20001}, "second": {UID: 20002}}}
	one, err := nativeConfigurationHash(c)
	if err != nil {
		t.Fatal(err)
	}
	c.Accounts = map[string]Account{"second": {UID: 20002}, "first": {UID: 20001}}
	two, err := nativeConfigurationHash(c)
	if err != nil || one != two {
		t.Fatal("map insertion order changed configuration identity", err)
	}
	c.Socket = "/private/runtime/different.sock"
	changed, err := nativeConfigurationHash(c)
	if err != nil || changed == one {
		t.Fatal("different loaded configuration matched", err)
	}
	if (*nativeRoleGuard)(nil).current() {
		t.Fatal("absent role observation became live")
	}
	e := &Engine{Config: c}
	v := e.observeNativeRoles()
	if !v.ObservationOnly || v.Complete || v.RetainedEnabled || len(v.Issues) == 0 || len(v.Roles) != 0 {
		t.Fatal("unavailable roles claimed readiness/permission", v)
	}
}

func TestNativeRoleLifetimeChild(t *testing.T) {
	if os.Getenv("EXAM_NATIVE_ROLE_LIFETIME_CHILD") != "1" {
		t.Skip("owned process lifetime helper only")
	}
	fmt.Fprintln(os.Stdout, "ready")
	_, _ = io.Copy(io.Discard, os.Stdin)
	os.Exit(0)
}

func testNativeRoleLifetime(t *testing.T) (*monitoringProcessGuard, func()) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestNativeRoleLifetimeChild$")
	command.Env = append(os.Environ(), "EXAM_NATIVE_ROLE_LIFETIME_CHILD=1", "GORACE=atexit_sleep_ms=0", "GOMAXPROCS=2")
	stdin, err := command.StdinPipe()
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	if err := command.Start(); err != nil {
		cancel()
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- command.Wait() }()
	var once sync.Once
	stop := func() {
		once.Do(func() {
			_ = command.Process.Kill()
			stdin.Close()
			cancel()
			select {
			case <-done:
			case <-time.After(2 * time.Second):
				t.Error("owned role process did not exit")
			}
		})
	}
	t.Cleanup(stop)
	_ = stdout.(*os.File).SetReadDeadline(time.Now().Add(2 * time.Second))
	line, err := bufio.NewReaderSize(stdout, 128).ReadString('\n')
	if err != nil || line != "ready\n" {
		t.Fatal("owned role fixture did not reach ready", err, line)
	}
	identity, err := snapshotMonitoringProcess(command.Process.Pid)
	if err != nil {
		t.Fatal(err)
	}
	guard, err := pinMonitoringProcess(identity)
	if err != nil || !guard.current() {
		t.Fatal("owned role lifetime not pinned", err)
	}
	t.Cleanup(guard.close)
	return guard, func() {
		stop()
		if guard.current() {
			t.Error("positive owned role exit did not invalidate admission guard")
		}
	}
}

func TestNativeRoleRootObserverActualEndpointAndMetadataLoss(t *testing.T) {
	if os.Getenv("EXAM_MANAGEMENT_USERNS") != "1" {
		t.Skip("requires explicitly isolated root user/mount namespace")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, "/usr/bin/unshare", "--user", "--map-root-user", "--mount", os.Args[0], "-test.run=^TestNativeRoleRootObserverChild$", "-test.v")
	command.Env = append(os.Environ(), "EXAM_NATIVE_ROLE_ROOT_CHILD="+t.TempDir())
	output, err := command.CombinedOutput()
	if err != nil || ctx.Err() != nil || !strings.Contains(string(output), "NATIVE_ROLE_ROOT_OBSERVER_OK") {
		t.Fatal("actual isolated root endpoint/metadata-loss regression failed", err, ctx.Err(), string(output))
	}
}

func TestNativeRoleRootObserverChild(t *testing.T) {
	dir := os.Getenv("EXAM_NATIVE_ROLE_ROOT_CHILD")
	if dir == "" {
		t.Skip("isolated owned root fixture only")
	}
	if os.Getuid() != 0 || os.Geteuid() != 0 {
		t.Fatal("root namespace fixture unavailable")
	}
	state := filepath.Join(dir, "state")
	if err := os.Mkdir(state, 0700); err != nil {
		t.Fatal(err)
	}
	e := &Engine{Config: Config{State: state}}
	closeObserver, err := e.startWatchdogRoleObserver()
	if err != nil {
		t.Fatal(err)
	}
	defer closeObserver()
	path := filepath.Join(state, nativeWatchdogSocket)
	socket, err := os.Lstat(path)
	if err != nil || socket.Mode()&os.ModeSocket == 0 || socket.Mode().Perm() != 0600 {
		t.Fatal("observer socket is not private", err)
	}
	lock := filepath.Join(state, "watchdog-role.lock")
	info, err := os.Lstat(lock)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || info.Size() != 0 {
		t.Fatal("observer lifetime lock is not private/empty", err)
	}
	check := func() {
		t.Helper()
		exe, err := os.Stat("/proc/self/exe")
		if err != nil {
			t.Fatal(err)
		}
		group, err := os.ReadFile("/proc/self/cgroup")
		if err != nil {
			t.Fatal(err)
		}
		hash, err := nativeConfigurationHash(e.Config)
		if err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		guard, err := probeNativeRole(ctx, path, "watchdog", string(group), hash, exe, 0)
		if err != nil || guard == nil || !guard.current() {
			t.Fatal("actual root producer missed the exact fresh authenticated reply", err)
		}
		guard.close()
	}
	check()
	if other, err := e.startWatchdogRoleObserver(); err == nil || other != nil {
		t.Fatal("duplicate observer stole the lifetime lock")
	}
	if err := os.Remove(lock); err != nil {
		t.Fatal(err)
	} // Only this owned synthetic metadata-loss fault.
	if other, err := e.startWatchdogRoleObserver(); err == nil || other != nil {
		t.Fatal("lost lock inode allowed replacement of a positively live endpoint")
	}
	after, err := os.Lstat(path)
	if err != nil || !os.SameFile(socket, after) {
		t.Fatal("metadata-loss refusal removed the live socket", err)
	}
	check()
	closeObserver()
	if _, err := os.Lstat(path); !os.IsNotExist(err) {
		t.Fatal("owned endpoint did not retire exactly", err)
	}
	for _, mode := range []string{"nonempty", "hardlink", "symlink", "fifo", "permissions"} {
		if err := os.Remove(lock); err != nil && !os.IsNotExist(err) {
			t.Fatal(err)
		}
		target := filepath.Join(state, "fixture-"+mode)
		switch mode {
		case "nonempty":
			err = os.WriteFile(lock, []byte("preserve"), 0600)
		case "hardlink":
			err = os.WriteFile(target, nil, 0600)
			if err == nil {
				err = os.Link(target, lock)
			}
		case "symlink":
			err = os.WriteFile(target, []byte("preserve"), 0600)
			if err == nil {
				err = os.Symlink(target, lock)
			}
		case "fifo":
			err = unix.Mkfifo(lock, 0600)
		case "permissions":
			err = os.WriteFile(lock, nil, 0600)
			if err == nil {
				err = os.Chmod(lock, 0644)
			}
		}
		if err != nil {
			t.Fatal(err)
		}
		before, err := os.Lstat(lock)
		if err != nil {
			t.Fatal(err)
		}
		if other, err := e.startWatchdogRoleObserver(); err == nil || other != nil {
			t.Fatal("unsafe observer lock accepted", mode)
		}
		after, err := os.Lstat(lock)
		if err != nil || !os.SameFile(before, after) || before.Mode() != after.Mode() || before.Size() != after.Size() {
			t.Fatal("refusal repaired/changed unsafe metadata", mode, err)
		}
	}
	t.Log("NATIVE_ROLE_ROOT_OBSERVER_OK")
}
