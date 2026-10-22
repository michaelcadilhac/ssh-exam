package core

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

func TestHomeIdentityFilesSurvivePrivateAgentUmask(t *testing.T) {
	if os.Getenv("EXAM_HOME_UMASK_CHILD") == "1" {
		syscall.Umask(0077)
		state := os.Getenv("EXAM_HOME_STATE")
		home := os.Getenv("EXAM_HOME_SOURCE")
		e := &Engine{Config: Config{State: state, Accounts: map[string]Account{"student": {UID: os.Getuid(), GID: os.Getgid(), Home: home, Shell: "/bin/bash"}}}}
		if err := e.prepareHome(&Attempt{ID: finalID, Username: "student"}); err != nil {
			t.Fatal(err)
		}
		return
	}
	state, home := t.TempDir(), t.TempDir()
	os.WriteFile(filepath.Join(home, ".bashrc"), []byte("# preference\n"), 0600)
	cmd := exec.Command(os.Args[0], "-test.run=^TestHomeIdentityFilesSurvivePrivateAgentUmask$")
	cmd.Env = append(os.Environ(), "EXAM_HOME_UMASK_CHILD=1", "EXAM_HOME_STATE="+state, "EXAM_HOME_SOURCE="+home)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("%v: %s", err, out)
	}
	for name, want := range map[string]os.FileMode{"": 0755, ".exam-passwd": 0444, ".exam-group": 0444, ".bashrc": 0444} {
		info, err := os.Stat(filepath.Join(state, "homes", finalID, name))
		if err != nil || info.Mode().Perm() != want {
			t.Fatalf("%s: %v %v", name, info, err)
		}
	}
}

func TestHostWorkloadIsTrackedAndRestrictedToFunctionalIdentity(t *testing.T) {
	a := &Attempt{Username: "admin", UID: 1001, FunctionalTest: true, WorkPath: "/work", ID: finalID}
	e := &Engine{Config: Config{FunctionalTestAccount: "admin", Accounts: map[string]Account{"admin": {UID: 1001}}}}
	unit := "exam-" + finalID + "-pane.service"
	if !e.recordedUnitAllowed(a, unit) {
		t.Fatal("functional host service rejected")
	}
	a.FunctionalTest = false
	if e.recordedUnitAllowed(a, unit) {
		t.Fatal("production accepted host service")
	}
	a.FunctionalTest = true
	a.UID = 1002
	if e.recordedUnitAllowed(a, unit) {
		t.Fatal("wrong account accepted host service")
	}
	a.Settings.Template = "v1"
	args := strings.Join(functionalHostArgs(unit, "admin", Account{GID: 1001, Home: "/home/admin", Shell: "/bin/bash"}, "/protected/attempt/work", a, "pane", false, Config{Templates: "/templates"}, temporaryPaths{Tmp: "/private/exam/tmp", VarTmp: "/private/exam/var-tmp"}), "\n")
	for _, required := range []string{"--pty", "--uid=admin", "--setenv=TMPDIR=/tmp", " /private/exam/tmp:/tmp /private/exam/var-tmp:/var/tmp", "--property=BindPaths=/protected/attempt/work:/work", "--setenv=HOME=/home/admin", "--property=BindReadOnlyPaths=/templates/v1/materials:/materials"} {
		if !strings.Contains(args, required) {
			t.Fatalf("missing %s", required)
		}
	}
}
