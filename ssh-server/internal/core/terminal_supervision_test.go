package core

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

func ownedTerminalGroup(unit string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	for ctx.Err() == nil {
		b, err := exec.CommandContext(ctx, "/usr/bin/systemctl", "--user", "show", unit, "--property=ControlGroup", "--value").Output()
		group := strings.TrimSpace(string(b))
		if err == nil && strings.HasPrefix(group, "/") && strings.HasSuffix(group, "/"+unit) {
			return "0::" + group + "\n", nil
		}
		time.Sleep(10 * time.Millisecond)
	}
	return "", errTerminalSupervisor
}

type terminalTestBuffer struct {
	mu     sync.Mutex
	buffer bytes.Buffer
}

func TestTerminalSupervisorSliceAndMinimalProtocol(t *testing.T) {
	valid := "LoadState=loaded\nFragmentPath=/etc/systemd/system/examterminal.slice\nMemoryAccounting=yes\nTasksAccounting=yes\n"
	if err := validateTerminalSlice(valid); err != nil {
		t.Fatal(err)
	}
	for _, invalid := range []string{strings.Replace(valid, "LoadState=loaded", "LoadState=not-found", 1), strings.Replace(valid, "MemoryAccounting=yes", "MemoryAccounting=no", 1), strings.Replace(valid, "TasksAccounting=yes", "TasksAccounting=no", 1), strings.Replace(valid, "FragmentPath=/etc/systemd/system/examterminal.slice", "FragmentPath=", 1), valid + "LoadState=loaded\n"} {
		if validateTerminalSlice(invalid) == nil {
			t.Fatal("incomplete/ambiguous slice accepted")
		}
	}
	var init terminalSupervisorInit
	if terminalDecode([]byte(`{"attempt":"a","state":"/synthetic"}`), &init) != nil {
		t.Fatal("known minimal initialization rejected")
	}
	if terminalDecode([]byte(`{"attempt":"a","state":"/synthetic","callback_key":"PRIVATE-NOT-AN-IPC-CAPABILITY"}`), &init) == nil {
		t.Fatal("supervisor accepted a signing-key setting")
	}
	for _, invalid := range []string{`{"attempt":"a","attempt":"b"}`, `{} {}`, strings.Repeat(" ", terminalSupervisorBytes+1)} {
		if terminalDecode([]byte(invalid), &init) == nil {
			t.Fatal("ambiguous/oversized initialization accepted")
		}
	}
}

