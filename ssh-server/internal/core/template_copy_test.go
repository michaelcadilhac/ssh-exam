package core

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"testing"
)

func templateCopyParent(t *testing.T) string {
	t.Helper()
	parent := t.TempDir()
	if err := os.Chmod(parent, 0700); err != nil {
		t.Fatal(err)
	}
	return parent
}

func TestTemplateCopyPreservesLogicalMetadataAndNeverReplacesExisting(t *testing.T) {
	source := templateSourceFixture(t)
	if err := os.Chmod(filepath.Join(source, "work", "main.c"), 0751); err != nil {
		t.Fatal(err)
	}
	before, err := inspectTemplateSource(source, sourceTestBounds(), nil)
	if err != nil {
		t.Fatal(err)
	}
	dest := filepath.Join(templateCopyParent(t), "private-copy")
	actual, err := copyTemplateSource(source, dest, sourceTestBounds(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if actual.Hash != before.Hash || actual.Files != before.Files || actual.TotalBytes != before.TotalBytes {
		t.Fatal("private copy changed logical identity", actual, before)
	}
	info, err := os.Stat(dest)
	if err != nil || info.Mode().Perm() != 0700 {
		t.Fatal("copy not private", info, err)
	}
	if _, err := copyTemplateSource(source, dest, sourceTestBounds(), nil); err == nil || !strings.Contains(err.Error(), "never overwrite") {
		t.Fatal("existing copy was replaced", err)
	}
	after, err := inspectTemplateSource(source, sourceTestBounds(), nil)
	if err != nil || after.Hash != before.Hash {
		t.Fatal("source changed", err)
	}
	for _, name := range []string{"work/main.c", "materials/WELCOME.txt"} {
		original, _ := os.Stat(filepath.Join(source, name))
		copied, _ := os.Stat(filepath.Join(dest, name))
		if os.SameFile(original, copied) || copied.Sys().(*syscall.Stat_t).Nlink != 1 {
			t.Fatal("copy aliases authored bytes", name)
		}
	}
	// Editing the author tree cannot mutate already copied private bytes.
	if err := os.WriteFile(filepath.Join(source, "work", "main.c"), []byte("edited"), 0644); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(dest, "work", "main.c"))
	if err != nil || string(data) != "starter bytes\n" {
		t.Fatal("private bytes changed with author", err)
	}
}

func TestTemplateCopyRejectsUnsafeDestinationBeforeWriting(t *testing.T) {
	source := templateSourceFixture(t)
	before, _ := inspectTemplateSource(source, sourceTestBounds(), nil)
	for _, kind := range []string{"existing-file", "existing-link", "public-parent", "parent-link", "inside-source", "inside-source-alias"} {
		t.Run(kind, func(t *testing.T) {
			parent := templateCopyParent(t)
			dest := filepath.Join(parent, "copy")
			switch kind {
			case "existing-file":
				if err := os.WriteFile(dest, []byte("preserve"), 0600); err != nil {
					t.Fatal(err)
				}
			case "existing-link":
				if err := os.Symlink(source, dest); err != nil {
					t.Fatal(err)
				}
			case "public-parent":
				if err := os.Chmod(parent, 0755); err != nil {
					t.Fatal(err)
				}
			case "parent-link":
				alias := filepath.Join(t.TempDir(), "alias")
				if err := os.Symlink(parent, alias); err != nil {
					t.Fatal(err)
				}
				dest = filepath.Join(alias, "copy")
			case "inside-source", "inside-source-alias":
				if err := os.Chmod(source, 0700); err != nil {
					t.Fatal(err)
				}
				dest = filepath.Join(source, "copy")
				if kind == "inside-source-alias" {
					alias := filepath.Join(parent, "alias")
					if err := os.Symlink(filepath.Dir(source), alias); err != nil {
						t.Fatal(err)
					}
					dest = filepath.Join(alias, filepath.Base(source), "copy")
				}
			}
			if _, err := copyTemplateSource(source, dest, sourceTestBounds(), nil); err == nil {
				t.Fatal("unsafe destination accepted", kind)
			}
			if kind == "existing-file" {
				data, _ := os.ReadFile(dest)
				if string(data) != "preserve" {
					t.Fatal("existing file changed")
				}
			} else if kind != "existing-link" {
				if _, err := os.Lstat(dest); !errors.Is(err, os.ErrNotExist) {
					t.Fatal("refusal wrote output", err)
				}
			}
		})
	}
	after, err := inspectTemplateSource(source, sourceTestBounds(), nil)
	if err != nil || before.Hash != after.Hash {
		t.Fatal("refusal changed authored trees", err)
	}
}

func TestTemplateCopyRejectsObservedSourceAndPrivateCopyMutation(t *testing.T) {
	for _, mutation := range []string{"source-after-inspection", "source-after-copy", "source-extra", "private-after-copy", "interrupted"} {
		t.Run(mutation, func(t *testing.T) {
			source := templateSourceFixture(t)
			dest := filepath.Join(templateCopyParent(t), "copy")
			_, err := copyTemplateSource(source, dest, sourceTestBounds(), func(phase string) error {
				switch {
				case mutation == "source-after-inspection" && phase == "inspected":
					return os.WriteFile(filepath.Join(source, "work", "main.c"), []byte("changed bytes\n"), 0644)
				case mutation == "source-after-copy" && phase == "copied":
					return os.WriteFile(filepath.Join(source, "work", "main.c"), []byte("changed bytes\n"), 0644)
				case mutation == "source-extra" && phase == "copied":
					return os.WriteFile(filepath.Join(source, "work", "new"), nil, 0600)
				case mutation == "private-after-copy" && phase == "copied":
					return os.WriteFile(filepath.Join(dest, "work", "main.c"), []byte("changed bytes\n"), 0644)
				case mutation == "interrupted" && strings.HasPrefix(phase, "copied:"):
					return errors.New("test-only interrupted import")
				}
				return nil
			})
			if err == nil {
				t.Fatal("unsafe/interrupted copy succeeded", mutation)
			}
			info, err := os.Stat(dest)
			if err != nil || info.Mode().Perm() != 0700 {
				t.Fatal("failed staging not private", info, err)
			}
			if _, err := os.Stat(filepath.Join(dest, "manifest.json")); !errors.Is(err, os.ErrNotExist) {
				t.Fatal("published manifest on failure", err)
			}
		})
	}
}

func TestTemplateCopyStreamsDefaultSizeFile(t *testing.T) {
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
	manifest, err := copyTemplateSource(source, filepath.Join(templateCopyParent(t), "copy"), collectionBounds{File: 128 * mib, Total: 512 * mib}, nil)
	runtime.ReadMemStats(&after)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.TotalBytes < 128*mib || after.TotalAlloc-before.TotalAlloc > uint64(16*mib) {
		t.Fatal("private copy did not stream bytes", manifest.TotalBytes, after.TotalAlloc-before.TotalAlloc)
	}
}

func TestTemplateCopyCrashChild(t *testing.T) {
	for i, arg := range os.Args {
		if arg == "--template-copy-crash" && i+2 < len(os.Args) {
			_, err := copyTemplateSource(os.Args[i+1], os.Args[i+2], sourceTestBounds(), func(phase string) error {
				if strings.HasPrefix(phase, "copied:") {
					return syscall.Kill(os.Getpid(), syscall.SIGKILL)
				}
				return nil
			})
			t.Fatal("crash barrier did not terminate child", err)
		}
	}
}
func TestTemplateCopyActualDeathLeavesUnpublishedPrivateStagingAndRetryNeverOverwrites(t *testing.T) {
	source := templateSourceFixture(t)
	before, _ := inspectTemplateSource(source, sourceTestBounds(), nil)
	dest := filepath.Join(templateCopyParent(t), "failed")
	cmd := exec.Command(os.Args[0], "-test.run=^TestTemplateCopyCrashChild$", "--", "--template-copy-crash", source, dest)
	if output, err := cmd.CombinedOutput(); err == nil || !strings.Contains(err.Error(), "killed") {
		t.Fatal("actual child death not injected", err, string(output))
	}
	info, err := os.Stat(dest)
	if err != nil || info.Mode().Perm() != 0700 {
		t.Fatal("dead child left nonprivate staging", info, err)
	}
	if _, err := copyTemplateSource(source, dest, sourceTestBounds(), nil); err == nil {
		t.Fatal("silently adopted/overwrote dead child's partial copy")
	}
	if _, err := copyTemplateSource(source, filepath.Join(templateCopyParent(t), "retry"), sourceTestBounds(), nil); err != nil {
		t.Fatal("fresh explicit retry failed", err)
	}
	after, err := inspectTemplateSource(source, sourceTestBounds(), nil)
	if err != nil || after.Hash != before.Hash {
		t.Fatal("death/retry changed source", err)
	}
}

func TestTemplateCopyBindAliasChild(t *testing.T) {
	for i, arg := range os.Args {
		if arg == "--template-copy-bind" && i+2 < len(os.Args) {
			source, alias := os.Args[i+1], os.Args[i+2]
			if err := syscall.Mount(filepath.Join(source, "work"), alias, "", syscall.MS_BIND, ""); err != nil {
				t.Fatal(err)
			}
			dest := filepath.Join(alias, "copy")
			if _, err := copyTemplateSource(source, dest, sourceTestBounds(), nil); err == nil || !strings.Contains(err.Error(), "outside") {
				t.Fatal("copy wrote into a physical source alias", err)
			}
			if _, err := os.Stat(dest); !errors.Is(err, os.ErrNotExist) {
				t.Fatal("aliased source was changed", err)
			}
			return
		}
	}
}
func TestTemplateCopyRefusesSameDeviceBindAliasOfSourceBeforeWriting(t *testing.T) {
	if os.Getenv("EXAM_COLLECTION_USERNS") != "1" {
		t.Skip("set EXAM_COLLECTION_USERNS=1 for private bind-alias qualification")
	}
	source, alias := templateSourceFixture(t), templateCopyParent(t)
	if err := os.Chmod(filepath.Join(source, "work"), 0700); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("/usr/bin/unshare", "--user", "--map-root-user", "--mount", "--propagation", "private", os.Args[0], "-test.run=^TestTemplateCopyBindAliasChild$", "--", "--template-copy-bind", source, alias)
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatal("isolated bind-alias refusal failed", err, string(output))
	}
}
