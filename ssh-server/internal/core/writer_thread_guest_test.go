package core

// Real UID/cgroup qualification only inside the guarded disposable guest.
// No installed host process, account, attempt or service is modified.
import (
	"bufio"
	"context"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestWriterThreadGroupGuest(t *testing.T) {
	uid := requireMonitoringGuest(t, "writer-threads", "EXAM_WRITER_THREADS_GUEST")
	account, err := user.Lookup("examq")
	if err != nil {
		t.Fatal(err)
	}
	gid, err := strconv.Atoi(account.Gid)
	if err != nil || gid < 1000 {
		t.Fatal("invalid synthetic GID")
	}
	dir, err := os.MkdirTemp("/var/tmp", "qualification-thread-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) }) // Exact new guest-only directory.
	if os.Chmod(dir, 0o755) != nil || os.Mkdir(filepath.Join(dir, "work"), 0o700) != nil || os.Chown(filepath.Join(dir, "work"), uid, gid) != nil {
		t.Fatal("synthetic work unavailable")
	}
	// The manifested input parent is deliberately root-private. Copy only this
	// bounded test executable to our new root-owned guest directory, never chmod
	// that input mount or install into a command/system path.
	probe, err := os.ReadFile("/run/ssh-exam-qualification-input/thread-leader-probe")
	if err != nil || len(probe) == 0 || len(probe) > 2*1024*1024 {
		t.Fatal("manifested thread fixture unavailable", err)
	}
	fixture := filepath.Join(dir, "thread-leader-probe")
	if err := os.WriteFile(fixture, probe, 0o755); err != nil {
		t.Fatal(err)
	}
	start := func(name string, scoped bool) (*exec.Cmd, int, string, string) {
		t.Helper()
		output := filepath.Join(dir, "work", name)
		unit := ""
		var command *exec.Cmd
		if scoped {
			unit = "exam-qualification-thread-" + Token()[:16] + ".scope"
			command = exec.Command("/usr/bin/systemd-run", "--scope", "--quiet", "--unit="+strings.TrimSuffix(unit, ".scope"), "--slice=exam.slice", "--property=Delegate=no", "--property=MemoryMax=64M", "--property=MemorySwapMax=0", "--property=TasksMax=16", "--property=RuntimeMaxSec=20s", "--", "/usr/bin/setpriv", "--reuid", strconv.Itoa(uid), "--regid", strconv.Itoa(gid), "--clear-groups", "--inh-caps=-all", "--ambient-caps=-all", "--bounding-set=-all", "--no-new-privs", "--", fixture, output)
		} else {
			command = exec.Command(fixture, output)
			command.SysProcAttr = &syscall.SysProcAttr{Credential: &syscall.Credential{Uid: uint32(uid), Gid: uint32(gid), Groups: []uint32{}}}
		}
		pipe, err := command.StdoutPipe()
		if err != nil {
			t.Fatal(err)
		}
		command.Stderr = os.Stderr
		if err := command.Start(); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			_ = command.Process.Kill() // Exact owned child only.
			_ = command.Wait()
			if unit != "" {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				_ = exec.CommandContext(ctx, "/usr/bin/systemctl", "stop", unit).Run()
			}
		})
		_ = pipe.(*os.File).SetReadDeadline(time.Now().Add(5 * time.Second))
		line, err := bufio.NewReaderSize(pipe, 1024).ReadString('\n')
		var pid, tid int
		if err != nil || len(line) > 1024 {
			t.Fatal("owned fixture report unavailable", err)
		}
		if _, err := fmt.Sscanf(line, "%d %d", &pid, &tid); err != nil || pid != command.Process.Pid || tid == pid {
			t.Fatal("owned guest fixture identity changed", line, err)
		}
		until := time.Now().Add(2 * time.Second)
		for {
			status, err := os.ReadFile(fmt.Sprintf("/proc/%d/status", pid))
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(string(status), "State:\tZ") {
				break
			}
			if time.Now().After(until) {
				t.Fatal("main thread did not exit")
			}
			time.Sleep(time.Millisecond)
		}
		p, err := pinUIDProcess(pid, uid)
		if err != nil || p == nil {
			t.Fatal("surviving guest thread group omitted", err)
		}
		p.close()
		return command, pid, output, unit
	}
	_, containedPID, containedOutput, unit := start("contained", true)
	e := &Engine{state: State{Registrations: map[string]string{}}}
	deadline := Millis() + 60000
	a := &Attempt{ID: finalID, Username: "examq", UID: uid, State: "ACTIVE", Start: Millis(), Deadline: deadline, OriginalDeadline: deadline, Units: []string{unit}}
	if err := e.verifyWriters(a); err != nil {
		t.Fatal("live contained thread group refused", err)
	}
	if err := e.freeze(a, true); err != nil {
		t.Fatal("guest thread freeze unverified", err)
	}
	defer e.freeze(a, false)
	if err := e.verifyWriters(a); err != nil {
		t.Fatal("contained frozen thread group refused", err)
	}
	before, err := os.Stat(containedOutput)
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(75 * time.Millisecond)
	after, err := os.Stat(containedOutput)
	if err != nil || after.Size() != before.Size() {
		t.Fatal("frozen surviving thread kept writing", err)
	}
	_, outsidePID, _, _ := start("uncontained", false)
	for _, verify := range []func(*Attempt) error{e.verifyWriters, e.verifyReleaseWriters} {
		if err := verify(a); err == nil || !strings.Contains(err.Error(), "uncontained process "+strconv.Itoa(outsidePID)) {
			t.Fatal("live uncontained surviving worker accepted", err)
		}
	}
	outside, err := pinUIDProcess(outsidePID, uid)
	if err != nil || outside == nil {
		t.Fatal(err)
	}
	defer outside.close()
	// Tamper only the cached number with ANOTHER OWNED child: any regression to
	// numeric signalling kills the wrong fixture and makes the assertions fail.
	outside.pid = containedPID
	if err := outside.kill(uid); err != nil {
		t.Fatal("pinned surviving worker termination failed", err)
	}
	until := time.Now().Add(2 * time.Second)
	for {
		live, err := outside.live()
		if err != nil {
			t.Fatal(err)
		}
		if !live {
			break
		}
		if time.Now().After(until) {
			t.Fatal("exact outside thread group remains live")
		}
		time.Sleep(time.Millisecond)
	}
	contained, err := pinUIDProcess(containedPID, uid)
	if err != nil || contained == nil {
		t.Fatal("cached PID confusion affected contained peer", err)
	}
	defer contained.close()
	if err := e.verifyWriters(a); err != nil {
		t.Fatal("dead zombie outside group blocked collection", err)
	}
	if err := e.freeze(a, false); err != nil {
		t.Fatal(err)
	}
	until = time.Now().Add(time.Second)
	for {
		resumed, err := os.Stat(containedOutput)
		if err != nil {
			t.Fatal(err)
		}
		if resumed.Size() > after.Size() {
			break
		}
		if time.Now().After(until) {
			t.Fatal("unrelated contained peer did not resume")
		}
		time.Sleep(time.Millisecond)
	}
	if a.Deadline != deadline || a.OriginalDeadline != deadline {
		t.Fatal("thread checks changed deadlines")
	}
	t.Log("dead leader/live worker positively contained and frozen; uncontained worker blocks collection/restoration; exact pinned kill ignores another owned cached PID; contained peer resumes; deadlines unchanged")
}
