package core

import (
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

// Root-configured, single-account functional testing only. Admissions expire; the
// collector must retain the snapshotted test policy to recover an already begun attempt.
func (e *Engine) functionalAccount(a *Attempt) bool {
	account, ok := e.Config.Accounts[a.Username]
	return ok && len(e.Config.Accounts) == 1 && e.Config.FunctionalTestAccount == a.Username && account.UID == a.UID
}

func (e *Engine) recordedUnitAllowed(a *Attempt, unit string) bool {
	if strings.ContainsAny(unit, "/\\") || !strings.HasPrefix(unit, "exam-") {
		return false
	}
	return strings.HasSuffix(unit, ".scope") || (a.FunctionalTest && e.functionalAccount(a) && strings.HasSuffix(unit, ".service"))
}
func (e *Engine) Ready() (bool, []string) {
	if e.Config.FunctionalTestAccount == "" {
		return e.productionReady()
	}
	missing := []string{}
	if !setupCapabilitiesAvailable() {
		missing = append(missing, "root launcher requires SETUID, SETGID and SETPCAP setup capabilities")
	}
	if os.Geteuid() != 0 {
		missing = append(missing, "root agent required")
	}
	if e.Config.FunctionalTestUntil <= Millis() {
		missing = append(missing, "trusted functional test authorization expired")
	}
	if len(e.Config.Accounts) != 1 {
		missing = append(missing, "exactly one functional account required")
	}
	for _, p := range []string{"/usr/bin/bwrap", "/usr/bin/systemd-run", "/sys/fs/cgroup/cgroup.controllers", filepath.Join(e.Config.Rootfs, "bin/bash"), filepath.Join(e.Config.Rootfs, "usr/bin/setpriv"), filepath.Join(e.Config.Rootfs, "home/student"), filepath.Join(e.Config.Rootfs, "materials"), filepath.Join(e.Config.Rootfs, strings.TrimPrefix(e.directory(), "/"))} {
		if _, err := os.Stat(p); err != nil {
			missing = append(missing, p)
		}
	}
	for _, p := range []string{e.Config.State, e.Config.Work, e.Config.Rootfs, e.Config.Templates} {
		i, err := os.Stat(p)
		if err != nil || i.Sys().(*syscall.Stat_t).Uid != 0 || i.Mode().Perm()&0022 != 0 {
			missing = append(missing, "root-owned protected path required: "+p)
		}
	}
	account, ok := e.Config.Accounts[e.Config.FunctionalTestAccount]
	if !ok {
		missing = append(missing, "functional account not approved")
	} else {
		out, err := exec.Command("/usr/bin/getent", "passwd", e.Config.FunctionalTestAccount).Output()
		fields := strings.Split(strings.TrimSpace(string(out)), ":")
		if err != nil || len(fields) != 7 || fields[2] != strconv.Itoa(account.UID) {
			missing = append(missing, "functional NSS account UID mismatch")
		}
		if e.Config.FunctionalHostAccess && (len(fields) != 7 || fields[5] != account.Home || fields[6] != account.Shell) {
			missing = append(missing, "functional host home and shell must match NSS")
		}
	}
	var disk syscall.Statfs_t
	if syscall.Statfs(e.Config.State, &disk) != nil || disk.Bavail*uint64(disk.Bsize) < 1024*1024*1024 {
		missing = append(missing, "at least 1 GiB free protected storage required")
	}
	return len(missing) == 0, missing
}
