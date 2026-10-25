package core

// Live role observations are not saved permission. Fresh Begin retains the
// authenticated process guards through its final pre-clock check.
import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
)

const nativeRolePurpose = "native-loaded-role/v1"
const nativeWatchdogSocket = "watchdog-role.sock"

var errNativeRoles = errors.New("live native agent/watchdog agreement unavailable or mismatched; preserve the same grant/work/Begin intent and inspect examctl health and examctl agent status; repair matching loaded roles only in authorized drained maintenance, never restart active exams or clear records; no new clock or grant consumed")

type nativeRoleReply struct {
	Purpose    string `json:"purpose"`
	Role       string `json:"role"`
	Nonce      string `json:"nonce"`
	Boot       string `json:"boot"`
	ConfigHash string `json:"config_hash"`
}

type NativeRoleObservation struct {
	ObservationOnly bool     `json:"observation_only"`
	Complete        bool     `json:"complete"`
	RetainedEnabled bool     `json:"retained_enabled"`
	Observed        int64    `json:"observed"`
	Roles           []string `json:"roles"`
	Issues          []string `json:"issues"`
}

type nativeRoleGuard struct{ peers []*monitoringProcessGuard }

func (g *nativeRoleGuard) close() {
	if g != nil {
		for _, p := range g.peers {
			p.close()
		}
	}
}
func (g *nativeRoleGuard) current() bool {
	if g == nil {
		return false
	}
	for _, p := range g.peers {
		if !p.current() {
			return false
		}
	}
	return true
}

func nativeConfigurationHash(config Config) (string, error) {
	b, err := json.Marshal(config)
	if err != nil || len(b) > 65536 {
		return "", errNativeRoles
	}
	return Hash(b), nil
}

func (e *Engine) replyNativeRole(c *net.UnixConn, data []byte, role string) {
	if len(data) > 4096 {
		return
	}
	cred, err := peer(c)
	if err != nil || cred.Uid != 0 {
		return
	}
	var request struct {
		Nonce string `json:"native_role_nonce"`
	}
	if _, err := decodeMonitoringObject(data, &request, []string{"native_role_nonce"}); err != nil || !monitoringDigest.MatchString(request.Nonce) {
		return
	}
	hash, err := nativeConfigurationHash(e.Config)
	if err != nil {
		return
	}
	_ = c.SetWriteDeadline(time.Now().Add(time.Second))
	_ = json.NewEncoder(c).Encode(nativeRoleReply{nativeRolePurpose, role, request.Nonce, boot(), hash})
}

// expected is a pinned executable, never a path or PID from the reply. Production
// callers require root and the exact systemd role group. Tests use owned peers.
func probeNativeRole(ctx context.Context, path, role, group, configHash string, expected os.FileInfo, uid int) (*monitoringProcessGuard, error) {
	refuse := func(code string) error { return fmt.Errorf("%w: %s %s", errNativeRoles, role, code) }
	if expected == nil {
		return nil, refuse("executable reference unavailable")
	}
	var dialer net.Dialer
	connection, err := dialer.DialContext(ctx, "unix", path)
	if err != nil {
		return nil, refuse("observation endpoint unavailable")
	}
	defer connection.Close()
	c, ok := connection.(*net.UnixConn)
	if !ok {
		return nil, refuse("local channel unavailable")
	}
	deadline, ok := ctx.Deadline()
	if !ok || c.SetDeadline(deadline) != nil {
		return nil, refuse("bounded local channel unavailable")
	}
	cred, err := peer(c)
	if err != nil || cred.Uid != uint32(uid) {
		return nil, refuse("kernel peer credentials rejected")
	}
	identity, err := snapshotMonitoringProcess(int(cred.Pid))
	if err != nil || identity.uids != [4]uint32{uint32(uid), uint32(uid), uint32(uid), uint32(uid)} {
		return nil, refuse("current process identity unavailable")
	}
	guard, err := pinMonitoringProcess(identity)
	if err != nil {
		return nil, refuse("process lifetime unavailable")
	}
	keep := false
	defer func() {
		if !keep {
			guard.close()
		}
	}()
	check := func() error {
		actual, err := os.Stat(fmt.Sprintf("/proc/%d/exe", cred.Pid))
		if err != nil || !os.SameFile(actual, expected) {
			return refuse("loaded executable mismatch or unavailable")
		}
		data, groupErr := monitoringProcBytes(int(cred.Pid), "cgroup", 4096)
		if groupErr != nil || string(data) != group {
			return refuse("loaded service group mismatch or unavailable")
		}
		if !guard.current() {
			return refuse("process exited or lifetime unavailable")
		}
		return nil
	}
	if err := check(); err != nil {
		return nil, err
	}
	nonce := Token()
	if err := json.NewEncoder(c).Encode(map[string]string{"native_role_nonce": nonce}); err != nil {
		return nil, refuse("challenge delivery unavailable")
	}
	data, err := io.ReadAll(io.LimitReader(c, 4097))
	if err != nil || len(data) > 4096 {
		return nil, refuse("bounded reply unavailable")
	}
	var reply nativeRoleReply
	if _, err := decodeMonitoringObject(data, &reply, []string{"purpose", "role", "nonce", "boot", "config_hash"}); err != nil {
		return nil, refuse("scoped reply invalid or unavailable")
	}
	if reply.Purpose != nativeRolePurpose || reply.Role != role || reply.Nonce != nonce || reply.Boot != boot() {
		return nil, refuse("protocol, role, nonce or boot mismatch")
	}
	if reply.ConfigHash != configHash {
		return nil, refuse("loaded configuration mismatch")
	}
	if err := check(); err != nil {
		return nil, err
	}
	keep = true
	return guard, nil
}

