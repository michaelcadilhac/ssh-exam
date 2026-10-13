package core

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

type LocalRequest struct {
	Token    string       `json:"token"`
	Ordinary bool         `json:"ordinary"`
	Command  *SignedFrame `json:"command,omitempty"`
}

func transportIdentity(pid int, uid int) (string, error) { // Bind capabilities to a live, root-owned sshd transport ancestor, including boot and PID start time.
	identity, _, err := transportInfo(pid, uid)
	return identity, err
}
func transportInfo(pid int, uid int) (string, int, error) {
	current := pid
	found := ""
	for n := 0; n < 32 && current > 1; n++ {
		b, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", current))
		if err != nil {
			return "", 0, err
		}
		end := strings.LastIndex(string(b), ")")
		if end < 0 {
			return "", 0, errors.New("invalid process stat")
		}
		fields := strings.Fields(string(b)[end+1:])
		if len(fields) < 20 {
			return "", 0, errors.New("short process stat")
		}
		status, err := os.Stat(fmt.Sprintf("/proc/%d", current))
		if err != nil {
			return "", 0, err
		}
		procUID := status.Sys().(*syscall.Stat_t).Uid
		exe, _ := os.Readlink(fmt.Sprintf("/proc/%d/exe", current))
		cmd, _ := os.ReadFile(fmt.Sprintf("/proc/%d/cmdline", current))
		if procUID == 0 && (filepath.Base(exe) == "sshd" || filepath.Base(exe) == "sshd-session") && strings.Contains(string(cmd), "[priv]") {
			found = fmt.Sprintf("%s:%d:%s:%d", boot(), current, fields[19], uid)
			break
		}
		current, _ = strconv.Atoi(fields[1])
	}
	if found == "" {
		return "", 0, errors.New("no verified root-owned SSH transport ancestor; local entry denied")
	}
	return Hash([]byte(found)), current, nil
}
func peer(c *net.UnixConn) (*syscall.Ucred, error) {
	var result *syscall.Ucred
	var inner error
	raw, err := c.SyscallConn()
	if err != nil {
		return nil, err
	}
	err = raw.Control(func(fd uintptr) {
		result, inner = syscall.GetsockoptUcred(int(fd), syscall.SOL_SOCKET, syscall.SO_PEERCRED)
	})
	if err != nil {
		return nil, err
	}
	return result, inner
}
func (e *Engine) ServeLocal() error {
	os.Remove(e.Config.Socket)
	l, err := net.ListenUnix("unix", &net.UnixAddr{Name: e.Config.Socket, Net: "unix"})
	if err != nil {
		return err
	}
	defer l.Close()
	if err = os.Chmod(e.Config.Socket, 0666); err != nil {
		return err
	}
	for {
		c, err := l.AcceptUnix()
		if err != nil {
			return err
		}
		go e.local(c)
	}
}
func (e *Engine) local(c *net.UnixConn) {
	defer c.Close()
	c.SetDeadline(time.Now().Add(15 * time.Second))
	cred, err := peer(c)
	if err != nil {
		return
	}
	buf := make([]byte, 65536)
	oob := make([]byte, syscall.CmsgSpace(4))
	n, on, _, _, err := c.ReadMsgUnix(buf, oob)
	if err != nil {
		return
	}
	var r LocalRequest
	if json.Unmarshal(buf[:n], &r) != nil {
		return
	}
	var account Account
	name := ""
	for k, v := range e.Config.Accounts {
		if v.UID == int(cred.Uid) {
			account = v
			name = k
			break
		}
	}
	if name == "" {
		json.NewEncoder(c).Encode(map[string]string{"error": "account not locally approved"})
		return
	}
	if r.Command != nil {
		identity, err := transportIdentity(int(cred.Pid), account.UID)
		if err != nil {
			json.NewEncoder(c).Encode(map[string]string{"error": "SSH ancestry rejected"})
			return
		}
		result, err := e.Command(*r.Command, name, identity)
		if err != nil {
			json.NewEncoder(c).Encode(map[string]string{"error": err.Error()})
		} else {
			json.NewEncoder(c).Encode(map[string]any{"result": result})
		}
		return
	}
	var launch *exec.Cmd
	var original, master, slave *os.File
	done := make(chan struct{})
	defer close(done)
	defer func() {
		for _, f := range []*os.File{original, master, slave} {
			if f != nil {
				f.Close()
			}
		}
	}()
	unit := ""
	id := ""
	result := map[string]any{}
	err = e.WithState(func() error {
		if r.Ordinary {
			if err := e.ordinaryAccess(account.UID); err != nil {
				if a := e.Busy(account.UID); a != nil {
					e.Audit("ordinary-access-denied", a.ID)
				}
				return err
			}
			result = map[string]any{"shell": account.Shell, "home": account.Home}
			return nil
		}
		identity, err := transportIdentity(int(cred.Pid), account.UID)
		if err != nil {
			return err
		}
		cap, ok := e.state.Caps[Hash([]byte(r.Token))]
		delete(e.state.Caps, Hash([]byte(r.Token)))
		if !ok || cap.Expires < Millis() || cap.Username != name {
			return errors.New("invalid or expired one-use admission")
		}
		if cap.Transport != identity {
			return errors.New("capability transport mismatch")
		}
		a, err := e.Find(cap.ID)
		if err != nil {
			return err
		}
		if a.Transport != identity || a.Username != name {
			return errors.New("attempt transport mismatch")
		}
		practice := cap.Purpose == "practice"
		if err := workloadAllowed(a, cap.Purpose); err != nil {
			return err
		}
		if !practice && len(a.Units) >= a.Settings.Terminals {
			return errors.New("terminal limit")
		}
		messages, err := syscall.ParseSocketControlMessage(oob[:on])
		if err != nil || len(messages) != 1 {
			return errors.New("PTY descriptor required")
		}
		fds, err := syscall.ParseUnixRights(&messages[0])
		if err != nil || len(fds) != 1 {
			return errors.New("exactly one PTY required")
		}
		fd := os.NewFile(uintptr(fds[0]), "pty")
		original = fd
		master, slave, err = openPTY()
		if err != nil {
			return err
		}
		var term syscall.Termios
		_, _, errno := syscall.Syscall(syscall.SYS_IOCTL, fd.Fd(), syscall.TCGETS, uintptr(unsafe.Pointer(&term)))
		if errno != 0 {
			return errors.New("not a terminal descriptor")
		}
		unit = "exam-" + a.ID + "-" + cap.Pane + ".scope"
		id = a.ID
		work := filepath.Join(e.Config.Work, a.ID, "work")
		if practice {
			work = filepath.Join(e.Config.State, "practice", a.ID)
			os.MkdirAll(work, 0700)
			os.Chown(work, account.UID, account.GID)
			os.WriteFile(filepath.Join(work, "PRACTICE.txt"), []byte("Practice editor shortcuts and save files here. No exam questions are present.\n"), 0644)
		}
		args := []string{"--scope", "--quiet", "--unit=" + strings.TrimSuffix(unit, ".scope"), "--slice=exam.slice", "--property=Delegate=no", "--property=MemoryMax=1G", "--property=TasksMax=128", "--property=CPUQuota=100%", "--", "/usr/bin/bwrap", "--unshare-ipc", "--unshare-pid", "--unshare-net", "--unshare-uts", "--unshare-cgroup", "--cap-drop", "ALL", "--cap-add", "CAP_SETUID", "--cap-add", "CAP_SETGID", "--cap-add", "CAP_SETPCAP", "--ro-bind", e.Config.Rootfs, "/", "--bind", work, a.WorkPath, "--tmpfs", "/tmp", "--proc", "/proc", "--dev", "/dev", "--dir", "/home/student", "--ro-bind", filepath.Join(e.Config.State, "homes", a.ID), "/home/student", "--ro-bind", filepath.Join(e.Config.State, "homes", a.ID, ".exam-passwd"), "/etc/passwd", "--ro-bind", filepath.Join(e.Config.State, "homes", a.ID, ".exam-group"), "/etc/group", "--chdir", "/", "--clearenv", "--setenv", "HOME", "/home/student", "--setenv", "USER", name, "--setenv", "LOGNAME", name, "--setenv", "TERM", "xterm-256color", "--setenv", "PATH", "/usr/local/bin:/usr/bin:/bin", "--setenv", "EXAM_DIR", a.WorkPath, "--setenv", "EXAM_ID", a.Exam, "--setenv", "EXAM_ATTEMPT_ID", a.ID, "--setenv", "EXAM_PANE_ID", cap.Pane, "--setenv", "EXAM_DEADLINE", time.UnixMilli(a.Deadline).UTC().Format(time.RFC3339)}
		if !practice {
			args = append(args, "--ro-bind", filepath.Join(e.Config.Templates, a.Settings.Template, "materials"), "/materials")
		}
		// Keep host file ownership and process UID aligned. The root-controlled
		// setpriv runs before user code and irrevocably drops all capabilities.
		args = append(args, "--", "/usr/bin/setpriv", "--reuid", strconv.Itoa(account.UID), "--regid", strconv.Itoa(account.GID), "--clear-groups", "--inh-caps=-all", "--ambient-caps=-all", "--bounding-set=-all", "--no-new-privs", "--", "/usr/bin/env", "--chdir="+a.WorkPath, account.Shell, "-l")
		if e.Config.FunctionalHostAccess && e.functionalAccount(a) {
			// Explicit trusted-administrator exception: the system manager starts
			// a normal host account session, independently of agent sandboxing.
			// Still track its entire cgroup for terminal closure and collection.
			unit = strings.TrimSuffix(unit, ".scope") + ".service"
			args = functionalHostArgs(unit, name, account, work, a, cap.Pane, practice, e.Config.Templates)
		}
		launch = exec.Command("/usr/bin/systemd-run", args...)
		launch.Stdin = slave
		launch.Stdout = slave
		launch.Stderr = slave
		launch.Env = []string{"PATH=/usr/bin:/bin"}
		// Preserve only UID/GID-drop setup capabilities across exec under the
		// agent's NoNewPrivileges. setpriv clears them before student code.
		launch.SysProcAttr = &syscall.SysProcAttr{Setsid: true, Setctty: true, Ctty: 0, AmbientCaps: []uintptr{6, 7, 8}} // SETGID, SETUID, SETPCAP
		result = map[string]any{"directory": a.WorkPath, "deadline": a.Deadline, "attempt": a.ID}
		a.Units = append(a.Units, unit)
		if err = e.save(); err != nil {
			return err
		}
		json.NewEncoder(c).Encode(result)
		var acknowledged [1]byte
		if _, err = c.Read(acknowledged[:]); err != nil {
			return err
		}
		if !practice && (expired(a) || Millis() >= a.Lease) {
			launch = nil
			return errors.New("deadline/lease expired during admission")
		}
		if err = launch.Start(); err != nil {
			launch = nil
			return err
		}
		// Forward startup diagnostics as well as the eventual shell. A failed
		// sandbox may exit before its scope becomes active.
		bridgePTY(original, master, done)
		var activeScope bool
		for i := 0; i < 50; i++ {
			if exec.Command("/usr/bin/systemctl", "is-active", "--quiet", unit).Run() == nil {
				activeScope = true
				break
			}
			time.Sleep(20 * time.Millisecond)
		}
		if !activeScope {
			syscall.Kill(-launch.Process.Pid, syscall.SIGKILL)
			launch.Wait()
			launch = nil
			return errors.New("workload scope failed readiness; pane denied")
		}
		e.Audit("pane-admitted", a.ID)
		return nil
	})
	if err != nil {
		log.Printf("protected channel admission failed: %v", err)
		json.NewEncoder(c).Encode(map[string]string{"error": err.Error()})
		return
	}
	if launch == nil {
		json.NewEncoder(c).Encode(result)
		return
	}
	c.SetDeadline(time.Time{})
	launch.Wait()
	// A shell may exit while detached children remain. Never drop their scope from
	// persistent tracking until systemd confirms the entire cgroup is gone.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	exec.CommandContext(ctx, "/usr/bin/systemctl", "kill", "--signal=KILL", unit).Run()
	exec.CommandContext(ctx, "/usr/bin/systemctl", "stop", unit).Run()
	_, scopeErr := os.Stat(filepath.Join("/sys/fs/cgroup/exam.slice", unit))
	if !os.IsNotExist(scopeErr) {
		e.Audit("pane-cleanup-unconfirmed", id)
		json.NewEncoder(c).Encode(map[string]string{"error": "pane ended; workload scope retained for watchdog cleanup"})
		return
	}
	e.WithState(func() error {
		a, _ := e.Find(id)
		if a != nil {
			units := []string{}
			for _, v := range a.Units {
				if v != unit {
					units = append(units, v)
				}
			}
			a.Units = units
		}
		return nil
	})
	json.NewEncoder(c).Encode(map[string]bool{"ended": true})
}
func Gate(socket string) error {
	syscall.RawSyscall6(syscall.SYS_PRCTL, 4, 0, 0, 0, 0, 0)
	conn, err := net.DialUnix("unix", nil, &net.UnixAddr{Name: socket, Net: "unix"})
	if err != nil {
		return errors.New("exam guard unavailable: entry denied")
	}
	defer conn.Close()
	command := ""
	if len(os.Args) >= 3 && os.Args[1] == "-c" {
		command = os.Args[2]
		if command == "exam-dispatch" {
			command = os.Getenv("SSH_ORIGINAL_COMMAND")
		}
	}
	if command == "exam-control" {
		frameLine, err := bufio.NewReaderSize(os.Stdin, 65536).ReadSlice('\n')
		if err != nil {
			return errors.New("bounded command frame required")
		}
		var frame SignedFrame
		if json.Unmarshal(frameLine, &frame) != nil {
			return errors.New("invalid signed command")
		}
		b, _ := json.Marshal(LocalRequest{Command: &frame})
		if _, err = conn.Write(b); err != nil {
			return err
		}
		result, err := bufio.NewReader(conn).ReadBytes('\n')
		if err != nil {
			return err
		}
		_, err = os.Stdout.Write(result)
		return err
	}
	gateway := command == "exam-gateway"
	if !gateway {
		b, _ := json.Marshal(LocalRequest{Ordinary: true})
		conn.Write(b)
		var r map[string]string
		if err = json.NewDecoder(conn).Decode(&r); err != nil {
			return err
		}
		if r["error"] != "" {
			return errors.New(r["error"])
		}
		shell := r["shell"]
		args := []string{"-" + filepath.Base(shell)}
		if command != "" {
			args = []string{shell, "-c", command}
		}
		return syscall.Exec(shell, args, os.Environ())
	}
	var term syscall.Termios
	_, _, errno := syscall.Syscall(syscall.SYS_IOCTL, 0, syscall.TCGETS, uintptr(unsafe.Pointer(&term)))
	if errno != 0 {
		return errors.New("PTY required")
	}
	saved := term
	term.Lflag &^= syscall.ECHO
	syscall.Syscall(syscall.SYS_IOCTL, 0, syscall.TCSETS, uintptr(unsafe.Pointer(&term)))
	fmt.Println("EXAM-GATE/1")
	line := []byte{}
	one := make([]byte, 1)
	for len(line) < 4096 {
		n, err := os.Stdin.Read(one)
		if err != nil || n != 1 {
			return errors.New("admission read failed")
		}
		if one[0] == '\n' {
			break
		}
		line = append(line, one[0])
	}
	syscall.Syscall(syscall.SYS_IOCTL, 0, syscall.TCSETS, uintptr(unsafe.Pointer(&saved)))
	var request LocalRequest
	if json.Unmarshal(line, &request) != nil || len(request.Token) != 64 {
		return errors.New("invalid admission frame")
	}
	b, _ := json.Marshal(request)
	if _, _, err = conn.WriteMsgUnix(b, syscall.UnixRights(0), nil); err != nil {
		return err
	}
	reader := bufio.NewReader(conn)
	result, err := reader.ReadBytes('\n')
	if err != nil {
		return err
	}
	var response map[string]any
	if json.Unmarshal(result, &response) != nil {
		return errors.New("invalid agent response")
	}
	if response["error"] != nil {
		return errors.New("admission denied")
	}
	fmt.Printf("EXAM-READY %s", result)
	// Only the inner PTY handles editing/signals. Otherwise Ctrl-C kills this
	// outer gate and canonical buffering prevents interactive editor input.
	restore, err := rawTerminal(0)
	if err != nil {
		return err
	}
	defer restore()
	fmt.Printf("\r\nWelcome to the exam. Saved files in %v are collected automatically when time expires or you finish the exam. Unsaved editor buffers are not included. Deadline: %v\r\n", response["directory"], response["deadline"])
	conn.Write([]byte{1})
	ended, err := reader.ReadBytes('\n')
	if err != nil {
		return err
	}
	var status struct {
		Error string `json:"error"`
	}
	if json.Unmarshal(ended, &status) != nil || status.Error != "" {
		return errors.New("protected terminal failed; contact your instructor")
	}
	return nil
}
