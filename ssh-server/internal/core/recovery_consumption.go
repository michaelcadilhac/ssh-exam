package core

import (
	"errors"
	"fmt"
	"os"
	"strings"
	"syscall"

	"golang.org/x/sys/unix"
)

// No named temporary catalog entry: a crash before publication closes/reclaims
// the unnamed inode. Never fall back to writing a partial final authority name.
func openUnpublishedPrivateMarker(root *os.File) (*os.File, error) {
	if err := readOnlyPrivateDir(root); err != nil {
		return nil, err
	}
	fd, err := unix.Openat(int(root.Fd()), ".", unix.O_TMPFILE|unix.O_RDWR|unix.O_CLOEXEC|unix.O_NONBLOCK, 0600)
	if err != nil {
		return nil, err
	}
	f := os.NewFile(uintptr(fd), "unpublished-private-marker")
	info, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, err
	}
	stat := info.Sys().(*syscall.Stat_t)
	if !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 || stat.Uid != uint32(os.Geteuid()) || stat.Nlink != 0 {
		f.Close()
		return nil, errRecoveryMetadata
	}
	if err := f.Chmod(0600); err != nil { // This new unnamed inode only, never a retained marker.
		f.Close()
		return nil, err
	}
	return f, nil
}

// Early compatibility/current-storage check in the isolated staging worker,
// never a reservation or guarantee against a later disk failure. No final name.
func (e *Engine) probeRecoveryConsumptionStorage(a *Attempt) error {
	if a == nil || !attemptID.MatchString(a.ID) || !identifier.MatchString(a.Exam) {
		return errRecoveryMetadata
	}
	root, err := e.openRecoveryExam(a.Exam)
	if err != nil {
		return err
	}
	defer root.Close()
	f, err := openUnpublishedPrivateMarker(root)
	if err != nil {
		return err
	}
	defer f.Close()
	if _, err := f.Write([]byte(a.ID)); err != nil {
		return err
	}
	if err := f.Sync(); err != nil {
		return err
	}
	return f.Close()
}

// This publishes bytes, NOT permission. The caller validates committed identity,
// source, interval, one-use state and the existing private receipt separately.
func publishPrivateMarkerNew(root *os.File, name string, data []byte, checkpoint func(string) error) (result error) {
	if name == "" || name == "." || name == ".." || len(name) > 128 || strings.ContainsAny(name, "/\\\x00") || len(data) == 0 || len(data) > 4096 {
		return errRecoveryMetadata
	}
	if err := readOnlyPrivateDir(root); err != nil {
		return err
	}
	var named unix.Stat_t
	if err := unix.Fstatat(int(root.Fd()), name, &named, unix.AT_SYMLINK_NOFOLLOW); err == nil {
		return os.ErrExist // A hint only; caller must validate existing contents.
	} else if !errors.Is(err, unix.ENOENT) {
		return err
	}
	f, err := openUnpublishedPrivateMarker(root)
	if err != nil {
		return err
	}
	defer func() {
		if err := f.Close(); result == nil {
			result = err
		}
	}()
	if _, err := f.Write(data); err != nil {
		return err
	}
	if checkpoint != nil {
		if err := checkpoint("written"); err != nil {
			return err
		}
	}
	if err := f.Sync(); err != nil {
		return err
	}
	if checkpoint != nil {
		if err := checkpoint("flushed"); err != nil {
			return err
		}
	}
	// The ONLY followed link is the kernel's own retained descriptor for this
	// still-open unnamed inode, never a caller path. This documented form does
	// not add CAP_DAC_READ_SEARCH. Linkat never replaces an existing destination.
	// https://man7.org/linux/man-pages/man2/open.2.html (O_TMPFILE)
	if err := unix.Linkat(unix.AT_FDCWD, fmt.Sprintf("/proc/self/fd/%d", f.Fd()), int(root.Fd()), name, unix.AT_SYMLINK_FOLLOW); err != nil {
		return err
	}
	info, err := f.Stat()
	if err != nil {
		return err
	}
	if err := unix.Fstatat(int(root.Fd()), name, &named, unix.AT_SYMLINK_NOFOLLOW); err != nil {
		return err
	}
	stat := info.Sys().(*syscall.Stat_t)
	if stat.Nlink != 1 || named.Nlink != 1 || named.Ino != stat.Ino || uint64(named.Dev) != uint64(stat.Dev) {
		return errRecoveryMetadata // Preserve published bytes on uncertainty.
	}
	return root.Sync()
}

func recoveryConsumptionIORefusal(a *Attempt, err error) error {
	return fmt.Errorf("recovery consumption publication unavailable; original interval/access hold remain committed, never reset time or remove markers; inspect examctl info %s --read-only and examctl recovery-grants --exam %s; after restoring storage use examctl workspace-repair %s --reason 'Storage repaired; publish original work only': %w", a.ID, a.Exam, a.ID, err)
}

func (e *Engine) commitRecoveryConsumption(a *Attempt) error {
	if a == nil || !attemptID.MatchString(a.ID) || !identifier.MatchString(a.Exam) || !identifier.MatchString(a.Username) || a.Start <= 0 || a.Deadline <= 0 {
		return errRecoveryMetadata
	}
	root, err := e.openRecoveryExam(a.Exam)
	if err != nil {
		return recoveryConsumptionIORefusal(a, err)
	}
	defer root.Close()
	name := a.Username + ".json.consumed"
	err = publishPrivateMarkerNew(root, name, []byte(a.ID), func(phase string) error {
		return e.workspaceBarrier("consumption-" + phase)
	})
	if err == nil {
		return nil
	}
	if !errors.Is(err, os.ErrExist) {
		return recoveryConsumptionIORefusal(a, err)
	}
	b, err := recoveryMetadataFile(root, name, 36)
	if err != nil {
		return recoveryMetadataRefusal(a)
	}
	if string(b) != a.ID {
		return fmt.Errorf("recovery consumption conflicts with another or incomplete record; preserve every marker and interval; inspect examctl recovery-grants --exam %s and examctl info %s --read-only; never overwrite/remove a marker", a.Exam, a.ID)
	}
	if err := root.Sync(); err != nil {
		return recoveryConsumptionIORefusal(a, err)
	}
	return nil
}
