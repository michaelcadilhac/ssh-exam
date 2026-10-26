package main

import (
	"encoding/json"
	"errors"
	"examworkspace/agent/internal/core"
	"flag"
	"fmt"
	"io"
	"os"
	"regexp"
	"strconv"
	"strings"
)

func webInterruptionsHelp(out io.Writer) {
	fmt.Fprintln(out, `Usage: sudo examctl web interruptions show ATTEMPT
       sudo examctl web interruptions review ATTEMPT [--section history|requests --limit N --after ENTRY --revision N]
       sudo examctl web interruptions authorize ATTEMPT --generation N --revision N --reason TEXT [--intent UUID]

Root-agent signed outbound HTTPS, explicit interruptions.show/review/authorize
managementOperations and shared web validation/audit. No native control listener.
show returns bounded gateway metadata and current authorization, not fresh native
freeze/readiness. review pages private interruption reasons/authorizations or
student requests; default history, 20 entries, range 1..100, exclusive ID cursor.
Following --after requires the first page's --revision; any change refuses. Restart
from the first page after a revision change, never skip a changed earlier page.
Use a private terminal; output is sensitive monitoring information. Do not paste
student messages into permanent operator --reason. No output file is auto-created.

Review EVERY relevant history/requests page before authorize. --generation and
--revision are the current interruption generation and monotonic review counter,
NOT the clock revision or definition hash. A changed reason/request, approval,
state or deadline invalidates the reviewed counter, even in the same generation.
Stale review refuses: inspect/review anew and issue a NEW intent deliberately.

Only started LOCKED, unfinished, unprotected attempts before current deadline.
An exact retry never replaces/extends approval. A new deliberately reviewed intent
can renew an unused approval under existing rules, retaining its history. Approval
expires at the earlier of five minutes from gateway acceptance or the current deadline.
It does NOT resume execution, thaw work, stop/reset time, release account holds,
reopen completed work or bypass current page, authenticated ownership and monitoring.
Retained v1 attempts keep the original page and viable SSH connection: restore
conditions and explicitly Continue there. Approval cannot transfer to a new page
or SSH connection. Genuine loss requires a reviewed NEW attempt from verified
saved work with a chosen allowance/finite Begin window; inspect web grants help
and the recovery runbook. The old interval/hold remains; early access disposition
is a separate audited decision. Existing legacy attempts require fresh SSH under
their established policy. A delayed command/control reply alone proves no loss.

Common flags: --config FILE (default /etc/exam-agent/agent.json), --request UUID.
Lost mutation reply: retry identical arguments with the printed --request UUID.
--intent defaults to that ID; retain it under a new parent for an exact child
retry. Repeating never extends expiry; a cached authorized reply is NOT proof of
currently usable permission. Use fresh show to check consumption/expiry/state.
Reason: 8..1000 characters, permanently audited under authenticated agent/root.

Private review is transient: persist ONLY a scoped metadata receipt, not text, in management
retry records. Same-request retry re-reads unchanged retained history; changed
revision or deleted monitoring refuses. Use a NEW --request for fresh review.
Monitoring deletion/60-day retention remains independent of protected submissions.
Offline: native examctl info ATTEMPT inspects local state; private gateway history
and authorization need the gateway, never unsynchronized SQL/JSON edits.

Examples:
  sudo examctl web attempts list midterm --view attention
  sudo examctl web interruptions show ATTEMPT
  sudo examctl web interruptions review ATTEMPT --section history
  sudo examctl web interruptions review ATTEMPT --section requests
  sudo examctl web interruptions authorize ATTEMPT --generation 2 --revision 7 --reason 'Reviewed screen-sharing interruption'
  sudo examctl web interruptions show ATTEMPT
  sudo examctl info ATTEMPT

Exit status: 0 authenticated gateway result (never execution permission),
1 refusal/operational failure, 2 invalid syntax. Help needs no root/configuration.`)
}

