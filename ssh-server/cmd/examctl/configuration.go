package main

import (
	"encoding/json"
	"examworkspace/agent/internal/core"
	"flag"
	"fmt"
	"io"
	"os"
)

func configurationHelp(out io.Writer) {
	fmt.Fprintln(out, `Usage: sudo examctl config show [--config FILE --paths]
       sudo examctl config validate [--config FILE --paths]

Offline read-only observation of ONE explicitly selected native configuration.
--config defaults to /etc/exam-agent/agent.json. Select a separate staged candidate
with --config /private/candidate.json; that does NOT select it for runtime/apply.
show reads bounded configuration only, without opening keys. Default output
redacts paths; --paths explicitly includes path metadata, NEVER key bytes.
validate additionally checks bounded pinned configured signing keys/optional CAs.
Unknown/duplicate/deep JSON, links/FIFOs, unsafe modes/owners/changed files refuse.
No state initialization/chmod, lock/audit write, reconciliation, network/socket/
service probe, permission repair, key rotation, configuration apply or restart.
No apply command is enabled. Preserve files; follow separately authorized drained
maintenance for service-affecting changes. This does not validate gateway config.

structural_valid is selected-file policy; key_files_checked distinguishes show
from validate. validated:true means this OFFLINE check only, NOT SSH, clock, PAM,
containment, monitoring, loaded systemd controls or production readiness. applied
is always false. Reads are per-file interval observations, not an atomic set or
proof that a running service loaded them. Future apply must recheck the exact
reviewed candidate/hash and actual controls in a separately authorized drain.
An invalid parse has empty stdout; valid-shaped observations
with issues have safe JSON and exit1. No error includes private key/file bytes.
Root is required for observations; help/syntax need no root or configuration.

Examples:
  examctl help config
  sudo examctl config show
  sudo examctl config show --paths
  sudo examctl config validate --config /private/staged-agent.json

Exit status: 0 complete observation/offline validation, NOT apply/readiness;
1 unsafe/unavailable/invalid observation or validation issues; 2 usage error.`)
}
func configurationMain(args []string) int {
	if _, help := helpRequest(args); help {
		configurationHelp(os.Stdout)
		return 0
	}
	f := flag.NewFlagSet("examctl config", flag.ContinueOnError)
	f.SetOutput(os.Stderr)
	config := f.String("config", "/etc/exam-agent/agent.json", "selected existing configuration or separate candidate")
	paths := f.Bool("paths", false, "explicitly show filesystem paths, never key material")
	usage := func(message string) int { fmt.Fprintln(os.Stderr, message+"; run examctl config help"); return 2 }
	if err := f.Parse(ordered(args)); err != nil {
		return usage("invalid configuration flags")
	}
	words := f.Args()
	if len(words) == 2 && words[0] == "config" && words[1] == "help" {
		configurationHelp(os.Stdout)
		return 0
	}
	if len(words) != 2 || words[0] != "config" || (words[1] != "show" && words[1] != "validate") || *config == "" {
		return usage("choose config show or validate, optionally --config FILE and --paths; apply is not enabled")
	}
	if os.Getuid() != 0 || os.Geteuid() != 0 {
		fmt.Fprintln(os.Stderr, "Run examctl config observation as root with the same arguments; no state/configuration is changed. See config help")
		return 1
	}
	result, err := core.ObserveNativeConfiguration(*config, words[1] == "validate", *paths)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	if err := json.NewEncoder(os.Stdout).Encode(result); err != nil {
		fmt.Fprintln(os.Stderr, "Configuration observation output unavailable; no file was applied or repaired")
		return 1
	}
	if len(result.Issues) > 0 {
		fmt.Fprintln(os.Stderr, "Configuration has offline inspection issues; inspect JSON component/action and config help, preserving existing files and runtime policy")
		return 1
	}
	return 0
}
