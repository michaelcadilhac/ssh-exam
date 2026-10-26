package main

import (
	"encoding/json"
	"examworkspace/agent/internal/core"
	"flag"
	"fmt"
	"io"
	"os"
	"regexp"
	"strings"
	"unicode/utf8"
)

func recoveryGrantsHelp(out io.Writer) {
	fmt.Fprintln(out, `Usage: sudo examctl recovery-grants [--exam EXAM]
       sudo examctl recovery-grants revoke-preview EXAM USER
       sudo examctl recovery-grants revoke EXAM USER --review HASH --reason TEXT

Inspect native-only legacy saved-work permissions or explicitly cancel ONLY an
unused permission. Offline root management on the class server; no web login.
Default JSON inspection is bounded/read-only; source_recorded_protected is recorded
metadata, never a fresh archive integrity check. consumed/uncertain/prepared/pending
authority or contradictory workspace/submission/consumption evidence refuses revoke.
Review the exact preview/hash; stale confirmation never silently adopts new state.

Cancellation is permanent. Original JSON bytes/source/allowance/issuance and audit
remain in a versioned record; old readers refuse it rather than serving starter files.
No exam starts, allowance is consumed, file is deleted, process is terminated or
account restriction is released. An audit/publication error may leave an uncertain
outcome: inspect and retry the SAME EXAM USER/review/reason. The stored receipt makes
a lost-reply retry idempotent. Cancelled permission cannot be revised or reopened.

Then use examctl web grants help to create a reviewed NEW permission with explicitly
chosen files/allowance/finite Begin window. Saved files require durable native
source-sync before availability. If replacement fails, the student must wait;
the old permission remains cancelled. Original account holds need their own normal
release or separately reviewed override. Do not delete JSON/markers or clear history.
Use a matching native cohort that understands cancellation records for the NEW
grant. Old ad hoc writers must be quiesced; never mix native writers or restart exams.

Examples:
  examctl help recovery-grants
  sudo examctl recovery-grants --exam retake
  sudo examctl recovery-grants revoke-preview retake student01
  sudo examctl recovery-grants revoke retake student01 --review PREVIEW-HASH --reason 'Cancel unused permission before reviewed replacement'
  sudo examctl web grants help

--config FILE selects protected native configuration (default /etc/exam-agent/agent.json).
Output is JSON; --json is accepted for existing inspection scripts.
Help/syntax need no root/configuration. Actual operations require real/effective root.
Exit status: 0 inspection/confirmed cancellation, 1 refusal/unavailable/unconfirmed,
2 invalid syntax. Times are UTC Unix milliseconds; duration is seconds.`)
}

func recoveryGrantsMain(args []string) int {
	if _, help := helpRequest(args); help {
		recoveryGrantsHelp(os.Stdout)
		return 0
	}
	f := flag.NewFlagSet("examctl recovery-grants", flag.ContinueOnError)
	f.SetOutput(os.Stderr)
	config := f.String("config", "/etc/exam-agent/agent.json", "protected native configuration")
	f.Bool("json", false, "JSON output (the default; retained for existing scripts)")
	exam := f.String("exam", "", "default-list exam filter")
	review := f.String("review", "", "exact cancellation preview hash")
	reason := f.String("reason", "", "8..1000-byte audited cancellation reason")
	usage := func(message string) int {
		fmt.Fprintln(os.Stderr, message+"; run examctl recovery-grants help")
		return 2
	}
	if err := f.Parse(ordered(args)); err != nil {
		return usage("invalid recovery-grants flags")
	}
	w := f.Args()
	if len(w) == 2 && w[0] == "recovery-grants" && w[1] == "help" {
		recoveryGrantsHelp(os.Stdout)
		return 0
	}
	provided := map[string]bool{}
	f.Visit(func(value *flag.Flag) { provided[value.Name] = true })
	listing := len(w) == 1 && w[0] == "recovery-grants"
	action := ""
	if !listing {
		if len(w) != 4 || w[0] != "recovery-grants" || (w[1] != "revoke-preview" && w[1] != "revoke") || provided["exam"] {
			return usage("choose the default list or revoke-preview/revoke EXAM USER")
		}
		action = w[1]
	}
	if action != "revoke" && (provided["reason"] || provided["review"]) {
		return usage("--review/--reason are supported only by revoke")
	}
	identifier := regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)
	if (listing && *exam != "" && !identifier.MatchString(*exam)) || (!listing && (!identifier.MatchString(w[2]) || !identifier.MatchString(w[3]))) {
		return usage("choose exact EXAM and USER identifiers from recovery-grants; use only 1..64 letters, digits, underscores or hyphens")
	}
	if action == "revoke" {
		valid, _ := regexp.MatchString("^[a-f0-9]{64}$", *review)
		if !valid || !utf8.ValidString(*reason) || len(strings.TrimSpace(*reason)) < 8 || len(*reason) > 1000 {
			return usage("revoke requires exact --review HASH and --reason of 8..1000 UTF-8 bytes")
		}
	}
	if os.Getuid() != 0 || os.Geteuid() != 0 {
		fmt.Fprintln(os.Stderr, "Run recovery-grants as real/effective root on the class server with the same arguments; help needs no root")
		return 1
	}
	c, err := core.LoadConfig(*config)
	if err != nil {
		fmt.Fprintln(os.Stderr, "Cannot load protected native configuration:", err)
		return 1
	}
	e := &core.Engine{Config: c} // No native initialization, chmod or reconciliation.
	var result any
	if listing {
		result, err = e.RecoveryGrants(*exam)
	} else if action == "revoke-preview" {
		result, err = e.PreviewRecoveryRevocation(w[2], w[3])
	} else {
		result, err = e.RevokeRecoveryPermission(w[2], w[3], *review, *reason)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		if action == "revoke" {
			fmt.Fprintf(os.Stderr, "Cancellation not confirmed. Inspect: examctl recovery-grants --exam %s. If cancelled, retry this SAME review/reason; otherwise run examctl recovery-grants revoke-preview %s %s and explicitly review again. Preserve history/source files; repair reported audit/storage issues before retry.\n", w[2], w[2], w[3])
		}
		return 1
	}
	if err := json.NewEncoder(os.Stdout).Encode(result); err != nil {
		fmt.Fprintln(os.Stderr, "Output unavailable; inspect recovery-grants and retry the SAME cancellation intent if needed")
		return 1
	}
	return 0
}
