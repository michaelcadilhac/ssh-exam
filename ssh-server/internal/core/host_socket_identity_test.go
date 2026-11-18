package core

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

type hostSocketProbe struct {
	Uncovered []string `json:"uncovered"`
	Error     string   `json:"error"`
}

func TestHostSocketFDReuseDoesNotInventExposedPath(t *testing.T) {
	testHostSocketFDProbe(t, "private")
}

func TestHostSocketFDRejectsForeignSocketWithSamePrivateName(t *testing.T) {
	testHostSocketFDProbe(t, "foreign")
}

func TestHostSocketFDRejectsHardlinkedPrivateSocket(t *testing.T) {
	testHostSocketFDProbe(t, "hardlink")
}

func TestHostSocketFDRejectsWritablePrivateDirectory(t *testing.T) {
	testHostSocketFDProbe(t, "writable")
}

func testHostSocketFDProbe(t *testing.T, mode string) {
	t.Helper()
	state := t.TempDir()
	if err := os.Chmod(state, 0700); err != nil {
		t.Fatal(err)
	}
	directory := filepath.Join(state, "terminal-supervisors")
	if err := os.Mkdir(directory, 0700); err != nil {
		t.Fatal(err)
	}
	dir, err := os.Open(directory)
	if err != nil {
		t.Fatal(err)
	}
	defer dir.Close()
	fd, err := unix.FcntlInt(dir.Fd(), unix.F_DUPFD_CLOEXEC, 128)
	if err != nil {
		t.Fatal(err)
	}
	defer unix.Close(fd)
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		t.Fatal(err)
	}
	id[6], id[8] = id[6]&15|64, id[8]&63|128
	name := fmt.Sprintf("%x-%x-%x-%x-%x.sock", id[:4], id[4:6], id[6:8], id[8:10], id[10:])
	boundDirectory := directory
	if mode == "foreign" {
		// A genuine private endpoint with the same basename must NOT attest
		// a different kernel socket outside that protected directory.
		private, err := net.ListenUnix("unixpacket", &net.UnixAddr{Name: fmt.Sprintf("/proc/self/fd/%d/%s", dir.Fd(), name), Net: "unixpacket"})
		if err != nil {
			t.Fatal(err)
		}
		private.SetUnlinkOnClose(false)
		defer private.Close()
		if err := os.Chmod(filepath.Join(directory, name), 0600); err != nil {
			t.Fatal(err)
		}
		boundDirectory = t.TempDir()
		other, err := os.Open(boundDirectory)
		if err != nil {
			t.Fatal(err)
		}
		defer other.Close()
		if err := unix.Dup3(int(other.Fd()), fd, unix.O_CLOEXEC); err != nil {
			t.Fatal(err)
		}
	}
	address := fmt.Sprintf("/proc/self/fd/%d/%s", fd, name)
	listener, err := net.ListenUnix("unixpacket", &net.UnixAddr{Name: address, Net: "unixpacket"})
	if err != nil {
		t.Fatal(err)
	}
	listener.SetUnlinkOnClose(false)
	defer listener.Close()
	if err := os.Chmod(filepath.Join(boundDirectory, name), 0600); err != nil {
		t.Fatal(err)
	}
	if mode == "hardlink" {
		if err := os.Link(filepath.Join(boundDirectory, name), filepath.Join(t.TempDir(), "outside.sock")); err != nil {
			t.Fatal(err)
		}
	}
	if mode == "writable" {
		if err := os.Chmod(directory, 0777); err != nil {
			t.Fatal(err)
		}
	}
	file, err := listener.File()
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	// Unaccepted connections can appear in kernel diagnostics with inode0.
	// They must not turn a healthy listener snapshot into a duplicate failure.
	for i := 0; i < 2; i++ {
		pending, err := net.DialUnix("unixpacket", nil, &net.UnixAddr{Name: address, Net: "unixpacket"})
		if err != nil {
			t.Fatal(err)
		}
		defer pending.Close()
	}
	// The coordinator may reuse this OWNED descriptor after handing its
	// listener to another process. Replace it atomically; never close an
	// unowned descriptor or depend on a race with the Go runtime.
	unrelated, err := os.Open("/usr")
	if err != nil {
		t.Fatal(err)
	}
	defer unrelated.Close()
	if err := unix.Dup3(int(unrelated.Fd()), fd, unix.O_CLOEXEC); err != nil {
		t.Fatal(err)
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, executable, "-test.run=^TestHostSocketFDScannerChild$")
	command.ExtraFiles = []*os.File{file}
	command.Env = []string{"PATH=/usr/bin:/bin", "GOMAXPROCS=2", "EXAM_TEST_SOCKET_STATE=" + state,
		"EXAM_TEST_SOCKET_NAME=" + name, "EXAM_TEST_SOCKET_FD=" + strconv.Itoa(fd)}
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("bounded scanner child failed: %v: %s", err, output)
	}
	var result hostSocketProbe
	for _, line := range bytes.Split(output, []byte{'\n'}) {
		if bytes.HasPrefix(line, []byte("HOST_SOCKET_PROBE ")) {
			if err := json.Unmarshal(bytes.TrimPrefix(line, []byte("HOST_SOCKET_PROBE ")), &result); err != nil {
				t.Fatal(err)
			}
			if mode != "private" {
				expected := "private socket identity"
				if mode == "writable" {
					expected = "private directory owner/mode"
				}
				if !strings.Contains(result.Error, expected) {
					t.Fatalf("unsafe %s socket accepted or wrong refusal reached: %+v", mode, result)
				}
				return
			}
			if result.Error != "" || len(result.Uncovered) != 0 {
				t.Fatalf("a protected inherited socket became an invented exposed path after FD reuse: %+v", result)
			}
			return
		}
	}
	t.Fatalf("scanner child produced no receipt: %s", output)
}

