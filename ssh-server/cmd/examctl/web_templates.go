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
)

var catalogName = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)
var catalogHash = regexp.MustCompile(`^[a-f0-9]{64}$`)
var catalogCursor = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}@[a-f0-9]{64}$`)

const catalogReplyLimit = 256 * 1024
const catalogSafeInteger = int64(9007199254740991)

type catalogSource struct {
	Schema             int    `json:"schema"`
	Agent              string `json:"agent"`
	Name               string `json:"name"`
	Hash               string `json:"hash"`
	Entries            int    `json:"entries"`
	Files              int    `json:"files"`
	Bytes              int64  `json:"bytes"`
	MaxFileBytes       int64  `json:"max_file_bytes"`
	FirstNativeCreated int64  `json:"first_native_created"`
	LastNativeCreated  int64  `json:"last_native_created"`
	FirstAcknowledged  int64  `json:"first_acknowledged_at"`
	LastAttested       int64  `json:"last_attested_at"`
	LastAcknowledged   int64  `json:"last_acknowledged_at"`
	LastRequest        string `json:"last_request"`
	Revision           string `json:"revision"`
}

func (s *catalogSource) UnmarshalJSON(data []byte) error {
	type plain catalogSource
	return catalogDecode(data, (*plain)(s), []string{"schema", "agent", "name", "hash", "entries", "files", "bytes", "max_file_bytes", "first_native_created", "last_native_created", "first_acknowledged_at", "last_attested_at", "last_acknowledged_at", "last_request", "revision"})
}
func catalogDecode(data []byte, out any, required []string) error {
	if len(data) > catalogReplyLimit {
		return errors.New("catalog reply bound exceeded")
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(data, &fields) != nil {
		return errors.New("invalid catalog object")
	}
	for _, key := range required {
		if len(fields[key]) == 0 || (key != "next" && bytes.Equal(bytes.TrimSpace(fields[key]), []byte("null"))) {
			return errors.New("missing/null required catalog field")
		}
	}
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if err := d.Decode(out); err != nil {
		return err
	}
	if d.Decode(new(any)) != io.EOF {
		return errors.New("trailing catalog reply")
	}
	return nil
}
func catalogTime(n int64) bool { return n >= 0 && n <= catalogSafeInteger }
func catalogMessage(s string) bool {
	if len(s) == 0 || len(s) > 2000 {
		return false
	}
	for _, c := range []byte(s) {
		if c < 32 || c > 126 {
			return false
		}
	}
	return true
}
func (s catalogSource) valid(agent string) bool {
	return s.Schema == 1 && s.Agent == agent && catalogName.MatchString(s.Name) && catalogHash.MatchString(s.Hash) && s.Entries >= 2 && s.Entries <= 20002 && s.Files >= 0 && s.Files <= s.Entries-2 && s.Files <= 20000 && s.Bytes >= 0 && s.Bytes <= 16384*1048576 && s.MaxFileBytes >= 0 && s.MaxFileBytes <= 4096*1048576 && s.MaxFileBytes <= s.Bytes && s.Bytes <= s.MaxFileBytes*int64(s.Files) && s.FirstNativeCreated > 0 && catalogTime(s.FirstNativeCreated) && s.LastNativeCreated > 0 && catalogTime(s.LastNativeCreated) && catalogTime(s.FirstAcknowledged) && catalogTime(s.LastAttested) && catalogTime(s.LastAcknowledged) && s.LastAcknowledged >= s.FirstAcknowledged && managementUUID.MatchString(s.LastRequest) && catalogHash.MatchString(s.Revision)
}

type catalogAcknowledgement struct {
	Request       string `json:"request"`
	Attested      int64  `json:"attested_at"`
	Acknowledged  int64  `json:"acknowledged_at"`
	NativeCreated int64  `json:"native_created"`
}

func (a *catalogAcknowledgement) UnmarshalJSON(data []byte) error {
	type plain catalogAcknowledgement
	return catalogDecode(data, (*plain)(a), []string{"request", "attested_at", "acknowledged_at", "native_created"})
}

type catalogSyncReply struct {
	Agent           string                 `json:"agent"`
	Source          catalogSource          `json:"source"`
	Acknowledgement catalogAcknowledgement `json:"acknowledgement"`
	Updated         bool                   `json:"updated"`
	Observed        int64                  `json:"observed"`
	Note            string                 `json:"note"`
}

func validateCatalogSync(raw json.RawMessage, local core.TemplateVersion, agent, request string) (catalogSyncReply, error) {
	var r catalogSyncReply
	bad := errors.New("gateway template acknowledgement scope/bounds mismatch; no metadata output; preserve the request and inspect web templates show with a NEW read request")
	if catalogDecode(raw, &r, []string{"agent", "source", "acknowledgement", "updated", "observed", "note"}) != nil || r.Agent != agent || !r.Source.valid(agent) || !catalogTime(r.Observed) || !catalogMessage(r.Note) {
		return catalogSyncReply{}, bad
	}
	s, a := r.Source, r.Acknowledgement
	if s.Name != local.Name || s.Hash != local.Hash || s.Schema != local.Schema || s.Entries != local.Entries || s.Files != local.Files || s.Bytes != local.Bytes || s.MaxFileBytes != local.MaxFileBytes || a.Request != request || a.NativeCreated != local.Created || !catalogTime(a.Attested) || !catalogTime(a.Acknowledged) || a.Acknowledged != r.Observed || s.LastAttested < a.Attested {
		return catalogSyncReply{}, bad
	}
	return r, nil
}
func validateCatalogRead(operation string, body any, raw json.RawMessage, agent string) error {
	if !strings.HasPrefix(operation, "templates.") {
		return nil
	}
	bad := errors.New("gateway template metadata scope/bounds mismatch; no output; inspect the exact name/hash and retry with a NEW read request")
	input, _ := json.Marshal(body)
	var b struct {
		Name  string `json:"name"`
		Hash  string `json:"hash"`
		After string `json:"after"`
		Limit int    `json:"limit"`
	}
	if catalogDecode(input, &b, nil) != nil {
		return bad
	}
	if operation == "templates.show" {
		var r struct {
			Agent    string        `json:"agent"`
			Source   catalogSource `json:"source"`
			Observed int64         `json:"observed"`
			Note     string        `json:"note"`
		}
		if catalogDecode(raw, &r, []string{"agent", "source", "observed", "note"}) != nil || r.Agent != agent || !catalogTime(r.Observed) || !catalogMessage(r.Note) || !r.Source.valid(agent) || r.Source.Name != b.Name || r.Source.Hash != b.Hash {
			return bad
		}
		return nil
	}
	if operation != "templates.list" {
		return bad
	}
	var r struct {
		Agent    string          `json:"agent"`
		Sources  []catalogSource `json:"sources"`
		Next     *string         `json:"next"`
		Observed int64           `json:"observed"`
		Note     string          `json:"note"`
	}
	if catalogDecode(raw, &r, []string{"agent", "sources", "next", "observed", "note"}) != nil || r.Agent != agent || !catalogTime(r.Observed) || !catalogMessage(r.Note) || b.Limit < 1 || b.Limit > 200 || len(r.Sources) > b.Limit {
		return bad
	}
	last := b.After
	for _, s := range r.Sources {
		key := s.Name + "@" + s.Hash
		if !s.valid(agent) || key <= last || (b.Name != "" && s.Name != b.Name) {
			return bad
		}
		last = key
	}
	if r.Next != nil && (len(r.Sources) != b.Limit || *r.Next != last || !catalogCursor.MatchString(*r.Next)) {
		return bad
	}
	return nil
}

func webTemplatesHelp(out io.Writer) {
	fmt.Fprintln(out, `Usage: sudo examctl web templates list [--name NAME --limit N --after NAME@HASH]
       sudo examctl web templates show NAME HASH

