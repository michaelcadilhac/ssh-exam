package core

import (
	"encoding/json"
	"io"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

// Count/clean only descriptors for this exact still-existing synthetic inode,
// never all process descriptors or another user's files. The handler has ended.
func ownedGateDescriptors(t *testing.T, info os.FileInfo) []int {
	t.Helper()
	want := info.Sys().(*syscall.Stat_t)
	entries, err := os.ReadDir("/proc/self/fd")
	if err != nil {
		t.Fatal(err)
	}
	var result []int
	for _, entry := range entries {
		fd, err := strconv.Atoi(entry.Name())
		if err != nil {
			continue
		}
		got, err := os.Stat("/proc/self/fd/" + entry.Name())
		if err != nil {
			continue
		}
		stat := got.Sys().(*syscall.Stat_t)
		if stat.Dev == want.Dev && stat.Ino == want.Ino {
			result = append(result, fd)
		}
	}
	return result
}

func TestLocalGateClosesReceivedDescriptorsOnEveryRefusalAndOrdinaryReturn(t *testing.T) {
	for _, name := range []string{"malformed", "unapproved", "ordinary", "command", "admission", "two-rights", "truncated-rights"} {
		t.Run(name, func(t *testing.T) {
			e, err := New(Config{State: t.TempDir()})
			if err != nil {
				t.Fatal(err)
			}
			if name != "unapproved" {
				e.Config.Accounts = map[string]Account{"synthetic": {UID: os.Getuid(), Shell: "/bin/sh", Home: t.TempDir()}}
			}
			listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: filepath.Join(t.TempDir(), "gate.sock"), Net: "unix"})
			if err != nil {
				t.Fatal(err)
			}
			defer listener.Close()
			done := make(chan struct{})
			go func() {
				defer close(done)
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
			_ = client.SetDeadline(time.Now().Add(2 * time.Second))
			marker, err := os.Create(filepath.Join(t.TempDir(), "owned-marker"))
			if err != nil {
				t.Fatal(err)
			}
			info, err := marker.Stat()
			if err != nil {
				t.Fatal(err)
			}
			request := LocalRequest{Ordinary: true}
			if name == "command" {
				request = LocalRequest{Command: &SignedFrame{}}
			}
			if name == "admission" || name == "two-rights" || name == "truncated-rights" {
				request = LocalRequest{Token: strings.Repeat("a", 64)}
			}
			data, _ := json.Marshal(request)
			if name == "malformed" {
				data = []byte("{")
			}
			fds := []int{int(marker.Fd())}
			if name == "two-rights" {
				fds = append(fds, fds[0])
			}
			if name == "truncated-rights" {
				for len(fds) < 8 {
					fds = append(fds, fds[0])
				}
			}
			_, _, err = client.WriteMsgUnix(data, syscall.UnixRights(fds...), nil)
			_ = marker.Close() // Only the receiver may retain this inode now.
			if err != nil {
				t.Fatal(err)
			}
			_, _ = io.Copy(io.Discard, io.LimitReader(client, 65536))
			select {
			case <-done:
			case <-time.After(2 * time.Second):
				t.Fatal("owned gate request did not settle")
			}
			leaked := ownedGateDescriptors(t, info)
			// Preserve a clean test process even for the intentional RED run.
			for _, fd := range leaked {
				_ = syscall.Close(fd)
			}
			if len(leaked) != 0 {
				t.Fatalf("returned local handler leaked %d received descriptors for its owned synthetic file", len(leaked))
			}
			if name == "admission" {
				// One descriptor is a valid envelope. Its later SSH-ancestry
				// rejection follows legacy WithState initialization, unlike a
				// malformed/extra descriptor frame. It must grant no authority.
				state, err := readStateSnapshot(e.Config.State)
				if err != nil || len(state.Attempts) != 0 || len(state.Caps) != 0 || len(state.Registrations) != 0 {
					t.Fatal("rejected ancestry created attempt/admission authority", err)
				}
			} else if _, err := os.Stat(filepath.Join(e.Config.State, "state.json")); !os.IsNotExist(err) {
				t.Fatal("invalid descriptor frame initialized or changed native state", err)
			}
		})
	}
}

func TestGateDescriptorActualPTYOwnershipAndTruncatedPrefix(t *testing.T) {
	for _, count := range []int{1, 8} {
		t.Run(strconv.Itoa(count), func(t *testing.T) {
			listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: filepath.Join(t.TempDir(), "rights.sock"), Net: "unix"})
			if err != nil {
				t.Fatal(err)
			}
			defer listener.Close()
			client, err := net.DialUnix("unix", nil, listener.Addr().(*net.UnixAddr))
			if err != nil {
				t.Fatal(err)
			}
			defer client.Close()
			server, err := listener.AcceptUnix()
			if err != nil {
				t.Fatal(err)
			}
			defer server.Close()
			master, slave, err := openPTY()
			if err != nil {
				t.Fatal(err)
			}
			defer master.Close()
			defer slave.Close()
			fds := make([]int, count)
			for i := range fds {
				fds[i] = int(slave.Fd())
			}
			if _, _, err := client.WriteMsgUnix([]byte("x"), syscall.UnixRights(fds...), nil); err != nil {
				t.Fatal(err)
			}
			data, control := make([]byte, 1), make([]byte, syscall.CmsgSpace(4))
			_, on, flags, _, err := server.ReadMsgUnix(data, control)
			if err != nil {
				t.Fatal(err)
			}
			owned, parseErr := receiveGateDescriptors(control[:on], flags)
			defer owned.close()
			if count > 1 {
				if flags&unix.MSG_CTRUNC == 0 || parseErr == nil {
					t.Fatal("real extra-descriptor truncation not rejected", flags, parseErr)
				}
				for _, file := range owned.files {
					if file != nil {
						t.Fatal("truncated installed prefix remains open on refusal")
					}
				}
				return
			}
			if parseErr != nil {
				t.Fatal(parseErr)
			}
			file, err := owned.takeOnly()
			if err != nil {
				t.Fatal(err)
			}
			defer file.Close()
			fd := int(file.Fd())
			cloexec, err := unix.FcntlInt(uintptr(fd), unix.F_GETFD, 0)
			if err != nil || cloexec&unix.FD_CLOEXEC == 0 {
				t.Fatal("received PTY lacks close-on-exec", err)
			}
			owned.close()
			owned.close()
			if _, err := unix.IoctlGetTermios(fd, unix.TCGETS); err != nil {
				t.Fatal("group cleanup closed transferred PTY", err)
			}
			if _, err := owned.takeOnly(); err == nil {
				t.Fatal("descriptor ownership transferred twice")
			}
			_ = file.Close()
			// The transferred File's idempotent close and empty group must not
			// close a later reused numeric descriptor belonging to another file.
			marker, err := os.Create(filepath.Join(t.TempDir(), "reused"))
			if err != nil {
				t.Fatal(err)
			}
			defer marker.Close()
			owned.close()
			_ = file.Close()
			if _, err := marker.WriteString("still owned"); err != nil {
				t.Fatal("descriptor cleanup damaged a later file", err)
			}
		})
	}
}

func TestGateDescriptorRejectsIncompleteNativeHeadersWithoutUnsafeParse(t *testing.T) {
	for length := 1; length < unix.CmsgLen(0); length++ {
		owned, err := receiveGateDescriptors(make([]byte, length), 0)
		owned.close()
		if err == nil {
			t.Fatal("incomplete native header accepted", length)
		}
	}
}
