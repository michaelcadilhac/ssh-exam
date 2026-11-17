package client

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"golang.org/x/crypto/ssh"
	"io"
	"strings"
	"sync"
	"testing"
	"time"
)

func pressureFrame(n int, op string) json.RawMessage {
	payload, _ := json.Marshal(map[string]string{"nonce": fmt.Sprintf("pressure-command-%032d", n), "op": op})
	frame, _ := json.Marshal(map[string]string{"payload": base64.StdEncoding.EncodeToString(payload)})
	return frame
}

func TestCommandPressurePreservesFourthPaneAndLeaseChannel(t *testing.T) {
	for _, delay := range []time.Duration{0, 30 * time.Millisecond} {
		t.Run(delay.String(), func(t *testing.T) { commandPressure(t, delay, false) })
	}
}

func TestCloseCancelsRetiringCommandAndQueuedSiblings(t *testing.T) {
	commandPressure(t, 30*time.Millisecond, true)
}

func commandPressure(t *testing.T, retirement time.Duration, closeEarly bool) {
	t.Helper()
	h := hosts(t, false, false, false)
	h.sessionLimit.Store(8) // Same finite limit as the shipped SSH example.
	release := make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	defer unblock()
	retireLease := make(chan struct{})
	var leaseOnce sync.Once
	finishLease := func() { leaseOnce.Do(func() { close(retireLease) }) }
	defer finishLease()
	reached := make(chan string, 128)
	h.mu.Lock()
	h.sessionFn = func(s ssh.Channel, requests <-chan *ssh.Request) {
		defer s.Close()
		for request := range requests {
			request.Reply(true, nil)
			if request.Type != "exec" {
				continue
			}
			var command struct{ Command string }
			if ssh.Unmarshal(request.Payload, &command) != nil {
				return
			}
			reader := bufio.NewReader(s)
			if command.Command == "exam-gateway" {
				s.Write([]byte("EXAM-GATE/1\n"))
				reader.ReadString('\n')
				s.Write([]byte("EXAM-READY {}\n"))
				io.Copy(io.Discard, reader)
				return
			}
			line, err := reader.ReadBytes('\n')
			if err != nil {
				return
			}
			var envelope struct{ Payload string }
			json.Unmarshal(line, &envelope)
			payload, _ := base64.StdEncoding.DecodeString(envelope.Payload)
			var call struct{ Nonce, Op string }
			json.Unmarshal(payload, &call)
			if call.Op != "renew-execution-lease" {
				reached <- call.Nonce
				<-release
			}
			s.Write([]byte("{\"ok\":true}\n"))
			if call.Op == "renew-execution-lease" {
				<-retireLease
			}
			time.Sleep(retirement)
			return
		}
	}
	h.mu.Unlock()
	c := New(func(any) {})
	defer c.Close()
	if err := c.Connect(raw(t, h), "student", h.jump, h.class, func(_ context.Context, _, _ string, p []Prompt) ([]string, error) {
		if len(p) == 0 {
			return []string{}, nil
		}
		return []string{h.password}, nil
	}); err != nil {
		t.Fatal(err)
	}
	for n := 0; n < 3; n++ {
		if _, err := c.Open(fmt.Sprint("pane-", n), "synthetic"); err != nil {
			t.Fatal(err)
		}
	}
	const count = 63
	results := make(chan error, count)
	for n := 0; n < count; n++ {
		go func(n int) { _, err := c.Command(pressureFrame(n, "inspect-attempt")); results <- err }(n)
	}
	started := map[string]bool{}
	for range 2 {
		select {
		case nonce := <-reached:
			started[nonce] = true
		case <-time.After(2 * time.Second):
			t.Fatal("fixture did not receive two pending SSH commands")
		}
	}
	until := time.After(2 * time.Second)
	for {
		c.mu.Lock()
		pending := len(c.commands)
		c.mu.Unlock()
		if pending == count {
			break
		}
		select {
		case err := <-results:
			t.Fatalf("ordinary command refused under pressure: %v", err)
		case <-until:
			t.Fatal("commands did not enter their inspectable pending state")
		case <-time.After(time.Millisecond):
		}
	}
	renewed := make(chan error, 1)
	go func() { _, err := c.Command(pressureFrame(99, "renew-execution-lease")); renewed <- err }()
	select {
	case err := <-renewed:
		if err != nil {
			t.Fatal("live lease channel lost to diagnostic pressure", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("valid reply was delayed by remote channel retirement")
	}
	if len(c.commandSlots) != 3 {
		t.Fatal("reply released the still-retiring SSH channel budget")
	}
	if closeEarly {
		c.Close()
		for range count {
			select {
			case err := <-results:
				if err == nil {
					t.Fatal("closed owner transmitted a queued ordinary command")
				}
			case <-time.After(2 * time.Second):
				t.Fatal("closed owner did not cancel queued/active siblings")
			}
		}
	} else {
		if _, err := c.Command(pressureFrame(100, "inspect-attempt")); err == nil || !strings.Contains(err.Error(), "capacity") {
			t.Fatal("ordinary queue must retain a slot for live renewal", err)
		}
		cancelled := ""
		for n := 0; n < count; n++ {
			nonce := fmt.Sprintf("pressure-command-%032d", n)
			if !started[nonce] {
				cancelled = nonce
				break
			}
		}
		if !c.CancelCommand(cancelled) {
			t.Fatal("queued command was not inspectable/cancellable")
		}
		select {
		case err := <-results:
			if !errors.Is(err, context.Canceled) {
				t.Fatal("queued cancellation lost identity", err)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("queued cancellation did not settle")
		}
		if _, err := c.Open("pane-3", "synthetic"); err != nil {
			t.Fatal("fourth pane refused under command pressure", err)
		}
		finishLease()
		unblock()
		for range count - 1 {
			select {
			case err := <-results:
				if err != nil {
					t.Fatal("queued command lost authenticated transport", err)
				}
			case <-time.After(3 * time.Second):
				t.Fatal("queued command did not complete")
			}
		}
		if len(reached) != count-3 {
			t.Fatalf("unexpected ordinary SSH command count: %d", len(reached)+2)
		}
		for len(reached) > 0 {
			if <-reached == cancelled {
				t.Fatal("cancelled queued command reached the class server")
			}
		}
		c.mu.Lock()
		panes := len(c.panes)
		pending := len(c.commands)
		c.mu.Unlock()
		if panes != 4 || pending != 0 {
			t.Fatalf("unexpected final transport state: %d panes, %d pending commands", panes, pending)
		}
	}
	until = time.After(2 * time.Second)
	for len(c.commandSlots) != 0 || len(c.ordinarySlots) != 0 {
		select {
		case <-until:
			t.Fatal("retiring command slots leaked after completion/owner close")
		case <-time.After(time.Millisecond):
		}
	}
}
