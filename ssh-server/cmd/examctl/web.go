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
       examctl web help

Manage gateway-owned exam definitions using the existing root agent identity over
verified outbound HTTPS. No browser login, separate token or inbound agent API.
The gateway must explicitly authorize the named exams.list/show/create/update operations in the agent's
managementOperations allowlist; the default is no management authorization.

--config FILE  root agent configuration (default /etc/exam-agent/agent.json)
--limit N      list page size, default 100, range 1..200
--after EXAM   exclusive exam-ID cursor from a previous page's next field
--request UUID durable intent ID; new by default. Retry a lost reply with the same
               ID/arguments; use a NEW ID for a fresh read, not a cached snapshot.
--help         help without root or configuration

Settings (no ad hoc database/JSON editing required):
--name TEXT              name; creation default 'Programming exam'
--template NAME          installed native materials template; required on create
--duration-seconds N     60..21600; creation default 5400 (90 minutes)
--webcam required|optional  creation default required
--terminals N            1..4; creation default 4
--earliest RFC3339       earliest Begin, explicit date/time/zone; required on create
--latest RFC3339         latest Begin, not latest finish; required on create
--revision HASH          current 64-hex revision from show; required on update
--reason TEXT            optional audited reason, 8..1000 characters

Create never overwrites an existing ID. Update changes ONLY named settings and
refuses a stale revision; reload/show, review differences, then use a new intent.
Existing attempt settings, clocks, account restrictions and submissions remain
unchanged. Template deployment is separate; definition creation does not install
materials. Sandbox immutable policy defaults remain enforced in both interfaces.

JSON output names request, operation, confirmed and result. Confirmed means the
authenticated gateway operation completed, not that any native action was performed.
List includes per-definition revision hashes and a next cursor; show takes an
exam ID, not an attempt UUID. Student credentials are never used or retained.
Offline web requests fail honestly; native list/info remain available locally.
Definition retirement, grants and full management remain pending.

Examples:
  sudo examctl web exams list --limit 50
  sudo examctl web exams list --after midterm
  sudo examctl web exams show midterm
  sudo examctl web exams create midterm --name 'Midterm' --template v1 --earliest '2026-10-22T09:00:00-05:00' --latest '2026-10-22T09:30:00-05:00'
  sudo examctl web exams update midterm --revision HASH-FROM-SHOW --duration-seconds 7200 --webcam optional
  sudo examctl web exams show midterm --request UUID-FROM-PREVIOUS-REQUEST

Exit status: 0 authenticated result, 1 refusal/operational failure, 2 syntax error.
Unknown/unverified replies never imply success; retain the request ID for retry.`)
}

func webMain(args []string) int {
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
	duration := flags.Int64("duration-seconds", 5400, "future attempt seconds")
	webcam := flags.String("webcam", "required", "required or optional")
	terminals := flags.Int("terminals", 4, "terminal count")
	earliest := flags.String("earliest", "", "earliest Begin RFC3339")
	latest := flags.String("latest", "", "latest Begin RFC3339")
	revision := flags.String("revision", "", "current definition revision")
	reason := flags.String("reason", "", "audited reason")
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
	mutatingFlag := false
	for _, key := range []string{"name", "template", "duration-seconds", "webcam", "terminals", "earliest", "latest", "revision", "reason"} {
		mutatingFlag = mutatingFlag || visited[key]
	}
	switch words[1] {
	case "list":
		if mutatingFlag {
			return usage("setting/revision/reason flags apply only to create/update")
		}
		if len(words) != 2 || *limit < 1 || *limit > 200 || (*after != "" && !id.MatchString(*after)) {
			return usage("list takes no target; use --limit 1..200 and an optional --after exam ID")
		}
		operation = "exams.list"
		b := map[string]any{"limit": *limit}
		if *after != "" {
			b["after"] = *after
		}
		body = b
	case "show":
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
	case "create", "update":
		if len(words) != 3 || !id.MatchString(words[2]) || visited["limit"] || visited["after"] {
			return usage("create/update require exactly one exam ID and setting flags, not list filters")
		}
		create := words[1] == "create"
		if create && (*template == "" || *earliest == "" || *latest == "" || visited["revision"]) {
			return usage("create requires --template, --earliest and --latest, without --revision")
		}
		if !create && !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(*revision) {
			return usage("update requires --revision HASH from web exams show")
		}
		if *duration < 60 || *duration > 21600 || *terminals < 1 || *terminals > 4 || (*webcam != "required" && *webcam != "optional") || (visited["reason"] && (len(strings.TrimSpace(*reason)) < 8 || len(*reason) > 1000)) {
			return usage("invalid duration/terminal/webcam/reason; see documented ranges")
		}
		settings := map[string]any{}
		values := map[string]any{"name": *name, "template": *template, "duration-seconds": *duration, "webcam": *webcam == "required", "terminals": *terminals}
		for key, value := range values {
			if create || visited[key] {
				field := key
				if key == "duration-seconds" {
					field = "duration"
				}
				settings[field] = value
			}
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
	if os.Getuid() != 0 || os.Geteuid() != 0 {
		fmt.Fprintln(os.Stderr, "Run examctl as root on the class server with its existing agent identity; see examctl web help")
		return 1
	}
	c, err := core.LoadConfig(*config)
	if err != nil {
		fmt.Fprintln(os.Stderr, "Load root agent configuration:", err)
		return 1
	}
	if *request == "" {
		*request = core.ManagementID()
	}
	fmt.Fprintln(os.Stderr, "Management request ID:", *request)
	result, err := core.ManagementCall(c, operation, body, *request)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		fmt.Fprintln(os.Stderr, "For the same intent, repeat the same command/arguments with --request", *request)
		return 1
	}
	if err := json.NewEncoder(os.Stdout).Encode(result); err != nil {
		fmt.Fprintln(os.Stderr, "Write confirmed management result:", err)
		return 1
	}
	return 0
}
