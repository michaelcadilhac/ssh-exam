package main

// Runtime entry: webMain routes explicit scripting options here. The ordinary
// command interface remains compatible. All calls retain the existing signed
// management identity, named authorization and nested scope validators.
import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"errors"
	"examworkspace/agent/internal/core"
	"flag"
	"fmt"
	"io"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"text/tabwriter"
	"time"
)

const scriptExportBytes = 32 * 1024 * 1024
const scriptExportRows = 10000

type scriptStrings []string

func (s *scriptStrings) String() string     { return strings.Join(*s, ",") }
func (s *scriptStrings) Set(v string) error { *s = append(*s, v); return nil }

type scriptOptions struct {
	config, request, format, fields, receipt, from, definition, errorFormat, input, output string
	all, noHeader, resume                                                                  bool
}

func scriptingRequested(args []string) bool {
	for _, arg := range args {
		switch strings.SplitN(arg, "=", 2)[0] {
		case "--all", "--format", "--fields", "--no-header", "--receipt", "--from-receipt", "--definition-from", "--resume", "--error-format", "--input":
			return true
		}
	}
	return false
}

func scriptingHelp(w io.Writer) {
	fmt.Fprintln(w, `Shell scripting options (existing root authentication and policy):
  web exams show EXAM --receipt FILE
  web {exams,students,attempts,grants} list [EXAM] --all --format jsonl
  web attempts list --exam EXAM --exam OTHER --all --format tsv
      --fields username,start,id,checksum --no-header
  web grants additional-preview EXAM USER... --definition-from FILE
      --saved-sources FILE|- --duration-minutes N --earliest RFC3339
      --latest RFC3339 --reason TEXT --receipt FILE --format table
  web grants additional-preview --from-receipt REVIEW --resume --format table
  web grants issue-show --from-receipt REVIEW --format table
  web grants issue-confirm --from-receipt REVIEW --receipt ISSUED --resume
  web grants source-sync --from-receipt ISSUED --receipt SYNC --resume

--format json (existing envelope), jsonl, tsv, csv, table. --fields selects
explicit dot-separated metadata fields. TSV refuses control characters; null is
empty. --no-header applies to tsv/csv/table. --username is an exact list filter;
--q remains the dashboard substring search. Multiple --exam values apply to
attempts. --all follows every cursor, including empty filtered pages, with fresh
read IDs. Complete export is bounded to 10000 rows/32MiB; failure emits no partial
stdout. Multi-page data is metadata observed over time, not an atomic snapshot.

Receipts are private, versioned metadata bound to agent/origin/verification key
and exact arguments. Mutation request IDs are saved BEFORE sending. --resume
reuses the original intent, never silently refreshes settings or issues another
batch. A signed refusal remains a refusal; after repair deliberately use a NEW
review/request/receipt. Unknown outcomes inspect/retry the SAME receipt. Read
receipts are immutable snapshots; use a new file for fresh status. --definition-from
requires an authenticated exams.show receipt; confirmation revalidates the server.
No credential-bearing operations can be stored in scripting receipts.

--input FILE|- accepts CSV username,attempt,checksum with optional duration_seconds
and require_webcam columns, or JSONL {username,settings:{duration,webcam},work}.
Every selected student needs one explicit row. Duration uses seconds; webcam
accepts true/false (CSV also required/optional). No source/settings are guessed.
Beside agent.json, optional root-private examctl.json can set https_proxy/no_proxy
for this CLI only. It cannot change TLS or signature verification. Existing proxy
environment variables take precedence. See docs/examctl-scripting.md.

Batch source-sync consumes exact issued grant references. It verifies each archive
and durable retention independently, reports partial/unknown/refused outcomes and
can resume. It never releases a pin, changes a revision, reissues a grant, starts
time or overrides holds. Receipt publication is not native execution permission.
--error-format json exposes code/outcome/request/retry on stderr. Output write
failure returns nonzero even if a mutation completed; retain its receipt.
The CLI never selects latest work: keep course-specific selection in your script.`)
}

