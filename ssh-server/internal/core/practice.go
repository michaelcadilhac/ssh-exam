package core

import (
	"errors"
	"os"
	"path/filepath"
	"syscall"
)

// The agent's private umask must not make practice material inaccessible.
// Create once, preserving edits across panes and refusing student-controlled links.
func (e *Engine) preparePractice(a *Attempt, account Account) (string, error) {
	parent := filepath.Join(e.Config.State, "practice")
	if err := os.MkdirAll(parent, 0700); err != nil {
		return "", err
	}
	root, err := os.OpenRoot(parent)
	if err != nil {
		return "", err
	}
	defer root.Close()
	if err := root.Mkdir(a.ID, 0700); err != nil && !os.IsExist(err) {
		return "", err
	}
	dir, err := root.OpenFile(a.ID, os.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return "", err
	}
	err = dir.Chown(account.UID, account.GID)
	dir.Close()
	if err != nil {
		return "", err
	}
	work, err := root.OpenRoot(a.ID)
	if err != nil {
		return "", err
	}
	defer work.Close()
	f, err := work.OpenFile("PRACTICE.txt", os.O_WRONLY|os.O_CREATE|os.O_EXCL|syscall.O_NOFOLLOW, 0600)
	created := err == nil
	if os.IsExist(err) {
		f, err = work.OpenFile("PRACTICE.txt", os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	}
	if err != nil {
		return "", err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return "", err
	}
	stat := info.Sys().(*syscall.Stat_t)
	if !info.Mode().IsRegular() || stat.Nlink != 1 {
		return "", errors.New("practice file must be a regular file without additional links")
	}
	if created {
		if _, err := f.WriteString("Try your editor and terminal tools here before starting the exam. No exam questions are present.\n"); err != nil {
			return "", err
		}
	}
	// Repair earlier root-owned files without replacing their contents. Existing
	// student files keep their own chosen permissions and edits.
	if created || stat.Uid == 0 {
		if err := f.Chown(account.UID, account.GID); err != nil {
			return "", err
		}
		if err := f.Chmod(0600); err != nil {
			return "", err
		}
	}
	return filepath.Join(parent, a.ID), nil
}