func webInterruptionsMain(args []string) int {
	if _, help := helpRequest(args); help {
		webInterruptionsHelp(os.Stdout)
		return 0
	}
	flags := flag.NewFlagSet("examctl web interruptions", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	config := flags.String("config", "/etc/exam-agent/agent.json", "root configuration")
	request := flags.String("request", "", "durable parent UUID")
	intent := flags.String("intent", "", "authorization child UUID")
	generation := flags.String("generation", "", "reviewed generation")
	revision := flags.String("revision", "", "reviewed interruption counter")
	reason := flags.String("reason", "", "audited reason")
	section := flags.String("section", "history", "history or requests")
	limit := flags.Int("limit", 20, "page size")
	after := flags.String("after", "", "exclusive entry ID")
	usage := func(message string) int {
		fmt.Fprintln(os.Stderr, message+"; run examctl web interruptions help")
		return 2
	}
	if err := flags.Parse(ordered(args)); err != nil {
		return usage("invalid interruption flags")
	}
	w := flags.Args()
	if len(w) == 2 && w[1] == "help" {
		webInterruptionsHelp(os.Stdout)
		return 0
	}
	ref := regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)
	if len(w) != 3 || w[0] != "interruptions" || !ref.MatchString(w[2]) {
		return usage("choose show/review/authorize ATTEMPT")
	}
	if (*request != "" && !managementUUID.MatchString(*request)) || (*intent != "" && !managementUUID.MatchString(*intent)) {
		return usage("request/intent must be UUIDs")
	}
	seen := map[string]bool{}
	flags.Visit(func(f *flag.Flag) { seen[f.Name] = true })
	b := map[string]any{"id": w[2]}
	if *request == "" {
		*request = core.ManagementID()
	}
	switch w[1] {
	case "show", "review":
		if seen["generation"] || seen["reason"] || seen["intent"] {
			return usage("read workflow forbids authorization flags")
		}
		if w[1] == "show" && (seen["section"] || seen["limit"] || seen["after"] || seen["revision"]) {
			return usage("show needs only ATTEMPT")
		}
		if w[1] == "review" {
			if (*section != "history" && *section != "requests") || *limit < 1 || *limit > 100 || (*after != "" && !ref.MatchString(*after)) {
				return usage("review section history|requests, limit 1..100, after ENTRY")
			}
			b["section"], b["limit"] = *section, *limit
			if seen["revision"] || *after != "" {
				rev, err := strconv.ParseInt(*revision, 10, 64)
				if err != nil || rev < 0 || rev > 9007199254740991 {
					return usage("review paging requires the first page's --revision safe integer; restart review if it changed")
				}
				b["revision"] = rev
			}
			if *after != "" {
				b["after"] = *after
			}
		}
	case "authorize":
		gen, e1 := strconv.ParseInt(*generation, 10, 64)
		rev, e2 := strconv.ParseInt(*revision, 10, 64)
		why := strings.TrimSpace(*reason)
		if e1 != nil || e2 != nil || gen < 0 || rev < 0 || gen > 9007199254740991 || rev > 9007199254740991 || len([]rune(why)) < 8 || len([]rune(why)) > 1000 || seen["section"] || seen["limit"] || seen["after"] {
			return usage("authorize requires reviewed --generation/--revision nonnegative safe integers and --reason 8..1000 characters, without paging flags")
		}
		if *intent == "" {
			*intent = *request
		}
		b["generation"], b["revision"], b["reason"], b["requestID"] = gen, rev, why, *intent
	default:
		return usage("unknown interruption workflow")
	}
	return executeWeb(*config, *request, "interruptions."+w[1], b, "")
}

func validateInterruptionResult(operation string, body any, raw json.RawMessage) error {
	if !strings.HasPrefix(operation, "interruptions.") {
		return nil
	}
	encoded, _ := json.Marshal(body)
	var input struct {
		ID         string `json:"id"`
		Generation int64  `json:"generation"`
		RequestID  string `json:"requestID"`
	}
	var result struct {
		ID         string `json:"id"`
		Generation int64  `json:"generation"`
		RequestID  string `json:"requestID"`
		Expires    int64  `json:"expires"`
		Execution  *bool  `json:"execution"`
		Status     string `json:"status"`
		Current    struct {
			ID string `json:"id"`
		} `json:"current"`
	}
	if json.Unmarshal(encoded, &input) != nil || json.Unmarshal(raw, &result) != nil {
		return errors.New("invalid interruption reply; inspect fresh status")
	}
	if operation == "interruptions.authorize" {
		if result.ID != input.ID || result.Generation != input.Generation || result.RequestID != input.RequestID || result.Status != "authorized" || result.Execution == nil || *result.Execution || result.Expires <= 0 {
			return errors.New("interruption reply lacks exact authorization scope and explicit non-execution status; inspect fresh status before retrying")
		}
	} else if (operation == "interruptions.show" && result.ID != input.ID) || (operation == "interruptions.review" && result.Current.ID != input.ID) {
		return errors.New("interruption reply target mismatch; never authorize from unscoped review")
	}
	return nil
}
