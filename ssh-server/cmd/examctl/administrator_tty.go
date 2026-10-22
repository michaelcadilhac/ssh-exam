package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
)

func readAdministratorTTY() (password []byte, result error) {
	fd, err := unix.Open("/dev/tty", unix.O_RDWR|unix.O_NOFOLLOW|unix.O_NOCTTY|unix.O_NONBLOCK|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, errors.New("No controlling terminal for a hidden prompt; use --password-stdin with exact finite private UTF-8 input, never a password argument/environment variable. See examctl web administrators help")
	}
	defer unix.Close(fd)
	saved, err := unix.IoctlGetTermios(fd, unix.TCGETS)
	if err != nil {
		return nil, errors.New("Cannot verify terminal settings; no credential read or request sent")
	}
	foreground, err := unix.IoctlGetInt(fd, unix.TIOCGPGRP)
	if err != nil || foreground != unix.Getpgrp() || saved.Lflag&(unix.ICANON|unix.ISIG) != (unix.ICANON|unix.ISIG) {
		return nil, errors.New("Hidden credential entry requires a foreground canonical controlling terminal; use --password-stdin with finite private input instead. No credential read or request sent")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM, syscall.SIGHUP, syscall.SIGQUIT)
	defer stop()
	ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	hidden := *saved
	hidden.Lflag &^= unix.ECHO | unix.ECHONL
	if err := unix.IoctlSetTermios(fd, unix.TCSETS, &hidden); err != nil {
		return nil, errors.New("Cannot disable terminal echo; no credential read or request sent")
	}
	defer func() {
		flush := unix.IoctlSetInt(fd, unix.TCFLSH, unix.TCIFLUSH)
		restore := unix.IoctlSetTermios(fd, unix.TCSETS, saved)
		if flush != nil || restore != nil {
			wipeAdministratorBytes(password)
			password = nil
			result = errors.New("Credential entry ended but terminal restoration could not be verified; no request sent. Restore the trusted terminal before retrying")
		}
	}()
	line := func(prompt string) (data []byte, result error) {
		fmt.Fprint(os.Stderr, prompt)
		defer fmt.Fprintln(os.Stderr)
		defer func() {
			if result != nil {
				wipeAdministratorBytes(data)
			}
		}()
		var one [1]byte
		for {
			if ctx.Err() != nil {
				return data, errors.New("Credential entry cancelled; no request sent")
			}
			fds := []unix.PollFd{{Fd: int32(fd), Events: unix.POLLIN}}
			if _, err := unix.Poll(fds, 100); err != nil && !errors.Is(err, unix.EINTR) {
				return data, errors.New("Credential terminal unavailable; no request sent")
			}
			if fds[0].Revents == 0 {
				continue
			}
			if fds[0].Revents & ^int16(unix.POLLIN) != 0 {
				return data, errors.New("Credential terminal closed; no request sent")
			}
			n, err := unix.Read(fd, one[:])
			if errors.Is(err, unix.EAGAIN) || errors.Is(err, unix.EINTR) {
				continue
			}
			if err != nil || n == 0 {
				return data, errors.New("Credential input ended before confirmation; no request sent")
			}
			if one[0] == '\n' || one[0] == '\r' {
				one[0] = 0
				return data, nil
			}
			data = append(data, one[0])
			one[0] = 0
			if len(data) > 4096 {
				return data, errors.New("Credential input exceeds4096 bytes; no request sent")
			}
		}
	}
	password, err = line("Administrator password (hidden): ")
	if err == nil {
		err = validateAdministratorPassword(password)
	}
	if err != nil {
		wipeAdministratorBytes(password)
		return nil, err
	}
	confirmation, err := line("Confirm administrator password (hidden): ")
	defer wipeAdministratorBytes(confirmation)
	if err == nil && !bytes.Equal(password, confirmation) {
		err = errors.New("Administrator passwords do not match; no request sent")
	}
	if err != nil {
		wipeAdministratorBytes(password)
		return nil, err
	}
	return password, nil
}
