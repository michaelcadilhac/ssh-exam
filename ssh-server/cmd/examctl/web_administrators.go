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
	"syscall"
	"unicode/utf16"
	"unicode/utf8"
)

var administratorName = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)

func webAdministratorsHelp(out io.Writer) {
	fmt.Fprintln(out, `Usage: sudo examctl [--config FILE] web administrators list [--limit 1..200] [--after USERNAME]
       sudo examctl web administrators show USERNAME
       sudo examctl web administrators create USERNAME [--password-stdin] [--request UUID]
       examctl help administrators

Create a gateway administrator with full administrator powers over all exams,
including creation of other administrators. This never creates a Unix/student
account or changes an exam, attempt, deadline, submission or account restriction.
Creation NEVER overwrites, resets or replaces an existing administrator.

Uses the existing root agent Ed25519 identity and fixed verified outbound HTTPS.
Explicit gateway managementOperations authorization is required independently for
administrators.list, administrators.show and administrators.create (default deny).
No browser session, separate token, root SSH or direct database editing.

--config FILE      existing protected agent config; default /etc/exam-agent/agent.json
--request UUID     durable intent; new by default. On a lost reply, retry SAME ID,
                   username and ORIGINAL password. Changed arguments refuse.
                   Use a NEW ID for fresh list/show; old reads are cached snapshots.
--limit N          list page, default100, maximum200; --after is its exclusive cursor
--password-stdin   read exact finite UTF-8 bytes until EOF from a pipe/private file.
                   NO trimming: a trailing newline is part of the password.
                   Maximum4096 input bytes and12..1024 UTF-16 code units, matching
                   browser limits. Do not use a terminal with this flag.
                   Without it, enter and confirm in a hidden controlling-TTY prompt.
--help             discover workflows without root/configuration or reading secrets

NEVER put passwords in arguments, environment variables or shell history. The
command creates no password file. Protect any operator-supplied input file and
use a trusted terminal. Normal cancellation restores terminal settings; SIGKILL
cannot run cleanup. Owned byte buffers are wiped, but Go/JS immutable strings and
privileged debugging cannot promise guaranteed memory erasure. Credential request
retries use the original salted Argon2id verifier, NOT a fast password fingerprint.
Hashes/passwords never appear in output, audit or permanent result payloads.

List/show return bounded username/role metadata only, not passwords/hashes.
Confirmed creation means the authenticated gateway transaction completed, not
that it changed native state or logged into the new account. Unknown, truncated,
wrong-scope or unverified responses are NOT success. Preserve the request ID;
inspect fresh list/show and retry original intent rather than reset credentials.
Disconnected gateway management cannot be performed offline. First installation
bootstrap remains the gateway's separate interactive operator workflow.

Examples:
  sudo examctl web administrators list --limit 50
  sudo examctl web administrators show helper_admin
  sudo examctl web administrators create helper_admin
  sudo examctl web administrators create helper_admin --request UUID-FROM-LOST-REPLY
  sudo examctl web administrators create helper_admin --password-stdin < /root/private-credential-input

Exit status: 0 authenticated metadata/creation, 1 refusal/unconfirmed outcome,
2 invalid syntax. Run examctl web administrators help for this complete workflow.`)
}

