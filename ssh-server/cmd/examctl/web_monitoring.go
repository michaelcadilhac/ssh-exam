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

func webMonitoringHelp(out io.Writer) {
	fmt.Fprintln(out, `Usage: sudo examctl web monitoring show ATTEMPT
       sudo examctl web monitoring list ATTEMPT [--section frames|terminals --limit N --after N --through N]
       sudo examctl web monitoring replay ATTEMPT PANE [--offset N --output NEW_FILE|-]
       sudo examctl web monitoring delete ATTEMPT --confirm USERNAME --revision HASH --reason TEXT [--intent UUID]
       sudo examctl web monitoring purges [--status pending|running|retry|verified-absent --limit N --after ATTEMPT]
       sudo examctl web monitoring purge-status ATTEMPT

Read gateway monitoring through existing root-agent signed outbound HTTPS.
Explicit monitoring.show/list/replay/delete managementOperations authorization is required;
Purge inventory separately requires monitoring.purges and monitoring.purge.
default is denied. No student credentials or inbound agent control API.
show returns counts, retention and attempt metadata, not fresh native protection.
list returns metadata only: default frames, 50 entries, range 1..200. Choose
terminals to discover pane IDs for replay. Cursors are nonnegative safe integers;
--after requires the first page's --through watermark. Keep both when paging;
new captures after that watermark require a fresh list. No screenshot bytes here.

replay reads at most 1 MiB of complete NDJSON events starting at --offset bytes
(default 0). Follow nextOffset; more means another full batch is available now.
availableBytes is the observed size, not proof that recording has finished. An
incomplete final event is not returned: retry the same cursor after it completes.
Offsets must follow a newline, never a timestamp or character index. Invalid or
unavailable storage refuses with diagnosis; monitoring never changes exam clocks,
holds, approval or protected submissions. Use native manifest/export for submissions.

Default output is JSON. --output applies ONLY to replay and writes ONE batch,
not a complete media export. '-' streams NDJSON to stdout; NEW_FILE is created
exclusively with mode 0600, never overwritten. A failed write may leave partial
output. Review nextOffset/availableBytes in JSON when collecting multiple batches.
Use a private terminal/destination; output contains sensitive student monitoring.
Show includes logical deletion and pending/running/retry/verified-absent physical
purge metadata. Verified-absent is timestamped current-directory absence, not
backup removal or secure disk erasure. Automatic isolated retries preserve tombstones;
inspect storage/permissions and worker diagnostics on failure. Never remove locks
or deletion records to bypass busy. Whole-media export remains pending.

purges lists bounded live deletion/job metadata, including retired preparations
with no remaining attempt row. Default 50, range 1..100; --after is an attempt ID
(not the numeric frame-list cursor). Filter a stored job state with --status;
unfiltered listing also shows not-verified legacy tombstones awaiting backfill.
purge-status ATTEMPT shows its durable deletion/job even after attempt retirement. These
are metadata snapshots, NOT fresh filesystem verification. Use NEW --request IDs
for fresh pages/status; changing live rows may require restarting a full list.
No monitoring text, media, paths, protected bytes or deletion/reset controls here.

delete permanently blocks monitoring access/late callbacks ONLY after the attempt
ends; it never deletes a protected submission, changes clocks, grants time or
releases account access. First run show, review deletionReview and confirm the
displayed USERNAME with its exact deletionReview.revision HASH (not a clock
revision). --reason is an audited 8..1000-character operator explanation, not
student monitoring text. Changes after review refuse; review a new intent.
Deletion is logical acceptance plus asynchronous purge, NOT physical completion.
Keep the original --request UUID for lost-reply retries; --intent defaults to it.
Retain --intent under a new parent to retry the SAME child intent. Exact retries
do not requeue/reset backoff or delete anything new. Fresh show reads job status.

Common flags: --config FILE (default /etc/exam-agent/agent.json), --request UUID.
Private show/list/replay results are transient: durable retries contain metadata
only, never monitoring text. Same-request retry rechecks deletion and rereads
retained bytes/metadata; it is NOT a permanent snapshot. Purge-job inventory is
metadata-only and its request outcome IS a snapshot: use a NEW request for fresh
job pages/status. Use a NEW list request for a fresh capture inventory watermark.
Monitoring deletion/60-day expiry is independent of protected submission retention.
The CLI saves no output file automatically. Gateway reads require connectivity; native
examctl info ATTEMPT works offline, but cannot substitute for gateway monitoring.

Examples:
  sudo examctl web monitoring show ATTEMPT
  sudo examctl web monitoring list ATTEMPT --section frames --limit 50
  sudo examctl web monitoring list ATTEMPT --section frames --after 50 --through 100
  sudo examctl web monitoring list ATTEMPT --section terminals
  sudo examctl web monitoring replay ATTEMPT PANE --offset 0
  sudo examctl web monitoring replay ATTEMPT PANE --offset 0 --output ./replay-batch.ndjson
  sudo examctl web monitoring delete ATTEMPT --confirm student01 --revision HASH --reason 'Reviewed monitoring retention request'
  sudo examctl web monitoring purges --status retry --limit 50
  sudo examctl web monitoring purge-status ATTEMPT
  sudo examctl manifest ATTEMPT

Exit status: 0 authenticated result/accepted deletion, 1 refusal/operational failure, 2 invalid syntax.
Help requires no root/configuration. Read access is audited under agent/root.`)
}

