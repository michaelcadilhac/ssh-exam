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

func panesHelp(out io.Writer) {
	fmt.Fprintln(out, `Usage: sudo examctl panes list ATTEMPT [--limit 1..200 --after PANE]
       sudo examctl panes show ATTEMPT PANE
       sudo examctl panes close ATTEMPT PANE --revision SNAPSHOT --reason TEXT

Native offline root-only targeted pane management. --config FILE defaults to
/etc/exam-agent/agent.json. Help and syntax checks need no root/configuration.
list/show are bounded read-only observations before Engine initialization:
no state lock, key loading, chmod, audit, reconciliation, network or manager query.
--state DIR bypasses configuration for list/show, never close; choose --state
or an explicit --config, not both. Default list page50, maximum200; --after is
the previous next pane UUID cursor, not a timestamp or attempt UUID.

Recorded kinds/incarnations and pending counts are NOT live SSH, monitoring,
writer absence, archive verification, cleanup eligibility or permission to work.
Present=false means absent from captured metadata, not proof that all work ended.
Legacy/startup-unverified records remain inspectable with unsafe_metadata=true
and no close revision. Preserve them and use matching native versions/guards in
the separately authorized drained maintenance workflow; never clear tracking,
invent readiness, force close or restart an installed agent to bypass refusal.

close requires the exact opaque sha256: revision from a fresh show/list and an
8..1000 UTF-8 byte --reason. This is a PANE snapshot, not a clock/grant revision.
New panes have distinct persisted native incarnations even when UI UUIDs repeat.
Replacements, owner/generation/clock/source changes refuse stale intent; healthy
renewals and unrelated pane changes do not invalidate it. A checked root/machine
audit intent is durable BEFORE revocation/termination, not inferred human identity.

WARNING: close irreversibly terminates this recorded pane and its descendants;
unsaved editor buffers may be lost, as with student Close terminal. Pending tokens
are revoked even if cleanup then fails; unconfirmed scopes stay tracked. No
whole-account/process-name kill, clock reset/pause, grant change, account release,
other-pane close, workspace deletion or protected-submission/history mutation.
This is manual closure, not the C3 retained-lockout freeze/recovery workflow.

After a lost reply inspect fresh read-only show with the OLD reviewed revision
retained. Never silently adopt a newer revision or blindly retry against a
replacement. Storage/audit/termination uncertainty is a failure, not fake success.
No bulk/force close or automatic privilege/hold override is supported.

Examples:
  examctl help panes
  sudo examctl panes list ATTEMPT --limit 50
  sudo examctl panes show ATTEMPT PANE --state /var/lib/exam-agent
  sudo examctl panes close ATTEMPT PANE --revision sha256:REVIEWED_DIGEST --reason 'Reviewed target terminal closure'

Exit status: 0 complete metadata or confirmed recorded-target control result,
1 unsafe/partial/unavailable observation or operational refusal,2 invalid syntax.
No local test result authorizes production deployment or service consolidation.`)
}