func TestHostSocketFDScannerChild(t *testing.T) {
	state := os.Getenv("EXAM_TEST_SOCKET_STATE")
	if state == "" {
		return
	}
	fd, err := strconv.Atoi(os.Getenv("EXAM_TEST_SOCKET_FD"))
	if err != nil || fd < 128 {
		t.Fatal("invalid owned descriptor", err)
	}
	dir, err := os.Open("/usr")
	if err != nil {
		t.Fatal(err)
	}
	defer dir.Close()
	owned, err := unix.FcntlInt(dir.Fd(), unix.F_DUPFD_CLOEXEC, fd)
	if err != nil || owned != fd {
		t.Fatal("could not reserve the intended unused child descriptor", owned, err)
	}
	defer unix.Close(owned)
	inherited := os.NewFile(3, "synthetic-inherited-listener")
	defer inherited.Close()
	listener, err := net.FileListener(inherited)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	name := os.Getenv("EXAM_TEST_SOCKET_NAME")
	address := fmt.Sprintf("/proc/self/fd/%d/%s", fd, name)
	if listener.Addr().String() != address || canonicalHostPath(address) != "/usr/"+name {
		t.Fatal("did not reach cross-process caller-relative FD mismatch")
	}
	info, err := os.Lstat(filepath.Join(state, "terminal-supervisors", name))
	if err != nil || info.Mode()&os.ModeSocket == 0 {
		t.Fatal("real protected socket disappeared", err)
	}
	table, err := os.ReadFile("/proc/net/unix")
	if err != nil {
		t.Fatal(err)
	}
	var selected []string
	for _, line := range strings.Split(string(table), "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 8 && strings.Join(fields[7:], " ") == address {
			selected = append(selected, line)
		}
	}
	if len(selected) == 0 {
		t.Fatal("real inherited listener is absent from the kernel inventory")
	}
	uncovered, failure := uncoveredHostSockets(strings.Join(selected, "\n"), []string{state}, state)
	result := hostSocketProbe{Uncovered: uncovered}
	if failure != nil {
		result.Error = failure.Error()
	}
	encoded, _ := json.Marshal(result)
	fmt.Println("HOST_SOCKET_PROBE " + string(encoded))
}
