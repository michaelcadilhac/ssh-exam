package core

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

// The production entry has additional real-root/exact exam.slice guards. This
// child uses the same closed IPC but an unprivileged synthetic post-permit exec;
// it is never present in an installed executable or enabled by configuration.
func TestPaneBootstrapChild(t *testing.T) {
	i := -1
	for n, arg := range os.Args {
		if arg == "--pane-bootstrap-test" {
			i = n
			break
		}
	}
	if i < 0 {
		return
	}
	if len(os.Args) != i+5 {
		os.Exit(70)
	}
	mode, unit := os.Args[i+1], os.Args[i+2]
	expires, e1 := strconv.ParseInt(os.Args[i+3], 10, 64)
	bootUntil, e2 := strconv.ParseInt(os.Args[i+4], 10, 64)
	if e1 != nil || e2 != nil {
		os.Exit(71)
	}
	file := os.NewFile(3, "test-inherited-bootstrap")
	conn, err := net.FileConn(file)
	file.Close()
	// Prove FD4 really survived systemd-run and named the loaded executable.
	pinned := os.NewFile(4, "test-pinned-self")
	exe, statErr := pinned.Stat()
	actual, actualErr := os.Stat("/proc/self/exe")
	pinned.Close()
	if err != nil || statErr != nil || actualErr != nil || !os.SameFile(exe, actual) {
		os.Exit(72)
	}
	control := conn.(*net.UnixConn)
	if mode == "bad-ready" {
		_, _ = control.Write([]byte{2})
		os.Exit(73)
	}
	if runPaneBootstrap(control, unit, expires, bootUntil, []string{"/usr/bin/bwrap", "--synthetic-test"}) != nil {
		os.Exit(74)
	}
	control.Close()
	for _, fd := range []uintptr{3, 4} {
		if _, err := unix.FcntlInt(fd, unix.F_GETFD, 0); !errors.Is(err, unix.EBADF) {
			os.Exit(77)
		}
	}
	if mode == "pane" {
		// Real synthetic shell output traverses the actual gate's PTY bridge.
		if syscall.Exec("/bin/sh", []string{"sh", "-c", "printf 'SYNTHETIC-CLOSED-PANE-EXEC\\n'; read -r line; test \"$line\" = finish"}, []string{"PATH=/usr/bin:/bin"}) != nil {
			os.Exit(75)
		}
	}
	if syscall.Exec("/bin/sh", []string{"sh", "-c", "printf EXECUTED"}, []string{"PATH=/usr/bin:/bin"}) != nil {
		os.Exit(76)
	}
}

func TestPaneBootstrapInheritedIPCPermitsOnlyExactLiveRelease(t *testing.T) {
	for _, mode := range []string{"permit", "eof", "wrong", "oversized", "missing-eof", "expired", "bad-ready", "foreign-exe", "foreign-scope", "foreign-uid"} {
		t.Run(mode, func(t *testing.T) {
			control, child, err := paneBootstrapSocket()
			if err != nil {
				t.Fatal(err)
			}
			defer control.Close()
			defer child.Close()
			exe, err := paneBootstrapExecutable()
			if err != nil {
				t.Fatal(err)
			}
			defer exe.Close()
			unit := "exam-" + ManagementID() + "-" + ManagementID() + "-" + ManagementID() + ".scope"
			now, err := monitoringBootMillis()
			if err != nil {
				t.Fatal(err)
			}
			expires, until := Millis()+800, now+800
			childMode := "direct"
			if mode == "bad-ready" {
				childMode = mode
			}
			cmd := exec.Command("/proc/self/fd/4", "-test.run=^TestPaneBootstrapChild$", "--", "--pane-bootstrap-test", childMode, unit, strconv.FormatInt(expires, 10), strconv.FormatInt(until, 10))
			cmd.ExtraFiles = []*os.File{child, exe}
			cmd.Env = append(os.Environ(), "GORACE=atexit_sleep_ms=0", "GOMAXPROCS=2")
			var out, diagnostics bytes.Buffer
			cmd.Stdout, cmd.Stderr = &out, &diagnostics
			if err := cmd.Start(); err != nil {
				t.Fatal(err)
			}
			child.Close()
			defer func() { _ = cmd.Process.Kill(); _ = cmd.Wait() }()
			group, err := os.ReadFile("/proc/self/cgroup")
			if err != nil {
				t.Fatal(err)
			}
			uid := os.Getuid()
			if mode == "foreign-scope" {
				group = []byte("0::/not-this-scope\n")
			}
			if mode == "foreign-uid" {
				uid++
			}
			verifyExe := exe
			if mode == "foreign-exe" {
				verifyExe, err = os.Open("/bin/sh")
				if err != nil {
					t.Fatal(err)
				}
				defer verifyExe.Close()
			}
			peer, err := awaitPaneBootstrapIdentity(control, verifyExe, string(group), uid, expires, until)
			expectReady := mode != "bad-ready" && !strings.HasPrefix(mode, "foreign-")
			if (err == nil) != expectReady {
				t.Fatal("wrong kernel/IPC readiness result", mode, err)
			}
			if peer != nil {
				defer peer.process.close()
				if !peer.current() {
					t.Fatal("actual ready child not live")
				}
			}
			switch mode {
			case "permit":
				_, err = control.Write([]byte{1})
				control.Close()
			case "wrong":
				_, err = control.Write([]byte{0})
				control.Close()
			case "oversized":
				_, err = control.Write([]byte{1, 1, 1})
				control.Close()
			case "missing-eof":
				_, err = control.Write([]byte{1})
			case "expired":
				time.Sleep(850 * time.Millisecond)
				control.Close()
			default:
				control.Close()
			}
			if err != nil && expectReady && mode != "expired" {
				t.Fatal(err)
			}
			waitErr := cmd.Wait()
			if mode == "permit" {
				if waitErr != nil || out.String() != "EXECUTED" {
					t.Fatal("exact release did not exec", waitErr, out.String(), diagnostics.String())
				}
			} else if waitErr == nil || out.Len() != 0 {
				t.Fatal("refused bootstrap executed", mode, waitErr, out.String())
			}
			if peer != nil && peer.current() {
				t.Fatal("exited child retained current identity")
			}
		})
	}
}

