package core

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
	"unsafe"
)

func TestGateReadyRawChild(t *testing.T) {
	const marker = "--gate-ready-raw-child="
	if !strings.HasPrefix(os.Args[len(os.Args)-1], marker) {
		return
	}
	socket := strings.TrimPrefix(os.Args[len(os.Args)-1], marker)
	notice, release := os.NewFile(3, "owned-ready-notice"), os.NewFile(4, "owned-ready-release")
	defer notice.Close()
	defer release.Close()
	gateReadyCheckpoint = func() {
		var term syscall.Termios
		err := ioctl(0, syscall.TCGETS, unsafe.Pointer(&term))
		raw := err == nil && term.Lflag&(syscall.ICANON|syscall.ISIG|syscall.ECHO) == 0 && term.Iflag&(syscall.ICRNL|syscall.IXON) == 0 && term.Oflag&syscall.OPOST == 0
		if json.NewEncoder(notice).Encode(map[string]bool{"raw": raw}) != nil {
			os.Exit(81)
		}
		_ = release.SetReadDeadline(time.Now().Add(3 * time.Second))
		var one [1]byte
		if _, err := io.ReadFull(release, one[:]); err != nil || one[0] != 1 {
			os.Exit(82)
		}
	}
	os.Args = []string{os.Args[0], "-c", "exam-gateway"}
	if Gate(socket) != nil {
		os.Exit(83)
	}
	os.Exit(0)
}

// Actual Gate in an owned child/PTY, blocked exactly before EXAM-READY output.
// The Unix agent response is mocked; this is terminal-ordering/entry-role proof,
// not authenticated native admission, a clock, SSH liveness or verified freeze.
func TestActualGateMakesPTYRawBeforePublishingFramedReady(t *testing.T) {
	socket := filepath.Join(t.TempDir(), "entry.sock")
	listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: socket, Net: "unix"})
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	_ = listener.SetDeadline(time.Now().Add(5 * time.Second))
	master, slave, err := openPTYMasterFlags(syscall.O_NONBLOCK)
	if err != nil {
		t.Fatal(err)
	}
	defer master.Close()
	defer slave.Close()
	fd := int(master.Fd())
	if err := syscall.SetNonblock(fd, true); err != nil {
		t.Fatal(err)
	}
	notice, noticeChild, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer notice.Close()
	defer noticeChild.Close()
	releaseChild, release, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer release.Close()
	defer releaseChild.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	child := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestGateReadyRawChild$", "--", "--gate-ready-raw-child="+socket)
	child.Env = append(os.Environ(), "GORACE=atexit_sleep_ms=0")
	child.Stdin, child.Stdout, child.Stderr = slave, slave, slave
	child.ExtraFiles = []*os.File{noticeChild, releaseChild}
	if err := child.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = child.Process.Kill(); _ = child.Wait() }()
	noticeChild.Close()
	releaseChild.Close()
	peer, err := listener.AcceptUnix()
	if err != nil {
		t.Fatal("owned entry did not connect", err)
	}
	defer peer.Close()
	_ = peer.SetDeadline(time.Now().Add(5 * time.Second))
	if _, err := supervisionReadUntil(fd, "EXAM-GATE/1", time.Second); err != nil {
		t.Fatal("entry did not request admission", err)
	}
	if _, err := master.Write([]byte(`{"token":"` + Token() + `"}` + "\n")); err != nil {
		t.Fatal(err)
	}
	buf, oob := make([]byte, 8192), make([]byte, syscall.CmsgSpace(4))
	n, on, flags, _, err := peer.ReadMsgUnix(buf, oob)
	fds, descriptorErr := receiveGateDescriptors(oob[:on], flags)
	defer fds.close()
	if err != nil || descriptorErr != nil || len(fds.files) != 1 {
		t.Fatal("entry descriptor stage was not reached", err, descriptorErr)
	}
	var request LocalRequest
	if json.Unmarshal(buf[:n], &request) != nil {
		t.Fatal("invalid entry request")
	}
	if err := json.NewEncoder(peer).Encode(map[string]any{"attempt": finalID, "pane": ManagementID(), "input_protocol": "v1", "input_epoch": Token()}); err != nil {
		t.Fatal(err)
	}
	_ = notice.SetReadDeadline(time.Now().Add(2 * time.Second))
	var observed struct{ Raw bool }
	if err := json.NewDecoder(notice).Decode(&observed); err != nil {
		t.Fatal("exact ready-publication checkpoint was not reached", err)
	}
	if !observed.Raw {
		t.Fatal("EXAM-READY could publish before the actual entry PTY preserves framed binary bytes")
	}
	if request.InputProtocol != "v1" {
		t.Fatal("loaded entry did not offer its explicit framing protocol")
	}
	if _, err := release.Write([]byte{1}); err != nil {
		t.Fatal(err)
	}
	if _, err := supervisionReadUntil(fd, "EXAM-READY ", time.Second); err != nil {
		t.Fatal("raw entry did not publish readiness", err)
	}
	var ack [1]byte
	if _, err := io.ReadFull(peer, ack[:]); err != nil || ack[0] != 1 {
		t.Fatal("entry did not acknowledge after readiness", err)
	}
	if _, err := peer.Write([]byte("{\"ended\":true}\n")); err != nil {
		t.Fatal(err)
	}
	if err := child.Wait(); err != nil {
		t.Fatal("owned entry did not complete", err)
	}
}