func webMonitoringMain(args []string) int {
	if _, help := helpRequest(args); help {
		webMonitoringHelp(os.Stdout)
		return 0
	}
	f := flag.NewFlagSet("examctl web monitoring", flag.ContinueOnError)
	f.SetOutput(os.Stderr)
	config := f.String("config", "/etc/exam-agent/agent.json", "root configuration")
	request := f.String("request", "", "durable management UUID")
	section := f.String("section", "frames", "frames or terminals")
	limit := f.Int("limit", 50, "metadata page size")
	after := f.String("after", "", "list numeric cursor or purge inventory attempt ID")
	status := f.String("status", "", "purge job state filter")
	through := f.Int64("through", 0, "first page watermark")
	offset := f.Int64("offset", 0, "complete-event byte cursor")
	output := f.String("output", "", "one replay batch to NEW_FILE or -")
	confirm := f.String("confirm", "", "reviewed student username")
	revision := f.String("revision", "", "reviewed deletion hash")
	reason := f.String("reason", "", "audited reason")
	intent := f.String("intent", "", "deletion child UUID")
	usage := func(message string) int {
		fmt.Fprintln(os.Stderr, message+"; run examctl web monitoring help")
		return 2
	}
	if err := f.Parse(ordered(args)); err != nil {
		return usage("invalid monitoring flags")
	}
	w := f.Args()
	if len(w) == 2 && w[1] == "help" {
		webMonitoringHelp(os.Stdout)
		return 0
	}
	ref := regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)
	if len(w) < 2 || w[0] != "monitoring" || (w[1] == "purges" && len(w) != 2) || (w[1] != "purges" && (len(w) < 3 || !ref.MatchString(w[2]))) {
		return usage("choose show/list/purge-status/delete ATTEMPT, purges, or replay ATTEMPT PANE")
	}
	if (*request != "" && !managementUUID.MatchString(*request)) || (*intent != "" && !managementUUID.MatchString(*intent)) {
		return usage("request/intent must be UUIDs")
	}
	seen := map[string]bool{}
	f.Visit(func(flag *flag.Flag) { seen[flag.Name] = true })
	b := map[string]any{}
	if w[1] != "purges" {
		b["id"] = w[2]
	}
	if seen["status"] && w[1] != "purges" {
		return usage("--status applies only to purges inventory")
	}
	if w[1] != "delete" && (seen["confirm"] || seen["revision"] || seen["reason"] || seen["intent"]) {
		return usage("read workflow forbids deletion flags")
	}
	switch w[1] {
	case "show", "purge-status":
		if len(w) != 3 || seen["section"] || seen["limit"] || seen["after"] || seen["through"] || seen["offset"] || seen["output"] {
			return usage("show requires only ATTEMPT and optional common flags")
		}
	case "list":
		afterNumber := int64(0)
		var cursorError error
		if seen["after"] {
			afterNumber, cursorError = strconv.ParseInt(*after, 10, 64)
		}
		if cursorError != nil || len(w) != 3 || seen["offset"] || seen["output"] || (*section != "frames" && *section != "terminals") || *limit < 1 || *limit > 200 || afterNumber < 0 || *through < 0 || afterNumber > 9007199254740991 || *through > 9007199254740991 || (afterNumber > 0 && !seen["through"]) || (seen["through"] && afterNumber > *through) {
			return usage("list needs section frames|terminals, limit 1..200 and safe cursors; paging requires the first page's --through, without replay flags")
		}
		b["section"], b["limit"], b["after"] = *section, *limit, afterNumber
		if seen["through"] {
			b["through"] = *through
		}
	case "purges":
		validStatus := *status == "pending" || *status == "running" || *status == "retry" || *status == "verified-absent"
		if seen["section"] || seen["through"] || seen["offset"] || seen["output"] || *limit < 1 || *limit > 100 || (seen["after"] && !ref.MatchString(*after)) || (seen["status"] && !validStatus) {
			return usage("purges needs limit 1..100, optional --after ATTEMPT and --status pending|running|retry|verified-absent, without frame/replay flags")
		}
		b["limit"] = *limit
		if seen["after"] {
			b["after"] = *after
		}
		if seen["status"] {
			b["status"] = *status
		}
	case "replay":
		if len(w) != 4 || !managementUUID.MatchString(w[3]) || seen["section"] || seen["limit"] || seen["after"] || seen["through"] || *offset < 0 || *offset > 9007199254740991 || (seen["output"] && *output == "") {
			return usage("replay needs ATTEMPT PANE and a nonnegative safe --offset byte cursor; only optional --output NEW_FILE|- and common flags")
		}
		b["pane"], b["offset"] = w[3], *offset
	case "delete":
		why := strings.TrimSpace(*reason)
		if len(w) != 3 || !regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9_-]{0,31}$`).MatchString(*confirm) || !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(*revision) || len([]rune(why)) < 8 || len([]rune(why)) > 1000 || seen["section"] || seen["limit"] || seen["after"] || seen["through"] || seen["offset"] || seen["output"] {
			return usage("delete needs reviewed --confirm USERNAME --revision HASH and --reason 8..1000 characters, without read/output flags; first run monitoring show ATTEMPT")
		}
		if *request == "" {
			*request = core.ManagementID()
		}
		if *intent == "" {
			*intent = *request
		}
		b["confirm"], b["revision"], b["reason"], b["requestID"] = *confirm, *revision, why, *intent
	default:
		return usage("unknown monitoring workflow")
	}
	operation := "monitoring." + w[1]
	if w[1] == "purge-status" {
		operation = "monitoring.purge"
	}
	return executeWeb(*config, *request, operation, b, *output)
}

// Validate scope and byte boundaries before printing private data or creating a
// file, even though the enclosing reply has already passed signature checks.
func validatePurgeResult(operation string, body any, raw json.RawMessage) error {
	encoded, _ := json.Marshal(body)
	var input struct {
		ID, After, Status string
		Limit             int
	}
	var result struct {
		ID                string
		Deleted, Observed *int64
		Job               struct{ Status string }
		Attempt           *struct{ ID string }
		Entries           []struct{ ID, Status string }
		Next              *string
	}
	invalid := errors.New("purge inventory reply scope/cursor mismatch; use a new request for fresh bounded metadata")
	if json.Unmarshal(encoded, &input) != nil || json.Unmarshal(raw, &result) != nil || result.Observed == nil || *result.Observed < 0 || *result.Observed > 9007199254740991 {
		return invalid
	}
	validStatus := func(s string) bool {
		return s == "not-verified" || s == "pending" || s == "running" || s == "retry" || s == "verified-absent"
	}
	if operation == "monitoring.purge" {
		if result.ID != input.ID || result.Deleted == nil || *result.Deleted < 0 || *result.Deleted > 9007199254740991 || !validStatus(result.Job.Status) || (result.Attempt != nil && result.Attempt.ID != input.ID) {
			return invalid
		}
		return nil
	}
	if len(result.Entries) > input.Limit {
		return invalid
	}
	last := input.After
	for _, entry := range result.Entries {
		if !regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`).MatchString(entry.ID) || entry.ID <= last || !validStatus(entry.Status) || (input.Status != "" && entry.Status != input.Status) {
			return invalid
		}
		last = entry.ID
	}
	if result.Next != nil && (len(result.Entries) != input.Limit || len(result.Entries) == 0 || *result.Next != last) {
		return invalid
	}
	return nil
}

