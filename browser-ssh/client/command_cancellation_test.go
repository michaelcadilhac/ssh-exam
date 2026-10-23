package client

import (
	"bufio"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
)

func TestExactCommandCancellationPreservesAuthenticatedSiblingAndTerminal(t *testing.T) {
	target, sibling := strings.Repeat("a", 64), strings.Repeat("b", 64)
	reached, ended, output := make(chan string, 8), make(chan string, 8), make(chan string, 8)
	c := cleanupClient(t, func(s ssh.Channel, reqs <-chan *ssh.Request) {
		defer s.Close()
		for req := range reqs {
			if err := req.Reply(true, nil); err != nil && req.WantReply {
				return
			}
			if req.Type != "exec" {
				continue
			}
			var command struct{ Command string }
			if ssh.Unmarshal(req.Payload, &command) != nil {
				return
			}
			r := bufio.NewReader(s)
			if command.Command == "exam-gateway" {
				s.Write([]byte("EXAM-GATE/1\n"))
				r.ReadString('\n')
				s.Write([]byte("EXAM-READY {}\n"))
				// exam-login acknowledges its local root gate itself; the SSH
				// client sends terminal bytes immediately after EXAM-READY.
				for {
					line, err := r.ReadString('\n')
					if err != nil {
						return
					}
					s.Write([]byte("MEMORY-PRESERVED:" + line))
				}
			}
			line, err := r.ReadBytes('\n')
			var envelope struct{ Payload string }
			var payload struct{ Nonce string }
			if err != nil || json.Unmarshal(line, &envelope) != nil {
				return
			}
			data, err := base64.StdEncoding.DecodeString(envelope.Payload)
			if err != nil || json.Unmarshal(data, &payload) != nil {
				return
			}
			if payload.Nonce == target || payload.Nonce == sibling {
				reached <- payload.Nonce
				r.ReadString('\n') // Actual channel EOF, not a simulated cancellation flag.
				ended <- payload.Nonce
				return
			}
			s.Write([]byte("{\"ok\":true}\n"))
			return
		}
	}, func(value any) {
		if event, ok := value.(map[string]any); ok && event["type"] == "output" {
			if data, ok := event["data"].(string); ok {
				decoded, err := base64.StdEncoding.DecodeString(data)
				if err == nil {
					output <- string(decoded)
				}
			}
		}
	})
	frame := func(nonce string) json.RawMessage {
		payload, _ := json.Marshal(map[string]string{"nonce": nonce})
		data, _ := json.Marshal(map[string]string{"payload": base64.StdEncoding.EncodeToString(payload)})
		return data
	}
	if _, err := c.Open("terminal", "synthetic-token"); err != nil {
		t.Fatal(err)
	}
	first, second := make(chan error, 1), make(chan error, 1)
	go func() { _, err := c.Command(frame(target)); first <- err }()
	go func() { _, err := c.Command(frame(sibling)); second <- err }()
	for range 2 {
		select {
		case <-reached:
		case <-time.After(2 * time.Second):
			t.Fatal("fixture missed actual blocked command")
		}
	}
	if c.CancelCommand(strings.Repeat("c", 64)) {
		t.Fatal("unknown nonce canceled another channel")
	}
	if !c.CancelCommand(target) {
		t.Fatal("exact pending command unavailable")
	}
	awaitError(t, first)
	select {
	case nonce := <-ended:
		if nonce != target {
			t.Fatal("wrong remote channel ended")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("exact remote command channel did not close")
	}
	select {
	case <-second:
		t.Fatal("sibling command ended")
	default:
	}
	if _, err := c.Command(frame(strings.Repeat("d", 64))); err != nil {
		t.Fatal("fresh command lost authenticated transport", err)
	}
	if err := c.Input("terminal", "after-cancel\n"); err != nil {
		t.Fatal(err)
	}
	var received string
	until := time.After(2 * time.Second)
	for !strings.Contains(received, "MEMORY-PRESERVED:after-cancel\n") {
		select {
		case data := <-output:
			received += data
		case <-until:
			t.Fatal("terminal IO lost after command cancellation", received)
		}
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.ctx.Err() != nil || c.class == nil || c.panes["terminal"] == nil || len(c.commands) != 1 || c.commands[sibling] == nil {
		t.Fatal("cancellation leaked or destroyed sibling state")
	}
}
