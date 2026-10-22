package core

import (
	"encoding/json"
	"errors"
	"io"
	"net"
	"os"
	"path/filepath"
	"sync/atomic"
	"syscall"
	"testing"
	"time"
)

// Actual Engine.local Unix/SCM_RIGHTS/PTY entry, with only SSH ancestry and OS
// exec replaced. No user-wide signals or host system-manager calls are allowed.
func TestLocalPaneSlowSetupLeavesSignedControlsAvailableAndCannotLaunchAfterClose(t *testing.T) {
	for _, action := range []string{"close-pane", "cancel-attempt", "invalid-pty", "setup-failure"} {
		t.Run(action, func(t *testing.T) {
			e, key, r := preparationFixture(t)
			e.preparationReady = func() (bool, []string) { return true, nil }
			if _, err := e.Call("prepare-attempt", r); err != nil {
				t.Fatal(err)
			}
			cmd := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "issue-channel-admission", Username: r.Username, Transport: r.Transport, Body: Request{ID: r.ID, Pane: finalID, Purpose: "practice", Username: r.Username, Transport: r.Transport}}
			result, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport)
			if err != nil {
				t.Fatal(err)
			}
			token := result.(map[string]string)["token"]
			before, err := readStateSnapshot(e.Config.State)
			if err != nil {
				t.Fatal(err)
			}
			var starts atomic.Int32
			e.paneStart = func() error { starts.Add(1); return errors.New("test forbids actual OS launch") }
			e.paneIdentity = func(pid, uid int) (string, error) {
				if pid != os.Getpid() || uid != os.Getuid() {
					return "", errors.New("wrong actual Unix peer")
				}
				return r.Transport, nil
			}
			reader, writer, err := os.Pipe()
			if err != nil {
				t.Fatal(err)
			}
			defer reader.Close()
			defer writer.Close()
			entered := make(chan struct{})
			e.paneSetupCheckpoint = func() error {
				close(entered)
				_, err := io.Copy(io.Discard, reader)
				if action == "setup-failure" {
					return errors.New("synthetic private filesystem unavailable")
				}
				return err
			}
			listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: filepath.Join(t.TempDir(), "gate.sock"), Net: "unix"})
			if err != nil {
				t.Fatal(err)
			}
			defer listener.Close()
			gateDone := make(chan struct{})
			go func() {
				defer close(gateDone)
				c, err := listener.AcceptUnix()
				if err == nil {
					e.local(c)
				}
			}()
			client, err := net.DialUnix("unix", nil, listener.Addr().(*net.UnixAddr))
			if err != nil {
				t.Fatal(err)
			}
			defer client.Close()
			_ = client.SetDeadline(time.Now().Add(5 * time.Second))
			master, slave, err := openPTY()
			if err != nil {
				t.Fatal(err)
			}
			defer master.Close()
			defer slave.Close()
			sent := slave
			if action == "invalid-pty" {
				sent, err = os.Create(filepath.Join(t.TempDir(), "not-a-terminal"))
				if err != nil {
					t.Fatal(err)
				}
				defer sent.Close()
			}
			info, err := sent.Stat()
			if err != nil {
				t.Fatal(err)
			}
			beforeFDs := len(ownedGateDescriptors(t, info))
			request, _ := json.Marshal(LocalRequest{Token: token})
			if _, _, err := client.WriteMsgUnix(request, syscall.UnixRights(int(sent.Fd())), nil); err != nil {
				t.Fatal(err)
			}
			select {
			case <-entered:
			case <-time.After(2 * time.Second):
				t.Fatal("actual gate did not reach setup")
			}
			if lock, err := e.accountWorkLock(r.UID); err == nil {
				lock.Close()
				t.Error("private setup lacks its same-UID exclusion fence")
			}
			if e.paneSetupMu.TryLock() {
				e.paneSetupMu.Unlock()
				t.Error("private setup has no per-engine copy resource bound")
			}
			// A second actual entry is refused promptly, rather than queued on
			// global state or allowed to allocate another private-copy workload.
			second, err := net.DialUnix("unix", nil, listener.Addr().(*net.UnixAddr))
			if err != nil {
				t.Fatal(err)
			}
			defer second.Close()
			secondDone := make(chan struct{})
			go func() {
				defer close(secondDone)
				c, err := listener.AcceptUnix()
				if err == nil {
					e.local(c)
				}
			}()
			_ = second.SetDeadline(time.Now().Add(2 * time.Second))
			if _, _, err := second.WriteMsgUnix(request, syscall.UnixRights(int(sent.Fd())), nil); err != nil {
				t.Fatal(err)
			}
			var busy map[string]any
			if err := json.NewDecoder(second).Decode(&busy); err != nil || busy["error"] != "private terminal setup is busy; retry opening this pane after checks settle; this is not a monitoring violation and starts no new clock" {
				t.Fatal("second actual pane entry did not report bounded busy", err, busy)
			}
			<-secondDone
			controls := make(chan error, 1)
			go func() {
				for _, op := range []string{"inspect-attempt", "issue-channel-admission"} {
					cmd := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: op, Username: "student", Transport: "ssh-a", Body: Request{ID: finalID, Pane: preparationID, Purpose: "exam", Username: "student", Transport: "ssh-a"}}
					if _, err := e.Command(signedCommand(key, cmd), "student", "ssh-a"); err != nil {
						controls <- err
						return
					}
				}
				if action == "invalid-pty" || action == "setup-failure" {
					controls <- nil
					return
				}
				cmd := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: action, Username: r.Username, Transport: r.Transport, Body: Request{ID: r.ID, Pane: finalID, Reason: "Synthetic cancellation during pane IO"}}
				_, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport)
				controls <- err
			}()
			observed := false
			select {
			case err := <-controls:
				observed = true
				if err != nil {
					t.Error(err)
				}
			case <-time.After(500 * time.Millisecond):
				t.Error("pane filesystem setup blocks another student's signed controls/close")
			}
			writer.Close()
			if !observed {
				select {
				case err := <-controls:
					if err != nil {
						t.Error(err)
					}
				case <-time.After(2 * time.Second):
					t.Fatal("controls did not unwind")
				}
			}
			decoder := json.NewDecoder(client)
			var reply map[string]any
			if err := decoder.Decode(&reply); err != nil {
				t.Fatal("gate did not reply after setup", err)
			}
			if action == "close-pane" && reply["error"] != nil {
				t.Fatal("close regression never reached actual private setup/ready/ACK", reply)
			}
			if action == "invalid-pty" && reply["error"] != "not a terminal descriptor" {
				t.Fatal("fixture missed actual terminal refusal", reply)
			}
			if action == "setup-failure" && reply["error"] != "synthetic private filesystem unavailable" {
				t.Fatal("fixture missed controlled setup failure", reply)
			}
			if reply["error"] == nil {
				if reply["attempt"] != r.ID {
					t.Fatal("wrong actual gate ready", reply)
				}
				lock, err := e.accountWorkLock(r.UID)
				if err != nil {
					t.Fatal("provisional ready holds UID fence", err)
				}
				lock.Close()
				if !e.paneSetupMu.TryLock() {
					t.Fatal("client ACK wait holds copy capacity")
				}
				e.paneSetupMu.Unlock()
				if _, err := client.Write([]byte{1}); err != nil {
					t.Fatal(err)
				}
				if err := decoder.Decode(&reply); err != nil || reply["error"] == nil {
					t.Fatal("late ACK was not refused", err, reply)
				}
			}
			select {
			case <-gateDone:
			case <-time.After(2 * time.Second):
				t.Fatal("gate did not finish")
			}
			if starts.Load() != 0 {
				t.Fatal("closed/cancelled admission reached OS launch")
			}
			if len(ownedGateDescriptors(t, info)) != beforeFDs {
				t.Fatal("received descriptor leaked after pane refusal")
			}
			lock, err := e.accountWorkLock(r.UID)
			if err != nil {
				t.Fatal("finished setup stranded UID fence", err)
			}
			lock.Close()
			if !e.paneSetupMu.TryLock() {
				t.Fatal("finished setup stranded copy capacity")
			}
			e.paneSetupMu.Unlock()
			state, err := readStateSnapshot(e.Config.State)
			if err != nil {
				t.Fatal(err)
			}
			a := state.Attempts[r.ID]
			oldPeer, peer := before.Attempts[finalID], state.Attempts[finalID]
			if oldPeer.State != peer.State || oldPeer.Start != peer.Start || oldPeer.Deadline != peer.Deadline || oldPeer.OriginalDeadline != peer.OriginalDeadline || oldPeer.Generation != peer.Generation || oldPeer.AccessState != peer.AccessState || oldPeer.Transport != peer.Transport || oldPeer.Protected != peer.Protected {
				t.Fatal("one pane's setup changed another student's authority/history")
			}
			if a.Start != 0 || a.Deadline != 0 || len(a.Units) != 0 {
				t.Fatal("setup started time/workload")
			}
			if action == "cancel-attempt" && a.State != "CANCELLED_BEFORE_START" {
				t.Fatal("late setup revived cancellation")
			}
			if action == "cancel-attempt" {
				r.ID = "44444444-1234-1234-1234-123456789abc"
				if _, err := e.Call("prepare-attempt", r); err != nil {
					t.Fatal("old setup prevented new explicit preparation", err)
				}
				if err := e.Tick(); err != nil {
					t.Fatal("cancelled cleanup failed to settle", err)
				}
				if _, err := os.Stat(filepath.Join(e.Config.State, "homes", r.ID, ".bashrc")); err != nil {
					t.Fatal("old cancellation removed new preparation", err)
				}
			}
		})
	}
}
