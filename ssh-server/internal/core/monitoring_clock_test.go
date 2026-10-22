package core

import (
	"errors"
	"math"
	"testing"

	"golang.org/x/sys/unix"
)

func TestMonitoringBootClockUsesReadOnlySuspendAwareIntegerTimeWithBounds(t *testing.T) {
	for _, c := range []struct {
		sec, nsec, want int64
		valid           bool
	}{
		{0, 0, 0, true}, {10, 999999999, 10999, true}, {10, 1, 10000, true},
		{-1, 0, 0, false}, {0, -1, 0, false}, {0, 1000000000, 0, false},
		{math.MaxInt64 / 1000, (math.MaxInt64 % 1000) * 1000000, math.MaxInt64, true},
		{math.MaxInt64 / 1000, (math.MaxInt64%1000 + 1) * 1000000, 0, false}, {math.MaxInt64, 0, 0, false},
	} {
		calls := 0
		got, err := checkedMonitoringBootMillis(func(clock int32, ts *unix.Timespec) error {
			calls++
			if clock != unix.CLOCK_BOOTTIME || *ts != (unix.Timespec{}) {
				t.Fatal("clock query used wrong source or nonzero request")
			}
			ts.Sec = c.sec
			ts.Nsec = c.nsec
			return nil
		})
		if calls != 1 || (err == nil) != c.valid || got != c.want {
			t.Fatal(c, got, err, calls)
		}
	}
	for _, read := range []func(int32, *unix.Timespec) error{nil, func(int32, *unix.Timespec) error { return errors.New("private syscall details") }} {
		if got, err := checkedMonitoringBootMillis(read); got != 0 || err != errMonitoringClock {
			t.Fatal("failed clock invented time or leaked error", got, err)
		}
	}
}

func TestMonitoringBootClockReadsTheActualLocalKernelWithoutChangingTime(t *testing.T) {
	a, err := monitoringBootMillis()
	if err != nil || a < 0 {
		t.Fatal(a, err)
	}
	b, err := monitoringBootMillis()
	if err != nil || b < a {
		t.Fatal("local boot clock unavailable/backwards", a, b, err)
	}
}
