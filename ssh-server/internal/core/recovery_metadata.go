package core

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"unicode/utf8"
)

var errRecoveryMetadata = errors.New("saved-work recovery metadata unavailable or unsafe")

func recoveryMetadataRefusal(a *Attempt) error {
	if a == nil || !identifier.MatchString(a.Exam) || !attemptID.MatchString(a.ID) {
		return errors.New("saved-work recovery identity/metadata unsafe; no new execution authority established; preserve records and use examctl help recovery-grants and examctl help info")
	}
	return fmt.Errorf("%w; no new execution authority established; inspect examctl recovery-grants --exam %s and examctl info %s --read-only; preserve grants, markers and protected source, never remove a marker or fall back to starter files", errRecoveryMetadata, a.Exam, a.ID)
}

// Pin each private path component. ENOENT alone means a legacy authorization is
// absent; an unsafe directory, dangling link or unreadable record is NOT absence.
func (e *Engine) openRecoveryExam(exam string) (*os.File, error) {
	if !identifier.MatchString(exam) {
		return nil, errRecoveryMetadata
	}
	root, err := readOnlyRoot(e.Config.State)
	if err != nil {
		return nil, errRecoveryMetadata
	}
	defer root.Close()
	parent, err := readOnlyOpenAt(root, "recovery-preparations", true)
	if err != nil {
		return nil, err
	}
	defer parent.Close()
	return readOnlyOpenAt(parent, exam, true)
}

func recoveryMetadataFile(root *os.File, name string, limit int64) ([]byte, error) {
	return privateControlFile(root, name, limit)
}

// One strict parser for admission and deletion/inspection. Never allow a second
// JSON value, duplicate keys or unknown authority fields to mean different things
// to the two consumers. Errors do not echo malformed private data.
func decodeRecoveryMetadata(b []byte) (*RecoveryPreparation, error) {
	if len(b) > 16384 || !utf8.Valid(b) || !validReadOnlyJSON(b) {
		return nil, errRecoveryMetadata
	}
	var r RecoveryPreparation
	var fields map[string]json.RawMessage
	if json.Unmarshal(b, &fields) != nil {
		return nil, errRecoveryMetadata
	}
	for field := range fields {
		switch field {
		case "exam", "username", "uid", "duration", "source_attempt", "checksum", "created_at", "reason":
		default:
			return nil, errRecoveryMetadata
		}
	}
	d := json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	if d.Decode(&r) != nil || d.Decode(new(any)) != io.EOF {
		return nil, errRecoveryMetadata
	}
	_, checksumErr := hex.DecodeString(r.Checksum)
	if !identifier.MatchString(r.Exam) || !identifier.MatchString(r.Username) || r.UID < 0 || r.Duration < 60 || r.Duration > 21600 || !attemptID.MatchString(r.SourceAttempt) || len(r.Checksum) != 64 || checksumErr != nil || r.CreatedAt <= 0 || len(strings.TrimSpace(r.Reason)) < 8 {
		return nil, errRecoveryMetadata
	}
	return &r, nil
}

func (e *Engine) readRecoveryConsumption(a *Attempt) ([]byte, error) {
	if a == nil || !identifier.MatchString(a.Username) {
		return nil, errRecoveryMetadata
	}
	root, err := e.openRecoveryExam(a.Exam)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	return recoveryMetadataFile(root, a.Username+".json.consumed", 36)
}