Read authenticated gateway catalog metadata through the existing root agent
identity. Explicit templates.list/show managementOperations authorization is
required; default none. No student credentials, inbound API, file proxy or exam
contents. These are timestamped SOURCE ATTESTATIONS, not live filesystem probes,
availability leases, template selection, grant/Begin permission or migrations.
Native exact verification remains required before Begin. No latest/deletion.

List is a bounded live metadata page: --limit default 50, range 1..200. Pass next
as exclusive --after NAME@HASH; keep --name stable. Not a complete snapshot/export.
Show requires the exact name and lowercase 64-hex hash, not an exam/attempt ID.
Common --config FILE defaults to /etc/exam-agent/agent.json; --request UUID retains
an original read snapshot. Use a NEW request ID for fresh metadata. Reads never
query class files. Native templates list/show/verify remain separate/offline.

To record/update an observation, run local templates verify then templates sync
NAME HASH --reason TEXT on the class server. Sync verifies actual bytes in the
bounded native worker before signing; exact retries retain the original gateway
acknowledgement. A new sync request deliberately refreshes its timestamp.

Examples:
  sudo examctl web templates list --name midterm
  sudo examctl web templates show midterm HASH
  sudo examctl templates verify midterm HASH
  sudo examctl templates sync midterm HASH --reason 'Reviewed installed source version'

