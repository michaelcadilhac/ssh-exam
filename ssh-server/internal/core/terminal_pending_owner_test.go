package core

import (
	"encoding/json"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

// Actual attach/SCM_RIGHTS/observation entry points with owned PTYs, pidfd and
// executable. Only the workload cgroup is the test's own group, not root SSH or
// a student scope. Blocking storage initialization is deliberate; no student
// process is launched and no freeze/permission qualification is inferred.
func TestActualSupervisorPendingRecordingFencesOwnerChanges(t *testing.T) {
	for _, mode := range []string{"page", "transport", "authorization", "generation", "erase", "bind-legacy", "clock-forward", "clock-backward"} {
		t.Run(mode, func(t *testing.T) {
			if os.Geteuid() < 1000 {
				t.Skip("synthetic registered student identity requires UID>=1000")
			}
			state, id := t.TempDir(), ManagementID()
			if err := os.Chmod(state, 0700); err != nil {
				t.Fatal(err)
			}
			dir, err := terminalSupervisorDirectory(state)
			if err != nil {
				t.Fatal(err)
			}
			defer dir.Close()
			listener, err := net.ListenUnix("unixpacket", &net.UnixAddr{Name: fmt.Sprintf("/proc/self/fd/%d/%s.sock", dir.Fd(), id), Net: "unixpacket"})
			if err != nil {
				t.Fatal(err)
			}
			defer listener.Close()
			if err := os.Chmod(filepath.Join(state, "terminal-supervisors", id+".sock"), 0600); err != nil {
				t.Fatal(err)
			}
			exe, err := os.Open("/proc/self/exe")
			if err != nil {
				t.Fatal(err)
			}
			defer exe.Close()
			group, err := os.ReadFile("/proc/self/cgroup")
			if err != nil {
				t.Fatal(err)
			}
			oldGroup := terminalWorkloadGroup
			terminalWorkloadGroup = func(string) (string, error) { return string(group), nil }
			defer func() { terminalWorkloadGroup = oldGroup }()
			s := &terminalSupervisor{id: id, unit: terminalSupervisorUnit(state, id), state: state, uid: -1, panes: map[string]bool{}, requests: map[string]terminalSupervisorAttach{}, timed: map[string]*supervisedRecordingIO{}}
			// The known held initialization mutex is the protocol barrier. Do not
			// infer that a timeout, absent file or missing ready reply is refusal.
			s.storageMu.Lock()
			defer s.storageMu.Unlock()
			owner := monitoringOwner{Attempt: id, Exam: "synthetic", Username: "synthetic", UID: os.Geteuid(), TransportHash: strings.Repeat("a", 64), Boot: boot(), PageEpoch: strings.Repeat("b", 64), InputEpoch: strings.Repeat("c", 64), Generation: 1, ClockRevision: 2}
			firstOwner := owner
			if mode == "bind-legacy" {
				firstOwner = monitoringOwner{}
			}
			// All accepted requests are made invalid before releasing the storage
			// barrier, so cleanup closes only the descriptors this fixture owns.
			resources, err := terminalRecordingResources(state, id)
			if err != nil {
				t.Fatal(err)
			}
			defer func() {
				for _, f := range resources {
					f.Close()
				}
			}()
			type attached struct {
				client *net.UnixConn
				done   chan struct{}
			}
			var requests []attached
			defer func() {
				if err := os.Remove(filepath.Join(state, "monitoring", id)); err != nil {
					t.Error(err)
				}
				s.storageMu.Unlock()
				for _, r := range requests {
					r.client.Close()
					select {
					case <-r.done:
					case <-time.After(2 * time.Second):
						t.Error("actual attach handler failed to retire")
					}
				}
				s.storageMu.Lock()
				if s.storage != nil {
					s.storage.close()
				}
			}()
			attach := func(o monitoringOwner) attached {
				t.Helper()
				client, err := net.DialUnix("unixpacket", nil, listener.Addr().(*net.UnixAddr))
				if err != nil {
					t.Fatal(err)
				}
				server, err := listener.AcceptUnix()
				if err != nil {
					t.Fatal(err)
				}
				done := make(chan struct{})
				go func() { defer close(done); s.attach(server, exe) }()
				requests = append(requests, attached{client, done})
				_ = client.SetDeadline(time.Now().Add(2 * time.Second))
				if _, err := client.Write([]byte{0}); err != nil {
					t.Fatal(err)
				}
				var hello [2]byte
				if n, err := client.Read(hello[:]); err != nil || n != 1 || hello[0] != 1 {
					t.Fatal("missing actual attach hello", err)
				}
				outer, err := unix.Socketpair(unix.AF_UNIX, unix.SOCK_STREAM|unix.SOCK_CLOEXEC, 0)
				if err != nil {
					t.Fatal(err)
				}
				defer unix.Close(outer[0])
				defer unix.Close(outer[1])
				master, slave, err := openPTY()
				if err != nil {
					t.Fatal(err)
				}
				defer master.Close()
				defer slave.Close()
				process, err := pinUIDProcess(os.Getpid(), os.Geteuid())
				if err != nil || process == nil {
					t.Fatal(err)
				}
				defer process.close()
				pane, instance := ManagementID(), ManagementID()
				unit := "exam-" + id + "-" + pane + "-" + instance + ".scope"
				generation, transport := owner.Generation, owner.TransportHash
				if o != (monitoringOwner{}) {
					generation, transport = o.Generation, o.TransportHash
				}
				r := terminalSupervisorAttach{RegisteredOwner: o, Attempt: id, Pane: pane, Unit: unit, PID: os.Getpid(), UID: os.Geteuid(), Username: "synthetic", Purpose: "exam", Expires: Millis() + 10000, Proof: PaneInstance{Attempt: id, Pane: pane, ID: instance, Boot: boot()}, Recording: terminalRecordingContext{Attempt: id, Pane: pane, Unit: unit, Username: "synthetic", UID: os.Geteuid(), Generation: generation, Start: Millis(), Boot: boot(), TransportHash: Hash([]byte(transport))}, RecordingLimit: 1 << 20}
				data, _ := json.Marshal(r)
				rights := []int{outer[0], int(slave.Fd()), int(master.Fd()), int(process.handle.Fd()), int(process.proc.Fd())}
				for _, f := range resources {
					rights = append(rights, int(f.Fd()))
				}
				if _, _, err := client.WriteMsgUnix(data, unix.UnixRights(rights...), nil); err != nil {
					t.Fatal(err)
				}
				return attached{client, done}
			}
			first := attach(firstOwner)
			wait := func(check func() bool) {
				t.Helper()
				for until := time.Now().Add(time.Second); time.Now().Before(until); {
					if check() {
						return
					}
					time.Sleep(time.Millisecond)
				}
				t.Fatal("fixture missed intended attach/closed initialization stage")
			}
			wait(func() bool { return s.observation().AttachedPanes == 1 })
			select {
			case <-first.done:
				t.Fatal("first handoff did not reach held initialization")
			default:
			}
			next := owner
			switch mode {
			case "page":
				next.PageEpoch = strings.Repeat("d", 64)
			case "transport":
				next.TransportHash = strings.Repeat("d", 64)
			case "authorization":
				next.InputEpoch = strings.Repeat("d", 64)
			case "generation":
				next.Generation++
			case "erase":
				next = monitoringOwner{}
			case "clock-forward":
				next.ClockRevision++
			case "clock-backward":
				next.ClockRevision--
			}
			second := attach(next)
			completed := false
			wait(func() bool {
				select {
				case <-second.done:
					completed = true
					return true
				default:
				}
				return s.observation().AttachedPanes == 2
			})
			// Exercise the supported diagnostic protocol while the first handoff
			// is blocked; it must remain responsive and report the original owner.
			type observed struct {
				view TerminalSupervisorObservation
				err  error
			}
			observation := make(chan observed, 1)
			go func() {
				view, err := ObserveTerminalSupervisor(state, id)
				observation <- observed{view, err}
			}()
			if err := listener.SetDeadline(time.Now().Add(time.Second)); err != nil {
				t.Fatal(err)
			}
			query, err := listener.AcceptUnix()
			if err != nil {
				t.Fatal("diagnostic query did not reach accepting endpoint", err)
			}
			s.attach(query, exe)
			var view TerminalSupervisorObservation
			select {
			case result := <-observation:
				if result.err != nil {
					t.Fatal("pending handoff blocked diagnostic entry", result.err)
				}
				view = result.view
			case <-time.After(time.Second):
				t.Fatal("diagnostic completion did not return")
			}
			if mode == "clock-forward" {
				if completed || view.AttachedPanes != 2 || view.RegisteredOwner == nil || *view.RegisteredOwner != next {
					t.Fatal("same-owner forward clock failed to join pending cohort", view)
				}
			} else if !completed || view.AttachedPanes != 1 || (firstOwner != (monitoringOwner{}) && (view.RegisteredOwner == nil || *view.RegisteredOwner != firstOwner)) || (firstOwner == (monitoringOwner{}) && view.RegisteredOwner != nil) {
				t.Fatal("pending recording handoff allowed replacement/rollback of its owner", view)
			}
		})
	}
}
