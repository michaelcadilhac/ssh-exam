package core

import (
	"strconv"
	"time"
)

// Called only after root-configured functional-account and channel authorization.
// Host access is intentionally unsuitable for production exam isolation.
func functionalHostArgs(unit, name string, account Account, work string, a *Attempt, pane string, practice bool, config Config, temporary temporaryPaths) []string {
	args := []string{"--quiet", "--pty", "--wait", "--collect", "--service-type=exec", "--unit=" + unit, "--slice=exam.slice",
		"--uid=" + name, "--gid=" + strconv.Itoa(account.GID),
		"--property=Delegate=no", "--property=MemoryMax=1G", "--property=TasksMax=128", "--property=CPUQuota=100%",
		"--property=NoNewPrivileges=no", "--property=WorkingDirectory=" + a.WorkPath,
		"--property=BindPaths=" + work + ":" + a.WorkPath + " " + temporary.Tmp + ":/tmp " + temporary.VarTmp + ":/var/tmp",
		"--setenv=HOME=" + account.Home, "--setenv=USER=" + name, "--setenv=LOGNAME=" + name,
		"--setenv=TMPDIR=/tmp", "--setenv=TERM=xterm-256color", "--setenv=PATH=/usr/local/bin:/usr/bin:/bin",
		"--setenv=EXAM_DIR=" + a.WorkPath, "--setenv=EXAM_ID=" + a.Exam,
		"--setenv=EXAM_ATTEMPT_ID=" + a.ID, "--setenv=EXAM_PANE_ID=" + pane,
		"--setenv=EXAM_DEADLINE=" + time.UnixMilli(a.Deadline).UTC().Format(time.RFC3339)}
	if !practice {
		materials, err := templateMaterials(config, a.Settings)
		if err != nil {
			return nil
		}
		args = append(args, "--property=BindReadOnlyPaths="+materials+":/materials")
	}
	return append(args, "--", account.Shell, "-l")
}
