package core

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"syscall"
	"testing"
	"time"
)

type monitoringPublishFixture struct {
	f     authorityFixture
	state string
	claim *monitoringOwnerClaim
}

func newMonitoringPublishFixture(t *testing.T, state, attempt string) monitoringPublishFixture {
	t.Helper()
	if state == "" {
		state = monitoringClaimState(t)
	}
	f := nativeAuthorityFixture(t, false, 5000)
	if attempt == "" {
		attempt = f.context.Owner.Attempt
	}
	c, err := claimMonitoringOwner(state, attempt)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(c.close)
	context := f.context
	context.Owner.Attempt = attempt
	context = sealedAuthorityTestContext(context)
	context.verified.current = c.current
	f.context = context
	f.a, err = newMonitoringAuthority(context, func() (int64, error) { return f.clock.Load(), nil })
	if err != nil {
		t.Fatal(err)
	}
	return monitoringPublishFixture{f, state, c}
}

func monitoringPublishTestOptions(mode string) monitoringPublishOptions {
	return monitoringPublishOptions{timeout: 2 * time.Second, command: func(string) []string {
		// The race runtime otherwise adds a synthetic one-second exit sleep to
		// every child. Remove that test-only delay, not the production bound.
		return []string{"/usr/bin/env", "GORACE=atexit_sleep_ms=0", os.Args[0], "-test.run=^TestMonitoringPublisherChild$", "--", "--monitoring-publisher-test", mode}
	}}
}

func monitoringPublisherTestMarker(state, mode string) string {
	return filepath.Join(state, "publisher-test-"+mode)
}

