package core

import (
	"os"
	"strconv"
	"strings"
)

// The privileged launcher must drop to the real account before any user code.
// Root UID alone does not prove it can do so under service capability policy.
func setupCapabilitiesAvailable() bool {
	b, err := os.ReadFile("/proc/self/status")
	if err != nil {
		return false
	}
	const required uint64 = (1 << 6) | (1 << 7) | (1 << 8) // SETGID, SETUID, SETPCAP
	for _, line := range strings.Split(string(b), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && fields[0] == "CapEff:" {
			mask, err := strconv.ParseUint(fields[1], 16, 64)
			return err == nil && mask&required == required
		}
	}
	return false
}
