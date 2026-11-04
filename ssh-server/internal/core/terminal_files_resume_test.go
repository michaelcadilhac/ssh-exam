package core

import (
	"crypto/ed25519"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestSignedFilesResumeRefusesMissingOriginalSocketWithoutMutation(t *testing.T) {
	e, _, _ := finalFixture(t, "LOCKED", Millis()+5400000)
	key := commandKeys(t, e)
	// Model an actual already-started held attempt, rather than legacy migration
	// metadata whose first state load establishes its missing access hold.
	if err := e.WithState(func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	before, err := readStateSnapshot(e.Config.State)
	if err != nil {
		t.Fatal(err)
	}
	a := before.Attempts[finalID]
	cmd := Command{Audience: e.Config.AgentID, Nonce: Token(), Expires: Millis() + 20000, Op: "consume-files-continuation", Username: a.Username, Transport: a.Transport, Body: Request{ID: a.ID, Generation: a.Generation, PageEpoch: strings.Repeat("b", 64)}}
	if _, err := e.Command(signedCommand(key, cmd), a.Username, a.Transport); err == nil {
		t.Fatal("JSON metadata created files-only authority")
	}
	after, err := readStateSnapshot(e.Config.State)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before.Attempts, after.Attempts) || len(after.Caps) != len(before.Caps) {
		left, right := reflect.ValueOf(before.Attempts[finalID]).Elem(), reflect.ValueOf(after.Attempts[finalID]).Elem()
		for i := 0; i < left.NumField(); i++ {
			if !reflect.DeepEqual(left.Field(i).Interface(), right.Field(i).Interface()) {
				t.Log(left.Type().Field(i).Name, left.Field(i), right.Field(i))
			}
		}
		t.Fatal("refused files-only resume mutated attempts/capabilities")
	}
}

func TestSignedFilesResumeRejectsStaleOrUnsafeScopeBeforeWorkloadCleanup(t *testing.T) {
	for _, mode := range []string{"no-exit", "wrong-exit", "no-approval", "expired-approval", "deadline", "generation", "same-ssh", "same-page", "completed", "protected", "inconsistent-owner"} {
		t.Run(mode, func(t *testing.T) {
			e, _, _ := finalFixture(t, "LOCKED", Millis()+5400000)
			key := commandKeys(t, e)
			fresh := strings.Repeat("e", 64)
			if err := e.WithState(func() error {
				a := e.state.Attempts[finalID]
				a.Transport, a.MonitoringMode, a.Generation = strings.Repeat("a", 64), "v1", 1
				a.RegisteredOwner = &monitoringOwner{Attempt: a.ID, Exam: a.Exam, Username: a.Username, UID: a.UID, TransportHash: a.Transport, Boot: boot(), PageEpoch: strings.Repeat("b", 64), InputEpoch: strings.Repeat("c", 64), Generation: 0, ClockRevision: a.ClockRevision}
				old := *a.RegisteredOwner
				a.SSHExitedOwner = &old
				a.Authorization = Millis() + 60000
				e.state.Registrations[a.Transport], e.state.Registrations[fresh] = a.Username, a.Username
				switch mode {
				case "no-exit":
					a.SSHExitedOwner = nil
				case "wrong-exit":
					a.SSHExitedOwner.InputEpoch = strings.Repeat("d", 64)
				case "no-approval":
					a.Authorization = 0
				case "expired-approval":
					a.Authorization = Millis() - 1
				case "deadline":
					a.Deadline = Millis() - 1
					a.UptimeDeadline = uptime() - 1
				case "completed":
					a.State = "COMPLETED"
				case "protected":
					a.Protected = true
				case "inconsistent-owner":
					a.RegisteredOwner.Username = "other"
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			before, err := readStateSnapshot(e.Config.State)
			if err != nil {
				t.Fatal(err)
			}
			a := before.Attempts[finalID]
			cmd := Command{Audience: e.Config.AgentID, Nonce: Token(), Expires: Millis() + 20000, Op: "consume-files-continuation", Username: a.Username, Transport: fresh, Body: Request{ID: a.ID, Generation: 1, PageEpoch: strings.Repeat("d", 64)}}
			if mode == "generation" {
				cmd.Body.Generation = 0
			}
			if mode == "same-ssh" {
				cmd.Transport = a.Transport
			}
			if mode == "same-page" {
				cmd.Body.PageEpoch = a.RegisteredOwner.PageEpoch
			}
			listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: filepath.Join(t.TempDir(), "original.sock"), Net: "unix"})
			if err != nil {
				t.Fatal(err)
			}
			defer listener.Close()
			client, err := net.DialUnix("unix", nil, listener.Addr().(*net.UnixAddr))
			if err != nil {
				t.Fatal(err)
			}
			defer client.Close()
			_ = listener.SetDeadline(time.Now().Add(time.Second))
			original, err := listener.AcceptUnix()
			if err != nil {
				t.Fatal(err)
			}
			defer original.Close()
			e.terminate = func(*Attempt) error { t.Fatal("unsafe scope reached old-workload cleanup"); return nil }
			if _, err := e.command(signedCommand(key, cmd), a.Username, cmd.Transport, 0, original); err == nil {
				t.Fatal("unsafe scope was accepted")
			}
			after, err := readStateSnapshot(e.Config.State)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(before.Attempts, after.Attempts) || len(after.Caps) != len(before.Caps) {
				t.Fatal("refused scope mutated the attempt or issued permission")
			}
		})
	}
}

// Called from the actual monitored Begin/pane/pidfd-exit fixture. The owned
// user-systemd scopes, supervisor IPC, fresh TLS proof and lifetime handles are
// real. Root SSH ancestry and the gateway's capture ledger are explicit seams.
func testActualFilesResume(t *testing.T, e *Engine, key ed25519.PrivateKey, old *Attempt, original *net.UnixConn, approval *atomic.Int64, mode *atomic.Int32) {
	t.Helper()
	newPeer, stop := testNativeRoleLifetime(t)
	defer stop()
	if err := os.WriteFile(os.Getenv("EXAM_TEST_SSH_PEER_FILE"), []byte(fmt.Sprint(newPeer.identity.pid)), 0600); err != nil {
		t.Fatal(err)
	}
	freshTransport := strings.Repeat("e", 64)
	until := Millis() + 60000
	approval.Store(until)
	registration := Command{Audience: e.Config.AgentID, Nonce: Token(), Expires: Millis() + 20000, Op: "register", Username: old.Username, Body: Request{Continuation: &Request{ID: old.ID, Generation: old.Generation, Expires: until}}}
	if _, err := e.command(signedCommand(key, registration), old.Username, freshTransport, 0, original); err != nil {
		t.Fatal("fresh authenticated registration with current instructor approval", err)
	}
	proofPath := filepath.Join(e.Config.Work, old.ID, "work", "files-only-proof.txt")
	if err := os.WriteFile(proofPath, []byte("saved before SSH loss\n"), 0600); err != nil {
		t.Fatal(err)
	}
	clock := []int64{old.Start, old.Deadline, old.OriginalDeadline, int64(old.UptimeDeadline * 1000)}
	cmd := Command{Audience: e.Config.AgentID, Nonce: Token(), Expires: Millis() + 20000, Op: "consume-files-continuation", Username: old.Username, Transport: freshTransport, Body: Request{ID: old.ID, Generation: old.Generation, PageEpoch: strings.Repeat("d", 64)}}
	mode.Store(1) // Validly signed reply for the WRONG candidate owner.
	if _, err := e.command(signedCommand(key, cmd), old.Username, freshTransport, 0, original); err == nil {
		t.Fatal("wrong fresh bootstrap owner accepted")
	}
	state, err := readStateSnapshot(e.Config.State)
	if err != nil {
		t.Fatal(err)
	}
	failed := state.Attempts[old.ID]
	if failed.State != "LOCKED" || failed.Authorization != until || failed.Transport != old.Transport || *failed.RegisteredOwner != *old.RegisteredOwner {
		t.Fatal("rejected proof consumed approval or changed canonical ownership", failed)
	}
	mode.Store(4)
	checkpoint := terminalResumeTransitionCheckpoint
	defer func() { terminalResumeTransitionCheckpoint = checkpoint }()
	terminalResumeTransitionCheckpoint = func(stage, id, state string) error {
		if stage == "files-authority-committed" {
			return errors.New("synthetic coordinator reply loss before canonical publication")
		}
		return nil
	}
	cmd.Nonce = Token()
	if _, err := e.command(signedCommand(key, cmd), old.Username, freshTransport, 0, original); err == nil || !strings.Contains(err.Error(), "synthetic coordinator reply loss") {
		t.Fatal("fault did not reach actual live authority boundary", err)
	}
	state, err = readStateSnapshot(e.Config.State)
	if err != nil || state.Attempts[old.ID].State != "LOCKED" || state.Attempts[old.ID].Authorization != until {
		t.Fatal("lost reply published ACTIVE or consumed approval", err)
	}
	terminalResumeTransitionCheckpoint = checkpoint
	cmd.Nonce = Token()
	result, err := e.command(signedCommand(key, cmd), old.Username, freshTransport, 0, original)
	if err != nil {
		t.Fatal("same original approval did not retry files-only Resume", err)
	}
	resumed := result.(map[string]any)["attempt"].(*Attempt)
	if resumed.State != "ACTIVE" || resumed.Transport != freshTransport || !currentRegisteredOwner(resumed) || resumed.RegisteredOwner.PageEpoch != cmd.Body.PageEpoch || resumed.RegisteredOwner.InputEpoch == old.RegisteredOwner.InputEpoch || resumed.RegisteredOwner.Generation != old.Generation || resumed.MonitoringResumeKind != "reviewed" || resumed.Authorization != 0 || resumed.AccessState != "HELD" || len(resumed.Units) != 0 || !sameGrant(resumed.Grant, old.Grant) {
		t.Fatal("inconsistent same-attempt fresh ownership", resumed)
	}
	if !reflect.DeepEqual(clock, []int64{resumed.Start, resumed.Deadline, resumed.OriginalDeadline, int64(resumed.UptimeDeadline * 1000)}) {
		t.Fatal("Resume reset or extended original/current clock", old, resumed)
	}
	data, err := os.ReadFile(proofPath)
	if err != nil || string(data) != "saved before SSH loss\n" {
		t.Fatal("files-only Resume replaced saved files", err)
	}
	cmd.Nonce = Token()
	if _, err := e.command(signedCommand(key, cmd), old.Username, freshTransport, 0, original); err != nil {
		t.Fatal("lost-result retry did not recover live original outcome", err)
	}
	oldPane := Command{Audience: e.Config.AgentID, Nonce: Token(), Expires: Millis() + 20000, Op: "issue-framed-owner-channel-admission", Username: old.Username, Transport: old.Transport, Body: Request{ID: old.ID, Pane: finalID, Purpose: "exam", Username: old.Username, Transport: old.Transport, PageEpoch: old.RegisteredOwner.PageEpoch}}
	if _, err := e.Command(signedCommand(key, oldPane), old.Username, old.Transport); err == nil {
		t.Fatal("retired SSH/page could mint a new pane")
	}
	newPane := oldPane
	newPane.Nonce, newPane.Transport, newPane.Body.PageEpoch = Token(), freshTransport, resumed.RegisteredOwner.PageEpoch
	newPane.Body.Transport = freshTransport
	if _, err := e.Command(signedCommand(key, newPane), old.Username, freshTransport); err != nil {
		t.Fatal("fresh live files-only owner cannot request a fresh terminal", err)
	}
}
