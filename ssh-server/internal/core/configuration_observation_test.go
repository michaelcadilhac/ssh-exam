package core

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"syscall"
	"testing"
	"time"
)

func configurationFixture(t *testing.T) (string, Config) {
	t.Helper()
	dir := t.TempDir()
	if os.Chmod(dir, 0700) != nil {
		t.Fatal("fixture directory mode")
	}
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	pub, err := x509.MarshalPKIXPublicKey(public)
	if err != nil {
		t.Fatal(err)
	}
	key, err := x509.MarshalPKCS8PrivateKey(private)
	if err != nil {
		t.Fatal(err)
	}
	if os.WriteFile(filepath.Join(dir, "gateway.pub"), pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pub}), 0644) != nil || os.WriteFile(filepath.Join(dir, "agent.key"), pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: key}), 0600) != nil {
		t.Fatal("fixture keys")
	}
	c := Config{AgentID: "class", State: filepath.Join(dir, "absent-state"), Work: filepath.Join(dir, "absent-work"), Templates: filepath.Join(dir, "private-templates"), Rootfs: "/", GatewayPublicKey: filepath.Join(dir, "gateway.pub"), CallbackKey: filepath.Join(dir, "agent.key"), CallbackURL: "https://gateway.invalid", Accounts: map[string]Account{"synthetic": {UID: 20001, GID: 20001, Home: "/home/synthetic", Shell: "/bin/bash"}}}
	path := filepath.Join(dir, "agent.json")
	configurationWrite(t, path, c)
	return path, c
}
func configurationWrite(t *testing.T, path string, c Config) {
	t.Helper()
	raw, err := json.Marshal(c)
	if err != nil || os.WriteFile(path, raw, 0600) != nil {
		t.Fatal("fixture configuration", err)
	}
}

func TestConfigurationObservationNeverInitializesOrLeaksKeysAndPaths(t *testing.T) {
	path, c := configurationFixture(t)
	before := snapshotTree(t, filepath.Dir(path))
	atime := map[string]syscall.Timespec{}
	for _, p := range []string{path, c.GatewayPublicKey, c.CallbackKey} {
		info, err := os.Stat(p)
		if err != nil {
			t.Fatal(err)
		}
		atime[p] = info.Sys().(*syscall.Stat_t).Atim
	}
	for _, keys := range []bool{false, true} {
		result, err := ObserveNativeConfiguration(path, keys, false)
		if err != nil || !result.StructuralValid || result.KeyFilesChecked != keys || result.Validated != keys || result.Applied || !result.ReadOnly || len(result.Issues) != 0 {
			t.Fatal("incorrect offline observation", result, err)
		}
		raw, _ := json.Marshal(result)
		for _, secret := range []string{filepath.Dir(path), "/home/synthetic", "PRIVATE KEY", "PUBLIC KEY"} {
			if bytes.Contains(raw, []byte(secret)) {
				t.Fatal("sensitive diagnostic output", secret)
			}
		}
	}
	explicit, err := ObserveNativeConfiguration(path, true, true)
	if err != nil || explicit.Configuration.State != c.State || explicit.Configuration.CallbackKey != c.CallbackKey || !explicit.PathsIncluded {
		t.Fatal("explicit path metadata missing", explicit, err)
	}
	for p, want := range atime {
		info, err := os.Stat(p)
		if err != nil || info.Sys().(*syscall.Stat_t).Atim != want {
			t.Fatal("observation changed available file atime", filepath.Base(p), err)
		}
	}
	// The generic byte-snapshot helper reopens /proc/self/fd for comparison;
	// measure reader atimes BEFORE that independent test-only content read.
	if after := snapshotTree(t, filepath.Dir(path)); !reflect.DeepEqual(before, after) {
		t.Fatal("observation changed existing tree")
	}
	for _, p := range []string{c.State, c.Work} {
		if _, err := os.Lstat(p); !os.IsNotExist(err) {
			t.Fatal("observation initialized runtime directory", err)
		}
	}
}

