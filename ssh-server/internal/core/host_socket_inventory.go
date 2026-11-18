package core

// A bound /proc/self/fd pathname records the BINDER's descriptor number. It
// cannot be resolved in the scanner, or after that descriptor has been reused.
// Verify our private control sockets using the kernel's filesystem identity.
import (
	"encoding/binary"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
)

type hostSocketPath struct {
	inode uint32
	name  string
}

var errHostUnixSnapshotChanged = errors.New("UNIX socket inventory changed during observation")

type hostUnixSocket struct {
	name   string
	kind   byte
	state  byte
	inode  uint32
	device uint32
	hasVFS bool
}

func resolveHostSocketPaths(records []hostSocketPath, state string) ([]hostSocketPath, error) {
	needed := false
	for _, record := range records {
		needed = needed || strings.HasPrefix(record.name, "/proc/")
	}
	if !needed {
		return records, nil
	}
	var failure error
	// A listener may retire between the text inventory, kernel snapshot and
	// pathname check. Retry one fresh complete kernel observation, never guess
	// that a missing/changed private pathname proves an unrelated socket safe.
	for attempt := 0; attempt < 2; attempt++ {
		identities, err := readHostUnixSockets()
		if err != nil {
			if attempt == 0 && errors.Is(err, errHostUnixSnapshotChanged) {
				continue
			}
			return nil, fmt.Errorf("UNIX socket metadata unavailable; preserve existing work and inspect examctl health before retrying: %w", err)
		}
		resolved := make([]hostSocketPath, 0, len(records))
		failure = nil
		for _, record := range records {
			if !strings.HasPrefix(record.name, "/proc/") {
				resolved = append(resolved, record)
				continue
			}
			identity, found := identities[record.inode]
			if !found {
				continue // Positively absent from the newer COMPLETE kernel dump.
			}
			if (identity.kind == unix.SOCK_STREAM || identity.kind == unix.SOCK_SEQPACKET) && identity.state != 10 { // TCP_LISTEN
				continue
			}
			path, err := privateHostSocketPath(state, record.name, identity)
			if err != nil {
				failure = err
				break
			}
			resolved = append(resolved, hostSocketPath{inode: record.inode, name: path})
		}
		if failure == nil {
			return resolved, nil
		}
	}
	return nil, failure
}

func privateHostSocketPath(state, address string, identity hostUnixSocket) (string, error) {
	fail := func(stage string) (string, error) {
		return "", fmt.Errorf("unverified process-relative host service socket (%s); preserve existing work and inspect its physical location with examctl health: %s", stage, address)
	}
	parts := strings.Split(address, "/")
	if len(parts) != 6 || parts[1] != "proc" || parts[3] != "fd" || identity.name != address || !identity.hasVFS {
		return fail("kernel identity/address")
	}
	if parts[2] != "self" && parts[2] != "thread-self" {
		if pid, err := strconv.ParseUint(parts[2], 10, 32); err != nil || pid == 0 {
			return fail("publisher address")
		}
	}
	if _, err := strconv.ParseUint(parts[4], 10, 32); err != nil || !filepath.IsAbs(state) || filepath.Clean(state) != state {
		return fail("descriptor/state path")
	}
	parent := state
	name := parts[5]
	if name != nativeWatchdogSocket {
		if !strings.HasSuffix(name, ".sock") || !attemptID.MatchString(strings.TrimSuffix(name, ".sock")) {
			return fail("unknown native endpoint name")
		}
		parent = filepath.Join(state, "terminal-supervisors")
	}
	for _, path := range []string{state, parent} {
		info, err := os.Lstat(path)
		real, canonicalErr := filepath.EvalSymlinks(path)
		if err != nil || canonicalErr != nil || real != path || !info.IsDir() {
			return fail("private directory path")
		}
		stat := info.Sys().(*syscall.Stat_t)
		if stat.Uid != uint32(os.Geteuid()) || stat.Mode&07777 != 0700 {
			return fail("private directory owner/mode")
		}
	}
	path := filepath.Join(parent, name)
	info, err := os.Lstat(path)
	if err != nil || info.Mode()&os.ModeSocket == 0 {
		return fail("private socket path/type")
	}
	stat := info.Sys().(*syscall.Stat_t)
	major, minor := unix.Major(uint64(stat.Dev)), unix.Minor(uint64(stat.Dev))
	// UNIX_DIAG_VFS uses inode then device in the Linux UAPI, and the device
	// is the KERNEL dev_t (12 major/20 minor bits), not userspace stat.dev.
	if stat.Uid != uint32(os.Geteuid()) || stat.Mode&07777 != 0600 || stat.Nlink != 1 ||
		stat.Ino > uint64(^uint32(0)) || major > 0xfff || minor > 0xfffff ||
		uint32(stat.Ino) != identity.inode || major<<20|minor != identity.device {
		return fail("private socket identity/owner/mode")
	}
	return path, nil
}

