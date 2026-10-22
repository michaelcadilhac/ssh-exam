package core

// Offline CLI observations ONLY: no Engine, state/audit/lock, network, service,
// reconciliation, chmod or candidate installation. No live policy uses this API.
import (
	"bytes"
	"crypto/ed25519"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"unicode/utf8"

	"golang.org/x/crypto/ssh"
	"golang.org/x/sys/unix"
)

type ConfigurationIssue struct {
	Component string `json:"component"`
	Code      string `json:"code"`
	Action    string `json:"action"`
}
type ConfigurationObservation struct {
	Version         int                  `json:"version"`
	ReadOnly        bool                 `json:"read_only"`
	Observed        int64                `json:"observed"`
	SHA256          string               `json:"sha256"`
	StructuralValid bool                 `json:"structural_valid"`
	KeyFilesChecked bool                 `json:"key_files_checked"`
	Validated       bool                 `json:"validated"`
	Applied         bool                 `json:"applied"`
	PathsIncluded   bool                 `json:"paths_included"`
	Configuration   Config               `json:"configuration"`
	Issues          []ConfigurationIssue `json:"issues"`
	Note            string               `json:"note"`
}

var errConfigurationObservation = errors.New("configuration unavailable/unsafe or JSON rejected; inspect the selected --config FILE as a protected owner-matched regular file, documented keys and examctl config help; no state or configuration is repaired/applied")

// Pin every parent without following links. O_PATH parent opens do not read
// directory contents; O_NOATIME leaf reads preserve available timestamps.
func configurationFile(path string, private bool, limit int64) ([]byte, error) {
	return readConfigurationFile(path, private, limit, nil)
}

func readConfigurationFile(path string, private bool, limit int64, afterRead func()) ([]byte, error) {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path || path == "/" || strings.ContainsAny(path, "\r\n\x00") {
		return nil, errConfigurationObservation
	}
	parts := strings.Split(strings.TrimPrefix(path, "/"), "/")
	parent, err := unix.Open("/", unix.O_PATH|unix.O_DIRECTORY|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, errConfigurationObservation
	}
	defer func() {
		if parent >= 0 {
			_ = unix.Close(parent)
		}
	}()
	for _, part := range parts[:len(parts)-1] {
		next, e := unix.Openat(parent, part, unix.O_PATH|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
		closeErr := unix.Close(parent)
		parent = -1
		if e != nil || closeErr != nil {
			if next >= 0 {
				_ = unix.Close(next)
			}
			return nil, errConfigurationObservation
		}
		parent = next
	}
	fd, err := unix.Openat(parent, parts[len(parts)-1], unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_NONBLOCK|unix.O_NOATIME|unix.O_CLOEXEC, 0)
	parentClose := unix.Close(parent)
	parent = -1
	if err != nil || parentClose != nil {
		if fd >= 0 {
			_ = unix.Close(fd)
		}
		return nil, errConfigurationObservation
	}
	file := os.NewFile(uintptr(fd), "configuration-component")
	var data []byte
	read := func() error {
		before, e := file.Stat()
		if e != nil || !before.Mode().IsRegular() || before.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) || before.Sys().(*syscall.Stat_t).Nlink != 1 || before.Mode().Perm()&0022 != 0 || (private && before.Mode().Perm()&0077 != 0) || before.Size() < 1 || before.Size() > limit {
			return errConfigurationObservation
		}
		data, e = io.ReadAll(io.LimitReader(file, limit+1))
		if e != nil || int64(len(data)) != before.Size() || int64(len(data)) > limit {
			return errConfigurationObservation
		}
		if afterRead != nil {
			afterRead()
		} // Test-only local checkpoint, never config/environment.
		after, e := file.Stat()
		if e != nil || before.Size() != after.Size() || before.ModTime() != after.ModTime() || before.Sys().(*syscall.Stat_t).Ctim != after.Sys().(*syscall.Stat_t).Ctim || after.Sys().(*syscall.Stat_t).Nlink != 1 || before.Mode() != after.Mode() {
			return errConfigurationObservation
		}
		return nil
	}
	err = read()
	closeErr := file.Close()
	if err != nil || closeErr != nil {
		for i := range data {
			data[i] = 0
		}
		return nil, errConfigurationObservation
	}
	return data, nil
}