func nativeLegacyWritersIdle() error {
	fd, err := unix.Open("/sys/fs/cgroup/system.slice", unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return errNativeRoles
	}
	defer unix.Close(fd)
	var fs unix.Statfs_t
	if unix.Fstatfs(fd, &fs) != nil || fs.Type != unix.CGROUP2_SUPER_MAGIC {
		return errNativeRoles
	}
	for _, unit := range []string{"exam-agent-live-upgrade.service", "exam-agent-deferred-recovery.service"} {
		dir, err := unix.Openat(fd, unit, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
		if errors.Is(err, unix.ENOENT) {
			continue
		}
		if err != nil {
			return errNativeRoles
		}
		f := os.NewFile(uintptr(dir), "legacy-writer-scope")
		events, err := pinTerminalScopeEvents(f)
		f.Close()
		if err != nil {
			return errNativeRoles
		}
		empty, err := retainedScopeHasNoTasks(events)
		events.Close()
		if err != nil || !empty {
			return fmt.Errorf("%w: %s still has live/unverified processes; preserve its PTYs and follow the three-agent drain runbook", errNativeRoles, unit)
		}
	}
	return nil
}

func probeNativeRoles(config Config, executable *os.File) (*nativeRoleGuard, error) {
	if os.Getuid() != 0 || os.Geteuid() != 0 || !filepath.IsAbs(config.Socket) || filepath.Clean(config.Socket) != config.Socket || strings.ContainsAny(config.Socket, "\r\n\x00") {
		return nil, errNativeRoles
	}
	if err := nativeLegacyWritersIdle(); err != nil {
		return nil, err
	}
	expected, err := executable.Stat()
	if err != nil || !expected.Mode().IsRegular() || expected.Mode()&(os.ModeSetuid|os.ModeSetgid) != 0 || expected.Sys().(*syscall.Stat_t).Uid != 0 || expected.Mode().Perm()&0022 != 0 {
		return nil, errNativeRoles
	}
	hash, err := nativeConfigurationHash(config)
	if err != nil {
		return nil, err
	}
	root, err := readOnlyRoot(config.State)
	if err != nil {
		return nil, errNativeRoles
	}
	defer root.Close()
	var info unix.Stat_t
	if unix.Fstatat(int(root.Fd()), nativeWatchdogSocket, &info, unix.AT_SYMLINK_NOFOLLOW) != nil || info.Mode&unix.S_IFMT != unix.S_IFSOCK || info.Mode&07777 != 0600 || info.Uid != 0 {
		return nil, errNativeRoles
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	guard := &nativeRoleGuard{}
	for _, target := range []struct{ path, role, unit string }{
		{config.Socket, "agent", "exam-agent.service"},
		{fmt.Sprintf("/proc/self/fd/%d/%s", root.Fd(), nativeWatchdogSocket), "watchdog", "exam-deadline-watchdog.service"},
	} {
		p, err := probeNativeRole(ctx, target.path, target.role, "0::/system.slice/"+target.unit+"\n", hash, expected, 0)
		if err != nil {
			guard.close()
			return nil, err
		}
		guard.peers = append(guard.peers, p)
	}
	return guard, nil
}

func (e *Engine) prepareNativeRoles() (*nativeRoleGuard, error) {
	if e.nativeRolesProbe != nil {
		return e.nativeRolesProbe()
	}
	exe, err := paneBootstrapExecutable()
	if err != nil {
		return nil, errNativeRoles
	}
	defer exe.Close()
	return probeNativeRoles(e.Config, exe)
}

func (e *Engine) observeNativeRoles() NativeRoleObservation {
	v := NativeRoleObservation{ObservationOnly: true, Observed: Millis(), Roles: []string{}, Issues: []string{}}
	fd, err := unix.Open("/usr/local/sbin/exam-agent", unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_CLOEXEC|unix.O_NONBLOCK, 0)
	if err != nil {
		v.Issues = append(v.Issues, errNativeRoles.Error())
		return v
	}
	exe := os.NewFile(uintptr(fd), "installed-native-role-reference")
	defer exe.Close()
	guard, err := probeNativeRoles(e.Config, exe)
	if err != nil {
		v.Issues = append(v.Issues, err.Error())
		return v
	}
	defer guard.close()
	v.Complete = guard.current()
	if v.Complete {
		v.Roles = []string{"agent", "watchdog"}
	} else {
		v.Issues = append(v.Issues, errNativeRoles.Error())
	}
	// Observation only: the unconditional installed-mode guard stays OFF.
	return v
}

// Start only from Watch. An observer failure is NOT permission to stop deadline
// enforcement. The persistent lock inode fences duplicate/stale socket cleanup.
func (e *Engine) startWatchdogRoleObserver() (func(), error) {
	if os.Getuid() != 0 || os.Geteuid() != 0 {
		return nil, errNativeRoles
	}
	root, err := readOnlyRoot(e.Config.State)
	if err != nil {
		return nil, err
	}
	fail := func(err error) (func(), error) { root.Close(); return nil, err }
	fd, err := unix.Openat(int(root.Fd()), "watchdog-role.lock", unix.O_RDWR|unix.O_CREAT|unix.O_NOFOLLOW|unix.O_NONBLOCK|unix.O_CLOEXEC, 0600)
	if err != nil {
		return fail(errNativeRoles)
	}
	lock := os.NewFile(uintptr(fd), "watchdog-role-lock")
	var info unix.Stat_t
	if unix.Fstat(fd, &info) != nil || info.Mode&unix.S_IFMT != unix.S_IFREG || info.Mode&07777 != 0600 || info.Uid != 0 || info.Nlink != 1 || info.Size != 0 || unix.Flock(fd, unix.LOCK_EX|unix.LOCK_NB) != nil {
		lock.Close()
		return fail(errNativeRoles)
	}
	var named unix.Stat_t
	if unix.Fstatat(int(root.Fd()), "watchdog-role.lock", &named, unix.AT_SYMLINK_NOFOLLOW) != nil || named.Dev != info.Dev || named.Ino != info.Ino {
		lock.Close()
		return fail(errNativeRoles)
	}
	err = unix.Fstatat(int(root.Fd()), nativeWatchdogSocket, &named, unix.AT_SYMLINK_NOFOLLOW)
	if err == nil {
		if named.Mode&unix.S_IFMT != unix.S_IFSOCK || named.Mode&07777 != 0600 || named.Uid != 0 {
			lock.Close()
			return fail(errNativeRoles)
		}
		// A missing/replaced lock inode cannot justify unlinking a live
		// endpoint. Only positive connection refusal proves it has no listener.
		connection, connectErr := net.DialTimeout("unix", fmt.Sprintf("/proc/self/fd/%d/%s", root.Fd(), nativeWatchdogSocket), 200*time.Millisecond)
		if connectErr == nil {
			connection.Close()
			lock.Close()
			return fail(errNativeRoles)
		}
		if !errors.Is(connectErr, unix.ECONNREFUSED) && !errors.Is(connectErr, unix.ENOENT) {
			lock.Close()
			return fail(errNativeRoles)
		}
		var current unix.Stat_t
		if unix.Fstatat(int(root.Fd()), nativeWatchdogSocket, &current, unix.AT_SYMLINK_NOFOLLOW) != nil || current.Dev != named.Dev || current.Ino != named.Ino {
			lock.Close()
			return fail(errNativeRoles)
		}
		err = unix.Unlinkat(int(root.Fd()), nativeWatchdogSocket, 0)
	}
	if err != nil && !errors.Is(err, unix.ENOENT) {
		lock.Close()
		return fail(errNativeRoles)
	}
	path := fmt.Sprintf("/proc/self/fd/%d/%s", root.Fd(), nativeWatchdogSocket)
	l, err := net.ListenUnix("unix", &net.UnixAddr{Name: path, Net: "unix"})
	if err != nil {
		lock.Close()
		return fail(errNativeRoles)
	}
	l.SetUnlinkOnClose(false)
	if unix.Fchmodat(int(root.Fd()), nativeWatchdogSocket, 0600, 0) != nil || unix.Fstatat(int(root.Fd()), nativeWatchdogSocket, &named, unix.AT_SYMLINK_NOFOLLOW) != nil {
		l.Close()
		lock.Close()
		return fail(errNativeRoles)
	}
	socket := named
	done := make(chan struct{})
	slots := make(chan struct{}, 4)
	go func() {
		defer close(done)
		for {
			c, err := l.AcceptUnix()
			if err != nil {
				return
			}
			select {
			case slots <- struct{}{}:
			default:
				c.Close()
				continue
			}
			go func() {
				defer func() { c.Close(); <-slots }()
				cred, err := peer(c)
				if err != nil || cred.Uid != 0 {
					return
				}
				_ = c.SetReadDeadline(time.Now().Add(time.Second))
				data, err := bufio.NewReaderSize(c, 4097).ReadSlice('\n')
				if err == nil && len(data) <= 4096 {
					e.replyNativeRole(c, data, "watchdog")
				}
			}()
		}
	}()
	return func() {
		l.Close()
		<-done
		var current unix.Stat_t
		if unix.Fstatat(int(root.Fd()), nativeWatchdogSocket, &current, unix.AT_SYMLINK_NOFOLLOW) == nil && current.Dev == socket.Dev && current.Ino == socket.Ino {
			_ = unix.Unlinkat(int(root.Fd()), nativeWatchdogSocket, 0)
		}
		lock.Close()
		root.Close()
	}, nil
}
