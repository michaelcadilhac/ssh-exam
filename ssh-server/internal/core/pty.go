package core

import (
	"fmt"
	"io"
	"os"
	"syscall"
	"time"
	"unsafe"
)

type windowSize struct{ Row, Col, X, Y uint16 }

func ioctl(fd uintptr, op uintptr, p unsafe.Pointer) error {
	_, _, e := syscall.Syscall(syscall.SYS_IOCTL, fd, op, uintptr(p))
	if e != 0 {
		return e
	}
	return nil
}
func rawTerminal(fd uintptr) (func(), error) {
	var saved syscall.Termios
	if err := ioctl(fd, syscall.TCGETS, unsafe.Pointer(&saved)); err != nil {
		return nil, err
	}
	raw := saved
	raw.Iflag &^= syscall.IGNBRK | syscall.BRKINT | syscall.PARMRK | syscall.ISTRIP | syscall.INLCR | syscall.IGNCR | syscall.ICRNL | syscall.IXON
	raw.Oflag &^= syscall.OPOST
	raw.Lflag &^= syscall.ECHO | syscall.ECHONL | syscall.ICANON | syscall.ISIG | syscall.IEXTEN
	raw.Cflag &^= syscall.CSIZE | syscall.PARENB
	raw.Cflag |= syscall.CS8
	raw.Cc[syscall.VMIN] = 1
	raw.Cc[syscall.VTIME] = 0
	if err := ioctl(fd, syscall.TCSETS, unsafe.Pointer(&raw)); err != nil {
		return nil, err
	}
	return func() { ioctl(fd, syscall.TCSETS, unsafe.Pointer(&saved)) }, nil
}

func openPTY() (*os.File, *os.File, error) {
	m, err := os.OpenFile("/dev/ptmx", os.O_RDWR|syscall.O_NOCTTY, 0)
	if err != nil {
		return nil, nil, err
	}
	var lock int32
	var number uint32
	if err = ioctl(m.Fd(), syscall.TIOCSPTLCK, unsafe.Pointer(&lock)); err != nil {
		m.Close()
		return nil, nil, err
	}
	if err = ioctl(m.Fd(), syscall.TIOCGPTN, unsafe.Pointer(&number)); err != nil {
		m.Close()
		return nil, nil, err
	}
	s, err := os.OpenFile(fmt.Sprintf("/dev/pts/%d", number), os.O_RDWR|syscall.O_NOCTTY, 0)
	if err != nil {
		m.Close()
		return nil, nil, err
	}
	return m, s, nil
}
func bridgePTY(original, master *os.File, done <-chan struct{}) {
	go func() { io.Copy(master, original); master.Close() }()
	go func() { io.Copy(original, master) }()
	go func() {
		timer := time.NewTicker(100 * time.Millisecond)
		defer timer.Stop()
		for {
			select {
			case <-done:
				return
			case <-timer.C:
				var size windowSize
				if ioctl(original.Fd(), syscall.TIOCGWINSZ, unsafe.Pointer(&size)) == nil && size.Row > 1 && size.Col > 1 {
					ioctl(master.Fd(), syscall.TIOCSWINSZ, unsafe.Pointer(&size))
				}
			}
		}
	}()
}
