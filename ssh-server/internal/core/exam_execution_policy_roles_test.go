package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestExecutionPolicySupportRequiresAuthenticatedOutboundConfiguration(t *testing.T) {
	for _, absent := range []string{"url", "signing-key", "gateway-key", "agent"} {
		t.Run(absent, func(t *testing.T) {
			c := Config{AgentID: "class", CallbackURL: "https://web.invalid", CallbackKey: "/private/agent.key", GatewayPublicKey: "/private/gateway.pub"}
			switch absent {
			case "url":
				c.CallbackURL = ""
			case "signing-key":
				c.CallbackKey = ""
			case "gateway-key":
				c.GatewayPublicKey = ""
			case "agent":
				c.AgentID = ""
			}
			support := (&Engine{Config: c}).observeExecutionPolicySupport(NativeRoleObservation{Complete: true})
			if support.Supported || support.Roles == nil || support.Issues == nil || len(support.Issues) == 0 || !strings.Contains(support.Issues[0], "outbound") {
				t.Fatal("unconfigured legacy fallback advertised live policy support", support)
			}
		})
	}
}

func TestExecutionPolicySourceRoleBindsActualLoadedProcessAndConfig(t *testing.T) {
	c := Config{State: t.TempDir(), AgentID: "class"}
	if err := os.Chmod(c.State, 0700); err != nil {
		t.Fatal(err)
	}
	exe, err := os.Stat("/proc/self/exe")
	if err != nil {
		t.Fatal(err)
	}
	group, err := os.ReadFile("/proc/self/cgroup")
	if err != nil {
		t.Fatal(err)
	}
	uid := uint32(os.Getuid())
	stop, err := publishSourceWorkerPolicyRole(c, uid)
	if err != nil {
		info, _ := os.Stat(c.State)
		identity, identityErr := snapshotMonitoringProcess(os.Getpid())
		t.Fatal("current source coordinator could not publish private loaded-role evidence", err, info.Mode(), identity, identityErr)
	}
	defer stop()
	probe := func(config Config) error {
		return probeSourceWorkerPolicyRole(config, os.Getpid(), exe, string(group), uid)
	}
	if err := probe(c); err != nil {
		t.Fatal("healthy real /proc process/loaded executable receipt was refused", err)
	}
	path := filepath.Join(c.State, sourceWorkerPolicyRoleFile)
	original, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var valid sourceWorkerPolicyRole
	if json.Unmarshal(original, &valid) != nil {
		t.Fatal("invalid published role")
	}
	for _, mode := range []string{"old-build", "pid", "start", "boot", "inode", "digest", "config", "nonce", "extra", "duplicate", "mode", "symlink"} {
		t.Run(mode, func(t *testing.T) {
			value := valid
			switch mode {
			case "old-build":
				value.Capability = "older-source-worker"
			case "pid":
				value.PID++
			case "start":
				value.Start++
			case "boot":
				value.Boot = "other-boot"
			case "inode":
				value.Inode++
			case "digest":
				value.SHA256 = strings.Repeat("0", 64)
			case "config":
				value.ConfigHash = strings.Repeat("1", 64)
			case "nonce":
				value.Nonce = ""
			}
			data, _ := json.Marshal(value)
			if mode == "extra" {
				data = append(data[:len(data)-1], []byte(`,"other":true}`)...)
			}
			if mode == "duplicate" {
				data = append(data[:len(data)-1], []byte(`,"schema":1}`)...)
			}
			if err := os.WriteFile(path, data, 0600); err != nil {
				t.Fatal(err)
			}
			if mode == "mode" {
				if err := os.Chmod(path, 0644); err != nil {
					t.Fatal(err)
				}
			}
			if mode == "symlink" {
				if err := os.Remove(path); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink("missing", path); err != nil {
					t.Fatal(err)
				}
			}
			if err := probe(c); err == nil {
				t.Fatal("stale/untrusted loaded-role receipt accepted", mode)
			}
			_ = os.Remove(path)
			if err := os.WriteFile(path, original, 0600); err != nil {
				t.Fatal(err)
			}
		})
	}
	changed := c
	changed.Work = "/different-work-root"
	if err := probe(changed); err == nil {
		t.Fatal("different configured archive reader was accepted")
	}
	if err := probeSourceWorkerPolicyRole(c, os.Getpid(), exe, "different-cgroup", uid); err == nil {
		t.Fatal("different service cgroup was accepted")
	}
	otherExe, err := os.Stat("/bin/sh")
	if err != nil {
		t.Fatal(err)
	}
	if err := probeSourceWorkerPolicyRole(c, os.Getpid(), otherExe, string(group), uid); err == nil {
		t.Fatal("installed executable mismatch did not refuse older loaded process")
	}
	// A retiring coordinator must not unlink a replacement's role receipt.
	newStop, err := publishSourceWorkerPolicyRole(c, uid)
	if err != nil {
		t.Fatal(err)
	}
	stop()
	if err := probe(c); err != nil {
		t.Fatal("old coordinator cleanup removed replacement receipt", err)
	}
	newStop()
	if err := probe(c); err == nil {
		t.Fatal("missing/old source worker was advertised as supporting archive policy")
	}
}
