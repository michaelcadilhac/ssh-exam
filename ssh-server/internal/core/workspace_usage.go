package core

// Read-only kernel observations for the actual workspaces dry-run worker. Never
// signal/freeze a process or treat partial/opaque observations as no-use proof.
import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"syscall"

	"golang.org/x/sys/unix"
)

type workspaceObject struct{ Device, Inode uint64 }
type workspaceInventory struct {
	Objects map[workspaceObject]bool
	Digest  string
	Mount   uint64
}

const workspaceUsageProcesses = 16384
const workspaceUsageTasks = 65536
const workspaceUsageDescriptors = 65536
const workspaceUsageBytes = 64 * 1024 * 1024

var errWorkspaceUsage = errors.New("kernel filesystem-use inventory incomplete, changing, opaque or outside bounds; preserve workspace and retry in a verified quiet environment; never terminate unrelated processes to obtain eligibility")

func workspaceFDInfo(f *os.File) (uint64, error) {
	data, err := os.ReadFile("/proc/self/fdinfo/" + strconv.Itoa(int(f.Fd())))
	if err != nil || len(data) > 65536 {
		return 0, errWorkspaceUsage
	}
	var id uint64
	for _, line := range strings.Split(string(data), "\n") {
		if !strings.HasPrefix(line, "mnt_id:") {
			continue
		}
		if id != 0 {
			return 0, errWorkspaceUsage
		}
		id, err = strconv.ParseUint(strings.TrimSpace(strings.TrimPrefix(line, "mnt_id:")), 10, 64)
		if err != nil || id == 0 {
			return 0, errWorkspaceUsage
		}
	}
	if id == 0 {
		return 0, errWorkspaceUsage
	}
	return id, nil
}

func inventoryWorkspace(root *os.File) (workspaceInventory, error) {
	result := workspaceInventory{Objects: map[workspaceObject]bool{}}
	var stat unix.Stat_t
	if unix.Fstat(int(root.Fd()), &stat) != nil || stat.Mode&unix.S_IFMT != unix.S_IFDIR {
		return result, errWorkspaceUsage
	}
	device := uint64(stat.Dev)
	mount, err := workspaceFDInfo(root)
	if err != nil {
		return result, err
	}
	result.Mount = mount
	rows := []string{}
	var visit func(*os.File, string, int) error
	visit = func(dir *os.File, path string, depth int) error {
		if depth > 34 || len(rows) > 20000 {
			return errWorkspaceUsage
		}
		if unix.Fstat(int(dir.Fd()), &stat) != nil || uint64(stat.Dev) != device {
			return errWorkspaceUsage
		}
		if id, err := workspaceFDInfo(dir); err != nil || id != mount {
			return errors.New("workspace crosses a mount boundary; preserve mounted data and inspect namespace usage")
		}
		key := workspaceObject{uint64(stat.Dev), stat.Ino}
		result.Objects[key] = true
		rows = append(rows, fmt.Sprintf("%q:%d:%d:%d", path, key.Device, key.Inode, stat.Mode))
		entries, err := dir.ReadDir(20001 - len(rows))
		if err != nil && err != io.EOF {
			return errWorkspaceUsage
		}
		if len(rows)+len(entries) > 20000 {
			return errWorkspaceUsage
		}
		for _, entry := range entries {
			name := entry.Name()
			if name == "." || name == ".." || filepath.Base(name) != name {
				return errWorkspaceUsage
			}
			var child unix.Stat_t
			if unix.Fstatat(int(dir.Fd()), name, &child, unix.AT_SYMLINK_NOFOLLOW|unix.AT_NO_AUTOMOUNT) != nil || uint64(child.Dev) != device {
				return errWorkspaceUsage
			}
			if child.Mode&unix.S_IFMT == unix.S_IFDIR {
				fd, err := unix.Openat(int(dir.Fd()), name, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_NONBLOCK|unix.O_CLOEXEC|unix.O_NOATIME, 0)
				if err != nil {
					return errWorkspaceUsage
				}
				f := os.NewFile(uintptr(fd), "workspace-inventory-directory")
				var opened unix.Stat_t
				if unix.Fstat(fd, &opened) != nil || opened.Ino != child.Ino || opened.Dev != child.Dev {
					f.Close()
					return errWorkspaceUsage
				}
				err = visit(f, path+"/"+name, depth+1)
				f.Close()
				if err != nil {
					return err
				}
			} else {
				key := workspaceObject{uint64(child.Dev), child.Ino}
				result.Objects[key] = true
				rows = append(rows, fmt.Sprintf("%q:%d:%d:%d", path+"/"+name, key.Device, key.Inode, child.Mode))
			}
		}
		return nil
	}
	if err := visit(root, "", 0); err != nil {
		return result, err
	}
	sort.Strings(rows)
	result.Digest = Hash([]byte(strings.Join(rows, "\n")))
	return result, nil
}

