package main

import (
	"encoding/json"
	"examworkspace/agent/internal/core"
	"flag"
	"fmt"
	"io"
	"os"
	"regexp"
	"strconv"
	"strings"
)

func workspacesHelp(out io.Writer) {
	fmt.Fprintln(out, `Usage: sudo examctl workspaces list [--exam EXAM --limit N --after ATTEMPT]
       sudo examctl workspaces show ATTEMPT
       sudo examctl workspaces hold ATTEMPT --revision N --reason TEXT
       sudo examctl workspaces release-hold ATTEMPT --revision N --reason TEXT

Local root-only workspace retention metadata, using the native attempt/job lock.
Offline from the gateway; no new network/API or student credentials. --config
FILE defaults to /etc/exam-agent/agent.json. Help needs no root/configuration.

list pages KNOWN native attempts by ID, not time: default 100, range 1..200.
--after is the previous next cursor; keep --exam stable while paging. Unknown/
orphan folders are not enumerated or eligible for cleanup; preserve them for a
separate supported proof workflow. show reports exact configured UUID paths,
decimal-string device/inode identities, state, current/original deadlines and
recorded protection. It does not recursively read student files or hash archives.

IMPORTANT: candidate=true is only an absence of obvious metadata blockers.
eligible=false and archive_verified=false are intentional: fresh archive,
termination, other-namespace mounts and process-use proof are NOT implemented.
NO WORKSPACE DELETION COMMAND IS ENABLED. An archive filename/checksum or expired
account hold is not proof that an old workspace may safely be removed.

hold/release-hold require show's integer HOLD revision, not a clock revision or
definition hash, plus an 8..1000 UTF-8 byte permanently audited operator reason.
No inherited all-students mutation. A stale revision refuses without changing
the hold. After a lost reply inspect fresh show; do not silently adopt a later
revision or clear someone else's hold. Hold changes never delete work or change
attempt clocks/access, grants, protected submissions, receipts or monitoring.
There is no automatic cleanup or grace period. Releasing a hold is NOT cleanup
eligibility and never releases the original/current account restriction.

Retention files and independent initialized/known markers survive older unrelated
state.json writers. Missing/unsafe/malformed known metadata fails closed; preserve
it and restore a consistent verified private backup, never delete markers or edit
JSON to make a refusal disappear. Incomplete marker publication with intact
records can be repaired by a deliberately reviewed hold/release-hold operation.
Audit/storage/durability failures are not acknowledged success; inspect current
revision before retrying. Pending collection/initialization fences may refuse.

Examples:
  sudo examctl workspaces list --exam midterm --limit 50
  sudo examctl workspaces show ATTEMPT
  sudo examctl info ATTEMPT
  sudo examctl workspaces hold ATTEMPT --revision 0 --reason 'Retain workspace for investigation'
  sudo examctl workspaces release-hold ATTEMPT --revision 1 --reason 'Investigation complete; independent proof still required'

Exit status: 0 metadata/control result (never deletion eligibility),
1 operational refusal/failure, 2 invalid syntax. No production action is implied.`)
}

func workspacesMain(args []string) int {
	if _, help := helpRequest(args); help {
		workspacesHelp(os.Stdout)
		return 0
	}
	flags := flag.NewFlagSet("examctl workspaces", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	config := flags.String("config", "/etc/exam-agent/agent.json", "root configuration")
	exam := flags.String("exam", "", "list exam filter")
	limit := flags.Int("limit", 100, "page size")
	after := flags.String("after", "", "exclusive attempt cursor")
	revision := flags.String("revision", "", "reviewed hold revision")
	reason := flags.String("reason", "", "audited UTF-8 reason")
	usage := func(message string) int { fmt.Fprintln(os.Stderr, message+"; run examctl help workspaces"); return 2 }
	if err := flags.Parse(ordered(args)); err != nil {
		return usage("invalid workspace flags")
	}
	w := flags.Args()
	if len(w) == 2 && w[1] == "help" {
		workspacesHelp(os.Stdout)
		return 0
	}
	if len(w) < 2 || w[0] != "workspaces" {
		return usage("choose list/show/hold/release-hold")
	}
	seen := map[string]bool{}
	flags.Visit(func(f *flag.Flag) { seen[f.Name] = true })
	ref := regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`)
	var rev int64
	switch w[1] {
	case "list":
		if len(w) != 2 || *limit < 1 || *limit > 200 || (*exam != "" && !regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`).MatchString(*exam)) || (*after != "" && !ref.MatchString(*after)) || seen["revision"] || seen["reason"] {
			return usage("list needs only optional exam/limit/after filters")
		}
	case "show", "hold", "release-hold":
		if len(w) != 3 || !ref.MatchString(w[2]) || seen["exam"] || seen["limit"] || seen["after"] {
			return usage("select exactly one attempt UUID, without list filters")
		}
		if w[1] == "show" {
			if seen["reason"] || seen["revision"] {
				return usage("show is inspection, without control flags")
			}
		} else {
			var err error
			rev, err = strconv.ParseInt(*revision, 10, 64)
			if err != nil || rev < 0 || len(strings.TrimSpace(*reason)) < 8 || len(strings.TrimSpace(*reason)) > 1000 {
				return usage("hold/release-hold needs reviewed --revision >=0 and --reason 8..1000 UTF-8 bytes")
			}
		}
	default:
		return usage("workspace deletion is not enabled; choose list/show/hold/release-hold")
	}
	if os.Getuid() != 0 || os.Geteuid() != 0 {
		fmt.Fprintln(os.Stderr, "Workspace controls require real/effective root; run sudo examctl with identical arguments. Help is available without privilege.")
		return 1
	}
	c, err := core.LoadConfig(*config)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Cannot load root configuration %q: %v; use --config FILE and examctl help workspaces\n", *config, err)
		return 1
	}
	e, err := core.New(c)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	var result any
	switch w[1] {
	case "list":
		result, err = e.WorkspaceRetentions(*exam, *after, *limit)
	case "show":
		result, err = e.WorkspaceRetention(w[2])
	default:
		result, err = e.SetWorkspaceHold(w[2], w[1] == "hold", rev, *reason)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		fmt.Fprintln(os.Stderr, "Preserve workspace/retention evidence. Use examctl workspaces show ATTEMPT and native examctl info ATTEMPT; unknown/orphan paths and unresolved verification never authorize deletion. Run examctl help workspaces.")
		return 1
	}
	if err := json.NewEncoder(os.Stdout).Encode(result); err != nil {
		fmt.Fprintln(os.Stderr, "Result output failed; inspect fresh workspace status before retrying:", err)
		return 1
	}
	return 0
}
