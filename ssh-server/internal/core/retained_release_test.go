package core

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Capture the linked release default before desktop fixtures install explicit
// legacy admission. Those fixtures exercise existing historical behavior; the
// current-release supervisor scenario below uses this unmodified default.
var qualifiedReleaseReadiness = terminalAuthorityReadiness

func init() {
	terminalAuthorityReadiness = func() error {
		return errors.New("synthetic legacy admission fixture; monitored admission disabled")
	}
}

// Exact Unix protocol boundary, with real peer credentials/executable/cgroup and
// bounded mock replies. Full installed-root roles are qualified in the guest.
func TestQualifiedNativeRoleRefusesOlderAndUnqualifiedCohorts(t *testing.T) {
	previous := terminalAuthorityReadiness
	terminalAuthorityReadiness = func() error { return nil }
	t.Cleanup(func() { terminalAuthorityReadiness = previous })
	exe, err := os.Stat("/proc/self/exe")
	if err != nil {
		t.Fatal(err)
	}
	group, err := os.ReadFile("/proc/self/cgroup")
	if err != nil {
		t.Fatal(err)
	}
	hash := strings.Repeat("a", 64)
	for _, mode := range []string{"qualified", "unqualified", "older", "missing-capability"} {
		t.Run(mode, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "role.sock")
			listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: path, Net: "unix"})
			if err != nil {
				t.Fatal(err)
			}
			defer listener.Close()
			if err := listener.SetDeadline(time.Now().Add(time.Second)); err != nil {
				t.Fatal(err)
			}
			done := make(chan error, 1)
			go func() {
				c, err := listener.AcceptUnix()
				if err != nil {
					done <- err
					return
				}
				defer c.Close()
				if err := c.SetDeadline(time.Now().Add(600 * time.Millisecond)); err != nil {
					done <- err
					return
				}
				data, err := bufio.NewReaderSize(c, 4097).ReadSlice('\n')
				var request struct {
					Nonce string `json:"native_role_nonce"`
				}
				if err != nil || json.Unmarshal(data, &request) != nil || !monitoringDigest.MatchString(request.Nonce) {
					done <- fmt.Errorf("fixture missed fresh complete role request: %v", err)
					return
				}
				reply := map[string]any{"purpose": "native-loaded-role/v2", "role": "watchdog", "nonce": request.Nonce,
					"boot": boot(), "config_hash": hash, "retained_enabled": true}
				switch mode {
				case "unqualified":
					reply["retained_enabled"] = false
				case "older":
					reply["purpose"] = "native-loaded-role/v1"
					delete(reply, "retained_enabled")
				case "missing-capability":
					delete(reply, "retained_enabled")
				}
				done <- json.NewEncoder(c).Encode(reply)
			}()
			ctx, cancel := context.WithTimeout(context.Background(), 800*time.Millisecond)
			defer cancel()
			guard, err := probeNativeRole(ctx, path, "watchdog", string(group), hash, exe, os.Getuid())
			if guard != nil {
				defer guard.close()
			}
			if mode == "qualified" {
				if err != nil || guard == nil || !guard.current() {
					t.Errorf("qualified current release peer refused: %v", err)
				}
			} else if err == nil || guard != nil || ctx.Err() != nil {
				t.Errorf("older/unqualified cohort missed exact reply refusal: %v / %v", err, ctx.Err())
			}
			select {
			case err := <-done:
				if err != nil {
					t.Fatal(err)
				}
			case <-time.After(time.Second):
				t.Fatal("owned role responder did not finish")
			}
		})
	}
}
