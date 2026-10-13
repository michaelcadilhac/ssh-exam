package core

import (
	"context"
	"fmt"
	"net"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Test-only process entry used as a ForceCommand by a disposable unprivileged sshd.
// Production uses the static account login shell, never this environment-selected helper.
func TestSSHGateHelper(t *testing.T) {
	if os.Getenv("EXAM_GATE_TEST_HELPER") != "1" {
		return
	}
	os.Args = []string{os.Args[0], "-c", "exam-dispatch"}
	if err := Gate(os.Getenv("EXAM_GATE_TEST_SOCKET")); err != nil {
		fmt.Fprintln(os.Stderr, "EXAM-ERROR: access denied by exam guard")
		os.Exit(1)
	}
	os.Exit(0)
}
func TestRealOpenSSHOrdinaryRoutesAndRetainedTransport(t *testing.T) {
	sshd, err := exec.LookPath("sshd")
	if err != nil {
		t.Skip("OpenSSH server not installed")
	}
	ssh, err := exec.LookPath("ssh")
	if err != nil {
		t.Skip("OpenSSH client not installed")
	}
	keygen, err := exec.LookPath("ssh-keygen")
	if err != nil {
		t.Skip("ssh-keygen not installed")
	}
	current, err := user.Current()
	if err != nil {
		t.Fatal(err)
	}
	e, _, source := finalFixture(t, "ACTIVE", Millis()+5400000)
	e.Config.Accounts = map[string]Account{current.Username: {UID: os.Getuid(), Shell: "/bin/bash", Home: t.TempDir()}}
	e.WithState(func() error {
		a := e.state.Attempts[finalID]
		a.UID = os.Getuid()
		a.Username = current.Username
		return nil
	})
	socket := gateTestListener(t, e)
	dir := t.TempDir()
	for _, name := range []string{"host", "client"} {
		if output, err := exec.Command(keygen, "-q", "-t", "ed25519", "-N", "", "-f", filepath.Join(dir, name)).CombinedOutput(); err != nil {
			t.Fatalf("key generation: %v %s", err, output)
		}
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	listener.Close()
	executable, _ := os.Executable()
	config := fmt.Sprintf("Port %d\nListenAddress 127.0.0.1\nHostKey %s/host\nPidFile %s/pid\nAuthorizedKeysFile %s/client.pub\nStrictModes no\nUsePAM no\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nPubkeyAuthentication yes\nPermitUserRC no\nDisableForwarding yes\nAllowUsers %s\nForceCommand /usr/bin/env EXAM_GATE_TEST_HELPER=1 EXAM_GATE_TEST_SOCKET=%s %s -test.run=^TestSSHGateHelper$\nSubsystem sftp /usr/lib/openssh/sftp-server\n", port, dir, dir, dir, current.Username, socket, executable)
	configPath := filepath.Join(dir, "sshd_config")
	os.WriteFile(configPath, []byte(config), 0600)
	log, err := os.Create(filepath.Join(dir, "sshd.log"))
	if err != nil {
		t.Fatal(err)
	}
	defer log.Close()
	daemon := exec.Command(sshd, "-D", "-e", "-f", configPath)
	daemon.Stdout = log
	daemon.Stderr = log
	if err = daemon.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { daemon.Process.Kill(); daemon.Wait() })
	for i := 0; i < 100; i++ {
		c, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 50*time.Millisecond)
		if err == nil {
			c.Close()
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	control := filepath.Join(dir, "master")
	args := []string{"-F", "/dev/null", "-p", fmt.Sprint(port), "-i", filepath.Join(dir, "client"), "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=" + filepath.Join(dir, "known_hosts"), "-o", "BatchMode=yes", "-o", "ConnectTimeout=3"}
	target := current.Username + "@127.0.0.1"
	run := func(extra ...string) ([]byte, error) {
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		return exec.CommandContext(ctx, ssh, append(append([]string{}, args...), extra...)...).CombinedOutput()
	}
	if output, err := run("-M", "-N", "-f", "-S", control, target); err != nil {
		b, _ := os.ReadFile(filepath.Join(dir, "sshd.log"))
		t.Fatalf("pre-existing SSH transport: %v %s %s", err, output, b)
	}
	t.Cleanup(func() { run("-S", control, "-O", "exit", target) })
	if _, err = e.Call("finalize-attempt", Request{ID: finalID, Reason: "student finish"}); err != nil {
		t.Fatal(err)
	}
	original, _ := os.ReadFile(filepath.Join(source, "answer.txt"))
	for _, route := range []struct {
		name string
		args []string
	}{
		{"direct-command", []string{target, "echo BYPASS > " + filepath.Join(source, "answer.txt")}},
		{"shell", []string{"-T", target}},
		{"sftp", []string{"-s", target, "sftp"}},
		{"scp-protocol", []string{target, "scp -t " + source}},
		{"retained-multiplex-channel", []string{"-S", control, target, "echo BYPASS > " + filepath.Join(source, "answer.txt")}},
		{"forged-exam-environment", []string{"-o", "SetEnv=EXAM_ID=exam EXAM_ATTEMPT_ID=" + finalID, target, "echo BYPASS > " + filepath.Join(source, "answer.txt")}},
	} {
		t.Run(route.name, func(t *testing.T) {
			beforeAudit, _ := os.ReadFile(filepath.Join(e.Config.State, "audit.ndjson"))
			output, err := run(route.args...)
			afterAudit, _ := os.ReadFile(filepath.Join(e.Config.State, "audit.ndjson"))
			if err == nil || len(afterAudit) <= len(beforeAudit) || (route.name != "sftp" && !strings.Contains(string(output), "EXAM-ERROR")) {
				t.Fatalf("route did not reach rejecting gate: %v %s", err, output)
			}
			after, _ := os.ReadFile(filepath.Join(source, "answer.txt"))
			if string(after) != string(original) {
				t.Fatal("working tree modified after early finish")
			}
		})
	}
}
