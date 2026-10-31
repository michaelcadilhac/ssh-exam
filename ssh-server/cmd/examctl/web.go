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
	"time"
)

func webArguments(args []string) ([]string, bool) {
	for i := 0; i < len(args); i++ {
		if takesValue(args[i]) {
			if !strings.Contains(args[i], "=") {
				i++
			}
			continue
		}
		if args[i] != "web" {
			return nil, false
		}
		return append(append([]string{}, args[:i]...), args[i+1:]...), true
	}
	return nil, false
}

func webHelp(out io.Writer) {
	fmt.Fprintln(out, `Usage: sudo examctl [--config FILE] web exams list [--limit N] [--after EXAM]
       sudo examctl web exams show EXAM [--request UUID]
       sudo examctl web exams create EXAM --template NAME --earliest RFC3339 --latest RFC3339 [SETTINGS]
       sudo examctl web exams update EXAM --revision HASH SETTINGS
       sudo examctl web exams retire-preview EXAM --action delete|archive|unarchive
       sudo examctl web exams native-review EXAM --out NEW-PRIVATE-FILE
       sudo examctl web exams reconcile-native EXAM --action delete|archive --revision HASH --review HASH --evidence FILE --reason TEXT
       sudo examctl web exams delete EXAM --revision HASH --review HASH --reason TEXT
       sudo examctl web exams archive EXAM --revision HASH --review HASH --reason TEXT
       sudo examctl web exams unarchive EXAM --revision HASH --review HASH --reason TEXT
       examctl web help

Manage gateway-owned exam definitions using the existing root agent identity over
verified outbound HTTPS. No browser login, separate token or inbound agent API.
The gateway must explicitly authorize the named exams.list/show/create/update operations in the agent's
managementOperations allowlist; the default is no management authorization.
Retirement separately requires exams.retire-preview/delete/archive/unarchive.
Legacy retirement additionally needs exams.native-reconcile explicitly authorized.
First inspect retire-preview, then run native-review --out NEW-PRIVATE-FILE as root.
native-review is offline; reconcile-native requires the authenticated gateway.
It observes initialized native state/catalogs/folders without changing accounts,
clocks, permissions, protected bytes or lifecycle. Unused/uncertain/live authority
refuses: inspect native info/recovery-grants; explicitly cancel only confirmed unused
legacy permissions. Quiesce old manual native writers; never clear files/flags.
Within ten minutes submit reconcile-native with that exact private evidence file,
action/revision/review and reason. Keep the file and SAME --request/arguments for
a lost-reply retry. Reconciliation is metadata, not retirement or archive integrity
verification. Then obtain a NEW retire-preview before confirmation (the review
changed). Web administration uses the same acknowledgement. Any web dependency or
definition change requires fresh reconciliation. Native-only history forbids delete.
--out FILE creates evidence exclusively with mode0600; never overwrites an old file.
--evidence FILE reads an existing root-owned0600 regular file, at most1MiB.
Delete only unused definitions. Archive history and preserve grants, attempts,
submissions, original deadlines, holds and audit. No physical work/submission
deletion or service action. Live/unused authority refuses archive until explicitly
resolved; no silent cancellation or automatic reopening. Sandbox stays reserved.
retire-preview returns allowed/blockers, exact revision and review digest. Inspect
it BEFORE confirmation. Stale resource/dependencies require a NEW review/intent;
after a lost reply repeat the SAME arguments and --request UUID first.
--lifecycle active|archived|all selects list visibility (default active); archived
definitions with unfinished work remain visible for monitoring. show stays available.

--config FILE  root agent configuration (default /etc/exam-agent/agent.json)
--limit N      list page size, default 100, range 1..200
--after EXAM   exclusive exam-ID cursor from a previous page's next field
--request UUID durable intent ID; new by default. Retry a lost reply with the same
               ID/arguments; use a NEW ID for a fresh read, not a cached snapshot.
--help         help without root or configuration

Settings (no ad hoc database/JSON editing required):
--name TEXT              name; creation default 'Programming exam'
--template NAME          installed native materials template; required on create
--template-version HASH  exact lowercase64-hex hash from templates sync/web templates
                        show; must have an attestation for this agent/name/hash
                        'legacy' explicitly clears this FUTURE default; no fallback
--duration-seconds N     60..21600; creation default 5400 (90 minutes)
--webcam required|optional  creation default required
--terminals N            1..4; creation default 4
--collection-file-mib N   1..4096 MiB logical bytes/file; creation default 128
--collection-total-mib N  1..16384 MiB logical bytes total; creation default 512
                        total must be at least per-file; 1 MiB = 1048576 bytes
--earliest RFC3339       earliest Begin, explicit date/time/zone; required on create
--latest RFC3339         latest Begin, not latest finish; required on create
--revision HASH          current 64-hex revision from show; required on update
--reason TEXT            optional audited reason, 8..1000 characters

Create never overwrites an existing ID. Update changes ONLY named settings and
refuses a stale revision; reload/show, review differences, then use a new intent.
Existing attempt settings, clocks, account restrictions and submissions remain
unchanged. Template deployment is separate; definition creation does not install
materials. Inspect templates verify/sync and web templates list/show first. A
catalog entry is historical attestation, not current availability. Native exact
staging/Begin and matching capabilities remain mandatory. Changing template name
never silently clears a selected version; select its matching hash or explicitly
choose legacy. This does not issue/revise grants or rewrite prepared snapshots.
Sandbox stays repeatable/five-minute/no-webcam, but NEW practice needs
an explicit finite Begin window. Configure it with show sandbox then update
sandbox --revision HASH --earliest RFC3339 --latest RFC3339 (same web settings).
An unconfigured/legacy indefinite window refuses new starts; no rolling default.
Existing saved attempt settings and started deadlines are never rewritten.
Collection limits apply to future settings snapshots; old attempts/archives retain
their limits (legacy omitted snapshots mean 32/64 MiB). Entry/depth limits remain
10000/32; no live disk quota or monitoring limit changes. Worker memory/runtime
bounds do not auto-increase: qualify storage/time capacity before larger settings.

JSON output names request, operation, confirmed and result. Confirmed means the
authenticated gateway operation completed, not that any native action was performed.
List includes per-definition revision hashes and a next cursor; show takes an
exam ID, not an attempt UUID. Student credentials are never used or retained.
Offline web requests fail honestly; native list/info remain available locally.
Initial enrollment-time snapshots, reviewed NEW legacy/additional grants,
empty or separate-template starters and finite repeatable sandbox practice are
supported: examctl web grants help. New enrollment/practice requires an attested
exact template version; a legacy mutable default is not new grant authority.
Reviewed definition retirement is available for lifecycle-tracked definitions;
legacy definitions use native-review, reconcile-native and a fresh retire-preview.
Unknown/live/uncertain native authority refuses; history always forces archive.
Saved-work issuance uses web grants help, then source-sync before availability.
Cancel first when replacing an unused legacy permission: inspect recovery-grants
revoke-preview/revoke, then separately issue the NEW saved-work grant. A failed
replacement cannot reopen the cancelled permission or consume time.
Native workspace cleanup uses matched CLI/agent/watchdog/reconcile roles:
examctl workspaces show/dry-run, reviewed cleanup and cleanup-status after a lost
reply. workspaces help covers explicit retry/cancel and preservation refusals.
Installation settings remain in configuration files; no website Settings screen,
remote file editor or automatic activation is provided. Native config help covers
offline show/validate, not loaded agreement. Never edit exam-state SQL/JSON to
complete management. Existing attempts/holds/history stay protected.

Examples:
  sudo examctl web exams list --limit 50
  sudo examctl web exams list --after midterm
  sudo examctl web exams show midterm
  sudo examctl web exams create midterm --name 'Midterm' --template v1 --template-version HASH-FROM-CATALOG --earliest '2026-10-26T09:00:00-05:00' --latest '2026-10-26T09:30:00-05:00'
  sudo examctl web exams update midterm --revision HASH-FROM-SHOW --duration-seconds 7200 --webcam optional
  sudo examctl web exams show midterm --request UUID-FROM-PREVIOUS-REQUEST

Exit status: 0 authenticated result, 1 refusal/operational failure, 2 syntax error.
Unknown/unverified replies never imply success; retain the request ID for retry.`)
	fmt.Fprintln(out, "\nRoster/CSV workflows: examctl web students help (list/add/remove/settings/import-preview/import-confirm/export/example).")
	fmt.Fprintln(out, "Attempt grants: examctl web grants help (enrollment, reviewed NEW legacy/additional issuance, empty/separate-template work, sandbox practice, inspect/revise/revoke).")
	fmt.Fprintln(out, "Gateway administrators: examctl web administrators help (bounded metadata list/show, secret-safe create; no credential reset/overwrite).")
	fmt.Fprintln(out, "Authenticated source attestations: examctl web templates help (list/show); native templates sync verifies before registering metadata.")
	fmt.Fprintln(out, "Alert inspection/test/manual reminders: examctl web alerts help (list/show/test/remind).")
	fmt.Fprintln(out, "Gateway attempt/clock workflows: examctl web attempts help; examctl web clocks help.")
	fmt.Fprintln(out, "Interruption review/authorization: examctl web interruptions help.")
	fmt.Fprintln(out, "Private monitoring metadata/images/replay/complete export/deletion/purge status: examctl web monitoring help.")
	fmt.Fprintln(out, "Shell-friendly complete exports, private review receipts and resumable batch source synchronization: examctl help scripting.")
}

