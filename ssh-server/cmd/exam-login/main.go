package main

import (
	"examworkspace/agent/internal/core"
	"fmt"
	"os"
)

func main() {
	if err := core.Gate("/run/exam-agent/gate.sock"); err != nil {
		fmt.Fprintln(os.Stderr, "EXAM-ERROR: access denied by exam guard")
		os.Exit(1)
	}
}
