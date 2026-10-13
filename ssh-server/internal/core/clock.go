package core

import "syscall"

// Query the kernel's disciplined clock, which also covers a container sharing
// its synchronized host clock. Modes zero is read-only and never changes time.
func clockSynchronized() bool { return synchronizedClock(syscall.Adjtimex) }

func synchronizedClock(read func(*syscall.Timex) (int, error)) bool {
	var tx syscall.Timex
	state, err := read(&tx)
	const staUnsync = 0x0040 // Linux adjtimex STA_UNSYNC
	return err == nil && state >= 0 && state < 5 && tx.Status&staUnsync == 0
}
