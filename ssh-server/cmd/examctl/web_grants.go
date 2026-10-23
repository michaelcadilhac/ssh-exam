package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"examworkspace/agent/internal/core"
	"flag"
	"fmt"
	"io"
	"os"
	"regexp"
	"strings"
	"time"
)

func webGrantsHelp(out io.Writer) {
	fmt.Fprintln(out, `Usage: sudo examctl web grants list EXAM [--username USER] [--limit 100] [--after UUID]
       sudo examctl web grants show GRANT_UUID [--before REVISION]
       sudo examctl web grants revise GRANT_UUID --revision N --reason TEXT SETTINGS
       sudo examctl web grants revoke GRANT_UUID --revision N --reason TEXT
       sudo examctl web grants issue-preview EXAM USER... --definition-revision HASH --template-version HASH --earliest RFC3339 --latest RFC3339 --reason TEXT
       sudo examctl web grants issue-show PREVIEW_UUID
       sudo examctl web grants issue-confirm PREVIEW_UUID --revision REVIEW_HASH
       sudo examctl web grants issue-cancel PREVIEW_UUID --revision REVIEW_HASH

Initial ordinary grants are issued atomically at NEW enrollment/CSV import, with
an exact attested template version and finite explicit Begin window. Existing
legacy enrollments/history are not automatically backfilled. Reviewed issue-*
workflows create NEW initial grants for 1..200 existing unused enrollments with
no grants/attempt history. They do not reconstruct historical enrollment settings.
Select the current definition revision/exact source and an explicit finite Begin
window (independent of definition defaults); effective duration/webcam are shown
per student for review. A preview reserves no account/allowance and expires after
15 minutes. Inspect before confirming; changed definitions/enrollments require a
new preview. issue-cancel cannot undo confirmed issuance. Root-only legacy saved-
work authority is not converted or declared absent; native preparation refuses
conflicts without consuming time. Additional attempts and sandbox grants remain
separate workflows not yet implemented.
Inspect templates verify/sync, then web exams show/update before new enrollment.

Grant settings are saved at issuance. Later exam/roster default edits do NOT
revise them. Revise/revoke require the current numeric revision and audited reason
(8..1000 characters), and refuse unresolved preparation/Begin or consumption.
Settings: --duration-minutes 1..360 OR --duration-seconds 60..21600,
--webcam required|optional, --terminals 1..4,
--earliest RFC3339, --latest RFC3339 (finite Begin window, not latest finish),
--template NAME, --template-version HASH (exact attested source, never legacy),
--collection-file-mib N, --collection-total-mib N (total >= file).
Only named fields change; current clocks/holds/protected submissions never do.
First verified preparation binds the Unix UID in retained claim history. A UID
change, even after cancellation, needs reviewed NEW authorization, not rebinding.

list is paginated (1..200); show includes newest 50 immutable revisions and
history_next for --before. Claims distinguish PREPARING, BEGIN_PENDING, CANCELLED
and CONSUMED; unknown Begin never means no start. Inspect native info ATTEMPT
--read-only. Positively cancel an unstarted preparation before revision/revoke;
never delete rows/markers, infer a refund or reopen completed attempts.
Native Begin needs fresh authenticated outbound HTTPS agreement. An outage
refuses before time starts; inspect the SAME intent/attempt before retrying.

Existing root identity, pinned HTTPS and explicit named grants.list/show/revise/
revoke and named grants.issue-* managementOperations authorization; default deny. No browser/student
credentials. --config FILE selects protected root configuration. --request UUID
is a durable intent ID: repeat IDENTICAL arguments after a lost reply; a changed
intent or refreshed read needs a new ID. Help needs no root/configuration.

Examples:
  sudo examctl web grants list midterm --username student01
  sudo examctl web grants show GRANT_UUID
  sudo examctl web grants revise GRANT_UUID --revision 1 --duration-minutes 90 --reason 'Explicit unused allowance revision'
  sudo examctl web grants revoke GRANT_UUID --revision 2 --reason 'Withdraw unused authorization'

Exit status: 0 authenticated result, 1 refusal/unconfirmed operation, 2 syntax.`)
}

