package main

// Invoked only by the disposable real-gateway scripting qualification. This is
// a typed fixture producer, never a shipped CLI operation or student-account tool.
import (
	"encoding/json"
	"examworkspace/agent/internal/core"
	"os"
	"path/filepath"
	"testing"
)

func TestPrepareScriptingNativeFixture(t *testing.T) {
	path := os.Getenv("EXAM_SCRIPTING_NATIVE_SPEC")
	if path == "" {
		t.Skip("typed private fixture producer; invoked by actual gateway scripting test")
	}
	if os.Geteuid() != 0 || filepath.Base(path) != "scripting-native-spec.json" {
		t.Fatal("fixture requires explicit private root-mapped spec")
	}
	data, err := readScriptPrivate(path, 65536)
	if err != nil {
		t.Fatal(err)
	}
	var spec struct {
		Config   string `json:"config"`
		Attempts []struct {
			ID       string        `json:"id"`
			Exam     string        `json:"exam"`
			Username string        `json:"username"`
			UID      int           `json:"uid"`
			Settings core.Settings `json:"settings"`
			Start    int64         `json:"start"`
			Deadline int64         `json:"deadline"`
			Content  string        `json:"content"`
		} `json:"attempts"`
	}
	if decodeScriptJSON(data, &spec) != nil || len(spec.Attempts) < 1 || len(spec.Attempts) > 16 {
		t.Fatal("invalid typed fixture spec")
	}
	c, err := core.LoadConfig(spec.Config)
	if err != nil {
		t.Fatal(err)
	}
	parent := filepath.Dir(path)
	if c.State != filepath.Join(parent, "scripting-native") || c.Work != filepath.Join(parent, "scripting-work") || c.Rootfs != parent {
		t.Fatal("fixture paths are not confined")
	}
	if err := os.Mkdir(c.State, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(c.Work, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(c.State, "submissions"), 0700); err != nil {
		t.Fatal(err)
	}
	state := core.State{Attempts: map[string]*core.Attempt{}, Caps: map[string]core.Capability{}, Registrations: map[string]string{}}
	for _, row := range spec.Attempts {
		if !managementUUID.MatchString(row.ID) || row.UID < 29900 || row.UID > 29999 || len(row.Content) > 4096 {
			t.Fatal("invalid synthetic identity/content")
		}
		source := filepath.Join(parent, "source-"+row.ID)
		if err := os.Mkdir(source, 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(source, "answer.txt"), []byte(row.Content), 0600); err != nil {
			t.Fatal(err)
		}
		a := &core.Attempt{ID: row.ID, Exam: row.Exam, Username: row.Username, UID: row.UID, Settings: row.Settings, State: "COMPLETED", Start: row.Start, Deadline: row.Deadline, OriginalDeadline: row.Deadline, Ended: row.Deadline, PolicyState: "NORMAL", AccessState: "RELEASED"}
		a.Checksum, err = core.Collect(source, filepath.Join(c.State, "submissions", row.ID), a)
		if err != nil {
			t.Fatal(err)
		}
		a.Protected = true
		state.Attempts[row.ID] = a
	}
	data, err = json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(c.State, "state.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(parent, "scripting-native-result.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
}
