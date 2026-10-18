package core

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

func sandboxWorkloadArgs(unit, name string, account Account, work string, a *Attempt, pane string, practice bool, config Config, temporary temporaryPaths) []string {
	home := sandboxHome(account)
	snapshot := filepath.Join(config.State, "homes", a.ID)
	args := []string{"--scope", "--quiet", "--unit=" + strings.TrimSuffix(unit, ".scope"), "--slice=exam.slice", "--property=Delegate=no", "--property=MemoryMax=1G", "--property=TasksMax=128", "--property=CPUQuota=100%", "--", "/usr/bin/bwrap", "--unshare-ipc", "--unshare-pid", "--unshare-net", "--unshare-uts", "--unshare-cgroup", "--cap-drop", "ALL", "--cap-add", "CAP_SETUID", "--cap-add", "CAP_SETGID", "--cap-add", "CAP_SETPCAP", "--ro-bind", config.Rootfs, "/", "--bind", work, a.WorkPath, "--bind", temporary.Tmp, "/tmp", "--bind", temporary.VarTmp, "/var/tmp", "--proc", "/proc", "--dev", "/dev",
		"--tmpfs", "/home", "--dir", home, "--ro-bind", snapshot, home,
		"--tmpfs", "/run", "--dir", "/run/exam", "--ro-bind", filepath.Join(snapshot, ".exam-tools"), "/run/exam",
		"--dir", "/run/exam-original-local", "--ro-bind", filepath.Join(config.Rootfs, "usr/local"), "/run/exam-original-local",
		"--ro-bind", filepath.Join(snapshot, ".exam-tools/local-bin"), "/usr/local/bin",
		"--dir", applicationMount, "--bind", temporary.Application, applicationMount,
		"--ro-bind", filepath.Join(snapshot, ".exam-passwd"), "/etc/passwd", "--ro-bind", filepath.Join(snapshot, ".exam-group"), "/etc/group",
		"--chdir", "/", "--clearenv", "--setenv", "HOME", home, "--setenv", "USER", name, "--setenv", "LOGNAME", name, "--setenv", "TERM", "xterm-256color",
		"--setenv", "PATH", "/run/exam:/usr/local/bin:/usr/bin:/bin", "--setenv", "TMPDIR", "/tmp",
		"--setenv", "XDG_CONFIG_HOME", filepath.Join(home, ".config"), "--setenv", "XDG_CACHE_HOME", filepath.Join(home, ".cache"),
		"--setenv", "XDG_DATA_HOME", filepath.Join(home, ".local/share"), "--setenv", "XDG_STATE_HOME", filepath.Join(home, ".local/state"),
		"--setenv", "XDG_RUNTIME_DIR", applicationMount + "/runtime", "--setenv", "HISTFILE", applicationMount + "/state/shell/history",
		"--setenv", "ZSH_COMPDUMP", applicationMount + "/state/shell/zcompdump", "--setenv", "ZSH_CACHE_DIR", applicationMount + "/cache/zsh",
		"--setenv", "LESSHISTFILE", applicationMount + "/state/less-history", "--setenv", "PYTHON_HISTORY", applicationMount + "/state/python-history",
		"--setenv", "NODE_REPL_HISTORY", applicationMount + "/state/node-history",
		"--setenv", "EXAM_DIR", a.WorkPath, "--setenv", "EXAM_ID", a.Exam, "--setenv", "EXAM_ATTEMPT_ID", a.ID, "--setenv", "EXAM_PANE_ID", pane, "--setenv", "EXAM_DEADLINE", time.UnixMilli(a.Deadline).UTC().Format(time.RFC3339),
	}
	for _, mount := range []struct{ source, destination string }{{"cache", ".cache"}, {"data", ".local/share"}, {"state", ".local/state"}, {"emacs", ".emacs.d"}, {"emacs-xdg", ".config/emacs"}, {"vim", ".vim"}} {
		if info, err := os.Stat(filepath.Join(snapshot, mount.destination)); err == nil && info.IsDir() {
			args = append(args, "--bind", filepath.Join(temporary.Application, mount.source), filepath.Join(home, mount.destination))
		}
	}

	if !practice {
		args = append(args, "--ro-bind", filepath.Join(config.Templates, a.Settings.Template, "materials"), "/materials")
	}
	// Keep host file ownership and process UID aligned. The root-controlled
	// setpriv runs before user code and irrevocably drops all capabilities.
	args = append(args, "--", "/usr/bin/setpriv", "--reuid", strconv.Itoa(account.UID), "--regid", strconv.Itoa(account.GID), "--clear-groups", "--inh-caps=-all", "--ambient-caps=-all", "--bounding-set=-all", "--no-new-privs", "--", "/usr/bin/env", "--chdir="+a.WorkPath, account.Shell, "-l")
	return args
}