func webGrantsMain(args []string) int {
	if _, help := helpRequest(args); help {
		webGrantsHelp(os.Stdout)
		return 0
	}
	position := 0
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
		if position == 1 && strings.HasPrefix(args[i], "issue-") {
			return webGrantIssuanceMain(args)
		}
		position++
	}
	flags := flag.NewFlagSet("examctl web grants", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	config := flags.String("config", "/etc/exam-agent/agent.json", "root configuration")
	request := flags.String("request", "", "durable intent UUID")
	username := flags.String("username", "", "enrolled username filter")
	limit := flags.Int("limit", 100, "page size")
	after := flags.String("after", "", "exclusive grant cursor")
	before := flags.Int64("before", 0, "history before revision")
	revision := flags.Int64("revision", 0, "current numeric grant revision")
	reason := flags.String("reason", "", "audited reason")
	minutes := flags.Int64("duration-minutes", 0, "fixed allowance whole minutes")
	seconds := flags.Int64("duration-seconds", 0, "fixed allowance exact seconds")
	webcam := flags.String("webcam", "", "required or optional")
	terminals := flags.Int("terminals", 0, "terminal count")
	earliest := flags.String("earliest", "", "earliest Begin RFC3339")
	latest := flags.String("latest", "", "latest Begin RFC3339")
	template := flags.String("template", "", "exact source template")
	version := flags.String("template-version", "", "exact source hash")
	file := flags.Int64("collection-file-mib", 0, "logical per-file MiB")
	total := flags.Int64("collection-total-mib", 0, "logical total MiB")
	usage := func(message string) int { fmt.Fprintln(os.Stderr, message+"; run examctl web grants help"); return 2 }
	if err := flags.Parse(ordered(args)); err != nil {
		return usage("invalid grant flags")
	}
	w := flags.Args()
	if len(w) == 2 && w[1] == "help" {
		webGrantsHelp(os.Stdout)
		return 0
	}
	if len(w) != 3 {
		return usage("choose list EXAM or show/revise/revoke GRANT_UUID")
	}
	id := regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$`)
	if *request != "" && !id.MatchString(*request) {
		return usage("invalid request UUID")
	}
	seen := map[string]bool{}
	flags.Visit(func(f *flag.Flag) { seen[f.Name] = true })
	allowed := map[string]bool{"config": true, "request": true}
	b := map[string]any{}
	op := w[1]
	switch op {
	case "list":
		if !regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`).MatchString(w[2]) || *limit < 1 || *limit > 200 || (*after != "" && !id.MatchString(*after)) {
			return usage("invalid exam/page/cursor")
		}
		allowed["username"], allowed["limit"], allowed["after"] = true, true, true
		b["exam"], b["limit"] = w[2], *limit
		if *username != "" {
			if !regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9_-]{0,31}$`).MatchString(*username) {
				return usage("invalid username")
			}
			b["username"] = *username
		}
		if *after != "" {
			b["after"] = *after
		}
	case "show", "revise", "revoke":
		if !id.MatchString(w[2]) {
			return usage("grant target must be its UUID, not an exam/attempt ID")
		}
		b["id"] = w[2]
		if op == "show" {
			allowed["before"] = true
			if seen["before"] {
				if *before < 1 {
					return usage("history cursor must be positive")
				}
				b["before"] = *before
			}
			break
		}
		allowed["revision"], allowed["reason"] = true, true
		if *revision < 1 || len(strings.TrimSpace(*reason)) < 8 || len(*reason) > 1000 {
			return usage("current numeric revision and concrete 8..1000 character reason required")
		}
		b["revision"], b["reason"] = *revision, *reason
		if op == "revoke" {
			break
		}
		changes := map[string]any{}
		for _, name := range []string{"duration-seconds", "duration-minutes", "webcam", "terminals", "earliest", "latest", "template", "template-version", "collection-file-mib", "collection-total-mib"} {
			allowed[name] = true
		}
		if seen["duration-minutes"] {
			if *minutes < 1 || *minutes > 360 {
				return usage("duration must be 1..360 whole minutes")
			}
			changes["duration"] = *minutes * 60
		}
		if seen["duration-seconds"] {
			if seen["duration-minutes"] || *seconds < 60 || *seconds > 21600 {
				return usage("choose either whole minutes or exact 60..21600 seconds, not both")
			}
			changes["duration"] = *seconds
		}
		if seen["webcam"] {
			if *webcam != "required" && *webcam != "optional" {
				return usage("webcam must be required or optional, not inheritance")
			}
			changes["webcam"] = *webcam == "required"
		}
		if seen["terminals"] {
			if *terminals < 1 || *terminals > 4 {
				return usage("terminals must be 1..4")
			}
			changes["terminals"] = *terminals
		}
		for name, value := range map[string]string{"earliest": *earliest, "latest": *latest} {
			if seen[name] {
				at, err := time.Parse(time.RFC3339Nano, value)
				if err != nil {
					return usage("Begin windows require explicit RFC3339 date/time/zone")
				}
				changes[name] = at.UnixMilli()
			}
		}
		if seen["template"] {
			changes["template"] = *template
		}
		if seen["template-version"] {
			if !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(*version) {
				return usage("grant source requires exact lowercase64-hex hash; no legacy/latest fallback")
			}
			changes["template_version"] = *version
		}
		if seen["collection-file-mib"] {
			if *file < 1 || *file > 4096 {
				return usage("per-file limit must be 1..4096 MiB")
			}
			changes["collection_file_mib"] = *file
		}
		if seen["collection-total-mib"] {
			if *total < 1 || *total > 16384 {
				return usage("total limit must be 1..16384 MiB")
			}
			changes["collection_total_mib"] = *total
		}
		if len(changes) == 0 {
			return usage("choose explicit grant settings to revise")
		}
		b["changes"] = changes
	default:
		return usage("unsupported grant workflow")
	}
	for name := range seen {
		if !allowed[name] {
			return usage("flag --" + name + " is not valid for this workflow")
		}
	}
	return executeWeb(*config, *request, "grants."+op, b, "")
}

type grantWorkResult struct {
	Kind string `json:"kind"`
	Name string `json:"name"`
	Hash string `json:"hash"`
}
type grantHistoryResult struct {
	Revision int64           `json:"revision"`
	Settings core.Settings   `json:"settings"`
	Work     grantWorkResult `json:"work"`
	Hash     string          `json:"hash"`
	Actor    string          `json:"actor"`
	Reason   string          `json:"reason"`
	At       int64           `json:"at"`
}
type grantClaimResult struct {
	Attempt   string `json:"attempt"`
	Revision  int64  `json:"revision"`
	Hash      string `json:"hash"`
	UID       int    `json:"uid"`
	State     string `json:"state"`
	CreatedAt int64  `json:"created_at"`
	EndedAt   *int64 `json:"ended_at"`
}
type grantResult struct {
	ID          string               `json:"id"`
	Agent       string               `json:"agent"`
	Exam        string               `json:"exam"`
	Username    string               `json:"username"`
	Revision    int64                `json:"revision"`
	Status      string               `json:"status"`
	IssuedAt    int64                `json:"issued_at"`
	Actor       string               `json:"actor"`
	Reason      string               `json:"reason"`
	Issuance    string               `json:"issuance"`
	Hash        string               `json:"hash"`
	Settings    core.Settings        `json:"settings"`
	Work        grantWorkResult      `json:"work"`
	Claims      []grantClaimResult   `json:"claims"`
	History     []grantHistoryResult `json:"history,omitempty"`
	HistoryNext *int64               `json:"history_next,omitempty"`
}

func validateGrantResult(op string, body any, raw json.RawMessage, agent string) error {
	if !strings.HasPrefix(op, "grants.") {
		return nil
	}
	if strings.HasPrefix(op, "grants.issue-") {
		return validateGrantIssuanceResult(op, body, raw, agent)
	}
	fail := errors.New("Unconfirmed grant reply scope/schema; no private output. Inspect the requested grant and retry with the original --request UUID")
	b, err := json.Marshal(body)
	if err != nil {
		return fail
	}
	var scope struct {
		ID       string `json:"id"`
		Exam     string `json:"exam"`
		Username string `json:"username"`
		Limit    int    `json:"limit"`
	}
	if json.Unmarshal(b, &scope) != nil {
		return fail
	}
	var rows []grantResult
	decode := func(target any) error {
		d := json.NewDecoder(bytes.NewReader(raw))
		d.DisallowUnknownFields()
		if d.Decode(target) != nil || d.Decode(new(any)) != io.EOF {
			return fail
		}
		return nil
	}
	if op == "grants.list" {
		var page struct {
			Grants []grantResult `json:"grants"`
			Next   *string       `json:"next"`
		}
		if decode(&page) != nil || len(page.Grants) > scope.Limit {
			return fail
		}
		rows = page.Grants
		if page.Next != nil && (len(rows) == 0 || *page.Next != rows[len(rows)-1].ID) {
			return fail
		}
	} else {
		var row grantResult
		if decode(&row) != nil || row.ID != scope.ID {
			return fail
		}
		rows = []grantResult{row}
	}
	for _, g := range rows {
		if g.Issuance != "ENROLLMENT" && g.Issuance != "REVIEWED_NEW" {
			return fail
		}
		if g.Agent != agent || g.ID == "" || g.Revision < 1 || g.Exam == "" || g.Username == "" || (scope.Exam != "" && g.Exam != scope.Exam) || (scope.Username != "" && g.Username != scope.Username) || g.Settings.ID != g.Exam || g.Settings.TemplateVersion == "" || g.Work.Kind != "template" || g.Work.Name != g.Settings.Template || g.Work.Hash != g.Settings.TemplateVersion || len(g.Hash) != 64 || g.Settings.Duration < 60 || g.Settings.Latest <= g.Settings.Earliest || len(g.Claims) > 100 || len(g.History) > 50 {
			return fail
		}
		switch g.Status {
		case "AVAILABLE", "REVOKED", "CONSUMED":
		default:
			return fail
		}
	}
	return nil
}
