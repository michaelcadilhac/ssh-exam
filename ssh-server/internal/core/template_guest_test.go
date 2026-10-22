package core

// Real CLI/system-manager qualification in the guarded disposable guest only.
// No test adapter, worker option, installed-host operation or grant is used.
import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

// The fixture agent independently queues/delivers status callbacks. Ignore ONLY
// those three delivery bookkeeping fields; compare every authority/history field
// (including unknown future top-level keys), not just a hand-picked deadline.
func templateGuestAuthorityEqual(before, after []byte) bool {
	var left, right map[string]any
	decode := func(raw []byte, target *map[string]any) error {
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.UseNumber() // Preserve future 64-bit authority identities exactly.
		return decoder.Decode(target)
	}
	if !validReadOnlyJSON(before) || !validReadOnlyJSON(after) || decode(before, &left) != nil || decode(after, &right) != nil || left == nil || right == nil {
		return false
	}
	for _, key := range []string{"sequence", "events", "reported"} {
		delete(left, key)
		delete(right, key)
	}
	return reflect.DeepEqual(left, right)
}

func TestTemplateGuestPreservationIgnoresOnlyCallbackBookkeeping(t *testing.T) {
	before := []byte(`{"attempts":{"a":{"deadline":123,"original_deadline":123,"access_state":"HELD","protected":true,"settings":{"duration":90}}},"events":[],"sequence":1}`)
	after := []byte(`{"attempts":{"a":{"deadline":123,"original_deadline":123,"access_state":"HELD","protected":true,"settings":{"duration":90}}},"events":[{"delivery":"retry"}],"sequence":2,"reported":{"a":"hash"}}`)
	if !templateGuestAuthorityEqual(before, after) {
		t.Fatal("callback bookkeeping mistaken for authority")
	}
	for _, changed := range []string{
		strings.Replace(string(after), `"deadline":123`, `"deadline":124`, 1),
		strings.Replace(string(after), `"access_state":"HELD"`, `"access_state":"RELEASED"`, 1),
		strings.Replace(string(after), `"protected":true`, `"protected":false`, 1),
		strings.Replace(string(after), `"duration":90`, `"duration":91`, 1),
		strings.Replace(string(after), `"events":`, `"unknown_authority":true,"events":`, 1),
		`null`,
		string(after) + `{}`,
		strings.Replace(string(after), `"sequence":2`, `"sequence":2,"sequence":3`, 1),
	} {
		if templateGuestAuthorityEqual(before, []byte(changed)) {
			t.Fatal("changed authority accepted", changed)
		}
	}
	if templateGuestAuthorityEqual([]byte(`{"future_identity":9007199254740992}`), []byte(`{"future_identity":9007199254740993}`)) {
		t.Fatal("integer precision hid a changed authority identity")
	}
}