Help needs no root/configuration. Actual requests require real/effective root and
verified outbound HTTPS. Offline/unverified/wrong-scope results print no metadata.
Exit status: 0 authenticated metadata; 1 refusal/failure; 2 invalid syntax.`)
}
func webTemplatesMain(args []string) int {
	if _, help := helpRequest(args); help {
		webTemplatesHelp(os.Stdout)
		return 0
	}
	f := flag.NewFlagSet("examctl web templates", flag.ContinueOnError)
	f.SetOutput(os.Stderr)
	config := f.String("config", "/etc/exam-agent/agent.json", "root configuration")
	request := f.String("request", "", "read request UUID")
	name := f.String("name", "", "name filter")
	limit := f.Int("limit", 50, "page size")
	after := f.String("after", "", "exclusive NAME@HASH cursor")
	usage := func(message string) int {
		fmt.Fprintln(os.Stderr, message+"; run examctl web templates help")
		return 2
	}
	if f.Parse(ordered(args)) != nil {
		return usage("invalid catalog flags")
	}
	w := f.Args()
	if len(w) == 2 && w[1] == "help" {
		webTemplatesHelp(os.Stdout)
		return 0
	}
	if len(w) < 2 || w[0] != "templates" || (*request != "" && !managementUUID.MatchString(*request)) {
		return usage("choose list or show NAME HASH and a valid request UUID")
	}
	seen := map[string]bool{}
	f.Visit(func(f *flag.Flag) { seen[f.Name] = true })
	b := map[string]any{}
	switch w[1] {
	case "list":
		if len(w) != 2 || *limit < 1 || *limit > 200 || (*name != "" && !catalogName.MatchString(*name)) || (*after != "" && !catalogCursor.MatchString(*after)) {
			return usage("list requires bounded --limit and optional --name/--after NAME@HASH")
		}
		b["limit"] = *limit
		if *name != "" {
			b["name"] = *name
		}
		if *after != "" {
			b["after"] = *after
		}
	case "show":
		if len(w) != 4 || !catalogName.MatchString(w[2]) || !catalogHash.MatchString(w[3]) || seen["name"] || seen["limit"] || seen["after"] {
			return usage("show requires exact NAME HASH without list flags")
		}
		b["name"], b["hash"] = w[2], w[3]
	default:
		return usage("only list/show are supported; source confirmation uses local templates sync")
	}
	return executeWeb(*config, *request, "templates."+w[1], b, "")
}

func templateSync(c core.Config, b core.TemplateCommand, request string) (any, error) {
	local, err := core.TemplateCall(c, core.TemplateCommand{Action: "verify", Name: b.Name, Hash: b.Hash}, request)
	if err != nil {
		return nil, fmt.Errorf("local exact-byte verification failed; no new gateway attestation sent: %w", err)
	}
	if local.Info == nil || !local.Verified || !local.Installed {
		return nil, errors.New("local verification result incomplete; no gateway attestation sent")
	}
	confirmed, err := core.ManagementCall(c, "templates.sync", map[string]any{"version": local.Info, "reason": b.Reason}, request)
	if err != nil {
		return nil, err
	}
	ack, err := validateCatalogSync(confirmed.Result, *local.Info, c.AgentID, request)
	if err != nil {
		return nil, err
	}
	return struct {
		Action           string                `json:"action"`
		Request          string                `json:"request"`
		LocalVerified    bool                  `json:"local_verified"`
		LocalObserved    int64                 `json:"local_observed"`
		Local            *core.TemplateVersion `json:"local"`
		GatewayConfirmed bool                  `json:"gateway_confirmed"`
		Gateway          catalogSyncReply      `json:"gateway"`
	}{"sync", request, true, local.Observed, local.Info, true, ack}, nil
}
