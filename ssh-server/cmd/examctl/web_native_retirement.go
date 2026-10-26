package main

import (
	"encoding/json"
	"errors"
	"examworkspace/agent/internal/core"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"syscall"
	"unicode/utf8"
)

func nativeRetirementFile(path string) (core.ExamRetirementEvidence, error) {
	var result core.ExamRetirementEvidence
	f, err := os.OpenFile(path, os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	if err != nil {
		return result, err
	}
	defer f.Close()
	i, err := f.Stat()
	if err != nil || !i.Mode().IsRegular() || i.Mode().Perm() != 0600 || i.Sys().(*syscall.Stat_t).Uid != 0 || i.Sys().(*syscall.Stat_t).Nlink != 1 || i.Size() > 1024*1024 {
		return result, errors.New("evidence must be an existing root-owned private regular file (0600), at most 1 MiB; use native-review --out, never chmod untrusted input")
	}
	b, err := io.ReadAll(io.LimitReader(f, 1024*1024+1))
	if err != nil || len(b) > 1024*1024 {
		return result, errors.New("evidence unavailable or oversized; regenerate native-review")
	}
	return core.DecodeExamRetirementEvidence(b)
}

func nativeRetirementReview(config, exam, out string) int {
	if os.Getuid() != 0 || os.Geteuid() != 0 {
		fmt.Fprintln(os.Stderr, "Run native-review as root on the class server; see examctl web help")
		return 1
	}
	c, err := core.LoadConfig(config)
	if err != nil {
		fmt.Fprintln(os.Stderr, "Load root agent configuration:", err)
		return 1
	}
	r, err := core.ObserveExamRetirement(c, exam)
	if err != nil {
		fmt.Fprintln(os.Stderr, "No native evidence issued:", err)
		return 1
	}
	b, err := json.Marshal(r)
	if err != nil || len(b) > 1024*1024 {
		fmt.Fprintln(os.Stderr, "Native evidence exceeds safe limit; preserve history for bounded migration")
		return 1
	}
	f, err := os.OpenFile(out, os.O_WRONLY|os.O_CREATE|os.O_EXCL|syscall.O_NOFOLLOW, 0600)
	if err != nil {
		fmt.Fprintln(os.Stderr, "Create NEW private evidence file:", err)
		return 1
	}
	_, err = f.Write(b)
	if err == nil {
		err = f.Sync()
	}
	err = errors.Join(err, f.Close())
	if err == nil {
		var dir *os.File
		dir, err = os.Open(filepath.Dir(out))
		if err == nil {
			err = errors.Join(dir.Sync(), dir.Close())
		}
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "Evidence file durability unconfirmed; preserve it and generate a new review/file:", err)
		return 1
	}
	fmt.Fprintln(os.Stdout, "Private native evidence:", out, "(valid for upload for ten minutes; no retirement or hold change)")
	return 0
}

func validateNativeReconciliationResult(operation string, body any, raw json.RawMessage) error {
	if operation != "exams.native-reconcile" {
		return nil
	}
	bad := errors.New("gateway native reconciliation scope/evidence mismatch; preserve evidence file and SAME --request/arguments, inspect a NEW retire-preview before any retirement")
	input, err := json.Marshal(body)
	if err != nil {
		return bad
	}
	var b struct {
		ID, Revision string
		Evidence     core.ExamRetirementEvidence
	}
	if json.Unmarshal(input, &b) != nil || !catalogName.MatchString(b.ID) || !catalogHash.MatchString(b.Revision) || b.Evidence.Exam != b.ID {
		return bad
	}
	var r struct {
		ID, Revision, Review, Evidence string
		Attempts, Permissions          int
		ReleasedRetentions             int `json:"released_retentions"`
	}
	if !utf8.Valid(raw) || !boundedMetadataJSON(raw, 16384, 3, 64) || catalogDecode(raw, &r, []string{"id", "revision", "review", "evidence", "attempts", "permissions", "released_retentions"}) != nil {
		return bad
	}
	// The gateway hashes schema-normalized JSON, whose field ordering differs
	// from Go. Hash a sorted-key representation in both implementations.
	data, _ := json.Marshal(b.Evidence)
	var normalized any
	if json.Unmarshal(data, &normalized) != nil {
		return bad
	}
	data, _ = json.Marshal(normalized)
	if r.ID != b.ID || r.Revision != b.Revision || !catalogHash.MatchString(r.Review) || r.Evidence != core.Hash(data) || r.Attempts != len(b.Evidence.Attempts) || r.Permissions != len(b.Evidence.Permissions) || r.ReleasedRetentions != b.Evidence.ReleasedRetentions {
		return bad
	}
	return nil
}
