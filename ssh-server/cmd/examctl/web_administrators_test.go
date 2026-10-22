package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

func TestAdministratorCLIHelpAndSecretSafeSyntaxBeforeRoot(t *testing.T) {
	for _, args := range [][]string{{"help", "administrators"}, {"web", "administrators", "help"}, {"web", "administrators", "create", "--help"}, {"--config", "/missing", "web", "administrators", "--help"}} {
		output, code := cliProcess(t, args...)
		for _, required := range []string{"Usage:", "create", "list", "show", "--password-stdin", "--request", "Argon2id", "full administrator", "Exit status:"} {
			if code != 0 || !strings.Contains(output, required) {
				t.Fatalf("missing administrator workflow %q: %d %s", required, code, output)
			}
		}
	}
	secret := "never-echo-this-credential-value"
	for _, args := range [][]string{
		{"web", "administrators", "create"},
		{"web", "administrators", "create", "invalid user"},
		{"web", "administrators", "create", "valid", "--password", secret},
		{"web", "administrators", "create", "valid", "--password-stdin=" + secret},
		{"web", "administrators", "list", "--password-stdin"},
		{"web", "administrators", "show", "valid", "--after", "other"},
		{"web", "administrators", "list", "--limit", "201"},
	} {
		output, code := cliProcess(t, args...)
		if code != 2 || !strings.Contains(output, "administrators help") || strings.Contains(output, secret) || strings.Contains(output, "Load root") {
			t.Fatal("unsafe or undiscoverable administrator syntax refusal", code, output)
		}
	}
}

func TestAdministratorStdinPreservesExactBytesAndBrowserCharacterLimits(t *testing.T) {
	for _, secret := range []string{"twelve-bytes!", strings.Repeat("😀", 6), strings.Repeat("a", 1024), "synthetic-password\n"} {
		data, err := readAdministratorStdin(strings.NewReader(secret))
		if err != nil || string(data) != secret {
			t.Fatal("exact secret input changed or refused", err)
		}
		wipeAdministratorBytes(data)
	}
	for _, secret := range [][]byte{[]byte("short"), []byte(strings.Repeat("😀", 5)), []byte(strings.Repeat("😀", 513)), []byte(strings.Repeat("a", 4097)), {0xff, 0xfe}} {
		data, err := readAdministratorStdin(bytes.NewReader(secret))
		if err == nil || data != nil || bytes.Contains([]byte(err.Error()), secret) {
			t.Fatal("invalid credential was accepted or echoed")
		}
	}
}

func TestAdministratorMetadataRepliesRefusePrivateFieldsDuplicateKeysAndWrongScopes(t *testing.T) {
	for _, item := range []struct {
		op      string
		body    map[string]any
		valid   []string
		invalid []string
	}{
		{"create", map[string]any{"username": "helper"}, []string{`{"username":"helper"}`}, []string{`{"username":"other"}`, `{"username":"helper","hash":"private"}`, `{"username":"private","username":"helper"}`, `{"Username":"helper"}`, `{"username":"helper"} {}`}},
		{"show", map[string]any{"username": "helper"}, []string{`{"username":"helper","role":"admin"}`}, []string{`{"username":"helper"}`, `{"username":"helper","role":"student"}`, `{"username":"helper","role":"admin","password":"private"}`}},
		{"list", map[string]any{"limit": 1, "after": "a"}, []string{`{"administrators":[{"username":"helper"}],"next":"helper"}`, `{"administrators":[],"next":null}`}, []string{`{"administrators":[{"username":"helper"}]}`, `{"administrators":[{"username":"helper","hash":"private"}],"next":null}`, `{"administrators":[{"username":"z","username":"helper"}],"next":null}`, `{"administrators":[{"username":"a"}],"next":null}`, `{"administrators":[],"next":"helper"}`, `{"administrators":[{"username":"helper"}],"next":"other"}`, `{"administrators":[{"username":"helper"},{"username":"z"}],"next":null}`}},
	} {
		for _, raw := range item.valid {
			if err := validateAdministratorResult(item.op, item.body, json.RawMessage(raw)); err != nil {
				t.Fatal("valid scoped metadata refused", item.op, err)
			}
		}
		for _, raw := range item.invalid {
			if err := validateAdministratorResult(item.op, item.body, json.RawMessage(raw)); err == nil || strings.Contains(err.Error(), "private") {
				t.Fatal("unsafe metadata accepted/echoed", item.op)
			}
		}
	}
}