func readHostUnixSockets() (map[uint32]hostUnixSocket, error) {
	fd, err := unix.Socket(unix.AF_NETLINK, unix.SOCK_RAW|unix.SOCK_CLOEXEC|unix.SOCK_NONBLOCK, unix.NETLINK_SOCK_DIAG)
	if err != nil {
		return nil, err
	}
	defer unix.Close(fd)
	if err := unix.Bind(fd, &unix.SockaddrNetlink{Family: unix.AF_NETLINK}); err != nil {
		return nil, err
	}
	address, err := unix.Getsockname(fd)
	if err != nil {
		return nil, err
	}
	port, ok := address.(*unix.SockaddrNetlink)
	if !ok || port.Pid == 0 {
		return nil, errors.New("invalid socket metadata port")
	}
	request := make([]byte, 40) // nlmsghdr(16) + unix_diag_req(24)
	binary.NativeEndian.PutUint32(request[0:4], uint32(len(request)))
	binary.NativeEndian.PutUint16(request[4:6], unix.SOCK_DIAG_BY_FAMILY)
	binary.NativeEndian.PutUint16(request[6:8], unix.NLM_F_REQUEST|unix.NLM_F_DUMP)
	binary.NativeEndian.PutUint32(request[8:12], 1)
	binary.NativeEndian.PutUint32(request[12:16], port.Pid)
	request[16] = unix.AF_UNIX
	binary.NativeEndian.PutUint32(request[20:24], ^uint32(0)) // all states
	binary.NativeEndian.PutUint32(request[28:32], 3)          // NAME | VFS
	binary.NativeEndian.PutUint32(request[32:36], ^uint32(0))
	binary.NativeEndian.PutUint32(request[36:40], ^uint32(0))
	if err := unix.Sendto(fd, request, 0, &unix.SockaddrNetlink{Family: unix.AF_NETLINK}); err != nil {
		return nil, err
	}
	deadline := time.Now().Add(2 * time.Second)
	result := map[uint32]hostUnixSocket{}
	buffer := make([]byte, 128*1024)
	total := 0
	for {
		remaining := time.Until(deadline)
		if remaining <= 0 {
			return nil, errors.New("socket metadata observation timed out")
		}
		poll := []unix.PollFd{{Fd: int32(fd), Events: unix.POLLIN}}
		_, err := unix.Poll(poll, int((remaining+time.Millisecond-1)/time.Millisecond))
		if err == unix.EINTR {
			continue
		}
		if err != nil {
			return nil, err
		}
		if poll[0].Revents&unix.POLLIN == 0 {
			if poll[0].Revents != 0 {
				return nil, errors.New("socket metadata channel unavailable")
			}
			continue
		}
		n, _, flags, sender, err := unix.Recvmsg(fd, buffer, nil, 0)
		if err == unix.EINTR || err == unix.EAGAIN {
			continue
		}
		if err != nil {
			return nil, err
		}
		kernel, ok := sender.(*unix.SockaddrNetlink)
		total += n
		if !ok || kernel.Pid != 0 || kernel.Groups != 0 || flags&unix.MSG_TRUNC != 0 || n == 0 || total > 4*1024*1024 {
			return nil, errors.New("unverified or oversized socket metadata reply")
		}
		for offset := 0; offset < n; {
			if n-offset < 16 {
				return nil, errors.New("truncated socket metadata header")
			}
			header := buffer[offset:]
			size := int(binary.NativeEndian.Uint32(header[:4]))
			kind := binary.NativeEndian.Uint16(header[4:6])
			bits := binary.NativeEndian.Uint16(header[6:8])
			if bits&unix.NLM_F_DUMP_INTR != 0 {
				return nil, errHostUnixSnapshotChanged
			}
			if size < 16 || size > n-offset || binary.NativeEndian.Uint32(header[8:12]) != 1 ||
				binary.NativeEndian.Uint32(header[12:16]) != port.Pid {
				return nil, errors.New("incomplete or mismatched socket metadata reply")
			}
			payload := header[16:size]
			offset += (size + 3) &^ 3
			if offset > n {
				return nil, errors.New("truncated socket metadata alignment")
			}
			if kind == unix.NLMSG_ERROR || kind == unix.NLMSG_DONE {
				if len(payload) >= 4 && binary.NativeEndian.Uint32(payload[:4]) != 0 {
					return nil, syscall.Errno(-int32(binary.NativeEndian.Uint32(payload[:4])))
				}
				if kind == unix.NLMSG_DONE {
					return result, nil
				}
				if len(payload) < 4 {
					return nil, errors.New("truncated socket metadata error")
				}
				continue
			}
			if kind != unix.SOCK_DIAG_BY_FAMILY {
				return nil, errors.New("unexpected socket metadata reply")
			}
			inode, socket, err := parseHostUnixSocket(payload)
			if err != nil {
				return nil, err
			}
			// Pending/accepted stream endpoints can share an inherited address
			// and even have inode0 before accept. They are not pathname servers.
			if socket.name == "" || socket.name[0] != '/' ||
				((socket.kind == unix.SOCK_STREAM || socket.kind == unix.SOCK_SEQPACKET) && socket.state != 10) {
				continue
			}
			if inode == 0 {
				return nil, errors.New("unidentified live UNIX pathname server")
			}
			if _, duplicate := result[inode]; duplicate || len(result) >= 65536 {
				return nil, errors.New("duplicate or excessive socket metadata")
			}
			result[inode] = socket
		}
	}
}