func TestConfigurationShowDoesNotReadKeysAndValidationCannotPretendMissingKeysAreValid(t *testing.T) {
	path, c := configurationFixture(t)
	if err := os.Remove(c.CallbackKey); err != nil {
		t.Fatal(err)
	}
	shown, err := ObserveNativeConfiguration(path, false, false)
	if err != nil || !shown.StructuralValid || len(shown.Issues) != 0 || shown.KeyFilesChecked || shown.Validated {
		t.Fatal(shown, err)
	}
	checked, err := ObserveNativeConfiguration(path, true, false)
	if err != nil || checked.Validated || !checked.KeyFilesChecked || len(checked.Issues) != 1 || checked.Issues[0].Component != "callback_key" {
		t.Fatal(checked, err)
	}
	if _, err := LoadConfig(path); err == nil {
		t.Fatal("legacy loader lost its required private-key check")
	}
}

func TestConfigurationRejectsUnsafeFilesWithoutFollowingOrBlocking(t *testing.T) {
	for _, kind := range []string{"symlink", "parent-link", "hardlink", "fifo", "writable", "oversize", "unknown", "duplicate", "deep", "trailing", "null", "utf8"} {
		t.Run(kind, func(t *testing.T) {
			path, _ := configurationFixture(t)
			dir := filepath.Dir(path)
			switch kind {
			case "symlink":
				if err := os.Rename(path, path+".saved"); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(path+".saved", path); err != nil {
					t.Fatal(err)
				}
			case "parent-link":
				link := filepath.Join(t.TempDir(), "linked-parent")
				if err := os.Symlink(dir, link); err != nil {
					t.Fatal(err)
				}
				path = filepath.Join(link, "agent.json")
			case "hardlink":
				if err := os.Link(path, path+".alias"); err != nil {
					t.Fatal(err)
				}
			case "fifo":
				if err := os.Remove(path); err != nil {
					t.Fatal(err)
				}
				if err := syscall.Mkfifo(path, 0600); err != nil {
					t.Fatal(err)
				}
			case "writable":
				if err := os.Chmod(path, 0622); err != nil {
					t.Fatal(err)
				}
			default:
				data := []byte("null")
				switch kind {
				case "oversize":
					data = bytes.Repeat([]byte(" "), 65537)
				case "unknown":
					data = []byte(`{"PASSWORD":"PRIVATE-CONFIGURATION-SECRET"}`)
				case "duplicate":
					data = []byte(`{"agent_id":"a","agent_id":"b"}`)
				case "deep":
					data = []byte(strings.Repeat("[", 70) + "0" + strings.Repeat("]", 70))
				case "trailing":
					data = []byte(`{} {}`)
				case "utf8":
					data = []byte{'{', '"', 'x', '"', ':', '"', 255, '"', '}'}
				}
				if err := os.WriteFile(path, data, 0600); err != nil {
					t.Fatal(err)
				}
			}
			result, err := ObserveNativeConfiguration(path, true, true)
			if err == nil {
				t.Fatal("unsafe configuration accepted", kind, result)
			}
			if strings.Contains(err.Error(), "PRIVATE-CONFIGURATION-SECRET") {
				t.Fatal("raw configuration error leaked")
			}
		})
	}
}

func TestConfigurationInvalidKnownFieldsCannotEchoPastedSecretsEvenWithPaths(t *testing.T) {
	for _, kind := range []string{"identity", "url", "account", "path", "private-root"} {
		path, c := configurationFixture(t)
		secret := "PRIVATE-PASTED-CREDENTIAL"
		switch kind {
		case "identity":
			c.AgentID = "bad " + secret
		case "url":
			c.CallbackURL = "https://user:" + secret + "@gateway.invalid"
		case "account":
			c.Accounts["bad "+secret] = Account{UID: 20002, GID: 20002, Home: "/home/bad", Shell: "/bin/bash"}
		case "path":
			c.Socket = "/bad\n" + secret
		case "private-root":
			c.State = "/"
		}
		configurationWrite(t, path, c)
		result, err := ObserveNativeConfiguration(path, true, true)
		if err != nil || result.StructuralValid || result.Validated || result.KeyFilesChecked || len(result.Issues) == 0 {
			t.Fatal(kind, result, err)
		}
		raw, _ := json.Marshal(result)
		if bytes.Contains(raw, []byte(secret)) {
			t.Fatal("invalid known value escaped into diagnostics", kind)
		}
	}
}