const administratorPromptSecret = "synthetic-tty-password-😀"

func TestAdministratorPromptHelper(t *testing.T) {
	mode := os.Getenv("EXAM_ADMINISTRATOR_PROMPT_HELPER")
	if mode == "" {
		return
	}
	data, err := readAdministratorTTY()
	defer wipeAdministratorBytes(data)
	if mode == "confirm" {
		if err != nil || string(data) != administratorPromptSecret {
			t.Fatal("owned hidden prompt did not return expected synthetic credential", err)
		}
		fmt.Println("OWNED_PROMPT_OK")
	} else {
		if err == nil || data != nil {
			t.Fatal("cancelled/mismatched owned prompt returned credential")
		}
		fmt.Println("OWNED_PROMPT_REFUSED")
	}
}

func TestAdministratorHiddenPromptUsesRealTTYWithoutEchoAndRestoresOnCancellation(t *testing.T) {
	for _, mode := range []string{"confirm", "mismatch", "interrupt", "terminate", "hangup", "quit"} {
		t.Run(mode, func(t *testing.T) {
			fd, err := unix.Open("/dev/ptmx", unix.O_RDWR|unix.O_NOCTTY|unix.O_NONBLOCK|unix.O_CLOEXEC, 0)
			if err != nil {
				t.Fatal(err)
			}
			master := os.NewFile(uintptr(fd), "owned-administrator-test-pty")
			defer master.Close()
			if err := unix.IoctlSetPointerInt(fd, unix.TIOCSPTLCK, 0); err != nil {
				t.Fatal(err)
			}
			peer, _, peerErr := unix.Syscall(unix.SYS_IOCTL, uintptr(fd), unix.TIOCGPTPEER, uintptr(unix.O_RDWR|unix.O_NOCTTY|unix.O_NONBLOCK|unix.O_CLOEXEC))
			if peerErr != 0 {
				t.Fatal(peerErr)
			}
			slaveFD := int(peer)
			slave := os.NewFile(uintptr(slaveFD), "owned-administrator-test-slave")
			defer slave.Close()
			saved, err := unix.IoctlGetTermios(slaveFD, unix.TCGETS)
			if err != nil {
				t.Fatal(err)
			}
			// Enable the fixture's normal UTF-8 canonical erase semantics.
			saved.Iflag |= unix.IUTF8
			if err := unix.IoctlSetTermios(slaveFD, unix.TCSETS, saved); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
			defer cancel()
			command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestAdministratorPromptHelper$", "-test.count=1")
			command.Env = append(os.Environ(), "EXAM_ADMINISTRATOR_PROMPT_HELPER="+mode, "GORACE=atexit_sleep_ms=0")
			command.Stdin, command.Stdout, command.Stderr = slave, slave, slave
			command.SysProcAttr = &syscall.SysProcAttr{Setsid: true, Setctty: true, Ctty: 0}
			if err := command.Start(); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = command.Process.Kill(); _ = command.Wait() })
			var output []byte
			readUntil := func(marker string) {
				t.Helper()
				_ = master.SetReadDeadline(time.Now().Add(3 * time.Second))
				for !bytes.Contains(output, []byte(marker)) {
					var buf [1024]byte
					n, err := master.Read(buf[:])
					output = append(output, buf[:n]...)
					if bytes.Contains(output, []byte(administratorPromptSecret)) {
						t.Fatal("owned terminal echoed credential")
					}
					if len(output) > 8192 || err != nil {
						t.Fatal("owned prompt marker unavailable", marker, err, string(output))
					}
				}
			}
			readUntil("Administrator password (hidden):")
			hidden, err := unix.IoctlGetTermios(slaveFD, unix.TCGETS)
			if err != nil || hidden.Lflag&(unix.ECHO|unix.ECHONL) != 0 {
				t.Fatal("echo was not disabled", err)
			}
			if mode == "confirm" || mode == "mismatch" {
				// Normal UTF-8 canonical backspace erases one entire extra code point.
				if _, err := io.WriteString(master, administratorPromptSecret+"漢\x7f\n"); err != nil {
					t.Fatal(err)
				}
				readUntil("Confirm administrator password (hidden):")
				confirmation := administratorPromptSecret
				if mode == "mismatch" {
					confirmation = "different-synthetic-password"
				}
				if _, err := io.WriteString(master, confirmation+"\n"); err != nil {
					t.Fatal(err)
				}
			} else {
				if _, err := io.WriteString(master, administratorPromptSecret); err != nil {
					t.Fatal(err)
				}
				sig := map[string]syscall.Signal{"interrupt": syscall.SIGINT, "terminate": syscall.SIGTERM, "hangup": syscall.SIGHUP, "quit": syscall.SIGQUIT}[mode]
				if err := command.Process.Signal(sig); err != nil {
					t.Fatal(err)
				}
			}
			marker := "OWNED_PROMPT_REFUSED"
			if mode == "confirm" {
				marker = "OWNED_PROMPT_OK"
			}
			readUntil(marker)
			if err := command.Wait(); err != nil {
				t.Fatal("owned prompt child failed", err, string(output))
			}
			after, err := unix.IoctlGetTermios(slaveFD, unix.TCGETS)
			if err != nil || *after != *saved {
				t.Fatal("owned prompt did not restore exact termios", err)
			}
			if bytes.Contains(output, []byte(administratorPromptSecret)) || bytes.Contains(output, []byte("different-synthetic-password")) {
				t.Fatal("credential appeared in terminal output")
			}
		})
	}
}

