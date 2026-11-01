package main

import (
	"encoding/base64"
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
       sudo examctl web monitoring image ATTEMPT FRAME [--thumbnail --output NEW_FILE|-]
       sudo examctl web monitoring export ATTEMPT --output NEW_DIR
       sudo examctl web monitoring delete ATTEMPT --confirm USERNAME --revision HASH --reason TEXT [--intent UUID]
       sudo examctl web monitoring purges [--status pending|running|retry|verified-absent --limit N --after ATTEMPT]
       sudo examctl web monitoring purge-status ATTEMPT
       sudo examctl web monitoring optimize ATTEMPT [--intent UUID]
       sudo examctl web monitoring optimize-retry ATTEMPT [--intent UUID]
       sudo examctl web monitoring optimize-cancel ATTEMPT [--intent UUID]

Read gateway monitoring through existing root-agent signed outbound HTTPS.
Explicit monitoring.show/list/replay/image/export/delete managementOperations authorization is required;
Purge inventory separately requires monitoring.purges and monitoring.purge.
default is denied. No student credentials or inbound agent control API.
show returns counts, retention and attempt metadata, not fresh native protection.
Optimization requires BOTH monitoring.show and monitoring.optimize authorization.
show also reports verified-video optimization status/counts and converted subset
source/video bytes, excluding remaining JPEGs, terminals, submissions and backups.
optimize requests eligible completed-attempt conversion; optimize-retry resumes
eligible work; optimize-cancel leaves it paused with no later publication from
that request. Already verified mapped clips remain. No clock, grant, account hold,
terminal recording or retention rule changes. Original JPEGs are removed only by
the gateway's verified conversion/cleanup workflow, never by this CLI.
Keep the printed --request and --intent for unknown replies; --intent defaults
to the request ID. Same intent/arguments never requeues work; after a confirmed
refusal deliberately use a new intent. Fresh show reads progress; an accepted
receipt confirms the request only, not completed conversion or JPEG cleanup.
list returns metadata only: default frames, 50 entries, range 1..200. Choose
terminals to discover pane IDs for replay. Cursors are nonnegative safe integers;
--after requires the first page's --through watermark. Keep both when paging;
new captures after that watermark require a fresh list. No screenshot bytes in list.

image reads ONE listed FRAME UUID belonging to ATTEMPT. It returns the original
or video-derived JPEG (maximum 1,500,000 bytes); --thumbnail selects its derived JPEG (maximum 2 MiB).
The same web-review reader enforces private pinned/no-follow bounded storage,
retention and shared capacity. A video-derived JPEG is a review representation;
legacy thumbnails have no independent stored provenance hash. The signed result
contains scoped base64, byte length and a transfer digest, checked before output.
Derived JSON includes strict provenance: capture_sha256 identifies the received
capture, while sha256 identifies the returned JPEG. Nonthumbnail width/height
describe derived pixels. Thumbnail provenance identifies its full decoded source
frame, without claiming the thumbnail's pixels have that decoded RGB24 hash.
Default JSON contains private image bytes. --output NEW_FILE writes one binary
JPEG to a new exclusive 0600 file; '-' emits binary stdout, use only a private
redirect, never an interactive terminal. This is NOT a whole monitoring export.

export downloads one complete private monitoring copy, using separately authorized
monitoring.export and a bounded signed stream over the same outbound HTTPS route.
--output NEW_DIR is REQUIRED, never '-' or an existing directory/link. Every
parent component must be a real directory, not a symlink. Only a verified first
packet creates a new 0700 private .incomplete staging directory. Validate all
packets/files/digests/counts and clean EOF, flush files/metadata, then publish
without replacing an existing target. A failed export returns exit 1, retains
explicitly INCOMPLETE private data, and never claims success. Rare post-publication
sync/close failure is reported UNCONFIRMED even if the final directory exists.

Export includes retained original or video-derived screen/webcam JPEGs, thumbnails, exact terminal
bytes (including incomplete trailing NDJSON), whitelisted metadata and incident/
interruption history. Per-file hashes, metadata indexes and manifest.json describe
the selected append-watermarked inventory and each recording's initial pinned
byte prefix. Later captures/appends are excluded; history/attempt facts are
observations during the export, NOT a globally atomic snapshot, a live permission
or fresh protected-submission proof. Source prefixes are independently rehashed
before completion. Old/replayed/mixed/wrong-target packets refuse. At most one
gateway export/cleanup owner; capture and exam clocks stay independent.
Video-derived frame metadata.hash identifies the exported JPEG, not the original
capture. Optional strict provenance records encoding vp9-webm-v1, capture_sha256,
original dimensions, verified segment/index and decoded RGB24 hash. Capture
timestamps/sequence stay exact; CLI validates signed provenance shape and exported
JPEG digest, not an independent reconstruction of deleted original JPEG bytes.

Chunks are at most 256 KiB, signed event payloads 4 MiB; individual history text
fields above 1 MiB refuse explicitly, never truncate silently. The read session has
a 30-minute budget and 15-second network-progress waits; local file writes/syncs
do not consume a network wait. Preserve --request on retry, but always choose a
NEW output directory: retries keep inventory watermarks, reread retained bytes
and may observe a later recording prefix. Do not combine incomplete copies.
Default stdout is a small confirmed JSON receipt, never private media. Downloaded
copies have independent operator storage/retention obligations and cannot be
recalled by later gateway deletion. No source, clock, hold or grant is changed.

replay reads at most 1 MiB of complete NDJSON events starting at --offset bytes
(default 0). Follow nextOffset; more means another full batch is available now.
availableBytes is the observed size, not proof that recording has finished. An
incomplete final event is not returned: retry the same cursor after it completes.
Offsets must follow a newline, never a timestamp or character index. Invalid or
unavailable storage refuses with diagnosis; monitoring never changes exam clocks,
holds, approval or protected submissions. Use native manifest/export for submissions.

Default output is JSON. --output selects a NEW_DIR for export; otherwise it
applies ONLY to image or replay (ONE batch),
not a complete media export. Replay '-' streams NDJSON to stdout; NEW_FILE is created
exclusively with mode 0600, never overwritten. A failed write may leave partial
output. Review nextOffset/availableBytes in JSON when collecting multiple batches.
Use a private terminal/destination; output contains sensitive student monitoring.
Show includes logical deletion and pending/running/retry/verified-absent physical
purge metadata. Verified-absent is timestamped current-directory absence, not
backup removal or secure disk erasure. Automatic isolated retries preserve tombstones;
inspect storage/permissions and worker diagnostics on failure. Never remove locks
or deletion records to bypass busy. Use export, not concatenated replay batches,
for a complete raw media copy.

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
  sudo examctl web monitoring image ATTEMPT FRAME --output ./new-private-frame.jpg
  sudo examctl web monitoring image ATTEMPT FRAME --thumbnail --output ./new-private-thumb.jpg
  sudo examctl web monitoring export ATTEMPT --output ./new-private-monitoring
  sudo examctl web monitoring delete ATTEMPT --confirm student01 --revision HASH --reason 'Reviewed monitoring retention request'
  sudo examctl web monitoring purges --status retry --limit 50
  sudo examctl web monitoring purge-status ATTEMPT
  sudo examctl web monitoring optimize ATTEMPT
  sudo examctl web monitoring optimize-retry ATTEMPT --intent UUID
  sudo examctl web monitoring optimize-cancel ATTEMPT
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
	thumbnail := f.Bool("thumbnail", false, "image: read derived thumbnail instead of original")
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
		return usage("choose show/list/purge-status/delete ATTEMPT, purges, replay ATTEMPT PANE, or image ATTEMPT FRAME")
	}
	if (*request != "" && !managementUUID.MatchString(*request)) || (*intent != "" && !managementUUID.MatchString(*intent)) {
		return usage("request/intent must be UUIDs")
	}
	seen := map[string]bool{}
	f.Visit(func(flag *flag.Flag) { seen[flag.Name] = true })
	optimization := w[1] == "optimize" || w[1] == "optimize-retry" || w[1] == "optimize-cancel"
	b := map[string]any{}
	if w[1] != "purges" {
		b["id"] = w[2]
	}
	if seen["status"] && w[1] != "purges" {
		return usage("--status applies only to purges inventory")
	}
	if seen["thumbnail"] && w[1] != "image" {
		return usage("--thumbnail applies only to image ATTEMPT FRAME")
	}
	if w[1] != "delete" && !optimization && (seen["confirm"] || seen["revision"] || seen["reason"] || seen["intent"]) {
		return usage("read workflow forbids deletion flags")
	}
	switch w[1] {
	case "optimize", "optimize-retry", "optimize-cancel":
		if len(w) != 3 || seen["section"] || seen["limit"] || seen["after"] || seen["through"] || seen["offset"] || seen["output"] || seen["confirm"] || seen["revision"] || seen["reason"] {
			return usage("optimization requires ATTEMPT and only optional --intent/--request/--config; use show for progress")
		}
		if *request == "" {
			*request = core.ManagementID()
		}
		if *intent == "" {
			*intent = *request
		}
		action := "request"
		if w[1] == "optimize-retry" {
			action = "retry"
		}
		if w[1] == "optimize-cancel" {
			action = "cancel"
		}
		b["action"], b["requestID"] = action, *intent
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
	case "image":
		if len(w) != 4 || !managementUUID.MatchString(w[3]) || seen["section"] || seen["limit"] || seen["after"] || seen["through"] || seen["offset"] || (seen["output"] && *output == "") {
			return usage("image needs ATTEMPT FRAME UUID from monitoring list, with optional --thumbnail/--output NEW_FILE|- and common flags; no replay/list flags")
		}
		b["frame"], b["thumbnail"] = w[3], *thumbnail
	case "export":
		if len(w) != 3 || !seen["output"] || *output == "" || *output == "-" || seen["section"] || seen["limit"] || seen["after"] || seen["through"] || seen["offset"] {
			return usage("export needs ATTEMPT --output NEW_DIR (not stdout/existing output), without list/replay/image flags")
		}
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
	if optimization {
		operation = "monitoring.optimize"
	}
	if w[1] == "export" {
		return executeMonitoringExport(*config, *request, w[2], *output)
	}
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
	if operation == "monitoring.image" {
		_, err := decodeMonitoringImage(body, raw)
		return err
	}
	if operation == "monitoring.purges" || operation == "monitoring.purge" {
		return validatePurgeResult(operation, body, raw)
	}
	if !strings.HasPrefix(operation, "monitoring.") {
		return nil
	}
	encoded, _ := json.Marshal(body)
	var input struct {
		ID, Pane, Section, RequestID, Action string
		Offset, After                        int64
		Through                              *int64
		Limit                                int
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
		Optimization                       json.RawMessage
		Capabilities                       []string
		Action                             string
		Accepted                           *bool
	}
	invalid := errors.New("monitoring reply scope/cursor mismatch; no private output written; inspect fresh monitoring metadata")
	if json.Unmarshal(encoded, &input) != nil || json.Unmarshal(raw, &result) != nil || result.ID != input.ID {
		return invalid
	}
	safe := func(n int64) bool { return n >= 0 && n <= 9007199254740991 }
	switch operation {
	case "monitoring.optimize":
		var fields map[string]json.RawMessage
		if core.DecodeMonitoringExportObject(raw, &fields, []string{"id", "action", "accepted"}) != nil || result.Action != input.Action || result.Accepted == nil || !*result.Accepted {
			return errors.New("monitoring optimization reply scope/action mismatch; preserve --request/--intent and inspect fresh show before retrying")
		}
	case "monitoring.delete":
		if result.RequestID != input.RequestID || result.Status != "logical-deletion-accepted" || result.LogicalDeleted == nil || !*result.LogicalDeleted || string(result.PhysicalPurge) != `"pending-verification"` {
			return invalid
		}
	case "monitoring.show":
		if result.Current.ID != input.ID {
			return invalid
		}
		hasCapability := false
		for _, capability := range result.Capabilities {
			if capability == "monitoring-optimization-v1" {
				hasCapability = true
			}
		}
		if len(result.Optimization) != 0 || hasCapability {
			if err := validateMonitoringOptimization(result.Optimization); err != nil {
				return err
			}
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

func decodeMonitoringImage(body any, raw json.RawMessage) ([]byte, error) {
	var input struct {
		ID, Frame string
		Thumbnail bool
	}
	var result struct {
		ID, Frame, Format string
		Thumbnail         *bool
		Bytes             *int64
		SHA256, Data      *string
		Width, Height     *int64
		Provenance        json.RawMessage
	}
	invalid := errors.New("monitoring image scope/length/digest rejected; no private output written; inspect fresh monitoring list and matching gateway/CLI versions")
	b, err := json.Marshal(body)
	if err != nil || json.Unmarshal(b, &input) != nil || json.Unmarshal(raw, &result) != nil || result.ID != input.ID || result.Frame != input.Frame || result.Thumbnail == nil || *result.Thumbnail != input.Thumbnail || result.Format != "jpeg" || result.Bytes == nil || result.SHA256 == nil || result.Data == nil {
		return nil, invalid
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil {
		return nil, invalid
	}
	_, widthPresent := fields["width"]
	_, heightPresent := fields["height"]
	if widthPresent || heightPresent {
		if input.Thumbnail || !widthPresent || !heightPresent || result.Width == nil || result.Height == nil || *result.Width < 1 || *result.Height < 1 || *result.Width > 2560 || *result.Height > 2560 {
			return nil, invalid
		}
	}
	if len(result.Provenance) != 0 {
		if exportFrameProvenance(result.Provenance) != nil || (!input.Thumbnail && (!widthPresent || !heightPresent)) {
			return nil, invalid
		}
	}
	limit := int64(1500000)
	if input.Thumbnail {
		limit = 2 * 1024 * 1024
	}
	if *result.Bytes < 1 || *result.Bytes > limit || len(*result.Data) != base64.StdEncoding.EncodedLen(int(*result.Bytes)) || !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(*result.SHA256) {
		return nil, invalid
	}
	data, err := base64.StdEncoding.Strict().DecodeString(*result.Data)
	if err != nil || int64(len(data)) != *result.Bytes || base64.StdEncoding.EncodeToString(data) != *result.Data || core.Hash(data) != *result.SHA256 {
		return nil, invalid
	}
	return data, nil
}

func writeMonitoringImage(body any, raw json.RawMessage, output string) int {
	data, err := decodeMonitoringImage(body, raw)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	var writer io.Writer = os.Stdout
	var file *os.File
	if output != "-" {
		file, err = os.OpenFile(output, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			fmt.Fprintln(os.Stderr, "Create a new private image output (never overwrite):", err)
			return 1
		}
		defer file.Close()
		writer = file
	}
	n, err := writer.Write(data)
	if err == nil && n != len(data) {
		err = io.ErrShortWrite
	}
	if err == nil && file != nil {
		err = file.Sync()
	}
	if file != nil {
		closeErr := file.Close()
		if err == nil {
			err = closeErr
		}
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "Image output incomplete; inspect any private partial file before retrying:", err)
		return 1
	}
	fmt.Fprintln(os.Stderr, "One monitoring image only; whole-media export is a separate workflow. Keep this private file under the applicable retention policy")
	return 0
}
