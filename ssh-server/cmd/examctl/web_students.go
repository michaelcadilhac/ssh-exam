package main

import (
	"flag"
	"fmt"
	"io"
	"os"
	"regexp"
	"strconv"
)

func webStudentsHelp(out io.Writer) {
	fmt.Fprintln(out, `Usage: sudo examctl web students list EXAM [--limit 100] [--after USER]
       sudo examctl web students add EXAM USER [--duration-minutes N|inherit] [--webcam required|optional|inherit]
       sudo examctl web students settings EXAM USER... SETTINGS
       sudo examctl web students remove EXAM USER --confirm USER
       sudo examctl web students import-preview EXAM --file PATH|- [--mode csv|lines]
       sudo examctl web students import-confirm EXAM PREVIEW_UUID
       sudo examctl web students export EXAM [--output NEW_FILE]
       sudo examctl web students example EXAM [--output NEW_FILE]

Uses root agent authentication, the fixed HTTPS gateway and explicit named
students.* managementOperations authorization; no browser login or student
credentials. Help works without root/configuration. All operations preserve
historical attempts, active snapshots, original/current deadlines and holds.
Removal deletes enrollment only, not an attempt/submission or access restriction.
It does not finish/cancel work or revoke a native recovery grant. Inspect active
attempts/reauthentication needs before removing enrollment.

Add defaults to inheritance; settings changes only named fields (1..1000 users).
Duration is 1..360 whole MINUTES, or inherit; webcam is required/optional/inherit.
These are future defaults, never current clock edits. Sandbox duration is five
minutes or inheritance. UID stays unresolved (0) until the student's trusted SSH
verifies identity; no UID override is accepted.

NEW ordinary enrollment/CSV rows atomically issue an initial saved-settings grant.
Configure an exact attested template version and finite Begin window FIRST; a
missing source/window refuses without partial enrollment. Existing legacy
history/enrollment is not automatically backfilled. Later roster/default edits
never revise an issued initial grant: use examctl web grants help for inspection,
explicit unused revision/revoke and original claim/Begin diagnostics. Reenrollment
cannot invent another allowance; first verified claim retains its Unix UID even
after cancellation. Extra/sandbox/migration issuance is not provided here.

An explicit duration setting authorizes duration-only synchronization of unused
native saved-work recovery at the student's next authenticated preflight. Inherit
saves the exam allowance at edit time, not a later default. Already prepared or
consumed grants refuse revision; source/checksum/history never change. Inspect
list for recovery_allowance_edit, and examctl recovery-grants --exam EXAM for
native allowance_revision/pending_allowance_revision. A pending revision is not
permission or a clock: retry the latest setting through authenticated preflight.
Exam-default edits and webcam-only/omitted CSV duration edits do not authorize it.
For historical mismatches without a recorded explicit edit, explicitly save the
intended allowance again. A lost reply retries the SAME request ID, not a new edit.

Import is a deliberate two-step preview/confirm workflow (1..10000 unique users).
CSV headers: username,require_webcam,duration_minutes. Omitted columns preserve
existing overrides; blank/inherit explicitly inherits. Webcam CSV values include
true/false/yes/no/1/0. Preview expires after 10 minutes, detects roster changes,
and shows active attempts whose snapshots stay unchanged. Confirmed previews are
idempotent even after expiration; an expired unused preview needs a new preview.
--mode lines reads one username per line. Input is at most 10 MiB, never executed.
--file - reads stdin. export/example emit CSV to stdout by default, not JSON;
--output creates a new mode-0600 file and refuses existing files/symlinks. Failed
writes can leave a partial new file; inspect it before retrying.

Common flags: --config FILE (root agent JSON), --request UUID (durable intent ID).
Lost reply: repeat identical arguments with the printed --request UUID and fresh
nonce. Different intent: use a NEW ID. A new ID is also needed for refreshed reads.
List defaults to 100 rows, max 200; next is an exclusive username cursor. Other
inspection/mutation results are confirmed JSON, not proof of native execution.

Examples:
  sudo examctl web students add midterm student01 --duration-minutes 120 --webcam optional
  sudo examctl web students settings midterm student01 student02 --webcam inherit
  sudo examctl web students import-preview midterm --file roster.csv
  sudo examctl web students import-confirm midterm PREVIEW_UUID
  sudo examctl web students export midterm --output ./roster.csv
  sudo examctl web students remove midterm student01 --confirm student01

Exit status: 0 confirmed result, 1 refusal/operational failure, 2 invalid syntax.`)
}

