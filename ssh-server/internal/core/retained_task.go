package core

// Unwired C11 task observations only. No signal, authority, admission, whole-UID
// coverage, freeze or thaw is supplied here. Read outside the authority mutex.
import (
	"io"
	"os"
	"strconv"
	"strings"

	"golang.org/x/sys/unix"
)

type retainedTaskIdentity struct {
	TID, TGID int
	UIDs      [4]uint32
	Start     uint64
}

type retainedTaskObservation struct {
	Identity retainedTaskIdentity
	States   [4]byte // status/stat at both brackets; not a whole-group stop proof.
}

func retainedStatus(data []byte) (retainedTaskIdentity, byte, error) {
	var id retainedTaskIdentity
	var state byte
	if len(data) > 16384 {
		return id, state, errRetainedThreadInventory
	}
	seen := map[string]bool{}
	for _, line := range strings.Split(string(data), "\n") {
		name, rest, ok := strings.Cut(line, ":")
		if !ok || (name != "Pid" && name != "Tgid" && name != "Uid" && name != "State") {
			continue
		}
		if seen[name] {
			return retainedTaskIdentity{}, 0, errRetainedThreadInventory
		}
		seen[name] = true
		fields := strings.Fields(rest)
		switch name {
		case "Pid", "Tgid":
			if len(fields) != 1 {
				return retainedTaskIdentity{}, 0, errRetainedThreadInventory
			}
			n, err := strconv.ParseInt(fields[0], 10, 32)
			if err != nil || n <= 0 || strconv.FormatInt(n, 10) != fields[0] {
				return retainedTaskIdentity{}, 0, errRetainedThreadInventory
			}
			if name == "Pid" {
				id.TID = int(n)
			} else {
				id.TGID = int(n)
			}
		case "Uid":
			if len(fields) != 4 {
				return retainedTaskIdentity{}, 0, errRetainedThreadInventory
			}
			for n, field := range fields {
				uid, err := strconv.ParseUint(field, 10, 32)
				if err != nil || uid > 4294967294 || strconv.FormatUint(uid, 10) != field {
					return retainedTaskIdentity{}, 0, errRetainedThreadInventory
				}
				id.UIDs[n] = uint32(uid)
			}
		case "State":
			if len(fields) == 0 || len(fields[0]) != 1 || !strings.ContainsRune("RSDZTtXxKWPI", rune(fields[0][0])) {
				return retainedTaskIdentity{}, 0, errRetainedThreadInventory
			}
			state = fields[0][0]
		}
	}
	if len(seen) != 4 {
		return retainedTaskIdentity{}, 0, errRetainedThreadInventory
	}
	return id, state, nil
}

func retainedTaskSnapshot(status, stat []byte) (retainedTaskIdentity, [2]byte, error) {
	id, state, err := retainedStatus(status)
	if err != nil || len(stat) > 4096 {
		return retainedTaskIdentity{}, [2]byte{}, errRetainedThreadInventory
	}
	text := string(stat)
	open, end := strings.IndexByte(text, '('), strings.LastIndexByte(text, ')')
	if open < 1 || end <= open || strings.TrimSpace(text[:open]) != strconv.Itoa(id.TID) {
		return retainedTaskIdentity{}, [2]byte{}, errRetainedThreadInventory
	}
	fields := strings.Fields(text[end+1:])
	if len(fields) < 20 || len(fields[0]) != 1 || !strings.ContainsRune("RSDZTtXxKWPI", rune(fields[0][0])) {
		return retainedTaskIdentity{}, [2]byte{}, errRetainedThreadInventory
	}
	id.Start, err = strconv.ParseUint(fields[19], 10, 64)
	if err != nil || id.Start == 0 || strconv.FormatUint(id.Start, 10) != fields[19] {
		return retainedTaskIdentity{}, [2]byte{}, errRetainedThreadInventory
	}
	return id, [2]byte{state, fields[0][0]}, nil
}

