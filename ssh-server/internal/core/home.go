package core

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"syscall"
)

// Include complete configuration/plugin trees, not just their entry-point files.
// Histories, SSH/GPG stores, sockets and unrelated home documents are not copied.
var preferencePaths = []string{
	".profile", ".bash_profile", ".bash_login", ".bash_logout", ".bashrc", ".bash_aliases", ".bash_functions", ".bash_completion", ".aliases", ".functions", ".inputrc", ".dircolors", ".tmux.conf", ".screenrc",
	".zshenv", ".zprofile", ".zshrc", ".zlogin", ".zlogout", ".zsh", ".oh-my-zsh", ".p10k.zsh",
	".emacs", ".emacs.el", ".emacs.d", ".vimrc", ".gvimrc", ".vim", ".exrc", ".nanorc", ".nano", ".config", ".local/share", ".local/bin",
}

const homeSnapshotLimit int64 = 256 * 1024 * 1024
const homeFileLimit int64 = 32 * 1024 * 1024
const homeEntryLimit = 30000

func sandboxHome(account Account) string {
	if filepath.IsAbs(account.Home) && filepath.Clean(account.Home) == account.Home && strings.HasPrefix(account.Home, "/home/") {
		return account.Home
	}
	return "/home/student"
}
func (e *Engine) prepareHome(a *Attempt) error {
	if e.hostAccess(a) {
		return nil
	}
	if !attemptID.MatchString(a.ID) {
		return errors.New("invalid home snapshot attempt")
	}
	account, ok := e.account(a.Username)
	if !ok {
		return errors.New("home account unavailable")
	}
	if e.Config.HostFilesystem {
		if err := validateLiveHome(account); err != nil {
			return err
		}
	}
	parent := filepath.Join(e.Config.State, "homes")
	if err := os.MkdirAll(parent, 0700); err != nil {
		return err
	}
	info, err := os.Lstat(parent)
	if err != nil || !info.IsDir() || info.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) || info.Mode().Perm()&0022 != 0 {
		return errors.New("unsafe configuration snapshot parent")
	}
	if err = os.Chmod(parent, 0700); err != nil {
		return err
	}
	dest := filepath.Join(parent, a.ID)
	if info, err := os.Lstat(dest); err == nil {
		if !info.IsDir() || info.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) {
			return errors.New("unsafe home snapshot")
		}
		if _, err := os.Stat(filepath.Join(dest, ".exam-ready")); err == nil {
			return nil
		}
		return errors.New("incomplete historical home snapshot; retry unstarted preflight after upgrade")
	} else if !os.IsNotExist(err) {
		return err
	}
	stage, err := os.MkdirTemp(parent, "."+a.ID+"-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(stage)
	if err = os.Chmod(stage, 0755); err != nil {
		return err
	}
	source, err := os.OpenRoot(account.Home)
	if err != nil {
		return err
	}
	defer source.Close()
	target, err := os.OpenRoot(stage)
	if err != nil {
		return err
	}
	defer target.Close()
	if err = copyPreferences(source, target, account, e.Config.HomeConfigPaths); err != nil {
		return err
	}
	// Mount destinations must already exist beneath the read-only home. Do not
	// introduce legacy Emacs init precedence when the user uses XDG configuration.
	for _, name := range []string{".cache", ".local/state", ".local/share", ".vim"} {
		if err = target.MkdirAll(name, 0755); err != nil {
			return err
		}
	}
	if _, err = target.Lstat(".emacs.d"); os.IsNotExist(err) {
		if _, xdgErr := target.Lstat(".config/emacs"); os.IsNotExist(xdgErr) {
			if err = target.Mkdir(".emacs.d", 0755); err != nil {
				return err
			}
		}
	}
	home := sandboxHome(account)
	identity := map[string]string{
		".exam-passwd": fmt.Sprintf("root:x:0:0:root:/root:/bin/sh\n%s:x:%d:%d:Course account:%s:%s\n", a.Username, account.UID, account.GID, home, account.Shell),
		".exam-group":  fmt.Sprintf("root:x:0:\n%s:x:%d:\n", a.Username, account.GID),
	}
	for name, value := range identity {
		if err = writeSnapshotFile(filepath.Join(stage, name), []byte(value), 0444); err != nil {
			return err
		}
	}
	if err = writeApplicationTools(filepath.Join(stage, ".exam-tools"), e.Config.Rootfs); err != nil {
		return err
	}
	meta, _ := json.Marshal(map[string]any{"version": 1, "username": a.Username, "uid": account.UID, "home": home})
	if err = durableFile(filepath.Join(stage, ".exam-ready"), meta); err != nil {
		return err
	}
	if err = syncSnapshotDirectories(stage); err != nil {
		return err
	}
	if err = os.Rename(stage, dest); err != nil {
		return err
	}
	return syncDirectory(parent)
}