func waitMonitoringPublisherMarker(t *testing.T, state, mode string) {
	t.Helper()
	until := time.Now().Add(2 * time.Second)
	for time.Now().Before(until) {
		if _, err := os.Stat(monitoringPublisherTestMarker(state, mode)); err == nil {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("synthetic publisher did not reach the expected boundary")
}

// Fault switches exist only in this test executable, never native args/config.
func TestMonitoringPublisherChild(t *testing.T) {
	if len(os.Args) < 3 || os.Args[len(os.Args)-2] != "--monitoring-publisher-test" {
		return
	}
	mode := os.Args[len(os.Args)-1]
	input, err := io.ReadAll(io.LimitReader(os.Stdin, monitoringPublishLimit+1))
	if err != nil {
		os.Exit(51)
	}
	r, err := decodeMonitoringPublishRequest(input)
	if err != nil {
		os.Exit(52)
	}
	var output bytes.Buffer
	err = runMonitoringPublisher(bytes.NewReader(input), &output, func(at string) error {
		if at == "written" {
			if err := os.WriteFile(monitoringPublisherTestMarker(r.State, mode), []byte("synthetic"), 0600); err != nil {
				return err
			}
			switch mode {
			case "panic":
				panic("PRIVATE-PUBLISHER-PANIC")
			case "exit":
				os.Exit(53)
			case "kill-written":
				_ = syscall.Kill(os.Getpid(), syscall.SIGKILL)
			case "hang":
				for {
					time.Sleep(time.Hour)
				}
			case "wait", "oom-wait":
				for {
					if _, err := os.Stat(monitoringPublisherTestMarker(r.State, "release")); err == nil {
						break
					}
					time.Sleep(5 * time.Millisecond)
				}
			}
			if mode == "oom" || mode == "oom-wait" {
				b := make([]byte, 512*mib)
				for i := range b {
					b[i] = byte(i)
				}
				runtime.KeepAlive(b)
				os.Exit(54)
			}
			if mode == "observe" {
				groups, err := os.ReadFile("/proc/self/cgroup")
				if err != nil {
					return err
				}
				var group string
				for _, line := range strings.Split(string(groups), "\n") {
					if value, ok := strings.CutPrefix(line, "0::"); ok {
						group = value
					}
				}
				if !filepath.IsAbs(group) || filepath.Clean(group) != group || group == "/" {
					return errors.New("synthetic worker cgroup unavailable")
				}
				values := map[string]string{}
				for _, key := range []string{"memory.max", "memory.swap.max", "pids.max", "memory.oom.group"} {
					value, err := os.ReadFile(filepath.Join("/sys/fs/cgroup", strings.TrimPrefix(group, "/"), key))
					if err != nil {
						return err
					}
					values[key] = strings.TrimSpace(string(value))
				}
				data, _ := json.Marshal(values)
				if err := os.WriteFile(monitoringPublisherTestMarker(r.State, "controls"), data, 0600); err != nil {
					return err
				}
			}
		}
		if at == "renamed" && mode == "kill-renamed" {
			_ = syscall.Kill(os.Getpid(), syscall.SIGKILL)
		}
		return nil
	})
	if err != nil {
		os.Exit(55)
	}
	if strings.HasPrefix(mode, "reply-") {
		var wire map[string]any
		if json.Unmarshal(output.Bytes(), &wire) != nil {
			os.Exit(56)
		}
		switch mode {
		case "reply-wrong-owner":
			wire["attempt"] = "22345678-1234-1234-1234-123456789abc"
		case "reply-wrong-hash":
			wire["hash"] = strings.Repeat("f", 64)
		case "reply-wrong-incarnation":
			wire["incarnation"] = strings.Repeat("f", 64)
		case "reply-missing-durable":
			delete(wire, "durable")
		case "reply-null-durable":
			wire["durable"] = nil
		case "reply-false-durable":
			wire["durable"] = false
		case "reply-unknown":
			wire["private_payload"] = "PRIVATE-NOT-TO-PRINT"
		case "reply-oversize":
			_, _ = io.WriteString(os.Stdout, strings.Repeat("x", monitoringPublishLimit+1))
			os.Exit(0)
		case "reply-truncated":
			_, _ = io.WriteString(os.Stdout, `{"version":1`)
			os.Exit(0)
		}
		_ = json.NewEncoder(os.Stdout).Encode(wire)
		os.Exit(0)
	}
	_, _ = os.Stdout.Write(output.Bytes())
	os.Exit(0)
}

func TestMonitoringPublisherSignedCandidateRoundTripAndOriginalRetry(t *testing.T) {
	p := newMonitoringPublishFixture(t, "", "")
	statePath := filepath.Join(p.state, "state.json")
	if err := os.WriteFile(statePath, []byte("PRIVATE-UNTOUCHED-ATTEMPT-STATE"), 0600); err != nil {
		t.Fatal(err)
	}
	proof := p.f.proof(t, 4, 0)
	ticket := p.f.prepare(t, proof)
	r, err := publishMonitoringTicket(context.Background(), p.claim, p.state, ticket, monitoringPublishTestOptions("normal"))
	if err != nil || r.UntilUptimeMS != 16000 || r.Sequence != 4 {
		t.Fatal("actual child publication failed", r, err)
	}
	file := filepath.Join(p.state, "monitoring-control", proof.Owner.Attempt+".provisional.json")
	stored, err := os.ReadFile(file)
	expected, hash := ticket.publicationBytes()
	if err != nil || !bytes.Equal(stored, expected) || Hash(stored) != hash {
		t.Fatal("worker did not publish exact provisional bytes", err)
	}
	before, err := os.Stat(file)
	if err != nil {
		t.Fatal(err)
	}
	next, original, err := p.f.a.prepare(proof)
	if err != nil || next != nil || original == nil || *original != r {
		t.Fatal("retry changed original receipt", err)
	}
	if _, err := publishMonitoringTicket(context.Background(), p.claim, p.state, ticket, monitoringPublishTestOptions("normal")); err != errMonitoringBusy {
		t.Fatal("same ticket launched a second publisher", err)
	}
	after, _ := os.Stat(file)
	if !before.ModTime().Equal(after.ModTime()) {
		t.Fatal("duplicate rewrote publication")
	}
	state, err := os.ReadFile(statePath)
	if err != nil || string(state) != "PRIVATE-UNTOUCHED-ATTEMPT-STATE" {
		t.Fatal("publisher touched authoritative state", err)
	}
	p.f.clock.Store(5000)
	if !p.f.a.check().ExecutionAuthorized {
		t.Fatal("old cutoff revoked confirmed renewal")
	}
}

func TestMonitoringPublisherFatalAndUntrustedReplyFaultsPreserveOnlyPriorAuthority(t *testing.T) {
	for _, mode := range []string{"panic", "exit", "kill-written", "kill-renamed", "reply-wrong-owner", "reply-wrong-hash", "reply-wrong-incarnation", "reply-missing-durable", "reply-null-durable", "reply-false-durable", "reply-unknown", "reply-oversize", "reply-truncated"} {
		t.Run(mode, func(t *testing.T) {
			p := newMonitoringPublishFixture(t, "", "")
			ticket := p.f.prepare(t, p.f.proof(t, 4, 0))
			_, err := publishMonitoringTicket(context.Background(), p.claim, p.state, ticket, monitoringPublishTestOptions(mode))
			if err == nil || strings.Contains(err.Error(), "PRIVATE") {
				t.Fatal("fault acknowledged or leaked worker data", err)
			}
			v := p.f.a.check()
			if !v.ExecutionAuthorized || v.AuthorityUntilMS != 5000 || v.Sequence != 3 || v.PublicationPending || !v.PublicationFailureObserved || len(v.Causes) != 0 {
				t.Fatal("fault caused early lock, violation or extra allowance", v)
			}
			// A fresh proof may replace only nonauthoritative provisional bytes.
			p.f.clock.Store(2000)
			fresh := p.f.prepare(t, p.f.proof(t, 4, 0))
			if r, err := publishMonitoringTicket(context.Background(), p.claim, p.state, fresh, monitoringPublishTestOptions("normal")); err != nil || r.UntilUptimeMS != 17000 {
				t.Fatal("crash retry did not preserve its own fixed cutoff", r, err)
			}
		})
	}
}

func TestMonitoringPublisherConcurrentRetryDoesNotRetireInflightPublication(t *testing.T) {
	p := newMonitoringPublishFixture(t, "", "")
	ticket := p.f.prepare(t, p.f.proof(t, 4, 0))
	done := make(chan error, 1)
	go func() {
		_, err := publishMonitoringTicket(context.Background(), p.claim, p.state, ticket, monitoringPublishTestOptions("wait"))
		done <- err
	}()
	waitMonitoringPublisherMarker(t, p.state, "wait")
	var launches atomic.Int64
	opts := monitoringPublishTestOptions("normal")
	command := opts.command
	opts.command = func(unit string) []string { launches.Add(1); return command(unit) }
	if _, err := publishMonitoringTicket(context.Background(), p.claim, p.state, ticket, opts); err != errMonitoringBusy || launches.Load() != 0 {
		t.Fatal("retry launched/retired another publication", err)
	}
	if v := p.f.a.check(); !v.PublicationPending || v.PublicationFailureObserved || v.AuthorityUntilMS != 5000 {
		t.Fatal(v)
	}
	if err := os.WriteFile(monitoringPublisherTestMarker(p.state, "release"), nil, 0600); err != nil {
		t.Fatal(err)
	}
	if err := <-done; err != nil {
		t.Fatal("original in-flight publisher was retired by duplicate", err)
	}
}

func TestMonitoringPublisherBlockedIOLeavesOtherAttemptAndCutoffIndependent(t *testing.T) {
	p := newMonitoringPublishFixture(t, "", "")
	healthy := newMonitoringPublishFixture(t, p.state, "22345678-1234-1234-1234-123456789abc")
	ticket := p.f.prepare(t, p.f.proof(t, 4, 0))
	done := make(chan error, 1)
	go func() {
		_, err := publishMonitoringTicket(context.Background(), p.claim, p.state, ticket, monitoringPublishTestOptions("wait"))
		done <- err
	}()
	waitMonitoringPublisherMarker(t, p.state, "wait")
	other := healthy.f.prepare(t, healthy.f.proof(t, 4, 0))
	if _, err := publishMonitoringTicket(context.Background(), healthy.claim, healthy.state, other, monitoringPublishTestOptions("normal")); err != nil {
		t.Fatal("another attempt waited on blocked writer", err)
	}
	p.f.clock.Store(5000)
	start := time.Now()
	if v := p.f.a.check(); v.Phase != "revoking" || v.ExecutionAuthorized || len(v.Causes) != 1 || v.Causes[0] != "technical-expiry" {
		t.Fatal(v)
	}
	if time.Since(start) > 100*time.Millisecond {
		t.Fatal("cutoff waited on storage")
	}
	if err := os.WriteFile(monitoringPublisherTestMarker(p.state, "release"), nil, 0600); err != nil {
		t.Fatal(err)
	}
	if err := <-done; err != errMonitoringAuthority {
		t.Fatal("late actual publication revived old permission", err)
	}
	if !healthy.f.a.check().ExecutionAuthorized {
		t.Fatal("other owner was revoked")
	}
}

func TestMonitoringPublisherTimeoutAndCapacityNeverAddPermission(t *testing.T) {
	t.Run("timeout", func(t *testing.T) {
		p := newMonitoringPublishFixture(t, "", "")
		ticket := p.f.prepare(t, p.f.proof(t, 4, 0))
		opts := monitoringPublishTestOptions("hang")
		opts.timeout = 150 * time.Millisecond
		start := time.Now()
		if _, err := publishMonitoringTicket(context.Background(), p.claim, p.state, ticket, opts); err == nil {
			t.Fatal("hung worker acknowledged")
		}
		if time.Since(start) > time.Second {
			t.Fatal("timeout waited on worker")
		}
		if v := p.f.a.check(); !v.ExecutionAuthorized || v.AuthorityUntilMS != 5000 || len(v.Causes) != 0 {
			t.Fatal(v)
		}
	})
	t.Run("global-slots", func(t *testing.T) {
		p := newMonitoringPublishFixture(t, "", "")
		dir, err := openMonitoringControl(p.state)
		if err != nil {
			t.Fatal(err)
		}
		defer dir.Close()
		for _, name := range []string{"publish-slot-0.lock", "publish-slot-1.lock"} {
			lock, err := monitoringPublishLock(dir, name)
			if err != nil {
				t.Fatal(err)
			}
			defer lock.Close()
		}
		ticket := p.f.prepare(t, p.f.proof(t, 4, 0))
		if _, err := publishMonitoringTicket(context.Background(), p.claim, p.state, ticket, monitoringPublishTestOptions("normal")); err != errMonitoringBusy {
			t.Fatal("unbounded pool launch", err)
		}
		if v := p.f.a.check(); !v.ExecutionAuthorized || v.AuthorityUntilMS != 5000 {
			t.Fatal(v)
		}
	})
}

func TestMonitoringPublisherStrictRequestAndReplyMetadata(t *testing.T) {
	p := newMonitoringPublishFixture(t, "", "")
	ticket := p.f.prepare(t, p.f.proof(t, 4, 0))
	r := monitoringPublishRequest{1, "monitoring-provisional-publication-v1", p.state, 0, ticket.publication}
	input, _ := json.Marshal(r)
	if _, err := decodeMonitoringPublishRequest(input); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(map[string]any){
		func(v map[string]any) { delete(v, "slot") }, func(v map[string]any) { v["slot"] = nil }, func(v map[string]any) { v["slot"] = 2 },
		func(v map[string]any) { v["purpose"] = "ordinary-lease" }, func(v map[string]any) { v["state"] = "/" }, func(v map[string]any) { v["unknown"] = "PRIVATE" },
		func(v map[string]any) {
			delete(v["publication"].(map[string]any)["owner"].(map[string]any), "generation")
		},
		func(v map[string]any) { v["publication"].(map[string]any)["prepared_revision"] = 0 },
		func(v map[string]any) { v["publication"].(map[string]any)["effective_until_ms"] = 1 },
	} {
		var wire map[string]any
		_ = json.Unmarshal(input, &wire)
		change(wire)
		data, _ := json.Marshal(wire)
		if _, err := decodeMonitoringPublishRequest(data); err != errMonitoringPublishIO {
			t.Fatal("unsafe/missing required metadata accepted", err)
		}
	}
	for _, data := range [][]byte{[]byte(`{"version":1,"version":1}`), append(input, []byte(`{}`)...), []byte(strings.Repeat("x", monitoringPublishLimit+1))} {
		if _, err := decodeMonitoringPublishRequest(data); err != errMonitoringPublishIO {
			t.Fatal("malformed/oversize request accepted", err)
		}
	}
	good := "LoadState=loaded\nMemoryMax=134217728\nMemorySwapMax=0\nTasksMax=64\n"
	if validateMonitoringPublishSlice(good) != nil {
		t.Fatal("bounded pool rejected")
	}
	for _, bad := range []string{"", strings.Replace(good, "134217728", "max", 1), strings.Replace(good, "134217728", "134217728garbage", 1), strings.Replace(good, "TasksMax=64", "TasksMax=65536", 1), strings.Replace(good, "MemorySwapMax=0", "MemorySwapMax=1", 1)} {
		if validateMonitoringPublishSlice(bad) == nil {
			t.Fatal("unbounded/malformed pool accepted")
		}
	}
}

func TestMonitoringPublicationStorageRefusesLinksAndUnexpectedFiles(t *testing.T) {
	for _, mode := range []string{"temp-symlink", "temp-hardlink", "temp-fifo", "temp-public", "final-symlink", "final-hardlink", "final-directory", "final-oversize"} {
		t.Run(mode, func(t *testing.T) {
			p := newMonitoringPublishFixture(t, "", "")
			ticket := p.f.prepare(t, p.f.proof(t, 4, 0))
			dir, err := openMonitoringControl(p.state)
			if err != nil {
				t.Fatal(err)
			}
			defer dir.Close()
			outside := filepath.Join(p.state, "untouched")
			if err := os.WriteFile(outside, []byte("PRIVATE-UNRELATED"), 0600); err != nil {
				t.Fatal(err)
			}
			name := ticket.publication.Owner.Attempt + ".publication.tmp"
			if strings.HasPrefix(mode, "final-") {
				name = ticket.publication.Owner.Attempt + ".provisional.json"
			}
			path := filepath.Join(p.state, "monitoring-control", name)
			var errSetup error
			switch mode {
			case "temp-symlink", "final-symlink":
				errSetup = os.Symlink(outside, path)
			case "temp-hardlink", "final-hardlink":
				errSetup = os.Link(outside, path)
			case "temp-fifo":
				errSetup = syscall.Mkfifo(path, 0600)
			case "temp-public":
				errSetup = os.WriteFile(path, nil, 0644)
			case "final-directory":
				errSetup = os.Mkdir(path, 0700)
			case "final-oversize":
				errSetup = os.WriteFile(path, make([]byte, monitoringPublishLimit+1), 0600)
			}
			if errSetup != nil {
				t.Fatal(errSetup)
			}
			if err := storeMonitoringPublication(dir, ticket.publication, nil); err != errMonitoringPublishIO {
				t.Fatal("unsafe staging/final target changed", err)
			}
			data, err := os.ReadFile(outside)
			if err != nil || string(data) != "PRIVATE-UNRELATED" {
				t.Fatal("followed or changed unrelated bytes", err)
			}
		})
	}
}

func TestMonitoringPublisherActualUserScopePreservesClaimsAndEnforcesResourceBounds(t *testing.T) {
	if os.Getenv("EXAM_COLLECTION_USER_SYSTEMD") != "1" {
		t.Skip("set EXAM_COLLECTION_USER_SYSTEMD=1 for isolated real user-manager publisher scopes")
	}
	for _, mode := range []string{"observe", "oom", "hang"} {
		t.Run(mode, func(t *testing.T) {
			p := newMonitoringPublishFixture(t, "", "")
			ticket := p.f.prepare(t, p.f.proof(t, 4, 0))
			unit := "ssh-exam-publisher-test-" + Token()[:12] + ".scope"
			t.Cleanup(func() {
				_ = exec.Command("/usr/bin/systemctl", "--user", "stop", unit).Run()
				_ = exec.Command("/usr/bin/systemctl", "--user", "reset-failed", unit).Run()
			})
			opts := monitoringPublishOptions{timeout: 5 * time.Second, command: func(string) []string {
				base := monitoringPublishScopeArgs(unit, os.Args[0])
				args := []string{"/usr/bin/env", "GORACE=atexit_sleep_ms=0", "XDG_RUNTIME_DIR=" + os.Getenv("XDG_RUNTIME_DIR"), "DBUS_SESSION_BUS_ADDRESS=" + os.Getenv("DBUS_SESSION_BUS_ADDRESS"), base[0], "--user"}
				for _, arg := range base[1:] {
					switch arg {
					case "--collect", "--property=Slice=exam-publish.slice":
						continue
					case monitoringPublisherFlag:
						args = append(args, "-test.run=^TestMonitoringPublisherChild$", "--", "--monitoring-publisher-test", mode)
						continue
					}
					args = append(args, arg)
				}
				return args
			}}
			_, err := publishMonitoringTicket(context.Background(), p.claim, p.state, ticket, opts)
			if mode == "observe" {
				if err != nil {
					t.Fatal("scope did not inherit/verify all three claims", err)
				}
				data, err := os.ReadFile(monitoringPublisherTestMarker(p.state, "controls"))
				if err != nil {
					t.Fatal(err)
				}
				var controls map[string]string
				if json.Unmarshal(data, &controls) != nil {
					t.Fatal("invalid observed kernel controls")
				}
				for key, want := range map[string]string{"memory.max": "67108864", "memory.swap.max": "0", "pids.max": "16", "memory.oom.group": "1"} {
					if controls[key] != want {
						t.Fatal("actual publisher scope is unbounded", key, controls[key])
					}
				}
			} else {
				if err == nil {
					t.Fatal("resource-failed publisher acknowledged")
				}
				v := p.f.a.check()
				if !v.ExecutionAuthorized || v.AuthorityUntilMS != 5000 || len(v.Causes) != 0 {
					t.Fatal("resource failure affected prior authority", v)
				}
				result, err := exec.Command("/usr/bin/systemctl", "--user", "show", unit, "--property=Result", "--value").Output()
				want := "oom-kill"
				if mode == "hang" {
					want = "timeout"
				}
				if err != nil || strings.TrimSpace(string(result)) != want {
					t.Fatal("expected actual scope resource failure", want, string(result), err)
				}
			}
		})
	}
}

func TestMonitoringPublisherActualCompiledRootCLIWithoutAgentInitialization(t *testing.T) {
	if os.Getenv("EXAM_MANAGEMENT_USERNS") != "1" {
		t.Skip("set EXAM_MANAGEMENT_USERNS=1 for actual compiled root-mapped publisher binaries")
	}
	for _, name := range []string{"examctl", "exam-agent"} {
		t.Run(name, func(t *testing.T) {
			binary := filepath.Join(t.TempDir(), name)
			build := exec.Command("go", "build", "-o", binary, "./cmd/"+name)
			build.Dir = filepath.Join("..", "..")
			if out, err := build.CombinedOutput(); err != nil {
				t.Fatal("compile actual local native binary", err, string(out))
			}
			p := newMonitoringPublishFixture(t, "", "")
			ticket := p.f.prepare(t, p.f.proof(t, 4, 0))
			opts := monitoringPublishOptions{timeout: 3 * time.Second, command: func(string) []string {
				return []string{"/usr/bin/unshare", "--user", "--map-root-user", binary, monitoringPublisherFlag}
			}}
			if _, err := publishMonitoringTicket(context.Background(), p.claim, p.state, ticket, opts); err != nil {
				t.Fatal("actual root binary publisher entry failed", err)
			}
			entries, err := os.ReadDir(p.state)
			if err != nil || len(entries) != 1 || entries[0].Name() != "monitoring-control" {
				t.Fatal("worker initialized state/config/audit", err)
			}
		})
	}
}

func TestMonitoringPublisherDoesNotAcceptForeignInheritedClaim(t *testing.T) {
	p := newMonitoringPublishFixture(t, "", "")
	other, err := claimMonitoringOwner(p.state, "22345678-1234-1234-1234-123456789abc")
	if err != nil {
		t.Fatal(err)
	}
	defer other.close()
	ticket := p.f.prepare(t, p.f.proof(t, 4, 0))
	if _, err := publishMonitoringTicket(context.Background(), other, p.state, ticket, monitoringPublishTestOptions("normal")); err == nil {
		t.Fatal("foreign claim was accepted")
	}
	if v := p.f.a.check(); !v.ExecutionAuthorized || v.AuthorityUntilMS != 5000 {
		t.Fatal(v)
	}
}

func FuzzMonitoringPublishMetadata(f *testing.F) {
	owner := monitoringOwner{Attempt: finalID, Exam: "synthetic", Username: "student", UID: 10001, TransportHash: strings.Repeat("a", 64), Boot: "11111111-1111-4111-8111-111111111111", PageEpoch: strings.Repeat("b", 64), InputEpoch: strings.Repeat("c", 64)}
	seed, _ := json.Marshal(monitoringPublishRequest{1, "monitoring-provisional-publication-v1", "/tmp/synthetic-monitoring", 0, monitoringPublication{1, strings.Repeat("d", 64), owner, strings.Repeat("e", 64), 4, strings.Repeat("f", 64), 16000, 16000, 1}})
	f.Add(seed)
	f.Add([]byte(`{"version":1}`))
	f.Add([]byte(`{"version":1,"version":1}`))
	f.Fuzz(func(t *testing.T, input []byte) {
		if len(input) > monitoringPublishLimit+1 {
			return
		}
		r, err := decodeMonitoringPublishRequest(input)
		if err == nil {
			if !validMonitoringPublication(r.Publication) {
				t.Fatal("unsafe metadata accepted")
			}
			encoded, marshalErr := json.Marshal(r)
			if marshalErr != nil || len(encoded) > monitoringPublishLimit {
				t.Fatal("invalid accepted metadata")
			}
		}
	})
}
