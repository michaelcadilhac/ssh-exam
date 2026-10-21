package core

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// Opt-in measurement, not a production capacity claim. The regular suite keeps
// its sparse-file/path/depth/count limit regressions without requiring a compiler.
func TestSyntheticCompilerCollectionWorkloads(t *testing.T) {
	if os.Getenv("EXAM_COMPILER_WORKLOADS") != "1" {
		t.Skip("set EXAM_COMPILER_WORKLOADS=1 to measure synthetic GCC outputs")
	}
	compiler, err := exec.LookPath("gcc")
	if err != nil {
		t.Fatal("command not found: gcc; stop and install the compiler before continuing")
	}
	for _, large := range []bool{false, true} {
		name, source := "small", "int main(void) { return 0; }\n"
		if large {
			name = "large-constant-table"
			source = "const unsigned char lookup[40*1024*1024] = {7};\nint main(int argc, char **argv) { return lookup[argc % sizeof lookup]; }\n"
		}
		t.Run(name, func(t *testing.T) {
			work := t.TempDir()
			if err = os.WriteFile(filepath.Join(work, "answer.c"), []byte(source), 0600); err != nil {
				t.Fatal(err)
			}
			for _, args := range [][]string{{"-g3", "-O0", "-c", "answer.c", "-o", "answer.o"}, {"-g3", "answer.o", "-o", "answer"}} {
				cmd := exec.Command(compiler, args...)
				cmd.Dir = work
				if output, compileErr := cmd.CombinedOutput(); compileErr != nil {
					t.Fatalf("gcc failed: %v: %s", compileErr, output)
				}
			}
			var total int64
			for _, file := range []string{"answer.c", "answer.o", "answer"} {
				info, statErr := os.Stat(filepath.Join(work, file))
				if statErr != nil {
					t.Fatal(statErr)
				}
				total += info.Size()
				t.Logf("%s logical_bytes=%d", file, info.Size())
			}
			dest := filepath.Join(t.TempDir(), "protected")
			_, collectErr := Collect(work, dest, &Attempt{ID: finalID, Exam: "synthetic-compiler", Username: "synthetic"})
			if large {
				if collectErr == nil || !strings.Contains(collectErr.Error(), "per-file logical size exceeded") {
					t.Fatalf("large compiler output did not fail closed: %v", collectErr)
				}
				if _, statErr := os.Lstat(dest); !os.IsNotExist(statErr) {
					t.Fatal("failed collection published a partial protected bundle", statErr)
				}
			} else if collectErr != nil {
				t.Fatal(collectErr)
			}
			t.Logf("total_logical_bytes=%d collection_error=%v", total, collectErr)
		})
	}
}
