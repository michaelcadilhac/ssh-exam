package core

import (
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func boundTemplateFixture(t *testing.T) (*Engine, templateFixture, ed25519.PrivateKey) {
	t.Helper()
	e, _ := workspaceFixture(t)
	source := templateSourceFixture(t)
	if err := os.WriteFile(filepath.Join(source, "materials", "WELCOME.txt"), []byte("VERSION ONE [USER], [EXAM-NAME], [DEADLINE]\n"), 0644); err != nil {
		t.Fatal(err)
	}
	m, err := inspectTemplateSource(source, sourceTestBounds(), nil)
	if err != nil {
		t.Fatal(err)
	}
	f := templateFixture{state: e.Config.State, source: source, hash: m.Hash}
	if _, err := templateRun(t, f, templateInstallCommand(f), ""); err != nil {
		t.Fatal(err)
	}
	key := commandKeys(t, e)
	e.Config.Accounts["student"] = Account{UID: os.Getuid(), GID: os.Getgid(), Home: "/home/student", Shell: "/bin/bash"}
	if err := e.WithState(func() error {
		a := e.state.Attempts[finalID]
		a.Settings.Template = "midterm"
		a.Settings.TemplateVersion = f.hash
		a.Settings.Name = "Versioned exam"
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	// A mutable legacy decoy MUST NOT be consulted when an exact hash exists.
	for _, tree := range []string{"work", "materials"} {
		p := filepath.Join(e.Config.Templates, "midterm", tree)
		if err := os.MkdirAll(p, 0755); err != nil {
			t.Fatal(err)
		}
		leaf := "main.c"
		if tree == "materials" {
			leaf = "WELCOME.txt"
		}
		if err := os.WriteFile(filepath.Join(p, leaf), []byte("MUTABLE LEGACY DECOY"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	boundTemplateVerifier(e, "success")
	e.activationPrepare = func(*Attempt) error { return nil } // Privileged account guard only; worker/IPC/bytes are real.
	return e, f, key
}

func boundTemplateVerifier(e *Engine, mode string) {
	e.templateVerify = func(s Settings) error {
		if s.TemplateVersion == "" {
			return nil
		}
		b := TemplateCommand{Action: "verify", Name: s.Template, Hash: s.TemplateVersion}
		_, err := runTemplateProcess(templateProcessRequest(templateFixture{state: e.Config.State}, b, ManagementID()), templateChildOptions(mode))
		return err
	}
}

func boundCommand(e *Engine, key ed25519.PrivateKey, op string) (any, error) {
	cmd := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: op, Username: "student", Transport: "ssh-a", Body: Request{ID: finalID}}
	return e.Command(signedCommand(key, cmd), "student", "ssh-a")
}

func TestTemplateBindingSignedStageBeginRestartMountsAndWelcomeKeepExactVersion(t *testing.T) {
	e, f, key := boundTemplateFixture(t)
	if _, err := boundCommand(e, key, "prepare-workspace"); err != nil {
		t.Fatal(err)
	}
	a := assertUnstartedWorkspace(t, e, finalID)
	if a.Workspace == nil || a.Workspace.Source.Version != f.hash {
		t.Fatal("receipt lost exact source version")
	}
	settings, _ := json.Marshal(a.Settings)
	if a.Workspace.SettingsHash != Hash(settings) {
		t.Fatal("version absent from settings fence")
	}
	if err := os.WriteFile(filepath.Join(f.source, "work", "main.c"), []byte("AUTHOR VERSION TWO"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(f.source, "materials", "WELCOME.txt"), []byte("VERSION TWO MUST NOT APPEAR"), 0644); err != nil {
		t.Fatal(err)
	}
	m, err := inspectTemplateSource(f.source, sourceTestBounds(), nil)
	if err != nil {
		t.Fatal(err)
	}
	b := templateInstallCommand(f)
	b.Hash = m.Hash
	if _, err := templateRun(t, f, b, ""); err != nil {
		t.Fatal(err)
	}
	restarted, err := New(e.Config)
	if err != nil {
		t.Fatal(err)
	}
	boundTemplateVerifier(restarted, "success")
	restarted.activationPrepare = func(*Attempt) error { return nil }
	if _, err := boundCommand(restarted, key, "prepare-workspace"); err != nil {
		t.Fatal("restart did not adopt exact stage", err)
	}
	result, err := boundCommand(restarted, key, "activate-attempt")
	if err != nil {
		t.Fatal(err)
	}
	active := result.(*Attempt)
	if active.State != "ACTIVE" || active.Deadline-active.Start != 5400000 || active.OriginalDeadline != active.Deadline || active.Settings.TemplateVersion != f.hash {
		t.Fatal("Begin lost interval/version", active)
	}
	data, err := os.ReadFile(filepath.Join(e.Config.Work, finalID, "work", "main.c"))
	if err != nil || string(data) != "starter bytes\n" {
		t.Fatal("Begin chose mutable/newest work", string(data), err)
	}
	materials := filepath.Join(e.Config.State, "template-catalog", "versions", "midterm", f.hash, "content", "materials")
	temporary := temporaryPaths{Tmp: "/private/tmp", VarTmp: "/private/var-tmp", Application: "/private/application"}
	account := e.Config.Accounts["student"]
	for pane := 0; pane < 2; pane++ {
		// Additional/restarted panes use the same recorded immutable materials.
		args := strings.Join(sandboxWorkloadArgs("exam-bound.scope", "student", account, "/private/work", active, "pane", false, e.Config, temporary), "\n")
		if !strings.Contains(args, "--ro-bind\n"+materials+"\n/materials") || strings.Contains(args, e.Config.Templates+"/midterm") || strings.Contains(args, m.Hash) {
			t.Fatal("sandbox mounts wrong material version", args)
		}
		host := strings.Join(functionalHostArgs("exam-bound.service", "student", account, "/private/work", active, "pane", false, e.Config, temporary), "\n")
		if !strings.Contains(host, "BindReadOnlyPaths="+materials+":/materials") || strings.Contains(host, m.Hash) {
			t.Fatal("administrator mounts wrong version", host)
		}
		message, err := terminalWelcome(e.Config, active, false)
		if err != nil || !strings.Contains(message, "VERSION ONE student, Versioned exam") || strings.Contains(message, "VERSION TWO") || strings.Contains(message, "DECOY") {
			t.Fatal("welcome chose mutable/newest material", message, err)
		}
	}
	if _, err := boundCommand(restarted, key, "activate-attempt"); err != nil {
		t.Fatal("Begin retry reset/refused existing interval", err)
	}
}

func TestTemplateBindingCorruptionBeforeBeginRefusesWithoutClockOrLegacyFallback(t *testing.T) {
	for _, damage := range []string{"content", "missing", "metadata", "materials-link"} {
		t.Run(damage, func(t *testing.T) {
			e, f, key := boundTemplateFixture(t)
			if _, err := boundCommand(e, key, "prepare-workspace"); err != nil {
				t.Fatal(err)
			}
			base := filepath.Join(e.Config.State, "template-catalog", "versions", "midterm", f.hash)
			var err error
			switch damage {
			case "content":
				err = os.WriteFile(filepath.Join(base, "content", "materials", "WELCOME.txt"), []byte("CORRUPTED MATERIAL"), 0644)
			case "missing":
				err = os.Rename(base, base+"-preserved")
			case "metadata":
				err = os.WriteFile(filepath.Join(base, "version.json"), []byte(`{"schema":1}`), 0600)
			case "materials-link":
				p := filepath.Join(base, "content", "materials")
				err = os.Rename(p, p+"-preserved")
				if err == nil {
					err = os.Symlink(filepath.Join(e.Config.Templates, "midterm", "materials"), p)
				}
			}
			if err != nil {
				t.Fatal(err)
			}
			preparedOS := false
			e.activationPrepare = func(*Attempt) error { preparedOS = true; return nil }
			if _, err := boundCommand(e, key, "activate-attempt"); err == nil || !strings.Contains(err.Error(), "no interval") {
				t.Fatal("damaged version began/fell back", err)
			}
			a := assertUnstartedWorkspace(t, e, finalID)
			if preparedOS || a.AccessHeldAt != 0 || a.Workspace.Source.Version != f.hash {
				t.Fatal("verification failure altered authority/OS policy")
			}
			if _, err := boundCommand(e, key, "prepare-workspace"); err == nil {
				t.Fatal("retained stage hid corrupt materials")
			}
		})
	}
}

func TestTemplateBindingVerifierFailureOutsideStateLockPreservesUnstartedAttempt(t *testing.T) {
	for _, mode := range []string{"verify-kill", "verify-panic", "verify-hang"} {
		t.Run(mode, func(t *testing.T) {
			e, _, key := boundTemplateFixture(t)
			if _, err := boundCommand(e, key, "prepare-workspace"); err != nil {
				t.Fatal(err)
			}
			boundTemplateVerifier(e, mode)
			preparedOS := false
			e.activationPrepare = func(*Attempt) error { preparedOS = true; return nil }
			finished := make(chan error, 1)
			go func() { _, err := boundCommand(e, key, "activate-attempt"); finished <- err }()
			drained := false
			defer func() {
				if !drained {
					select {
					case <-finished:
					case <-time.After(5 * time.Second):
						t.Error("verifier did not drain")
					}
				}
			}()
			until := time.Now().Add(time.Second)
			for {
				if _, err := os.Stat(filepath.Join(e.Config.State, "template-child-entered")); err == nil {
					break
				}
				if time.Now().After(until) {
					t.Fatal("real verifier never entered")
				}
				time.Sleep(5 * time.Millisecond)
			}
			at := time.Now()
			assertUnstartedWorkspace(t, e, finalID)
			if time.Since(at) > 500*time.Millisecond {
				t.Fatal("verifier held shared state lock")
			}
			err := <-finished
			drained = true
			if err == nil || !strings.Contains(err.Error(), "no interval") || preparedOS {
				t.Fatal("failed verifier started policy/clock", err)
			}
			assertUnstartedWorkspace(t, e, finalID)
			boundTemplateVerifier(e, "success")
			if _, err := boundCommand(e, key, "activate-attempt"); err != nil {
				t.Fatal("explicit verified retry failed", err)
			}
		})
	}
}

func TestTemplateBindingPracticeNeverReadsCatalogAndMissingMaterialsRefuseRealPanes(t *testing.T) {
	e, f, _ := boundTemplateFixture(t)
	a := assertUnstartedWorkspace(t, e, finalID)
	if err := os.Rename(filepath.Join(e.Config.State, "template-catalog"), filepath.Join(e.Config.State, "catalog-preserved")); err != nil {
		t.Fatal(err)
	}
	temporary := temporaryPaths{Tmp: "/private/tmp", VarTmp: "/private/var-tmp", Application: "/private/application"}
	account := e.Config.Accounts["student"]
	if message, err := terminalWelcome(e.Config, a, true); err != nil || strings.Contains(message, f.hash) || !strings.Contains(message, "Practice terminal") {
		t.Fatal("practice accessed catalog", message, err)
	}
	if args := sandboxWorkloadArgs("exam-practice.scope", "student", account, "/private/practice", a, "pane", true, e.Config, temporary); len(args) == 0 || strings.Contains(strings.Join(args, "\n"), f.hash) {
		t.Fatal("practice sandbox consulted private version")
	}
	if args := functionalHostArgs("exam-practice.service", "student", account, "/private/practice", a, "pane", true, e.Config, temporary); len(args) == 0 || strings.Contains(strings.Join(args, "\n"), "BindReadOnlyPaths") {
		t.Fatal("practice administrator accessed materials")
	}
	if _, err := terminalWelcome(e.Config, a, false); err == nil {
		t.Fatal("missing explicit materials treated as optional banner")
	}
	if args := sandboxWorkloadArgs("exam-real.scope", "student", account, "/private/work", a, "pane", false, e.Config, temporary); args != nil {
		t.Fatal("normal pane fell back")
	}
	if args := functionalHostArgs("exam-real.service", "student", account, "/private/work", a, "pane", false, e.Config, temporary); args != nil {
		t.Fatal("administrator pane fell back")
	}
	if _, err := os.Stat(filepath.Join(e.Config.State, "template-catalog")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("reader recreated absent catalog", err)
	}
	if err := e.initialize(a); err == nil || !strings.Contains(err.Error(), "legacy initializer") {
		t.Fatal("legacy helper copied a versioned source", err)
	}
}

func TestTemplateBindingLegacySourceEncodingAndExactVersionValidation(t *testing.T) {
	b, _ := json.Marshal(WorkspaceSource{Kind: "template", Template: "v1"})
	if string(b) != `{"kind":"template","template":"v1"}` {
		t.Fatal("legacy source receipt encoding changed", string(b))
	}
	for _, version := range []string{"latest", "", strings.Repeat("a", 64), strings.Repeat("A", 64), "../version"} {
		valid := version == "" || version == strings.Repeat("a", 64)
		if validTemplateBinding(Settings{Template: "midterm", TemplateVersion: version}) != valid {
			t.Fatal("bad exact version validation", version)
		}
	}
}

func TestTemplateBindingActualReadOnlyMaterialMountUsesRecordedBytes(t *testing.T) {
	e, _, _ := boundTemplateFixture(t)
	a := assertUnstartedWorkspace(t, e, finalID)
	materials, err := templateMaterials(e.Config, a.Settings)
	if err != nil {
		t.Fatal(err)
	}
	// Real mount/namespace/IO check, not a claim of privileged SSH/PAM or the
	// complete production sandbox. Those remain a separate disposable-guest gate.
	// Production readiness requires /materials in its rootfs. The local host
	// intentionally has no such directory; use an existing private mount target.
	visible := filepath.Join(t.TempDir(), "materials")
	if err := os.Mkdir(visible, 0700); err != nil {
		t.Fatal(err)
	}
	script := `read -r message < "$1/WELCOME.txt"
case "$message" in 'VERSION ONE [USER], [EXAM-NAME], [DEADLINE]') ;; *) exit 2 ;; esac
if (printf 'MUST NOT WRITE' > "$1/WELCOME.txt") 2>/dev/null; then exit 3; fi
read -r unchanged < "$1/WELCOME.txt"
test "$message" = "$unchanged"`
	cmd := exec.Command("/usr/bin/bwrap", "--unshare-user", "--unshare-pid", "--unshare-net", "--cap-drop", "ALL", "--ro-bind", "/", "/", "--ro-bind", materials, visible, "--proc", "/proc", "--dev", "/dev", "--clearenv", "--", "/bin/sh", "-ec", script, "qualification", visible)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatal("actual exact-version read-only material mount failed", err, string(out))
	}
}

func TestTemplateBindingBeginRechecksSnapshotAfterVerifierBeforeAnyPolicyOrClockCommit(t *testing.T) {
	e, _, key := boundTemplateFixture(t)
	if _, err := boundCommand(e, key, "prepare-workspace"); err != nil {
		t.Fatal(err)
	}
	entered, release := make(chan struct{}), make(chan struct{})
	e.templateVerify = func(Settings) error { close(entered); <-release; return nil }
	preparedOS := false
	e.activationPrepare = func(*Attempt) error { preparedOS = true; return nil }
	finished := make(chan error, 1)
	drained := false
	defer drainWorkspaceTask(t, release, finished, &drained)
	go func() { _, err := boundCommand(e, key, "activate-attempt"); finished <- err }()
	<-entered
	other, err := New(e.Config)
	if err != nil {
		t.Fatal(err)
	}
	if err := other.WithState(func() error {
		other.state.Attempts[finalID].Settings.TemplateVersion = strings.Repeat("b", 64)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	close(release)
	err = <-finished
	drained = true
	if err == nil || !strings.Contains(err.Error(), "preparation changed") || preparedOS {
		t.Fatal("stale verifier authorized changed snapshot", err)
	}
	assertUnstartedWorkspace(t, other, finalID)
}
