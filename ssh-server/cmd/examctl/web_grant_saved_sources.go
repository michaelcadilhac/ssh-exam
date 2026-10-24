package main

import (
	"bytes"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"os"
	"regexp"
	"strings"
	"syscall"
)

type grantSavedSource struct {
	Username string `json:"username"`
	Attempt  string `json:"attempt"`
	Checksum string `json:"checksum"`
}

// Runtime caller: additional-preview --saved-sources FILE. This selects explicit
// per-student archives for the existing reviewed issuance, not native permission.
func readGrantSavedSources(path string) ([]grantSavedSource, error) {
	usage := errors.New("--saved-sources requires a regular CSV file of at most64 KiB with header username,attempt,checksum and1..200 distinct students; choose each student's exact protected UUID/SHA256, never a latest/live source")
	if path == "" {
		return nil, usage
	}
	f, err := os.OpenFile(path, os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	if err != nil {
		return nil, fmt.Errorf("cannot read saved source selection: %w; %v", err, usage)
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > 65536 {
		return nil, usage
	}
	data, err := io.ReadAll(io.LimitReader(f, 65537))
	if err != nil || len(data) > 65536 {
		return nil, usage
	}
	r := csv.NewReader(bytes.NewReader(data))
	r.FieldsPerRecord = 3
	rows, err := r.ReadAll()
	if err != nil || len(rows) < 2 || len(rows) > 201 {
		return nil, usage
	}
	for i, name := range []string{"username", "attempt", "checksum"} {
		if strings.TrimSpace(rows[0][i]) != name {
			return nil, usage
		}
	}
	user := regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9_-]{0,31}$`)
	seen := map[string]bool{}
	selected := make([]grantSavedSource, 0, len(rows)-1)
	for index, row := range rows[1:] {
		s := grantSavedSource{strings.TrimSpace(row[0]), strings.TrimSpace(row[1]), strings.TrimSpace(row[2])}
		if !user.MatchString(s.Username) || seen[s.Username] || !managementUUID.MatchString(s.Attempt) || !catalogHash.MatchString(s.Checksum) {
			return nil, fmt.Errorf("saved sources CSV row%d has an invalid/duplicate student or invalid protected attempt/checksum; inspect the exact owner's source before retrying", index+2)
		}
		seen[s.Username] = true
		selected = append(selected, s)
	}
	return selected, nil
}
