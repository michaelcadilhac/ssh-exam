package core

import (
	"archive/tar"
	"compress/gzip"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

func TestCollectHostileTree(t *testing.T) {
	source := t.TempDir()
	dest := filepath.Join(t.TempDir(), "secured")
	os.WriteFile(filepath.Join(source, "answer.c"), []byte("int main(){}"), 0644)
	os.Symlink("/etc/shadow", filepath.Join(source, "escape"))
	a := &Attempt{ID: "test", State: "FINALIZING"}
	sum, err := Collect(source, dest, a)
	if err != nil {
		t.Fatal(err)
	}
	if len(sum) != 64 {
		t.Fatal("checksum missing")
	}
	f, _ := os.Open(filepath.Join(dest, "submission.tar.gz"))
	defer f.Close()
	gz, _ := gzip.NewReader(f)
	defer gz.Close()
	tr := tar.NewReader(gz)
	names := []string{}
	for {
		h, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		names = append(names, h.Name)
		if strings.Contains(h.Name, "shadow") || h.Name == "escape" {
			t.Fatal("symlink dereferenced")
		}
	}
	if len(names) != 2 {
		t.Fatalf("unexpected inventory: %v", names)
	}
}
func TestRejectHardlink(t *testing.T) {
	source := t.TempDir()
	os.WriteFile(filepath.Join(source, "a"), []byte("answer"), 0600)
	os.Link(filepath.Join(source, "a"), filepath.Join(source, "b"))
	if _, err := Collect(source, filepath.Join(t.TempDir(), "secured"), &Attempt{}); err == nil {
		t.Fatal("hardlink accepted")
	}
}
func TestRejectHugeSparse(t *testing.T) {
	source := t.TempDir()
	f, _ := os.Create(filepath.Join(source, "sparse"))
	f.Truncate(33 * 1024 * 1024)
	f.Close()
	if _, err := Collect(source, filepath.Join(t.TempDir(), "secured"), &Attempt{}); err == nil {
		t.Fatal("huge file accepted")
	}
}
func TestNoPublishedArchiveOnFailure(t *testing.T) {
	source := t.TempDir()
	dest := filepath.Join(t.TempDir(), "secured")
	os.WriteFile(filepath.Join(source, "a"), []byte("answer"), 0600)
	os.Link(filepath.Join(source, "a"), filepath.Join(source, "b"))
	Collect(source, dest, &Attempt{})
	if _, err := os.Stat(filepath.Join(dest, "submission.tar.gz")); !os.IsNotExist(err) {
		t.Fatal("failed archive published")
	}
}

func TestRejectSourceRootSymlink(t *testing.T) {
	outside := t.TempDir()
	os.WriteFile(filepath.Join(outside, "secret"), []byte("outside"), 0600)
	link := filepath.Join(t.TempDir(), "work")
	os.Symlink(outside, link)
	if _, err := Collect(link, filepath.Join(t.TempDir(), "secured"), &Attempt{}); err == nil {
		t.Fatal("followed source root link")
	}
}
func TestOmitFIFOSocketAndDirectoryLink(t *testing.T) {
	source := t.TempDir()
	outside := t.TempDir()
	os.WriteFile(filepath.Join(outside, "secret"), []byte("outside"), 0600)
	os.Symlink(outside, filepath.Join(source, "linked-directory"))
	if err := syscall.Mkfifo(filepath.Join(source, "fifo"), 0600); err != nil {
		t.Fatal(err)
	}
	socket, err := net.ListenUnix("unix", &net.UnixAddr{Name: filepath.Join(source, "socket"), Net: "unix"})
	if err != nil {
		t.Fatal(err)
	}
	socket.SetUnlinkOnClose(false)
	defer socket.Close()
	dest := filepath.Join(t.TempDir(), "secured")
	a := &Attempt{ID: "test"}
	if _, err = Collect(source, dest, a); err != nil {
		t.Fatal(err)
	}
	m, err := ReadProtected(dest, a)
	if err != nil {
		t.Fatal(err)
	}
	if len(m.Files) != 0 || len(m.Omissions) != 3 {
		t.Fatalf("unsafe entries not accounted for %+v", m)
	}
}
func TestCollectorReusesVerifiedBundleWithoutOpeningChangedSource(t *testing.T) {
	source := t.TempDir()
	os.WriteFile(filepath.Join(source, "a"), []byte("first saved files"), 0600)
	dest := filepath.Join(t.TempDir(), "secured")
	a := &Attempt{ID: "test"}
	sum, err := Collect(source, dest, a)
	if err != nil {
		t.Fatal(err)
	}
	os.RemoveAll(source)
	again, err := Collect(source, dest, a)
	if err != nil || again != sum {
		t.Fatalf("failed to adopt protected bundle %v", err)
	}
}
