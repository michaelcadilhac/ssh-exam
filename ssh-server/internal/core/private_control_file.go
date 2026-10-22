package core

import (
	"errors"
	"io"
	"os"
	"syscall"
)

var errPrivateControlFile = errors.New("private control metadata unavailable or unsafe")

// A pinned private directory and a single-component name only. NONBLOCK avoids
// FIFO opens; regular storage IO can still stall. No repair, chmod or mutation.
func privateControlFile(root *os.File, name string, limit int64) ([]byte, error) {
	f, err := readOnlyOpenAt(root, name, false)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	before, err := f.Stat()
	if err != nil || !before.Mode().IsRegular() || before.Mode().Perm()&0077 != 0 || before.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) || before.Sys().(*syscall.Stat_t).Nlink != 1 || before.Size() > limit {
		return nil, errPrivateControlFile
	}
	b, err := io.ReadAll(io.LimitReader(f, limit+1))
	if err != nil || int64(len(b)) > limit {
		return nil, errPrivateControlFile
	}
	after, err := f.Stat()
	if err != nil || before.Size() != after.Size() || !before.ModTime().Equal(after.ModTime()) || before.Sys().(*syscall.Stat_t).Ctim != after.Sys().(*syscall.Stat_t).Ctim {
		return nil, errPrivateControlFile
	}
	return b, nil
}
