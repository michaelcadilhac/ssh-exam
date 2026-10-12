package core

import (
	"path/filepath"
	"strconv"
	"time"
)

// Called only after root-configured functional-account and channel authorization.
// Host access is intentionally unsuitable for production exam isolation.
func functionalHostArgs(unit, name string, account Account, work string, a *Attempt, pane string, practice bool, templates string) []string {
	args := []string{"--quiet", "--pty", "--wait", "--collect", "--service-type=exec", "--unit=" + unit, "--slice=exam.slice",
		"--uid=" + name, "--gid=" + strconv.Itoa(account.GID),
		"--property=Delegate=no", "--property=MemoryMax=1G", "--property=TasksMax=128", "--property=CPUQuota=100%",
		"--property=NoNewPrivileges=no", "--property=WorkingDirectory=" + a.WorkPath,
		"--property=BindPaths=" + work + ":" + a.WorkPath,
		"--setenv=HOME=" + account.Home, "--setenv=USER=" + name, "--setenv=LOGNAME=" + name,
		"--setenv=TERM=xterm-256color", "--setenv=PATH=/usr/local/bin:/usr/bin:/bin",
		"--setenv=EXAM_DIR=" + a.WorkPath, "--setenv=EXAM_ID=" + a.Exam,
		"--setenv=EXAM_ATTEMPT_ID=" + a.ID, "--setenv=EXAM_PANE_ID=" + pane,
		"--setenv=EXAM_DEADLINE=" + time.UnixMilli(a.Deadline).UTC().Format(time.RFC3339)}
	if !practice {
		args = append(args, "--property=BindReadOnlyPaths="+filepath.Join(templates, a.Settings.Template, "materials")+":/materials")
	}
	return append(args, "--", account.Shell, "-l")
}