// os.Root bounds every lookup. Internal symlink targets are copied as dependencies
// and rewritten relative to the view; outside links are never read by the agent.
func copyPreferences(source, target *os.Root, account Account, extra []string) error {
	visited := map[string]bool{}
	var total int64
	count := 0
	var copyPath func(string, int) error
	copyPath = func(name string, depth int) error {
		name = filepath.Clean(name)
		if !validPreferencePath(name) {
			return errors.New("configuration link targets a reserved/private home path")
		}
		if visited[name] {
			return nil
		}
		visited[name] = true
		count++
		if count > homeEntryLimit || depth > 48 {
			return errors.New("home configuration entry/depth limit exceeded")
		}
		info, err := source.Lstat(name)
		if os.IsNotExist(err) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("configuration %s: %w", name, err)
		}
		if err = target.MkdirAll(filepath.Dir(name), 0755); err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			link, err := source.Readlink(name)
			if err != nil {
				return err
			}
			resolved := filepath.Clean(filepath.Join(filepath.Dir(name), link))
			if filepath.IsAbs(link) {
				relative, err := filepath.Rel(account.Home, link)
				if err != nil {
					return err
				}
				if relative == ".." || strings.HasPrefix(relative, "../") {
					return fmt.Errorf("configuration symlink outside home: %s", name)
				}
				resolved = relative
			}
			if resolved == ".." || strings.HasPrefix(resolved, "../") {
				return fmt.Errorf("configuration symlink outside home: %s", name)
			}
			if err = copyPath(resolved, depth+1); err != nil {
				return err
			}
			relative, err := filepath.Rel(filepath.Dir(name), resolved)
			if err != nil {
				return err
			}
			return target.Symlink(relative, name)
		}
		if info.IsDir() {
			if !configurationReadable(info, account, true) {
				return fmt.Errorf("configuration directory is not readable by student: %s", name)
			}
			if err = target.MkdirAll(name, 0755); err != nil {
				return err
			}
			dir, err := source.OpenFile(name, os.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW, 0)
			if err != nil {
				return err
			}
			defer dir.Close()
			for {
				entries, readErr := dir.ReadDir(128)
				for _, entry := range entries {
					if err = copyPath(filepath.Join(name, entry.Name()), depth+1); err != nil {
						return err
					}
				}
				if readErr == io.EOF {
					return nil
				}
				if readErr != nil {
					return readErr
				}
			}
		}
		// Never expose host IPC endpoints or read FIFO/device contents.
		if !info.Mode().IsRegular() {
			return nil
		}
		if info.Size() > homeFileLimit || total+info.Size() > homeSnapshotLimit || info.Sys().(*syscall.Stat_t).Nlink != 1 {
			return fmt.Errorf("configuration file size/hardlink limit: %s", name)
		}
		f, err := source.OpenFile(name, os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
		if err != nil {
			return err
		}
		defer f.Close()
		actual, err := f.Stat()
		if err != nil || !actual.Mode().IsRegular() || actual.Sys().(*syscall.Stat_t).Nlink != 1 || !configurationReadable(actual, account, false) {
			return errors.New("configuration entry changed during snapshot")
		}
		mode := os.FileMode(0444)
		if actual.Mode()&0111 != 0 {
			mode = 0555
		}
		out, err := target.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, mode)
		if err != nil {
			return err
		}
		n, copyErr := io.Copy(out, io.LimitReader(f, min(homeFileLimit, homeSnapshotLimit-total)+1))
		chmodErr := out.Chmod(mode)
		syncErr := out.Sync()
		closeErr := out.Close()
		total += n
		if n > homeFileLimit || total > homeSnapshotLimit {
			return errors.New("home configuration grew beyond snapshot limits")
		}
		return errors.Join(copyErr, chmodErr, syncErr, closeErr)
	}
	for _, name := range append(append([]string{}, preferencePaths...), extra...) {
		if !validPreferencePath(name) {
			return errors.New("invalid additional home configuration path")
		}
		if err := copyPath(name, 0); err != nil {
			return err
		}
	}
	return nil
}