func panesMain(args []string) int {
	if _, help := helpRequest(args); help {
		panesHelp(os.Stdout)
		return 0
	}
	f := flag.NewFlagSet("examctl panes", flag.ContinueOnError)
	f.SetOutput(io.Discard)
	config := f.String("config", "/etc/exam-agent/agent.json", "native configuration")
	state := f.String("state", "", "existing private state for read-only observation")
	limit := f.Int("limit", 50, "list page size")
	after := f.String("after", "", "exclusive pane UUID")
	revision := f.String("revision", "", "reviewed opaque pane snapshot")
	reason := f.String("reason", "", "durably audited reason")
	usage := func(message string) int { fmt.Fprintln(os.Stderr, message+"; run examctl help panes"); return 2 }
	if err := f.Parse(ordered(args)); err != nil {
		return usage("invalid pane flags")
	}
	w := f.Args()
	if len(w) == 2 && w[0] == "panes" && w[1] == "help" {
		panesHelp(os.Stdout)
		return 0
	}
	if len(w) < 3 || w[0] != "panes" {
		return usage("choose panes list ATTEMPT, show ATTEMPT PANE or close ATTEMPT PANE")
	}
	seen := map[string]bool{}
	f.Visit(func(flag *flag.Flag) { seen[flag.Name] = true })
	q := core.NativePaneQuery{Attempt: w[2], Limit: *limit, After: *after}
	switch w[1] {
	case "list":
		if len(w) != 3 || seen["revision"] || seen["reason"] {
			return usage("list takes one attempt and optional limit/after")
		}
	case "show", "close":
		if len(w) != 4 || seen["limit"] || seen["after"] {
			return usage("select exactly one attempt and one pane UUID, without list filters")
		}
		q.Pane = w[3]
		if w[1] == "show" && (seen["revision"] || seen["reason"]) {
			return usage("show is read-only, without control flags")
		}
		if w[1] == "close" && (seen["state"] || !regexp.MustCompile(`^sha256:[a-f0-9]{64}$`).MatchString(*revision) || !utf8.ValidString(*reason) || len(strings.TrimSpace(*reason)) < 8 || len(strings.TrimSpace(*reason)) > 1000) {
			return usage("close needs --revision sha256:DIGEST and --reason 8..1000 UTF-8 bytes, never --state")
		}
	default:
		return usage("choose list/show/close; no force/bulk closure")
	}
	if err := q.Validate(); err != nil {
		return usage("invalid pane selection")
	}
	if *config == "" || (seen["state"] && (*state == "" || seen["config"])) {
		return usage("choose one nonempty --state DIR or --config FILE for inspection")
	}
	if os.Getuid() != 0 || os.Geteuid() != 0 {
		fmt.Fprintln(os.Stderr, "Native panes require real/effective root; run sudo examctl with identical arguments. Help needs no root/configuration.")
		return 1
	}
	if w[1] != "close" {
		directory := *state
		if directory == "" {
			var err error
			directory, err = core.ReadOnlyConfiguredState(*config)
			if err != nil {
				fmt.Fprintln(os.Stderr, "Cannot resolve private native state read-only; use --state DIR and examctl help panes; no initialization/reconciliation attempted")
				return 1
			}
		}
		result, err := core.ObserveNativePanes(directory, q)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 1
		}
		if err := json.NewEncoder(os.Stdout).Encode(result); err != nil {
			fmt.Fprintln(os.Stderr, "Pane observation output failed; no native record changed")
			return 1
		}
		if !result.Complete {
			fmt.Fprintln(os.Stderr, "Partial/unsafe pane metadata has no close authority. Preserve unknown/legacy/startup records; inspect matching native versions/guards and examctl help panes")
			return 1
		}
		return 0
	}
	c, err := core.LoadConfig(*config)
	if err != nil {
		fmt.Fprintln(os.Stderr, "Cannot load native configuration; use examctl config show/validate and help panes, preserving files; no close requested")
		return 1
	}
	// Refuse unsafe/missing state BEFORE New could initialize/repair it. The
	// actual mutation repeats the source/owner/incarnation fence under WithState.
	view, err := core.ObserveNativePanes(c.State, q)
	if err != nil || len(view.Panes) != 1 || view.Panes[0].Unsafe || view.Panes[0].Revision != *revision {
		fmt.Fprintln(os.Stderr, "Pane snapshot changed, unavailable or unsafe; inspect fresh panes show and explicitly review; no close requested")
		return 1
	}
	e, err := core.New(c)
	if err != nil {
		fmt.Fprintln(os.Stderr, "Native state unavailable; preserve it and inspect config/help panes; no close requested")
		return 1
	}
	result, err := e.CloseNativePane(q.Attempt, q.Pane, *revision, *reason)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		fmt.Fprintln(os.Stderr, "Inspect fresh read-only panes show; preserve old intent/revision and never clear holds, records or markers to force closure")
		return 1
	}
	if err := json.NewEncoder(os.Stdout).Encode(result); err != nil {
		fmt.Fprintln(os.Stderr, "Pane result output failed after control; inspect fresh read-only status before any explicitly reviewed retry")
		return 1
	}
	return 0
}
