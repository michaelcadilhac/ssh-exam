package core

// Test-only real SSH/SO_PEERCRED -> Engine.local regression. Never run against
// installed host services/accounts; the wrapper's exact private guest is required.
import (
	"bufio"
	"bytes"
	"context"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestPaneAcknowledgementSSHHelper(t *testing.T) {
	if os.Getenv("EXAM_PANE_ACK_SSH_HELPER") != "1" {
		return
	}
	// This test-only executable is the root-configured ForceCommand of the
	// separate fixture sshd. Production exam-login has no such environment hook.
	account, err := user.Lookup("examq")
	container, containerErr := os.ReadFile("/run/systemd/container")
	if err != nil || containerErr != nil || strings.TrimSpace(string(container)) != "systemd-nspawn" || account.Uid != strconv.Itoa(os.Getuid()) || os.Getuid() < 1000 || os.Getuid() != os.Geteuid() {
		os.Exit(77)
	}
	socket := os.Getenv("EXAM_PANE_ACK_SOCKET")
	if !strings.HasPrefix(socket, "/var/lib/qualification-pane-ack-") || filepath.Base(socket) != "gate.sock" {
		os.Exit(77)
	}
	if command := os.Getenv("SSH_ORIGINAL_COMMAND"); command == "exam-control" || command == "exam-gateway" {
		os.Args = []string{os.Args[0], "-c", command}
		if err := Gate(socket); err != nil {
			os.Exit(1)
		}
		os.Exit(0)
	}
	if os.Getenv("SSH_ORIGINAL_COMMAND") != "pane-ack" {
		os.Exit(77)
	}
	restore, err := rawTerminal(0)
	if err != nil {
		os.Exit(1)
	}
	defer restore()
	input := bufio.NewReaderSize(os.Stdin, 4096)
	line, err := input.ReadSlice('\n')
	var request LocalRequest
	if err != nil || json.Unmarshal(line, &request) != nil || len(request.Token) != 64 || request.Command != nil || request.Ordinary {
		os.Exit(1)
	}
	connection, err := net.DialUnix("unix", nil, &net.UnixAddr{Name: socket, Net: "unix"})
	if err != nil {
		os.Exit(1)
	}
	defer connection.Close()
	_ = connection.SetDeadline(time.Now().Add(10 * time.Second))
	data, _ := json.Marshal(request)
	if _, _, err := connection.WriteMsgUnix(data, syscall.UnixRights(0), nil); err != nil {
		os.Exit(1)
	}
	reader := bufio.NewReaderSize(connection, 65536)
	ready, err := reader.ReadSlice('\n')
	var response struct {
		Attempt string `json:"attempt"`
		Error   string `json:"error"`
	}
	if err != nil || json.Unmarshal(ready, &response) != nil || !attemptID.MatchString(response.Attempt) || response.Error != "" {
		os.Exit(1)
	}
	fmt.Println("PANE-ACK-PENDING")
	ack, err := input.ReadSlice('\n')
	if err != nil || string(ack) != "ACK\n" {
		os.Exit(1)
	}
	if _, err := connection.Write([]byte{1}); err != nil {
		os.Exit(1)
	}
	denial, err := reader.ReadSlice('\n')
	if err != nil || json.Unmarshal(denial, &response) != nil || response.Error == "" {
		os.Exit(1)
	}
	fmt.Println("PANE-ACK-DENIED")
	restore()
	os.Exit(0)
}

func TestPaneAcknowledgementGuest(t *testing.T) {
	uid := requireMonitoringGuest(t, "pane-ack", "EXAM_PANE_ACK_GUEST")
	account, err := user.Lookup("examq")
	if err != nil {
		t.Fatal(err)
	}
	gid, err := strconv.Atoi(account.Gid)
	if err != nil || gid < 1000 || account.HomeDir != "/home/examq" {
		t.Fatal("exact synthetic account unavailable", err)
	}
	dir, err := os.MkdirTemp("/var/lib", "qualification-pane-ack-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) }) // Exact newly owned guest fixture only.
	if err := os.Chmod(dir, 0755); err != nil {
		t.Fatal(err)
	}
	probe, err := os.ReadFile("/run/ssh-exam-qualification-input/core-qualification.test")
	if err != nil || len(probe) > 64*1024*1024 {
		t.Fatal("manifested test executable unavailable", err)
	}
	helper := filepath.Join(dir, "probe")
	if err := os.WriteFile(helper, probe, 0755); err != nil {
		t.Fatal(err)
	}
	// Preserve the fixture's real normal-root masks/guards. Its private state
	// cannot live under a required /tmp mount destination: do not weaken the
	// production exclusion validator merely to make this test fixture pass.
	config, err := LoadConfig("/etc/exam-agent/agent.json")
	if err != nil || !config.HostFilesystem || config.Rootfs != "/" {
		t.Fatal("normal filesystem fixture unavailable", err)
	}
	private, err := os.MkdirTemp("/var/lib", "qualification-pane-state-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(private) }) // Exact fresh guest-only state.
	config.State, config.Work, config.Socket = filepath.Join(private, "state"), filepath.Join(private, "work"), filepath.Join(dir, "gate.sock")
	config.HostFilesystemHiddenPaths = append(config.HostFilesystemHiddenPaths, dir)
	config.CallbackURL, config.CallbackKey = "", ""
	if err := os.Mkdir(config.Work, 0700); err != nil {
		t.Fatal(err)
	}
	engine, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	key := commandKeys(t, engine)
	engine.Config.Accounts = map[string]Account{"examq": {UID: uid, GID: gid, Home: account.HomeDir, Shell: "/bin/bash"}}
	listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: config.Socket, Net: "unix"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	if err := os.Chmod(config.Socket, 0666); err != nil {
		t.Fatal(err)
	}
	go func() {
		for {
			c, err := listener.AcceptUnix()
			if err != nil {
				return
			}
			go engine.local(c)
		}
	}()
	for _, name := range []string{"host", "client"} {
		if output, err := exec.Command("/usr/bin/ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", filepath.Join(dir, name)).CombinedOutput(); err != nil {
			t.Fatal("private fixture key generation", err, string(output))
		}
	}
	portListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := portListener.Addr().(*net.TCPAddr).Port
	_ = portListener.Close()
	public, err := os.ReadFile(filepath.Join(dir, "host.pub"))
	fields := strings.Fields(string(public))
	if err != nil || len(fields) != 3 {
		t.Fatal("private fixture host key unavailable", err)
	}
	known := filepath.Join(dir, "known-hosts")
	if err := os.WriteFile(known, []byte(fmt.Sprintf("[127.0.0.1]:%d %s %s\n", port, fields[0], fields[1])), 0600); err != nil {
		t.Fatal(err)
	}
	text := fmt.Sprintf("Port %d\nListenAddress 127.0.0.1\nHostKey %s/host\nPidFile %s/pid\nAuthorizedKeysFile %s/client.pub\nStrictModes yes\nUsePAM no\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nPubkeyAuthentication yes\nPermitUserRC no\nDisableForwarding yes\nAllowUsers examq\nForceCommand /usr/bin/env EXAM_PANE_ACK_SSH_HELPER=1 EXAM_PANE_ACK_SOCKET=%s %s -test.run=^TestPaneAcknowledgementSSHHelper$\n", port, dir, dir, dir, config.Socket, helper)
	conf := filepath.Join(dir, "sshd_config")
	if err := os.WriteFile(conf, []byte(text), 0600); err != nil {
		t.Fatal(err)
	}
	var daemonLog releaseSSHLog
	daemon := exec.Command("/usr/sbin/sshd", "-D", "-e", "-f", conf)
	daemon.Stdout, daemon.Stderr = &daemonLog, &daemonLog
	if err := daemon.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = daemon.Process.Kill(); _ = daemon.Wait() })
	untilReady := time.Now().Add(5 * time.Second)
	for {
		connection, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 50*time.Millisecond)
		if err == nil {
			_ = connection.Close()
			break
		}
		if time.Now().After(untilReady) {
			t.Fatal("private SSH listener unavailable", daemonLog.String())
		}
		time.Sleep(20 * time.Millisecond)
	}
	control := filepath.Join(dir, "master")
	args := []string{"-F", "/dev/null", "-p", strconv.Itoa(port), "-i", filepath.Join(dir, "client"), "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=yes", "-o", "UserKnownHostsFile=" + known, "-o", "BatchMode=yes", "-o", "ConnectTimeout=3", "-o", "LogLevel=ERROR", "-S", control}
	master := exec.Command("/usr/bin/ssh", append(append([]string{}, args...), "-M", "-N", "examq@127.0.0.1")...)
	master.Stdout, master.Stderr = io.Discard, &daemonLog
	if err := master.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = master.Process.Kill(); _ = master.Wait() })
	until := time.Now().Add(5 * time.Second)
	for {
		if info, err := os.Lstat(control); err == nil && info.Mode()&os.ModeSocket != 0 {
			break
		}
		if time.Now().After(until) {
			t.Fatal("private SSH did not authenticate", daemonLog.String())
		}
		time.Sleep(20 * time.Millisecond)
	}
	transport := ""
	command := func(op string, body Request) any {
		t.Helper()
		cmd := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Username: "examq", Transport: transport, Op: op, Body: body}
		frame, _ := json.Marshal(signedCommand(key, cmd))
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		ssh := exec.CommandContext(ctx, "/usr/bin/ssh", append(append([]string{}, args...), "examq@127.0.0.1", "exam-control")...)
		ssh.Stdin = bytes.NewReader(append(frame, '\n'))
		out, err := ssh.Output()
		var response struct {
			Result any    `json:"result"`
			Error  string `json:"error"`
		}
		if err != nil || json.Unmarshal(out, &response) != nil || response.Error != "" {
			t.Fatal("actual signed SSH command failed/blocked", op, err, string(out), daemonLog.String())
		}
		return response.Result
	}
	transport = command("register", Request{Exam: "qualification"}).(map[string]any)["transport"].(string)
	id := ManagementID()
	if err := engine.WithState(func() error {
		a := &Attempt{ID: id, Exam: "qualification", Username: "examq", UID: uid, Transport: transport, State: "PREPARING", PreflightStartedAt: Millis(), WorkPath: "/work", Settings: Settings{Duration: 60, Terminals: 4, Template: "qualification"}}
		if err := engine.prepareHome(a); err != nil {
			return err
		}
		engine.state.Attempts[id] = a
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	// Exercise actual authenticated SSH -> SO_PEERCRED -> signed health while its
	// readiness dependency is held. The seam exists only in this test executable;
	// no installed/native environment switch or positive readiness is introduced.
	healthReader, healthWriter, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	healthEntered := make(chan struct{})
	engine.healthProbe = func() (bool, []string) {
		close(healthEntered)
		_, _ = io.Copy(io.Discard, healthReader)
		return false, []string{"synthetic held readiness observation, not admission permission"}
	}
	healthCmd := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Username: "examq", Transport: transport, Op: "health"}
	healthFrame, _ := json.Marshal(signedCommand(key, healthCmd))
	healthContext, healthCancel := context.WithTimeout(context.Background(), 5*time.Second)
	healthDone := make(chan error, 1)
	t.Cleanup(func() {
		_ = healthWriter.Close()
		healthCancel()
		select {
		case <-healthDone:
		case <-time.After(3 * time.Second):
			t.Error("owned held-health SSH cleanup unconfirmed")
		}
		_ = healthReader.Close()
	})
	go func() {
		request := exec.CommandContext(healthContext, "/usr/bin/ssh", append(append([]string{}, args...), "examq@127.0.0.1", "exam-control")...)
		request.Stdin = bytes.NewReader(append(healthFrame, '\n'))
		out, err := request.Output()
		var response struct {
			Result map[string]any `json:"result"`
			Error  string         `json:"error"`
		}
		if err == nil && (json.Unmarshal(out, &response) != nil || response.Error != "" || response.Result["ready"] != false) {
			err = fmt.Errorf("held health returned an invalid or positive readiness result")
		}
		healthDone <- err
	}()
	select {
	case <-healthEntered:
	case <-time.After(2 * time.Second):
		t.Fatal("real signed SSH health did not reach held dependency")
	}
	command("inspect-attempt", Request{ID: id})
	if err := healthWriter.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-healthDone:
		healthDone <- err
		if err != nil {
			t.Fatal("actual signed SSH health failed after owned release", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("held health did not finish after release")
	}
	engine.healthProbe = nil
	if state, err := readStateSnapshot(config.State); err != nil {
		t.Fatal(err)
	} else if a := state.Attempts[id]; a.State != "PREPARING" || a.Start != 0 || a.Deadline != 0 || a.OriginalDeadline != 0 || a.Transport != transport || len(a.Units) != 0 {
		t.Fatal("held health changed owner/interval/admission authority")
	}
	t.Log("actual authenticated signed SSH health waits outside state while independent signed inspection remains responsive; no readiness permission or interval granted")
	pane := ManagementID()
	token := command("issue-channel-admission", Request{ID: id, Username: "examq", Transport: transport, Pane: pane, Purpose: "practice"}).(map[string]any)["token"].(string)
	entry := exec.Command("/usr/bin/ssh", append(append([]string{}, args...), "-tt", "examq@127.0.0.1", "pane-ack")...)
	input, err := entry.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	output, err := entry.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	entry.Stderr = &daemonLog
	if err := entry.Start(); err != nil {
		t.Fatal(err)
	}
	ended := make(chan error, 1)
	go func() { ended <- entry.Wait() }()
	t.Cleanup(func() {
		_ = input.Close()
		_ = entry.Process.Kill()
		select {
		case <-ended:
		case <-time.After(3 * time.Second):
			t.Error("owned pending-pane client cleanup unconfirmed")
		}
	})
	request, _ := json.Marshal(LocalRequest{Token: token})
	if _, err := input.Write(append(request, '\n')); err != nil {
		t.Fatal(err)
	}
	reader := bufio.NewReaderSize(output, 65536)
	take := func(want string) {
		t.Helper()
		result := make(chan error, 1)
		go func() {
			for n := 0; n < 16; n++ {
				line, err := reader.ReadString('\n')
				if err != nil {
					result <- err
					return
				}
				if strings.TrimSpace(line) == want {
					result <- nil
					return
				}
			}
			result <- fmt.Errorf("marker missing")
		}()
		select {
		case err := <-result:
			if err != nil {
				t.Fatal("actual pane marker", want, err, daemonLog.String())
			}
		case <-time.After(4 * time.Second):
			t.Fatal("actual pane marker timed out", want, daemonLog.String())
		}
	}
	take("PANE-ACK-PENDING")
	// This must traverse real SSH -> peer credentials -> command -> WithState
	// while Engine.local is waiting for the first channel's withheld ACK.
	command("inspect-attempt", Request{ID: id})
	command("close-pane", Request{ID: id, Pane: pane})
	if _, err := input.Write([]byte("ACK\n")); err != nil {
		t.Fatal(err)
	}
	take("PANE-ACK-DENIED")
	state, err := readStateSnapshot(config.State)
	if err != nil {
		t.Fatal(err)
	}
	a := state.Attempts[id]
	if _, ok := state.Caps[Hash([]byte(token))]; ok || len(a.Units) != 0 || a.State != "PREPARING" || a.Start != 0 || a.Deadline != 0 || a.OriginalDeadline != 0 || a.Transport != transport {
		t.Fatal("late real SSH ACK launched code or changed preflight/clock authority")
	}
	t.Log("actual authenticated SSH/Unix-credential pane ACK wait leaves signed inspection/close responsive; late ACK refused, no workload/interval started")

	// Actual supported root CLI + two real practice shells. No interval/grant
	// is begun. These scopes/keys/configuration exist ONLY in this new fixture.
	cliConfig := engine.Config
	cliConfig.TemporaryAccountPolicy = false
	cliConfig.CallbackURL = "https://127.0.0.1:9"
	cliConfig.CallbackKey = filepath.Join(private, "synthetic-callback.key")
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(cliConfig.CallbackKey, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}), 0600); err != nil {
		t.Fatal(err)
	}
	configFile := filepath.Join(private, "cli-config.json")
	configData, _ := json.Marshal(cliConfig)
	if err := os.WriteFile(configFile, configData, 0600); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		// Stop only scopes recorded by THIS private fixture before removing its
		// mounted sources/socket. A failed shell assertion must not poison the
		// next repetition's honest normal-root endpoint inventory.
		_ = listener.Close()
		state, err := readStateSnapshot(config.State)
		if err != nil {
			t.Error("owned scope cleanup state unavailable", err)
			return
		}
		a := state.Attempts[id]
		if a == nil {
			return
		}
		for _, unit := range a.Units {
			_, _, instance, valid := recordedPaneIdentity(id, unit)
			if !valid || instance == "" {
				t.Error("refuse unexpected cleanup scope")
				continue
			}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			_ = exec.CommandContext(ctx, "/usr/bin/systemctl", "kill", "--signal=KILL", unit).Run()
			_ = exec.CommandContext(ctx, "/usr/bin/systemctl", "stop", unit).Run()
			cancel()
		}
		until := time.Now().Add(3 * time.Second)
		for time.Now().Before(until) {
			next, err := readStateSnapshot(config.State)
			if err == nil && len(next.Attempts[id].Units) == 0 {
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
		// Retain the actual failed output if teardown cannot be confirmed.
		t.Error("owned native scope tracking cleanup not confirmed")
	})
	type shell struct {
		id      string
		input   io.WriteCloser
		output  *bufio.Reader
		command *exec.Cmd
		ended   chan error
	}
	readMarker := func(reader *bufio.Reader, want string, prefix bool) {
		t.Helper()
		result := make(chan error, 1)
		var transcript releaseSSHLog
		go func() {
			for n := 0; n < 32; n++ {
				line, err := reader.ReadString('\n')
				if len(transcript.String()) < 32768 {
					_, _ = transcript.Write([]byte(line))
				}
				if err != nil {
					result <- err
					return
				}
				// Interactive Bash can prefix real output with bracketed-paste
				// control bytes. Require the exact printed marker + newline;
				// the echoed printf argument contains literal \\n, not this.
				if (!prefix && (strings.Contains(line, want+"\r\n") || strings.Contains(line, want+"\n"))) || (prefix && strings.HasPrefix(strings.TrimSpace(line), want)) {
					result <- nil
					return
				}
			}
			result <- fmt.Errorf("bounded shell marker missing")
		}()
		select {
		case err := <-result:
			if err != nil {
				t.Fatal("actual shell marker", want, err, transcript.String(), daemonLog.String())
			}
		case <-time.After(5 * time.Second):
			t.Fatal("actual shell marker timeout", want, transcript.String(), daemonLog.String())
		}
	}
	startShell := func(marker string) *shell {
		t.Helper()
		p := ManagementID()
		token := command("issue-channel-admission", Request{ID: id, Username: "examq", Transport: transport, Pane: p, Purpose: "practice"}).(map[string]any)["token"].(string)
		cmd := exec.Command("/usr/bin/ssh", append(append([]string{}, args...), "-tt", "examq@127.0.0.1", "exam-gateway")...)
		in, err := cmd.StdinPipe()
		if err != nil {
			t.Fatal(err)
		}
		out, err := cmd.StdoutPipe()
		if err != nil {
			t.Fatal(err)
		}
		cmd.Stderr = &daemonLog
		if err := cmd.Start(); err != nil {
			t.Fatal(err)
		}
		ch := make(chan error, 1)
		go func() { ch <- cmd.Wait() }()
		s := &shell{id: p, input: in, output: bufio.NewReaderSize(out, 65536), command: cmd, ended: ch}
		t.Cleanup(func() {
			_ = in.Close()
			_ = cmd.Process.Kill()
			select {
			case <-ch:
			case <-time.After(3 * time.Second):
				t.Error("owned real shell client cleanup unconfirmed")
			}
		})
		readMarker(s.output, "EXAM-GATE/1", false)
		request, _ := json.Marshal(LocalRequest{Token: token})
		if _, err := in.Write(append(request, '\n')); err != nil {
			t.Fatal(err)
		}
		readMarker(s.output, "EXAM-READY ", true)
		if _, err := fmt.Fprintf(in, "printf '%s\\n'\n", marker); err != nil {
			t.Fatal(err)
		}
		readMarker(s.output, marker, false)
		return s
	}
	first, peer := startShell("FIRST-REAL-SHELL"), startShell("PEER-REAL-SHELL")
	// Observe activation, never manufacture an incarnation/readiness record.
	untilReadyPane := time.Now().Add(5 * time.Second)
	for {
		view, err := ObserveNativePanes(config.State, NativePaneQuery{Attempt: id, Pane: first.id, Limit: 1})
		if err == nil && len(view.Panes) == 1 && !view.Panes[0].Unsafe && len(view.Panes[0].Incarnations) == 1 {
			break
		}
		if time.Now().After(untilReadyPane) {
			t.Fatal("actual unit activation proof unavailable", err, view)
		}
		time.Sleep(10 * time.Millisecond)
	}
	if _, err := fmt.Fprint(first.input, "( while :; do printf x >> detached; sleep 0.02; done ) >/dev/null 2>&1 &\n"); err != nil {
		t.Fatal(err)
	}
	counter := filepath.Join(config.State, "practice", id, "detached")
	untilWriter := time.Now().Add(3 * time.Second)
	for {
		info, err := os.Stat(counter)
		if err == nil && info.Size() > 0 {
			break
		}
		if time.Now().After(untilWriter) {
			t.Fatal("owned detached writer did not run", err)
		}
		time.Sleep(10 * time.Millisecond)
	}
	cli := func(args ...string) []byte {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, "/usr/local/sbin/examctl", append([]string{"--config", configFile}, args...)...)
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatal("actual native pane CLI", err, string(out))
		}
		return out
	}
	var reviewed NativePanesSnapshot
	if json.Unmarshal(cli("panes", "show", id, first.id), &reviewed) != nil || len(reviewed.Panes) != 1 || reviewed.Panes[0].Unsafe || reviewed.Panes[0].Revision == "" {
		t.Fatal("actual reviewed pane CLI metadata", reviewed)
	}
	var closed NativePaneCloseResult
	if json.Unmarshal(cli("panes", "close", id, first.id, "--revision", reviewed.Panes[0].Revision, "--reason", "Explicit synthetic target shell closure"), &closed) != nil || !closed.RecordedTargetsQuiesced || closed.ClockChanged || closed.AccessReleased {
		t.Fatal("actual root target close", closed)
	}
	beforeStop, err := os.Stat(counter)
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(100 * time.Millisecond)
	afterStop, err := os.Stat(counter)
	if err != nil || beforeStop.Size() != afterStop.Size() {
		t.Fatal("target detached writer survived reviewed close", err)
	}
	if _, err := fmt.Fprint(peer.input, "printf 'PEER-SURVIVES-ROOT-CLOSE\\n'\n"); err != nil {
		t.Fatal(err)
	}
	readMarker(peer.output, "PEER-SURVIVES-ROOT-CLOSE", false)
	current, err := readStateSnapshot(config.State)
	if err != nil {
		t.Fatal(err)
	}
	if a := current.Attempts[id]; a.State != "PREPARING" || a.Start != 0 || a.Deadline != 0 || a.OriginalDeadline != 0 || a.PolicyRestoreAuthorized || len(a.Units) != 1 || !paneRecorded(a, peer.id) {
		t.Fatal("target CLI close affected peer/preflight/clock authority")
	}
	var peerView NativePanesSnapshot
	if json.Unmarshal(cli("panes", "show", id, peer.id), &peerView) != nil || len(peerView.Panes) != 1 || peerView.Panes[0].Unsafe {
		t.Fatal("peer snapshot unavailable", peerView)
	}
	cli("panes", "close", id, peer.id, "--revision", peerView.Panes[0].Revision, "--reason", "Explicit synthetic peer cleanup")
	t.Log("actual static root CLI durably audits and closes one unique recorded scope plus detached writer while a second real SSH shell survives; no interval/hold/grant changed")
}