func writeApplicationTools(dest, rootfs string) error {
	if err := os.Mkdir(dest, 0755); err != nil {
		return err
	}
	if err := os.Chmod(dest, 0755); err != nil {
		return err
	}
	scripts := map[string]string{
		"vim":   "#!/bin/sh\nexec /usr/bin/vim -i \"$XDG_STATE_HOME/vim/viminfo\" --cmd 'set directory=/run/exam-state/state/vim/swap// backupdir=/run/exam-state/state/vim/backup// undodir=/run/exam-state/state/vim/undo//' \"$@\"\n",
		"vi":    "#!/bin/sh\nexec /usr/bin/vi -i \"$XDG_STATE_HOME/vim/viminfo\" --cmd 'set directory=/run/exam-state/state/vim/swap// backupdir=/run/exam-state/state/vim/backup// undodir=/run/exam-state/state/vim/undo//' \"$@\"\n",
		"emacs": "#!/bin/sh\nexec /usr/bin/emacs --load /run/exam/emacs-state.el \"$@\"\n",
		"emacs-state.el": `;; Loaded after the normal user init, before command-line files are visited.
(let ((state (getenv "XDG_STATE_HOME")))
 (setq backup-directory-alist (list (cons "." (concat state "/emacs/backup/")))
       auto-save-file-name-transforms (list (list ".*" (concat state "/emacs/autosave/") t))
       auto-save-list-file-prefix (concat state "/emacs/autosave/session-")
       custom-file (concat state "/emacs/custom.el")))
`,
	}
	localBin := filepath.Join(dest, "local-bin")
	if err := os.Mkdir(localBin, 0755); err != nil {
		return err
	}
	if err := os.Chmod(localBin, 0755); err != nil {
		return err
	}
	if rootfs != "" {
		entries, err := os.ReadDir(filepath.Join(rootfs, "usr/local/bin"))
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if entry.Name() == "emacs" || entry.Name() == "vim" || entry.Name() == "vi" {
				continue
			}
			if err := os.Symlink("/run/exam-original-local/bin/"+entry.Name(), filepath.Join(localBin, entry.Name())); err != nil {
				return err
			}
		}
	}
	for name, value := range scripts {
		mode := os.FileMode(0555)
		if strings.HasSuffix(name, ".el") {
			mode = 0444
		}
		p := filepath.Join(dest, name)
		if err := writeSnapshotFile(p, []byte(value), mode); err != nil {
			return err
		}
	}
	for _, name := range []string{"emacs", "vim", "vi"} {
		if err := os.Symlink("/run/exam/"+name, filepath.Join(localBin, name)); err != nil {
			return err
		}
	}
	return nil
}

// Called only by termination-confirmed cancellation/finalization cleanup.
func (e *Engine) cleanupHome(a *Attempt) error {
	state, err := os.OpenRoot(e.Config.State)
	if err != nil {
		return err
	}
	defer state.Close()
	if _, err = state.Lstat("homes"); os.IsNotExist(err) {
		return nil
	} else if err != nil {
		return err
	}
	homes, err := privateTemporaryDirectory(state, "homes")
	if err != nil {
		return err
	}
	defer homes.Close()
	return homes.RemoveAll(a.ID)
}

func configurationReadable(info os.FileInfo, account Account, directory bool) bool {
	bits := info.Mode().Perm()
	st := info.Sys().(*syscall.Stat_t)
	if st.Uid == uint32(account.UID) {
		bits >>= 6
	} else if st.Gid == uint32(account.GID) {
		bits >>= 3
	}
	return bits&4 != 0 && (!directory || bits&1 != 0)
}

func validPreferencePath(name string) bool {
	return name != "" && filepath.Clean(name) == name && name != "." && !filepath.IsAbs(name) && name != ".." && !strings.HasPrefix(name, "../") && !strings.HasPrefix(name, ".exam-") && name != ".ssh" && !strings.HasPrefix(name, ".ssh/") && name != ".gnupg" && !strings.HasPrefix(name, ".gnupg/")
}

func homeMountIssues(rootfs string) []string {
	var issues []string
	for _, name := range []string{"home", "run", "usr/local/bin"} {
		info, err := os.Lstat(filepath.Join(rootfs, name))
		if err != nil || !info.IsDir() {
			issues = append(issues, "home/application mount point must be a real directory: "+filepath.Join(rootfs, name))
		}
	}
	return issues
}

func writeSnapshotFile(path string, data []byte, mode os.FileMode) error {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, mode)
	if err != nil {
		return err
	}
	_, writeErr := f.Write(data)
	modeErr := f.Chmod(mode)
	syncErr := f.Sync()
	closeErr := f.Close()
	return errors.Join(writeErr, modeErr, syncErr, closeErr)
}
func syncSnapshotDirectories(root string) error {
	return filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !entry.IsDir() {
			return nil
		}
		f, err := os.OpenFile(path, os.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW, 0)
		if err != nil {
			return err
		}
		syncErr := f.Sync()
		closeErr := f.Close()
		return errors.Join(syncErr, closeErr)
	})
}