func ownedPaneBootstrapStart(t *testing.T, launch *exec.Cmd, control *net.UnixConn, exe *os.File, unit string, proof PaneInstance) (*paneBootstrapPeer, bool, error) {
	t.Helper()
	// Preserve the real inherited descriptors and pinned executable. Only the
	// privilege/cgroup namespace and final synthetic command differ from root.
	args := []string{launch.Path, "--user"}
	for _, arg := range launch.Args[1:] {
		if arg == "/proc/self/fd/4" {
			args = append(args, "/proc/self/fd/4", "-test.run=^TestPaneBootstrapChild$", "--", "--pane-bootstrap-test", "pane", unit, strconv.FormatInt(proof.ClosedUntil, 10), strconv.FormatInt(proof.ClosedBootUntil, 10))
			break
		}
		if arg == "--property=MemoryMax=1G" {
			arg = "--property=MemoryMax=64M"
		}
		if strings.HasPrefix(arg, "--slice=") {
			continue
		}
		args = append(args, arg)
	}
	launch.Args, launch.SysProcAttr = args, nil
	launch.Env = append(os.Environ(), "GORACE=atexit_sleep_ms=0", "GOMAXPROCS=2", "GOMEMLIMIT=48MiB")
	if err := launch.Start(); err != nil {
		return nil, false, err
	}
	launch.ExtraFiles[0].Close()
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = exec.CommandContext(ctx, "/usr/bin/systemctl", "--user", "stop", unit).Run()
		_ = exec.CommandContext(ctx, "/usr/bin/systemctl", "--user", "reset-failed", unit).Run()
	})
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	var group string
	for ctx.Err() == nil {
		data, err := exec.CommandContext(ctx, "/usr/bin/systemctl", "--user", "show", unit, "--property=ControlGroup", "--value").Output()
		group = strings.TrimSpace(string(data))
		if err == nil && strings.HasPrefix(group, "/") && strings.HasSuffix(group, "/"+unit) {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if group == "" || ctx.Err() != nil {
		return nil, true, errors.New("owned bootstrap scope unavailable")
	}
	returnPeer, err := awaitPaneBootstrapIdentity(control, exe, "0::"+group+"\n", os.Getuid(), proof.ClosedUntil, proof.ClosedBootUntil)
	return returnPeer, true, err
}

func TestPaneBootstrapActualUserScopeInheritsPinnedFiles(t *testing.T) {
	if os.Getenv("EXAM_COLLECTION_USER_SYSTEMD") != "1" {
		t.Skip("explicit owned user-systemd scope qualification only")
	}
	control, child, err := paneBootstrapSocket()
	if err != nil {
		t.Fatal(err)
	}
	defer control.Close()
	defer child.Close()
	exe, err := paneBootstrapExecutable()
	if err != nil {
		t.Fatal(err)
	}
	defer exe.Close()
	unit := "exam-" + ManagementID() + "-" + ManagementID() + "-" + ManagementID() + ".scope"
	now, err := monitoringBootMillis()
	if err != nil {
		t.Fatal(err)
	}
	proof := PaneInstance{ClosedUntil: Millis() + 5000, ClosedBootUntil: now + 5000}
	args, err := paneBootstrapArgs([]string{"--scope", "--quiet", "--unit=" + unit, "--property=MemoryMax=1G", "--property=MemorySwapMax=0", "--property=TasksMax=16", "--property=RuntimeMaxSec=8s", "--", "/usr/bin/bwrap", "--synthetic"}, unit, proof.ClosedUntil, proof.ClosedBootUntil)
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("/usr/bin/systemd-run", args...)
	cmd.ExtraFiles = []*os.File{child, exe}
	var out, diagnostics bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &diagnostics
	peer, started, err := ownedPaneBootstrapStart(t, cmd, control, exe, unit, proof)
	if started {
		defer func() { _ = cmd.Process.Kill(); _ = cmd.Wait() }()
	}
	if err != nil {
		t.Fatal("actual scope did not preserve closed inherited handshake", err)
	}
	defer peer.process.close()
	if !peer.current() {
		t.Fatal("trusted Go bootstrap not still parked before release")
	}
	base := "/sys/fs/cgroup" + strings.TrimSuffix(strings.TrimPrefix(peer.group, "0::"), "\n")
	for leaf, want := range map[string]string{"memory.max": "67108864", "memory.swap.max": "0", "pids.max": "16"} {
		data, err := os.ReadFile(base + "/" + leaf)
		if err != nil || strings.TrimSpace(string(data)) != want {
			t.Fatal("actual owned bootstrap resource bound", leaf, string(data), err)
		}
	}
	if _, err := control.Write([]byte{1}); err != nil {
		t.Fatal(err)
	}
	control.Close()
	// This direct protocol check uses a pipe, so let the synthetic read see EOF.
	if err := cmd.Wait(); err == nil {
		t.Fatal("pane mode unexpectedly read finish from closed stdin")
	}
	if !strings.Contains(out.String(), "SYNTHETIC-CLOSED-PANE-EXEC") {
		t.Fatal("post-release synthetic shell did not exec", out.String(), diagnostics.String())
	}
}

func TestPaneBootstrapControllerChild(t *testing.T) {
	if len(os.Args) < 2 || os.Args[len(os.Args)-1] != "--pane-bootstrap-controller-test" {
		return
	}
	control, child, err := paneBootstrapSocket()
	if err != nil {
		os.Exit(80)
	}
	exe, err := paneBootstrapExecutable()
	if err != nil {
		os.Exit(81)
	}
	now, err := monitoringBootMillis()
	if err != nil {
		os.Exit(82)
	}
	expires, until := Millis()+2000, now+2000
	unit := "exam-" + ManagementID() + ".scope"
	cmd := exec.Command("/proc/self/fd/4", "-test.run=^TestPaneBootstrapChild$", "--", "--pane-bootstrap-test", "direct", unit, strconv.FormatInt(expires, 10), strconv.FormatInt(until, 10))
	cmd.ExtraFiles = []*os.File{child, exe}
	cmd.Env = append(os.Environ(), "GORACE=atexit_sleep_ms=0", "GOMAXPROCS=2")
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	if cmd.Start() != nil {
		os.Exit(83)
	}
	child.Close()
	group, err := os.ReadFile("/proc/self/cgroup")
	if err != nil {
		os.Exit(84)
	}
	if _, err := awaitPaneBootstrapIdentity(control, exe, string(group), os.Getuid(), expires, until); err != nil {
		os.Exit(85)
	}
	fmt.Println("CLOSED-CHILD-READY")
	// The outer test SIGKILLs only this exact owned controller. No application
	// close/defer will run; kernel descriptor closure alone must deny child exec.
	time.Sleep(3 * time.Second)
	os.Exit(86)
}

func TestPaneBootstrapActualControllerDeathNeverReleasesChild(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestPaneBootstrapControllerChild$", "--", "--pane-bootstrap-controller-test")
	cmd.Env = append(os.Environ(), "GORACE=atexit_sleep_ms=0", "GOMAXPROCS=2")
	output, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = cmd.Process.Kill(); _ = cmd.Wait() }()
	_ = output.(*os.File).SetReadDeadline(time.Now().Add(4 * time.Second))
	reader := bufio.NewReader(output)
	line, err := reader.ReadString('\n')
	if err != nil || line != "CLOSED-CHILD-READY\n" {
		t.Fatal("controller did not verify actual child before crash", line, err)
	}
	if err := cmd.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	remaining, err := io.ReadAll(reader)
	if err != nil || len(remaining) != 0 {
		t.Fatal("orphan child executed or failed to expire after controller death", string(remaining), err)
	}
	if err := cmd.Wait(); err == nil || ctx.Err() != nil {
		t.Fatal("exact owned controller was not killed within bound", err, ctx.Err())
	}
}
