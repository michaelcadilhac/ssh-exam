package client

import (
	"bufio"
	"context"
	"encoding/json"
	"golang.org/x/crypto/ssh"
	"sync"
	"testing"
	"time"
)

func cleanupClient(t *testing.T, handler func(ssh.Channel, <-chan *ssh.Request), emit func(any)) *Client {
	t.Helper()
	h := hosts(t, false, false, false)
	h.mu.Lock()
	h.sessionFn = handler
	h.mu.Unlock()
	c := New(emit)
	t.Cleanup(c.Close)
	if err := c.Connect(raw(t, h), "student", h.jump, h.class, func(_ context.Context, _ string, _ string, p []Prompt) ([]string, error) {
		if len(p) == 0 {
			return []string{}, nil
		}
		return []string{h.password}, nil
	}); err != nil {
		t.Fatal(err)
	}
	return c
}
func awaitError(t *testing.T, result <-chan error) {
	t.Helper()
	select {
	case err := <-result:
		if err == nil {
			t.Fatal("cancelled operation succeeded")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("cancelled SSH operation did not end")
	}
}
func TestCloseCancelsInflightCommandAndTerminalAdmission(t *testing.T) {
	reached := make(chan string, 2)
	c := cleanupClient(t, func(s ssh.Channel, reqs <-chan *ssh.Request) {
		defer s.Close()
		for req := range reqs {
			req.Reply(true, nil)
			if req.Type != "exec" {
				continue
			}
			var command struct{ Command string }
			ssh.Unmarshal(req.Payload, &command)
			r := bufio.NewReader(s)
			if command.Command == "exam-gateway" {
				s.Write([]byte("EXAM-GATE/1\n"))
			}
			r.ReadString('\n')
			reached <- command.Command
			r.ReadString('\n')
			return
		}
	}, func(any) {})
	command, terminal := make(chan error, 1), make(chan error, 1)
	go func() { _, err := c.Command(json.RawMessage(`{}`)); command <- err }()
	go func() { _, err := c.Open("pane", "token"); terminal <- err }()
	for range 2 {
		select {
		case <-reached:
		case <-time.After(2 * time.Second):
			t.Fatal("fixture not reached")
		}
	}
	c.Close()
	c.Close()
	awaitError(t, command)
	awaitError(t, terminal)
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.panes) != 0 || len(c.opening) != 0 || c.class != nil || c.jump != nil {
		t.Fatal("SSH references survived shutdown")
	}
}
func TestClosePaneCancelsPendingAdmissionWithoutEndingOtherSessions(t *testing.T) {
	reached := make(chan struct{}, 1)
	var mu sync.Mutex
	stalled := true
	c := cleanupClient(t, func(s ssh.Channel, reqs <-chan *ssh.Request) {
		defer s.Close()
		for req := range reqs {
			req.Reply(true, nil)
			if req.Type != "exec" {
				continue
			}
			s.Write([]byte("EXAM-GATE/1\n"))
			r := bufio.NewReader(s)
			r.ReadString('\n')
			mu.Lock()
			stall := stalled
			mu.Unlock()
			if stall {
				reached <- struct{}{}
				r.ReadString('\n')
				return
			}
			s.Write([]byte("EXAM-READY {}\n"))
			r.ReadString('\n')
			return
		}
	}, func(any) {})
	first := make(chan error, 1)
	go func() { _, err := c.Open("pane", "token"); first <- err }()
	select {
	case <-reached:
	case <-time.After(2 * time.Second):
		t.Fatal("admission not reached")
	}
	if _, err := c.Open("pane", "duplicate"); err == nil {
		t.Fatal("duplicate pending pane accepted")
	}
	c.ClosePane("pane")
	c.ClosePane("pane")
	awaitError(t, first)
	mu.Lock()
	stalled = false
	mu.Unlock()
	if _, err := c.Open("pane", "fresh"); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Open("other", "fresh"); err != nil {
		t.Fatal(err)
	}
	c.ClosePane("pane")
	c.mu.Lock()
	other := c.panes["other"]
	c.mu.Unlock()
	if other == nil || c.ctx.Err() != nil {
		t.Fatal("closing one pane ended another session")
	}
	c.ClosePane("other")
}
