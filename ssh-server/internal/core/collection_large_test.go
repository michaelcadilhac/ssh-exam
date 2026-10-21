package core

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
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

// memory.peak is an observation, not an exact enforcement-bound assertion:
// memory.max explicitly permits temporary excess during kernel charging/reclaim.
// https://docs.kernel.org/admin-guide/cgroup-v2.html (memory.max/memory.peak)
// Validate the actual live kernel controls instead; never increase worker limits
// or ignore unavailable/unbounded controls to satisfy a peak measurement.
func validateLargeWorkerMemoryObservation(values map[string]string) (uint64, error) {
	for key, want := range map[string]string{"memory.max": "268435456", "memory.swap.max": "0", "pids.max": "32", "memory.oom.group": "1"} {
		if strings.TrimSpace(values[key]) != want {
			return 0, fmt.Errorf("large worker live kernel control %s is unavailable or differs from required %s", key, want)
		}
	}
	peak, err := strconv.ParseUint(strings.TrimSpace(values["memory.peak"]), 10, 64)
	if err != nil || peak == 0 || peak == ^uint64(0) {
		return 0, errors.New("large worker live memory.peak observation unavailable")
	}
	return peak, nil
}

func TestLargeWorkerMemoryObservationRequiresRealBoundsNotAnExactPeakCeiling(t *testing.T) {
	values := map[string]string{"memory.max": "268435456", "memory.swap.max": "0", "pids.max": "32", "memory.oom.group": "1", "memory.peak": "268439552"}
	if peak, err := validateLargeWorkerMemoryObservation(values); err != nil || peak != 268439552 {
		t.Fatal("documented transient peak was confused with a raised limit", peak, err)
	}
	for key, invalid := range map[string][]string{"memory.max": {"", "max", "536870912"}, "memory.swap.max": {"max", "1"}, "pids.max": {"max", "64"}, "memory.oom.group": {"0", ""}, "memory.peak": {"0", "[not set]", "18446744073709551615"}} {
		original := values[key]
		for _, value := range invalid {
			values[key] = value
			if _, err := validateLargeWorkerMemoryObservation(values); err == nil {
				t.Fatal("unavailable/unbounded live control or counter accepted", key, value)
			}
		}
		values[key] = original
	}
}

// Tests only: use an explicitly selected PRIVATE disk scratch parent for large
// real I/O. Each fixture owns/removes only its fresh random child; never the
// parent, a repository, existing user data or any production path.
func nativeFixtureDir(t *testing.T) string {
	t.Helper()
	parent := os.Getenv("EXAM_COLLECTION_TEST_ROOT")
	if parent == "" {
		return t.TempDir()
	}
	i, err := os.Lstat(parent)
	if err != nil || !filepath.IsAbs(parent) || parent == "/" || !i.IsDir() || i.Mode()&os.ModeSymlink != 0 || i.Mode().Perm()&0077 != 0 || i.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) {
		t.Fatal("EXAM_COLLECTION_TEST_ROOT must be an existing private owned absolute scratch directory", err)
	}
	dir, err := os.MkdirTemp(parent, "ssh-exam-fixture-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.RemoveAll(dir); err != nil {
			t.Error("remove exact synthetic fixture", err)
		}
	})
	return dir
}