func TestActualTickReapsOnlyGoneReadySupervisedPracticeMetadata(t *testing.T) {
	for _, mode := range []string{"ready-practice", "timed", "closed-start", "legacy", "foreign-owner", "foreign-boot"} {
		t.Run(mode, func(t *testing.T) {
			e, _, r := preparationFixture(t)
			e.preparationReady = func() (bool, []string) { return true, nil }
			if _, err := e.Call("prepare-attempt", r); err != nil {
				t.Fatal(err)
			}
			unit := "exam-" + r.ID + "-" + finalID + "-" + ManagementID() + ".scope"
			proof := PaneInstance{Attempt: r.ID, Pane: finalID, Boot: boot(), ReadyAt: Millis(), Supervisor: terminalSupervisorUnit(e.Config.State, r.ID)}
			_, _, proof.ID, _ = recordedPaneIdentity(r.ID, unit)
			switch mode {
			case "closed-start":
				proof.ReadyAt = 0
				proof.ClosedUntil = Millis() + 15000
				now, err := monitoringBootMillis()
				if err != nil {
					t.Fatal(err)
				}
				proof.ClosedBootUntil = now + 15000
			case "legacy":
				proof.Supervisor = ""
			case "foreign-owner":
				proof.Supervisor = terminalSupervisorUnit("/different-synthetic-state", r.ID)
			case "foreign-boot":
				proof.Boot = ManagementID()
			}
			if err := e.WithState(func() error {
				a := e.state.Attempts[r.ID]
				a.Units = []string{unit}
				if mode == "timed" {
					a.State = "ACTIVE"
					commitStart(a, Millis(), uptime(), boot())
				}
				if e.state.PaneInstances == nil {
					e.state.PaneInstances = map[string]PaneInstance{}
				}
				e.state.PaneInstances[unit] = proof
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			before, err := readStateSnapshot(e.Config.State)
			if err != nil {
				t.Fatal(err)
			}
			if empty, err := emptyRecordedScope("/sys/fs/cgroup/exam.slice/" + unit); err != nil || !empty {
				t.Fatal("synthetic metadata fixture unexpectedly has a real scope", err)
			}
			if err := e.Tick(); err != nil {
				t.Fatal("actual Tick failed", err)
			}
			after, err := readStateSnapshot(e.Config.State)
			if err != nil {
				t.Fatal(err)
			}
			a, b := before.Attempts[r.ID], after.Attempts[r.ID]
			if (len(b.Units) == 0) != (mode == "ready-practice") {
				t.Fatal("Tick reaped unverified/timed metadata or stranded a confirmed gone practice unit", mode, b.Units)
			}
			if a.State != b.State || a.Start != b.Start || a.Deadline != b.Deadline || a.OriginalDeadline != b.OriginalDeadline || a.AccessState != b.AccessState || a.Settings != b.Settings {
				t.Fatal("metadata cleanup changed timing/policy", mode, b)
			}
		})
	}
}

func (b *terminalTestBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buffer.Write(p)
}
func (b *terminalTestBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buffer.String()
}

func init() {
	terminalSupervisorGroup = ownedTerminalGroup
	terminalWorkloadGroup = ownedTerminalGroup
	terminalSupervisorCommand = func(unit string, files []*os.File) *exec.Cmd {
		id := strings.TrimPrefix(unit, "exam-terminal-")[:36]
		cmd := exec.Command("/usr/bin/systemd-run", "--user", "--scope", "--quiet", "--unit="+unit, "--property=MemoryMax=64M", "--property=MemorySwapMax=0", "--property=TasksMax=64", "--", "/proc/self/fd/4", "-test.run=^TestTerminalSupervisorChild$", "--", "--terminal-supervisor-test", id, unit)
		cmd.ExtraFiles = files
		cmd.Env = append(os.Environ(), "GORACE=atexit_sleep_ms=0", "GOMAXPROCS=2", "GOMEMLIMIT=48MiB")
		return cmd
	}
}

func TestTerminalSupervisorChild(t *testing.T) {
	i := -1
	for n, arg := range os.Args {
		if arg == "--terminal-supervisor-test" {
			i = n
			break
		}
	}
	if i < 0 {
		return
	}
	if len(os.Args) != i+3 {
		os.Exit(94)
	}
	for _, fd := range []int{3, 4, 5, 6} {
		unix.CloseOnExec(fd)
	}
	lf := os.NewFile(3, "test-supervisor-listener")
	listener, err := net.FileListener(lf)
	lf.Close()
	if err != nil {
		os.Exit(95)
	}
	defer listener.Close()
	exe := os.NewFile(4, "test-supervisor-executable")
	defer exe.Close()
	lock := os.NewFile(5, "test-supervisor-lifetime")
	defer lock.Close()
	cf := os.NewFile(6, "test-supervisor-control")
	conn, err := net.FileConn(cf)
	cf.Close()
	if err != nil {
		os.Exit(96)
	}
	defer conn.Close()
	var observedGroups sync.Map
	terminalWorkloadGroup = func(unit string) (string, error) {
		group, err := ownedTerminalGroup(unit)
		if err == nil {
			observedGroups.Store(unit, group)
		}
		return group, err
	}
	cleanup := func(s *terminalSupervisor, r terminalSupervisorAttach) error {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		observed, ok := observedGroups.Load(r.Unit)
		if !ok {
			return errors.New("cleanup lacks its exact previously observed user-scope path")
		}
		group := observed.(string)
		base := "/sys/fs/cgroup" + strings.TrimSuffix(strings.TrimPrefix(group, "0::"), "\n")
		if err := terminateRecordedScope(ctx, base, r.Unit, func(ctx context.Context, args ...string) error {
			return exec.CommandContext(ctx, "/usr/bin/systemctl", append([]string{"--user"}, args...)...).Run()
		}); err != nil {
			return err
		}
		return s.cleanupPane(r) // Same production no-metadata path after actual owned-scope proof.
	}
	if runTerminalSupervisor(os.Args[i+1], os.Args[i+2], listener.(*net.UnixListener), conn.(*net.UnixConn), exe, lock, cleanup) != nil {
		os.Exit(97)
	}
	os.Exit(0)
}

// Separate, killable coordinator uses the ACTUAL Unix/SCM_RIGHTS/PTY gate.
// Only root SSH ancestry, root manager namespace and student shell are replaced.
// No installed executable accepts these test-only roles or environment seams.
func TestTerminalCoordinatorChild(t *testing.T) {
	if os.Args[len(os.Args)-1] != "--terminal-coordinator-test" {
		return
	}
	setup := os.NewFile(3, "coordinator-test-config")
	var input struct {
		Config    Config
		PID, UID  int
		Transport string
	}
	if json.NewDecoder(setup).Decode(&input) != nil {
		os.Exit(90)
	}
	setup.Close()
	file := os.NewFile(4, "coordinator-test-listener")
	listener, err := net.FileListener(file)
	file.Close()
	if err != nil {
		os.Exit(91)
	}
	defer listener.Close()
	e, err := New(input.Config)
	if err != nil {
		os.Exit(92)
	}
	e.paneIdentity = func(pid, uid int) (string, error) {
		if pid != input.PID || uid != input.UID {
			return "", errors.New("wrong actual test Unix peer")
		}
		return input.Transport, nil
	}
	var groups sync.Map
	e.paneBootstrapStart = func(launch *exec.Cmd, control *net.UnixConn, exe *os.File, unit string, proof PaneInstance) (*paneBootstrapPeer, bool, error) {
		p, started, err := ownedPaneBootstrapStart(t, launch, control, exe, unit, proof)
		if err == nil && p != nil {
			groups.Store(unit, p.group)
		}
		return p, started, err
	}
	e.terminate = func(a *Attempt) error {
		for _, unit := range a.Units {
			observed, ok := groups.Load(unit)
			if !ok {
				return errors.New("owned coordinator cannot confirm an unobserved scope")
			}
			group := observed.(string)
			base := "/sys/fs/cgroup" + strings.TrimSuffix(strings.TrimPrefix(group, "0::"), "\n")
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			err := terminateRecordedScope(ctx, base, unit, func(ctx context.Context, args ...string) error {
				return exec.CommandContext(ctx, "/usr/bin/systemctl", append([]string{"--user"}, args...)...).Run()
			})
			cancel()
			if err != nil {
				return err
			}
		}
		return nil
	}
	for {
		c, err := listener.(*net.UnixListener).AcceptUnix()
		if err != nil {
			os.Exit(93)
		}
		go e.local(c)
	}
}

func supervisionReadUntil(fd int, marker string, timeout time.Duration) (string, error) {
	until := time.Now().Add(timeout)
	var output strings.Builder
	buffer := make([]byte, 1024)
	for time.Now().Before(until) {
		ready := []unix.PollFd{{Fd: int32(fd), Events: unix.POLLIN}}
		if _, err := unix.Poll(ready, 20); err != nil && !errors.Is(err, unix.EINTR) {
			return output.String(), err
		}
		if ready[0].Revents == 0 {
			continue
		}
		n, err := unix.Read(fd, buffer)
		if n > 0 {
			output.Write(buffer[:n])
		}
		matched := strings.Index(output.String(), marker)
		if matched >= 0 && (!strings.HasPrefix(marker, "BUFFER:") || strings.Contains(output.String()[matched:], "\n")) {
			return output.String(), nil
		}
		if err != nil && !errors.Is(err, unix.EAGAIN) && !errors.Is(err, unix.EINTR) {
			return output.String(), err
		}
		if n == 0 && err == nil {
			return output.String(), errors.New("terminal EOF before expected memory response")
		}
	}
	return output.String(), errors.New("terminal memory response timed out")
}

func TestActualPaneRetainsShellMemoryAndControlSocketAfterCoordinatorSIGKILL(t *testing.T) {
	testPracticeSupervisorWorkflow(t, "coordinator", nil, nil)
}

func TestActualTimedPaneKeepsCoordinatorRecordingBoundary(t *testing.T) {
	testPracticeSupervisorWorkflow(t, "timed", nil, nil)
}

// Two independent synthetic roots use the same unprivileged Unix UID. This
// proves process/scope/actual-gate isolation, not production multi-UID admission.
func TestActualPracticeSupervisorFailureIsAttemptScoped(t *testing.T) {
	ready, failed := make(chan struct{}), make(chan struct{})
	t.Run("healthy", func(t *testing.T) { t.Parallel(); testPracticeSupervisorWorkflow(t, "healthy", ready, failed) })
	t.Run("owner-failure", func(t *testing.T) { t.Parallel(); testPracticeSupervisorWorkflow(t, "supervisor", ready, failed) })
}

func testPracticeSupervisorWorkflow(t *testing.T, mode string, healthyReady, failed chan struct{}) {
	if os.Getenv("EXAM_COLLECTION_USER_SYSTEMD") != "1" {
		t.Skip("explicit owned local user-systemd qualification only")
	}
	if mode == "supervisor" {
		defer close(failed)
	}
	e, key, r := preparationFixture(t)
	e.preparationReady = func() (bool, []string) { return true, nil }
	if _, err := e.Call("prepare-attempt", r); err != nil {
		t.Fatal(err)
	}
	purpose := "practice"
	var originalStart, originalDeadline int64
	if mode == "timed" {
		purpose = "exam"
		e.Config.Templates = t.TempDir()
		if err := os.MkdirAll(filepath.Join(e.Config.Templates, "v1", "materials"), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.MkdirAll(filepath.Join(e.Config.Work, r.ID, "work"), 0700); err != nil {
			t.Fatal(err)
		}
		if err := e.WithState(func() error {
			a := e.state.Attempts[r.ID]
			a.State = "ACTIVE"
			a.BrowserSSH = true
			commitStart(a, Millis(), uptime(), boot())
			originalStart, originalDeadline = a.Start, a.Deadline
			return nil
		}); err != nil {
			t.Fatal(err)
		}
	}
	cmd := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "issue-channel-admission", Username: r.Username, Transport: r.Transport, Body: Request{ID: r.ID, Pane: finalID, Purpose: purpose, Username: r.Username, Transport: r.Transport}}
	issued, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport)
	if err != nil {
		t.Fatal(err)
	}
	listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: filepath.Join(t.TempDir(), "supervision.sock"), Net: "unix"})
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	listenFile, err := listener.File()
	if err != nil {
		t.Fatal(err)
	}
	defer listenFile.Close()
	read, write, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer read.Close()
	defer write.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	executable, err := paneBootstrapExecutable()
	if err != nil {
		t.Fatal(err)
	}
	defer executable.Close()
	coordinatorUnit := "exam-test-coordinator-" + ManagementID() + ".scope"
	coordinator := exec.CommandContext(ctx, "/usr/bin/systemd-run", "--user", "--scope", "--quiet", "--unit="+coordinatorUnit, "--property=MemoryMax=128M", "--property=MemorySwapMax=0", "--property=TasksMax=64", "--", "/proc/self/fd/5", "-test.run=^TestTerminalCoordinatorChild$", "--", "--terminal-coordinator-test")
	coordinator.ExtraFiles = []*os.File{read, listenFile, executable}
	coordinator.Env = append(os.Environ(), "GORACE=atexit_sleep_ms=0", "GOMAXPROCS=2")
	var diagnostics terminalTestBuffer
	coordinator.Stdout, coordinator.Stderr = &diagnostics, &diagnostics
	if err := coordinator.Start(); err != nil {
		t.Fatal(err)
	}
	read.Close()
	defer func() {
		_ = coordinator.Process.Kill()
		cleanupCoordinator, stopCoordinator := context.WithTimeout(context.Background(), 3*time.Second)
		_ = exec.CommandContext(cleanupCoordinator, "/usr/bin/systemctl", "--user", "stop", coordinatorUnit).Run()
		_ = exec.CommandContext(cleanupCoordinator, "/usr/bin/systemctl", "--user", "reset-failed", coordinatorUnit).Run()
		stopCoordinator()
		_ = coordinator.Wait()
		state, err := readStateSnapshot(e.Config.State)
		if err == nil && state.Attempts[r.ID] != nil {
			for _, unit := range state.Attempts[r.ID].Units {
				if _, _, _, ok := recordedPaneIdentity(r.ID, unit); !ok {
					t.Error("foreign test unit")
					continue
				}
				cleanup, stop := context.WithTimeout(context.Background(), 3*time.Second)
				_ = exec.CommandContext(cleanup, "/usr/bin/systemctl", "--user", "stop", unit).Run()
				_ = exec.CommandContext(cleanup, "/usr/bin/systemctl", "--user", "reset-failed", unit).Run()
				stop()
			}
		}
		cleanup, stop := context.WithTimeout(context.Background(), 3*time.Second)
		_ = exec.CommandContext(cleanup, "/usr/bin/systemctl", "--user", "stop", terminalSupervisorUnit(e.Config.State, r.ID)).Run()
		_ = exec.CommandContext(cleanup, "/usr/bin/systemctl", "--user", "reset-failed", terminalSupervisorUnit(e.Config.State, r.ID)).Run()
		stop()
	}()
	if err := json.NewEncoder(write).Encode(struct {
		Config    Config
		PID, UID  int
		Transport string
	}{e.Config, os.Getpid(), r.UID, r.Transport}); err != nil {
		t.Fatal(err)
	}
	write.Close()
	client, err := net.DialUnix("unix", nil, listener.Addr().(*net.UnixAddr))
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	_ = client.SetDeadline(time.Now().Add(8 * time.Second))
	master, slave, err := openPTYMasterFlags(unix.O_NONBLOCK)
	if err != nil {
		t.Fatal(err)
	}
	defer master.Close()
	defer slave.Close()
	frame, _ := json.Marshal(LocalRequest{Token: issued.(map[string]string)["token"]})
	if _, _, err := client.WriteMsgUnix(frame, syscall.UnixRights(int(slave.Fd())), nil); err != nil {
		t.Fatal(err)
	}
	var ready map[string]any
	if err := json.NewDecoder(client).Decode(&ready); err != nil || ready["error"] != nil {
		t.Fatal("actual gate missed ready", ready, err, diagnostics.String())
	}
	if _, err := client.Write([]byte{1}); err != nil {
		t.Fatal(err)
	}
	slave.Close() // Do not accidentally keep the outer terminal alive in the test.
	fd := int(master.Fd())
	if err := unix.SetNonblock(fd, true); err != nil {
		t.Fatal(err)
	}
	if out, err := supervisionReadUntil(fd, "SYNTHETIC-CLOSED-PANE-EXEC", 4*time.Second); err != nil {
		t.Fatal("actual shell never executed", out, err, diagnostics.String())
	}
	if _, err := unix.Write(fd, []byte("check\n")); err != nil {
		t.Fatal(err)
	}
	before, err := supervisionReadUntil(fd, "BUFFER:synthetic-buffer-not-on-disk:", time.Second)
	if err != nil {
		t.Fatal("baseline did not exercise memory response", before, err)
	}
	// A second real pane must attach to the SAME independently bounded owner.
	secondPane := ManagementID()
	cmd.Nonce, cmd.Body.Pane = Token(), secondPane
	secondIssued, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport)
	if err != nil {
		t.Fatal(err)
	}
	second, err := net.DialUnix("unix", nil, listener.Addr().(*net.UnixAddr))
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	_ = second.SetDeadline(time.Now().Add(8 * time.Second))
	m2, s2, err := openPTYMasterFlags(unix.O_NONBLOCK)
	if err != nil {
		t.Fatal(err)
	}
	defer m2.Close()
	defer s2.Close()
	request2, _ := json.Marshal(LocalRequest{Token: secondIssued.(map[string]string)["token"]})
	if _, _, err := second.WriteMsgUnix(request2, syscall.UnixRights(int(s2.Fd())), nil); err != nil {
		t.Fatal(err)
	}
	var ready2 map[string]any
	if err := json.NewDecoder(second).Decode(&ready2); err != nil || ready2["error"] != nil {
		t.Fatal("second actual pane missed ready", ready2, err)
	}
	if _, err := second.Write([]byte{1}); err != nil {
		t.Fatal(err)
	}
	s2.Close()
	fd2 := int(m2.Fd())
	if unix.SetNonblock(fd2, true) != nil {
		t.Fatal("second PTY not nonblocking")
	}
	if out, err := supervisionReadUntil(fd2, "SYNTHETIC-CLOSED-PANE-EXEC", 4*time.Second); err != nil {
		t.Fatal("second shell never executed", out, err, diagnostics.String())
	}
	view, err := ObserveNativePanes(e.Config.State, NativePaneQuery{Attempt: r.ID, Limit: 10})
	if err != nil || len(view.Panes) != 2 {
		t.Fatal("actual two-pane inventory unavailable", view, err)
	}
	if mode == "timed" {
		for _, pane := range view.Panes {
			if len(pane.RecordedSupervisors) != 0 {
				t.Fatal("unqualified timed supervision was enabled", view)
			}
		}
		if _, err := os.Stat(filepath.Join(e.Config.State, "terminal-supervisors")); !os.IsNotExist(err) {
			t.Fatal("timed pane created a practice owner", err)
		}
		for i, connection := range []*net.UnixConn{client, second} {
			target := fd
			if i == 1 {
				target = fd2
			}
			if _, err := unix.Write(target, []byte("finish\n")); err != nil {
				t.Fatal(err)
			}
			var ended map[string]any
			if err := json.NewDecoder(connection).Decode(&ended); err != nil || ended["ended"] != true {
				t.Fatal("legacy recorded pane failed", ended, err)
			}
		}
		for _, pane := range []string{finalID, secondPane} {
			b, err := os.ReadFile(filepath.Join(e.Config.State, "monitoring", r.ID, pane+".ndjson"))
			if err != nil || !bytes.Contains(b, []byte(`"event":"output"`)) {
				t.Fatal("timed output was not durably recorded", err)
			}
		}
		state, err := readStateSnapshot(e.Config.State)
		if err != nil {
			t.Fatal(err)
		}
		a := state.Attempts[r.ID]
		if a.Start != originalStart || a.Deadline != originalDeadline || a.OriginalDeadline != originalDeadline || a.State != "ACTIVE" || a.AccessState != "HELD" {
			t.Fatal("timed boundary changed interval or restrictions", a)
		}
		return
	}
	for _, pane := range view.Panes {
		if len(pane.RecordedSupervisors) != 1 || pane.RecordedSupervisors[0] != terminalSupervisorUnit(e.Config.State, r.ID) {
			t.Fatal("panes did not share one supervisor", view)
		}
	}
	coordGroup, err := ownedTerminalGroup(coordinatorUnit)
	if err != nil {
		t.Fatal(err)
	}
	supGroup, err := ownedTerminalGroup(terminalSupervisorUnit(e.Config.State, r.ID))
	if err != nil || supGroup == coordGroup || strings.HasPrefix(supGroup, strings.TrimSuffix(coordGroup, "\n")+"/") {
		t.Fatal("supervisor shares coordinator kill domain", coordGroup, supGroup, err)
	}
	if mode == "healthy" {
		close(healthyReady)
		select {
		case <-failed:
		case <-time.After(5 * time.Second):
			t.Fatal("owned failure peer did not settle")
		}
	}
	if mode == "supervisor" {
		select {
		case <-healthyReady:
		case <-time.After(5 * time.Second):
			t.Fatal("healthy actual peer never became ready")
		}
		writer := filepath.Join(e.Config.Work, "synthetic-practice-writer")
		if _, err := unix.Write(fd, []byte("persistent "+writer+"\n")); err != nil {
			t.Fatal(err)
		}
		if out, err := supervisionReadUntil(fd, "WRITER:", time.Second); err != nil {
			t.Fatal("persistent writer never started", out, err)
		}
		until := time.Now().Add(time.Second)
		for {
			info, err := os.Stat(writer)
			if err == nil && info.Size() > 0 {
				break
			}
			if time.Now().After(until) {
				t.Fatal("writer fixture never changed its owned file", err)
			}
			time.Sleep(time.Millisecond)
		}
		beforeKill, err := readStateSnapshot(e.Config.State)
		if err != nil {
			t.Fatal(err)
		}
		var workloadBases []string
		for _, unit := range beforeKill.Attempts[r.ID].Units {
			group, err := ownedTerminalGroup(unit)
			if err != nil {
				t.Fatal("exact live owned workload group missing", err)
			}
			workloadBases = append(workloadBases, "/sys/fs/cgroup"+strings.TrimSuffix(strings.TrimPrefix(group, "0::"), "\n"))
		}
		if err := exec.Command("/usr/bin/systemctl", "--user", "kill", "--signal=KILL", terminalSupervisorUnit(e.Config.State, r.ID)).Run(); err != nil {
			t.Fatal(err)
		}
		for _, connection := range []*net.UnixConn{client, second} {
			var response map[string]any
			if err := json.NewDecoder(connection).Decode(&response); err != nil || !strings.Contains(fmt.Sprint(response["error"]), "terminal owner exited") {
				t.Fatal("verified owner failure was not reported by its live coordinator", response, err)
			}
		}
		info, err := os.Stat(writer)
		if err != nil {
			t.Fatal(err)
		}
		size := info.Size()
		time.Sleep(50 * time.Millisecond)
		info, err = os.Stat(writer)
		if err != nil || info.Size() != size {
			t.Fatal("owner failure left an actual HUP-ignoring writer running", err)
		}
		for _, base := range workloadBases {
			empty, err := emptyRecordedScope(base)
			if err != nil || !empty {
				t.Fatal("owner failure did not confirm whole owned workload scope empty", base, err)
			}
		}
		state, err := readStateSnapshot(e.Config.State)
		if err != nil || len(state.Attempts[r.ID].Units) != 0 || state.Attempts[r.ID].Start != 0 || state.Attempts[r.ID].State != "PREPARING" {
			t.Fatal("owner failure stranded metadata or changed preflight timing", state.Attempts[r.ID], err)
		}
		return
	}
	// Kill ALL processes in the exact owned coordinator cgroup, not only its
	// leader. Surviving PTYs must therefore belong to the independent scope.
	if mode == "coordinator" {
		if err := exec.Command("/usr/bin/systemctl", "--user", "kill", "--signal=KILL", coordinatorUnit).Run(); err != nil {
			t.Fatal(err)
		}
		if err := coordinator.Wait(); err == nil {
			t.Fatal("coordinator did not actually die by SIGKILL")
		}
		// Prove the surviving owner never loads global metadata, even at pane
		// completion. Only this exact synthetic state file is replaced/restored.
		stateFile := filepath.Join(e.Config.State, "state.json")
		backup := filepath.Join(e.Config.State, "synthetic-state-backup")
		if err := os.Rename(stateFile, backup); err != nil {
			t.Fatal(err)
		}
		defer func() {
			_ = os.Remove(stateFile)
			if err := os.Rename(backup, stateFile); err != nil {
				t.Error("restore exact synthetic state", err)
			}
		}()
		if err := unix.Mkfifo(stateFile, 0600); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := unix.Write(fd, []byte("check\n")); err != nil {
		t.Fatal(err)
	}
	after, err := supervisionReadUntil(fd, "BUFFER:synthetic-buffer-not-on-disk:", time.Second)
	if err != nil {
		t.Fatalf("coordinator death lost the actual PTY/shell memory: %v output=%q", err, after)
	}
	line := func(out string) string {
		for _, v := range strings.Split(out, "\n") {
			if strings.HasPrefix(v, "BUFFER:") {
				return strings.TrimSpace(v)
			}
		}
		return ""
	}
	if line(before) == "" || line(before) != line(after) {
		t.Fatal("shell/memory incarnation changed", before, after)
	}
	if _, err := unix.Write(fd2, []byte("check\n")); err != nil {
		t.Fatal(err)
	}
	if out, err := supervisionReadUntil(fd2, "BUFFER:synthetic-buffer-not-on-disk:", time.Second); err != nil {
		t.Fatal("second pane lost memory after whole coordinator cgroup SIGKILL", out, err)
	}
	if _, err := unix.Write(fd, []byte("finish\n")); err != nil {
		t.Fatal(err)
	}
	var ended map[string]any
	if err := json.NewDecoder(client).Decode(&ended); err != nil || ended["ended"] != true {
		t.Fatal("retained gate control/cleanup did not finish", fmt.Sprint(ended), err)
	}
	if _, err := unix.Write(fd2, []byte("finish\n")); err != nil {
		t.Fatal(err)
	}
	var ended2 map[string]any
	if err := json.NewDecoder(second).Decode(&ended2); err != nil || ended2["ended"] != true {
		t.Fatal("second original control socket/cleanup lost", ended2, err)
	}
}