func scriptFail(o scriptOptions, code, outcome, retry string, err error) int {
	if o.errorFormat == "json" {
		message := err.Error()
		if len(message) > 1500 {
			message = message[:1500]
		}
		_ = json.NewEncoder(os.Stderr).Encode(map[string]any{"version": 1, "ok": false, "code": code, "outcome": outcome, "request": o.request, "retry": retry, "message": message})
	} else {
		fmt.Fprintln(os.Stderr, err)
		if o.receipt != "" {
			fmt.Fprintln(os.Stderr, "Retain receipt:", o.receipt)
		}
		if o.request != "" {
			fmt.Fprintln(os.Stderr, "Request:", o.request)
		}
	}
	if code == "usage" {
		return 2
	}
	return 1
}

func webScriptingMain(args []string) int {
	if _, help := helpRequest(args); help {
		scriptingHelp(os.Stdout)
		return 0
	}
	f := flag.NewFlagSet("examctl scripting", flag.ContinueOnError)
	f.SetOutput(os.Stderr)
	for i, arg := range args {
		if arg == "--error-format=json" || (arg == "--error-format" && i+1 < len(args) && args[i+1] == "json") {
			f.SetOutput(io.Discard)
		}
	}
	o := scriptOptions{}
	f.StringVar(&o.config, "config", "/etc/exam-agent/agent.json", "protected agent configuration")
	f.StringVar(&o.request, "request", "", "exact request UUID")
	f.StringVar(&o.format, "format", "json", "json/jsonl/tsv/csv/table")
	f.StringVar(&o.fields, "fields", "", "comma-separated metadata fields")
	f.StringVar(&o.receipt, "receipt", "", "private durable operation receipt")
	f.StringVar(&o.from, "from-receipt", "", "original reviewed/issued receipt")
	f.StringVar(&o.definition, "definition-from", "", "saved exams.show receipt")
	f.StringVar(&o.errorFormat, "error-format", "text", "text/json")
	f.StringVar(&o.input, "input", "", "explicit per-student batch FILE|-")
	f.StringVar(&o.output, "output", "", "new private complete export file")
	f.BoolVar(&o.all, "all", false, "follow every page")
	f.BoolVar(&o.noHeader, "no-header", false, "omit text header")
	f.BoolVar(&o.resume, "resume", false, "retry original durable intent")
	var exams scriptStrings
	f.Var(&exams, "exam", "attempt exam filter; repeat for multiple exams")
	limit := f.Int("limit", 100, "page size 1..200")
	after := f.String("after", "", "exclusive cursor")
	username := f.String("username", "", "exact username")
	query := f.String("q", "", "username substring")
	view := f.String("view", "all", "attempt dashboard view")
	lifecycle := f.String("lifecycle", "active", "exam lifecycle filter")
	revision := f.String("revision", "", "exact review/source revision")
	definition := f.String("definition-revision", "", "exact definition hash")
	template := f.String("template-version", "", "exact materials hash")
	from := f.String("earliest", "", "finite earliest Begin")
	until := f.String("latest", "", "finite latest Begin")
	minutes := f.Int64("duration-minutes", 0, "whole minutes")
	seconds := f.Int64("duration-seconds", 0, "exact seconds")
	webcam := f.String("webcam", "", "required/optional override")
	reason := f.String("reason", "", "audited reason")
	saved := f.String("saved-sources", "", "exact per-student CSV FILE|-")
	workFlags := registerGrantWork(f)
	if err := f.Parse(ordered(args)); err != nil {
		return scriptFail(o, "usage", "not_sent", "correct_arguments", err)
	}
	if _, help := helpRequest(args); help {
		scriptingHelp(os.Stdout)
		return 0
	}
	w := f.Args()
	bad := func(message string) int {
		return scriptFail(o, "usage", "not_sent", "correct_arguments", errors.New(message+"; use examctl help scripting"))
	}
	if len(w) < 2 {
		return bad("choose a supported metadata/grant command")
	}
	if o.errorFormat != "text" && o.errorFormat != "json" {
		return bad("--error-format must be text/json")
	}
	if o.format != "json" && o.format != "jsonl" && o.format != "tsv" && o.format != "csv" && o.format != "table" {
		return bad("unsupported --format")
	}
	if o.noHeader && (o.format == "json" || o.format == "jsonl") {
		return bad("--no-header requires tsv/csv/table")
	}
	if _, err := scriptFields(o.fields); err != nil {
		return bad(err.Error())
	}
	if o.request != "" && !managementUUID.MatchString(o.request) {
		return bad("invalid --request UUID")
	}
	seen := map[string]bool{}
	f.Visit(func(v *flag.Flag) { seen[v.Name] = true })
	for name, value := range map[string]string{"receipt": o.receipt, "from-receipt": o.from, "definition-from": o.definition, "input": o.input, "output": o.output, "fields": o.fields, "request": o.request, "username": *username, "saved-sources": *saved, "webcam": *webcam} {
		if seen[name] && value == "" {
			return bad("explicit --" + name + " cannot be empty; no fallback or new intent inferred")
		}
	}
	work, workErr := workFlags.selection(seen)
	if workErr != nil {
		return bad(workErr.Error())
	}
	op := w[0] + "." + w[1]
	if (op == "grants.additional-preview" || op == "grants.issue-preview") && o.from != "" {
		if len(w) != 2 || !o.resume || (o.receipt != "" && o.receipt != o.from) {
			return bad("resume the original preview with --from-receipt FILE --resume; no new arguments/receipt")
		}
		for key := range seen {
			switch key {
			case "config", "from-receipt", "resume", "receipt", "format", "fields", "no-header", "error-format", "output":
			default:
				return bad("preview retry uses exact saved arguments; no --" + key)
			}
		}
		if os.Getuid() != 0 || os.Geteuid() != 0 {
			return scriptFail(o, "root_required", "not_sent", "run_as_root", errors.New("run as root on the class server"))
		}
		c, err := scriptLoadConfig(o.config)
		if err != nil {
			return scriptFail(o, "configuration", "not_sent", "repair_configuration", err)
		}
		r, err := readScriptReceipt(o.from)
		if err == nil {
			err = r.checkContext(c)
		}
		if err != nil {
			return scriptFail(o, "receipt_scope", "not_sent", "inspect_receipt", err)
		}
		if r.Operation != op {
			return bad("receipt belongs to another operation")
		}
		o.receipt = o.from
		o.request = r.Request
		return scriptOperation(c, o, op, r.Body)
	}
	if w[0] == "grants" && w[1] == "source-sync" && o.from != "" {
		if len(w) != 2 {
			return bad("batch source-sync takes its exact issued receipt, not a target")
		}
		return scriptSyncBatch(o, seen)
	}
	body := map[string]any{}
	allowed := map[string]bool{"config": true, "request": true, "format": true, "fields": true, "receipt": true, "error-format": true, "output": true, "no-header": true, "resume": true}
	for _, name := range []string{"all", "limit", "after", "username"} {
		if w[1] == "list" {
			allowed[name] = true
		}
	}
	if w[1] == "list" {
		if *limit < 1 || *limit > 200 || (o.all && (*after != "" || o.request != "")) {
			return bad("choose page size1..200; --all requires fresh reads without --after/--request")
		}
		body["limit"] = *limit
		if *after != "" {
			body["after"] = *after
		}
		if *username != "" && !regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9_-]{0,31}$`).MatchString(*username) {
			return bad("invalid exact username")
		}
		switch w[0] {
		case "exams":
			if len(w) != 2 || len(exams) != 0 || *username != "" {
				return bad("exams list has no target/username")
			}
			allowed["lifecycle"] = true
			if *lifecycle != "active" && *lifecycle != "archived" && *lifecycle != "all" {
				return bad("invalid lifecycle")
			}
			body["lifecycle"] = *lifecycle
		case "students", "grants", "attempts":
			if len(w) == 3 {
				exams = append(exams, w[2])
			} else if len(w) != 2 {
				return bad("select an exact exam")
			}
			if len(exams) == 0 || (len(exams) > 1 && w[0] != "attempts") {
				return bad("only attempts list accepts multiple exams")
			}
			allowed["exam"] = true
			for _, exam := range exams {
				if !catalogName.MatchString(exam) {
					return bad("invalid exam")
				}
			}
			body["exam"] = exams[0]
			if w[0] == "grants" && *username != "" {
				body["username"] = *username
			}
			if w[0] == "attempts" {
				allowed["view"], allowed["q"] = true, true
				if len(*query) > 64 || (*query != "" && *username != "") {
					return bad("choose --q OR exact --username")
				}
				switch *view {
				case "all", "working", "attention", "secured", "camera", "no-camera", "PREPARING", "ACTIVE", "LOCKED", "FINALIZING", "COMPLETED", "COLLECTION_FAILED", "CANCELLED_BEFORE_START":
				default:
					return bad("invalid attempt view")
				}
				body["view"], body["q"] = *view, *query
				if *view == "all" {
					body["view"] = ""
				}
			}
		default:
			return bad("unsupported list")
		}
	} else if op == "exams.show" || op == "grants.show" {
		if len(w) != 3 || (w[0] == "exams" && !catalogName.MatchString(w[2])) || (w[0] == "grants" && !managementUUID.MatchString(w[2])) {
			return bad("choose the exact show target")
		}
		body["id"] = w[2]
	} else if op == "grants.additional-preview" || op == "grants.issue-preview" {
		if len(w) < 3 || !catalogName.MatchString(w[2]) {
			return bad("choose an exact exam")
		}
		for _, key := range []string{"definition-from", "definition-revision", "template-version", "earliest", "latest", "reason", "saved-sources", "input", "duration-minutes", "duration-seconds", "webcam", "work", "work-template", "work-template-version", "work-attempt", "work-checksum"} {
			allowed[key] = true
		}
		body["exam"] = w[2]
		if o.definition != "" {
			if seen["definition-revision"] || seen["template-version"] {
				return bad("choose --definition-from OR explicit hashes")
			}
			r, err := readScriptReceipt(o.definition)
			if err != nil {
				return scriptFail(o, "receipt", "not_sent", "inspect_receipt", err)
			}
			if r.Operation != "exams.show" || r.Outcome != "confirmed" || stringField(r.Body, "id") != w[2] {
				return bad("definition receipt targets another operation/exam or is unconfirmed")
			}
			var result map[string]any
			if decodeScriptJSON(r.Result.Result, &result) != nil {
				return bad("invalid definition receipt")
			}
			exam, ok := result["exam"].(map[string]any)
			if !ok || exam["id"] != w[2] {
				return bad("wrong definition receipt")
			}
			*definition, _ = result["revision"].(string)
			*template, _ = exam["template_version"].(string)
		}
		if !catalogHash.MatchString(*definition) || !catalogHash.MatchString(*template) || len(strings.TrimSpace(*reason)) < 8 || len(*reason) > 1000 {
			return bad("exact definition/material hashes and an8..1000-character reason required")
		}
		a, err1 := time.Parse(time.RFC3339Nano, *from)
		b, err2 := time.Parse(time.RFC3339Nano, *until)
		if err1 != nil || err2 != nil || !b.After(a) {
			return bad("explicit ordered RFC3339 Begin window required")
		}
		body["definition_revision"], body["template_version"], body["earliest"], body["latest"], body["reason"] = *definition, *template, a.UnixMilli(), b.UnixMilli(), strings.TrimSpace(*reason)
		users := append([]string{}, w[3:]...)
		if *saved != "" {
			selected, err := readGrantSavedSources(*saved)
			if err != nil {
				return bad(err.Error())
			}
			body["saved_sources"] = selected
			if len(users) == 0 {
				for _, row := range selected {
					users = append(users, row.Username)
				}
			}
			if len(users) != len(selected) {
				return bad("saved sources must cover every selected student exactly once")
			}
			mapped := map[string]bool{}
			for _, row := range selected {
				mapped[row.Username] = true
			}
			for _, user := range users {
				if !mapped[user] {
					return bad("saved sources omit a selected student")
				}
			}
		}
		if o.input != "" {
			if *saved != "" {
				return bad("choose --input OR --saved-sources")
			}
			if err := scriptBatchInput(o.input, &users, body); err != nil {
				return bad(err.Error())
			}
		}
		if len(users) < 1 || len(users) > 200 {
			return bad("select1..200 enrolled students")
		}
		unique := map[string]bool{}
		for _, user := range users {
			if !regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9_-]{0,31}$`).MatchString(user) || unique[user] {
				return bad("invalid/duplicate student")
			}
			unique[user] = true
		}
		body["usernames"] = users
		if work != nil {
			if *saved != "" || o.input != "" {
				return bad("choose explicit per-student work OR shared --work")
			}
			body["work"] = work
		}
		if op == "grants.additional-preview" {
			if seen["duration-minutes"] && (*minutes < 1 || *minutes > 360) {
				return bad("minutes must be1..360")
			}
			if seen["duration-seconds"] && (*seconds < 60 || *seconds > 21600) {
				return bad("seconds must be60..21600")
			}
			if *minutes != 0 && *seconds != 0 {
				return bad("choose minutes OR seconds")
			}
			duration := *seconds
			if *minutes != 0 {
				duration = *minutes * 60
			}
			if duration == 0 {
				if supplied, ok := body["duration"].(int64); ok {
					duration = supplied
				}
			}
			if duration < 60 || duration > 21600 {
				return bad("explicit additional allowance60..21600 seconds required")
			}
			body["duration"] = duration
			if *webcam != "" {
				if *webcam != "required" && *webcam != "optional" {
					return bad("webcam must be required/optional")
				}
				body["webcam"] = *webcam == "required"
			}
		} else if *saved != "" || o.input != "" || work != nil || seen["duration-minutes"] || seen["duration-seconds"] || seen["webcam"] {
			return bad("saved sources/settings overrides require additional-preview")
		}
	} else if op == "grants.issue-show" || op == "grants.issue-confirm" || op == "grants.issue-cancel" {
		allowed["from-receipt"], allowed["revision"] = true, true
		if o.from != "" {
			if len(w) != 2 || seen["revision"] {
				return bad("receipt supplies the exact preview and revision; do not override")
			}
			r, err := readScriptReceipt(o.from)
			if err != nil {
				return scriptFail(o, "receipt", "not_sent", "inspect_receipt", err)
			}
			if r.Outcome != "confirmed" || (r.Operation != "grants.additional-preview" && r.Operation != "grants.issue-preview" && r.Operation != "grants.issue-show") {
				return bad("requires a confirmed original preview receipt")
			}
			var result grantIssuanceResult
			if json.Unmarshal(r.Result.Result, &result) != nil || !managementUUID.MatchString(result.ID) || !catalogHash.MatchString(result.Revision) {
				return bad("invalid saved review")
			}
			body["id"], *revision = result.ID, result.Revision
		} else {
			if len(w) != 3 || !managementUUID.MatchString(w[2]) {
				return bad("choose the original preview UUID")
			}
			body["id"] = w[2]
		}
		if op != "grants.issue-show" {
			if !catalogHash.MatchString(*revision) {
				return bad("exact reviewed hash required")
			}
			body["revision"] = *revision
		} else if seen["revision"] {
			return bad("issue-show does not accept revision")
		}
	} else {
		return bad("scripting options are limited to metadata exports, grant reviews and saved-source synchronization")
	}
	for key := range seen {
		if !allowed[key] {
			return bad("--" + key + " is not supported for this operation")
		}
	}
	if o.all && w[1] != "list" {
		return bad("--all is only for lists")
	}
	if o.resume && o.receipt == "" {
		return bad("--resume requires a durable --receipt")
	}
	if len(exams) > 1 && !o.all {
		return bad("multiple exams require --all so no page is silently omitted")
	}
	if os.Getuid() != 0 || os.Geteuid() != 0 {
		return scriptFail(o, "root_required", "not_sent", "run_as_root", errors.New("run examctl as root on the class server"))
	}
	c, err := scriptLoadConfig(o.config)
	if err != nil {
		return scriptFail(o, "configuration", "not_sent", "repair_configuration", err)
	}
	for _, name := range []string{o.from, o.definition} {
		if name != "" {
			r, err := readScriptReceipt(name)
			if err != nil || r.checkContext(c) != nil {
				return scriptFail(o, "receipt_scope", "not_sent", "inspect_receipt", errors.New("receipt does not match this protected agent/origin/key"))
			}
		}
	}
	if w[1] == "list" {
		return scriptExport(c, o, op, body, exams, *username)
	}
	return scriptOperation(c, o, op, body)
}

