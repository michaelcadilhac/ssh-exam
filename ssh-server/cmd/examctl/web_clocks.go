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

type clockReplyItem struct {
	ID        string `json:"id"`
	RequestID string `json:"requestID"`
	Status    string `json:"status"`
	Confirmed *bool  `json:"confirmed"`
	Attempt   struct {
		ID string `json:"id"`
	} `json:"attempt"`
}

// A fully scoped, valid batch may still contain operational failures. Keep its
// per-target diagnostics printable with exit1, unlike a malformed/unscoped reply.
type clockPartialError struct{}

func (*clockPartialError) Error() string {
	return "some clock targets failed; inspect every result and retain each requestID for selected retries, never blindly add minutes again"
}

func validateClockResult(operation string, body any, raw json.RawMessage) error {
	if !strings.HasPrefix(operation, "clocks.") || operation == "clocks.preview" {
		return nil
	}
	b, err := json.Marshal(body)
	if err != nil {
		return err
	}
	var input struct {
		ID        string           `json:"id"`
		RequestID string           `json:"requestID"`
		Targets   []clockReplyItem `json:"targets"`
	}
	if json.Unmarshal(b, &input) != nil {
		return errors.New("invalid clock request scope")
	}
	validStatus := func(item clockReplyItem, applied string) bool {
		return item.Confirmed != nil && ((item.Status == applied && *item.Confirmed) || ((item.Status == "pending" || item.Status == "closed") && !*item.Confirmed))
	}
	if operation != "clocks.batch" {
		var value clockReplyItem
		if json.Unmarshal(raw, &value) != nil || !validStatus(value, "applied") || (operation != "clocks.show" && (value.RequestID != input.RequestID || value.Attempt.ID != input.ID || value.Status == "closed")) || (operation == "clocks.show" && value.RequestID != input.ID) {
			return errors.New("clock reply lacks matching target/intent and explicit native pending/applied status; inspect fresh clock/attempt state before retrying")
		}
		return nil
	}
	var batch struct {
		Results []clockReplyItem `json:"results"`
	}
	if json.Unmarshal(raw, &batch) != nil || len(batch.Results) != len(input.Targets) || len(batch.Results) == 0 {
		return errors.New("clock batch reply omits target results; inspect before retrying")
	}
	expected := map[string]string{}
	for _, target := range input.Targets {
		expected[target.ID] = target.RequestID
	}
	failed := false
	for _, item := range batch.Results {
		intent, ok := expected[item.ID]
		if !ok || item.RequestID != intent || (item.Status != "failed" && (!validStatus(item, "confirmed") || item.Status == "closed" || item.Attempt.ID != item.ID)) || (item.Status == "failed" && (item.Confirmed == nil || *item.Confirmed)) {
			return errors.New("clock batch reply has unknown/duplicate/mismatched target or status; inspect every target before retrying")
		}
		delete(expected, item.ID)
		failed = failed || item.Status == "failed"
	}
	if failed {
		return &clockPartialError{}
	}
	return nil
}

var managementUUID = regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$`)

type clockTargets []string

func (v *clockTargets) String() string         { return strings.Join(*v, ",") }
func (v *clockTargets) Set(value string) error { *v = append(*v, value); return nil }

// UUIDv8 custom, purpose-separated deterministic child intent; not a secret or
// authentication capability. Repeating the parent request reproduces each child.
func clockChildID(parent, attempt string) string {
	s := []byte(core.Hash([]byte("ssh-exam/clock-target/v1\x00" + parent + "\x00" + attempt))[:32])
	s[12], s[16] = '8', '8'
	return string(s[:8]) + "-" + string(s[8:12]) + "-" + string(s[12:16]) + "-" + string(s[16:20]) + "-" + string(s[20:])
}

func webClocksHelp(out io.Writer) {
	fmt.Fprintln(out, `Usage: sudo examctl web clocks show CLOCK_REQUEST_UUID
       sudo examctl web clocks reset ATTEMPT --minutes N --revision N [--intent CLOCK_REQUEST_UUID]
       sudo examctl web clocks extend ATTEMPT --minutes N --revision N [--intent CLOCK_REQUEST_UUID]
       sudo examctl web clocks preview EXAM --target ATTEMPT:REV [--target ...]
       sudo examctl web clocks reset-default EXAM --target ATTEMPT:REV:SECONDS[:INTENT] [--target ...]
       sudo examctl web clocks add EXAM --minutes N --target ATTEMPT:REV[:INTENT] [--target ...]