func parseHostUnixSocket(payload []byte) (uint32, hostUnixSocket, error) {
	var result hostUnixSocket
	fail := func() (uint32, hostUnixSocket, error) {
		return 0, result, errors.New("malformed UNIX socket identity")
	}
	if len(payload) < 16 || payload[0] != unix.AF_UNIX {
		return fail()
	}
	inode := binary.NativeEndian.Uint32(payload[4:8])
	result.kind, result.state = payload[1], payload[2]
	named := false
	for offset := 16; offset < len(payload); {
		if len(payload)-offset < 4 {
			return fail()
		}
		size := int(binary.NativeEndian.Uint16(payload[offset : offset+2]))
		kind := binary.NativeEndian.Uint16(payload[offset+2:offset+4]) & 0x3fff
		if size < 4 || size > len(payload)-offset {
			return fail()
		}
		value := payload[offset+4 : offset+size]
		switch kind {
		case 0: // UNIX_DIAG_NAME
			if named || len(value) > 108 {
				return fail()
			}
			named, result.name = true, strings.TrimRight(string(value), "\x00")
		case 1: // UNIX_DIAG_VFS: inode BEFORE kernel dev_t (linux/unix_diag.h).
			if result.hasVFS || len(value) != 8 {
				return fail()
			}
			result.hasVFS = true
			result.inode, result.device = binary.NativeEndian.Uint32(value[:4]), binary.NativeEndian.Uint32(value[4:8])
		}
		offset += (size + 3) &^ 3
		if offset > len(payload) {
			return fail()
		}
	}
	return inode, result, nil
}
