package core

import (
	"errors"
	"syscall"
	"testing"
)

func TestClockQueryIsReadOnlyAndFailsClosed(t *testing.T) {
	for _, c := range []struct {
		name   string
		state  int
		status int32
		err    error
		want   bool
	}{
		{"disciplined", 0, 8193, nil, true},
		{"leap-second", 1, 0, nil, true},
		{"unsynchronized", 0, 0x40, nil, false},
		{"kernel-time-error", 5, 0, nil, false},
		{"unavailable", -1, 0, errors.New("query denied"), false},
	} {
		t.Run(c.name, func(t *testing.T) {
			got := synchronizedClock(func(tx *syscall.Timex) (int, error) {
				if tx.Modes != 0 {
					t.Fatal("clock query attempted to modify time")
				}
				tx.Status = c.status
				return c.state, c.err
			})
			if got != c.want {
				t.Fatalf("synchronized=%v", got)
			}
		})
	}
}
