package core

import (
	"bytes"
	"context"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
)

type releaseSSHLog struct {
	sync.Mutex
	buffer bytes.Buffer
}

func (b *releaseSSHLog) Write(p []byte) (int, error) {
	b.Lock()
	defer b.Unlock()
	return b.buffer.Write(p)
}
func (b *releaseSSHLog) String() string { b.Lock(); defer b.Unlock(); return b.buffer.String() }

// Root opt-in qualification. Only a fresh local account, a loopback sshd and
// temporary fixture state are touched; no real student's account/agent is used.
func TestDeniedIdleSSHRestorationWithRealOpenSSH(t *testing.T) {
	if os.Getenv("EXAM_RELEASE_SSH_TEST") != "1" {
		t.Skip("set EXAM_RELEASE_SSH_TEST=1 as root for real SSH release qualification")
	}
	if os.Geteuid() != 0 {
		t.Fatal("root qualification required")
	}
	const uid = 29980
	if exec.Command("getent", "passwd", fmt.Sprint(uid)).Run() == nil {
		t.Fatal("qualification UID already assigned")
	}
	name := fmt.Sprintf("exrel%d", os.Getpid())
	if exec.Command("getent", "passwd", name).Run() == nil {
		t.Fatal("qualification account already exists")
	}
	stage, err := os.MkdirTemp("/tmp", "exam-release-ssh-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(stage) })
	os.Chmod(stage, 0755)
	if out, err := exec.Command("useradd", "-u", fmt.Sprint(uid), "-U", "-M", "-d", stage, "-s", "/bin/sh", "-p", "NP", name).CombinedOutput(); err != nil {
		t.Fatalf("create disposable account: %v %s", err, out)
	}
	t.Cleanup(func() {
		exec.Command("pkill", "-KILL", "-u", fmt.Sprint(uid)).Run()
		if out, err := exec.Command("userdel", name).CombinedOutput(); err != nil {
			t.Errorf("remove disposable account: %v %s", err, out)
		}
	})
	out, err := exec.Command("id", "-g", name).Output()
	if err != nil {
		t.Fatal(err)
	}
	gid, err := strconv.Atoi(strings.TrimSpace(string(out)))
	if err != nil {
		t.Fatal(err)
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	binary, err := os.ReadFile(executable)
	if err != nil {
		t.Fatal(err)
	}
	helper := filepath.Join(stage, "gate-helper")
	if err := os.WriteFile(helper, binary, 0755); err != nil {
		t.Fatal(err)
	}
	e, c, source := finalFixture(t, "ACTIVE", Millis()+60000)
	accounts := map[string]Account{name: {UID: uid, GID: gid, Shell: "/bin/sh", Home: stage}}
	e.Config.Accounts = accounts
	c.Accounts = accounts
	socket := filepath.Join(stage, "gate.sock")
	listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: socket, Net: "unix"})
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	os.Chmod(socket, 0666)
	go func() {
		for {
			conn, err := listener.AcceptUnix()
			if err != nil {
				return
			}
			go e.local(conn)
		}
	}()
	for _, key := range []string{"host", "client"} {
		if out, err := exec.Command("ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", filepath.Join(stage, key)).CombinedOutput(); err != nil {
			t.Fatalf("fixture keys: %v %s", err, out)
		}
	}
	portListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := portListener.Addr().(*net.TCPAddr).Port
	portListener.Close()
	conf := fmt.Sprintf("Port %d\nListenAddress 127.0.0.1\nHostKey %s/host\nPidFile %s/pid\nAuthorizedKeysFile %s/client.pub\nStrictModes no\nUsePAM no\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nPubkeyAuthentication yes\nPermitUserRC no\nDisableForwarding yes\nAllowUsers %s\nForceCommand /usr/bin/env EXAM_GATE_TEST_HELPER=1 EXAM_GATE_TEST_SOCKET=%s %s -test.run=^TestSSHGateHelper$\nSubsystem sftp /usr/lib/openssh/sftp-server\n", port, stage, stage, stage, name, socket, helper)
	confPath := filepath.Join(stage, "sshd_config")
	os.WriteFile(confPath, []byte(conf), 0600)
	var daemonLog releaseSSHLog
	daemon := exec.Command("/usr/sbin/sshd", "-D", "-e", "-f", confPath)
	daemon.Stdout = &daemonLog
	daemon.Stderr = &daemonLog
	if err := daemon.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { daemon.Process.Kill(); daemon.Wait() })
	for i := 0; i < 100; i++ {
		conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 50*time.Millisecond)
		if err == nil {
			conn.Close()
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	args := []string{"-F", "/dev/null", "-p", fmt.Sprint(port), "-i", filepath.Join(stage, "client"), "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=" + filepath.Join(stage, "known_hosts"), "-o", "BatchMode=yes", "-o", "ConnectTimeout=3"}
	target := name + "@127.0.0.1"
	control := filepath.Join(stage, "master")
	run := func(extra ...string) ([]byte, error) {
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		return exec.CommandContext(ctx, "ssh", append(append([]string{}, args...), extra...)...).CombinedOutput()
	}
	if out, err := run("-M", "-N", "-f", "-S", control, target); err != nil {
		t.Fatalf("SSH transport: %v %s %s", err, out, daemonLog.String())
	}
	t.Cleanup(func() { run("-S", control, "-O", "exit", target) })
	deadline := Millis() + 8000
	if err := e.WithState(func() error {
		a := e.state.Attempts[finalID]
		a.Username = name
		a.UID = uid
		a.Start = deadline - 300000
		a.Deadline = deadline
		a.OriginalDeadline = deadline
		a.UptimeDeadline = uptime() + 8
		a.OriginalUptimeDeadline = a.UptimeDeadline
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Call("finalize-attempt", Request{ID: finalID, Reason: "student finish"}); err != nil {
		t.Fatal(err)
	}
	checksum := inspectFinal(t, e).Checksum
	for _, route := range [][]string{{"-S", control, target, "echo BYPASS"}, {"-S", control, "-T", target}, {"-S", control, "-s", target, "sftp"}, {"-S", control, target, "scp -t /tmp"}} {
		if out, err := run(route...); err == nil {
			t.Fatalf("ordinary channel bypassed early-finish hold: %s", out)
		}
	}
	var sshPID int
	if err := e.WithState(func() error {
		a := e.state.Attempts[finalID]
		if a.AccessState != "HELD" || !a.Protected || a.OriginalDeadline != deadline {
			t.Fatal("early finish changed hold/deadline")
		}
		if len(a.DeniedSSHTransports) != 1 {
			t.Fatalf("missing/repeated denied-transport proof: %+v", a.DeniedSSHTransports)
		}
		entries, _ := os.ReadDir("/proc")
		for _, entry := range entries {
			pid, _ := strconv.Atoi(entry.Name())
			if e.idleDeniedSSH(a, pid) {
				sshPID = pid
				break
			}
		}
		if sshPID == 0 {
			t.Fatal("real denied idle SSH daemon not recognized")
		}
		if err := e.verifyWriters(a); err == nil {
			t.Fatal("collection incorrectly used restoration exemption")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	writerPath := filepath.Join(stage, "writer.log")
	os.WriteFile(writerPath, nil, 0600)
	os.Chown(writerPath, uid, gid)
	writer := exec.Command("/usr/bin/python3", "-c", "import sys,time\nf=open(sys.argv[1],'a')\nwhile True:\n f.write('writer\\n'); f.flush(); time.sleep(.01)", writerPath)
	writer.SysProcAttr = &syscall.SysProcAttr{Setpgid: true, Credential: &syscall.Credential{Uid: uint32(uid), Gid: uint32(gid)}}
	if err := writer.Start(); err != nil {
		t.Fatal(err)
	}
	stopped := false
	stopWriter := func() {
		if !stopped {
			syscall.Kill(-writer.Process.Pid, syscall.SIGKILL)
			writer.Wait()
			stopped = true
		}
	}
	defer stopWriter()
	for i := 0; i < 100; i++ {
		info, _ := os.Stat(writerPath)
		if info != nil && info.Size() > 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	info, _ := os.Stat(writerPath)
	if info == nil || info.Size() == 0 {
		t.Fatal("background writer did not actually run")
	}
	time.Sleep(time.Until(time.UnixMilli(deadline)) + 100*time.Millisecond)
	second, err := New(c)
	if err != nil {
		t.Fatal(err)
	}
	a := inspectFinal(t, second)
	if a.AccessState != "HELD" || !strings.Contains(a.AccessError, "account restoration blocked") || strings.Contains(a.AccessError, "collection refused") {
		t.Fatalf("writer did not block restoration: %+v", a)
	}
	if len(a.DeniedSSHTransports) != 1 {
		t.Fatal("restart lost denial proof")
	}
	stopWriter()
	for i := 0; i < 100; i++ {
		a = inspectFinal(t, second)
		if a.AccessState == "RELEASED" {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if a.AccessState != "RELEASED" || a.AccessError != "" || a.Checksum != checksum {
		t.Fatalf("idle SSH still blocked restoration: %+v", a)
	}
	if err := syscall.Kill(sshPID, 0); err != nil {
		t.Fatal("test only passed because idle SSH exited")
	}
	if _, err := ReadProtected(filepath.Join(c.State, "submissions", finalID), a); err != nil {
		t.Fatal(err)
	}
	if data, err := os.ReadFile(filepath.Join(source, "answer.txt")); err != nil || string(data) != "saved answer" {
		t.Fatal("submission source changed")
	}
	t.Log("PASS: original deadline hold; denied shell/command/SFTP/SCP; strict collection; live writer blocks after restart; same idle SSH survives successful restoration; protected checksum unchanged")
}