func decodeScriptJSON(raw []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if decoder.Decode(new(any)) != io.EOF {
		return errors.New("trailing JSON data")
	}
	return nil
}

func stringField(body map[string]any, key string) string { s, _ := body[key].(string); return s }

func scriptValidatedCall(c core.Config, operation string, body any, request string) (core.ManagementResult, error) {
	r, err := core.ManagementCall(c, operation, body, request)
	if err != nil {
		return r, err
	}
	return r, scriptValidateResult(c.AgentID, operation, body, r.Result)
}

func scriptValidateResult(agent, operation string, body any, raw json.RawMessage) error {
	for _, validate := range []func(string, any, json.RawMessage) error{validateExamResult, validateMonitoringResult, validateClockResult, validateInterruptionResult} {
		if err := validate(operation, body, raw); err != nil {
			return err
		}
	}
	if err := validateGrantResult(operation, body, raw, agent); err != nil {
		return err
	}
	if err := validateCatalogRead(operation, body, raw, agent); err != nil {
		return err
	}
	return nil
}

func scriptExport(c core.Config, o scriptOptions, operation string, body map[string]any, exams []string, username string) int {
	key := strings.TrimSuffix(operation, ".list")
	if key == "students" {
		key = "students"
	}
	// A non-nil empty collection is a valid completed export. nil tells the
	// formatter to derive a single operation row from its result envelope.
	rows := make([]map[string]any, 0)
	var finalNext *string
	var lastRequest string
	started := time.Now().UnixMilli()
	if len(exams) == 0 {
		exams = []string{""}
	}
	seenExams, identities := map[string]bool{}, map[string]bool{}
	for _, exam := range exams {
		if seenExams[exam] {
			return scriptFail(o, "usage", "not_sent", "correct_arguments", errors.New("duplicate exam selection"))
		}
		seenExams[exam] = true
		page := map[string]any{}
		for k, v := range body {
			page[k] = v
		}
		if exam != "" {
			page["exam"] = exam
		}
		cursors := map[string]bool{}
		for {
			request := o.request
			if request == "" {
				request = core.ManagementID()
			}
			r, err := scriptValidatedCall(c, operation, page, request)
			if err != nil {
				return scriptManagementFailure(o, request, err)
			}
			var result map[string]json.RawMessage
			if json.Unmarshal(r.Result, &result) != nil || result[key] == nil {
				return scriptFail(o, "reply_schema", "unknown", "inspect_original", errors.New("list reply lacks its typed row collection"))
			}
			var part []map[string]any
			if decodeScriptJSON(result[key], &part) != nil {
				return scriptFail(o, "reply_schema", "unknown", "inspect_original", errors.New("invalid list rows"))
			}
			if err := validateScriptListRows(operation, page, part); err != nil {
				return scriptFail(o, "reply_scope", "unknown", "new_export", err)
			}
			for _, row := range part {
				if username != "" && row["username"] != username {
					continue
				}
				identity, _ := row["id"].(string)
				if operation == "students.list" {
					identity, _ = row["username"].(string)
				}
				if operation == "exams.list" {
					if e, ok := row["exam"].(map[string]any); ok {
						identity, _ = e["id"].(string)
					}
				}
				if identity == "" || identities[exam+"\x00"+identity] {
					return scriptFail(o, "inconsistent_export", "not_changed", "new_export", errors.New("missing/duplicate identity in export"))
				}
				identities[exam+"\x00"+identity] = true
				rows = append(rows, row)
			}
			var next *string
			if raw, exists := result["next"]; !exists || json.Unmarshal(raw, &next) != nil {
				return scriptFail(o, "reply_schema", "unknown", "new_export", errors.New("list reply lacks its next cursor"))
			}
			if next != nil && (*next == "" || *next <= stringField(page, "after")) {
				return scriptFail(o, "cursor_cycle", "not_changed", "new_export", errors.New("non-advancing list cursor; no complete export inferred"))
			}
			finalNext, lastRequest = next, request
			encoded, _ := json.Marshal(rows)
			if len(rows) > scriptExportRows || len(encoded) > scriptExportBytes {
				return scriptFail(o, "export_limit", "not_changed", "narrow_filter", errors.New("complete export exceeds10000 rows/32MiB; narrow the selection; no partial output"))
			}
			if !o.all || next == nil {
				break
			}
			if *next == "" || cursors[*next] || page["after"] == *next {
				return scriptFail(o, "cursor_cycle", "not_changed", "new_export", errors.New("repeated list cursor; no complete export inferred"))
			}
			cursors[*next] = true
			page["after"] = *next
		}
	}
	if o.all {
		finalNext = nil
	}
	result, _ := json.Marshal(map[string]any{key: rows, "next": finalNext, "observed_from": started, "observed_until": time.Now().UnixMilli(), "atomic_snapshot": false, "source": "authenticated gateway metadata; native archive verification remains required"})
	r := core.ManagementResult{Operation: operation, Confirmed: true, Result: result}
	if len(exams) == 1 && !o.all {
		r.Request = lastRequest
	}
	if o.receipt != "" {
		return scriptFail(o, "usage", "not_changed", "use_export_output", errors.New("list exports use --output; receipts are for exact show/review/mutation operations"))
	}
	return scriptOutput(o, r, rows)
}