func configurationKey(data []byte, kind string) bool {
	switch kind {
	case "callback_ca":
		pool := x509.NewCertPool()
		return pool.AppendCertsFromPEM(data)
	case "handoff_ca":
		key, err := ssh.ParseRawPrivateKey(data)
		if private, ok := key.(ed25519.PrivateKey); ok {
			defer func() {
				for i := range private {
					private[i] = 0
				}
			}()
		}
		if private, ok := key.(*ed25519.PrivateKey); ok {
			defer func() {
				for i := range *private {
					(*private)[i] = 0
				}
			}()
		}
		return err == nil
	default:
		block, _ := pem.Decode(data)
		if block == nil {
			return false
		}
		defer func() {
			for i := range block.Bytes {
				block.Bytes[i] = 0
			}
		}()
		if kind == "gateway_public_key" {
			key, err := x509.ParsePKIXPublicKey(block.Bytes)
			_, ok := key.(ed25519.PublicKey)
			return err == nil && ok
		}
		key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
		private, ok := key.(ed25519.PrivateKey)
		if ok {
			defer func() {
				for i := range private {
					private[i] = 0
				}
			}()
		}
		return err == nil && ok
	}
}

func configurationPolicyIssue(err error) ConfigurationIssue {
	component := "configuration"
	message := err.Error()
	for _, item := range []struct{ prefix, component string }{
		{"configure agent_id", "agent_id/gateway_public_key/callback_key"},
		{"terminal_recording_limit_mib", "terminal_recording_limit_mib"},
		{"home_config_paths", "home_config_paths"}, {"callback_url", "callback_url"},
		{"absolute paths and locally approved accounts", "state/work/rootfs/accounts"},
		{"host_filesystem requires", "host_filesystem/rootfs"}, {"host filesystem exclusion", "host_filesystem_hidden_paths"},
		{"temporary policy", "temporary_account_policy/accounts"}, {"functional test", "functional_test_account/functional_test_until"},
		{"host access requires", "functional_host_access"}, {"exam_directory", "exam_directory"},
		{"duplicate approved UID", "accounts"}, {"unsupported account", "accounts"},
	} {
		if strings.HasPrefix(message, item.prefix) {
			component = item.component
			break
		}
	}
	return ConfigurationIssue{component, "structural-policy", "Review this component's documented native format/ranges and config help; preserve existing values for deliberate staged correction, never bypass account/filesystem restrictions or apply through inspection"}
}