func workspaceProcFile(dir *os.File, name string, limit int64) ([]byte, error) {
	if dir == nil || name == "" || filepath.Clean(name) != name || filepath.IsAbs(name) || strings.Contains(name, "..") {
		return nil, errWorkspaceUsage
	}
	fd, err := unix.Openat(int(dir.Fd()), name, unix.O_RDONLY|unix.O_NONBLOCK|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, err
	}
	f := os.NewFile(uintptr(fd), "workspace-kernel-observation")
	defer f.Close()
	var fs unix.Statfs_t
	if unix.Fstatfs(fd, &fs) != nil || fs.Type != unix.PROC_SUPER_MAGIC {
		return nil, errWorkspaceUsage
	}
	data, err := io.ReadAll(io.LimitReader(f, limit+1))
	if err != nil || int64(len(data)) > limit {
		return nil, errWorkspaceUsage
	}
	return data, nil
}

func workspaceNumericEntries(dir *os.File, limit int) ([]int, error) {
	entries, err := dir.ReadDir(limit + 1)
	if err != nil && err != io.EOF || len(entries) > limit {
		return nil, errWorkspaceUsage
	}
	ids := []int{}
	for _, entry := range entries {
		id, err := strconv.ParseInt(entry.Name(), 10, 32)
		if err != nil || id < 0 || strconv.FormatInt(id, 10) != entry.Name() {
			return nil, errWorkspaceUsage
		}
		ids = append(ids, int(id))
	}
	sort.Ints(ids)
	return ids, nil
}

func pinWorkspaceProcess(pid int) (*uidProcess, error) {
	fd, err := unix.PidfdOpen(pid, 0)
	if errors.Is(err, unix.ESRCH) {
		return nil, nil
	}
	if err != nil {
		return nil, errWorkspaceUsage
	}
	p := &uidProcess{pid: pid, handle: os.NewFile(uintptr(fd), "workspace-process-lifetime")}
	fd, err = unix.Open("/proc/"+strconv.Itoa(pid), unix.O_PATH|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err == nil {
		p.proc = os.NewFile(uintptr(fd), "workspace-pinned-process")
	}
	live, lifeErr := p.live()
	if lifeErr != nil || !live || err != nil {
		p.close()
		if lifeErr == nil && !live {
			return nil, nil
		}
		return nil, errWorkspaceUsage
	}
	return p, nil
}

func workspaceMappedUse(data []byte, objects map[workspaceObject]bool) (bool, error) {
	scanner := bufio.NewScanner(bytes.NewReader(data))
	scanner.Buffer(make([]byte, 4096), 256*1024)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 5 {
			return false, errWorkspaceUsage
		}
		device := strings.Split(fields[3], ":")
		if len(device) != 2 {
			return false, errWorkspaceUsage
		}
		major, err1 := strconv.ParseUint(device[0], 16, 32)
		minor, err2 := strconv.ParseUint(device[1], 16, 32)
		inode, err3 := strconv.ParseUint(fields[4], 10, 64)
		if err1 != nil || err2 != nil || err3 != nil {
			return false, errWorkspaceUsage
		}
		if objects[workspaceObject{unix.Mkdev(uint32(major), uint32(minor)), inode}] {
			return true, nil
		}
	}
	return false, scanner.Err()
}

