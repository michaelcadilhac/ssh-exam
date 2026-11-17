package client

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"golang.org/x/crypto/ssh"
	"io"
	"strings"
	"testing"
	"time"
)

func TestNativeGateRefusalIsTypedWithoutClosingHealthySiblings(t *testing.T) {
	c := cleanupClient(t, func(s ssh.Channel, requests <-chan *ssh.Request) {
		defer s.Close()
		for request := range requests {
			request.Reply(true, nil)
			if request.Type != "exec" {
				continue
			}
			var command struct{ Command string }
			ssh.Unmarshal(request.Payload, &command)
			reader := bufio.NewReader(s)
			if command.Command == "exam-gateway" {
				io.WriteString(s, "EXAM-GATE/1\n")
				line, _ := reader.ReadString('\n')
				if strings.Contains(line, "healthy") {
					io.WriteString(s, "EXAM-READY {}\n")
					io.Copy(io.Discard, reader)
				} else {
					io.WriteString(s, "EXAM-ERROR: PRIVATE native detail\n")
				}
			} else {
				reader.ReadString('\n')
				io.WriteString(s, "{}\n")
			}
			return
		}
	}, func(any) {})
	if _, err := c.Open("one", "healthy"); err != nil {
		t.Fatal(err)
	}
	_, err := c.Open("two", "refuse")
	if err == nil || FailureCause(err) != "admission-refused" || strings.Contains(err.Error(), "PRIVATE") {
		t.Fatal("native gate refusal was absent, untyped or leaked", err)
	}
	c.mu.Lock()
	healthy := c.class != nil && len(c.panes) == 1 && c.panes["one"] != nil
	c.mu.Unlock()
	if !healthy {
		t.Fatal("one refusal lost healthy sibling ownership")
	}
	if _, err := c.Command(json.RawMessage(`{}`)); err != nil {
		t.Fatal("one refusal closed the authenticated SSH", err)
	}
	if FailureCause(errors.New("session admission rejected")) == "admission-refused" {
		t.Fatal("raw text was treated as definite native refusal")
	}
}

func TestCurrentSSHCloseReportsOneSanitizedCause(t *testing.T) {
	h := hosts(t, false, false, false)
	events := make(chan any, 8)
	c := New(func(v any) { events <- v })
	defer c.Close()
	if err := c.Connect(raw(t, h), "student", h.jump, h.class, func(_ context.Context, _, _ string, p []Prompt) ([]string, error) {
		if len(p) == 0 {
			return []string{}, nil
		}
		return []string{h.password}, nil
	}); err != nil {
		t.Fatal(err)
	}
	c.mu.Lock()
	current := c.class
	c.mu.Unlock()
	current.Close()
	select {
	case event := <-events:
		raw, _ := json.Marshal(event)
		if !strings.Contains(string(raw), `"type":"loss"`) || !strings.Contains(string(raw), `"diagnostic"`) || strings.Contains(string(raw), h.password) {
			t.Fatalf("unsafe or absent close category: %s", raw)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("current SSH exit not reported")
	}
	select {
	case e := <-events:
		t.Fatalf("duplicate loss: %+v", e)
	case <-time.After(20 * time.Millisecond):
	}
}
func TestTransportFailureCategoriesNeverCopyErrors(t *testing.T) {
	if cause := FailureCause(&ssh.OpenChannelError{Reason: ssh.ResourceShortage, Message: "PRIVATE server detail"}); cause != "channel-capacity" {
		t.Fatal("channel capacity was not categorized safely", cause)
	}
	for _, err := range []error{errors.New("password=PRIVATE-MFA"), io.EOF, context.DeadlineExceeded, context.Canceled} {
		cause := FailureCause(err)
		if strings.Contains(cause, "PRIVATE") || cause == err.Error() {
			if err != io.EOF {
				t.Fatal("raw error category")
			}
		}
	}
	if FailureCause(context.DeadlineExceeded) != "timeout" || OperationTimeout != 60*time.Second {
		t.Fatal("operational deadline changed")
	}
}
