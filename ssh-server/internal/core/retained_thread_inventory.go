package core

// Unwired C11 observation only. A list (even empty) is NOT closed launch
// admission, task/UID/lifetime verification, stopped writers or a frozen hold.
import (
	"errors"
	"io"
	"os"
	"sort"
	"strconv"
	"strings"

	"golang.org/x/sys/unix"
)

const retainedThreadLimit = 4096
const retainedThreadBytes = retainedThreadLimit * 12

var errRetainedThreadInventory = errors.New("retained workload thread inventory unavailable or unsafe; no writer-stop or freeze proof established")

func decodeRetainedThreadIDs(data []byte) ([]int, error) {
	if len(data) > retainedThreadBytes {
		return nil, errRetainedThreadInventory
	}
	ids := []int{}
	if len(data) == 0 {
		return ids, nil // Observation only, never proof that a late launch is impossible.
	}
	if data[len(data)-1] != '\n' {
		return nil, errRetainedThreadInventory
	}
	lines := strings.Split(string(data[:len(data)-1]), "\n")
	if len(lines) > retainedThreadLimit {
		return nil, errRetainedThreadInventory
	}
	seen := make(map[int]bool, len(lines))
	for _, line := range lines {
		id, err := strconv.ParseInt(line, 10, 32)
		if err != nil || id <= 0 || strconv.FormatInt(id, 10) != line || seen[int(id)] {
			return nil, errRetainedThreadInventory
		}
		seen[int(id)] = true
		ids = append(ids, int(id))
	}
	sort.Ints(ids)
	return ids, nil
}

// Caller must pin/verify the actual scope and ownership separately. Reject
// regular/private-file substitutes rather than treating a text file as kernel
// membership. The descriptor stays pinned across filesystem check and openat;
// never follow a caller path or alter a control file/permission.
func readRetainedCgroupThreads(scope *os.File) ([]int, error) {
	if scope == nil {
		return nil, errRetainedThreadInventory
	}
	raw, err := scope.SyscallConn()
	if err != nil {
		return nil, errRetainedThreadInventory
	}
	fd := -1
	var inner error
	err = raw.Control(func(parent uintptr) {
		var fs unix.Statfs_t
		var info unix.Stat_t
		if unix.Fstatfs(int(parent), &fs) != nil || fs.Type != unix.CGROUP2_SUPER_MAGIC || unix.Fstat(int(parent), &info) != nil || info.Mode&unix.S_IFMT != unix.S_IFDIR {
			inner = errRetainedThreadInventory
			return
		}
		fd, inner = unix.Openat(int(parent), "cgroup.threads", unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_NONBLOCK|unix.O_CLOEXEC, 0)
	})
	if err != nil || inner != nil || fd < 0 {
		if fd >= 0 {
			unix.Close(fd)
		}
		return nil, errRetainedThreadInventory
	}
	f := os.NewFile(uintptr(fd), "retained-kernel-thread-observation")
	var fs unix.Statfs_t
	var info unix.Stat_t
	if unix.Fstatfs(fd, &fs) != nil || fs.Type != unix.CGROUP2_SUPER_MAGIC || unix.Fstat(fd, &info) != nil || info.Mode&unix.S_IFMT != unix.S_IFREG {
		f.Close()
		return nil, errRetainedThreadInventory
	}
	data, readErr := io.ReadAll(io.LimitReader(f, retainedThreadBytes+1))
	closeErr := f.Close()
	if readErr != nil || closeErr != nil {
		return nil, errRetainedThreadInventory
	}
	return decodeRetainedThreadIDs(data)
}