func TestConfigurationPinnedReadRefusesObservedMutationAndUnsafeKeyWithoutDumpingBytes(t *testing.T) {
	path, c := configurationFixture(t)
	for _, sameLength := range []bool{false, true} {
		configurationWrite(t, path, c)
		original, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		_, err = readConfigurationFile(path, false, 65536, func() {
			replacement := []byte("{}")
			if sameLength {
				replacement = bytes.Replace(original, []byte(`"class"`), []byte(`"other"`), 1)
			}
			if err := os.WriteFile(path, replacement, 0600); err != nil {
				t.Fatal(err)
			}
			if sameLength {
				if err := os.Chtimes(path, info.ModTime(), info.ModTime()); err != nil {
					t.Fatal(err)
				}
			}
		})
		if err == nil {
			t.Fatal("racing configuration mutation accepted", sameLength)
		}
	}
	configurationWrite(t, path, c)
	for _, kind := range []string{"linked", "public-readable-private", "bad-key"} {
		switch kind {
		case "linked":
			if err := os.Link(c.CallbackKey, c.CallbackKey+".alias"); err != nil {
				t.Fatal(err)
			}
		case "public-readable-private":
			if err := os.Remove(c.CallbackKey + ".alias"); err != nil {
				t.Fatal(err)
			}
			if err := os.Chmod(c.CallbackKey, 0644); err != nil {
				t.Fatal(err)
			}
		case "bad-key":
			if err := os.Chmod(c.CallbackKey, 0600); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(c.CallbackKey, []byte("PRIVATE-INVALID-KEY"), 0600); err != nil {
				t.Fatal(err)
			}
		}
		result, err := ObserveNativeConfiguration(path, true, false)
		if err != nil || result.Validated || len(result.Issues) != 1 || result.Issues[0].Component != "callback_key" {
			t.Fatal(kind, result, err)
		}
		raw, _ := json.Marshal(result)
		if bytes.Contains(raw, []byte("PRIVATE-INVALID-KEY")) {
			t.Fatal("invalid private key leaked")
		}
	}
}

func TestConfigurationObservationDoesNotReadOrRepairExistingBrokenRuntimeState(t *testing.T) {
	path, c := configurationFixture(t)
	for _, dir := range []string{c.State, c.Work} {
		if err := os.Mkdir(dir, 0700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(c.State, "state.json"), []byte("PRIVATE-BROKEN-STATE-DO-NOT-RECONCILE"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(c.Work, "answer"), []byte("PRIVATE-SAVED-ANSWER"), 0600); err != nil {
		t.Fatal(err)
	}
	before := snapshotTree(t, filepath.Dir(path))
	result, err := ObserveNativeConfiguration(path, true, false)
	if err != nil || !result.Validated || !result.ReadOnly || result.Applied {
		t.Fatal("configuration observation depended on or repaired native state", result, err)
	}
	raw, _ := json.Marshal(result)
	if bytes.Contains(raw, []byte("PRIVATE-BROKEN")) || bytes.Contains(raw, []byte("PRIVATE-SAVED")) {
		t.Fatal("runtime bytes read into configuration output")
	}
	if after := snapshotTree(t, filepath.Dir(path)); !reflect.DeepEqual(before, after) {
		t.Fatal("observation altered existing runtime state/work")
	}
}

func TestConfigurationOptionalCAFormatsAreCheckedWithoutTrustOrServiceClaims(t *testing.T) {
	path, c := configurationFixture(t)
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	certificate := &x509.Certificate{SerialNumber: big.NewInt(1), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour)}
	der, err := x509.CreateCertificate(rand.Reader, certificate, certificate, public, private)
	if err != nil {
		t.Fatal(err)
	}
	c.CallbackCA = filepath.Join(filepath.Dir(path), "ca.pem")
	c.HandoffCA = c.CallbackKey
	if err := os.WriteFile(c.CallbackCA, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0644); err != nil {
		t.Fatal(err)
	}
	configurationWrite(t, path, c)
	result, err := ObserveNativeConfiguration(path, true, false)
	if err != nil || !result.Validated || result.Applied || len(result.Issues) != 0 {
		t.Fatal(result, err)
	}
	if err := os.WriteFile(c.CallbackCA, []byte("PRIVATE-INVALID-CA"), 0644); err != nil {
		t.Fatal(err)
	}
	result, err = ObserveNativeConfiguration(path, true, false)
	if err != nil || result.Validated || len(result.Issues) != 1 || result.Issues[0].Component != "callback_ca" {
		t.Fatal(result, err)
	}
	raw, _ := json.Marshal(result)
	if bytes.Contains(raw, []byte("PRIVATE-INVALID-CA")) {
		t.Fatal("private bad CA data echoed")
	}
}