Existing root-agent signed HTTPS workflow, explicit clocks.show/preview/reset/extend/batch
managementOperations, same browser/native validation/audit. Requires matching
clock-reset/deadline-timing-check capabilities; extend/add also needs clock-extend.
Offline native info/list inspect state; there is no unsynchronized clock editor.

Minutes: whole 1..360. reset sets remaining time FROM GATEWAY REQUEST ACCEPTANCE,
not delayed native delivery. extend/add add to the previous committed deadline.
reset-default explicitly chooses each student's CURRENT enrollment/exam duration
(sandbox five minutes), not the original attempt snapshot; future default edits
alone still change no running clock. Only ACTIVE/LOCKED, unprotected and before
the current deadline; never reopen completed/expired work, refund time, change
the immutable original deadline/access hold or authorize continuation.
preview reads each current default without reserving time and returns target
specifications containing SECONDS. Review them, then reset-default with those
exact amounts; a changed default refuses instead of silently changing allowance.
Defaults not representable in whole minutes need an explicit minutes choice.

Inspect web attempts show ATTEMPT first. --revision is its integer clock revision,
not an exam-definition hash. Bulk selection is explicit, 1..100 unique targets;
wrong-exam/duplicate selection rejects the batch. Individual failures are reported
per target; accepted intents survive other failures. No implicit all-students edit.

IMPORTANT: outer confirmed=true means the GATEWAY accepted the operation only.
result.confirmed/status and each bulk target identify NATIVE applied versus pending
or failed. Native SSH heartbeat/signed deadline timing performs delivery outside
the SQLite transaction. Disconnected intents remain pending, never silently lost.
show CLOCK_REQUEST_UUID and fresh web attempts show/native info verify application.

Common flags: --config FILE (default /etc/exam-agent/agent.json), --request UUID.
Lost reply: repeat identical command/arguments with the printed --request ID.
Single child intent defaults to that parent ID; bulk children are deterministic
per parent/attempt. --intent or :INTENT explicitly retains a printed child request
ID when retrying selected failures under a NEW parent. Never add minutes again
merely because an acknowledgement was lost. Changed arguments/actor/revision for
an existing child conflict. A new parent/read is needed to inspect fresh status.

Examples:
  sudo examctl web attempts show ATTEMPT
  sudo examctl web clocks reset ATTEMPT --minutes 90 --revision 0
  sudo examctl web clocks extend ATTEMPT --minutes 5 --revision 1
  sudo examctl web clocks preview midterm --target UUID1:0 --target UUID2:1
  sudo examctl web clocks reset-default midterm --target UUID1:0:5400 --target UUID2:1:7200
  sudo examctl web clocks add midterm --minutes 5 --target UUID1:0:PRIOR-CHILD-ID
  sudo examctl web clocks show CLOCK_REQUEST_UUID