// Linux fs/notify/fdinfo.c prints the internal s_dev (major << 20 | minor),
// not the userspace stat(2) dev_t encoding. Never compare the raw numbers.
func workspaceWatchedUse(data []byte, objects map[workspaceObject]bool) (bool, error) {
	if len(data) == 0 || data[len(data)-1] != '\n' || len(data) > 1024*1024 {
		return false, errWorkspaceUsage
	}
	found := false
	for _, line := range strings.Split(strings.TrimSuffix(string(data), "\n"), "\n") {
		if !strings.HasPrefix(line, "inotify ") {
			if !strings.HasPrefix(line, "pos:") && !strings.HasPrefix(line, "flags:") && !strings.HasPrefix(line, "mnt_id:") && !strings.HasPrefix(line, "ino:") {
				return false, errWorkspaceUsage
			}
			continue
		}
		fields := strings.Fields(line)
		values := map[string]string{}
		for _, field := range fields[1:] {
			key, value, ok := strings.Cut(field, ":")
			if !ok || values[key] != "" {
				return false, errWorkspaceUsage
			}
			values[key] = value
		}
		inode, inoErr := strconv.ParseUint(values["ino"], 16, 64)
		device, devErr := strconv.ParseUint(values["sdev"], 16, 32)
		if inoErr != nil || devErr != nil || inode == 0 || values["wd"] == "" || values["mask"] == "" {
			return false, errWorkspaceUsage
		}
		if objects[workspaceObject{unix.Mkdev(uint32(device>>20), uint32(device&((1<<20)-1))), inode}] {
			found = true
		}
	}
	return found, nil
}

func (e *Engine) workspaceUseSnapshot(a *Attempt, expected WorkspacePathIdentity) ([]WorkspaceUse, error) {
	return e.workspaceUseSnapshotAt(a, expected, e.workspaceBase(a.ID), nil)
}

