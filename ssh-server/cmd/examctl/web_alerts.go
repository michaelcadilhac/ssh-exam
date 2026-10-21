package main

import (
	"flag"
	"fmt"
	"io"
	"os"
	"regexp"
	"strings"
)

func webAlertsHelp(out io.Writer) {
	fmt.Fprintln(out, `Usage: sudo examctl web alerts list [--status all|pending|sent|failed|cancelled] [--limit 50] [--after OUTBOX_UUID]
       sudo examctl web alerts show OUTBOX_UUID
       sudo examctl web alerts test
       sudo examctl web alerts remind EPISODE_UUID --revision HASH --reason TEXT

Inspect notification delivery and explicitly queue a manual reminder through the
same service as web administration. Uses existing root agent HTTPS authentication
and named alerts.list/show/test/remind managementOperations, default deny. No new
credentials, SMTP-recipient override or native exam control. Help needs no root.

list/show return bounded METADATA only, not raw mail bodies, student review text,
terminal/media data or SMTP secrets. List is ordered by outbox UUID, not time;
next is the exclusive --after cursor. Refresh with a NEW request ID. show names
the original episode ID/revision, resolution and latest ten manual reminders.
Test/legacy notices without an episode cannot receive an episode reminder.

remind requires the current EPISODE UUID and revision from list/show plus an
audited 8..1000-character reason. Only an unresolved current episode with no
pending original/reminder is eligible. Stale generation, resolved/cancelled
notice or competing reminder refuses; show the original OUTBOX UUID, review,
then use a new intent. A reminder does not reset the original delivery tries,
reopen an incident, grant continuation, alter a clock/hold or repeat automatically.
Queued reminders are cancelled if their episode resolves/becomes obsolete before
SMTP handoff. Email already handed to SMTP cannot be recalled.

test/remind return queued=true, delivered=false and an outbox UUID. Queued is NOT
delivered: inspect show/list for pending/sent/failed/cancelled and retry count/next.
sent means SMTP accepted, not that the recipient read it. Automatic SMTP retries
retain a stable Message-ID; SMTP acceptance versus database commit is not an
exactly-once delivery guarantee. SMTP must be configured; existing configured
recipients only. Browser desktop permission and sound are local device settings,
not remote server operations or a replacement for email.

Common flags: --config FILE (default /etc/exam-agent/agent.json), --request UUID.
Lost reply: repeat the SAME arguments and request ID; a new signed nonce is used.
Different intent or fresh inspection: use a NEW ID. Outcomes survive restart.

Examples:
  sudo examctl web alerts list --status failed
  sudo examctl web alerts show OUTBOX_UUID
  sudo examctl web alerts remind EPISODE_UUID --revision HASH --reason 'Instructor requests deliberate follow-up'
  sudo examctl web alerts test
  sudo examctl web alerts show TEST-OUTBOX-UUID

Exit status: 0 confirmed metadata/queue result, 1 refusal/failure, 2 invalid syntax.
No command silently authorizes access or changes notification configuration.`)
}

func webAlertsMain(args []string) int {
	if _, help := helpRequest(args); help {
		webAlertsHelp(os.Stdout)
		return 0
	}
	flags := flag.NewFlagSet("examctl web alerts", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	config := flags.String("config", "/etc/exam-agent/agent.json", "root configuration")
	request := flags.String("request", "", "durable intent UUID")
	limit := flags.Int("limit", 50, "page size 1..200")
	after := flags.String("after", "", "outbox UUID cursor")
	status := flags.String("status", "all", "delivery status filter")
	revision := flags.String("revision", "", "reviewed episode revision")
	reason := flags.String("reason", "", "manual reminder reason")
	usage := func(message string) int { fmt.Fprintln(os.Stderr, message+"; run examctl web alerts help"); return 2 }
	if err := flags.Parse(ordered(args)); err != nil {
		return usage("invalid alert flags")
	}
	w := flags.Args()
	if len(w) == 2 && w[0] == "alerts" && w[1] == "help" {
		webAlertsHelp(os.Stdout)
		return 0
	}
	if len(w) < 2 || w[0] != "alerts" {
		return usage("choose list, show, test or remind")
	}
	uuid := regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$`)
	if *request != "" && !uuid.MatchString(*request) {
		return usage("--request must be a durable intent UUID")
	}
	seen := map[string]bool{}
	flags.Visit(func(f *flag.Flag) { seen[f.Name] = true })
	b := map[string]any{}
	switch w[1] {
	case "list":
		if len(w) != 2 || seen["revision"] || seen["reason"] || *limit < 1 || *limit > 200 || (*after != "" && !uuid.MatchString(*after)) {
			return usage("list takes no target/revision/reason; use --limit 1..200 and optional --after OUTBOX_UUID")
		}
		switch *status {
		case "all", "pending", "sent", "failed", "cancelled":
		default:
			return usage("invalid delivery --status")
		}
		b["limit"], b["status"] = *limit, *status
		if *after != "" {
			b["after"] = *after
		}
	case "show", "remind":
		if len(w) != 3 || !uuid.MatchString(w[2]) || seen["limit"] || seen["after"] || seen["status"] {
			return usage("show/remind need exactly one outbox/episode UUID, without list filters")
		}
		b["id"] = w[2]
		if w[1] == "show" {
			if seen["revision"] || seen["reason"] {
				return usage("show takes an OUTBOX UUID without mutation flags")
			}
		} else {
			if !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(*revision) || len(strings.TrimSpace(*reason)) < 8 || len(*reason) > 1000 {
				return usage("remind requires --revision HASH and an 8..1000-character audited --reason")
			}
			b["revision"], b["reason"] = *revision, strings.TrimSpace(*reason)
		}
	case "test":
		if len(w) != 2 || seen["limit"] || seen["after"] || seen["status"] || seen["revision"] || seen["reason"] {
			return usage("test takes no target, filters or reminder flags")
		}
	default:
		return usage("unsupported alert workflow")
	}
	return executeWeb(*config, *request, "alerts."+w[1], b, "")
}