func TestTemplateCatalogSystemManagerGuest(t *testing.T) {
	requireMonitoringGuest(t, "template-catalog", "EXAM_TEMPLATE_CATALOG_GUEST")
	original, err := os.ReadFile("/etc/exam-agent/agent.json")
	if err != nil {
		t.Fatal(err)
	}
	var config Config
	if json.Unmarshal(original, &config) != nil {
		t.Fatal("private fixture configuration unavailable")
	}
	authority, err := os.ReadFile(filepath.Join(config.State, "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	dir, err := os.MkdirTemp("/run/ssh-exam-qualification-output", "catalog-")
	if err != nil {
		t.Fatal(err)
	}
	// Keep bounded synthetic evidence in this run's private output, not host/base.
	state := filepath.Join(dir, "state")
	source := filepath.Join(dir, "source")
	for _, path := range []string{state, source, filepath.Join(source, "work"), filepath.Join(source, "materials")} {
		if err := os.Mkdir(path, 0700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Chmod(filepath.Join(source, "materials"), 0755); err != nil {
		t.Fatal(err)
	}
	sentinel := []byte(`{"attempts":{"synthetic":{"deadline":123,"original_deadline":123,"access_state":"HELD","protected":true}}}`)
	if os.WriteFile(filepath.Join(state, "state.json"), sentinel, 0600) != nil {
		t.Fatal("private authority sentinel unavailable")
	}
	protected := filepath.Join(state, "protected-sentinel")
	if os.WriteFile(protected, []byte("PROTECTED-DO-NOT-ALTER"), 0600) != nil {
		t.Fatal("protected sentinel unavailable")
	}
	originalState := config.State
	config.State = state
	encoded, _ := json.Marshal(config)
	configPath := filepath.Join(dir, "agent.json")
	if err := os.WriteFile(configPath, encoded, 0600); err != nil {
		t.Fatal(err)
	}
	check := func() {
		t.Helper()
		for path, want := range map[string][]byte{filepath.Join(originalState, "state.json"): authority, filepath.Join(state, "state.json"): sentinel, protected: []byte("PROTECTED-DO-NOT-ALTER")} {
			got, err := os.ReadFile(path)
			if err == nil && path == filepath.Join(originalState, "state.json") && templateGuestAuthorityEqual(want, got) {
				continue
			}
			if err != nil || !bytes.Equal(got, want) {
				label := "private-state-or-protected"
				if path == filepath.Join(originalState, "state.json") {
					label = "original-guest-state"
				}
				var a, b map[string]json.RawMessage
				var changed []string
				if json.Unmarshal(want, &a) == nil && json.Unmarshal(got, &b) == nil {
					keys := map[string]bool{}
					for k := range a {
						keys[k] = true
					}
					for k := range b {
						keys[k] = true
					}
					for k := range keys {
						var left, right any
						_ = json.Unmarshal(a[k], &left)
						_ = json.Unmarshal(b[k], &right)
						if !reflect.DeepEqual(left, right) {
							changed = append(changed, k)
						}
					}
				}
				t.Fatal("catalog preservation mismatch", label, "changed top-level keys", changed, err)
			}
		}
	}
	defer check()
	run := func(success bool, args ...string) TemplateResult {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, "/usr/local/sbin/examctl", append([]string{"--config", configPath, "templates"}, args...)...)
		var out, diagnostics bytes.Buffer
		command.Stdout = &out
		command.Stderr = &diagnostics
		err := command.Run()
		if strings.Contains(diagnostics.String(), "executable file not found") || strings.Contains(diagnostics.String(), "COMMAND_NOT_FOUND") {
			t.Fatal("COMMAND_NOT_FOUND in guest CLI; stop qualification")
		}
		if success {
			var result TemplateResult
			if err != nil || out.Len() > 128*1024 || json.Unmarshal(out.Bytes(), &result) != nil {
				t.Fatal("actual template CLI failed", err, diagnostics.String(), out.String())
			}
			check()
			return result
		}
		if err == nil || out.Len() != 0 {
			t.Fatal("refused actual CLI published success/private output", err, out.String())
		}
		check()
		return TemplateResult{}
	}
	starter := filepath.Join(source, "work", "main.c")
	if os.WriteFile(starter, []byte("starter bytes\n"), 0644) != nil || os.WriteFile(filepath.Join(source, "materials", "WELCOME.md"), []byte("Synthetic immutable materials\n"), 0644) != nil {
		t.Fatal("fixture source unavailable")
	}
	blob, err := os.OpenFile(filepath.Join(source, "work", "large.bin"), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
	if err != nil {
		t.Fatal(err)
	}
	chunk := bytes.Repeat([]byte("template-qualification-"), 50000)
	remaining := int64(128 * mib)
	for remaining > 0 {
		n := int64(len(chunk))
		if n > remaining {
			n = remaining
		}
		written, err := blob.Write(chunk[:n])
		if err != nil || int64(written) != n {
			t.Fatal("large source write failed", err)
		}
		remaining -= n
	}
	if blob.Sync() != nil || blob.Close() != nil {
		t.Fatal("large source flush failed")
	}
	bounds, err := exec.Command("/usr/bin/systemctl", "show", "exam-template.slice", "--property=LoadState", "--property=MemoryMax", "--property=MemorySwapMax", "--property=TasksMax", "--property=ControlGroup").Output()
	if err != nil || validateTemplateSlice(string(bounds)) != nil {
		t.Fatal("actual system template slice unavailable", err, string(bounds))
	}
	validated := run(true, "validate", source)
	if validated.Info == nil || validated.Info.MaxFileBytes != 128*mib || validated.Installed || validated.GatewayConfirmed {
		t.Fatal("incorrect actual validation", validated)
	}
	group, err := exec.Command("/usr/bin/systemctl", "show", "exam-template.slice", "--property=ControlGroup", "--value").Output()
	// systemd slice dashes encode hierarchy: exam-template.slice is a child
	// of exam.slice, a sibling of collection and not its descendant.
	if err != nil || strings.TrimSpace(string(group)) != "/exam.slice/exam-template.slice" {
		t.Fatal("actual template cgroup identity unavailable", err, string(group))
	}
	for leaf, want := range map[string]string{"memory.max": "268435456", "memory.swap.max": "0", "pids.max": "32"} {
		value, err := os.ReadFile(filepath.Join("/sys/fs/cgroup/exam.slice/exam-template.slice", leaf))
		if err != nil || strings.TrimSpace(string(value)) != want {
			t.Fatal("actual template kernel control wrong", leaf, string(value), err)
		}
	}
	id := ManagementID()
	reason := "Reviewed synthetic guest template only"
	installed := run(true, "install", "qualification", source, "--expected", validated.Info.Hash, "--request", id, "--reason", reason)
	if installed.Info == nil || !installed.Verified || !installed.Installed || installed.GatewayConfirmed || installed.Job != id {
		t.Fatal("incorrect actual install", installed)
	}
	for _, action := range []string{"show", "verify"} {
		observed := run(true, action, "qualification", validated.Info.Hash)
		if !reflect.DeepEqual(observed.Info, installed.Info) || observed.Verified != (action == "verify") {
			t.Fatal("exact installed version mismatch", observed)
		}
	}
	if os.WriteFile(starter, []byte("changed authored source\n"), 0644) != nil {
		t.Fatal("cannot mutate own source fixture")
	}
	retried := run(true, "install", "qualification", filepath.Join(dir, "missing-source"), "--expected", validated.Info.Hash, "--request", id, "--reason", reason)
	if !reflect.DeepEqual(retried.Info, installed.Info) {
		t.Fatal("exact retry recollected mutable source")
	}
	run(false, "install", "qualification", source, "--expected", validated.Info.Hash, "--request", id, "--reason", "Conflicting synthetic reason")
	run(false, "install", "qualification", source, "--expected", strings.Repeat("a", 64), "--reason", reason)
	if err := os.Symlink(protected, filepath.Join(source, "work", "unsafe")); err != nil {
		t.Fatal(err)
	}
	run(false, "validate", source)
	page := run(true, "list", "--name", "qualification", "--limit", "1")
	if len(page.Versions) != 1 || page.Versions[0].Hash != validated.Info.Hash {
		t.Fatal("actual catalog inventory wrong", page)
	}
	jobs := run(true, "jobs", "--limit", "50")
	if len(jobs.Jobs) < 1 {
		t.Fatal("actual install receipt disappeared")
	}
	run(true, "clean", id, "--confirm", id, "--reason", "Reviewed published synthetic job only")
	run(true, "verify", "qualification", validated.Info.Hash)
	t.Log("actual system-manager CLI validate/install/show/verify/list/jobs/clean, 128MiB import, exact retry/source mutation/link/conflicting-intent refusals preserve fixture authority and installed versions")
}