// owned contains only this worker's still-open, pinned inspection/lease handles.
// Other processes' descriptors, including identical inode references, still count.
func (e *Engine) workspaceUseSnapshotAt(a *Attempt, expected WorkspacePathIdentity, path string, owned map[int]workspaceObject) ([]WorkspaceUse, error) {
	uses := []WorkspaceUse{}
	var observerRoot unix.Stat_t
	if unix.Stat("/", &observerRoot) != nil {
		return uses, errWorkspaceUsage
	}
	root, err := os.OpenFile(path, os.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK|syscall.O_NOATIME, 0)
	if err != nil {
		return uses, errWorkspaceUsage
	}
	defer root.Close()
	info, err := root.Stat()
	if err != nil {
		return uses, errWorkspaceUsage
	}
	stat := info.Sys().(*syscall.Stat_t)
	if strconv.FormatUint(uint64(stat.Dev), 10) != expected.Device || strconv.FormatUint(stat.Ino, 10) != expected.Inode {
		return uses, errors.New("workspace inode changed; reread show and review the exact target")
	}
	inventory, err := inventoryWorkspace(root)
	if err != nil {
		return uses, err
	}
	selfData, err := os.ReadFile("/proc/self/mountinfo")
	if err != nil {
		return uses, errWorkspaceUsage
	}
	mounts, err := parseWorkspaceMountTopology(bytes.NewReader(selfData))
	if err != nil {
		return uses, err
	}
	anchor, err := workspaceMountAnchorFor(path, inventory.Mount, uint64(stat.Dev), mounts)
	if err != nil {
		return uses, err
	}
	for _, m := range mounts {
		if workspaceMountContains(path, m.point) {
			return uses, errors.New("workspace contains/is a mountpoint; preserve it and inspect mounts before cleanup")
		}
	}
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return uses, errWorkspaceUsage
	}
	pids := []int{}
	for _, entry := range entries {
		id, err := strconv.ParseInt(entry.Name(), 10, 32)
		if err == nil && id > 0 && strconv.FormatInt(id, 10) == entry.Name() {
			pids = append(pids, int(id))
		}
	}
	if len(pids) > workspaceUsageProcesses {
		return uses, errWorkspaceUsage
	}
	sort.Ints(pids)
	namespaces := map[uint64]bool{}
	handles := map[uint64]bool{}
	taskCount, fdCount, observedBytes := 0, 0, 0
	add := func(pid, tid int, kind string, descriptor int) error {
		if len(uses) >= 16 {
			return errWorkspaceUsage
		}
		uses = append(uses, WorkspaceUse{pid, tid, kind, descriptor})
		return nil
	}
	for _, pid := range pids {
		p, err := pinWorkspaceProcess(pid)
		if err != nil {
			return uses, err
		}
		if p == nil {
			continue
		}
		err = func() error {
			defer p.close()
			fd, err := unix.Openat(int(p.proc.Fd()), "task", unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
			if err != nil {
				if live, _ := p.live(); !live {
					return nil
				}
				return errWorkspaceUsage
			}
			tasks := os.NewFile(uintptr(fd), "workspace-task-inventory")
			defer tasks.Close()
			tids, err := workspaceNumericEntries(tasks, 4096)
			if err != nil {
				return err
			}
			taskCount += len(tids)
			if taskCount > workspaceUsageTasks {
				return errWorkspaceUsage
			}
			for _, tid := range tids {
				fd, err := unix.Openat(int(tasks.Fd()), strconv.Itoa(tid), unix.O_PATH|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
				if err != nil {
					return errWorkspaceUsage
				}
				task := os.NewFile(uintptr(fd), "workspace-thread-view")
				err = func() error {
					defer task.Close()
					status, err := workspaceProcFile(task, "status", 16384)
					if err != nil {
						return errWorkspaceUsage
					}
					st, err := workspaceProcFile(task, "stat", 4096)
					if err != nil {
						return errWorkspaceUsage
					}
					identity, states, err := retainedTaskSnapshot(status, st)
					if err != nil || identity.TID != tid || identity.TGID != pid {
						return errWorkspaceUsage
					}
					for _, uid := range identity.UIDs {
						if uid == uint32(a.UID) {
							if err := add(pid, tid, "account-task", 0); err != nil {
								return err
							}
							break
						}
					}
					// A positively identified kernel thread has no userspace fs/mm.
					statFields := strings.Fields(string(st[strings.LastIndexByte(string(st), ')')+1:]))
					if len(statFields) < 7 {
						return errWorkspaceUsage
					}
					flags, flagErr := strconv.ParseUint(statFields[6], 10, 64)
					if flagErr != nil {
						return errWorkspaceUsage
					}
					if flags&0x00200000 != 0 {
						return nil
					}
					if states[0] == 'Z' || states[0] == 'X' || states[0] == 'x' {
						return errWorkspaceUsage
					}
					for _, name := range []string{"cwd", "root"} {
						var object unix.Stat_t
						if unix.Fstatat(int(task.Fd()), name, &object, 0) != nil {
							return errWorkspaceUsage
						}
						if name == "root" && (object.Dev != observerRoot.Dev || object.Ino != observerRoot.Ino) {
							return errors.New("process root view hides part of its mount namespace; preserve workspace and defer cleanup until a complete view can be verified")
						}
						if inventory.Objects[workspaceObject{uint64(object.Dev), object.Ino}] {
							if err := add(pid, tid, name, 0); err != nil {
								return err
							}
						}
					}
					var ns unix.Stat_t
					if unix.Fstatat(int(task.Fd()), "ns/mnt", &ns, 0) != nil {
						return errWorkspaceUsage
					}
					if !namespaces[ns.Ino] {
						data, err := workspaceProcFile(task, "mountinfo", workspaceMountTableMax)
						if err != nil {
							return errWorkspaceUsage
						}
						observedBytes += len(data)
						table, err := parseWorkspaceMountTopology(bytes.NewReader(data))
						if err != nil {
							return err
						}
						relations, err := workspaceMountRelationships(anchor, table)
						if err != nil {
							return err
						}
						for _, rel := range relations {
							if rel.relation != "covering-ancestor" || rel.mount.root != "/" {
								if err := add(pid, tid, "mount-source", 0); err != nil {
									return err
								}
							}
						}
						namespaces[ns.Ino] = true
					}
					maps, err := workspaceProcFile(task, "maps", 8*1024*1024)
					if err != nil {
						return errWorkspaceUsage
					}
					observedBytes += len(maps)
					mapped, err := workspaceMappedUse(maps, inventory.Objects)
					if err != nil {
						return err
					}
					if mapped {
						if err := add(pid, tid, "mapping", 0); err != nil {
							return err
						}
					}
					fd, err := unix.Openat(int(task.Fd()), "fd", unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
					if err != nil {
						return errWorkspaceUsage
					}
					descriptors := os.NewFile(uintptr(fd), "workspace-descriptor-inventory")
					ids, err := workspaceNumericEntries(descriptors, 24000)
					descriptors.Close()
					if err != nil {
						return err
					}
					fdCount += len(ids)
					if pid == os.Getpid() {
						fdCount -= len(owned)
					}
					if fdCount > workspaceUsageDescriptors {
						return errWorkspaceUsage
					}
					for _, id := range ids {
						if pid == os.Getpid() && id == int(root.Fd()) {
							continue
						} // This exact still-pinned observation handle only.
						name := "fd/" + strconv.Itoa(id)
						var object unix.Stat_t
						if err := unix.Fstatat(int(task.Fd()), name, &object, 0); err != nil {
							if errors.Is(err, unix.ENOENT) {
								continue
							}
							return errWorkspaceUsage
						}
						if expected, ok := owned[id]; pid == os.Getpid() && ok && expected == (workspaceObject{uint64(object.Dev), object.Ino}) {
							var pinned unix.Stat_t
							if unix.Fstat(id, &pinned) != nil || pinned.Dev != object.Dev || pinned.Ino != object.Ino {
								return errWorkspaceUsage
							}
							continue
						}
						if inventory.Objects[workspaceObject{uint64(object.Dev), object.Ino}] {
							if err := add(pid, tid, "descriptor", id); err != nil {
								return err
							}
						}
						link, err := os.Readlink("/proc/" + strconv.Itoa(tid) + "/" + name)
						if err != nil {
							if os.IsNotExist(err) {
								continue
							}
							return errWorkspaceUsage
						}
						if strings.HasPrefix(link, "mnt:[") && strings.HasSuffix(link, "]") {
							n, err := strconv.ParseUint(strings.TrimSuffix(strings.TrimPrefix(link, "mnt:["), "]"), 10, 64)
							if err != nil || n != object.Ino {
								return errWorkspaceUsage
							}
							handles[n] = true
						}
						// Registered/queued file references are not always exposed as
						// ordinary fds. Never infer no-use from an opaque container.
						if strings.Contains(link, "inotify") {
							data, err := workspaceProcFile(task, "fdinfo/"+strconv.Itoa(id), 1024*1024)
							if err != nil {
								return errWorkspaceUsage
							}
							observedBytes += len(data)
							watched, err := workspaceWatchedUse(data, inventory.Objects)
							if err != nil {
								return err
							}
							if watched {
								if err := add(pid, tid, "watch", id); err != nil {
									return err
								}
							}
						}
						if strings.Contains(link, "io_uring") || strings.Contains(link, "fanotify") {
							return errors.New("opaque kernel file-reference container present; no complete usage proof; inspect PID " + strconv.Itoa(pid) + " without signalling unrelated services")
						}
					}
					statusAfter, err := workspaceProcFile(task, "status", 16384)
					if err != nil {
						return errWorkspaceUsage
					}
					statAfter, err := workspaceProcFile(task, "stat", 4096)
					if err != nil {
						return errWorkspaceUsage
					}
					end, _, err := retainedTaskSnapshot(statusAfter, statAfter)
					if err != nil || end != identity {
						return errWorkspaceUsage
					}
					var nsAfter unix.Stat_t
					if unix.Fstatat(int(task.Fd()), "ns/mnt", &nsAfter, 0) != nil || nsAfter.Ino != ns.Ino {
						return errWorkspaceUsage
					}
					var rootAfter unix.Stat_t
					if unix.Fstatat(int(task.Fd()), "root", &rootAfter, 0) != nil || rootAfter.Dev != observerRoot.Dev || rootAfter.Ino != observerRoot.Ino {
						return errors.New("process root view changed during inspection; preserve workspace and repeat the complete inspection")
					}
					if observedBytes > workspaceUsageBytes {
						return errWorkspaceUsage
					}
					return nil
				}()
				if err != nil {
					if live, lifeErr := p.live(); lifeErr == nil && !live {
						return nil
					}
					return err
				}
			}
			return nil
		}()
		if err != nil {
			return uses, err
		}
	}
	for ns := range handles {
		if !namespaces[ns] {
			return uses, errors.New("detached mount namespace handle has no verified live view; preserve workspace and inspect namespace owners")
		}
	}
	// Reopen for an independent directory offset; never treat an exhausted readdir
	// cursor as a second empty inventory.
	second, err := os.OpenFile(path, os.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK|syscall.O_NOATIME, 0)
	if err != nil {
		return uses, errWorkspaceUsage
	}
	defer second.Close()
	end, err := inventoryWorkspace(second)
	if err != nil || end.Digest != inventory.Digest {
		return uses, errWorkspaceUsage
	}
	return uses, nil
}
