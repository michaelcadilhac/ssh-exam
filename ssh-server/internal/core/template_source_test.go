package core

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"testing"
	"time"
)

func templateSourceFixture(t *testing.T) string {
	t.Helper()
	source := filepath.Join(t.TempDir(), "source")
	for _, name := range []string{"work", "materials"} {
		if err := os.MkdirAll(filepath.Join(source, name), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.Chmod(filepath.Join(source, name), 0755); err != nil {
			t.Fatal(err)
		}
	}
	for name, contents := range map[string]string{"work/main.c": "starter bytes\n", "materials/WELCOME.txt": "Welcome, [USER].\n"} {
		if err := os.WriteFile(filepath.Join(source, name), []byte(contents), 0644); err != nil {
			t.Fatal(err)
		}
		if err := os.Chmod(filepath.Join(source, name), 0644); err != nil {
			t.Fatal(err)
		}
	}
	modified := time.Unix(1700000000, 123456789)
	if err := filepath.Walk(source, func(path string, _ os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		return os.Chtimes(path, modified, modified)
	}); err != nil {
		t.Fatal(err)
	}
	return source
}
func sourceTestBounds() collectionBounds {
	return collectionBounds{File: 1024 * 1024, Total: 2 * 1024 * 1024}
}

func TestTemplateSourceFingerprintLogicalMetadataNotPhysicalIdentity(t *testing.T) {
	one, two := templateSourceFixture(t), templateSourceFixture(t)
	first, err := inspectTemplateSource(one, sourceTestBounds(), nil)
	if err != nil {
		t.Fatal(err)
	}
	second, err := inspectTemplateSource(two, sourceTestBounds(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if first.Hash != second.Hash || len(first.Hash) != 64 || first.Files != 2 || len(first.Entries) != 4 {
		t.Fatal("unstable/incorrect source identity", first, second)
	}
	for _, entry := range first.Entries {
		if entry.ModifiedSec != 1700000000 || entry.ModifiedNsec != 123456789 {
			t.Fatal("mtime lost", entry)
		}
		if entry.Kind == "file" && len(entry.SHA256) != 64 {
			t.Fatal("file not hashed", entry)
		}
	}
	if err := os.Chmod(filepath.Join(two, "work", "main.c"), 0751); err != nil {
		t.Fatal(err)
	}
	changed, err := inspectTemplateSource(two, sourceTestBounds(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if changed.Hash == first.Hash {
		t.Fatal("executable mode not part of identity")
	}
	if data, err := os.ReadFile(filepath.Join(one, "work", "main.c")); err != nil || string(data) != "starter bytes\n" {
		t.Fatal("inspection changed source", err)
	}
}

func TestTemplateSourceRefusesLinksSpecialFilesAndUnselectedInstructorContent(t *testing.T) {
	for _, kind := range []string{"symlink", "hardlink", "fifo", "directory-link", "extra", "invalid-utf8", "reserved-file", "reserved-directory", "private-material", "private-material-directory"} {
		t.Run(kind, func(t *testing.T) {
			source := templateSourceFixture(t)
			outside := filepath.Join(t.TempDir(), "protected")
			if err := os.WriteFile(outside, []byte("private outside bytes"), 0600); err != nil {
				t.Fatal(err)
			}
			var err error
			switch kind {
			case "symlink":
				err = os.Symlink(outside, filepath.Join(source, "work", "link"))
			case "hardlink":
				err = os.Link(outside, filepath.Join(source, "work", "link"))
			case "fifo":
				err = syscall.Mkfifo(filepath.Join(source, "work", "fifo"), 0600)
			case "directory-link":
				err = os.Symlink(filepath.Dir(outside), filepath.Join(source, "work", "outside"))
			case "extra":
				err = os.WriteFile(filepath.Join(source, "instructor-private"), []byte("not selected"), 0600)
			case "invalid-utf8":
				err = os.WriteFile(filepath.Join(source, "work", string([]byte{0xff})), nil, 0600)
			case "reserved-file":
				err = os.WriteFile(filepath.Join(source, "work", "MANIFEST.json"), nil, 0600)
			case "reserved-directory":
				err = os.Mkdir(filepath.Join(source, "work", "MANIFEST.json"), 0700)
			case "private-material":
				err = os.Chmod(filepath.Join(source, "materials", "WELCOME.txt"), 0600)
			case "private-material-directory":
				err = os.Chmod(filepath.Join(source, "materials"), 0700)
			}
			if err != nil {
				t.Fatal(err)
			}
			if _, err := inspectTemplateSource(source, sourceTestBounds(), nil); err == nil {
				t.Fatal("accepted unsafe source", kind)
			}
			if data, err := os.ReadFile(outside); err != nil || string(data) != "private outside bytes" {
				t.Fatal("outside source changed", err)
			}
		})
	}
	source := templateSourceFixture(t)
	alias := filepath.Join(t.TempDir(), "alias")
	if err := os.Symlink(source, alias); err != nil {
		t.Fatal(err)
	}
	if _, err := inspectTemplateSource(alias, sourceTestBounds(), nil); err == nil {
		t.Fatal("followed top source link")
	}
}

func TestTemplateSourceRefusesMutationAfterAnEarlierFileWasHashed(t *testing.T) {
	for _, mutation := range []string{"same-size-restored-mtime", "new-entry", "chmod", "root-layout"} {
		t.Run(mutation, func(t *testing.T) {
			source := templateSourceFixture(t)
			_, err := inspectTemplateSource(source, sourceTestBounds(), func(phase string) error {
				if phase != "hashed" {
					return nil
				}
				name := filepath.Join(source, "work", "main.c")
				switch mutation {
				case "same-size-restored-mtime":
					// Deliberately cross the fixture filesystem's timestamp granularity
					// so this case tests ctime, not merely a changed mtime or length.
					time.Sleep(20 * time.Millisecond)
					if err := os.WriteFile(name, []byte("changed bytes\n"), 0644); err != nil {
						return err
					}
					return os.Chtimes(name, time.Unix(1700000000, 123456789), time.Unix(1700000000, 123456789))
				case "new-entry":
					return os.WriteFile(filepath.Join(source, "work", "late"), nil, 0600)
				case "chmod":
					return os.Chmod(name, 0751)
				case "root-layout":
					return os.WriteFile(filepath.Join(source, "private-late"), nil, 0600)
				}
				return nil
			})
			if err == nil || !strings.Contains(err.Error(), "changed") {
				t.Fatal("accepted concurrent source mutation", mutation, err)
			}
		})
	}
}

func TestTemplateSourceDeclaredByteDepthAndEntryBounds(t *testing.T) {
	source := templateSourceFixture(t)
	for _, limits := range []collectionBounds{{File: 0, Total: 10}, {File: 1, Total: 10}, {File: 20, Total: 20}} {
		if _, err := inspectTemplateSource(source, limits, nil); err == nil {
			t.Fatal("accepted invalid/exceeded bounds", limits)
		}
	}
	for i := 0; i < 9999; i++ {
		if err := os.WriteFile(filepath.Join(source, "work", fmt.Sprintf("entry-%05d", i)), nil, 0600); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := inspectTemplateSource(source, sourceTestBounds(), nil); err != nil {
		t.Fatal("10000-entry work tree refused", err)
	}
	if err := os.WriteFile(filepath.Join(source, "work", "one-more"), nil, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := inspectTemplateSource(source, sourceTestBounds(), nil); err == nil || !strings.Contains(err.Error(), "10000") {
		t.Fatal("entry bound missed", err)
	}
	deep := templateSourceFixture(t)
	path := filepath.Join(deep, "work")
	for i := 0; i < 33; i++ {
		path = filepath.Join(path, "d")
		if err := os.Mkdir(path, 0700); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := inspectTemplateSource(deep, sourceTestBounds(), nil); err == nil || !strings.Contains(err.Error(), "32") {
		t.Fatal("depth bound missed", err)
	}
}
func TestTemplateSourceHashesLargeFileWithoutAllocatingItsContents(t *testing.T) {
	source := templateSourceFixture(t)
	f, err := os.Create(filepath.Join(source, "work", "large"))
	if err != nil {
		t.Fatal(err)
	}
	if err := f.Truncate(128 * mib); err != nil {
		f.Close()
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)
	manifest, err := inspectTemplateSource(source, collectionBounds{File: 128 * mib, Total: 512 * mib}, nil)
	runtime.ReadMemStats(&after)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.TotalBytes < 128*mib || after.TotalAlloc-before.TotalAlloc > uint64(8*mib) {
		t.Fatal("inspection did not stream source", manifest.TotalBytes, after.TotalAlloc-before.TotalAlloc)
	}
}

func TestTemplateSourceBindMountChild(t *testing.T) {
	for i, arg := range os.Args {
		if arg == "--template-bind-child" && i+2 < len(os.Args) {
			source, outside := os.Args[i+1], os.Args[i+2]
			if err := syscall.Mount(outside, filepath.Join(source, "work", "bound"), "", syscall.MS_BIND, ""); err != nil {
				t.Fatal(err)
			}
			_, err := inspectTemplateSource(source, sourceTestBounds(), nil)
			if err == nil || !strings.Contains(err.Error(), "mount") {
				t.Fatal("same-device mount was not refused", err)
			}
			return
		}
	}
}
func TestTemplateSourceRejectsSameDeviceBindMount(t *testing.T) {
	if os.Getenv("EXAM_COLLECTION_USERNS") != "1" {
		t.Skip("set EXAM_COLLECTION_USERNS=1 for private user/mount-namespace qualification")
	}
	source, outside := templateSourceFixture(t), t.TempDir()
	if err := os.Mkdir(filepath.Join(source, "work", "bound"), 0700); err != nil {
		t.Fatal(err)
	}
	one, _ := os.Stat(source)
	two, _ := os.Stat(outside)
	if one.Sys().(*syscall.Stat_t).Dev != two.Sys().(*syscall.Stat_t).Dev {
		t.Fatal("fixture must exercise a same-device bind mount")
	}
	cmd := exec.Command("/usr/bin/unshare", "--user", "--map-root-user", "--mount", "--propagation", "private", os.Args[0], "-test.run=^TestTemplateSourceBindMountChild$", "--", "--template-bind-child", source, outside)
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("isolated bind-mount check failed: %v %s", err, output)
	}
}
