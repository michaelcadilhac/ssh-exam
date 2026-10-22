package core

import (
	"encoding/json"
	"errors"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
)

// Exercise the actual gate, including transferred PTY and ACK. Only SSH ancestry
// and the stalled OS start are replaced; no host manager or student UID signals.
func TestLocalPaneBlockedStartDoesNotOwnSharedStateAndClosePreventsLateLaunch(t *testing.T) {
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
	e.paneIdentity = func(pid, uid int) (string, error) {
		if pid != os.Getpid() || uid != os.Getuid() {
			return "", errors.New("wrong Unix peer")
		}
		return r.Transport, nil
	}
	entered, release := make(chan struct{}), make(chan struct{})
	var releaseOnce sync.Once
	unblock := func() { releaseOnce.Do(func() { close(release) }) }
	e.paneStart = func() error {
		close(entered)
		<-release
		return errors.New("synthetic manager refused closed startup")
	}
	listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: filepath.Join(t.TempDir(), "launch.sock"), Net: "unix"})
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	finished := make(chan struct{})
	defer func() {
		listener.Close()
		unblock()
		select {
		case <-finished:
		case <-time.After(3 * time.Second):
			t.Error("owned gate runner did not settle")
		}
	}()
	go func() {
		defer close(finished)
		conn, err := listener.AcceptUnix()
		if err == nil {
			e.local(conn)
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
	frame, _ := json.Marshal(LocalRequest{Token: token})
	if _, _, err := client.WriteMsgUnix(frame, syscall.UnixRights(int(slave.Fd())), nil); err != nil {
		t.Fatal(err)
	}
	var ready map[string]any
	if err := json.NewDecoder(client).Decode(&ready); err != nil || ready["error"] != nil {
		t.Fatal("actual gate did not reach ready", ready, err)
	}
	if _, err := client.Write([]byte{1}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("actual gate did not reach OS start")
	}
	other, err := New(e.Config)
	if err != nil {
		t.Fatal(err)
	}
	controlled := make(chan error, 1)
	controlsDone := make(chan struct{})
	t.Cleanup(func() {
		select {
		case <-controlsDone:
		case <-time.After(3 * time.Second):
			t.Error("owned signed-control runner did not settle after startup release")
		}
	})
	go func() {
		defer close(controlsDone)
		healthy := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "renew-execution-lease", Username: "student", Transport: "ssh-a", Body: Request{ID: finalID}}
		if _, err := other.Command(signedCommand(key, healthy), "student", "ssh-a"); err != nil {
			controlled <- err
			return
		}
		cmd.Op, cmd.Nonce, cmd.Body = "inspect-attempt", Token(), Request{ID: r.ID}
		if _, err := other.Command(signedCommand(key, cmd), r.Username, r.Transport); err != nil {
			controlled <- err
			return
		}
		cmd.Op, cmd.Nonce, cmd.Body = "close-pane", Token(), Request{ID: r.ID, Pane: finalID}
		_, err := other.Command(signedCommand(key, cmd), r.Username, r.Transport)
		controlled <- err
	}()
	select {
	case err := <-controlled:
		if err != nil {
			t.Fatal("closed startup could not be cancelled", err)
		}
	case <-time.After(time.Second):
		t.Fatal("blocked manager startup owns shared state: signed inspection/close cannot finish")
	}
	// Release explicitly so assertions observe settlement, not a timed-out client.
	unblock()
	var refusal map[string]string
	if err := json.NewDecoder(client).Decode(&refusal); err != nil || !strings.Contains(refusal["error"], "synthetic manager") {
		t.Fatal("startup refusal lost", refusal, err)
	}
	select {
	case <-finished:
	case <-time.After(time.Second):
		t.Fatal("cancelled startup did not settle")
	}
	s, err := readStateSnapshot(e.Config.State)
	if err != nil {
		t.Fatal(err)
	}
	a := s.Attempts[r.ID]
	if a.Start != 0 || a.State != "PREPARING" || len(a.Units) != 0 || len(s.PaneInstances) != 0 {
		t.Fatal("late startup changed attempt or stranded pending capacity", a)
	}
}

