package core

import (
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

func sandboxWorkloadArgs(unit, name string, account Account, work string, a *Attempt, pane string, practice bool, config Config, temporary temporaryPaths) []string {
	home := sandboxHome(account)
	snapshot := filepath.Join(config.State, "homes", a.ID)
	args := []string{"--scope", "--quiet", "--unit=" + strings.TrimSuffix(unit, ".scope"), "--slice=exam.slice", "--property=Delegate=no", "--property=MemoryMax=1G", "--property=TasksMax=128", "--property=CPUQuota=100%", "--", "/usr/bin/bwrap", "--unshare-ipc", "--unshare-pid", "--unshare-net", "--unshare-uts", "--unshare-cgroup", "--cap-drop", "ALL", "--cap-add", "CAP_SETUID", "--cap-add", "CAP_SETGID", "--cap-add", "CAP_SETPCAP", "--ro-bind", config.Rootfs, "/"}
	if config.HostFilesystem {
		args = append(args, "--tmpfs", "/materials")
		for _, path := range hostFilesystemMasks(config) {
			if info, err := os.Lstat(path); err == nil && info.IsDir() && path != "/run" {
				args = append(args, "--tmpfs", path)
			}
		}
	}
	homeSource := snapshot
	if config.HostFilesystem {
		homeSource = account.Home
	}
	args = append(args, "--bind", work, a.WorkPath, "--bind", temporary.Tmp, "/tmp", "--bind", temporary.VarTmp, "/var/tmp", "--proc", "/proc", "--dev", "/dev",
		"--tmpfs", "/home", "--dir", home, "--ro-bind", homeSource, home,
		"--tmpfs", "/run", "--dir", "/run/exam", "--ro-bind", filepath.Join(snapshot, ".exam-tools"), "/run/exam",
		"--dir", "/run/exam-original-local", "--ro-bind", filepath.Join(config.Rootfs, "usr/local"), "/run/exam-original-local",
		"--ro-bind", filepath.Join(snapshot, ".exam-tools/local-bin"), "/usr/local/bin",
		"--dir", applicationMount, "--bind", temporary.Application, applicationMount,
		"--ro-bind", filepath.Join(snapshot, ".exam-passwd"), "/etc/passwd", "--ro-bind", filepath.Join(snapshot, ".exam-group"), "/etc/group",
		"--chdir", "/", "--clearenv", "--setenv", "HOME", home, "--setenv", "USER", name, "--setenv", "LOGNAME", name, "--setenv", "TERM", "xterm-256color",
		"--setenv", "PATH", "/run/exam:/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin:/usr/local/games:/usr/games", "--setenv", "TMPDIR", "/tmp",
		"--setenv", "XDG_CONFIG_HOME", filepath.Join(home, ".config"), "--setenv", "XDG_CACHE_HOME", filepath.Join(home, ".cache"),
		"--setenv", "XDG_DATA_HOME", filepath.Join(home, ".local/share"), "--setenv", "XDG_STATE_HOME", filepath.Join(home, ".local/state"),
		"--setenv", "XDG_RUNTIME_DIR", applicationMount+"/runtime", "--setenv", "HISTFILE", applicationMount+"/state/shell/history",
		"--setenv", "ZSH_COMPDUMP", applicationMount+"/state/shell/zcompdump", "--setenv", "ZSH_CACHE_DIR", applicationMount+"/cache/zsh",
		"--setenv", "LESSHISTFILE", applicationMount+"/state/less-history", "--setenv", "PYTHON_HISTORY", applicationMount+"/state/python-history",
		"--setenv", "NODE_REPL_HISTORY", applicationMount+"/state/node-history",
		"--setenv", "EXAM_DIR", a.WorkPath, "--setenv", "EXAM_ID", a.Exam, "--setenv", "EXAM_ATTEMPT_ID", a.ID, "--setenv", "EXAM_PANE_ID", pane, "--setenv", "EXAM_DEADLINE", time.UnixMilli(a.Deadline).UTC().Format(time.RFC3339),
	)
	if config.HostFilesystem {
		args = append(args, "--setenv", "XDG_CACHE_HOME", applicationMount+"/cache", "--setenv", "XDG_DATA_HOME", applicationMount+"/data", "--setenv", "XDG_STATE_HOME", applicationMount+"/state")
	}
	mounts, err := applicationHomeMounts(homeSource, home, config.HostFilesystem)
	if err != nil {
		return nil
	}
	for _, mount := range mounts {
		args = append(args, "--bind", filepath.Join(temporary.Application, mount.source), mount.destination)
	}

	if !practice {
		materials, err := templateMaterials(config, a.Settings)
		if err != nil {
			return nil
		}
		args = append(args, "--ro-bind", materials, "/materials")
	}
	// Keep host file ownership and process UID aligned. The root-controlled
	// setpriv runs before user code and irrevocably drops all capabilities.
	args = append(args, "--", "/usr/bin/setpriv", "--reuid", strconv.Itoa(account.UID), "--regid", strconv.Itoa(account.GID), "--clear-groups", "--inh-caps=-all", "--ambient-caps=-all", "--bounding-set=-all", "--no-new-privs", "--", "/usr/bin/env", "--chdir="+a.WorkPath, account.Shell, "-l")
	return args
}

// Resolve destinations in the immutable home source, never through an earlier
// writable overlay. Otherwise a second pane could follow a student-changed
// symlink and mount writable data over the privileged launcher's libraries.
func applicationHomeMounts(source, home string, host bool) ([]struct{ source, destination string }, error) {
	leaves := []struct{ source, destination string }{{"cache", ".cache"}, {"data", ".local/share"}, {"state", ".local/state"}, {"emacs", ".emacs.d"}, {"emacs-xdg", ".config/emacs"}, {"vim", ".vim"}}
	var result []struct{ source, destination string }
	for _, leaf := range leaves {
		if host && (leaf.source == "cache" || leaf.source == "data" || leaf.source == "state") {
			continue
		}
		path := filepath.Join(source, leaf.destination)
		info, err := os.Stat(path)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if !info.IsDir() {
			continue
		}
		resolved, err := filepath.EvalSymlinks(path)
		if err != nil {
			return nil, err
		}
		relative, err := filepath.Rel(source, resolved)
		if err != nil || relative == "." || relative == ".." || strings.HasPrefix(relative, "../") {
			return nil, errors.New("application state destination escapes the read-only home")
		}
		destination := filepath.Join(home, relative)
		duplicate := false
		for _, other := range result {
			if other.destination == destination {
				duplicate = true
				break
			}
			if beneath(destination, other.destination) || beneath(other.destination, destination) {
				return nil, errors.New("application state destinations overlap")
			}
		}
		if !duplicate {
			result = append(result, struct{ source, destination string }{leaf.source, destination})
		}
	}
	return result, nil
}
