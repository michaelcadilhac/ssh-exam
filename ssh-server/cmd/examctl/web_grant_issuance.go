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

const grantReplacementPolicy = "single-unused-v1"

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
	limit := f.Int("limit", 20, "recent review page size1..20")
	after := f.String("after", "", "exclusive recent-review cursor")
	minutes := f.Int64("duration-minutes", 0, "explicit additional allowance minutes")
	seconds := f.Int64("duration-seconds", 0, "explicit additional allowance seconds")
	preserve := f.Bool("preserve-duration", false, "save each student's current effective time limit")
	webcam := f.String("webcam", "", "explicit required/optional override; omitted preserves effective value")
	workFlags := registerGrantWork(f)
	savedSources := f.String("saved-sources", "", "CSV username,attempt,checksum selecting one protected source per student; additional-preview only")
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
	present := map[string]bool{}
	f.Visit(func(v *flag.Flag) { present[v.Name] = true })
	body := map[string]any{}
	switch w[1] {
	case "issue-list":
		if len(w) != 3 || !catalogName.MatchString(w[2]) || *limit < 1 || *limit > 20 || *after != "" && !managementUUID.MatchString(*after) {
			return usage("issue-list requires EXAM [--limit 1..20 --after REVIEW_UUID]")
		}
		allowed["limit"], allowed["after"] = true, true
		body["exam"], body["limit"] = w[2], *limit
		if *after != "" {
			body["after"] = *after
		}
	case "issue-preview", "additional-preview":
		if len(w) > 203 || !regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`).MatchString(w[2]) {
			return usage("choose an exam and 1..200 explicit enrolled students")
		}
		users := w[3:]
		if present["saved-sources"] {
			if w[1] != "additional-preview" {
				return usage("--saved-sources is only valid for additional-preview")
			}
			for _, name := range []string{"work", "work-template", "work-template-version", "work-attempt", "work-checksum"} {
				if present[name] {
					return usage("choose --saved-sources FILE OR shared --work flags, never both")
				}
			}
			selected, err := readGrantSavedSources(*savedSources)
			if err != nil {
				return usage(err.Error())
			}
			if len(users) == 0 {
				users = make([]string, len(selected))
				for i, source := range selected {
					users[i] = source.Username
				}
			}
			if len(users) != len(selected) {
				return usage("saved sources CSV must map every selected student exactly once; no omitted or unselected owners")
			}
			mapped := map[string]bool{}
			for _, source := range selected {
				mapped[source.Username] = true
			}
			for _, name := range users {
				if !mapped[name] {
					return usage("saved sources CSV differs from selected students; choose each student's exact protected source")
				}
			}
			body["saved_sources"] = selected
		}
		if len(users) < 1 || len(users) > 200 {
			return usage("choose1..200 explicit enrolled students, or use --saved-sources FILE to select them from its CSV rows")
		}
		if w[2] == "sandbox" && w[1] == "issue-preview" {
			return usage("practice uses additional-preview sandbox --duration-minutes 5, not legacy initial issuance")
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
		for _, user := range users {
			if seen[user] || !regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9_-]{0,31}$`).MatchString(user) {
				return usage("each valid student must be named once")
			}
			seen[user] = true
		}
		for _, name := range []string{"definition-revision", "template-version", "earliest", "latest", "reason"} {
			allowed[name] = true
		}
		body["exam"], body["usernames"], body["definition_revision"], body["template_version"] = w[2], users, *definition, *source
		body["earliest"], body["latest"], body["reason"] = from.UnixMilli(), until.UnixMilli(), *reason
		if w[1] == "additional-preview" {
			if *preserve {
				if present["duration-minutes"] || present["duration-seconds"] {
					return usage("choose --preserve-duration OR an explicit shared duration, never both")
				}
				body["preserve_duration"] = true
			} else {
				if present["duration-minutes"] == present["duration-seconds"] {
					return usage("additional attempts need --preserve-duration OR one explicit --duration-minutes/--duration-seconds")
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
				if w[2] == "sandbox" && duration != 300 {
					return usage("sandbox practice is fixed at five minutes; use --duration-minutes 5")
				}
				body["duration"] = duration
			}
			allowed["duration-minutes"], allowed["duration-seconds"], allowed["webcam"] = true, true, true
			allowed["preserve-duration"] = true
			allowed["work"], allowed["work-template"], allowed["work-template-version"] = true, true, true
			allowed["work-attempt"], allowed["work-checksum"] = true, true
			allowed["saved-sources"] = true
			work, err := workFlags.selection(present)
			if err != nil {
				return usage(err.Error())
			}
			if work != nil {
				body["work"] = work
			}
			if present["webcam"] {
				if *webcam != "required" && *webcam != "optional" {
					return usage("webcam override must be required/optional; omit to preserve each student's effective requirement")
				}
				if w[2] == "sandbox" && *webcam == "required" {
					return usage("sandbox practice is fixed to no webcam; omit webcam or choose optional")
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
		if w[1] == "issue-confirm" {
			body["replacement_policy"] = grantReplacementPolicy
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

type grantReplacementRef struct {
	ID       string `json:"id"`
	Revision int64  `json:"revision"`
	Hash     string `json:"hash"`
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
		Username       string                 `json:"username"`
		ExistingGrants *int                   `json:"existing_grants,omitempty"`
		Replaces       *[]grantReplacementRef `json:"replaces,omitempty"`
		Settings       core.Settings          `json:"settings"`
		Work           grantWorkResult        `json:"work"`
		Hash           string                 `json:"hash"`
	} `json:"rows"`
	Issued []struct {
		Username string                 `json:"username"`
		Grant    string                 `json:"grant"`
		Replaced *[]grantReplacementRef `json:"replaced,omitempty"`
	} `json:"issued"`
}

func validateGrantIssuanceResult(op string, body any, raw json.RawMessage, agent string) error {
	return validateGrantIssuanceResultPolicy(op, body, raw, agent, false)
}

// Only the private receipt reader may inspect reviews produced before the
// single-unused policy. Live additional previews must prove their replacements.
func validateGrantIssuanceResultPolicy(op string, body any, raw json.RawMessage, agent string, legacyReceipt bool) error {
	if op == "grants.issue-list" {
		return validateGrantReviewPage(body, raw, agent)
	}
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
		ID                 string                  `json:"id"`
		Exam               string                  `json:"exam"`
		Revision           string                  `json:"revision"`
		Usernames          []string                `json:"usernames"`
		DefinitionRevision string                  `json:"definition_revision"`
		TemplateVersion    string                  `json:"template_version"`
		Earliest           int64                   `json:"earliest"`
		Latest             int64                   `json:"latest"`
		Duration           int64                   `json:"duration"`
		PreserveDuration   bool                    `json:"preserve_duration"`
		Webcam             *bool                   `json:"webcam"`
		Work               *grantWorkResult        `json:"work"`
		SavedSources       []grantSavedSource      `json:"saved_sources"`
		WorkSources        []scriptWorkSource      `json:"work_sources"`
		StudentSettings    []scriptStudentSettings `json:"student_settings"`
	}
	if json.Unmarshal(encoded, &scope) != nil {
		return fail
	}
	uuid := regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$`)
	digest := regexp.MustCompile(`^[a-f0-9]{64}$`)
	if !uuid.MatchString(result.ID) || (result.Kind != "NEW_LEGACY_INITIAL_GRANTS" && result.Kind != "NEW_ADDITIONAL_TEMPLATE_GRANTS" && result.Kind != "NEW_SANDBOX_PRACTICE_GRANTS") || ((result.Exam == "sandbox") != (result.Kind == "NEW_SANDBOX_PRACTICE_GRANTS")) || result.Agent != agent || result.Actor != "agent:"+agent+":root" || result.Exam == "" || !digest.MatchString(result.Revision) || !digest.MatchString(result.DefinitionRevision) || len(result.Rows) < 1 || len(result.Rows) > 200 || (scope.ID != "" && scope.ID != result.ID) || (scope.Exam != "" && scope.Exam != result.Exam) || (scope.Revision != "" && scope.Revision != result.Revision) {
		return fail
	}
	switch result.Status {
	case "REVIEW", "EXPIRED", "CANCELLED", "CONFIRMED":
	default:
		return fail
	}
	seen := map[string]bool{}
	replacements := map[string]*[]grantReplacementRef{}
	replacedIDs := map[string]bool{}
	for _, row := range result.Rows {
		if seen[row.Username] || row.Username == "" || row.Settings.ID != result.Exam || !validGrantWorkResult(row.Work) || !digest.MatchString(row.Settings.TemplateVersion) || !digest.MatchString(row.Hash) || row.Settings.Latest <= row.Settings.Earliest || row.Settings.Duration < 60 || row.Settings.Duration > 21600 {
			return fail
		}
		seen[row.Username] = true
		if op == "grants.additional-preview" && !legacyReceipt && (row.Replaces == nil || row.ExistingGrants == nil) {
			return fail
		}
		if row.ExistingGrants != nil && *row.ExistingGrants < 0 {
			return fail
		}
		if row.Replaces != nil {
			if row.ExistingGrants != nil && *row.ExistingGrants != len(*row.Replaces) {
				return fail
			}
			for _, ref := range *row.Replaces {
				if !uuid.MatchString(ref.ID) || ref.Revision <= 0 || !digest.MatchString(ref.Hash) || replacedIDs[ref.ID] {
					return fail
				}
				replacedIDs[ref.ID] = true
			}
		}
		replacements[row.Username] = row.Replaces
		if result.Exam == "sandbox" && (row.Settings.Duration != 300 || row.Settings.Webcam || row.Settings.Terminals != 4) {
			return fail
		}
	}
	if op == "grants.issue-preview" || op == "grants.additional-preview" {
		expectedKind := "NEW_LEGACY_INITIAL_GRANTS"
		if op == "grants.additional-preview" {
			expectedKind = "NEW_ADDITIONAL_TEMPLATE_GRANTS"
			if scope.Exam == "sandbox" {
				expectedKind = "NEW_SANDBOX_PRACTICE_GRANTS"
			}
		}
		if result.Kind != expectedKind || result.DefinitionRevision != scope.DefinitionRevision {
			return fail
		}
		saved := map[string]grantSavedSource{}
		workSources := map[string]grantWorkResult{}
		if scope.PreserveDuration && scope.Duration != 0 {
			return fail
		}
		if scope.WorkSources != nil {
			if scope.Work != nil || scope.SavedSources != nil || len(scope.WorkSources) != len(scope.Usernames) {
				return fail
			}
			for _, source := range scope.WorkSources {
				if _, exists := workSources[source.Username]; exists || !validGrantWorkResult(source.Work) {
					return fail
				}
				workSources[source.Username] = source.Work
			}
		}
		if scope.SavedSources != nil {
			if scope.Work != nil || len(scope.SavedSources) != len(scope.Usernames) {
				return fail
			}
			for _, source := range scope.SavedSources {
				if _, exists := saved[source.Username]; exists || !managementUUID.MatchString(source.Attempt) || !catalogHash.MatchString(source.Checksum) {
					return fail
				}
				saved[source.Username] = source
			}
		}
		overrides := map[string]scriptStudentSettings{}
		for _, setting := range scope.StudentSettings {
			if _, exists := overrides[setting.Username]; exists || !seen[setting.Username] ||
				(setting.Duration == nil && setting.Webcam == nil) ||
				(setting.Duration != nil && (*setting.Duration < 60 || *setting.Duration > 21600)) {
				return fail
			}
			overrides[setting.Username] = setting
		}
		for _, row := range result.Rows {
			expectedWork := grantWorkResult{Kind: "template", Name: row.Settings.Template, Hash: scope.TemplateVersion}
			if scope.Work != nil {
				expectedWork = *scope.Work
			}
			if scope.SavedSources != nil {
				source, ok := saved[row.Username]
				if !ok {
					return fail
				}
				expectedWork = grantWorkResult{Kind: "saved", Attempt: source.Attempt, Checksum: source.Checksum}
			}
			if scope.WorkSources != nil {
				work, ok := workSources[row.Username]
				if !ok {
					return fail
				}
				expectedWork = work
			}
			expectedDuration, expectedWebcam := scope.Duration, scope.Webcam
			checkDuration := !scope.PreserveDuration
			if setting, ok := overrides[row.Username]; ok {
				if setting.Duration != nil {
					expectedDuration = *setting.Duration
					checkDuration = true
				}
				if setting.Webcam != nil {
					expectedWebcam = setting.Webcam
				}
			}
			if row.Work != expectedWork || row.Settings.TemplateVersion != scope.TemplateVersion || row.Settings.Earliest != scope.Earliest || row.Settings.Latest != scope.Latest || (op == "grants.additional-preview" && checkDuration && row.Settings.Duration != expectedDuration) || (expectedWebcam != nil && row.Settings.Webcam != *expectedWebcam) {
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
			if !seen[issued.Username] || !uuid.MatchString(issued.Grant) || ids[issued.Grant] || replacedIDs[issued.Grant] {
				return fail
			}
			reviewed := replacements[issued.Username]
			if (reviewed == nil) != (issued.Replaced == nil) {
				return fail
			}
			if reviewed != nil {
				if len(*reviewed) != len(*issued.Replaced) {
					return fail
				}
				remaining := map[grantReplacementRef]bool{}
				for _, ref := range *reviewed {
					remaining[ref] = true
				}
				for _, ref := range *issued.Replaced {
					if !remaining[ref] {
						return fail
					}
					delete(remaining, ref)
				}
			}
			delete(seen, issued.Username)
			ids[issued.Grant] = true
		}
	} else if len(result.Issued) != 0 {
		return fail
	}
	return nil
}