func scriptRows(r core.ManagementResult) ([]map[string]any, error) {
	var value map[string]any
	if err := decodeScriptJSON(r.Result, &value); err != nil {
		return nil, err
	}
	if raw, ok := value["rows"].([]any); ok {
		rows := make([]map[string]any, 0, len(raw))
		for _, entry := range raw {
			row, ok := entry.(map[string]any)
			if !ok {
				return nil, errors.New("invalid review row")
			}
			rows = append(rows, row)
		}
		return rows, nil
	}
	return []map[string]any{value}, nil
}

func scriptFields(value string) ([]string, error) {
	if value == "" {
		return nil, nil
	}
	fields, unique := strings.Split(value, ","), map[string]bool{}
	for _, field := range fields {
		if !regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$`).MatchString(field) || unique[field] {
			return nil, errors.New("invalid/duplicate projection field")
		}
		unique[field] = true
	}
	return fields, nil
}

func scriptField(row map[string]any, field string) (any, error) {
	var value any = row
	for _, key := range strings.Split(field, ".") {
		object, ok := value.(map[string]any)
		if !ok {
			return nil, errors.New("projection traverses a non-object")
		}
		var exists bool
		value, exists = object[key]
		if !exists {
			return nil, fmt.Errorf("field %s is absent; no value invented", field)
		}
	}
	return value, nil
}

func scriptOutput(o scriptOptions, r core.ManagementResult, rows []map[string]any) int {
	outcome := "unknown"
	if r.Confirmed {
		outcome = "confirmed"
	}
	if rows == nil {
		var err error
		rows, err = scriptRows(r)
		if err != nil {
			return scriptFail(o, "output_schema", "unknown", "inspect_receipt", err)
		}
	}
	var output bytes.Buffer
	if o.fields != "" && (o.format == "json" || o.format == "jsonl") {
		fields, err := scriptFields(o.fields)
		if err != nil {
			return scriptFail(o, "projection", outcome, "inspect_receipt", err)
		}
		projected := make([]map[string]any, 0, len(rows))
		for _, row := range rows {
			selected := map[string]any{}
			for _, field := range fields {
				value, err := scriptField(row, field)
				if err != nil {
					return scriptFail(o, "projection", outcome, "correct_fields", err)
				}
				selected[field] = value
			}
			projected = append(projected, selected)
		}
		rows = projected
		if o.format == "json" {
			var result map[string]any
			if err := decodeScriptJSON(r.Result, &result); err != nil {
				return scriptFail(o, "output_schema", outcome, "inspect_receipt", err)
			}
			key := ""
			if strings.HasSuffix(r.Operation, ".list") {
				key = strings.TrimSuffix(r.Operation, ".list")
			} else if _, ok := result["rows"]; ok {
				key = "rows"
			} else if _, ok := result["items"]; ok {
				key = "items"
			}
			if key != "" {
				result[key] = rows
				r.Result, _ = json.Marshal(result)
			} else if len(rows) == 1 {
				r.Result, _ = json.Marshal(rows[0])
			} else {
				r.Result, _ = json.Marshal(rows)
			}
		}
	}
	if o.format == "json" {
		if err := json.NewEncoder(&output).Encode(r); err != nil {
			return scriptFail(o, "output", "confirmed", "inspect_receipt", err)
		}
	} else if o.format == "jsonl" {
		encoder := json.NewEncoder(&output)
		for _, row := range rows {
			if err := encoder.Encode(row); err != nil {
				return scriptFail(o, "output", "confirmed", "inspect_receipt", err)
			}
		}
	} else {
		fields := []string{}
		if o.fields != "" {
			fields = strings.Split(o.fields, ",")
		} else {
			keys := map[string]bool{}
			for _, row := range rows {
				for key := range row {
					keys[key] = true
				}
			}
			for key := range keys {
				fields = append(fields, key)
			}
			sort.Strings(fields)
		}
		unique := map[string]bool{}
		for _, field := range fields {
			if !regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$`).MatchString(field) || unique[field] {
				return scriptFail(o, "usage", "not_changed", "correct_fields", errors.New("invalid/duplicate projection field"))
			}
			unique[field] = true
		}
		var records [][]string
		if !o.noHeader {
			records = append(records, fields)
		}
		for _, row := range rows {
			var record []string
			for _, field := range fields {
				var value any = row
				for _, key := range strings.Split(field, ".") {
					object, ok := value.(map[string]any)
					if !ok {
						return scriptFail(o, "projection", outcome, "correct_fields", errors.New("projection traverses a non-object"))
					}
					var exists bool
					value, exists = object[key]
					if !exists {
						return scriptFail(o, "projection", outcome, "correct_fields", fmt.Errorf("field %s is absent; no value invented", field))
					}
				}
				text := ""
				if value != nil {
					if v, ok := value.(string); ok {
						text = v
					} else {
						raw, err := json.Marshal(value)
						if err != nil {
							return scriptFail(o, "output", "unknown", "inspect_receipt", err)
						}
						text = string(raw)
					}
				}
				if o.format == "tsv" && strings.IndexFunc(text, func(r rune) bool { return r < 32 || r == 127 }) >= 0 {
					return scriptFail(o, "projection", outcome, "use_jsonl", errors.New("TSV field contains control characters; use JSONL or a safer projection"))
				}
				if o.format == "table" && strings.IndexFunc(text, func(r rune) bool { return r < 32 || r == 127 }) >= 0 {
					text = strconv.Quote(text)
				}
				record = append(record, text)
			}
			records = append(records, record)
		}
		if o.format == "csv" {
			writer := csv.NewWriter(&output)
			if err := writer.WriteAll(records); err != nil {
				return scriptFail(o, "output", "unknown", "inspect_receipt", err)
			}
		} else if o.format == "tsv" {
			for _, record := range records {
				output.WriteString(strings.Join(record, "\t") + "\n")
			}
		} else {
			writer := tabwriter.NewWriter(&output, 0, 4, 2, ' ', 0)
			if strings.HasPrefix(r.Operation, "grants.issue-") || r.Operation == "grants.additional-preview" {
				var metadata struct {
					ID, Status string
					Expires    int64
				}
				if json.Unmarshal(r.Result, &metadata) == nil && metadata.ID != "" {
					fmt.Fprintf(&output, "Review %s · %s · expires %s\n", metadata.ID, metadata.Status, time.UnixMilli(metadata.Expires).UTC().Format(time.RFC3339))
				}
			}
			for _, record := range records {
				fmt.Fprintln(writer, strings.Join(record, "\t"))
			}
			if err := writer.Flush(); err != nil {
				return scriptFail(o, "output", "unknown", "inspect_receipt", err)
			}
		}
	}
	var err error
	if o.output != "" {
		err = writeScriptExport(o.output, output.Bytes())
	} else {
		var n int
		n, err = os.Stdout.Write(output.Bytes())
		if err == nil && n != output.Len() {
			err = io.ErrShortWrite
		}
	}
	if err != nil {
		return scriptFail(o, "output_write", outcome, "inspect_receipt_before_retry", err)
	}
	return 0
}
