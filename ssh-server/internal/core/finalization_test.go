package core

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
)

const finalID = "12345678-1234-1234-1234-123456789abc"

func finalFixture(t *testing.T, state string, deadline int64) (*Engine, Config, string) {
	t.Helper()
	c := Config{State: t.TempDir(), Work: t.TempDir()}
	e, err := New(c)
	if err != nil {
		t.Fatal(err)
	}
	e.quiesce = func(*Attempt) error { return nil }
	e.terminate = func(*Attempt) error { return nil }
	source := filepath.Join(c.Work, finalID, "work")
	if err = os.MkdirAll(source, 0700); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(source, "answer.txt"), []byte("saved answer"), 0600)
	if err = e.WithState(func() error {
		e.state.Attempts[finalID] = &Attempt{ID: finalID, Exam: "exam", Username: "student", UID: 1001, State: state, Settings: Settings{Duration: 5400, Template: "v1"}, Start: deadline - 5400000, Deadline: deadline, Lease: deadline, WorkPath: "/work", Boot: boot(), UptimeDeadline: uptime() + 10000}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return e, c, source
}
func inspectFinal(t *testing.T, e *Engine) *Attempt {
	t.Helper()
	r, err := e.Call("inspect-attempt", Request{ID: finalID})
	if err != nil {
		t.Fatal(err)
	}
	return r.(*Attempt)
}
func TestAuthoritativeIndividualDeadline(t *testing.T) {
	for _, duration := range []int64{5400, 7200, 3600} {
		a := &Attempt{Settings: Settings{Duration: duration}}
		commitStart(a, 1000000, 10, "boot")
		if a.Deadline != 1000000+duration*1000 || a.UptimeDeadline != 10+float64(duration) {
			t.Fatal("individual duration lost")
		}
	}
}
func TestDeadlineCollectsWithoutBrowserOrGateway(t *testing.T) {
	for _, state := range []string{"ACTIVE", "LOCKED"} {
		t.Run(state, func(t *testing.T) {
			e, c, _ := finalFixture(t, state, Millis()-1000)
			if err := e.Tick(); err != nil {
				t.Fatal(err)
			}
			a := inspectFinal(t, e)
			if a.State != "COMPLETED" || !a.Protected || a.Reason != "expiration" || a.Ended != a.Deadline || a.CompletedAt < a.Deadline || a.CollectedAt < a.CompletedAt || a.SecuredAt < a.CollectedAt {
				t.Fatalf("invalid receipt: %+v", a)
			}
			m, err := ReadProtected(filepath.Join(c.State, "submissions", finalID), a)
			if err != nil || m.Attempt.Username != "student" || len(m.Files) != 1 {
				t.Fatalf("manifest: %+v %v", m, err)
			}
		})
	}
}
func TestEarlyFinishUsesSameCollector(t *testing.T) {
	e, _, _ := finalFixture(t, "ACTIVE", Millis()+5400000)
	r, err := e.Call("finalize-attempt", Request{ID: finalID, Reason: "student finish"})
	if err != nil {
		t.Fatal(err)
	}
	a := r.(*Attempt)
	if !a.Protected || a.State != "COMPLETED" || a.Reason != "student finish" || a.Ended >= a.Deadline {
		t.Fatalf("bad early finish %+v", a)
	}
}
func TestConcurrentFinishAndDeadlineCannotReplaceSubmission(t *testing.T) {
	e, c, source := finalFixture(t, "ACTIVE", Millis()-1000)
	second, _ := New(c)
	second.quiesce = func(*Attempt) error { return nil }
	second.terminate = func(*Attempt) error { return nil }
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		if err := e.Tick(); err != nil {
			t.Error(err)
		}
	}()
	go func() {
		defer wg.Done()
		if _, err := second.Call("finalize-attempt", Request{ID: finalID, Reason: "student finish"}); err != nil {
			t.Error(err)
		}
	}()
	wg.Wait()
	a := inspectFinal(t, e)
	if a.Reason != "expiration" || !a.Protected {
		t.Fatal("conflicting finish reason")
	}
	archive := filepath.Join(c.State, "submissions", finalID, "submission.tar.gz")
	before, _ := os.ReadFile(archive)
	os.WriteFile(filepath.Join(source, "answer.txt"), []byte("later changed answer"), 0600)
	if _, err := second.Call("finalize-attempt", Request{ID: finalID, Reason: "student finish"}); err != nil {
		t.Fatal(err)
	}
	after, _ := os.ReadFile(archive)
	if string(before) != string(after) {
		t.Fatal("final submission replaced")
	}
}
func TestRestartAdoptsBundleCommittedBeforeStateSave(t *testing.T) {
	e, c, source := finalFixture(t, "ACTIVE", Millis()+5400000)
	if err := e.WithState(func() error {
		a := e.state.Attempts[finalID]
		a.State = "FINALIZING"
		a.Reason = "student finish"
		a.Ended = Millis()
		a.CompletedAt = a.Ended
		_, err := Collect(source, filepath.Join(c.State, "submissions", finalID), a)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	os.RemoveAll(source)
	restarted, _ := New(c)
	restarted.quiesce = func(*Attempt) error { t.Fatal("recollected after publication"); return nil }
	restarted.terminate = func(*Attempt) error { return nil }
	if err := restarted.Tick(); err != nil {
		t.Fatal(err)
	}
	a := inspectFinal(t, restarted)
	if !a.Protected || a.State != "COMPLETED" || a.Reason != "student finish" {
		t.Fatal("failed bundle recovery")
	}
}
func TestCollectionFailureAndRestartRecovery(t *testing.T) {
	e, c, source := finalFixture(t, "ACTIVE", Millis()-1000)
	os.Link(filepath.Join(source, "answer.txt"), filepath.Join(source, "hardlink"))
	e.Tick()
	a := inspectFinal(t, e)
	if a.State != "COLLECTION_FAILED" || a.Protected || len(a.Errors) == 0 {
		t.Fatal("unsafe collection declared secured")
	}
	e.WithState(func() error {
		if e.Busy(1001) == nil {
			t.Fatal("account exclusion released")
		}
		return nil
	})
	os.Remove(filepath.Join(source, "hardlink"))
	restarted, _ := New(c)
	restarted.quiesce = func(*Attempt) error { return nil }
	restarted.terminate = func(*Attempt) error { return nil }
	restarted.Tick()
	if a = inspectFinal(t, restarted); !a.Protected || a.State != "COMPLETED" {
		t.Fatal("collection did not recover")
	}
}
func TestTerminationFailureRetriesOnlyProtectedCopy(t *testing.T) {
	e, c, source := finalFixture(t, "ACTIVE", Millis()-1000)
	e.terminate = func(*Attempt) error { return errors.New("termination unconfirmed") }
	e.Tick()
	a := inspectFinal(t, e)
	if !a.Protected || a.State != "COLLECTION_FAILED" {
		t.Fatal("lost distinction between collection and cleanup")
	}
	before, _ := os.ReadFile(filepath.Join(c.State, "submissions", finalID, "submission.tar.gz"))
	os.RemoveAll(source)
	restarted, _ := New(c)
	restarted.quiesce = func(*Attempt) error { return errors.New("source no longer exists") }
	restarted.terminate = func(*Attempt) error { return nil }
	restarted.Tick()
	after, _ := os.ReadFile(filepath.Join(c.State, "submissions", finalID, "submission.tar.gz"))
	if string(before) != string(after) || inspectFinal(t, restarted).State != "COMPLETED" {
		t.Fatal("protected copy was not retained")
	}
}
func TestWriterBarrierFailureNeverPublishes(t *testing.T) {
	e, c, _ := finalFixture(t, "ACTIVE", Millis()-1000)
	e.quiesce = func(*Attempt) error { return errors.New("background writer not frozen") }
	e.Tick()
	a := inspectFinal(t, e)
	if a.Protected || a.State != "COLLECTION_FAILED" {
		t.Fatal("published with active writer")
	}
	if _, err := os.Stat(filepath.Join(c.State, "submissions", finalID)); !os.IsNotExist(err) {
		t.Fatal("archive exists without writer barrier")
	}
}
func TestIncompleteOrDamagedBundleIsNeverReplaced(t *testing.T) {
	for _, damage := range []string{"incomplete", "corrupt"} {
		t.Run(damage, func(t *testing.T) {
			e, c, source := finalFixture(t, "ACTIVE", Millis()-1000)
			dest := filepath.Join(c.State, "submissions", finalID)
			a := inspectFinal(t, e)
			if damage == "corrupt" {
				if _, err := Collect(source, dest, a); err != nil {
					t.Fatal(err)
				}
			} else {
				os.MkdirAll(dest, 0700)
			}
			os.WriteFile(filepath.Join(dest, "submission.tar.gz"), []byte("damaged protected artifact"), 0600)
			e.Tick()
			if inspectFinal(t, e).State != "COLLECTION_FAILED" {
				t.Fatal("damage declared success")
			}
			b, _ := os.ReadFile(filepath.Join(dest, "submission.tar.gz"))
			if string(b) != "damaged protected artifact" {
				t.Fatal("damaged bundle overwritten by new work")
			}
		})
	}
}

// This helper is a real detached writer with an open writable descriptor. The test injects
// a SIGSTOP barrier; systemd/cgroup containment itself still needs privileged deployment QA.
func TestBackgroundWriterHelper(t *testing.T) {
	file := os.Getenv("EXAM_WRITER_FIXTURE")
	if file == "" {
		return
	}
	f, err := os.OpenFile(file, os.O_WRONLY, 0600)
	if err != nil {
		os.Exit(2)
	}
	defer f.Close()
	f.WriteAt([]byte(strings.Repeat(fmt.Sprintf("background saved work %010d\n", 0), 100)), 0)
	fmt.Fprintln(os.Stdout, "writer ready")
	for i := 1; ; i++ {
		f.WriteAt([]byte(strings.Repeat(fmt.Sprintf("background saved work %010d\n", i), 100)), 0)
		time.Sleep(time.Millisecond)
	}
}
func TestOpenDescriptorBackgroundWriterIsStoppedBeforeCollection(t *testing.T) {
	e, _, source := finalFixture(t, "ACTIVE", Millis()+5400000)
	file := filepath.Join(source, "answer.txt")
	writer := exec.Command(os.Args[0], "-test.run=^TestBackgroundWriterHelper$")
	writer.Env = append(os.Environ(), "EXAM_WRITER_FIXTURE="+file)
	ready, err := writer.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := writer.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { writer.Process.Kill(); writer.Wait() }()
	if _, err := bufio.NewReader(ready).ReadString('\n'); err != nil {
		t.Fatal(err)
	}
	var frozen []byte
	e.quiesce = func(*Attempt) error {
		if err := writer.Process.Signal(syscall.SIGSTOP); err != nil {
			return err
		}
		for i := 0; i < 100; i++ {
			status, _ := os.ReadFile(fmtProc(writer.Process.Pid))
			if strings.Contains(string(status), "State:\tT") {
				frozen, _ = os.ReadFile(file)
				return nil
			}
			time.Sleep(time.Millisecond)
		}
		return errors.New("background writer did not stop")
	}
	e.terminate = func(*Attempt) error {
		if err := writer.Process.Kill(); err != nil {
			return err
		}
		return nil
	}
	if _, err := e.Call("finalize-attempt", Request{ID: finalID, Reason: "student finish"}); err != nil {
		t.Fatal(err)
	}
	a := inspectFinal(t, e)
	m, err := ReadProtected(filepath.Join(e.Config.State, "submissions", finalID), a)
	if err != nil {
		t.Fatal(err)
	}
	if len(m.Files) != 1 || m.Files[0].Hash != Hash(frozen) {
		t.Fatal("writer changed the collected view")
	}
}
func fmtProc(pid int) string { return filepath.Join("/proc", strconv.Itoa(pid), "status") }
func TestUncontainedUIDWriterFailsClosed(t *testing.T) {
	e, _, _ := finalFixture(t, "ACTIVE", Millis()-1000)
	// The test's own process is deliberately outside any exam cgroup. No signals are sent.
	a := &Attempt{UID: os.Getuid(), Units: []string{}}
	if err := e.verifyWriters(a); err == nil {
		t.Fatal("uncontained writer was accepted")
	}
}
func TestConfiguredDirectoryLabel(t *testing.T) {
	e, _, _ := finalFixture(t, "ACTIVE", Millis()+5400000)
	if e.directory() != "/work" {
		t.Fatal("default directory lost")
	}
	e.Config.ExamDirectory = "/exam/project"
	if e.directory() != "/exam/project" {
		t.Fatal("configured directory ignored")
	}
	e.WithState(func() error { e.state.Attempts[finalID].WorkPath = e.directory(); return nil })
	if _, err := e.Call("finalize-attempt", Request{ID: finalID, Reason: "student finish"}); err != nil {
		t.Fatal(err)
	}
	a := inspectFinal(t, e)
	m, err := ReadProtected(filepath.Join(e.Config.State, "submissions", finalID), a)
	if err != nil || m.Attempt.WorkPath != "/exam/project" {
		t.Fatal("manifest directory label lost")
	}
}
func TestDeadlineCutoffDoesNotWaitForCollectionLock(t *testing.T) {
	e, _, _ := finalFixture(t, "ACTIVE", Millis()-1000)
	froze := false
	e.cutoff = func(a *Attempt) error {
		froze = true
		if a.Deadline > Millis() {
			t.Fatal("wrong deadline")
		}
		return nil
	}
	locked := make(chan struct{})
	release := make(chan struct{})
	finished := make(chan struct{})
	go func() { defer close(finished); e.WithState(func() error { close(locked); <-release; return nil }) }()
	<-locked
	cutoffDone := make(chan error, 1)
	go func() { cutoffDone <- e.Cutoff() }()
	select {
	case err := <-cutoffDone:
		if err != nil {
			t.Error(err)
		}
		if !froze {
			t.Error("cutoff missed expired writer")
		}
	case <-time.After(time.Second):
		t.Error("cutoff waited for archival state lock")
	}
	close(release)
	<-finished
}
func TestMonotonicDeadlineStillBlocksAfterBackwardClock(t *testing.T) {
	e, _, _ := finalFixture(t, "LOCKED", Millis()+5400000)
	e.WithState(func() error {
		a := e.state.Attempts[finalID]
		a.UptimeDeadline = uptime() - 1
		a.Authorization = Millis() + 10000
		return nil
	})
	if _, err := e.Call("consume-continuation", Request{ID: finalID}); err == nil {
		t.Fatal("thawed workload past monotonic deadline")
	}
	e.cutoff = func(*Attempt) error { return nil }
	e.Tick()
	if a := inspectFinal(t, e); a.State != "COMPLETED" || a.Reason != "expiration" {
		t.Fatal("monotonic deadline not collected")
	}
}
func TestCutoffFailureDoesNotSkipOtherExpiredAttempts(t *testing.T) {
	e, _, _ := finalFixture(t, "ACTIVE", Millis()-1000)
	e.WithState(func() error {
		copy := *e.state.Attempts[finalID]
		copy.ID = "12345678-1234-1234-1234-123456789abd"
		copy.UID = 1002
		e.state.Attempts[copy.ID] = &copy
		return nil
	})
	calls := 0
	e.cutoff = func(a *Attempt) error {
		calls++
		if a.ID == finalID {
			return errors.New("freeze failed")
		}
		return nil
	}
	if err := e.Cutoff(); err == nil || calls != 2 {
		t.Fatal("one failed freeze skipped another deadline")
	}
}