func retainedProcRead(dir *os.File, name string, limit int64) ([]byte, error) {
	if dir == nil || (name != "status" && name != "stat") || limit < 1 || limit > 16384 {
		return nil, errRetainedThreadInventory
	}
	raw, err := dir.SyscallConn()
	if err != nil {
		return nil, errRetainedThreadInventory
	}
	fd := -1
	var inner error
	err = raw.Control(func(parent uintptr) {
		var fs unix.Statfs_t
		var info unix.Stat_t
		if unix.Fstatfs(int(parent), &fs) != nil || fs.Type != unix.PROC_SUPER_MAGIC || unix.Fstat(int(parent), &info) != nil || info.Mode&unix.S_IFMT != unix.S_IFDIR {
			inner = errRetainedThreadInventory
			return
		}
		fd, inner = unix.Openat(int(parent), name, unix.O_RDONLY|unix.O_NONBLOCK|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	})
	if err != nil || inner != nil || fd < 0 {
		if fd >= 0 {
			unix.Close(fd)
		}
		return nil, errRetainedThreadInventory
	}
	f := os.NewFile(uintptr(fd), "retained-kernel-task-observation")
	var fs unix.Statfs_t
	var info unix.Stat_t
	if unix.Fstatfs(fd, &fs) != nil || fs.Type != unix.PROC_SUPER_MAGIC || unix.Fstat(fd, &info) != nil || info.Mode&unix.S_IFMT != unix.S_IFREG {
		f.Close()
		return nil, errRetainedThreadInventory
	}
	data, readErr := io.ReadAll(io.LimitReader(f, limit+1))
	closeErr := f.Close()
	if readErr != nil || closeErr != nil || int64(len(data)) > limit {
		return nil, errRetainedThreadInventory
	}
	return data, nil
}

// Use the process-group pidfd, available on the existing kernel baseline, not
// a newer thread-pidfd API. A pinned thread proc directory cannot become a reused
// numeric task. Exact TGID/UID/start checks plus the group lifetime bracket are
// observations only: the caller still needs current complete scope/admission.
func observeRetainedTask(group *uidProcess, tid, uid int) (retainedTaskObservation, error) {
	bad := func() (retainedTaskObservation, error) { return retainedTaskObservation{}, errRetainedThreadInventory }
	if group == nil || group.pid < 1 || tid < 1 || int64(tid) > 2147483647 || uid < 0 || uint64(uid) > 4294967294 {
		return bad()
	}
	live, err := group.live()
	if err != nil || !live {
		return bad()
	}
	before, err := retainedProcRead(group.proc, "status", 16384)
	if err != nil {
		return bad()
	}
	leader, _, err := retainedStatus(before)
	if err != nil || leader.TID != group.pid || leader.TGID != group.pid {
		return bad()
	}
	matched := false
	for _, value := range leader.UIDs {
		matched = matched || value == uint32(uid)
	}
	if !matched {
		return bad()
	}
	fd, err := unix.Open("/proc/"+strconv.Itoa(tid), unix.O_PATH|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return bad()
	}
	proc := os.NewFile(uintptr(fd), "retained-pinned-thread-view")
	defer proc.Close()
	var result retainedTaskObservation
	for bracket := 0; bracket < 2; bracket++ {
		status, err := retainedProcRead(proc, "status", 16384)
		if err != nil {
			return bad()
		}
		stat, err := retainedProcRead(proc, "stat", 4096)
		if err != nil {
			return bad()
		}
		id, states, err := retainedTaskSnapshot(status, stat)
		if err != nil || id.TID != tid || id.TGID != group.pid || id.UIDs != leader.UIDs || (bracket == 1 && id != result.Identity) {
			return bad()
		}
		result.Identity = id
		copy(result.States[bracket*2:], states[:])
	}
	after, err := retainedProcRead(group.proc, "status", 16384)
	if err != nil {
		return bad()
	}
	current, _, err := retainedStatus(after)
	if err != nil || current != leader { // State is intentionally not identity.
		return bad()
	}
	live, err = group.live()
	if err != nil || !live {
		return bad()
	}
	return result, nil
}
