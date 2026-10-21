package core

import (
	"fmt"
	"syscall"
)

func memoryBackedFilesystem(kind int64) bool { return kind == 0x01021994 || kind == 0x858458f6 } // tmpfs / ramfs

// A memory-backed 512 MiB archive/restore is charged to its bounded worker and
// cannot fit the 256 MiB cgroup. It also cannot preserve protected history across
// reboot. Refuse NEW admission, never erase/move old work or weaken recovery.
func collectionStorageIssues(c Config) []string {
	issues := []string{}
	for _, item := range []struct{ role, path string }{{"protected state", c.State}, {"workspace", c.Work}} {
		var stat syscall.Statfs_t
		if err := syscall.Statfs(item.path, &stat); err != nil {
			issues = append(issues, fmt.Sprintf("cannot inspect %s storage: %v", item.role, err))
			continue
		}
		if memoryBackedFilesystem(stat.Type) {
			issues = append(issues, fmt.Sprintf("%s requires persistent disk-backed storage, not tmpfs/ramfs; preserve all state/work/bundles and follow a drained storage migration before new starts", item.role))
		}
	}
	return issues
}
