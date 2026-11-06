package client

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"testing"
	"time"
)

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