// Actual default-size incompressible collection + saved restore under the SAME
// per-worker 256 MiB/no-swap/32-task/120s production bounds. Local user-systemd,
// synthetic state only; guard/writer hooks in the child remain explicitly fake.
func TestLargeCollectionAndRestoreUserSystemd(t *testing.T) {
	if os.Getenv("EXAM_LARGE_COLLECTION") != "1" {
		t.Skip("set EXAM_LARGE_COLLECTION=1 for isolated 512 MiB systemd collection/restore and healthy-monitoring qualification")
	}
	e, key, _ := leaseFixture(t)
	e.Config.Accounts["student"] = Account{UID: os.Getuid(), GID: os.Getgid()}
	e.Config.Accounts["healthy"] = Account{UID: 1002, GID: 1002}
	e.Config.Accounts["newstudent"] = Account{UID: 1003, GID: 1003}
	var disk syscall.Statfs_t
	if err := syscall.Statfs(e.Config.State, &disk); err != nil {
		t.Fatal(err)
	}
	if memoryBackedFilesystem(disk.Type) {
		t.Skip("512 MiB qualification needs disk scratch: set EXAM_COLLECTION_TEST_ROOT to an existing private disk-backed test directory; tmpfs OOM is separately diagnosed and new production admission refuses it")
	}
	if disk.Bavail*uint64(disk.Bsize) < 3*1024*1024*1024 {
		t.Skip("need at least 3 GiB free local scratch for real incompressible source/archive/restore; no capacity qualification performed")
	}
	t.Logf("scratch_filesystem_type=%#x available_bytes=%d", disk.Type, disk.Bavail*uint64(disk.Bsize))
	const healthyID = "98765432-1234-1234-1234-123456789abc"
	// Bound real I/O latency well below the 15-second enforcement lease. This
	// workload check is not the separate sub-second blocked-lock regression.
	const renewalBudget = 3 * time.Second
	deadline := Millis() + 5400000
	if err := e.WithState(func() error {
		a := e.state.Attempts[finalID]
		a.UID = os.Getuid()
		a.Settings.CollectionFileMiB = 128
		a.Settings.CollectionTotalMiB = 512
		v := *a
		v.ID = healthyID
		v.Username = "healthy"
		v.UID = 1002
		v.Transport = "ssh-healthy"
		v.Deadline = deadline
		v.OriginalDeadline = deadline
		v.UptimeDeadline = uptime() + 5400
		v.Generation = 3
		v.Settings.Terminals = 4
		e.state.Attempts[healthyID] = &v
		e.state.Registrations[v.Transport] = v.Username
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(e.Config.Work, finalID, "work")
	if err := os.Remove(filepath.Join(source, "answer.txt")); err != nil {
		t.Fatal(err)
	}
	expected := map[string]string{}
	for i := 0; i < 4; i++ {
		name := "artifact-" + strconv.Itoa(i) + ".bin"
		f, err := os.OpenFile(filepath.Join(source, name), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err != nil {
			t.Fatal(err)
		}
		block := make([]byte, 1024*1024)
		if _, err := rand.Read(block); err != nil {
			f.Close()
			t.Fatal(err)
		}
		h := sha256.New()
		out := io.MultiWriter(f, h)
		for j := 0; j < 128; j++ {
			if _, err := out.Write(block); err != nil {
				f.Close()
				t.Fatal(err)
			}
		}
		// Fixture creation is not worker traffic. Flush it before measuring
		// independent renewals, so a lease fsync cannot inherit setup's journal.
		if err := f.Sync(); err != nil {
			f.Close()
			t.Fatal(err)
		}
		if err := f.Close(); err != nil {
			t.Fatal(err)
		}
		expected[name] = hex.EncodeToString(h.Sum(nil))
	}
	units := []string{}
	peaks := map[string]uint64{}
	boundsObserved := map[string]bool{}
	var unitsMu sync.Mutex
	unitSnapshot := func() []string {
		unitsMu.Lock()
		defer unitsMu.Unlock()
		return append([]string(nil), units...)
	}
	// Sample actual controls/counter while the cgroup is alive, rather than
	// keeping an exited service active (which changes --wait completion semantics).
	observeMemory := func() {
		for _, unit := range unitSnapshot() {
			out, err := exec.Command("/usr/bin/systemctl", "--user", "show", unit, "--property=ControlGroup", "--value").Output()
			group := strings.TrimSpace(string(out))
			if err != nil || group == "" {
				continue
			} // Not created/already retired.
			if !filepath.IsAbs(group) || filepath.Clean(group) != group || group == "/" {
				t.Fatal("invalid test worker control group", unit)
			}
			values := map[string]string{}
			retired := false
			for _, key := range []string{"memory.max", "memory.swap.max", "pids.max", "memory.oom.group", "memory.peak"} {
				data, err := os.ReadFile(filepath.Join("/sys/fs/cgroup", strings.TrimPrefix(group, "/"), key))
				if errors.Is(err, os.ErrNotExist) {
					retired = true
					break
				}
				if err != nil {
					t.Fatal("inspect live test-worker controls", err)
				}
				values[key] = string(data)
			}
			if retired {
				continue
			}
			peak, err := validateLargeWorkerMemoryObservation(values)
			if err != nil {
				t.Fatal(err)
			}
			boundsObserved[unit] = true
			if peak > peaks[unit] {
				peaks[unit] = peak
			}
		}
	}
	t.Cleanup(func() {
		for _, unit := range unitSnapshot() {
			_ = exec.Command("/usr/bin/systemctl", "--user", "stop", unit).Run()
			_ = exec.Command("/usr/bin/systemctl", "--user", "reset-failed", unit).Run()
		}
	})
	logWorkers := func() {
		for _, unit := range unitSnapshot() {
			out, _ := exec.Command("/usr/bin/systemctl", "--user", "show", unit, "--property=Result", "--property=MemoryPeak", "--property=ExecMainCode", "--property=ExecMainStatus").Output()
			t.Logf("worker diagnosis %s: %s", unit, strings.TrimSpace(string(out)))
		}
	}
	e.workerCommand = func(string) []string {
		unit := "ssh-exam-large-test-" + Token()[:12] + ".service"
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
				continue
			}
			args = append(args, arg)
		}
		return args
	}
	e.workerTimeout = 130 * time.Second
	e.collectionRun = e.runCollectionProcess
	finished := make(chan error, 1)
	drained := false
	defer func() {
		if !drained {
			// Stop only this test's exact units before removing their fixtures.
			for _, unit := range unitSnapshot() {
				_ = exec.Command("/usr/bin/systemctl", "--user", "stop", unit).Run()
			}
			drainWorkspaceTask(t, nil, finished, &drained)
		}
	}()
	// Renew before starting collection rather than counting setup as an outage.
	if err := e.WithState(func() error { e.state.Attempts[healthyID].Lease = Millis() + 15000; return nil }); err != nil {
		t.Fatal(err)
	}
	started := time.Now()
	go func() {
		_, err := e.Call("finalize-attempt", Request{ID: finalID, Reason: "Synthetic default-size incompressible collection"})
		finished <- err
	}()
	maxRenewal := time.Duration(0)
	renew := func() {
		t.Helper()
		cmd := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "renew-execution-lease", Username: "healthy", Transport: "ssh-healthy", Body: Request{ID: healthyID}}
		at := time.Now()
		if _, err := e.Command(signedCommand(key, cmd), "healthy", "ssh-healthy"); err != nil {
			t.Fatal("large worker interrupted healthy signed monitoring", err)
		}
		elapsed := time.Since(at)
		if elapsed > maxRenewal {
			maxRenewal = elapsed
		}
	}
	beats := 0
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	waiting := true
	deadlineTimer := time.NewTimer(140 * time.Second)
	defer deadlineTimer.Stop()
	for waiting {
		select {
		case err := <-finished:
			drained = true
			if err != nil {
				logWorkers()
				t.Fatal(err)
			}
			waiting = false
		case <-ticker.C:
			renew()
			observeMemory()
			beats++
			if beats == 1 {
				cmd := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "register", Username: "newstudent"}
				if _, err := e.Command(signedCommand(key, cmd), "newstudent", "fresh-large-test"); err != nil {
					t.Fatal("large worker blocked fresh registration", err)
				}
			}
		case <-deadlineTimer.C:
			t.Fatal("large collection did not respect supervisor bounds")
		}
	}
	if beats < 2 {
		t.Fatal("large workload did not exercise concurrent monitoring")
	}
	a := inspectFinal(t, e)
	manifest, err := ReadProtected(filepath.Join(e.Config.State, "submissions", a.ID), a)
	if err != nil || !a.Protected || a.State != "COMPLETED" || len(manifest.Files) != 4 {
		t.Fatal("large default snapshot not secured", err)
	}
	for _, file := range manifest.Files {
		if file.Size != 128*mib || file.Hash != expected[file.Path] {
			t.Fatal("large artifact hash/size mismatch")
		}
	}
	archiveInfo, err := os.Stat(filepath.Join(e.Config.State, "submissions", a.ID, "submission.tar.gz"))
	if err != nil || archiveInfo.Size() < 512*mib {
		t.Fatal("fixture did not qualify incompressible archive beyond old cap", archiveInfo, err)
	}
	if err := e.WithState(func() error {
		other := e.state.Attempts[healthyID]
		if other.State != "ACTIVE" || other.Deadline != deadline || other.Generation != 3 {
			t.Fatal("large job changed healthy state/interval")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	t.Logf("512 MiB incompressible collection %s; %d healthy signed renewals; max_renewal=%s; archive_bytes=%d", time.Since(started), beats, maxRenewal, archiveInfo.Size())
	if maxRenewal > renewalBudget {
		t.Error("large worker stalled healthy renewal beyond the qualification budget")
	}
	// Restore is also a real separately bounded worker; it must not consume time
	// or expose live work, and its source must keep the exact checksum/bytes.
	r := RecoveryPreparation{Exam: "recovery", Username: "student", UID: os.Getuid(), Duration: 5400, SourceAttempt: a.ID, Checksum: a.Checksum, CreatedAt: Millis(), Reason: "Explicit synthetic default-size saved-work allowance"}
	target := &Attempt{ID: recoveryID, Exam: r.Exam, Username: r.Username, UID: r.UID, State: "PREPARING", PreflightStartedAt: Millis(), Settings: Settings{ID: r.Exam, Duration: r.Duration, CollectionFileMiB: 128, CollectionTotalMiB: 512}}
	writeRecoveryFixture(t, e, target, r)
	if err := e.WithState(func() error { e.state.Attempts[target.ID] = target; return nil }); err != nil {
		t.Fatal(err)
	}
	renew()
	drained = false
	go func() {
		_, err := e.Call("prepare-workspace", Request{ID: target.ID})
		finished <- err
	}()
	restoreBeats := 0
	restoreTimer := time.NewTimer(140 * time.Second)
	defer restoreTimer.Stop()
	for !drained {
		select {
		case err := <-finished:
			drained = true
			if err != nil {
				logWorkers()
				t.Fatal("large isolated restore failed", err)
			}
		case <-ticker.C:
			renew()
			observeMemory()
			restoreBeats++
		case <-restoreTimer.C:
			t.Fatal("large restore exceeded supervisor bounds")
		}
	}
	if restoreBeats < 2 || maxRenewal > renewalBudget {
		t.Fatal("large restore did not preserve responsive monitoring", restoreBeats, maxRenewal)
	}
	assertUnstartedWorkspace(t, e, target.ID)
	for name, want := range expected {
		f, err := os.Open(filepath.Join(e.Config.Work, target.ID, "workspace-ready", "work", name))
		if err != nil {
			t.Fatal(err)
		}
		h := sha256.New()
		_, err = io.Copy(h, f)
		f.Close()
		if err != nil || hex.EncodeToString(h.Sum(nil)) != want {
			t.Fatal("large restored copy differs", err)
		}
	}
	if _, err := os.Stat(filepath.Join(e.Config.State, recoveryName(target)+".consumed")); !os.IsNotExist(err) {
		t.Fatal("large preflight consumed allowance")
	}
	if err := e.WithState(func() error {
		healthy := e.state.Attempts[healthyID]
		if healthy.State != "ACTIVE" || healthy.Deadline != deadline || healthy.Generation != 3 || healthy.Lease <= Millis() {
			t.Fatal("large restore changed healthy ownership/deadline or expired its lease")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	t.Logf("512 MiB private restore with %d healthy signed renewals; max_renewal=%s", restoreBeats, maxRenewal)
	for _, unit := range unitSnapshot() {
		out, err := exec.Command("/usr/bin/systemctl", "--user", "show", unit, "--property=Result", "--property=MemoryPeak").Output()
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(out), "Result=success") {
			t.Fatal("bounded large worker did not succeed", string(out))
		}
		peak := peaks[unit]
		if peak == 0 || !boundsObserved[unit] {
			t.Fatal("live kernel controls/peak were not observed; no resource qualification", unit, peak)
		}
		t.Logf("worker %s observed_peak_bytes=%d; verified live memory.max=268435456 swap.max=0 pids.max=32 oom.group=1 (peak may transiently exceed memory.max)", unit, peak)
	}
}
