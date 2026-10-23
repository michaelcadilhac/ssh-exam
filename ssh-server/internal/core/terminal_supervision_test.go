package core

import (
	"bytes"
	"context"
	"encoding/base64"
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
	var delayedCleanup sync.Map
	terminalWorkloadGroup = func(unit string) (string, error) {
		group, err := ownedTerminalGroup(unit)
		if err == nil {
			observedGroups.Store(unit, group)
		}
		return group, err
	}
	cleanup := func(s *terminalSupervisor, r terminalSupervisorAttach) error {
		if r.Pane == finalID {
			if marker, err := os.ReadFile(filepath.Join(s.state, "synthetic-cleanup-retry")); err == nil && string(marker) == "one-unconfirmed-cleanup" {
				if _, already := delayedCleanup.LoadOrStore(r.Unit, true); !already {
					return errors.New("synthetic cleanup initially unconfirmed; no positive failure evidence")
				}
			}
		}
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
		Config                                     Config
		PID, UID                                   int
		Transport                                  string
		RecordingFailureBarrier                    string
		RecordingLockBarrier, RecordingLockAttempt string
		HandoffBarrier                             string
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
	if input.HandoffBarrier != "" {
		e.terminalHandoffCheckpoint = func() {
			if err := os.WriteFile(input.HandoffBarrier+".ready", []byte("actual-owner-ready-before-release"), 0600); err != nil {
				os.Exit(101)
			}
			for until := time.Now().Add(5 * time.Second); time.Now().Before(until); {
				if _, err := os.Stat(input.HandoffBarrier + ".release"); err == nil {
					return
				}
				time.Sleep(5 * time.Millisecond)
			}
			os.Exit(102)
		}
	}
	if input.RecordingFailureBarrier != "" {
		e.terminalFailureCheckpoint = func(stage string) {
			if err := os.WriteFile(input.RecordingFailureBarrier+"."+stage, []byte("actual-recording-fault"), 0600); err != nil {
				os.Exit(98)
			}
			if stage == "before-state" {
				for until := time.Now().Add(5 * time.Second); time.Now().Before(until); {
					if _, err := os.Stat(input.RecordingFailureBarrier + ".release"); err == nil {
						return
					}
					time.Sleep(5 * time.Millisecond)
				}
				os.Exit(99)
			}
		}
	}
	if input.RecordingLockBarrier != "" {
		// Tighten the production bound to ONE slot in this child only. A blocked
		// attempt flock must consume zero; otherwise the healthy actual gate stalls.
		terminalRecordingIO = make(chan struct{}, 1)
		terminalRecordingLockProbe = func(id string) {
			if id == input.RecordingLockAttempt {
				if _, err := os.Stat(input.RecordingLockBarrier + ".armed"); err == nil {
					if err := os.WriteFile(input.RecordingLockBarrier+".entered", []byte("actual-recording-lock"), 0600); err != nil {
						os.Exit(100)
					}
				}
			}
		}
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

func TestActualRootCLIObservesSupervisorAfterCreatorDeathWithoutReadingFIFOState(t *testing.T) {
	if os.Getenv("EXAM_MANAGEMENT_USERNS") != "1" {
		t.Skip("explicit isolated root-namespace CLI qualification only")
	}
	testPracticeSupervisorWorkflow(t, "observation", nil, nil)
}

func TestActualTimedPaneKeepsCoordinatorRecordingBoundary(t *testing.T) {
	testPracticeSupervisorWorkflow(t, "timed", nil, nil)
}

func TestActualTimedPaneUsesIndependentRecordingOwner(t *testing.T) {
	testPracticeSupervisorWorkflow(t, "timed-owner", nil, nil)
}

func TestActualTimedPaneRegistersPageOwnerInIndependentSupervisor(t *testing.T) {
	testPracticeSupervisorWorkflow(t, "timed-owner-registered", nil, nil)
}

func TestActualFramedTimedPaneFencesInputAndResizeAcrossSamePaneReplacement(t *testing.T) {
	testPracticeSupervisorWorkflow(t, "timed-owner-framed", nil, nil)
}

func TestActualFramedPaneRefusesAnOldLoadedEntryBeforeExec(t *testing.T) {
	testPracticeSupervisorWorkflow(t, "timed-owner-framed-old-entry", nil, nil)
}

func TestActualTimedAdmissionSurvivesInitialAckAndContainsPrestartFault(t *testing.T) {
	for _, mode := range []string{"initial-ack", "prestart-fault"} {
		t.Run(mode, func(t *testing.T) { testPracticeSupervisorWorkflow(t, "timed-owner-"+mode, nil, nil) })
	}
}

func TestActualTimedRecordingOwnerDeathContainsWritersWithoutStudentViolation(t *testing.T) {
	testPracticeSupervisorWorkflow(t, "timed-owner-death", nil, nil)
}

func TestActualTimedRecordingBackpressureAndTransportEOF(t *testing.T) {
	for _, mode := range []string{"backpressure", "transport-eof", "final-output", "cleanup-retry"} {
		t.Run(mode, func(t *testing.T) { testPracticeSupervisorWorkflow(t, "timed-owner-"+mode, nil, nil) })
	}
}

func TestActualTimedPaneRefusesFullReportCapacityBeforeExec(t *testing.T) {
	for _, mode := range []string{"queue-files", "queue-proofs"} {
		t.Run(mode, func(t *testing.T) { testPracticeSupervisorWorkflow(t, "timed-owner-"+mode, nil, nil) })
	}
}

func TestActualTimedRecordingFaultCannotLockReplacement(t *testing.T) {
	for _, mode := range []string{"generation", "transport", "pane", "orphan-proof", "current", "extended-current"} {
		t.Run(mode, func(t *testing.T) { testPracticeSupervisorWorkflow(t, "timed-fault-"+mode, nil, nil) })
	}
}

func TestActualSupervisedTimedRecordingFaultCannotLockReplacement(t *testing.T) {
	for _, mode := range []string{"generation", "transport", "pane", "orphan-proof", "current", "extended-current"} {
		t.Run(mode, func(t *testing.T) { testPracticeSupervisorWorkflow(t, "timed-supervised-"+mode, nil, nil) })
	}
}

func TestActualRecordingLockDoesNotBlockAnotherAttemptInSameCoordinator(t *testing.T) {
	testPracticeSupervisorWorkflow(t, "timed-isolation", nil, nil)
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
	supervised := strings.HasPrefix(mode, "timed-owner") || strings.HasPrefix(mode, "timed-supervised-")
	registered := mode == "timed-owner-registered" || strings.HasPrefix(mode, "timed-owner-framed")
	if strings.HasPrefix(mode, "timed-supervised-") {
		mode = "timed-fault-" + strings.TrimPrefix(mode, "timed-supervised-")
	}
	if mode == "supervisor" {
		defer close(failed)
	}
	cliBinary := ""
	if mode == "observation" || ((mode == "timed-owner" || mode == "timed-owner-framed") && os.Getenv("EXAM_MANAGEMENT_USERNS") == "1") {
		cliBinary = observationCLIBinary(t)
	}
	e, key, r := preparationFixture(t)
	if registered {
		if os.Getuid() < 1000 {
			t.Skip("student owner contract requires UID>=1000")
		}
		r.Transport = Hash([]byte("synthetic registered SSH transport"))
		if err := e.WithState(func() error { e.state.Registrations[r.Transport] = r.Username; return nil }); err != nil {
			t.Fatal(err)
		}
	}
	e.preparationReady = func() (bool, []string) { return true, nil }
	if _, err := e.Call("prepare-attempt", r); err != nil {
		t.Fatal(err)
	}
	purpose := "practice"
	secondID := r.ID
	var originalStart, originalDeadline int64
	if strings.HasPrefix(mode, "timed") {
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
			if registered {
				if err := registerPageOwner(a, Hash([]byte("synthetic registered page")), Token()); err != nil {
					return err
				}
			}
			if !supervised {
				a.TerminalSupervised = false // Explicit legacy-recorder compatibility controls.
			}
			originalStart, originalDeadline = a.Start, a.Deadline
			return nil
		}); err != nil {
			t.Fatal(err)
		}
	}
	if mode == "timed-isolation" {
		secondID = ManagementID()
		// This is a recording-scheduler fixture, NOT permission to admit two
		// concurrent attempts for one UID. Root multi-UID admission is not mocked
		// into a qualification claim: both real gates use this local Unix UID.
		if err := os.MkdirAll(filepath.Join(e.Config.Work, secondID, "work"), 0700); err != nil {
			t.Fatal(err)
		}
		if err := e.prepareHome(&Attempt{ID: secondID, Username: r.Username, UID: r.UID, Settings: r.Settings}); err != nil {
			t.Fatal(err)
		}
		if err := e.WithState(func() error {
			second := *e.state.Attempts[r.ID]
			second.ID, second.Units = secondID, nil
			e.state.Attempts[secondID] = &second
			return nil
		}); err != nil {
			t.Fatal(err)
		}
	}
	if mode == "timed-owner-queue-files" || mode == "timed-owner-queue-proofs" {
		resources, err := terminalRecordingResources(e.Config.State, r.ID)
		if err != nil {
			t.Fatal(err)
		}
		defer func() {
			for _, f := range resources {
				f.Close()
			}
		}()
		if err := e.WithState(func() error {
			a := e.state.Attempts[r.ID]
			for range terminalRecordingReportEntries {
				pane, instance := ManagementID(), ManagementID()
				unit := "exam-" + r.ID + "-" + pane + "-" + instance + ".scope"
				context := recordingContext(*a, pane, unit)
				if mode == "timed-owner-queue-proofs" {
					if e.state.PaneInstances == nil {
						e.state.PaneInstances = map[string]PaneInstance{}
					}
					e.state.PaneInstances[unit] = PaneInstance{Attempt: r.ID, Pane: pane, ID: instance, Boot: boot(), ReadyAt: Millis(), Recording: context.hash(), RecordingIdentity: context, RecordingOwner: Hash([]byte("queued-test-owner"))}
				} else {
					if err := publishTerminalRecordingReport(resources[2], terminalRecordingReport{Context: context, Owner: Hash([]byte("queued-test-owner")), Version: 2, At: Millis(), Closed: true, RecordingComplete: true, CleanupComplete: true}); err != nil {
						return err
					}
				}
			}
			return nil
		}); err != nil {
			t.Fatal(err)
		}
	}
	if mode == "timed-owner-cleanup-retry" {
		if err := os.WriteFile(filepath.Join(e.Config.State, "synthetic-cleanup-retry"), []byte("one-unconfirmed-cleanup"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	cmd := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "issue-channel-admission", Username: r.Username, Transport: r.Transport, Body: Request{ID: r.ID, Pane: finalID, Purpose: purpose, Username: r.Username, Transport: r.Transport}}
	if registered {
		cmd.Op = "issue-owner-channel-admission"
		cmd.Body.PageEpoch = Hash([]byte("synthetic registered page"))
	}
	if strings.HasPrefix(mode, "timed-owner-framed") {
		cmd.Op = "issue-framed-owner-channel-admission"
	}
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
		if err == nil {
			ids := []string{r.ID}
			if secondID != r.ID {
				ids = append(ids, secondID)
			}
			for _, id := range ids {
				if state.Attempts[id] == nil {
					continue
				}
				for _, unit := range state.Attempts[id].Units {
					if _, _, _, ok := recordedPaneIdentity(id, unit); !ok {
						t.Error("foreign test unit")
						continue
					}
					cleanup, stop := context.WithTimeout(context.Background(), 3*time.Second)
					_ = exec.CommandContext(cleanup, "/usr/bin/systemctl", "--user", "stop", unit).Run()
					_ = exec.CommandContext(cleanup, "/usr/bin/systemctl", "--user", "reset-failed", unit).Run()
					stop()
				}
			}
		}
		cleanup, stop := context.WithTimeout(context.Background(), 3*time.Second)
		_ = exec.CommandContext(cleanup, "/usr/bin/systemctl", "--user", "stop", terminalSupervisorUnit(e.Config.State, r.ID)).Run()
		_ = exec.CommandContext(cleanup, "/usr/bin/systemctl", "--user", "reset-failed", terminalSupervisorUnit(e.Config.State, r.ID)).Run()
		stop()
	}()
	if err := json.NewEncoder(write).Encode(struct {
		Config                                     Config
		PID, UID                                   int
		Transport                                  string
		RecordingFailureBarrier                    string
		RecordingLockBarrier, RecordingLockAttempt string
		HandoffBarrier                             string
	}{e.Config, os.Getpid(), r.UID, r.Transport, func() string {
		if strings.HasPrefix(mode, "timed-fault-") {
			return filepath.Join(e.Config.State, "synthetic-recording-barrier")
		}
		return ""
	}(), func() string {
		if mode == "timed-isolation" {
			return filepath.Join(e.Config.State, "synthetic-recording-lock")
		}
		return ""
	}(), r.ID, func() string {
		if mode == "timed-owner-initial-ack" || mode == "timed-owner-prestart-fault" {
			return filepath.Join(e.Config.State, "synthetic-handoff")
		}
		return ""
	}()}); err != nil {
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
	if mode == "timed-owner-framed" {
		// The real exam-login entry makes its own outer PTY raw before SCM_RIGHTS.
		// This direct-gate fixture owns the entire disposable PTY; never restore
		// through a numeric FD after the local duplicate has been closed below.
		if _, err := rawTerminal(slave.Fd()); err != nil {
			t.Fatal(err)
		}
	}
	localRequest := LocalRequest{Token: issued.(map[string]string)["token"]}
	if mode == "timed-owner-framed" {
		localRequest.InputProtocol = "v1"
	}
	frame, _ := json.Marshal(localRequest)
	if _, _, err := client.WriteMsgUnix(frame, syscall.UnixRights(int(slave.Fd())), nil); err != nil {
		t.Fatal(err)
	}
	var ready map[string]any
	readyErr := json.NewDecoder(client).Decode(&ready)
	if mode == "timed-owner-framed-old-entry" {
		if readyErr != nil || !strings.Contains(fmt.Sprint(ready["error"]), "matching loaded exam-login") {
			t.Fatal("old entry did not reach the explicit protocol refusal", readyErr)
		}
		state, err := readStateSnapshot(e.Config.State)
		if err != nil {
			t.Fatal(err)
		}
		a := state.Attempts[r.ID]
		if len(a.Units) != 0 || a.State != "ACTIVE" || a.Start != originalStart || a.Deadline != originalDeadline || a.OriginalDeadline != originalDeadline {
			t.Fatal("old-entry refusal released a workload or changed the interval")
		}
		return
	}
	if readyErr != nil || ready["error"] != nil {
		t.Fatal("actual gate missed ready", ready, readyErr, diagnostics.String())
	}
	if _, err := client.Write([]byte{1}); err != nil {
		t.Fatal(err)
	}
	slave.Close() // Do not accidentally keep the outer terminal alive in the test.
	fd := int(master.Fd())
	if err := unix.SetNonblock(fd, true); err != nil {
		t.Fatal(err)
	}
	if mode == "timed-owner-initial-ack" || mode == "timed-owner-prestart-fault" {
		barrier := filepath.Join(e.Config.State, "synthetic-handoff")
		observed := false
		for until := time.Now().Add(2 * time.Second); time.Now().Before(until); {
			if data, err := os.ReadFile(barrier + ".ready"); err == nil && string(data) == "actual-owner-ready-before-release" {
				observed = true
				break
			}
			time.Sleep(5 * time.Millisecond)
		}
		if !observed {
			t.Fatal("fixture missed actual owner-ready/final-release boundary", diagnostics.String())
		}
		if mode == "timed-owner-initial-ack" {
			if err := e.Tick(); err != nil {
				t.Fatal("actual watchdog Tick failed at initial report", err)
			}
		} else {
			captured, err := readStateSnapshot(e.Config.State)
			if err != nil || len(captured.Attempts[r.ID].Units) != 1 {
				t.Fatal("fixture missed its closed bootstrap", err)
			}
			unit := captured.Attempts[r.ID].Units[0]
			group, err := ownedTerminalGroup(unit)
			if err != nil {
				t.Fatal(err)
			}
			base := "/sys/fs/cgroup" + strings.TrimSuffix(strings.TrimPrefix(group, "0::"), "\n")
			if err := os.Remove(filepath.Join(e.Config.State, "monitoring", r.ID, finalID+".ndjson")); err != nil {
				t.Fatal(err)
			}
			size := windowSize{Row: 35, Col: 110}
			if err := ioctl(master.Fd(), syscall.TIOCSWINSZ, unsafePointer(&size)); err != nil {
				t.Fatal(err)
			}
			contained := false
			for until := time.Now().Add(2 * time.Second); time.Now().Before(until); {
				if empty, err := emptyRecordedScope(base); err == nil && empty {
					contained = true
					break
				}
				time.Sleep(5 * time.Millisecond)
			}
			if !contained {
				t.Fatal("recording failure waited for startup notice instead of containing its exact closed scope")
			}
		}
		if err := os.WriteFile(barrier+".release", []byte("release-final-admission"), 0600); err != nil {
			t.Fatal(err)
		}
		if mode == "timed-owner-prestart-fault" {
			var refused map[string]any
			if err := json.NewDecoder(client).Decode(&refused); err != nil || refused["error"] == nil {
				t.Fatal("failed recorder still released student exec", refused, err)
			}
			captured, err := readStateSnapshot(e.Config.State)
			if err != nil {
				t.Fatal(err)
			}
			a := captured.Attempts[r.ID]
			if a.State != "ACTIVE" || a.Start != originalStart || a.Deadline != originalDeadline || a.OriginalDeadline != originalDeadline || a.AccessState != "HELD" {
				t.Fatal("pre-exec infrastructure refusal altered time or invented a policy fault", a)
			}
			return
		}
	}
	if mode == "timed-owner-queue-files" || mode == "timed-owner-queue-proofs" {
		var refused map[string]any
		if err := json.NewDecoder(client).Decode(&refused); err != nil || !strings.Contains(fmt.Sprint(refused["error"]), "report") {
			t.Fatal("full queue did not refuse at closed admission", refused, err, diagnostics.String())
		}
		state, err := readStateSnapshot(e.Config.State)
		if err != nil {
			t.Fatal(err)
		}
		a := state.Attempts[r.ID]
		if len(a.Units) != 0 || a.State != "ACTIVE" || a.Start != originalStart || a.Deadline != originalDeadline || a.OriginalDeadline != originalDeadline || a.AccessState != "HELD" {
			t.Fatal("queue refusal consumed/reopened authority", a)
		}
		for _, proof := range state.PaneInstances {
			if proof.Pane == finalID && proof.ReadyAt != 0 {
				t.Fatal("full queue released student exec")
			}
		}
		if _, err := os.Lstat(filepath.Join(e.Config.State, "monitoring", r.ID, finalID+".ndjson")); !os.IsNotExist(err) {
			t.Fatal("queue refusal passed recorder initialization", err)
		}
		return
	}
	if out, err := supervisionReadUntil(fd, "SYNTHETIC-CLOSED-PANE-EXEC", 4*time.Second); err != nil {
		t.Fatal("actual shell never executed", out, err, diagnostics.String())
	}
	if mode == "timed-owner-framed" {
		testFramedSupervisorReplacement(t, e, key, cmd, client, master, ready, issued.(map[string]string)["input_epoch"], listener.Addr().(*net.UnixAddr), cliBinary)
		return
	}
	if _, err := unix.Write(fd, []byte("check\n")); err != nil {
		t.Fatal(err)
	}
	before, err := supervisionReadUntil(fd, "BUFFER:synthetic-buffer-not-on-disk:", time.Second)
	if err != nil {
		t.Fatal("baseline did not exercise memory response", before, err)
	}
	line := func(out string) string {
		for _, v := range strings.Split(out, "\n") {
			if strings.HasPrefix(v, "BUFFER:") {
				return strings.TrimSpace(v)
			}
		}
		return ""
	}
	// A second real pane must attach to the SAME independently bounded owner.
	secondPane := ManagementID()
	cmd.Nonce, cmd.Body.Pane = Token(), secondPane
	cmd.Body.ID = secondID
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
	if mode == "timed-owner-registered" {
		view, err := ObserveTerminalSupervisor(e.Config.State, r.ID)
		if err != nil || view.RegisteredOwner == nil || view.RegisteredOwner.PageEpoch != cmd.Body.PageEpoch || view.RegisteredOwner.TransportHash != r.Transport || !view.ObservationOnly {
			t.Fatal("actual independent owner lost registered page scope", err)
		}
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
	// The read-only API intentionally refuses an inode whose ctime changes
	// when a concurrent canonical save unlinks it. A recording acknowledgement
	// may do that just after exec. Require a positive coherent snapshot within
	// a bound; never turn a refusal itself into an inventory/permission result.
	for until := time.Now().Add(time.Second); errors.Is(err, errReadOnlySnapshot) && time.Now().Before(until); {
		time.Sleep(time.Millisecond)
		view, err = ObserveNativePanes(e.Config.State, NativePaneQuery{Attempt: r.ID, Limit: 10})
	}
	wantPanes := 2
	if mode == "timed-isolation" {
		wantPanes = 1
	}
	if err != nil || len(view.Panes) != wantPanes {
		t.Fatal("actual two-pane inventory unavailable", view, err)
	}
	if mode == "timed-isolation" {
		if _, err := unix.Write(fd2, []byte("check\n")); err != nil {
			t.Fatal(err)
		}
		healthyBefore, err := supervisionReadUntil(fd2, "BUFFER:synthetic-buffer-not-on-disk:", time.Second)
		if err != nil {
			t.Fatal("healthy baseline missed its actual memory response", healthyBefore, err)
		}
		lock, err := os.OpenFile(filepath.Join(e.Config.State, "monitoring", r.ID+".lock"), os.O_RDWR, 0600)
		if err != nil {
			t.Fatal(err)
		}
		defer lock.Close()
		if err := unix.Flock(int(lock.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
			t.Fatal("test did not acquire the real attempt lock", err)
		}
		defer unix.Flock(int(lock.Fd()), unix.LOCK_UN)
		barrier := filepath.Join(e.Config.State, "synthetic-recording-lock")
		if err := os.WriteFile(barrier+".armed", []byte("block-only-first-attempt"), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := unix.Write(fd, []byte("check\n")); err != nil {
			t.Fatal(err)
		}
		observed := false
		for until := time.Now().Add(time.Second); time.Now().Before(until); {
			if data, err := os.ReadFile(barrier + ".entered"); err == nil && string(data) == "actual-recording-lock" {
				observed = true
				break
			}
			time.Sleep(5 * time.Millisecond)
		}
		if !observed {
			t.Fatal("fixture never reached the real blocked recorder")
		}
		if _, err := unix.Write(fd2, []byte("check\n")); err != nil {
			t.Fatal(err)
		}
		if out, err := supervisionReadUntil(fd2, "BUFFER:synthetic-buffer-not-on-disk:", 2*time.Second); err != nil || line(out) == "" || line(out) != line(healthyBefore) {
			t.Fatal("one held recording lock stalled another attempt in the same coordinator", out, err)
		}
		if out, err := supervisionReadUntil(fd, "BUFFER:synthetic-buffer-not-on-disk:", 100*time.Millisecond); err == nil {
			t.Fatal("blocked output bypassed durable recording", out)
		}
		for _, id := range []string{r.ID, secondID} {
			control := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "renew-execution-lease", Username: r.Username, Transport: r.Transport, Body: Request{ID: id}}
			if _, err := e.Command(signedCommand(key, control), r.Username, r.Transport); err != nil {
				t.Fatal("signed peer-state renewal stalled/refused", err)
			}
		}
		if err := unix.Flock(int(lock.Fd()), unix.LOCK_UN); err != nil {
			t.Fatal(err)
		}
		if out, err := supervisionReadUntil(fd, "BUFFER:synthetic-buffer-not-on-disk:", time.Second); err != nil || line(out) == "" || line(out) != line(before) {
			t.Fatal("blocked original shell lost its memory after lock release", out, err)
		}
	}
	if strings.HasPrefix(mode, "timed-fault-") {
		barrier := filepath.Join(e.Config.State, "synthetic-recording-barrier")
		waitMarker := func(stage string) {
			t.Helper()
			for until := time.Now().Add(4 * time.Second); time.Now().Before(until); {
				if b, err := os.ReadFile(barrier + "." + stage); err == nil && string(b) == "actual-recording-fault" {
					return
				}
				time.Sleep(5 * time.Millisecond)
			}
			t.Fatal("actual recording failure never reached "+stage, diagnostics.String())
		}
		// Remove only this synthetic log's pathname. The pinned old file survives;
		// the real recorder's quota traversal must fail before forwarding output.
		if supervised {
			if err := os.Remove(filepath.Join(e.Config.State, "monitoring", r.ID, finalID+".ndjson")); err != nil {
				t.Fatal(err)
			}
		} else if err := os.Rename(filepath.Join(e.Config.State, "monitoring", r.ID), filepath.Join(e.Config.State, "synthetic-recording-backup")); err != nil {
			t.Fatal(err)
		}
		if _, err := unix.Write(fd, []byte("check\n")); err != nil {
			t.Fatal(err)
		}
		waitMarker("before-state")
		expectedDeadline := originalDeadline
		if mode == "timed-fault-pane" {
			if _, err := e.Call("close-pane", Request{ID: r.ID, Pane: finalID}); err != nil {
				t.Fatal("actual targeted close failed", err)
			}
		}
		if mode == "timed-fault-extended-current" {
			if _, err := e.Call("reset-clock", Request{ID: r.ID, ResetID: ManagementID(), Actor: "synthetic-instructor", RequestedAt: Millis(), ExtendSeconds: 60, Deadline: originalDeadline}); err != nil {
				t.Fatal("actual clock extension failed", err)
			}
			expectedDeadline += 60000
		}
		var expectedGeneration int
		if err := e.WithState(func() error {
			a := e.state.Attempts[r.ID]
			if a.State != "ACTIVE" {
				return errors.New("fixture missed active recording fault")
			}
			if mode == "timed-fault-generation" {
				a.Generation++
				a.Transport = "synthetic-new-authenticated-owner"
			}
			if mode == "timed-fault-transport" {
				a.Transport = "synthetic-replaced-owner"
			}
			if mode == "timed-fault-orphan-proof" {
				units := []string{}
				for _, unit := range a.Units {
					pane, _, _, _ := recordedPaneIdentity(a.ID, unit)
					if pane != finalID {
						units = append(units, unit)
					}
				}
				a.Units = units // Leave the otherwise valid proof to test exact tracking.
			}
			expectedGeneration = a.Generation
			return nil
		}); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(barrier+".release", []byte("release-old-failure"), 0600); err != nil {
			t.Fatal(err)
		}
		waitMarker("after-state")
		state, err := readStateSnapshot(e.Config.State)
		if err != nil {
			t.Fatal(err)
		}
		a := state.Attempts[r.ID]
		if mode == "timed-fault-current" || mode == "timed-fault-extended-current" {
			if a.State != "LOCKED" || a.Generation != expectedGeneration+1 || a.Reason != "Class-server terminal recording failure" {
				t.Fatal("current real recording loss was not enforced", a)
			}
		} else if a.State != "ACTIVE" || a.Generation != expectedGeneration {
			t.Fatal("delayed retired recording failure locked a replacement", a)
		}
		if a.Start != originalStart || a.Deadline != expectedDeadline || a.OriginalDeadline != originalDeadline || a.AccessState != "HELD" {
			t.Fatal("recording failure changed original interval/hold", a)
		}
		return
	}
	if mode == "timed" || mode == "timed-isolation" {
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
				_ = exec.Command("/usr/bin/systemctl", "--user", "kill", "--signal=QUIT", coordinatorUnit).Run()
				_ = coordinator.Wait()
				t.Fatal("legacy recorded pane failed", ended, err, diagnostics.String())
			}
		}
		for i, pane := range []string{finalID, secondPane} {
			id := r.ID
			if i == 1 {
				id = secondID
			}
			b, err := os.ReadFile(filepath.Join(e.Config.State, "monitoring", id, pane+".ndjson"))
			if err != nil || !bytes.Contains(b, []byte(`"event":"output"`)) {
				t.Fatal("timed output was not durably recorded", err)
			}
		}
		state, err := readStateSnapshot(e.Config.State)
		if err != nil {
			t.Fatal(err)
		}
		for _, id := range []string{r.ID, secondID} {
			a := state.Attempts[id]
			if a.Start != originalStart || a.Deadline != originalDeadline || a.OriginalDeadline != originalDeadline || a.State != "ACTIVE" || a.AccessState != "HELD" {
				t.Fatal("timed boundary changed interval or restrictions", a)
			}
		}
		return
	}
	for _, pane := range view.Panes {
		if len(pane.RecordedSupervisors) != 1 || pane.RecordedSupervisors[0] != terminalSupervisorUnit(e.Config.State, r.ID) {
			t.Fatal("panes did not share one supervisor", view)
		}
	}
	if mode == "timed-owner-backpressure" || mode == "timed-owner-transport-eof" || mode == "timed-owner-final-output" || mode == "timed-owner-cleanup-retry" {
		if mode == "timed-owner-backpressure" {
			if _, err := unix.Write(fd, []byte("burst\n")); err != nil {
				t.Fatal(err)
			}
		} else if mode == "timed-owner-final-output" || mode == "timed-owner-cleanup-retry" {
			if _, err := unix.Write(fd, []byte("finish\n")); err != nil {
				t.Fatal(err)
			}
			if output, err := supervisionReadUntil(fd, "SYNTHETIC-FINAL-OUTPUT", time.Second); err != nil {
				t.Fatal("final output lost before completion receipt", output, err)
			}
		} else {
			master.Close()
		}
		// Do not drain the outer PTY. Recording must drain independently after
		// verified scope exit; delivery loss is reported separately, never a lock.
		var ended map[string]any
		if err := json.NewDecoder(client).Decode(&ended); err != nil || ended["ended"] != true {
			t.Fatal("backpressure/actual EOF did not complete", ended, err, diagnostics.String())
		}
		if _, err := unix.Write(fd2, []byte("check\n")); err != nil {
			t.Fatal(err)
		}
		if out, err := supervisionReadUntil(fd2, "BUFFER:synthetic-buffer-not-on-disk:", time.Second); err != nil {
			t.Fatal("one ended transport stalled its peer", out, err)
		}
		if _, err := unix.Write(fd2, []byte("finish\n")); err != nil {
			t.Fatal(err)
		}
		var secondEnded map[string]any
		if err := json.NewDecoder(second).Decode(&secondEnded); err != nil || secondEnded["ended"] != true {
			t.Fatal("peer completion lost", secondEnded, err)
		}
		data, err := os.ReadFile(filepath.Join(e.Config.State, "monitoring", r.ID, finalID+".ndjson"))
		if err != nil || !bytes.Contains(data, []byte(`"recording_complete":true`)) {
			t.Fatal("actual EOF/backpressure lost final recording", string(data), err)
		}
		if mode == "timed-owner-backpressure" {
			var decoded bytes.Buffer
			for _, row := range bytes.Split(bytes.TrimSpace(data), []byte{'\n'}) {
				var event struct {
					Data string `json:"data"`
				}
				if json.Unmarshal(row, &event) != nil {
					t.Fatal("invalid event")
				}
				chunk, err := base64.StdEncoding.DecodeString(event.Data)
				if err != nil {
					t.Fatal(err)
				}
				decoded.Write(chunk)
			}
			if strings.Count(decoded.String(), "SYNTHETIC-BURST-") != 4097 || !strings.Contains(decoded.String(), "SYNTHETIC-BURST-00004095-") || !strings.Contains(decoded.String(), "SYNTHETIC-BURST-COMPLETE") {
				t.Fatal("backpressure truncated trusted output", decoded.Len())
			}
		}
		for until := time.Now().Add(2 * time.Second); ; {
			err := e.reconcileTerminalRecordingReports()
			if err == nil {
				break
			}
			if !errors.Is(err, errTerminalReportBusy) || time.Now().After(until) {
				t.Fatal("canonical recording completion did not settle", err)
			}
			time.Sleep(10 * time.Millisecond)
		}
		captured, err := readStateSnapshot(e.Config.State)
		if err != nil {
			t.Fatal(err)
		}
		a := captured.Attempts[r.ID]
		if a.State != "ACTIVE" || a.Start != originalStart || a.Deadline != originalDeadline || a.AccessState != "HELD" {
			t.Fatal("transport/backpressure created policy loss or changed time", a)
		}
		return
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
	if mode == "supervisor" || mode == "timed-owner-death" {
		if mode == "supervisor" {
			select {
			case <-healthyReady:
			case <-time.After(5 * time.Second):
				t.Fatal("healthy actual peer never became ready")
			}
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
		if mode == "timed-owner-death" {
			a := state.Attempts[r.ID]
			if err != nil || len(a.Units) != 0 || a.State != "LOCKED" || a.Start != originalStart || a.Deadline != originalDeadline || a.OriginalDeadline != originalDeadline || a.AccessState != "HELD" {
				t.Fatal("actual timed owner death lost containment/clocks/holds", a, err)
			}
			return
		}
		if err != nil || len(state.Attempts[r.ID].Units) != 0 || state.Attempts[r.ID].Start != 0 || state.Attempts[r.ID].State != "PREPARING" {
			t.Fatal("owner failure stranded metadata or changed preflight timing", state.Attempts[r.ID], err)
		}
		return
	}
	// Kill ALL processes in the exact owned coordinator cgroup, not only its
	// leader. Surviving PTYs must therefore belong to the independent scope.
	var restoreState func()
	if mode == "coordinator" || mode == "observation" || mode == "timed-owner" {
		// Shell output may precede the parent's completion-ownership notice.
		// This workflow deliberately kills AFTER that exact observed boundary;
		// losing an earlier notice correctly retains an UNKNOWN outcome instead.
		confirmed := false
		for until := time.Now().Add(2 * time.Second); time.Now().Before(until); {
			observed, err := ObserveTerminalSupervisor(e.Config.State, r.ID)
			if err == nil && len(observed.ReportedStartedUnits) == 2 {
				confirmed = true
				break
			}
			time.Sleep(5 * time.Millisecond)
		}
		if !confirmed {
			t.Fatal("fixture never observed both normal startup notices")
		}
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
		var restoreOnce sync.Once
		restoreState = func() {
			restoreOnce.Do(func() {
				_ = os.Remove(stateFile)
				if err := os.Rename(backup, stateFile); err != nil {
					t.Error("restore exact synthetic state", err)
				}
			})
		}
		defer restoreState()
		if err := unix.Mkfifo(stateFile, 0600); err != nil {
			t.Fatal(err)
		}
		if mode == "timed-owner" && cliBinary != "" {
			ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
			command := exec.CommandContext(ctx, "/usr/bin/unshare", "--user", "--map-root-user", cliBinary, "panes", "reports", r.ID, "--state", e.Config.State)
			data, err := command.CombinedOutput()
			cancel()
			var view TerminalRecordingReportsSnapshot
			if err != nil || json.Unmarshal(data, &view) != nil || !view.ReadOnly || !view.Complete || len(view.Reports) != 2 {
				t.Fatal("actual reports CLI read global FIFO or lost pending recording owners", string(data), err)
			}
			for _, secret := range []string{r.Transport, r.Username, issued.(map[string]string)["token"]} {
				if bytes.Contains(data, []byte(secret)) {
					t.Fatal("reports CLI leaked private authority")
				}
			}
		}
		if mode == "observation" {
			stateBefore, err := os.Lstat(stateFile)
			if err != nil {
				t.Fatal(err)
			}
			savedBefore, err := os.ReadFile(backup)
			if err != nil {
				t.Fatal(err)
			}
			audit := filepath.Join(e.Config.State, "audit.ndjson")
			auditBefore, err := os.ReadFile(audit)
			if err != nil {
				t.Fatal(err)
			}
			observeCtx, observeCancel := context.WithTimeout(context.Background(), 5*time.Second)
			cmd := exec.CommandContext(observeCtx, "/usr/bin/unshare", "--user", "--map-root-user", cliBinary, "panes", "supervisor", r.ID, "--state", e.Config.State)
			var output, diagnostics bytes.Buffer
			cmd.Stdout, cmd.Stderr = &output, &diagnostics
			err = cmd.Run()
			observeCancel()
			var observed TerminalSupervisorObservation
			if err != nil || diagnostics.Len() != 0 || json.Unmarshal(output.Bytes(), &observed) != nil || !observed.ObservationOnly || observed.AttachedPanes != 2 || len(observed.AttachedUnits) != 2 || observed.Attempt != r.ID || observed.Supervisor != terminalSupervisorUnit(e.Config.State, r.ID) {
				t.Fatal("actual root CLI failed live query after inherited listener creator death", output.String(), diagnostics.String(), err)
			}
			for _, secret := range []string{issued.(map[string]string)["token"], secondIssued.(map[string]string)["token"], r.Transport, r.Username} {
				if strings.Contains(output.String()+diagnostics.String(), secret) {
					t.Fatal("supervisor metadata exposed private account/admission context")
				}
			}
			refuseSupervisorControlQueries(t, e.Config.State, r.ID, observed.PID)
			current, err := ObserveTerminalSupervisor(e.Config.State, r.ID)
			if err != nil || current.PID != observed.PID || current.AttachedPanes != 2 {
				t.Fatal("inspection controls changed supervisor ownership/panes", current, err)
			}
			stateAfter, err := os.Lstat(stateFile)
			if err != nil {
				t.Fatal(err)
			}
			savedAfter, err := os.ReadFile(backup)
			if err != nil {
				t.Fatal(err)
			}
			auditAfter, err := os.ReadFile(audit)
			if err != nil || !bytes.Equal(auditBefore, auditAfter) || !bytes.Equal(savedBefore, savedAfter) || !os.SameFile(stateBefore, stateAfter) || stateBefore.Sys().(*syscall.Stat_t).Ctim != stateAfter.Sys().(*syscall.Stat_t).Ctim {
				t.Fatal("live CLI initialized/read/reconciled or changed synthetic state/audit", err)
			}
		}
	}
	if _, err := unix.Write(fd, []byte("check\n")); err != nil {
		t.Fatal(err)
	}
	after, err := supervisionReadUntil(fd, "BUFFER:synthetic-buffer-not-on-disk:", time.Second)
	if err != nil {
		t.Fatalf("coordinator death lost the actual PTY/shell memory: %v output=%q", err, after)
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
	if mode == "timed-owner" {
		restoreState()
		for _, pane := range []string{finalID, secondPane} {
			data, err := os.ReadFile(filepath.Join(e.Config.State, "monitoring", r.ID, pane+".ndjson"))
			var output bytes.Buffer
			for _, row := range bytes.Split(bytes.TrimSpace(data), []byte{'\n'}) {
				var event struct {
					Event string `json:"event"`
					Data  string `json:"data"`
				}
				if json.Unmarshal(row, &event) != nil {
					t.Fatal("invalid trusted recording JSON")
				}
				if event.Event == "output" {
					decoded, err := base64.StdEncoding.DecodeString(event.Data)
					if err != nil {
						t.Fatal(err)
					}
					output.Write(decoded)
				}
			}
			if err != nil || !bytes.Contains(data, []byte(`"recording_instance":`)) || !bytes.Contains(data, []byte(`"recording_complete":true`)) || !strings.Contains(output.String(), "BUFFER:synthetic-buffer-not-on-disk:") || (pane == finalID && strings.Count(output.String(), line(before)) < 2) {
				t.Fatal("independent recorder lost output/final durable close after whole coordinator death", pane, string(data), err)
			}
		}
		dir, err := terminalReportDirectory(e.Config.State, r.ID)
		if err != nil {
			t.Fatal(err)
		}
		files, err := dir.ReadDir(-1)
		if err != nil || len(files) != 2 {
			t.Fatal("finished reports did not survive coordinator death", files, err)
		}
		for _, file := range files {
			report, _, err := readTerminalRecordingReport(dir, file.Name())
			if err != nil || !report.Closed || !report.RecordingComplete || !report.CleanupComplete || !report.DeliveryComplete || report.Fault != "" {
				t.Fatal("final report did not prove recording/cleanup", report, err)
			}
		}
		dir.Close()
		restarted, err := New(e.Config)
		if err != nil {
			t.Fatal(err)
		}
		if err := restarted.Tick(); err != nil {
			t.Fatal("actual restarted Tick could not acknowledge completion", err)
		}
		after, err := readStateSnapshot(e.Config.State)
		if err != nil {
			t.Fatal(err)
		}
		a := after.Attempts[r.ID]
		if len(a.Units) != 0 || len(after.PaneInstances) != 0 || a.Start != originalStart || a.Deadline != originalDeadline || a.OriginalDeadline != originalDeadline || a.State != "ACTIVE" || a.AccessState != "HELD" {
			t.Fatal("restart erased an unacknowledged failure or changed clocks/holds", a, after.PaneInstances)
		}
		remaining, err := os.ReadDir(filepath.Join(e.Config.State, "terminal-supervisors", r.ID))
		if err != nil || len(remaining) != 0 {
			t.Fatal("durably acknowledged reports still reserve capacity", remaining, err)
		}
	}
}