func validateMonitoringResult(operation string, body any, raw json.RawMessage) error {
	if operation == "monitoring.purges" || operation == "monitoring.purge" {
		return validatePurgeResult(operation, body, raw)
	}
	if !strings.HasPrefix(operation, "monitoring.") {
		return nil
	}
	encoded, _ := json.Marshal(body)
	var input struct {
		ID, Pane, Section, RequestID string
		Offset, After                int64
		Through                      *int64
		Limit                        int
	}
	var result struct {
		ID, Pane, Section, Format          string
		Offset, NextOffset, AvailableBytes *int64
		Through                            *int64
		Next                               *int64
		Text                               *string
		More                               *bool
		Entries                            []struct{ Cursor int64 }
		Current                            struct{ ID string }
		RequestID, Status                  string
		LogicalDeleted                     *bool
		PhysicalPurge                      json.RawMessage
	}
	invalid := errors.New("monitoring reply scope/cursor mismatch; no private output written; inspect fresh monitoring metadata")
	if json.Unmarshal(encoded, &input) != nil || json.Unmarshal(raw, &result) != nil || result.ID != input.ID {
		return invalid
	}
	safe := func(n int64) bool { return n >= 0 && n <= 9007199254740991 }
	switch operation {
	case "monitoring.delete":
		if result.RequestID != input.RequestID || result.Status != "logical-deletion-accepted" || result.LogicalDeleted == nil || !*result.LogicalDeleted || string(result.PhysicalPurge) != `"pending-verification"` {
			return invalid
		}
	case "monitoring.show":
		if result.Current.ID != input.ID {
			return invalid
		}
	case "monitoring.list":
		if result.Section != input.Section || result.Through == nil || !safe(*result.Through) || *result.Through < input.After || (input.Through != nil && *input.Through != *result.Through) || len(result.Entries) > input.Limit {
			return invalid
		}
		last := input.After
		for _, entry := range result.Entries {
			if entry.Cursor <= last || entry.Cursor > *result.Through {
				return invalid
			}
			last = entry.Cursor
		}
		if result.Next != nil && (len(result.Entries) == 0 || *result.Next != last || last >= *result.Through) {
			return invalid
		}
	case "monitoring.replay":
		if result.Pane != input.Pane || result.Offset == nil || *result.Offset != input.Offset || result.Format != "ndjson" || result.Text == nil || result.More == nil || result.NextOffset == nil || result.AvailableBytes == nil || !safe(*result.NextOffset) || !safe(*result.AvailableBytes) {
			return invalid
		}
		n := int64(len(*result.Text))
		if n > 1024*1024 || *result.NextOffset != input.Offset+n || *result.NextOffset > *result.AvailableBytes || (n > 0 && !strings.HasSuffix(*result.Text, "\n")) || (*result.More && (n == 0 || *result.NextOffset >= *result.AvailableBytes)) {
			return invalid
		}
	default:
		return invalid
	}
	return nil
}
