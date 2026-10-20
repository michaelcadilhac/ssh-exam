package core

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

// Exercise the actual gate process and PTY protocol with a local fake agent.
// No SSH account, authentication provider or production state is involved.
func TestExamWelcomeGatePTY(t *testing.T) {
	for _, welcome := range []string{"", "\r\nHello student1, Systems Midterm.\r\n", "\r\n" + strings.Repeat("x", maxWelcomeBytes) + "\r\n"} {
		t.Run(fmt.Sprint(len(welcome)), func(t *testing.T) {
			socket := filepath.Join(t.TempDir(), "gate.sock")
			listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: socket, Net: "unix"})
			if err != nil {
				t.Fatal(err)
			}
			defer listener.Close()
			agentDone := make(chan error, 1)
			go func() {
				agentDone <- func() error {
					c, err := listener.AcceptUnix()
					if err != nil {
						return err
					}
					defer c.Close()
					c.SetDeadline(time.Now().Add(5 * time.Second))
					data, oob := make([]byte, 4096), make([]byte, syscall.CmsgSpace(4))
					n, on, _, _, err := c.ReadMsgUnix(data, oob)
					if err != nil {
						return err
					}
					var request LocalRequest
					if err := json.Unmarshal(data[:n], &request); err != nil || len(request.Token) != 64 {
						return fmt.Errorf("bad admission frame")
					}
					messages, err := syscall.ParseSocketControlMessage(oob[:on])
					if err != nil || len(messages) != 1 {
						return fmt.Errorf("missing PTY descriptor")
					}
					fds, err := syscall.ParseUnixRights(&messages[0])
					if err != nil || len(fds) != 1 {
						return fmt.Errorf("invalid PTY descriptor")
					}
					terminal := os.NewFile(uintptr(fds[0]), "test-pane")
					defer terminal.Close()
					if err := json.NewEncoder(c).Encode(map[string]any{"directory": "/work", "deadline": 1792186200000, "welcome": welcome}); err != nil {
						return err
					}
					ack := make([]byte, 1)
					if _, err := io.ReadFull(c, ack); err != nil {
						return err
					}
					if _, err := terminal.Write([]byte("PROMPT> ")); err != nil {
						return err
					}
					if _, err := io.ReadFull(terminal, ack); err != nil || ack[0] != 3 {
						return fmt.Errorf("raw terminal input failed: %v", err)
					}
					return json.NewEncoder(c).Encode(map[string]bool{"ended": true})
				}()
			}()
			master, slave, err := openPTY()
			if err != nil {
				t.Fatal(err)
			}
			defer master.Close()
			defer slave.Close()
			ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
			defer cancel()
			cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestSSHGateHelper$")
			cmd.Env = append(os.Environ(), "EXAM_GATE_TEST_HELPER=1", "EXAM_GATE_TEST_SOCKET="+socket, "SSH_ORIGINAL_COMMAND=exam-gateway")
			cmd.Stdin, cmd.Stdout, cmd.Stderr = slave, slave, slave
			if err := cmd.Start(); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { cmd.Process.Kill() })
			slave.Close()
			reader := bufio.NewReader(master)
			line, err := reader.ReadString('\n')
			if err != nil || strings.TrimSpace(line) != "EXAM-GATE/1" {
				t.Fatalf("gate greeting: %q, %v", line, err)
			}
			if _, err := fmt.Fprintf(master, "{\"token\":\"%s\"}\n", strings.Repeat("a", 64)); err != nil {
				t.Fatal(err)
			}
			line, err = reader.ReadString('\n')
			if err != nil || !strings.HasPrefix(line, "EXAM-READY ") || len(line) >= 8192 || strings.Contains(line, "welcome") {
				t.Fatalf("invalid readiness: %q, %v", line, err)
			}
			out := make([]byte, len(welcome)+len("PROMPT> "))
			if _, err := io.ReadFull(reader, out); err != nil || string(out) != welcome+"PROMPT> " {
				t.Fatalf("welcome/prompt order or line endings changed: got %d bytes, %v", len(out), err)
			}
			if _, err := master.Write([]byte{3}); err != nil {
				t.Fatal(err)
			}
			if err := <-agentDone; err != nil {
				t.Fatal(err)
			}
			if err := cmd.Wait(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
