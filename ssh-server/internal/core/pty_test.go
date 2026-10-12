package core

import (
	"bytes"
	"io"
	"syscall"
	"testing"
	"time"
	"unsafe"
)

func TestRawOuterPTYForwardsKeystrokesAndInterruptByte(t *testing.T) {
	master, slave, err := openPTY()
	if err != nil {
		t.Fatal(err)
	}
	defer master.Close()
	defer slave.Close()
	var saved syscall.Termios
	if err = ioctl(slave.Fd(), syscall.TCGETS, unsafe.Pointer(&saved)); err != nil {
		t.Fatal(err)
	}
	restore, err := rawTerminal(slave.Fd())
	if err != nil {
		t.Fatal(err)
	}
	defer restore()
	want := []byte{'x', 3}
	result := make(chan []byte, 1)
	go func() {
		b := make([]byte, len(want))
		if _, err := io.ReadFull(slave, b); err == nil {
			result <- b
		}
	}()
	master.Write(want)
	select {
	case got := <-result:
		if !bytes.Equal(got, want) {
			t.Fatalf("outer PTY transformed interactive bytes: %v", got)
		}
	case <-time.After(time.Second):
		t.Fatal("outer PTY buffered keystrokes or consumed Ctrl-C")
	}
	restore()
	var restored syscall.Termios
	ioctl(slave.Fd(), syscall.TCGETS, unsafe.Pointer(&restored))
	if restored != saved {
		t.Fatal("terminal settings were not restored")
	}
}
