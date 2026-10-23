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

func webGrantIssuanceMain(args []string) int {
	f := flag.NewFlagSet("examctl web grants issue", flag.ContinueOnError)
	f.SetOutput(os.Stderr)
	config := f.String("config", "/etc/exam-agent/agent.json", "protected root configuration")
	request := f.String("request", "", "durable identical-intent UUID")
	definition := f.String("definition-revision", "", "selected current definition hash")
	source := f.String("template-version", "", "selected current exact source hash")
	earliest := f.String("earliest", "", "finite earliest Begin RFC3339")
	latest := f.String("latest", "", "finite latest Begin RFC3339")
	reason := f.String("reason", "", "audited NEW issuance reason")
	revision := f.String("revision", "", "reviewed preview hash")
	minutes := f.Int64("duration-minutes", 0, "explicit additional allowance minutes")
	seconds := f.Int64("duration-seconds", 0, "explicit additional allowance seconds")
	webcam := f.String("webcam", "", "explicit required/optional override; omitted preserves effective value")
	workFlags := registerGrantWork(f)
	usage := func(message string) int { fmt.Fprintln(os.Stderr, message+"; run examctl web grants help"); return 2 }
	if f.Parse(ordered(args)) != nil {
		return usage("invalid issuance flags")
	}
	w := f.Args()
	if len(w) < 3 {
		return usage("choose issue-preview EXAM USER... or issue-show/confirm/cancel PREVIEW_UUID")
	}
	uuid := regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$`)
	digest := regexp.MustCompile(`^[a-f0-9]{64}$`)
	if *request != "" && !uuid.MatchString(*request) {
		return usage("invalid request UUID")
	}
	allowed := map[string]bool{"config": true, "request": true}
	body := map[string]any{}
	switch w[1] {
	case "issue-preview", "additional-preview":
		if len(w) < 4 || len(w) > 203 || !regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`).MatchString(w[2]) || w[2] == "sandbox" {
			return usage("choose an ordinary exam and 1..200 explicit legacy unused students")
		}
		if !digest.MatchString(*definition) || !digest.MatchString(*source) || len(strings.TrimSpace(*reason)) < 8 || len(*reason) > 1000 {
			return usage("select current --definition-revision and --template-version hashes with an 8..1000 character reason")
		}
		from, e1 := time.Parse(time.RFC3339Nano, *earliest)
		until, e2 := time.Parse(time.RFC3339Nano, *latest)
		if e1 != nil || e2 != nil || !until.After(from) {
			return usage("explicit ordered finite --earliest/--latest RFC3339 dates with zones required")
		}
		seen := map[string]bool{}
		for _, user := range w[3:] {
			if seen[user] || !regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9_-]{0,31}$`).MatchString(user) {
				return usage("each valid student must be named once")
			}
			seen[user] = true
		}
		for _, name := range []string{"definition-revision", "template-version", "earliest", "latest", "reason"} {
			allowed[name] = true
		}
		body["exam"], body["usernames"], body["definition_revision"], body["template_version"] = w[2], w[3:], *definition, *source
		body["earliest"], body["latest"], body["reason"] = from.UnixMilli(), until.UnixMilli(), *reason
		if w[1] == "additional-preview" {
			present := map[string]bool{}
			f.Visit(func(v *flag.Flag) { present[v.Name] = true })
			if present["duration-minutes"] == present["duration-seconds"] {
				return usage("additional grants require exactly one explicit --duration-minutes or --duration-seconds")
			}
			duration := *seconds
			if present["duration-minutes"] {
				if *minutes < 1 || *minutes > 360 {
					return usage("duration must be1..360 whole minutes")
				}
				duration = *minutes * 60
			}
			if duration < 60 || duration > 21600 {
				return usage("additional allowance must be60..21600 seconds")
			}
			allowed["duration-minutes"], allowed["duration-seconds"], allowed["webcam"] = true, true, true
			allowed["work"], allowed["work-template"], allowed["work-template-version"] = true, true, true
			work, err := workFlags.selection(present)
			if err != nil {
				return usage(err.Error())
			}
			if work != nil {
				body["work"] = work
			}
			body["duration"] = duration
			if present["webcam"] {
				if *webcam != "required" && *webcam != "optional" {
					return usage("webcam override must be required/optional; omit to preserve each student's effective requirement")
				}
				body["webcam"] = *webcam == "required"
			}
		}
	case "issue-show", "issue-confirm", "issue-cancel":
		if len(w) != 3 || !uuid.MatchString(w[2]) {
			return usage("target the original preview UUID")
		}
		body["id"] = w[2]
		if w[1] != "issue-show" {
			if !digest.MatchString(*revision) {
				return usage("inspect issue-show first and supply its exact --revision REVIEW_HASH")
			}
			allowed["revision"] = true
			body["revision"] = *revision
		}
	default:
		return usage("unsupported issuance workflow")
	}
	invalid := ""
	f.Visit(func(value *flag.Flag) {
		if !allowed[value.Name] {
			invalid = value.Name
		}
	})
	if invalid != "" {
		return usage("--" + invalid + " is not valid for this issuance workflow")
	}
	return executeWeb(*config, *request, "grants."+w[1], body, "")
}

type grantIssuanceResult struct {
	ID                 string `json:"id"`
	Kind               string `json:"kind"`
	Agent              string `json:"agent"`
	Exam               string `json:"exam"`
	Actor              string `json:"actor"`
	Reason             string `json:"reason"`
	DefinitionRevision string `json:"definition_revision"`
	Revision           string `json:"revision"`
	Created            int64  `json:"created"`
	Expires            int64  `json:"expires"`
	Status             string `json:"status"`
	Rows               []struct {
		Username       string          `json:"username"`
		ExistingGrants *int            `json:"existing_grants,omitempty"`
		Settings       core.Settings   `json:"settings"`
		Work           grantWorkResult `json:"work"`
		Hash           string          `json:"hash"`
	} `json:"rows"`
	Issued []struct {
		Username string `json:"username"`
		Grant    string `json:"grant"`
	} `json:"issued"`
}

func validateGrantIssuanceResult(op string, body any, raw json.RawMessage, agent string) error {
	fail := errors.New("Unconfirmed issuance reply scope/schema; no private output. Inspect the original issue-show preview with a fresh request; retry identical confirmation intent, never recreate authority")
	var result grantIssuanceResult
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&result) != nil || decoder.Decode(new(any)) != io.EOF {
		return fail
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return fail
	}
	var scope struct {
		ID                 string           `json:"id"`
		Exam               string           `json:"exam"`
		Revision           string           `json:"revision"`
		Usernames          []string         `json:"usernames"`
		DefinitionRevision string           `json:"definition_revision"`
		TemplateVersion    string           `json:"template_version"`
		Earliest           int64            `json:"earliest"`
		Latest             int64            `json:"latest"`
		Duration           int64            `json:"duration"`
		Webcam             *bool            `json:"webcam"`
		Work               *grantWorkResult `json:"work"`
	}
	if json.Unmarshal(encoded, &scope) != nil {
		return fail
	}
	uuid := regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$`)
	digest := regexp.MustCompile(`^[a-f0-9]{64}$`)
	if !uuid.MatchString(result.ID) || (result.Kind != "NEW_LEGACY_INITIAL_GRANTS" && result.Kind != "NEW_ADDITIONAL_TEMPLATE_GRANTS") || result.Agent != agent || result.Actor != "agent:"+agent+":root" || result.Exam == "" || result.Exam == "sandbox" || !digest.MatchString(result.Revision) || !digest.MatchString(result.DefinitionRevision) || len(result.Rows) < 1 || len(result.Rows) > 200 || (scope.ID != "" && scope.ID != result.ID) || (scope.Exam != "" && scope.Exam != result.Exam) || (scope.Revision != "" && scope.Revision != result.Revision) {
		return fail
	}
	switch result.Status {
	case "REVIEW", "EXPIRED", "CANCELLED", "CONFIRMED":
	default:
		return fail
	}
	seen := map[string]bool{}
	for _, row := range result.Rows {
		if seen[row.Username] || row.Username == "" || row.Settings.ID != result.Exam || !validGrantWorkResult(row.Work) || !digest.MatchString(row.Settings.TemplateVersion) || !digest.MatchString(row.Hash) || row.Settings.Latest <= row.Settings.Earliest || row.Settings.Duration < 60 {
			return fail
		}
		seen[row.Username] = true
	}
	if op == "grants.issue-preview" || op == "grants.additional-preview" {
		expectedKind := "NEW_LEGACY_INITIAL_GRANTS"
		if op == "grants.additional-preview" {
			expectedKind = "NEW_ADDITIONAL_TEMPLATE_GRANTS"
		}
		if result.Kind != expectedKind || result.DefinitionRevision != scope.DefinitionRevision {
			return fail
		}
		for _, row := range result.Rows {
			expectedWork := grantWorkResult{Kind: "template", Name: row.Settings.Template, Hash: scope.TemplateVersion}
			if scope.Work != nil {
				expectedWork = *scope.Work
			}
			if row.Work != expectedWork || row.Settings.TemplateVersion != scope.TemplateVersion || row.Settings.Earliest != scope.Earliest || row.Settings.Latest != scope.Latest || (op == "grants.additional-preview" && row.Settings.Duration != scope.Duration) || (scope.Webcam != nil && row.Settings.Webcam != *scope.Webcam) {
				return fail
			}
		}
		if len(scope.Usernames) != len(seen) {
			return fail
		}
		for _, name := range scope.Usernames {
			if !seen[name] {
				return fail
			}
		}
	}
	if result.Status == "CONFIRMED" {
		if len(result.Issued) != len(result.Rows) {
			return fail
		}
		ids := map[string]bool{}
		for _, issued := range result.Issued {
			if !seen[issued.Username] || !uuid.MatchString(issued.Grant) || ids[issued.Grant] {
				return fail
			}
			delete(seen, issued.Username)
			ids[issued.Grant] = true
		}
	} else if len(result.Issued) != 0 {
		return fail
	}
	return nil
}