func TestLocalPaneClosedLaunchThroughActualUserScopeAndPTY(t *testing.T) {
	if os.Getenv("EXAM_COLLECTION_USER_SYSTEMD") != "1" {
		t.Skip("explicit owned local user-scope qualification only")
	}
	for _, mode := range []string{"execute", "close-before-release"} {
		t.Run(mode, func(t *testing.T) {
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
			e.paneIdentity = func(pid, uid int) (string, error) {
				if pid != os.Getpid() || uid != os.Getuid() {
					return "", errors.New("wrong actual Unix peer")
				}
				return r.Transport, nil
			}
			parked, release := make(chan struct{}), make(chan struct{})
			var once sync.Once
			unblock := func() { once.Do(func() { close(release) }) }
			e.paneBootstrapStart = func(launch *exec.Cmd, control *net.UnixConn, exe *os.File, unit string, proof PaneInstance) (*paneBootstrapPeer, bool, error) {
				peer, started, err := ownedPaneBootstrapStart(t, launch, control, exe, unit, proof)
				close(parked)
				if mode == "close-before-release" {
					<-release
				}
				return peer, started, err
			}
			listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: filepath.Join(t.TempDir(), "closed.sock"), Net: "unix"})
			if err != nil {
				t.Fatal(err)
			}
			finished := make(chan struct{})
			defer func() {
				listener.Close()
				unblock()
				select {
				case <-finished:
				case <-time.After(8 * time.Second):
					t.Error("owned gate did not settle")
				}
			}()
			go func() {
				defer close(finished)
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
			_ = client.SetDeadline(time.Now().Add(8 * time.Second))
			master, slave, err := openPTY()
			if err != nil {
				t.Fatal(err)
			}
			defer master.Close()
			defer slave.Close()
			request, _ := json.Marshal(LocalRequest{Token: token})
			if _, _, err := client.WriteMsgUnix(request, syscall.UnixRights(int(slave.Fd())), nil); err != nil {
				t.Fatal(err)
			}
			var ready map[string]any
			if err := json.NewDecoder(client).Decode(&ready); err != nil || ready["error"] != nil {
				t.Fatal("actual gate refused before ACK", ready, err)
			}
			if _, err := client.Write([]byte{1}); err != nil {
				t.Fatal(err)
			}
			select {
			case <-parked:
			case <-time.After(4 * time.Second):
				t.Fatal("actual bootstrap did not park")
			}
			if mode == "close-before-release" {
				view, err := ObserveNativePanes(e.Config.State, NativePaneQuery{Attempt: r.ID, Pane: finalID, Limit: 1})
				if err != nil || len(view.Panes) != 1 || view.Panes[0].ClosedStartups != 1 || view.Panes[0].Revision == "" {
					t.Fatal("pending actual entry not inspectable", view, err)
				}
				cmd.Op, cmd.Nonce, cmd.Body = "close-pane", Token(), Request{ID: r.ID, Pane: finalID}
				if _, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport); err != nil {
					t.Fatal(err)
				}
				unblock()
				var reply map[string]string
				if err := json.NewDecoder(client).Decode(&reply); err != nil || reply["error"] == "" {
					t.Fatal("late closed bootstrap did not refuse", reply, err)
				}
			} else {
				// The actual bridge must deliver post-permit shell output and input.
				_ = master.SetReadDeadline(time.Now().Add(4 * time.Second))
				var output strings.Builder
				buffer := make([]byte, 1024)
				for !strings.Contains(output.String(), "SYNTHETIC-CLOSED-PANE-EXEC") {
					n, err := master.Read(buffer)
					output.Write(buffer[:n])
					if err != nil {
						t.Fatal("actual released PTY shell missing", err, output.String())
					}
				}
				if _, err := master.Write([]byte("finish\n")); err != nil {
					t.Fatal(err)
				}
				var reply map[string]bool
				if err := json.NewDecoder(client).Decode(&reply); err != nil || !reply["ended"] {
					t.Fatal("actual shell did not finish", reply, err)
				}
			}
			select {
			case <-finished:
			case <-time.After(time.Second):
				t.Fatal("settled gate did not return")
			}
			s, err := readStateSnapshot(e.Config.State)
			if err != nil {
				t.Fatal(err)
			}
			a := s.Attempts[r.ID]
			if a.Start != 0 || a.State != "PREPARING" || len(a.Units) != 0 || len(s.PaneInstances) != 0 {
				t.Fatal("closed gate altered time/preflight or stranded slot", a)
			}
			if s.Attempts[finalID].State != "ACTIVE" {
				t.Fatal("another attempt changed")
			}
		})
	}
}