func webStudentsMain(args []string) int {
	if _, help := helpRequest(args); help {
		webStudentsHelp(os.Stdout)
		return 0
	}
	flags := flag.NewFlagSet("examctl web students", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	config := flags.String("config", "/etc/exam-agent/agent.json", "root configuration")
	request := flags.String("request", "", "durable intent UUID")
	limit := flags.Int("limit", 100, "page size")
	after := flags.String("after", "", "username cursor")
	duration := flags.String("duration-minutes", "", "whole minutes or inherit")
	webcam := flags.String("webcam", "", "required/optional/inherit")
	confirm := flags.String("confirm", "", "repeat removed username")
	file := flags.String("file", "", "CSV/lines input path or -")
	mode := flags.String("mode", "csv", "csv or lines")
	output := flags.String("output", "", "new private CSV output")
	if err := flags.Parse(ordered(args)); err != nil {
		fmt.Fprintln(os.Stderr, "Run examctl web students help")
		return 2
	}
	w := flags.Args()
	usage := func(message string) int { fmt.Fprintln(os.Stderr, message+"; run examctl web students help"); return 2 }
	if len(w) == 2 && w[1] == "help" {
		webStudentsHelp(os.Stdout)
		return 0
	}
	if len(w) < 3 {
		return usage("choose a students workflow and exam ID")
	}
	id := regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)
	user := regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9_-]{0,31}$`)
	uuid := regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$`)
	if !id.MatchString(w[2]) || (*request != "" && !uuid.MatchString(*request)) {
		return usage("invalid exam ID/request UUID")
	}
	seen := map[string]bool{}
	flags.Visit(func(f *flag.Flag) { seen[f.Name] = true })
	b := map[string]any{"exam": w[2]}
	setting := false
	if seen["duration-minutes"] {
		setting = true
		if *duration == "inherit" {
			b["duration"] = nil
		} else {
			n, err := strconv.ParseInt(*duration, 10, 64)
			if err != nil || n < 1 || n > 360 {
				return usage("duration must be 1..360 whole minutes or inherit")
			}
			b["duration"] = n * 60
		}
	}
	if seen["webcam"] {
		setting = true
		switch *webcam {
		case "inherit":
			b["webcam"] = nil
		case "required":
			b["webcam"] = true
		case "optional":
			b["webcam"] = false
		default:
			return usage("webcam must be required/optional/inherit")
		}
	}
	allowedFlags := map[string]bool{"config": true, "request": true}
	csv := ""
	switch w[1] {
	case "list":
		if len(w) != 3 || *limit < 1 || *limit > 200 || (*after != "" && !user.MatchString(*after)) {
			return usage("list takes one exam; use --limit 1..200/--after USER")
		}
		b["limit"] = *limit
		if *after != "" {
			b["after"] = *after
		}
		allowedFlags["limit"], allowedFlags["after"] = true, true
	case "add", "remove":
		if len(w) != 4 || !user.MatchString(w[3]) {
			return usage("choose one exam and student username")
		}
		b["username"] = w[3]
		if w[1] == "remove" {
			if *confirm != w[3] {
				return usage("removal requires --confirm with the exact target username")
			}
			b["confirm"] = true
			allowedFlags["confirm"] = true
		} else {
			allowedFlags["duration-minutes"], allowedFlags["webcam"] = true, true
		}
	case "settings":
		if len(w) < 4 || len(w)-3 > 1000 || !setting {
			return usage("settings requires 1..1000 usernames and a setting")
		}
		for _, name := range w[3:] {
			if !user.MatchString(name) {
				return usage("invalid selected username")
			}
		}
		b["usernames"] = w[3:]
		allowedFlags["duration-minutes"], allowedFlags["webcam"] = true, true
	case "import-preview":
		if len(w) != 3 || *file == "" || (*mode != "csv" && *mode != "lines") {
			return usage("preview requires one exam, --file PATH|- and --mode csv|lines")
		}
		allowedFlags["file"], allowedFlags["mode"] = true, true
	case "import-confirm":
		if len(w) != 4 || !uuid.MatchString(w[3]) {
			return usage("confirm requires EXAM and the preview UUID from import-preview")
		}
		b["id"] = w[3]
	case "export", "example":
		if len(w) != 3 {
			return usage("export/example requires exactly one exam ID")
		}
		csv = *output
		if csv == "" {
			csv = "-"
		}
		allowedFlags["output"] = true
	default:
		return usage("unsupported students workflow")
	}
	for key := range seen {
		if !allowedFlags[key] {
			return usage("--" + key + " does not apply to this workflow")
		}
	}
	if w[1] == "import-preview" {
		if os.Getuid() != 0 || os.Geteuid() != 0 {
			fmt.Fprintln(os.Stderr, "Run examctl as root on the class server; see examctl web students help")
			return 1
		}
		var in io.Reader = os.Stdin
		if *file != "-" {
			f, err := os.Open(*file)
			if err != nil {
				fmt.Fprintln(os.Stderr, "Read roster input:", err)
				return 1
			}
			defer f.Close()
			info, err := f.Stat()
			if err != nil || !info.Mode().IsRegular() {
				fmt.Fprintln(os.Stderr, "Roster input must be a regular file or explicit stdin")
				return 1
			}
			in = f
		}
		text, err := io.ReadAll(io.LimitReader(in, 10*1024*1024+1))
		if err != nil || len(text) > 10*1024*1024 {
			fmt.Fprintln(os.Stderr, "Roster input unreadable or exceeds 10 MiB")
			return 1
		}
		b["text"], b["mode"] = string(text), *mode
	}
	return executeWeb(*config, *request, "students."+w[1], b, csv)
}
