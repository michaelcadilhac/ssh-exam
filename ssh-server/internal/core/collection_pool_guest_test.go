package core

// Exact property/CLI qualification INSIDE the guarded disposable guest only.
// No host/installed service action, student attempt or collection is created.
import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCollectionPoolReadinessGuest(t *testing.T) {
	requireMonitoringGuest(t, "collection-pool", "EXAM_COLLECTION_POOL_GUEST")
	data, err := os.ReadFile("/etc/exam-agent/agent.json")
	if err != nil {
		t.Fatal(err)
	}
	var config Config
	if json.Unmarshal(data, &config) != nil {
		t.Fatal("private guest configuration unavailable")
	}
	before, err := os.ReadFile(filepath.Join(config.State, "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	control := func(args ...string) []byte {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		out, err := exec.CommandContext(ctx, "/usr/bin/systemctl", args...).CombinedOutput()
		if err != nil {
			t.Fatal("private guest collection-pool control failed", err, string(out))
		}
		return out
	}
	health := func(want bool) {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		var out, diagnostics bytes.Buffer
		command := exec.CommandContext(ctx, "/usr/local/sbin/examctl", "health")
		command.Stdout = &out
		command.Stderr = &diagnostics
		if err := command.Run(); err != nil || out.Len() > 128*1024 {
			t.Fatal("actual guest CLI health failed", err, diagnostics.String())
		}
		var result struct {
			Ready   bool     `json:"ready"`
			Missing []string `json:"missing"`
		}
		if json.Unmarshal(out.Bytes(), &result) != nil || result.Ready != want {
			t.Fatal("guest readiness mismatch", want, out.String())
		}
		blocked := false
		for _, item := range result.Missing {
			if strings.HasPrefix(item, "collection resource slice unavailable or unbounded") {
				blocked = true
			}
		}
		if blocked == want {
			t.Fatal("guest collection pool status did not match its actual limit", want, result.Missing)
		}
		after, err := os.ReadFile(filepath.Join(config.State, "state.json"))
		if err != nil || !templateGuestAuthorityEqual(before, after) {
			t.Fatal("guest health changed native authority", err)
		}
	}
	control("start", "exam-collection.slice") // Only this idle disposable guest's empty slice.
	path := strings.TrimSpace(string(control("show", "exam-collection.slice", "--property=ControlGroup", "--value")))
	if path != "/exam.slice/exam-collection.slice" {
		t.Fatal("unexpected guest pool cgroup", path)
	}
	kernel := func(want string) {
		t.Helper()
		value, err := os.ReadFile("/sys/fs/cgroup/exam.slice/exam-collection.slice/memory.swap.max")
		if err != nil || strings.TrimSpace(string(value)) != want {
			t.Fatal("actual guest swap controller mismatch", want, string(value), err)
		}
	}
	kernel("0")
	health(true)
	// The wrapper/identity guard has already proved the private guest. The parent
	// test guest ALSO remains no-swap, and no workload is launched by this test.
	defer control("set-property", "--runtime", "exam-collection.slice", "MemorySwapMax=0")
	control("set-property", "--runtime", "exam-collection.slice", "MemorySwapMax=1048576")
	kernel("1048576")
	health(false)
	control("set-property", "--runtime", "exam-collection.slice", "MemorySwapMax=0")
	kernel("0")
	health(true)
	t.Log("real guest CLI readiness tracks exact kernel no-swap property, refuses nonzero and recovers after explicit overlay-only repair; authority unchanged")
}