func webCategory(args []string) string {
	for i := 0; i < len(args); i++ {
		if takesValue(args[i]) {
			if !strings.Contains(args[i], "=") {
				i++
			}
			continue
		}
		if strings.HasPrefix(args[i], "-") {
			continue
		}
		return args[i]
	}
	return ""
}

func webMain(args []string) int {
	if scriptingRequested(args) {
		return webScriptingMain(args)
	}
	if webCategory(args) == "administrators" {
		return webAdministratorsMain(args)
	}
	if webCategory(args) == "templates" {
		return webTemplatesMain(args)
	}
	if webCategory(args) == "monitoring" {
		return webMonitoringMain(args)
	}
	if webCategory(args) == "interruptions" {
		return webInterruptionsMain(args)
	}
	if webCategory(args) == "attempts" {
		return webAttemptsMain(args)
	}
	if webCategory(args) == "clocks" {
		return webClocksMain(args)
	}
	if webCategory(args) == "students" {
		return webStudentsMain(args)
	}
	if webCategory(args) == "grants" {
		return webGrantsMain(args)
	}
	if webCategory(args) == "alerts" {
		return webAlertsMain(args)
	}
	if _, requested := helpRequest(args); requested {
		webHelp(os.Stdout)
		return 0
	}
	flags := flag.NewFlagSet("examctl web", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	config := flags.String("config", "/etc/exam-agent/agent.json", "root configuration")
	request := flags.String("request", "", "durable management request UUID")
	limit := flags.Int("limit", 100, "page size")
	after := flags.String("after", "", "exclusive exam-ID cursor")
	name := flags.String("name", "Programming exam", "exam name")
	template := flags.String("template", "", "installed template")
	templateVersion := flags.String("template-version", "", "exact attested hash or explicit legacy default")
	duration := flags.Int64("duration-seconds", 5400, "future attempt seconds")
	webcam := flags.String("webcam", "required", "required or optional")
	terminals := flags.Int("terminals", 4, "terminal count")
	collectionFile := flags.Int64("collection-file-mib", 128, "per-file logical MiB")
	collectionTotal := flags.Int64("collection-total-mib", 512, "total logical MiB")
	earliest := flags.String("earliest", "", "earliest Begin RFC3339")
	latest := flags.String("latest", "", "latest Begin RFC3339")
	revision := flags.String("revision", "", "current definition revision")
	reason := flags.String("reason", "", "audited reason")
	action := flags.String("action", "", "retirement preview action")
	review := flags.String("review", "", "reviewed retirement dependency digest")
	lifecycle := flags.String("lifecycle", "active", "definition list visibility")
	out := flags.String("out", "", "new private native evidence file")
	evidence := flags.String("evidence", "", "existing private native evidence file")
	if err := flags.Parse(ordered(args)); err != nil {
		fmt.Fprintln(os.Stderr, "Run examctl web help")
		return 2
	}
	words := flags.Args()
	usage := func(message string) int { fmt.Fprintln(os.Stderr, message+"; run examctl web help"); return 2 }
	if len(words) < 2 || words[0] != "exams" {
		return usage("choose web exams list or web exams show EXAM")
	}
	id := regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)
	uuid := regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$`)
	if *request != "" && !uuid.MatchString(*request) {
		return usage("--request must be a UUID from the earlier operation")
	}
	var operation string
	var body any
	visited := map[string]bool{}
	flags.Visit(func(f *flag.Flag) { visited[f.Name] = true })
	if (visited["out"] || visited["evidence"]) && words[1] != "native-review" && words[1] != "reconcile-native" {
		return usage("--out/--evidence apply only to native-review/reconcile-native")
	}
	mutatingFlag := false
	for _, key := range []string{"name", "template", "template-version", "duration-seconds", "webcam", "terminals", "earliest", "latest", "revision", "reason", "collection-file-mib", "collection-total-mib"} {
		mutatingFlag = mutatingFlag || visited[key]
	}
	switch words[1] {
	case "native-review", "reconcile-native":
		if len(words) != 3 || !id.MatchString(words[2]) {
			return usage("native reconciliation requires exactly one exam ID")
		}
		allowed := map[string]bool{"config": true}
		if words[1] == "native-review" {
			allowed["out"] = true
		} else {
			for _, key := range []string{"request", "action", "revision", "review", "reason", "evidence"} {
				allowed[key] = true
			}
		}
		for key := range visited {
			if !allowed[key] {
				return usage("unexpected flag for native reconciliation: --" + key)
			}
		}
		if words[1] == "native-review" {
			if *out == "" {
				return usage("native-review requires --out NEW-PRIVATE-FILE")
			}
			return nativeRetirementReview(*config, words[2], *out)
		}
		if *evidence == "" || (*action != "delete" && *action != "archive") || !catalogHash.MatchString(*revision) || !catalogHash.MatchString(*review) || len(strings.TrimSpace(*reason)) < 8 || len(*reason) > 1000 {
			return usage("reconcile-native requires --evidence FILE, --action delete|archive, exact --revision/--review and --reason 8..1000 bytes")
		}
		if os.Getuid() != 0 || os.Geteuid() != 0 {
			fmt.Fprintln(os.Stderr, "Run examctl as root on the class server; see web help")
			return 1
		}
		r, err := nativeRetirementFile(*evidence)
		if err != nil || r.Exam != words[2] {
			fmt.Fprintln(os.Stderr, "No reconciliation: evidence unavailable or wrong exam; regenerate native-review:", err)
			return 1
		}
		operation, body = "exams.native-reconcile", map[string]any{"id": words[2], "action": *action, "revision": *revision, "review": *review, "reason": strings.TrimSpace(*reason), "evidence": r}
	case "list":
		if mutatingFlag || visited["action"] || visited["review"] {
			return usage("setting/revision/reason flags apply only to create/update")
		}
		if len(words) != 2 || *limit < 1 || *limit > 200 || (*after != "" && !id.MatchString(*after)) {
			return usage("list takes no target; use --limit 1..200 and an optional --after exam ID")
		}
		operation = "exams.list"
		b := map[string]any{"limit": *limit}
		if visited["lifecycle"] {
			if *lifecycle != "active" && *lifecycle != "archived" && *lifecycle != "all" {
				return usage("--lifecycle must be active, archived or all")
			}
			b["lifecycle"] = *lifecycle
		}
		if *after != "" {
			b["after"] = *after
		}
		body = b
	case "show":
		if visited["action"] || visited["review"] || visited["lifecycle"] {
			return usage("show does not take retirement or lifecycle filters")
		}
		if len(words) != 3 || !id.MatchString(words[2]) {
			return usage("show requires exactly one exam ID from web exams list")
		}
		invalid := false
		flags.Visit(func(f *flag.Flag) {
			if f.Name == "limit" || f.Name == "after" {
				invalid = true
			}
		})
		if mutatingFlag {
			return usage("setting/revision/reason flags apply only to create/update")
		}
		if invalid {
			return usage("--limit/--after apply only to list")
		}
		operation, body = "exams.show", map[string]any{"id": words[2]}
	case "retire-preview", "delete", "archive", "unarchive":
		if len(words) != 3 || !id.MatchString(words[2]) || visited["limit"] || visited["after"] || visited["lifecycle"] {
			return usage("retirement takes one exam ID, without list filters")
		}
		for _, key := range []string{"name", "template", "template-version", "duration-seconds", "webcam", "terminals", "earliest", "latest", "collection-file-mib", "collection-total-mib"} {
			if visited[key] {
				return usage("retirement never changes exam settings")
			}
		}
		if words[1] == "retire-preview" {
			if (*action != "delete" && *action != "archive" && *action != "unarchive") || visited["revision"] || visited["review"] || visited["reason"] {
				return usage("retire-preview requires --action delete|archive|unarchive, without confirmation fields")
			}
			operation, body = "exams.retire-preview", map[string]any{"id": words[2], "action": *action}
		} else {
			if visited["action"] || !catalogHash.MatchString(*revision) || !catalogHash.MatchString(*review) || len(strings.TrimSpace(*reason)) < 8 || len(strings.TrimSpace(*reason)) > 1000 {
				return usage("confirmation requires exact --revision and --review from retire-preview, plus --reason 8..1000 bytes")
			}
			operation, body = "exams."+words[1], map[string]any{"id": words[2], "revision": *revision, "review": *review, "reason": strings.TrimSpace(*reason)}
		}
	case "create", "update":
		if visited["action"] || visited["review"] || visited["lifecycle"] {
			return usage("create/update do not take retirement/lifecycle flags")
		}
		if len(words) != 3 || !id.MatchString(words[2]) || visited["limit"] || visited["after"] {
			return usage("create/update require exactly one exam ID and setting flags, not list filters")
		}
		create := words[1] == "create"
		if visited["template-version"] && *templateVersion != "legacy" && !catalogHash.MatchString(*templateVersion) {
			return usage("--template-version requires an exact lowercase64-hex catalog hash, or explicit legacy; use templates sync/web templates show, never latest")
		}
		if create && (*template == "" || *earliest == "" || *latest == "" || visited["revision"]) {
			return usage("create requires --template, --earliest and --latest, without --revision")
		}
		if !create && !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(*revision) {
			return usage("update requires --revision HASH from web exams show")
		}
		if *duration < 60 || *duration > 21600 || *terminals < 1 || *terminals > 4 || (*webcam != "required" && *webcam != "optional") || (visited["reason"] && (len(strings.TrimSpace(*reason)) < 8 || len(*reason) > 1000)) {
			return usage("invalid duration/terminal/webcam/reason; see documented ranges")
		}
		if *collectionFile < 1 || *collectionFile > 4096 || *collectionTotal < 1 || *collectionTotal > 16384 || ((create || (visited["collection-file-mib"] && visited["collection-total-mib"])) && *collectionTotal < *collectionFile) {
			return usage("collection limits require file 1..4096 MiB, total 1..16384 MiB and total at least per-file; units are logical MiB")
		}
		settings := map[string]any{}
		values := map[string]any{"name": *name, "template": *template, "duration-seconds": *duration, "webcam": *webcam == "required", "terminals": *terminals, "collection-file-mib": *collectionFile, "collection-total-mib": *collectionTotal}
		for key, value := range values {
			if create || visited[key] {
				field := key
				if key == "duration-seconds" {
					field = "duration"
				}
				if key == "collection-file-mib" || key == "collection-total-mib" {
					field = strings.ReplaceAll(key, "-", "_")
				}
				settings[field] = value
			}
		}
		if visited["template-version"] {
			value := *templateVersion
			if value == "legacy" {
				value = ""
			}
			settings["template_version"] = value
		}
		for key, value := range map[string]string{"earliest": *earliest, "latest": *latest} {
			if create || visited[key] {
				parsed, err := time.Parse(time.RFC3339, value)
				if err != nil {
					return usage(key + " requires RFC3339 with an explicit timezone, for example 2026-10-22T09:00:00-05:00")
				}
				settings[key] = parsed.UnixMilli()
			}
		}
		if len(settings) == 0 {
			return usage("choose at least one setting to update")
		}
		b := map[string]any{}
		if visited["template-version"] {
			b["source_selection"] = "template-version/v1"
		}
		if create {
			settings["id"] = words[2]
			b["exam"] = settings
		} else {
			b["id"], b["changes"], b["revision"] = words[2], settings, *revision
		}
		if visited["reason"] {
			b["reason"] = *reason
		}
		operation, body = "exams."+words[1], b
	default:
		return usage("unsupported exam workflow")
	}
	return executeWeb(*config, *request, operation, body, "")
}

// CSV output is requested only after an authenticated gateway result. An empty
// output path keeps JSON; '-' streams CSV; a filename is exclusive/private.
func executeWeb(config, request, operation string, body any, csvOutput string) int {
	if os.Getuid() != 0 || os.Geteuid() != 0 {
		fmt.Fprintln(os.Stderr, "Run examctl as root on the class server with its existing agent identity; see examctl web help")
		return 1
	}
	c, err := scriptLoadConfig(config)
	if err != nil {
		fmt.Fprintln(os.Stderr, "Load root agent configuration:", err)
		return 1
	}
	if err := checkEnrollmentDatesSupport(c, operation, body); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	if request == "" {
		request = core.ManagementID()
	}
	fmt.Fprintln(os.Stderr, "Management request ID:", request)
	result, err := core.ManagementCall(c, operation, body, request)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		fmt.Fprintln(os.Stderr, "For the same intent, repeat the same command/arguments with --request", request)
		if operation == "exams.native-reconcile" {
			fmt.Fprintln(os.Stderr, "A confirmed signed refusal is cached: after repair obtain a NEW retire-preview and use a NEW --request. For a lost/unverified reply retry SAME evidence/arguments/request first.")
		}
		return 1
	}
	// Verify nested resource scope before ANY private output/file creation. A
	// signed outer envelope authenticates the sender, not an accidental wrong
	// target, cursor or intent inside its result.
	if err := validateExamResult(operation, body, result.Result); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	var partialClock error
	if err := validateGrantResult(operation, body, result.Result, c.AgentID); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	if err := validateCatalogRead(operation, body, result.Result, c.AgentID); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	for _, validate := range []func(string, any, json.RawMessage) error{validateMonitoringResult, validateClockResult, validateInterruptionResult} {
		if err := validate(operation, body, result.Result); err != nil {
			if _, partial := err.(*clockPartialError); partial {
				partialClock = err // All targets passed scope/status checks first.
				continue
			}
			fmt.Fprintln(os.Stderr, err)
			return 1
		}
	}
	if csvOutput != "" {
		if operation == "monitoring.image" {
			return writeMonitoringImage(body, result.Result, csvOutput)
		}
		var value struct {
			Format string `json:"format"`
			Text   string `json:"text"`
		}
		format, label := "csv", "CSV"
		if operation == "monitoring.replay" {
			format, label = "ndjson", "replay batch"
		}
		if json.Unmarshal(result.Result, &value) != nil || value.Format != format || (format == "csv" && value.Text == "") {
			fmt.Fprintln(os.Stderr, "Confirmed reply lacks a CSV result; do not treat export as complete")
			return 1
		}
		var out io.Writer = os.Stdout
		var file *os.File
		if csvOutput != "-" {
			file, err = os.OpenFile(csvOutput, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
			if err != nil {
				fmt.Fprintln(os.Stderr, "Create a new private "+label+" output (never overwrite):", err)
				return 1
			}
			defer file.Close()
			out = file
		}
		_, err = io.WriteString(out, value.Text)
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
			fmt.Fprintln(os.Stderr, label+" write incomplete; inspect any partial output before retrying:", err)
			return 1
		}
		if format == "ndjson" {
			var progress struct {
				NextOffset, AvailableBytes int64
				More                       bool
			}
			_ = json.Unmarshal(result.Result, &progress)
			fmt.Fprintf(os.Stderr, "One replay batch only: nextOffset=%d availableBytes=%d more=%t; use replay --offset %d for the next read (JSON shows progress).\n", progress.NextOffset, progress.AvailableBytes, progress.More, progress.NextOffset)
		}
		return 0
	}
	if err := json.NewEncoder(os.Stdout).Encode(result); err != nil {
		fmt.Fprintln(os.Stderr, "Write confirmed management result:", err)
		return 1
	}
	if partialClock != nil {
		fmt.Fprintln(os.Stderr, partialClock)
		return 1
	}
	return 0
}
