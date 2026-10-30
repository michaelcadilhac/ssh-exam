package main

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"errors"
	"io"
	"os"
	"regexp"
	"strconv"
	"strings"
	"syscall"
)

type scriptStudentSettings struct {
	Username string `json:"username"`
	Duration *int64 `json:"duration,omitempty"`
	Webcam   *bool  `json:"webcam,omitempty"`
}
type scriptInputRow struct {
	Username string `json:"username"`
	Settings struct {
		Duration *int64 `json:"duration,omitempty"`
		Webcam   *bool  `json:"webcam,omitempty"`
	} `json:"settings"`
	Work grantWorkResult `json:"work"`
}

type scriptWorkSource struct {
	Username string          `json:"username"`
	Work     grantWorkResult `json:"work"`
}

func grantWorkInput(work grantWorkResult) map[string]any {
	value := map[string]any{"kind": work.Kind}
	if work.Kind == "template" {
		value["name"], value["hash"] = work.Name, work.Hash
	}
	if work.Kind == "saved" {
		value["attempt"], value["checksum"] = work.Attempt, work.Checksum
	}
	return value
}

func scriptBatchInput(path string, users *[]string, body map[string]any) error {
	var input io.Reader = os.Stdin
	if path != "-" {
		f, err := os.OpenFile(path, os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
		if err != nil {
			return err
		}
		defer f.Close()
		info, err := f.Stat()
		if err != nil || !info.Mode().IsRegular() || info.Size() > 1024*1024 {
			return errors.New("batch input needs a regular file or explicit stdin, at most1MiB")
		}
		input = f
	}
	data, err := io.ReadAll(io.LimitReader(input, 1024*1024+1))
	if err != nil || len(data) > 1024*1024 {
		return errors.New("batch input exceeds1MiB")
	}
	var rows []scriptInputRow
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 {
		return errors.New("batch input is empty")
	}
	if trimmed[0] == '{' {
		for _, line := range bytes.Split(trimmed, []byte{'\n'}) {
			if len(bytes.TrimSpace(line)) == 0 {
				continue
			}
			var row scriptInputRow
			d := json.NewDecoder(bytes.NewReader(line))
			d.DisallowUnknownFields()
			if d.Decode(&row) != nil || d.Decode(new(any)) != io.EOF {
				return errors.New("invalid JSONL row; choose username, settings(duration seconds/webcam), work")
			}
			rows = append(rows, row)
		}
	} else {
		r := csv.NewReader(bytes.NewReader(data))
		r.FieldsPerRecord = -1
		csvRows, err := r.ReadAll()
		if err != nil || len(csvRows) < 2 {
			return errors.New("invalid CSV batch")
		}
		header := map[string]int{}
		for i, field := range csvRows[0] {
			field = strings.TrimSpace(field)
			if _, duplicate := header[field]; duplicate {
				return errors.New("duplicate batch column")
			}
			switch field {
			case "username", "attempt", "checksum", "duration_seconds", "require_webcam":
			default:
				return errors.New("batch CSV columns: username,attempt,checksum[,duration_seconds,require_webcam]")
			}
			header[field] = i
		}
		for _, field := range []string{"username", "attempt", "checksum"} {
			if _, ok := header[field]; !ok {
				return errors.New("batch CSV requires username,attempt,checksum")
			}
		}
		for _, record := range csvRows[1:] {
			if len(record) != len(header) {
				return errors.New("batch CSV row has the wrong field count")
			}
			row := scriptInputRow{Username: strings.TrimSpace(record[header["username"]]), Work: grantWorkResult{Kind: "saved", Attempt: strings.TrimSpace(record[header["attempt"]]), Checksum: strings.TrimSpace(record[header["checksum"]])}}
			if i, ok := header["duration_seconds"]; ok && strings.TrimSpace(record[i]) != "" {
				n, err := strconv.ParseInt(strings.TrimSpace(record[i]), 10, 64)
				if err != nil {
					return errors.New("duration_seconds must be explicit integer seconds")
				}
				row.Settings.Duration = &n
			}
			if i, ok := header["require_webcam"]; ok && strings.TrimSpace(record[i]) != "" {
				switch strings.TrimSpace(record[i]) {
				case "true", "required":
					v := true
					row.Settings.Webcam = &v
				case "false", "optional":
					v := false
					row.Settings.Webcam = &v
				default:
					return errors.New("require_webcam must be true/false or required/optional")
				}
			}
			rows = append(rows, row)
		}
	}
	if len(rows) < 1 || len(rows) > 200 {
		return errors.New("batch input requires1..200 distinct students")
	}
	selected := map[string]bool{}
	sources := []grantSavedSource{}
	overrides := []scriptStudentSettings{}
	allDurations := true
	var commonWork *grantWorkResult
	sharedWork := true
	for _, row := range rows {
		if !regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9_-]{0,31}$`).MatchString(row.Username) || selected[row.Username] || !validGrantWorkResult(row.Work) {
			return errors.New("invalid/duplicate student or explicit work source")
		}
		selected[row.Username] = true
		if row.Settings.Duration != nil && (*row.Settings.Duration < 60 || *row.Settings.Duration > 21600) {
			return errors.New("per-student duration must be60..21600 seconds")
		}
		if row.Settings.Duration == nil {
			allDurations = false
		}
		if row.Settings.Duration != nil || row.Settings.Webcam != nil {
			overrides = append(overrides, scriptStudentSettings{Username: row.Username, Duration: row.Settings.Duration, Webcam: row.Settings.Webcam})
		}
		if row.Work.Kind == "saved" {
			sources = append(sources, grantSavedSource{Username: row.Username, Attempt: row.Work.Attempt, Checksum: row.Work.Checksum})
		} else {
			if commonWork != nil && *commonWork != row.Work {
				sharedWork = false
			}
			work := row.Work
			commonWork = &work
		}
	}
	if len(*users) == 0 {
		for _, row := range rows {
			*users = append(*users, row.Username)
		}
	} else {
		if len(*users) != len(rows) {
			return errors.New("input must cover the complete selected roster")
		}
		for _, user := range *users {
			if !selected[user] {
				return errors.New("input omits a selected student")
			}
		}
	}
	if len(sources) > 0 && len(sources) != len(rows) || !sharedWork {
		mapped := []map[string]any{}
		for _, row := range rows {
			mapped = append(mapped, map[string]any{"username": row.Username, "work": grantWorkInput(row.Work)})
		}
		body["work_sources"] = mapped
	} else if len(sources) > 0 {
		body["saved_sources"] = sources
	} else {
		// The strict workspace union accepts only fields for this source kind.
		// grantWorkResult is a reply decoder and includes empty saved-work fields.
		body["work"] = grantWorkInput(*commonWork)
	}
	if len(overrides) > 0 {
		body["student_settings"] = overrides
	}
	if allDurations && body["preserve_duration"] != true {
		body["duration"] = *rows[0].Settings.Duration
	}
	return nil
}
