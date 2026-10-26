package core

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/sys/unix"
)

func TestWorkspaceReferenceParsersUseDeviceInodeNotAmbiguousNames(t *testing.T) {
	device := unix.Mkdev(259, 65537)
	objects := map[workspaceObject]bool{{device, 0x12345}: true}
	for _, item := range []struct {
		data    string
		hit     bool
		invalid bool
	}{
		{fmt.Sprintf("pos:\t0\nflags:\t02000000\nmnt_id:\t18\nino:\t2\ninotify wd:1 ino:12345 sdev:%x mask:2 ignored_mask:0\n", 259<<20|65537), true, false},
		{"pos:\t0\nflags:\t02000000\nmnt_id:\t18\nino:\t2\n", false, false},
		{"inotify wd:1 ino:12345 sdev:1 mask:2 ignored_mask:0\n", false, false},
		{"inotify wd:1 ino:12345 sdev:0 mask:2 ino:12345\n", false, true},
		{"inotify wd:1 ino:12345 mask:2\n", false, true},
		{"inotify wd:1 ino:12345 sdev:fffffffff mask:2\n", false, true},
		{"inotify wd:1 ino:12345 sdev:1 mask:2", false, true},
		{"unknown:0\n", false, true},
	} {
		hit, err := workspaceWatchedUse([]byte(item.data), objects)
		if hit != item.hit || (err != nil) != item.invalid {
			t.Fatal(item, hit, err)
		}
	}
	for _, item := range []struct {
		data         string
		hit, invalid bool
	}{
		{"001-002 rw-p 0 103:10001 74565 /ambiguous name (deleted)\n", true, false},
		{"001-002 rw-p 0 103:10001 74566 /same name\n", false, false},
		{"001-002 rw-p 0 0:1 74565 /same name\n", false, false},
		{"private malformed map\n", false, true},
	} {
		hit, err := workspaceMappedUse([]byte(item.data), objects)
		if hit != item.hit || (err != nil) != item.invalid {
			t.Fatal(item, hit, err)
		}
	}
}

func TestWorkspaceInventoryPinsEveryObjectWithoutFollowingLinks(t *testing.T) {
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, "nested"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "nested", "answer"), []byte("saved"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("/missing/never/follow", filepath.Join(dir, "link")); err != nil {
		t.Fatal(err)
	}
	if err := unix.Mkfifo(filepath.Join(dir, "fifo"), 0600); err != nil {
		t.Fatal(err)
	}
	open := func() *os.File {
		t.Helper()
		f, err := os.Open(dir)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { f.Close() })
		return f
	}
	first, err := inventoryWorkspace(open())
	if err != nil || len(first.Objects) != 5 || first.Digest == "" {
		t.Fatal(first, err)
	}
	second, err := inventoryWorkspace(open())
	if err != nil || second.Digest != first.Digest {
		t.Fatal("stable reopened inventory changed", err)
	}
	if err := os.Rename(filepath.Join(dir, "nested", "answer"), filepath.Join(dir, "nested", "renamed")); err != nil {
		t.Fatal(err)
	}
	third, err := inventoryWorkspace(open())
	if err != nil || third.Digest == first.Digest {
		t.Fatal("same-inode path replacement missed", err)
	}
	if _, err := workspaceNumericEntries(open(), 1); err == nil {
		t.Fatal("non-numeric/oversized directory accepted")
	}
	if _, err := workspaceWatchedUse([]byte(strings.Repeat("x", 1024*1024+1)), nil); err == nil {
		t.Fatal("oversized watch inventory accepted")
	}
}