func webAdministratorsMain(args []string) int {
	if _, help := helpRequest(args); help {
		webAdministratorsHelp(os.Stdout)
		return 0
	}
	flags := flag.NewFlagSet("examctl web administrators", flag.ContinueOnError)
	flags.SetOutput(io.Discard) // Flag errors can contain a supplied secret value.
	config := flags.String("config", "/etc/exam-agent/agent.json", "protected config")
	request := flags.String("request", "", "durable intent UUID")
	limit := flags.Int("limit", 100, "page size")
	after := flags.String("after", "", "exclusive username cursor")
	stdin := flags.Bool("password-stdin", false, "exact finite private UTF-8 input")
	usage := func() int {
		fmt.Fprintln(os.Stderr, "Invalid administrator command or flags; run examctl web administrators help. Passwords are never accepted as arguments.")
		return 2
	}
	if err := flags.Parse(ordered(args)); err != nil {
		return usage()
	}
	words := flags.Args()
	if len(words) == 2 && words[0] == "administrators" && words[1] == "help" {
		webAdministratorsHelp(os.Stdout)
		return 0
	}
	if len(words) < 2 || words[0] != "administrators" {
		return usage()
	}
	provided := map[string]bool{}
	flags.Visit(func(f *flag.Flag) { provided[f.Name] = true })
	if *request != "" && !regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$`).MatchString(*request) {
		return usage()
	}
	op := words[1]
	body := map[string]any{}
	switch op {
	case "list":
		if len(words) != 2 || provided["password-stdin"] || *limit < 1 || *limit > 200 || (*after != "" && !administratorName.MatchString(*after)) {
			return usage()
		}
		body["limit"] = *limit
		if *after != "" {
			body["after"] = *after
		}
	case "show", "create":
		if len(words) != 3 || !administratorName.MatchString(words[2]) || provided["limit"] || provided["after"] || (op == "show" && provided["password-stdin"]) {
			return usage()
		}
		body["username"] = words[2]
	default:
		return usage()
	}
	if os.Getuid() != 0 || os.Geteuid() != 0 {
		fmt.Fprintln(os.Stderr, "Run examctl as root on the class server using its existing agent identity; see examctl web administrators help")
		return 1
	}
	c, err := core.LoadConfig(*config)
	if err != nil {
		fmt.Fprintln(os.Stderr, "Load root agent configuration:", err)
		return 1
	}
	if op == "create" {
		if err := syscall.Setrlimit(syscall.RLIMIT_CORE, &syscall.Rlimit{Cur: 0, Max: 0}); err != nil {
			fmt.Fprintln(os.Stderr, "Cannot disable credential-command core dumps; no password read or request sent")
			return 1
		}
		var password []byte
		if *stdin {
			info, statErr := os.Stdin.Stat()
			if statErr != nil || info.Mode()&os.ModeCharDevice != 0 {
				fmt.Fprintln(os.Stderr, "--password-stdin requires a finite pipe/private file, not a terminal. Omit it for the hidden prompt; see examctl web administrators help")
				return 1
			}
			password, err = readAdministratorStdin(os.Stdin)
		} else {
			password, err = readAdministratorTTY()
		}
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 1
		}
		defer wipeAdministratorBytes(password)
		body["password"] = string(password)
		defer func() { body["password"] = "" }()
	}
	if *request == "" {
		*request = core.ManagementID()
	}
	fmt.Fprintln(os.Stderr, "Management request ID:", *request)
	result, err := core.ManagementCall(c, "administrators."+op, body, *request)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		fmt.Fprintln(os.Stderr, "Inspect fresh administrators list/show; for the SAME creation intent retry the original password with --request", *request)
		return 1
	}
	if err := validateAdministratorResult(op, body, result.Result); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	if err := json.NewEncoder(os.Stdout).Encode(result); err != nil {
		fmt.Fprintln(os.Stderr, "Metadata output incomplete; inspect current administrators and retry the same intent")
		return 1
	}
	return 0
}

func wipeAdministratorBytes(data []byte) {
	for i := range data {
		data[i] = 0
	}
}

func validateAdministratorPassword(data []byte) error {
	if len(data) > 4096 || !utf8.Valid(data) {
		return errors.New("Password must be valid UTF-8 within4096 bytes and12..1024 UTF-16 code units; no request sent. See examctl web administrators help")
	}
	count := 0
	for _, r := range string(data) {
		count += utf16.RuneLen(r)
	}
	if count < 12 || count > 1024 {
		return errors.New("Password must contain12..1024 UTF-16 code units, matching the browser; no request sent. See examctl web administrators help")
	}
	return nil
}
func readAdministratorStdin(in io.Reader) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(in, 4097))
	if err == nil {
		err = validateAdministratorPassword(data)
	}
	if err != nil {
		wipeAdministratorBytes(data)
		return nil, errors.New("Credential input incomplete, invalid UTF-8 or outside12..1024 UTF-16 code units/4096 bytes; no request sent. Supply exact finite bytes/EOF; see examctl web administrators help")
	}
	return data, nil
}

func validateAdministratorResult(op string, body map[string]any, raw json.RawMessage) error {
	failure := errors.New("Administrator result scope/schema unverified; no creation confirmed and no metadata printed. Inspect fresh administrators list/show and retry the original creation intent")
	if !administratorJSONSafe(raw) {
		return failure
	}
	fields := map[string]json.RawMessage{}
	if json.Unmarshal(raw, &fields) != nil {
		return failure
	}
	required := []string{"username"}
	if op == "show" {
		required = []string{"username", "role"}
	} else if op == "list" {
		required = []string{"administrators", "next"}
	}
	if len(fields) != len(required) {
		return failure
	}
	for _, key := range required {
		if len(fields[key]) == 0 {
			return failure
		}
	}
	decode := func(target any) error {
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(target); err != nil {
			return err
		}
		var extra any
		if err := decoder.Decode(&extra); err != io.EOF {
			return failure
		}
		return nil
	}
	if op == "list" {
		var result struct {
			Administrators []struct {
				Username string `json:"username"`
			} `json:"administrators"`
			Next *string `json:"next"`
		}
		if decode(&result) != nil || result.Administrators == nil || len(result.Administrators) > body["limit"].(int) {
			return failure
		}
		var rows []map[string]json.RawMessage
		if json.Unmarshal(fields["administrators"], &rows) != nil {
			return failure
		}
		for _, row := range rows {
			if len(row) != 1 || len(row["username"]) == 0 {
				return failure
			}
		}
		previous, _ := body["after"].(string)
		for _, row := range result.Administrators {
			if !administratorName.MatchString(row.Username) || row.Username <= previous {
				return failure
			}
			previous = row.Username
		}
		if result.Next != nil && (len(result.Administrators) != body["limit"].(int) || *result.Next != previous) {
			return failure
		}
		return nil
	}
	if op == "create" {
		var result struct {
			Username string `json:"username"`
		}
		if decode(&result) != nil || result.Username != body["username"] {
			return failure
		}
		return nil
	}
	var result struct {
		Username string `json:"username"`
		Role     string `json:"role"`
	}
	if op != "show" || decode(&result) != nil || result.Username != body["username"] || result.Role != "admin" {
		return failure
	}
	return nil
}

// Reject duplicate keys before struct decoding (which otherwise accepts the
// last value). This is a small bounded metadata schema, not a generic JSON API.
func administratorJSONSafe(data []byte) bool {
	return boundedMetadataJSON(data, 65536, 4, 4096)
}

// Shared only by the bounded administrator and exam-definition reply schemas.
// This prevents duplicate-key ambiguity before their strict typed decoders.
func boundedMetadataJSON(data []byte, byteLimit, depthLimit, tokenLimit int) bool {
	if len(data) == 0 || len(data) > byteLimit {
		return false
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	tokens := 0
	var value func(int) bool
	value = func(depth int) bool {
		tokens++
		if depth > depthLimit || tokens > tokenLimit {
			return false
		}
		token, err := decoder.Token()
		if err != nil {
			return false
		}
		delim, compound := token.(json.Delim)
		if !compound {
			return true
		}
		switch delim {
		case '{':
			seen := map[string]bool{}
			for decoder.More() {
				key, err := decoder.Token()
				if err != nil {
					return false
				}
				name, ok := key.(string)
				if !ok || seen[name] {
					return false
				}
				seen[name] = true
				if !value(depth + 1) {
					return false
				}
			}
		case '[':
			for decoder.More() {
				if !value(depth + 1) {
					return false
				}
			}
		default:
			return false
		}
		end, err := decoder.Token()
		return err == nil && ((delim == '{' && end == json.Delim('}')) || (delim == '[' && end == json.Delim(']')))
	}
	if !value(0) {
		return false
	}
	_, err := decoder.Token()
	return err == io.EOF
}
