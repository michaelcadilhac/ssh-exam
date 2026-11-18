package core

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"syscall"
)

// Hide control state and runtime endpoints, rather than selecting software.
// Site-specific service socket directories belong in HostFilesystemHiddenPaths.
func hostFilesystemMasks(c Config) []string {
	paths := []string{"/run", "/sys", "/root", "/etc/exam-agent", "/var/backups/ssh-exam", c.State, c.Work, c.Templates}
	paths = append(paths, c.HostFilesystemHiddenPaths...)
	slices.Sort(paths)
	result := []string{}
	for _, path := range paths {
		if path == "" {
			continue
		}
		covered := false
		for _, parent := range result {
			if beneath(path, parent) {
				covered = true
				break
			}
		}
		if !covered {
			result = append(result, path)
		}
	}
	return result
}

func beneath(path, directory string) bool {
	return path == directory || strings.HasPrefix(path, directory+"/")
}

func validateHostFilesystem(c Config) error {
	if !c.HostFilesystem {
		return nil
	}
	if c.Rootfs != "/" {
		return errors.New("host_filesystem requires rootfs=/")
	}
	directory := c.ExamDirectory
	if directory == "" {
		directory = "/work"
	}
	for _, path := range hostFilesystemMasks(c) {
		if !filepath.IsAbs(path) || filepath.Clean(path) != path || path == "/" || strings.ContainsAny(path, "\n\r\x00") {
			return errors.New("host filesystem exclusions must be clean absolute directories")
		}
		// None may hide the toolchain, the mount destinations, or a restored home.
		for _, reserved := range []string{"/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc", "/home", "/tmp", "/var/tmp", "/materials", "/proc", "/dev", directory} {
			if reserved != "" && (beneath(reserved, path) || (reserved != "/etc" && beneath(path, reserved))) {
				return fmt.Errorf("host filesystem exclusion overlaps required path: %s", path)
			}
		}
	}
	return nil
}

func canonicalHostPath(path string) string {
	suffix := ""
	for {
		if real, err := filepath.EvalSymlinks(path); err == nil {
			return filepath.Join(real, suffix)
		}
		if path == "/" {
			return filepath.Join(path, suffix)
		}
		suffix = filepath.Join(filepath.Base(path), suffix)
		path = filepath.Dir(path)
	}
}

func uncoveredHostSockets(table string, masks []string, state string) ([]string, error) {
	var missing []string
	// Abstract UNIX sockets are isolated by --unshare-net. Ordinary pathname
	// sockets must be behind a private runtime mount or an explicit exclusion.
	coveredPaths := append([]string{"/tmp", "/var/tmp", "/home", "/root", "/proc", "/dev"}, masks...)
	var records []hostSocketPath
	for _, line := range strings.Split(table, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 8 || !strings.HasPrefix(fields[7], "/") {
			continue
		}
		kind, typeErr := strconv.ParseUint(fields[4], 16, 32)
		flags, flagsErr := strconv.ParseUint(fields[3], 16, 32)
		inode, inodeErr := strconv.ParseUint(fields[6], 10, 32)
		if typeErr != nil || flagsErr != nil || inodeErr != nil {
			return nil, errors.New("invalid host UNIX socket inventory")
		}
		// Connected stream/seqpacket endpoints cannot accept a new pathname
		// connection. Their inherited names may outlive a retired listener.
		// Bound datagrams remain reachable without listen and MUST be checked.
		if (kind == syscall.SOCK_STREAM || kind == syscall.SOCK_SEQPACKET) && flags&0x10000 == 0 {
			continue
		}
		records = append(records, hostSocketPath{inode: uint32(inode), name: strings.Join(fields[7:], " ")})
	}
	records, err := resolveHostSocketPaths(records, state)
	if err != nil {
		return nil, err
	}
	for _, record := range records {
		path := canonicalHostPath(record.name)
		covered := false
		for _, parent := range coveredPaths {
			if beneath(path, parent) {
				covered = true
				break
			}
		}
		if !covered {
			missing = append(missing, path)
		}
	}
	return missing, nil
}

func hostFilesystemIssues(c Config) []string {
	if !c.HostFilesystem {
		return nil
	}
	if err := validateHostFilesystem(c); err != nil {
		return []string{err.Error()}
	}
	var issues []string
	for _, path := range hostFilesystemMasks(c) {
		if info, err := os.Lstat(path); err == nil {
			if !info.IsDir() {
				issues = append(issues, "host exclusion must be a real directory: "+path)
			}
			real, err := filepath.EvalSymlinks(path)
			if err != nil || real != path {
				issues = append(issues, "host exclusion must not traverse a symlink: "+path)
			}
		} else if !os.IsNotExist(err) {
			issues = append(issues, "cannot inspect host exclusion: "+path)
		}
	}
	sockets, err := os.ReadFile("/proc/net/unix")
	if err != nil {
		return append(issues, "cannot inventory host UNIX sockets")
	}
	uncovered, err := uncoveredHostSockets(string(sockets), hostFilesystemMasks(c), c.State)
	if err != nil {
		issues = append(issues, "cannot verify host service socket identity: "+err.Error())
	}
	for _, path := range uncovered {
		issues = append(issues, "host service socket needs an isolation exclusion: "+path)
	}
	return issues
}

// A privileged bind must not follow a home redirected by the student.
func validateLiveHome(account Account) error {
	path := filepath.Clean(account.Home)
	real, err := filepath.EvalSymlinks(path)
	if err != nil || !filepath.IsAbs(path) || path == "/" || real != path {
		return errors.New("home must be a real absolute directory")
	}
	info, err := os.Lstat(path)
	if err != nil || !info.IsDir() || info.Sys().(*syscall.Stat_t).Uid != uint32(account.UID) {
		return errors.New("home ownership differs from student identity")
	}
	for parent := filepath.Dir(path); ; parent = filepath.Dir(parent) {
		info, err := os.Lstat(parent)
		if err != nil || !info.IsDir() || info.Sys().(*syscall.Stat_t).Uid != 0 || (info.Mode().Perm()&0022 != 0 && info.Mode()&os.ModeSticky == 0) {
			return errors.New("home ancestor is not administrator-controlled")
		}
		if parent == "/" {
			break
		}
	}
	sockets, err := os.ReadFile("/proc/net/unix")
	if err != nil {
		return err
	}
	for _, line := range strings.Split(string(sockets), "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 8 && beneath(strings.Join(fields[7:], " "), path) {
			return errors.New("host socket in student home must be stopped before terminal admission")
		}
	}
	return nil
}
