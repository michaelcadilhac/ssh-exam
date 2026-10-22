package main

import (
	"encoding/json"
	"examworkspace/agent/internal/core"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"
)

func templatesHelp(out io.Writer) {
	fmt.Fprintln(out, `Usage: sudo examctl templates validate SOURCE [--file-mib N --total-mib N]
       sudo examctl templates install NAME SOURCE --expected HASH --reason TEXT [--request UUID]
       sudo examctl templates list [--name NAME --limit N --after NAME@HASH]
       sudo examctl templates show NAME HASH
       sudo examctl templates verify NAME HASH
       sudo examctl templates jobs [--limit N --after JOB_UUID]
       sudo examctl templates clean JOB_UUID --confirm JOB_UUID --reason TEXT

Native root-only immutable template catalog, offline from the gateway. Existing
legacy template directories and ALL attempts, grants, workspaces, submissions,
deadlines, account restrictions and monitoring remain unchanged. NO version is
automatically selected as latest or bound to any student. Current gateway-issued
snapshots remain legacy; optional native exact-version readers do not issue or
migrate grants. Installation is LOCAL ONLY:
gateway_confirmed=false, not proof that the webserver may issue a grant from it.
No installed-version deletion command is enabled.

SOURCE is a quiescent directory containing ONLY work/ and materials/. Keep all
instructor-private files/solutions outside it. Validation rejects links, hardlinks,
special files, nested mounts, unreadable materials, root work/MANIFEST.json,
depth >32 or >10000 entries per tree. Ordinary modes, precise mtimes and streamed
file hashes define the version. A fingerprint is not a hostile-writer freeze.
Stop author edits before validate/install; installation verifies its private copy.

First validate, review its info.hash, then install with that exact --expected
HASH and audited --reason (8..1000 UTF-8 bytes; no credentials/student text).
Changed source refuses. NAME identifies a template, HASH its exact version;
changed content creates another version and NEVER overwrites a previous one.
--request is an install UUID, new by default and printed before work starts.
Retain it and identical name/hash/limits/reason after a lost reply. Retrying an
installed version verifies it rather than recopying or replacing bytes.

Import/validation logical bounds: --file-mib defaults 128, range 1..4096;
--total-mib defaults 512, range 1..16384 and at least per-file. One MiB=1048576 bytes.
These bound source work AND materials, not live workspace quotas or an edit to
exam collection settings. A setting ceiling is NOT certified workload capacity.
The separate exam-template.slice must be loaded/bounded: 256 MiB aggregate, no
swap, 32 tasks; each job additionally has 120s runtime/group-wide kill. One flock
serializes bulk work independently of collection slots. Metadata reads bypass
that flock but share the bounded slice. No bulk IO or worker wait under state lock.
Absent pool/resource/runtime/storage failures refuse; never raise limits, clear
locks or restart an exam service to force installation.

list/jobs are bounded live metadata pages: default 50, range 1..200. Use next as
the exclusive --after cursor (NAME@HASH for list, UUID for jobs); keep --name
stable. They do not freshly hash all content or export question/student bytes.
show reads metadata; verify streams the installed exact version. Neither means
gateway confirmation. No source inventories/paths or permanent private payload
cache are returned. Root operations are audited in the separate private catalog.

After a crash, inspect jobs and list, then verify NAME HASH. A pending job may
have incomplete PRIVATE staging: never call it an installed version. An exact
retry adopts only a successfully published verified version. Otherwise explicitly
clean JOB --confirm SAME_JOB --reason TEXT, then use a NEW install --request.
clean removes ONLY that owned unpublished staging while excluding import workers;
it preserves job/audit receipts and every installed version. It is NOT workspace
cleanup or permission to remove unknown/orphan data. Repeating cleanup is safe.
An unrecorded job has unknown original intent: cleanup accepts only empty/private
temporary metadata, never an unknown content tree. Its tombstone stays visible
as unrecorded-cleaned; neither status means an installed or confirmed version.

Common --config FILE defaults to /etc/exam-agent/agent.json. No new authentication,
network listener, student password, ad hoc script or JSON editing is required.
Help/syntax validation needs no root/configuration; offline reads need the native
private state directory, not a running gate service. No production action implied.

Examples:
  examctl templates help
  sudo examctl templates validate /private/authored/midterm
  sudo examctl templates install midterm /private/authored/midterm --expected HASH --reason 'Reviewed immutable source package'
  sudo examctl templates list --name midterm
  sudo examctl templates verify midterm HASH
  sudo examctl templates jobs
  sudo examctl templates clean JOB --confirm JOB --reason 'Remove failed unpublished import only'

Exit status: 0 verified result/metadata or exact cleanup; 1 refusal/operational
failure; 2 invalid syntax. Publication/resource failures never change exam clocks.`)
}

