package main

import (
	"flag"
	"fmt"
	"io"
	"os"
	"regexp"
)

func webAttemptsHelp(out io.Writer) {
	fmt.Fprintln(out, `Usage: sudo examctl web attempts list EXAM [--view VIEW] [--q USER] [--limit 100] [--after ATTEMPT]
       sudo examctl web attempts show ATTEMPT

Read bounded current gateway attempt metadata through the existing signed root
agent HTTPS management identity and explicit attempts.list/show authorization.
No student SSH, new token/listener or native change. Native examctl list/info
remain available offline and show full native clock/history/recovery detail.

list requires the exam ID; show takes the attempt ID from list, not an exam ID.
VIEW: all (default), working, attention, secured, camera, no-camera, PREPARING,
ACTIVE, LOCKED, FINALIZING, COMPLETED, COLLECTION_FAILED, CANCELLED_BEFORE_START.
--q is the same username LIKE search as the dashboard (max 64 characters).
limit bounds SCANNED rows (1..200); filtered pages may be empty with next set.
--after is an exclusive attempt-ID cursor, ordered by ID, not start time. Keep
the same exam/search/view while paging; start a fresh list for a new snapshot.

Output identifies gateway metadata, not fresh native verification. It includes
frozen settings, current/original clocks, revision, current presence and pending
clock intent; no page hashes/session secrets, student interruption/review text,
media, terminal payload or unbounded historical reset arrays are cached. Treat
working/presence as observation, never native execution authorization.

grantContext identifies the APPLIED grant revision/hash, issuance reason and
workspace source. Later unused-grant revisions do not rewrite this snapshot.
Recorded source history/protection is metadata, not fresh archive verification.
Legacy or unavailable linkage is explicit; never infer it from current defaults.
Inspect the current grant with web grants show GRANT and a source with
web attempts show SOURCE-ATTEMPT. Unused availability is separate from attempts;
use web grants list EXAM --username USER, not the attempt state, to inspect it.

Common flags: --config FILE (default /etc/exam-agent/agent.json), --request UUID.
Use a NEW request ID for fresh reads. Reusing an ID intentionally returns its
original snapshot. Missing/conflicting/offline results do not imply current state.
Next: examctl web clocks help for reset/extend/default-batch/intent inspection.

Examples:
  sudo examctl web attempts list midterm --view attention
  sudo examctl web attempts list midterm --q student01
  sudo examctl web attempts show ATTEMPT
  sudo examctl info ATTEMPT

Exit status: 0 authenticated metadata, 1 refusal/failure, 2 invalid syntax.`)
}

func webAttemptsMain(args []string) int {
	if _, help := helpRequest(args); help {
		webAttemptsHelp(os.Stdout)
		return 0
	}
	flags := flag.NewFlagSet("examctl web attempts", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	config := flags.String("config", "/etc/exam-agent/agent.json", "root configuration")
	request := flags.String("request", "", "durable read request UUID")
	limit := flags.Int("limit", 100, "scanned page size")
	after := flags.String("after", "", "attempt-ID cursor")
	view := flags.String("view", "all", "dashboard view")
	query := flags.String("q", "", "username LIKE search")
	usage := func(message string) int { fmt.Fprintln(os.Stderr, message+"; run examctl web attempts help"); return 2 }
	if err := flags.Parse(ordered(args)); err != nil {
		return usage("invalid attempt flags")
	}
	w := flags.Args()
	if len(w) == 2 && w[1] == "help" {
		webAttemptsHelp(os.Stdout)
		return 0
	}
	if len(w) != 3 || w[0] != "attempts" {
		return usage("choose list EXAM or show ATTEMPT")
	}
	id := regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)
	if !id.MatchString(w[2]) || (*request != "" && !managementUUID.MatchString(*request)) {
		return usage("invalid target/request ID")
	}
	seen := map[string]bool{}
	flags.Visit(func(f *flag.Flag) { seen[f.Name] = true })
	b := map[string]any{}
	switch w[1] {
	case "list":
		if *limit < 1 || *limit > 200 || len(*query) > 64 || (*after != "" && !id.MatchString(*after)) {
			return usage("invalid page/search/cursor; see documented bounds")
		}
		switch *view {
		case "all":
			*view = ""
		case "", "working", "attention", "secured", "camera", "no-camera", "PREPARING", "ACTIVE", "LOCKED", "FINALIZING", "COMPLETED", "COLLECTION_FAILED", "CANCELLED_BEFORE_START":
		default:
			return usage("unknown dashboard --view")
		}
		b["exam"], b["limit"], b["view"], b["q"] = w[2], *limit, *view, *query
		if *after != "" {
			b["after"] = *after
		}
	case "show":
		if seen["limit"] || seen["after"] || seen["view"] || seen["q"] {
			return usage("show takes one attempt ID, without list filters")
		}
		b["id"] = w[2]
	default:
		return usage("unsupported attempt inspection workflow")
	}
	return executeWeb(*config, *request, "attempts."+w[1], b, "")
}
