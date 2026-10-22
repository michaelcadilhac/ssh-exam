package core

// UNWIRED native monitoring/control clock. Legacy deadline/access calculations
// are intentionally unchanged. Future callers must propagate errors as unknown
// authority, never turn a failed read into expiry, access release or a new lease.

import (
	"errors"
	"math"

	"golang.org/x/sys/unix"
)

var errMonitoringClock = errors.New("native suspend-aware monitoring clock unavailable or out of range; no execution authority established")

func monitoringBootMillis() (int64, error) {
	return checkedMonitoringBootMillis(unix.ClockGettime)
}

func checkedMonitoringBootMillis(read func(int32, *unix.Timespec) error) (int64, error) {
	if read == nil {
		return 0, errMonitoringClock
	}
	var t unix.Timespec
	if read(unix.CLOCK_BOOTTIME, &t) != nil {
		return 0, errMonitoringClock
	}
	sec, nsec := int64(t.Sec), int64(t.Nsec)
	if sec < 0 || nsec < 0 || nsec >= 1000000000 {
		return 0, errMonitoringClock
	}
	part := nsec / 1000000
	if sec > (math.MaxInt64-part)/1000 {
		return 0, errMonitoringClock
	}
	return sec*1000 + part, nil
}
