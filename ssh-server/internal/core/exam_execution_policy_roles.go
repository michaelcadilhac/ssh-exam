package core

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const sourceWorkerPolicyRoleFile = "source-worker-policy-role.json"

type sourceWorkerPolicyRole struct {
	Schema     int    `json:"schema"`
	Capability string `json:"capability"`
	PID        int    `json:"pid"`
	Start      uint64 `json:"start"`
	Boot       string `json:"boot"`
	Device     uint64 `json:"device"`
	Inode      uint64 `json:"inode"`
	SHA256     string `json:"sha256"`
	ConfigHash string `json:"config_hash"`
	Nonce      string `json:"nonce"`
}

type ExecutionPolicySupport struct {
	Schema          int      `json:"schema"`
	Capability      string   `json:"capability"`
	ObservationOnly bool     `json:"observation_only"`
	Supported       bool     `json:"supported"`
	Observed        int64    `json:"observed"`
	Roles           []string `json:"roles"`
	Issues          []string `json:"issues"`
}

func hashSourceWorkerExecutable(pid int) (string, error) {
	f, err := os.Open(fmt.Sprintf("/proc/%d/exe", pid))
	if err != nil {
		return "", err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > 128*1024*1024 {
		return "", errNativeRoles
	}
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// Called by the NEW persistent source coordinator only, after its existing
// worker lock. No new management purpose, credential or listener is introduced.
func PublishSourceWorkerPolicyRole(config Config) (func(), error) {
	if os.Getuid() != 0 || os.Geteuid() != 0 {
		return nil, errNativeRoles
	}
	return publishSourceWorkerPolicyRole(config, 0)
}

func publishSourceWorkerPolicyRole(config Config, uid uint32) (func(), error) {
	info, err := os.Lstat(config.State)
	if err != nil || !info.IsDir() || info.Mode().Perm()&0077 != 0 || info.Sys().(*syscall.Stat_t).Uid != uid {
		return nil, errNativeRoles
	}
	identity, err := snapshotMonitoringProcess(os.Getpid())
	if err != nil || identity.uids != [4]uint32{uid, uid, uid, uid} {
		return nil, errNativeRoles
	}
	digest, err := hashSourceWorkerExecutable(identity.pid)
	if err != nil {
		return nil, err
	}
	configHash, err := nativeConfigurationHash(config)
	if err != nil {
		return nil, err
	}
	value := sourceWorkerPolicyRole{Schema: 1, Capability: ExamExecutionPolicyCapability, PID: identity.pid, Start: identity.start, Boot: identity.boot, Device: identity.device, Inode: identity.inode, SHA256: digest, ConfigHash: configHash, Nonce: Token()}
	data, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	path := filepath.Join(config.State, sourceWorkerPolicyRoleFile)
	if previous, err := os.Lstat(path); err == nil {
		st := previous.Sys().(*syscall.Stat_t)
		if !previous.Mode().IsRegular() || previous.Mode().Perm() != 0600 || st.Uid != uid || st.Nlink != 1 {
			return nil, errNativeRoles
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	temporary, err := os.CreateTemp(config.State, ".source-worker-policy-role-")
	if err != nil {
		return nil, err
	}
	name := temporary.Name()
	defer os.Remove(name)
	if err = temporary.Chmod(0600); err == nil {
		_, err = temporary.Write(data)
	}
	if err == nil {
		err = temporary.Sync()
	}
	closeErr := temporary.Close()
	if err != nil {
		return nil, err
	}
	if closeErr != nil {
		return nil, closeErr
	}
	if err = os.Rename(name, path); err != nil {
		return nil, err
	}
	if err = syncDirectory(config.State); err != nil {
		return nil, err
	}
	return func() {
		current, err := os.ReadFile(path)
		if err == nil && Hash(current) == Hash(data) {
			_ = os.Remove(path)
			_ = syncDirectory(config.State)
		}
	}, nil
}

func probeSourceWorkerPolicyRole(config Config, pid int, expected os.FileInfo, group string, uid uint32) error {
	if expected == nil {
		return errNativeRoles
	}
	identity, err := snapshotMonitoringProcess(pid)
	if err != nil || identity.uids != [4]uint32{uid, uid, uid, uid} {
		return errNativeRoles
	}
	guard, err := pinMonitoringProcess(identity)
	if err != nil {
		return err
	}
	defer guard.close()
	actual, err := os.Stat(fmt.Sprintf("/proc/%d/exe", pid))
	if err != nil || !os.SameFile(actual, expected) {
		return errNativeRoles
	}
	observedGroup, err := monitoringProcBytes(pid, "cgroup", 4096)
	if err != nil || string(observedGroup) != group {
		return errNativeRoles
	}
	root, err := os.OpenRoot(config.State)
	if err != nil {
		return err
	}
	defer root.Close()
	f, err := root.OpenFile(sourceWorkerPolicyRoleFile, os.O_RDONLY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || info.Size() > 8192 || info.Sys().(*syscall.Stat_t).Uid != uid || info.Sys().(*syscall.Stat_t).Nlink != 1 {
		return errNativeRoles
	}
	data, err := io.ReadAll(io.LimitReader(f, 8193))
	if err != nil || len(data) > 8192 {
		return errNativeRoles
	}
	var value sourceWorkerPolicyRole
	if _, err := decodeMonitoringObject(data, &value, []string{"schema", "capability", "pid", "start", "boot", "device", "inode", "sha256", "config_hash", "nonce"}); err != nil {
		return errNativeRoles
	}
	configHash, err := nativeConfigurationHash(config)
	if err != nil || value.Schema != 1 || value.Capability != ExamExecutionPolicyCapability || value.PID != pid || value.Start != identity.start || value.Boot != identity.boot || value.Device != identity.device || value.Inode != identity.inode || value.ConfigHash != configHash || !monitoringDigest.MatchString(value.Nonce) || !monitoringDigest.MatchString(value.SHA256) {
		return errNativeRoles
	}
	digest, err := hashSourceWorkerExecutable(pid)
	if err != nil || digest != value.SHA256 {
		return errNativeRoles
	}
	after, err := snapshotMonitoringProcess(pid)
	if err != nil || after != identity || !guard.current() {
		return errNativeRoles
	}
	return nil
}

func (e *Engine) observeExecutionPolicySupport(roles NativeRoleObservation) ExecutionPolicySupport {
	result := ExecutionPolicySupport{Schema: 1, Capability: ExamExecutionPolicyCapability, ObservationOnly: true, Observed: Millis(), Roles: []string{}, Issues: []string{}}
	if e.Config.CallbackURL == "" || e.Config.CallbackKey == "" || e.Config.GatewayPublicKey == "" || !identifier.MatchString(e.Config.AgentID) {
		result.Issues = append(result.Issues, "Authenticated outbound execution-policy configuration is unavailable; configure and qualify matching roles before changing exam-wide limits")
		return result
	}
	if !roles.Complete {
		result.Issues = append(result.Issues, "Matching live agent/watchdog support is unavailable")
		return result
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	data, err := exec.CommandContext(ctx, "/usr/bin/systemctl", "show", "exam-source-setup.service", "--property=MainPID", "--value").Output()
	pid, parseErr := strconv.Atoi(strings.TrimSpace(string(data)))
	expected, statErr := os.Lstat("/usr/local/sbin/examctl")
	if err != nil || parseErr != nil || pid <= 1 || statErr != nil || !expected.Mode().IsRegular() || expected.Mode().Perm()&0022 != 0 || expected.Sys().(*syscall.Stat_t).Uid != 0 {
		result.Issues = append(result.Issues, "Current loaded source-worker support is unavailable; inspect its service before a drained matched release")
		return result
	}
	if err := probeSourceWorkerPolicyRole(e.Config, pid, expected, "0::/system.slice/exam-source-setup.service\n", 0); err != nil {
		result.Issues = append(result.Issues, "Loaded source-worker lacks matching archive-policy support; preserve work and install matching roles only in an authorized drained release")
		return result
	}
	result.Supported, result.Roles = true, []string{"agent", "watchdog", "source-worker"}
	result.Observed = Millis()
	return result
}
