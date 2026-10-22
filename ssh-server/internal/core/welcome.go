package core

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"strings"
	"syscall"
	"time"
	_ "time/tzdata"
	"unicode/utf8"
)

const maxWelcomeBytes = 64 * 1024

// Keep template text out of machine-readable readiness. In particular, a large
// welcome must not exceed the SSH client's 8 KiB admission-line limit.
func terminalReadyResponse(result []byte) ([]byte, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(result, &fields); err != nil {
		return nil, err
	}
	delete(fields, "welcome")
	return json.Marshal(fields)
}

// Read the administrator-controlled materials mounted at /materials in the
// pane. The outer login gate cannot see that mount. Emit only after admission
// acknowledgement, before any student shell startup files run.
func terminalWelcome(config Config, a *Attempt, practice bool) (string, error) {
	if practice {
		return "\r\nPractice terminal. The exam clock has not started.\r\n", nil
	}
	materials, err := templateMaterials(config, a.Settings)
	if err != nil {
		return "", err
	}
	root, err := os.OpenRoot(materials)
	if errors.Is(err, os.ErrNotExist) && a.Settings.TemplateVersion == "" {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	defer root.Close()
	// Never follow a banner symlink or block on a special filesystem entry.
	file, err := root.OpenFile("WELCOME.txt", os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	if errors.Is(err, os.ErrNotExist) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() || info.Sys().(*syscall.Stat_t).Nlink != 1 || info.Size() > maxWelcomeBytes {
		return "", errors.New("welcome must be a regular file without hard links, at most 64 KiB")
	}
	content, err := io.ReadAll(io.LimitReader(file, maxWelcomeBytes+1))
	if err != nil {
		return "", err
	}
	if len(content) > maxWelcomeBytes || !utf8.Valid(content) {
		return "", errors.New("welcome must be UTF-8 text of at most 64 KiB")
	}
	if len(content) == 0 {
		return "", nil
	}
	name := a.Settings.Name
	if name == "" {
		name = a.Exam
	}
	// Match the dashboard's explicit timezone, independent of client/server TZ.
	zone, err := time.LoadLocation("America/Chicago")
	if err != nil {
		zone = time.UTC
	}
	deadline := time.UnixMilli(a.Deadline).In(zone).Format("Jan 2, 2006 at 3:04:05 PM MST")
	message := strings.NewReplacer("[DEADLINE]", deadline, "[USER]", a.Username, "[EXAM-NAME]", name).Replace(string(content))
	message = strings.ReplaceAll(strings.ReplaceAll(message, "\r\n", "\n"), "\n", "\r\n")
	if !strings.HasSuffix(message, "\r\n") {
		message += "\r\n"
	}
	return "\r\n" + message, nil
}
