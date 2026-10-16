package core

import (
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

func sandboxWorkloadArgs(unit, name string, account Account, work string, a *Attempt, pane string, practice bool, config Config, temporary temporaryPaths) []string {
	args := []string{"--scope", "--quiet", "--unit=" + strings.TrimSuffix(unit, ".scope"), "--slice=exam.slice", "--property=Delegate=no", "--property=MemoryMax=1G", "--property=TasksMax=128", "--property=CPUQuota=100%", "--", "/usr/bin/bwrap", "--unshare-ipc", "--unshare-pid", "--unshare-net", "--unshare-uts", "--unshare-cgroup", "--cap-drop", "ALL", "--cap-add", "CAP_SETUID", "--cap-add", "CAP_SETGID", "--cap-add", "CAP_SETPCAP", "--ro-bind", config.Rootfs, "/", "--bind", work, a.WorkPath, "--bind", temporary.Tmp, "/tmp", "--bind", temporary.VarTmp, "/var/tmp", "--proc", "/proc", "--dev", "/dev", "--dir", "/home/student", "--ro-bind", filepath.Join(config.State, "homes", a.ID), "/home/student", "--ro-bind", filepath.Join(config.State, "homes", a.ID, ".exam-passwd"), "/etc/passwd", "--ro-bind", filepath.Join(config.State, "homes", a.ID, ".exam-group"), "/etc/group", "--chdir", "/", "--clearenv", "--setenv", "HOME", "/home/student", "--setenv", "USER", name, "--setenv", "LOGNAME", name, "--setenv", "TERM", "xterm-256color", "--setenv", "PATH", "/usr/local/bin:/usr/bin:/bin", "--setenv", "TMPDIR", "/tmp", "--setenv", "EXAM_DIR", a.WorkPath, "--setenv", "EXAM_ID", a.Exam, "--setenv", "EXAM_ATTEMPT_ID", a.ID, "--setenv", "EXAM_PANE_ID", pane, "--setenv", "EXAM_DEADLINE", time.UnixMilli(a.Deadline).UTC().Format(time.RFC3339)}
	if !practice {
		args = append(args, "--ro-bind", filepath.Join(config.Templates, a.Settings.Template, "materials"), "/materials")
	}
	// Keep host file ownership and process UID aligned. The root-controlled
	// setpriv runs before user code and irrevocably drops all capabilities.
	args = append(args, "--", "/usr/bin/setpriv", "--reuid", strconv.Itoa(account.UID), "--regid", strconv.Itoa(account.GID), "--clear-groups", "--inh-caps=-all", "--ambient-caps=-all", "--bounding-set=-all", "--no-new-privs", "--", "/usr/bin/env", "--chdir="+a.WorkPath, account.Shell, "-l")
	return args
}