Exit status: 0 authenticated acceptance (may be pending), 1 refusal/partial bulk
failure/operational error, 2 invalid syntax. Read every per-target result.`)
}

func webClocksMain(args []string) int {
	if _, help := helpRequest(args); help {
		webClocksHelp(os.Stdout)
		return 0
	}
	flags := flag.NewFlagSet("examctl web clocks", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	config := flags.String("config", "/etc/exam-agent/agent.json", "root configuration")
	request := flags.String("request", "", "durable parent request UUID")
	intent := flags.String("intent", "", "existing single child clock UUID")
	minutes := flags.Int("minutes", 0, "whole minutes")
	revision := flags.String("revision", "", "current integer clock revision")
	var targets clockTargets
	flags.Var(&targets, "target", "ATTEMPT:REV[:INTENT], repeat up to 100")
	usage := func(message string) int { fmt.Fprintln(os.Stderr, message+"; run examctl web clocks help"); return 2 }
	if err := flags.Parse(ordered(args)); err != nil {
		return usage("invalid clock flags")
	}
	w := flags.Args()
	if len(w) == 2 && w[1] == "help" {
		webClocksHelp(os.Stdout)
		return 0
	}
	if len(w) != 3 || w[0] != "clocks" {
		return usage("choose show/reset/extend/reset-default/add and its target")
	}
	if (*request != "" && !managementUUID.MatchString(*request)) || (*intent != "" && !managementUUID.MatchString(*intent)) {
		return usage("request/intent must be UUIDs")
	}
	seen := map[string]bool{}
	flags.Visit(func(f *flag.Flag) { seen[f.Name] = true })
	if *request == "" {
		*request = core.ManagementID()
	}
	operation := "clocks." + w[1]
	b := map[string]any{}
	switch w[1] {
	case "show":
		if !managementUUID.MatchString(w[2]) || seen["minutes"] || seen["revision"] || seen["intent"] || len(targets) > 0 {
			return usage("show needs only a CLOCK_REQUEST_UUID, without mutation flags")
		}
		b["id"] = w[2]
	case "reset", "extend":
		rev, err := strconv.Atoi(*revision)
		if !managementUUID.MatchString(w[2]) || err != nil || rev < 0 || *minutes < 1 || *minutes > 360 || len(targets) > 0 {
			return usage("single reset/extend requires ATTEMPT UUID, --minutes 1..360 and --revision integer >=0, without --target")
		}
		if *intent == "" {
			*intent = *request
		}
		b["id"], b["minutes"], b["revision"], b["requestID"] = w[2], *minutes, rev, *intent
	case "preview", "reset-default", "add":
		if !regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`).MatchString(w[2]) || len(targets) < 1 || len(targets) > 100 || seen["revision"] || seen["intent"] || (w[1] != "add" && seen["minutes"]) || (w[1] == "add" && (*minutes < 1 || *minutes > 360)) {
			return usage("bulk needs EXAM and 1..100 --target values; preview/reset-default forbid --minutes, add requires it")
		}
		selected := map[string]bool{}
		values := []map[string]any{}
		for _, target := range targets {
			parts := strings.Split(target, ":")
			minParts, maxParts := 2, 3
			if w[1] == "preview" {
				maxParts = 2
			}
			if w[1] == "reset-default" {
				minParts, maxParts = 3, 4
			}
			if len(parts) < minParts || len(parts) > maxParts || !managementUUID.MatchString(parts[0]) {
				return usage("--target: preview ATTEMPT:REV; add ATTEMPT:REV[:INTENT]; reset-default ATTEMPT:REV:SECONDS[:INTENT] (run preview first)")
			}
			rev, err := strconv.Atoi(parts[1])
			if err != nil || rev < 0 || selected[parts[0]] {
				return usage("target revisions must be >=0; duplicate attempt selection is refused")
			}
			selected[parts[0]] = true
			value := map[string]any{"id": parts[0], "revision": rev}
			if w[1] == "preview" {
				values = append(values, value)
				continue
			}
			child := clockChildID(*request, parts[0])
			intentIndex := 2
			if w[1] == "reset-default" {
				seconds, err := strconv.Atoi(parts[2])
				if err != nil || seconds < 60 || seconds > 21600 || seconds%60 != 0 {
					return usage("reviewed SECONDS must be whole minutes, 60..21600; use preview")
				}
				value["expectedSeconds"], intentIndex = seconds, 3
			}
			if len(parts) > intentIndex {
				if !managementUUID.MatchString(parts[intentIndex]) {
					return usage("invalid target child intent UUID")
				}
				child = parts[intentIndex]
			}
			value["requestID"] = child
			values = append(values, value)
		}
		action := "reset"
		if w[1] == "add" {
			action = "extend"
			b["minutes"] = *minutes
		}
		b["exam"], b["action"], b["targets"], operation = w[2], action, values, "clocks.batch"
		if w[1] == "preview" {
			delete(b, "action")
			operation = "clocks.preview"
		}
	default:
		return usage("unsupported clock workflow")
	}
	return executeWeb(*config, *request, operation, b, "")
}
