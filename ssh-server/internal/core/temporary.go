package core

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
)

type temporaryPaths struct {
	Application string
	Tmp         string
	VarTmp      string
}

// Every source directory's parent stays agent-owned and private. A student may
// write inside the mounted leaves, but cannot replace the bind-mount sources.
// Pane preparation holds the per-UID workflow fence, not global state. It
// confers no execution authority; final admission rechecks after setup. Cleanup
// may remove cancelled private data concurrently, in which case setup refuses.
func (e *Engine) prepareTemporary(a *Attempt, practice bool) (temporaryPaths, error) {
	if !attemptID.MatchString(a.ID) {
		return temporaryPaths{}, errors.New("invalid temporary-storage attempt ID")
	}
	phase := "exam"
	if practice {
		phase = "practice"
	}
	root, err := os.OpenRoot(e.Config.State)
	if err != nil {
		return temporaryPaths{}, err
	}
	for _, name := range []string{"temporary", a.ID, phase} {
		next, err := privateTemporaryDirectory(root, name)
		root.Close()
		if err != nil {
			return temporaryPaths{}, err
		}
		root = next
	}
	defer root.Close()
	for _, name := range []string{"tmp", "var-tmp"} {
		if err := root.Mkdir(name, 0700); err != nil && !os.IsExist(err) {
			return temporaryPaths{}, err
		}
		f, err := root.OpenFile(name, os.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW, 0)
		if err != nil {
			return temporaryPaths{}, err
		}
		info, err := f.Stat()
		if err == nil && info.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) {
			err = errors.New("temporary mount source is not agent-owned")
		}
		if err == nil {
			// Apply after mkdir: the agent's umask is deliberately 0077.
			// Sticky, root-owned leaves have ordinary /tmp semantics, but are
			// reachable only through this attempt's private bind mounts.
			err = f.Chmod(os.ModeSticky | 0777)
		}
		f.Close()
		if err != nil {
			return temporaryPaths{}, err
		}
	}
	base := filepath.Join(e.Config.State, "temporary", a.ID, phase)
	return temporaryPaths{Tmp: filepath.Join(base, "tmp"), VarTmp: filepath.Join(base, "var-tmp")}, nil
}

func privateTemporaryDirectory(root *os.Root, name string) (*os.Root, error) {
	if err := root.Mkdir(name, 0700); err != nil && !os.IsExist(err) {
		return nil, err
	}
	f, err := root.OpenFile(name, os.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return nil, err
	}
	info, err := f.Stat()
	f.Close()
	if err != nil {
		return nil, err
	}
	if info.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) || info.Mode().Perm() != 0700 {
		return nil, errors.New("temporary-storage parent must be agent-owned and mode 0700")
	}
	return root.OpenRoot(name)
}

// Only after all attempt workloads have been confirmed terminated. RemoveAll
// stays beneath an os.Root and removes student links without following them.
func (e *Engine) cleanupTemporary(a *Attempt) error {
	if !attemptID.MatchString(a.ID) {
		return errors.New("invalid temporary-storage attempt ID")
	}
	state, err := os.OpenRoot(e.Config.State)
	if err != nil {
		return err
	}
	defer state.Close()
	if _, err := state.Lstat("temporary"); os.IsNotExist(err) {
		return e.cleanupHome(a)
	} else if err != nil {
		return err
	}
	root, err := privateTemporaryDirectory(state, "temporary")
	if err != nil {
		return err
	}
	defer root.Close()
	if err := root.RemoveAll(a.ID); err != nil {
		return err
	}
	return e.cleanupHome(a)
}

func temporaryMountIssues(rootfs string) []string {
	var issues []string
	for _, rel := range []string{"tmp", "var", "var/tmp"} {
		path := filepath.Join(rootfs, rel)
		info, err := os.Lstat(path)
		if err != nil || !info.IsDir() {
			issues = append(issues, fmt.Sprintf("temporary mount point must be a real directory: %s", path))
		}
	}
	return issues
}