func templatesMain(args []string) int {
	if _, help := helpRequest(args); help {
		templatesHelp(os.Stdout)
		return 0
	}
	f := flag.NewFlagSet("examctl templates", flag.ContinueOnError)
	f.SetOutput(os.Stderr)
	config := f.String("config", "/etc/exam-agent/agent.json", "root agent configuration")
	name := f.String("name", "", "list name filter")
	expected := f.String("expected", "", "reviewed source hash")
	reason := f.String("reason", "", "audited reason")
	request := f.String("request", "", "install job UUID")
	confirm := f.String("confirm", "", "exact cleanup job UUID")
	limit := f.Int("limit", 50, "metadata page size")
	after := f.String("after", "", "exclusive catalog/job cursor")
	file := f.Int64("file-mib", 128, "import source logical MiB/file")
	total := f.Int64("total-mib", 512, "import source logical MiB total")
	usage := func(message string) int { fmt.Fprintln(os.Stderr, message+"; run examctl templates help"); return 2 }
	if err := f.Parse(ordered(args)); err != nil {
		return usage("invalid template flags")
	}
	w := f.Args()
	if len(w) == 2 && w[1] == "help" {
		templatesHelp(os.Stdout)
		return 0
	}
	if len(w) < 2 || w[0] != "templates" {
		return usage("choose validate/install/list/show/verify/jobs/clean")
	}
	seen := map[string]bool{}
	f.Visit(func(flag *flag.Flag) { seen[flag.Name] = true })
	allowed := map[string]bool{"config": true}
	allow := func(keys ...string) {
		for _, key := range keys {
			allowed[key] = true
		}
	}
	b := core.TemplateCommand{Action: w[1]}
	ref := regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)
	hash := regexp.MustCompile(`^[a-f0-9]{64}$`)
	switch b.Action {
	case "list", "jobs":
		allow("limit", "after")
		if b.Action == "list" {
			allow("name")
			b.Name = *name
		}
		if len(w) != 2 || *limit < 1 || *limit > 200 {
			return usage("metadata pages need no positional target and --limit 1..200")
		}
		b.Limit = *limit
		b.After = *after
		if b.Name != "" && !ref.MatchString(b.Name) {
			return usage("invalid template name")
		}
		if b.After != "" && ((b.Action == "jobs" && !managementUUID.MatchString(b.After)) || (b.Action == "list" && !regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}@[a-f0-9]{64}$`).MatchString(b.After))) {
			return usage("list cursor is NAME@HASH; jobs cursor is JOB_UUID")
		}
	case "show", "verify":
		if len(w) != 4 || !ref.MatchString(w[2]) || !hash.MatchString(w[3]) {
			return usage("show/verify requires NAME and exact 64-hex HASH from templates list")
		}
		b.Name = w[2]
		b.Hash = w[3]
	case "validate", "install":
		allow("file-mib", "total-mib")
		sourceIndex := 2
		if b.Action == "install" {
			allow("expected", "reason", "request")
			sourceIndex = 3
			if len(w) != 4 || !ref.MatchString(w[2]) || !hash.MatchString(*expected) {
				return usage("install requires NAME SOURCE --expected HASH from validate --reason TEXT")
			}
			b.Name = w[2]
			b.Hash = *expected
			b.Reason = strings.TrimSpace(*reason)
		} else if len(w) != 3 {
			return usage("validate requires one authored SOURCE directory")
		}
		if *file < 1 || *file > 4096 || *total < *file || *total > 16384 {
			return usage("source logical limits need file 1..4096 MiB and total>=file, at most 16384 MiB")
		}
		var err error
		b.Source, err = filepath.Abs(w[sourceIndex])
		if err != nil || b.Source == "/" {
			return usage("SOURCE must resolve to an exact non-root directory")
		}
		b.FileMiB = *file
		b.TotalMiB = *total
	case "clean":
		allow("confirm", "reason")
		if len(w) != 3 || !managementUUID.MatchString(w[2]) || *confirm != w[2] {
			return usage("clean requires JOB_UUID --confirm SAME_JOB_UUID --reason TEXT; only unpublished staging is eligible")
		}
		b.Job = w[2]
		b.Reason = strings.TrimSpace(*reason)
	default:
		return usage("unknown template workflow; installed-version deletion is not enabled")
	}
	for key := range seen {
		if !allowed[key] {
			return usage("--" + key + " is not valid for this template workflow")
		}
	}
	if (b.Action == "install" || b.Action == "clean") && (!utf8.ValidString(b.Reason) || len(b.Reason) < 8 || len(b.Reason) > 1000) {
		return usage("provide an audited --reason of 8..1000 UTF-8 bytes")
	}
	if seen["request"] && !managementUUID.MatchString(*request) {
		return usage("--request must be the install job UUID")
	}
	if os.Getuid() != 0 || os.Geteuid() != 0 {
		fmt.Fprintln(os.Stderr, "Template management requires real/effective root on the class server. Run sudo examctl with identical arguments; help needs no privilege.")
		return 1
	}
	c, err := core.LoadConfig(*config)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Cannot load root configuration %q: %v; inspect --config FILE and templates help\n", *config, err)
		return 1
	}
	id := *request
	if id == "" {
		id = core.ManagementID()
	}
	fmt.Fprintln(os.Stderr, "Template operation/job request ID:", id)
	result, err := core.TemplateCall(c, b, id)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		fmt.Fprintln(os.Stderr, "Inspect examctl templates jobs and list; no student state or clock was changed. See templates help for exact retry/cleanup.")
		return 1
	}
	if err := json.NewEncoder(os.Stdout).Encode(result); err != nil {
		fmt.Fprintln(os.Stderr, "Write template metadata result:", err)
		return 1
	}
	return 0
}