func FuzzAdministratorMetadataNeverAcceptsPrivateFieldsOrWrongAccount(f *testing.F) {
	for _, seed := range []string{`{"username":"helper"}`, `{"username":"other"}`, `{"username":"helper","hash":"PRIVATE-MARKER"}`, `{"username":"other","username":"helper"}`, `{"administrators":[{"username":"helper"}],"next":null}`, `{"username":"helper","role":"admin"}`, `{"username":"helper","role":"student"}`, `{`, strings.Repeat("[", 20)} {
		f.Add([]byte(seed), uint8(0))
		f.Add([]byte(seed), uint8(1))
		f.Add([]byte(seed), uint8(2))
	}
	f.Fuzz(func(t *testing.T, data []byte, kind uint8) {
		op := []string{"create", "show", "list"}[kind%3]
		body := map[string]any{"username": "helper", "limit": 1}
		err := validateAdministratorResult(op, body, json.RawMessage(data))
		if err != nil {
			if strings.Contains(err.Error(), "PRIVATE-MARKER") {
				t.Fatal("private payload reflected")
			}
			return
		}
		var object map[string]json.RawMessage
		if len(data) > 65536 || json.Unmarshal(data, &object) != nil {
			t.Fatal("non-object/unbounded metadata accepted")
		}
		if op == "list" {
			if len(object) != 2 || object["administrators"] == nil || object["next"] == nil {
				t.Fatal("unknown/missing page fields accepted")
			}
			var rows []map[string]any
			if json.Unmarshal(object["administrators"], &rows) != nil || len(rows) > 1 {
				t.Fatal("invalid page accepted")
			}
			for _, row := range rows {
				if len(row) != 1 || row["username"] == nil {
					t.Fatal("private row fields accepted")
				}
			}
			return
		}
		var username string
		if json.Unmarshal(object["username"], &username) != nil || username != "helper" {
			t.Fatal("foreign account accepted")
		}
		if op == "create" && len(object) != 1 {
			t.Fatal("private creation fields accepted")
		}
		if op == "show" {
			var role string
			if len(object) != 2 || json.Unmarshal(object["role"], &role) != nil || role != "admin" {
				t.Fatal("private/incorrect role accepted")
			}
		}
	})
}
