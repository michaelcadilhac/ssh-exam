package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

type examReplySettings struct {
	ID              string  `json:"id"`
	Name            string  `json:"name"`
	Template        string  `json:"template"`
	TemplateVersion *string `json:"template_version,omitempty"`
	Duration        int64   `json:"duration"`
	Webcam          bool    `json:"webcam"`
	Terminals       int     `json:"terminals"`
	Earliest        int64   `json:"earliest"`
	Latest          int64   `json:"latest"`
	FileMiB         *int64  `json:"collection_file_mib,omitempty"`
	TotalMiB        *int64  `json:"collection_total_mib,omitempty"`
}

func (s *examReplySettings) UnmarshalJSON(data []byte) error {
	type plain examReplySettings
	if err := catalogDecode(data, (*plain)(s), []string{"id", "name", "template", "duration", "webcam", "terminals", "earliest", "latest"}); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(data, &fields) != nil {
		return errors.New("invalid exam metadata")
	}
	for _, key := range []string{"template_version", "collection_file_mib", "collection_total_mib"} {
		if raw, present := fields[key]; present && bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
			return errors.New("null optional exam metadata")
		}
	}
	return nil
}

func (s examReplySettings) valid() bool {
	nameLength := len(utf16.Encode([]rune(s.Name)))
	if !catalogName.MatchString(s.ID) || !catalogName.MatchString(s.Template) || nameLength < 1 || nameLength > 120 || s.Duration < 60 || s.Duration > 21600 || s.Terminals < 1 || s.Terminals > 4 || s.Earliest < -catalogSafeInteger || s.Earliest > catalogSafeInteger || s.Latest < -catalogSafeInteger || s.Latest > catalogSafeInteger || s.Latest <= s.Earliest {
		return false
	}
	if s.TemplateVersion != nil && !catalogHash.MatchString(*s.TemplateVersion) {
		return false
	}
	if s.FileMiB != nil && (*s.FileMiB < 1 || *s.FileMiB > 4096) {
		return false
	}
	if s.TotalMiB != nil && (*s.TotalMiB < 1 || *s.TotalMiB > 16384) {
		return false
	}
	if s.TotalMiB != nil && s.FileMiB != nil && *s.TotalMiB < *s.FileMiB {
		return false
	}
	return s.ID != "sandbox" || (s.Duration == 300 && !s.Webcam && s.Terminals == 4 && s.Name == "sandbox")
}

type examDefinitionReply struct {
	Exam      examReplySettings `json:"exam"`
	Revision  string            `json:"revision"`
	Lifecycle string            `json:"lifecycle,omitempty"`
}

func (r *examDefinitionReply) UnmarshalJSON(data []byte) error {
	type plain examDefinitionReply
	if err := catalogDecode(data, (*plain)(r), []string{"exam", "revision"}); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(data, &fields) != nil {
		return errors.New("invalid definition lifecycle metadata")
	}
	if value, present := fields["lifecycle"]; present && bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
		return errors.New("null definition lifecycle metadata")
	}
	return nil
}
func (r examDefinitionReply) valid() bool {
	return r.Exam.valid() && catalogHash.MatchString(r.Revision) && (r.Lifecycle == "" || r.Lifecycle == "active" || r.Lifecycle == "archived")
}

// Authentication of the outer envelope does not bind the inner exam, page or
// saved settings to this operator's intent. Refuse BEFORE any stdout/file output.
// This is metadata validation, not native source availability or work permission.
func validateExamResult(operation string, body any, raw json.RawMessage) error {
	if !strings.HasPrefix(operation, "exams.") {
		return nil
	}
	if operation == "exams.retire-preview" || operation == "exams.delete" || operation == "exams.archive" || operation == "exams.unarchive" {
		return validateRetirementResult(operation, body, raw)
	}
	bad := errors.New("gateway exam definition scope/settings/bounds mismatch; no output or confirmed selection; preserve --request and inspect web exams show with a NEW read request, then review before retrying; see examctl web help")
	if !utf8.Valid(raw) || !boundedMetadataJSON(raw, catalogReplyLimit, 4, 8192) {
		return bad
	}
	input, err := json.Marshal(body)
	if err != nil {
		return bad
	}
	var b struct {
		ID              string         `json:"id"`
		Limit           int            `json:"limit"`
		After           string         `json:"after"`
		Exam            map[string]any `json:"exam"`
		Changes         map[string]any `json:"changes"`
		Revision        string         `json:"revision"`
		Reason          string         `json:"reason"`
		SourceSelection string         `json:"source_selection"`
		Lifecycle       string         `json:"lifecycle,omitempty"`
	}
	if catalogDecode(input, &b, nil) != nil {
		return bad
	}
	if b.SourceSelection != "" && b.SourceSelection != "template-version/v1" {
		return bad
	}
	if operation == "exams.list" {
		if b.Lifecycle != "" && b.Lifecycle != "active" && b.Lifecycle != "archived" && b.Lifecycle != "all" {
			return bad
		}
		var r struct {
			Exams []examDefinitionReply `json:"exams"`
			Next  *string               `json:"next"`
		}
		if catalogDecode(raw, &r, []string{"exams", "next"}) != nil || b.Limit < 1 || b.Limit > 200 || len(r.Exams) > b.Limit || (b.After != "" && !catalogName.MatchString(b.After)) {
			return bad
		}
		last := b.After
		for _, item := range r.Exams {
			if !item.valid() || item.Exam.ID <= last || (b.Lifecycle == "archived" && item.Lifecycle != "archived") {
				return bad
			}
			last = item.Exam.ID
		}
		if r.Next != nil && (len(r.Exams) != b.Limit || *r.Next != last || !catalogName.MatchString(*r.Next)) {
			return bad
		}
		return nil
	}
	var r examDefinitionReply
	if json.Unmarshal(raw, &r) != nil || !r.valid() {
		return bad
	}
	expected := b.ID
	changes := b.Changes
	switch operation {
	case "exams.create":
		changes = b.Exam
		var ok bool
		expected, ok = b.Exam["id"].(string)
		if !ok {
			return bad
		}
	case "exams.update":
		if !catalogHash.MatchString(b.Revision) || len(changes) == 0 {
			return bad
		}
	case "exams.show":
	default:
		return bad
	}
	if !catalogName.MatchString(expected) || r.Exam.ID != expected {
		return bad
	}
	if operation == "exams.show" {
		return nil
	}
	encoded, err := json.Marshal(r.Exam)
	if err != nil {
		return bad
	}
	var saved map[string]any
	if json.Unmarshal(encoded, &saved) != nil {
		return bad
	}
	for key, value := range changes {
		if key == "template_version" && value == "" && saved[key] == nil {
			continue
		} // explicit legacy default, never fallback.
		if expected == "sandbox" {
			switch key {
			case "duration":
				value = float64(300)
			case "webcam":
				value = false
			case "terminals":
				value = float64(4)
			case "name":
				value = "sandbox"
			}
		}
		actual, exists := saved[key]
		if !exists || !reflect.DeepEqual(value, actual) {
			return bad
		}
	}
	return nil
}
