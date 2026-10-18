package core

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"syscall"
)

const applicationMount = "/run/exam-state"

var applicationLeaves = []string{"cache", "data", "state", "runtime", "emacs", "emacs-xdg", "vim"}

// Published once per attempt/phase. Subsequent panes never reseed or traverse
// student-controlled contents as root; only protected mount roots are checked.
func (e *Engine) prepareApplication(a *Attempt, paths temporaryPaths) (temporaryPaths, error) {
	if e.hostAccess(a) {
		return paths, nil
	}
	account, ok := e.account(a.Username)
	if !ok {
		return paths, errors.New("application-state account unavailable")
	}
	parent := filepath.Dir(paths.Tmp)
	dest := filepath.Join(parent, "application")
	if _, err := os.Lstat(dest); err == nil {
		if err = verifyApplication(dest, account); err != nil {
			return paths, err
		}
		paths.Application = dest
		return paths, nil
	} else if !os.IsNotExist(err) {
		return paths, err
	}
	home, err := os.OpenRoot(filepath.Join(e.Config.State, "homes", a.ID))
	if err != nil {
		return paths, err
	}
	defer home.Close()
	if _, err = home.Stat(".exam-ready"); err != nil {
		return paths, errors.New("complete home snapshot required before application-state setup")
	}
	stage, err := os.MkdirTemp(parent, ".application-")
	if err != nil {
		return paths, err
	}
	defer os.RemoveAll(stage)
	var size int64
	entries := 0
	for _, leaf := range applicationLeaves {
		destLeaf := filepath.Join(stage, leaf)
		if err = os.Mkdir(destLeaf, 0700); err != nil {
			return paths, err
		}
		seed := map[string]string{"data": ".local/share", "emacs": ".emacs.d", "emacs-xdg": ".config/emacs", "vim": ".vim"}[leaf]
		if seed != "" {
			source, openErr := home.OpenRoot(seed)
			if openErr == nil {
				err = seedApplication(source, destLeaf, account, &size, &entries)
				source.Close()
				if err != nil {
					return paths, err
				}
			} else if !os.IsNotExist(openErr) {
				return paths, openErr
			}
		}
		if leaf == "cache" {
			if err = os.Mkdir(filepath.Join(destLeaf, "zsh"), 0700); err != nil {
				return paths, err
			}
			if err = os.Chown(filepath.Join(destLeaf, "zsh"), account.UID, account.GID); err != nil {
				return paths, err
			}
		}
		if leaf == "state" {
			for _, name := range []string{"vim/swap", "vim/backup", "vim/undo", "emacs/backup", "emacs/autosave", "shell"} {
				if err = os.MkdirAll(filepath.Join(destLeaf, name), 0700); err != nil {
					return paths, err
				}
			}
			// These paths are new and unreachable until publication.
			if err = filepath.WalkDir(destLeaf, func(p string, d os.DirEntry, err error) error {
				if err != nil {
					return err
				}
				return os.Chown(p, account.UID, account.GID)
			}); err != nil {
				return paths, err
			}
		}
		if err = os.Chown(destLeaf, account.UID, account.GID); err != nil {
			return paths, err
		}
	}
	metadata, _ := json.Marshal(map[string]int{"version": 1, "uid": account.UID, "gid": account.GID})
	if err = durableFile(filepath.Join(stage, ".ready"), metadata); err != nil {
		return paths, err
	}
	if err = os.Chmod(stage, 0755); err != nil {
		return paths, err
	}
	if err = syncSnapshotDirectories(stage); err != nil {
		return paths, err
	}
	if err = os.Rename(stage, dest); err != nil {
		return paths, err
	}
	if err = syncDirectory(parent); err != nil {
		return paths, err
	}
	paths.Application = dest
	return paths, nil
}
func verifyApplication(dest string, account Account) error {
	f, err := os.OpenFile(dest, os.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return err
	}
	if info.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) || info.Mode().Perm() != 0755 {
		return errors.New("unsafe application-state parent")
	}
	root, err := os.OpenRoot(dest)
	if err != nil {
		return err
	}
	defer root.Close()
	info, err = root.Lstat(".ready")
	if err != nil || !info.Mode().IsRegular() || info.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) || info.Mode().Perm()&0022 != 0 {
		return errors.New("invalid application-state marker")
	}
	data, err := root.ReadFile(".ready")
	if err != nil {
		return err
	}
	var meta map[string]int
	if json.Unmarshal(data, &meta) != nil || meta["version"] != 1 || meta["uid"] != account.UID || meta["gid"] != account.GID {
		return errors.New("application-state identity mismatch")
	}
	for _, name := range applicationLeaves {
		info, err := root.Lstat(name)
		if err != nil || !info.IsDir() || info.Sys().(*syscall.Stat_t).Uid != uint32(account.UID) || info.Mode().Perm() != 0700 {
			return errors.New("unsafe application-state mount root")
		}
	}
	return nil
}
func seedApplication(source *os.Root, dest string, account Account, size *int64, entries *int) error {
	var walk func(string, int) error
	walk = func(name string, depth int) error {
		*entries++
		if *entries > homeEntryLimit || depth > 48 {
			return errors.New("application configuration entry limit exceeded")
		}
		info, err := source.Lstat(name)
		if err != nil {
			return err
		}
		p := filepath.Join(dest, name)
		if info.Mode()&os.ModeSymlink != 0 {
			link, err := source.Readlink(name)
			if err != nil {
				return err
			}
			// Keep the link literal: this tree is mounted at its original
			// home-relative location, so links resolve inside the home view.
			if err = os.Symlink(link, p); err != nil {
				return err
			}
			return os.Lchown(p, account.UID, account.GID)
		}
		if info.IsDir() {
			if name != "." {
				if err = os.Mkdir(p, 0700); err != nil {
					return err
				}
			}
			f, err := source.OpenFile(name, os.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW, 0)
			if err != nil {
				return err
			}
			items, err := f.ReadDir(-1)
			f.Close()
			if err != nil {
				return err
			}
			for _, item := range items {
				if err = walk(filepath.Join(name, item.Name()), depth+1); err != nil {
					return err
				}
			}
			return os.Chown(p, account.UID, account.GID)
		}
		if !info.Mode().IsRegular() {
			return errors.New("special file in protected application seed")
		}
		in, err := source.OpenFile(name, os.O_RDONLY|syscall.O_NOFOLLOW, 0)
		if err != nil {
			return err
		}
		defer in.Close()
		mode := os.FileMode(0600)
		if info.Mode()&0111 != 0 {
			mode = 0700
		}
		out, err := os.OpenFile(p, os.O_WRONLY|os.O_CREATE|os.O_EXCL, mode)
		if err != nil {
			return err
		}
		n, copyErr := io.Copy(out, io.LimitReader(in, min(homeFileLimit, homeSnapshotLimit-*size)+1))
		*size += n
		chmodErr := out.Chmod(mode)
		chownErr := out.Chown(account.UID, account.GID)
		syncErr := out.Sync()
		closeErr := out.Close()
		if n > homeFileLimit || *size > homeSnapshotLimit {
			return errors.New("application seed size limit exceeded")
		}
		return errors.Join(copyErr, chmodErr, chownErr, syncErr, closeErr)
	}
	return walk(".", 0)
}