func ObserveNativeConfiguration(path string, keys, paths bool) (ConfigurationObservation, error) {
	var result ConfigurationObservation
	absolute, err := filepath.Abs(path)
	if err != nil {
		return result, errConfigurationObservation
	}
	data, err := configurationFile(absolute, false, 65536)
	if err != nil {
		return result, err
	}
	defer func() {
		for i := range data {
			data[i] = 0
		}
	}()
	if !utf8.Valid(data) || !validReadOnlyJSON(data) {
		return result, errConfigurationObservation
	}
	var object map[string]json.RawMessage
	if json.Unmarshal(data, &object) != nil || object == nil {
		return result, errConfigurationObservation
	}
	var config Config
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&config) != nil || decoder.Decode(new(any)) != io.EOF {
		return result, errConfigurationObservation
	}
	result = ConfigurationObservation{Version: 1, ReadOnly: true, Observed: Millis(), SHA256: Hash(data), PathsIncluded: paths, Configuration: config, Issues: []ConfigurationIssue{}, Note: "Offline selected-file observation only, NOT current SSH/monitoring, permissions/clock/guard/service readiness, work authority or successful configuration apply. No state initialized/reconciled, files repaired or services contacted. Stage and validate a separate candidate; deployment/apply still requires a separately authorized verified drain"}
	if _, err := validateNativeConfig(config, false); err != nil {
		result.Issues = append(result.Issues, configurationPolicyIssue(err))
	} else {
		result.StructuralValid = true
	}
	allPaths := append([]string{config.State, config.Work, config.Rootfs, config.Templates, config.GatewayPublicKey, config.CallbackKey, config.CallbackCA, config.HandoffCA, config.Socket, config.GuardReport, config.ExamDirectory}, config.HostFilesystemHiddenPaths...)
	for _, account := range config.Accounts {
		allPaths = append(allPaths, account.Home)
	}
	for _, path := range allPaths {
		if path != "" && (!filepath.IsAbs(path) || filepath.Clean(path) != path || strings.ContainsAny(path, "\r\n\x00")) {
			result.StructuralValid = false
			result.Issues = append(result.Issues, ConfigurationIssue{"configuration.paths", "unsafe-path-metadata", "Review documented clean absolute path fields; invalid values are not printed and no runtime path is changed"})
			break
		}
	}
	if config.State == "/" || config.Work == "/" || config.Templates == "/" {
		result.StructuralValid = false
		result.Issues = append(result.Issues, ConfigurationIssue{"state/work/templates", "unsafe-private-root", "Private mutable storage/catalog roots must never be the system root; preserve current files and stage a reviewed private-directory configuration. rootfs=/ is a separate supported read-only student filesystem setting"})
	}
	if !result.StructuralValid {
		// Invalid known fields can themselves contain pasted secrets (including
		// URL credentials); never echo such input as a diagnostic snapshot.
		result.Configuration = Config{}
		result.PathsIncluded = false
		return result, nil
	}
	if keys {
		result.KeyFilesChecked = true
		for _, component := range []struct {
			name, path        string
			private, required bool
		}{
			{"gateway_public_key", config.GatewayPublicKey, false, true}, {"callback_key", config.CallbackKey, true, true}, {"callback_ca", config.CallbackCA, false, false}, {"handoff_ca", config.HandoffCA, true, false},
		} {
			if component.path == "" && !component.required {
				continue
			}
			raw, err := configurationFile(component.path, component.private, 65536)
			valid := err == nil && configurationKey(raw, component.name)
			for i := range raw {
				raw[i] = 0
			}
			if !valid {
				result.Issues = append(result.Issues, ConfigurationIssue{component.name, "unsafe-unavailable-or-invalid-key", "Inspect this configured protected key/CA component, owner/mode/type/link and bounded format; preserve it and use the approved rotation/maintenance workflow, never repair/apply through inspection"})
			}
		}
		result.Validated = len(result.Issues) == 0
	}
	// Keys never enter the report. Paths require explicit operator selection;
	// unknown input properties are rejected instead of echoed as generic JSON.
	if !paths {
		redact := func(value string) string {
			if value != "" {
				return "[configured path]"
			}
			return ""
		}
		c := &result.Configuration
		for _, p := range []*string{&c.State, &c.Work, &c.Rootfs, &c.Templates, &c.GatewayPublicKey, &c.CallbackKey, &c.CallbackCA, &c.HandoffCA, &c.Socket, &c.GuardReport, &c.ExamDirectory} {
			*p = redact(*p)
		}
		for i := range c.HostFilesystemHiddenPaths {
			c.HostFilesystemHiddenPaths[i] = redact(c.HostFilesystemHiddenPaths[i])
		}
		for i := range c.HomeConfigPaths {
			c.HomeConfigPaths[i] = redact(c.HomeConfigPaths[i])
		}
		for name, account := range c.Accounts {
			account.Home = redact(account.Home)
			c.Accounts[name] = account
		}
	}
	return result, nil
}
