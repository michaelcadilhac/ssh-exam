package core

import (
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"testing"
)

func practiceAccount() Account {
	if os.Geteuid() == 0 {
		return Account{UID: 65534, GID: 65534}
	}
	return Account{UID: os.Getuid(), GID: os.Getgid()}
}

func TestPracticeFileIsStudentOwnedWithPrivateUmask(t *testing.T) {
	if os.Getenv("EXAM_PRACTICE_UMASK_CHILD") != "1" {
		cmd := exec.Command(os.Args[0], "-test.run=^TestPracticeFileIsStudentOwnedWithPrivateUmask$")
		cmd.Env = append(os.Environ(), "EXAM_PRACTICE_UMASK_CHILD=1")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("%v: %s", err, out)
		}
		return
	}
	syscall.Umask(0077)
	e := &Engine{Config: Config{State: t.TempDir()}}
	account := practiceAccount()
	a := &Attempt{ID: finalID}
	work, err := e.preparePractice(a, account)
	if err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(work, "PRACTICE.txt")
	info, err := os.Stat(file)
	if err != nil {
		t.Fatal(err)
	}
	stat := info.Sys().(*syscall.Stat_t)
	if stat.Uid != uint32(account.UID) || stat.Gid != uint32(account.GID) || info.Mode().Perm() != 0600 {
		t.Fatalf("practice file not student-readable/writable: %v, uid=%d gid=%d", info.Mode(), stat.Uid, stat.Gid)
	}
	if err := os.WriteFile(file, []byte("student's saved practice edits\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := e.preparePractice(a, account); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(file)
	if err != nil || string(data) != "student's saved practice edits\n" {
		t.Fatal("opening another practice pane replaced edits", err)
	}
}

func TestPracticeRefusesUnsafeEntries(t *testing.T) {
	for _, kind := range []string{"symlink", "hardlink", "fifo", "directory"} {
		t.Run(kind, func(t *testing.T) {
			e := &Engine{Config: Config{State: t.TempDir()}}
			a := &Attempt{ID: finalID}
			work := filepath.Join(e.Config.State, "practice", a.ID)
			os.MkdirAll(work, 0700)
			victim := filepath.Join(e.Config.State, "must-not-change")
			os.WriteFile(victim, []byte("preserve"), 0600)
			file := filepath.Join(work, "PRACTICE.txt")
			var err error
			switch kind {
			case "symlink":
				err = os.Symlink(victim, file)
			case "hardlink":
				err = os.Link(victim, file)
			case "fifo":
				err = syscall.Mkfifo(file, 0600)
			case "directory":
				err = os.Mkdir(file, 0700)
			}
			if err != nil {
				t.Fatal(err)
			}
			if _, err := e.preparePractice(a, practiceAccount()); err == nil {
				t.Fatal("unsafe practice entry accepted")
			}
			data, err := os.ReadFile(victim)
			if err != nil || string(data) != "preserve" {
				t.Fatal("outside file changed", err)
			}
		})
	}
}

func TestPracticeRepairsOldRootOwnedFile(t *testing.T) {
	if os.Geteuid() != 0 {
		t.Skip("root required to reproduce deployed ownership")
	}
	e := &Engine{Config: Config{State: t.TempDir()}}
	a := &Attempt{ID: finalID}
	work := filepath.Join(e.Config.State, "practice", a.ID)
	os.MkdirAll(work, 0700)
	file := filepath.Join(work, "PRACTICE.txt")
	os.WriteFile(file, []byte("existing practice content"), 0600)
	account := practiceAccount()
	if _, err := e.preparePractice(a, account); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(file)
	if err != nil {
		t.Fatal(err)
	}
	if info.Sys().(*syscall.Stat_t).Uid != uint32(account.UID) || info.Mode().Perm() != 0600 {
		t.Fatal("old root-owned file was not repaired")
	}
	data, _ := os.ReadFile(file)
	if string(data) != "existing practice content" {
		t.Fatal("repair replaced content")
	}
}
