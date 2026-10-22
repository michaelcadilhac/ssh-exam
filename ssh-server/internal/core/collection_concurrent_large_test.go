package core

// Test-only default-ceiling concurrency. Actual user-systemd children, private
// persistent scratch and signed native APIs; UID/SSH/writer guards are fake.
// This is NOT root PAM/SSH containment or production capacity certification.
import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime/trace"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
)

func TestConcurrentDefaultSizeCollectionsKeepHealthySignedControl(t *testing.T) {
	if os.Getenv("EXAM_LARGE_COLLECTION") != "1" {
		t.Skip("requires explicit default-size private-disk/user-systemd qualification")
	}
	// Signed inspection also commits an anti-replay nonce. Apply the existing
	// single-large-worker durable-IO qualification budget, not the separate
	// subsecond controlled-lock benchmark. This is NOT a no-false-hold guarantee
	// for arbitrary storage stalls or a change to the live 15-second lease.
	const durableIOBudget = 3 * time.Second
	const diagnosticBudget = time.Second
	e, key, _ := leaseFixture(t)
	var disk syscall.Statfs_t
	if err := syscall.Statfs(e.Config.State, &disk); err != nil {
		t.Fatal(err)
	}
	if memoryBackedFilesystem(disk.Type) || disk.Bavail*uint64(disk.Bsize) < 5*1024*1024*1024 {
		t.Skip("need private persistent disk scratch with5GiB free; no simultaneous-default-size qualification performed")
	}
	second, healthy := ManagementID(), ManagementID()
	e.Config.Accounts = map[string]Account{"student": {UID: os.Getuid(), GID: os.Getgid()}, "second": {UID: 1003, GID: 1003}, "healthy": {UID: 1002, GID: 1002}, "newstudent": {UID: 1004, GID: 1004}}
	if err := e.WithState(func() error {
		a := e.state.Attempts[finalID]
		a.UID = os.Getuid()
		a.Settings.CollectionFileMiB = 128
		a.Settings.CollectionTotalMiB = 512
		b := *a
		b.ID = second
		b.Username = "second"
		b.UID = 1003
		b.Transport = "ssh-second"
		e.state.Attempts[second] = &b
		h := *a
		h.ID = healthy
		h.Username = "healthy"
		h.UID = 1002
		h.Transport = "ssh-healthy"
		h.Generation = 7
		h.Settings.Terminals = 4
		e.state.Attempts[healthy] = &h
		e.state.Registrations[b.Transport] = b.Username
		e.state.Registrations[h.Transport] = h.Username
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(e.Config.Work, finalID, "work", "answer.txt")); err != nil {
		t.Fatal(err)
	}
	expected := map[string]map[string]string{}
	for _, id := range []string{finalID, second} {
		work := filepath.Join(e.Config.Work, id, "work")
		if err := os.MkdirAll(work, 0700); err != nil {
			t.Fatal(err)
		}
		expected[id] = map[string]string{}
		for n := 0; n < 4; n++ {
			name := fmt.Sprintf("artifact-%d.bin", n)
			file, err := os.OpenFile(filepath.Join(work, name), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
			if err != nil {
				t.Fatal(err)
			}
			block := make([]byte, 1024*1024)
			if _, err := rand.Read(block); err != nil {
				file.Close()
				t.Fatal(err)
			}
			hash := sha256.New()
			out := io.MultiWriter(file, hash)
			for count := 0; count < 128; count++ {
				if _, err := out.Write(block); err != nil {
					file.Close()
					t.Fatal(err)
				}
			}
			if err := file.Sync(); err != nil {
				file.Close()
				t.Fatal(err)
			}
			if err := file.Close(); err != nil {
				t.Fatal(err)
			}
			expected[id][name] = hex.EncodeToString(hash.Sum(nil))
		}
	}
	// Begin measurement only after flushing fixture writes. Do not classify a
	// setup journal flush as a running healthy student's renewal outage.
	if err := e.WithState(func() error { e.state.Attempts[healthy].Lease = Millis() + 15000; return nil }); err != nil {
		t.Fatal(err)
	}
	before, err := readStateSnapshot(e.Config.State)
	if err != nil {
		t.Fatal(err)
	}
	var unitsMu sync.Mutex
	units := []string{}
	unitSnapshot := func() []string { unitsMu.Lock(); defer unitsMu.Unlock(); return append([]string(nil), units...) }
	e.workerCommand = func(string) []string {
		unit := "ssh-exam-concurrent-large-" + Token()[:12] + ".service"
		unitsMu.Lock()
		units = append(units, unit)
		unitsMu.Unlock()
		base := collectionServiceArgs(unit, os.Args[0])
		args := []string{base[0], "--user", "--property=MemoryAccounting=yes"}
		for _, arg := range base[1:] {
			switch arg {
			case "--collect", "--property=Slice=exam-collection.slice":
				continue
			case collectionWorkerFlag:
				args = append(args, "-test.run=^TestCollectionChild$", "--", "success")
			default:
				args = append(args, arg)
			}
		}
		return args
	}
	e.workerTimeout = 130 * time.Second
	e.collectionRun = e.runCollectionProcess
	stopUnits := func() {
		for _, unit := range unitSnapshot() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			_ = exec.CommandContext(ctx, "/usr/bin/systemctl", "--user", "stop", unit).Run()
			cancel()
		}
	}
	t.Cleanup(func() {
		stopUnits()
		for _, unit := range unitSnapshot() {
			_ = exec.Command("/usr/bin/systemctl", "--user", "reset-failed", unit).Run()
		}
	})
	stopRenew := make(chan struct{})
	renewDone := make(chan struct{})
	renewErrors := make(chan error, 1)
	var metricsMu sync.Mutex
	beats := 0
	maxRenewal := time.Duration(0)
	go func() {
		defer close(renewDone)
		for {
			cmd := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "renew-execution-lease", Username: "healthy", Transport: "ssh-healthy", Body: Request{ID: healthy}}
			started := time.Now()
			region := trace.StartRegion(context.Background(), "healthy-renewal")
			_, err := e.Command(signedCommand(key, cmd), "healthy", "ssh-healthy")
			region.End()
			elapsed := time.Since(started)
			if err != nil {
				renewErrors <- err
				return
			}
			metricsMu.Lock()
			beats++
			if elapsed > maxRenewal {
				maxRenewal = elapsed
			}
			metricsMu.Unlock()
			select {
			case <-stopRenew:
				return
			case <-time.After(500 * time.Millisecond):
			}
		}
	}()
	defer func() {
		close(stopRenew)
		select {
		case <-renewDone:
		case <-time.After(5 * time.Second):
			t.Error("owned healthy renewal loop did not settle")
		}
	}()
	finished := make(chan error, 2)
	gate := make(chan struct{})
	for _, id := range []string{finalID, second} {
		go func(id string) {
			<-gate
			_, err := e.Call("finalize-attempt", Request{ID: id, Reason: "Explicit synthetic simultaneous default-size collection"})
			finished <- err
		}(id)
	}
	remaining := 2
	defer func() {
		if remaining > 0 {
			stopUnits()
			for remaining > 0 {
				select {
				case <-finished:
					remaining--
				case <-time.After(8 * time.Second):
					t.Error("owned large collector did not settle")
					return
				}
			}
		}
	}()
	started := time.Now()
	close(gate)
	observed := map[string]uint64{}
	simultaneous := false
	maxInspect := time.Duration(0)
	maxManagement := time.Duration(0)
	maxReadOnly := time.Duration(0)
	readOnlyUnavailable := 0
	readOnlySuccess := 0
	admitted := false
	inspect := func() {
		t.Helper()
		readAt := time.Now()
		readRegion := trace.StartRegion(context.Background(), "no-fsync-readonly")
		if _, err := ObserveNativeReadOnly(e.Config.State, ReadOnlyQuery{ID: healthy, Limit: 1}); err != nil {
			// An observed concurrent file replacement is unavailable metadata,
			// never work/policy failure. Count it instead of inventing a state.
			readOnlyUnavailable++
		} else {
			readOnlySuccess++
		}
		readRegion.End()
		if elapsed := time.Since(readAt); elapsed > maxReadOnly {
			maxReadOnly = elapsed
		}
		cmd := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "inspect-attempt", Username: "healthy", Transport: "ssh-healthy", Body: Request{ID: healthy}}
		at := time.Now()
		region := trace.StartRegion(context.Background(), "signed-inspection")
		value, err := e.Command(signedCommand(key, cmd), "healthy", "ssh-healthy")
		region.End()
		elapsed := time.Since(at)
		if err != nil {
			t.Fatal("simultaneous large jobs blocked signed inspection", err)
		}
		if elapsed > maxInspect {
			maxInspect = elapsed
		}
		a := value.(*Attempt)
		old := before.Attempts[healthy]
		if a.State != "ACTIVE" || a.Generation != old.Generation || a.Deadline != old.Deadline || a.OriginalDeadline != old.OriginalDeadline || a.Transport != old.Transport || a.Lease <= Millis() {
			t.Fatal("large jobs changed healthy ownership or interval")
		}
		if !admitted {
			register := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "register", Username: "newstudent"}
			pane := ManagementID()
			open := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "issue-channel-admission", Username: "healthy", Transport: "ssh-healthy", Body: Request{ID: healthy, Pane: pane, Username: "healthy", Transport: "ssh-healthy", Purpose: "exam"}}
			closePane := open
			closePane.Nonce = Token()
			closePane.Op = "close-pane"
			for _, request := range []struct {
				command   Command
				transport string
			}{{register, "fresh-concurrent-large"}, {open, "ssh-healthy"}, {closePane, "ssh-healthy"}} {
				at := time.Now()
				_, err := e.Command(signedCommand(key, request.command), request.command.Username, request.transport)
				elapsed := time.Since(at)
				if elapsed > maxManagement {
					maxManagement = elapsed
				}
				if err != nil {
					t.Fatal("large jobs interrupted signed registration/pane workflow", request.command.Op, err)
				}
			}
			admitted = true
		}
	}
	observe := func() {
		t.Helper()
		live := 0
		for _, unit := range unitSnapshot() {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			out, err := exec.CommandContext(ctx, "/usr/bin/systemctl", "--user", "show", unit, "--property=ControlGroup", "--value").Output()
			cancel()
			group := strings.TrimSpace(string(out))
			if err != nil || group == "" {
				continue
			}
			if !filepath.IsAbs(group) || filepath.Clean(group) != group || group == "/" {
				t.Fatal("unsafe owned worker cgroup")
			}
			values := map[string]string{}
			retired := false
			for _, name := range []string{"memory.max", "memory.swap.max", "pids.max", "memory.oom.group", "memory.peak"} {
				data, err := os.ReadFile(filepath.Join("/sys/fs/cgroup", strings.TrimPrefix(group, "/"), name))
				if os.IsNotExist(err) {
					retired = true
					break
				}
				if err != nil {
					t.Fatal(err)
				}
				values[name] = string(data)
			}
			if retired {
				continue
			}
			peak, err := validateLargeWorkerMemoryObservation(values)
			if err != nil {
				t.Fatal(err)
			}
			live++
			if peak > observed[unit] {
				observed[unit] = peak
			}
		}
		if live == 2 {
			simultaneous = true
		}
		if live > 2 {
			t.Fatal("default-size job exceeded two-worker bound")
		}
	}
	tick := time.NewTicker(250 * time.Millisecond)
	defer tick.Stop()
	deadline := time.NewTimer(145 * time.Second)
	defer deadline.Stop()
	for remaining > 0 {
		select {
		case err := <-finished:
			remaining--
			if err != nil {
				t.Fatal("simultaneous default-size collection failed", err)
			}
		case err := <-renewErrors:
			t.Fatal("large workers interrupted healthy signed monitoring", err)
		case <-tick.C:
			inspect()
			observe()
		case <-deadline.C:
			t.Fatal("simultaneous default-size workers exceeded bounded runtime")
		}
	}
	if !simultaneous || len(observed) != 2 || !admitted {
		t.Fatal("did not qualify simultaneous live bounded workers plus control admission", simultaneous, len(observed), admitted)
	}
	for _, id := range []string{finalID, second} {
		state, err := readStateSnapshot(e.Config.State)
		if err != nil {
			t.Fatal(err)
		}
		a := state.Attempts[id]
		old := before.Attempts[id]
		manifest, err := ReadProtected(filepath.Join(e.Config.State, "submissions", id), a)
		if err != nil || !a.Protected || a.State != "COMPLETED" || a.AccessState != "HELD" || a.Start != old.Start || a.Deadline != old.Deadline || a.OriginalDeadline != old.OriginalDeadline || len(manifest.Files) != 4 {
			t.Fatal("large result lost protection/original hold/interval", err)
		}
		for _, file := range manifest.Files {
			if file.Size != 128*mib || file.Hash != expected[id][file.Path] {
				t.Fatal("large archives mixed targets or changed saved bytes")
			}
		}
		archive, err := os.Stat(filepath.Join(e.Config.State, "submissions", id, "submission.tar.gz"))
		if err != nil || archive.Size() < 512*mib {
			t.Fatal("fixture did not produce a default-ceiling incompressible archive", err)
		}
	}
	inspect()
	select {
	case err := <-renewErrors:
		t.Fatal(err)
	default:
	}
	metricsMu.Lock()
	count, renewal := beats, maxRenewal
	metricsMu.Unlock()
	t.Logf("two concurrent512MiB/4x128MiB collections verified; elapsed=%s renewals=%d max_renewal=%s max_signed_inspection=%s max_registration_pane_workflow=%s max_no_fsync_readonly=%s successful_readonly=%d unavailable_readonly=%d live_worker_peaks=%v; fake UID/SSH/writer guards, no production capacity claim", time.Since(started), count, renewal, maxInspect, maxManagement, maxReadOnly, readOnlySuccess, readOnlyUnavailable, observed)
	if count < 3 || readOnlySuccess < 3 || renewal > durableIOBudget || maxInspect > durableIOBudget || maxManagement > durableIOBudget || maxReadOnly > diagnosticBudget {
		t.Fatal("healthy control exceeded declared disk-IO/diagnostic qualification bounds", count, renewal, maxInspect, maxManagement, maxReadOnly, readOnlySuccess)
	}
}
