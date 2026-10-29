# Shell scripting with examctl

October 29, 2026: local qualification in progress. The instructor explicitly authorized
implementation, local commits, push and deployment. No new student grants or
record changes are authorized by this development task. The previous 38-item
release remains deployed; these are new scripting improvements.

## Bounded delivery plan

1. Deliver the zsh prepare/review/apply workflow through actual CLI processes:
   complete multi-exam exports; TSV/JSONL/CSV/table projections; private definition,
   review and operation receipts; confirm from the exact receipt; independently
   resumable saved-source synchronization. Preserve existing JSON interfaces.
   Acceptance: paginated/empty filtered pages export completely or fail before
   output; malformed/private/wrong-scope replies never escape; missing or unsecured
   latest work never silently falls back; lost replies and restart never reissue.
   Tests: focused CLI process/TLS/receipt/output regressions, then the real
   root-mapped CLI → gateway → saved-source lifecycle and zsh selector cases.
2. Complete reusable input/error/transport support: bounded stdin and explicit
   per-student settings, structured confirmed-refusal versus unknown-outcome errors,
   output-write failure handling, and protected CLI-local proxy configuration.
   Every helper must be used by a public entry in this milestone. No automatic
   latest-source selector, new credential/control service or live-state bypass.
   Tests: real input/refusal/repair/retry interfaces, shared web/CLI policy tests
   where the gateway changes, affected races/typecheck/build/browser checks.
3. Freeze validated artifacts, commit and push the intended branch; read-only
   production inventory, private backups and guarded deployment under the new
   authorization. Prefer CLI-only activation where possible; any required web
   replacement needs admission fencing and positive drain. Do not restart native,
   SSH or relay services for CLI-only changes. Verify installed help/read-only
   exports, signed readiness and preserved authority; no real student grant issuance.

Receipts are root-private metadata bound to the configured agent/origin/key and
exact operation/arguments. Persist mutation request IDs BEFORE sending. Unknown
outcomes retain those IDs; confirmed signed refusals require an explicit new intent
after repair. Read pagination uses fresh IDs. A local receipt never grants execution,
changes clocks, reserves accounts, releases holds or proves archive integrity.
Batch source synchronization is per-grant and reports partial outcomes honestly;
it must refuse changed/revoked sources rather than turn an intended retain into a
release. All new grants stay pending until native verification succeeds.

## Operator workflow

Run the same `examctl` on the class server as root. `examctl help scripting`
documents the added options; existing commands and default JSON output remain
compatible. No separate credentials are needed. The gateway still explicitly
authorizes and audits the existing agent identity.

The course-specific example is [examples/second-go.zsh](../examples/second-go.zsh).
It uses only zsh for selection. It exports the complete midterm roster and both
exams' attempt histories, then selects each enrolled student's latest **started**
attempt. A missing, ambiguous or unprotected latest source refuses review rather
than falling back to older work. Review and confirmation freshly validate the
owner/checksum and eligibility; the export itself is not an atomic snapshot.

```zsh
sudo zsh /usr/local/share/ssh-exam/examples/second-go.zsh prepare \
  /root/midterm-second-go 90 \
  '2026-11-02T09:00:00-06:00' '2026-11-06T17:00:00-06:00'
# Inspect the printed settings/sources and private sources.csv before applying.
sudo zsh /usr/local/share/ssh-exam/examples/second-go.zsh apply \
  /root/midterm-second-go
```

These dates are examples, not a scheduled exam. Supply the actual finite Begin
window and allowance you choose. `prepare` creates a review only. `apply` confirms
that exact review and verifies each protected native source before making its
grant available. Each new attempt receives its full allowance only at actual
Begin; existing attempts, deadlines, holds and submissions stay unchanged.

If a preview reply is lost, use `resume-review DIRECTORY`. If apply is interrupted
or a source acknowledgement is lost, repeat `apply DIRECTORY`. Preserve the whole
directory: its request IDs distinguish a retry from another grant issuance.
Confirmed policy refusals stay refused. Inspect `issue-show --from-receipt
REVIEW --format table`, repair the cause, and deliberately create a new reviewed
intent where appropriate. An expired review cannot be renewed by replaying it.
For a partial source-sync refusal, inspect each grant/pin; do not blindly issue
another batch. The original single-grant `source-show/source-sync GRANT --revision
N` workflows remain available for deliberate repair and source retirement.

## Generic data and input contracts

`web exams/students/attempts/grants list --all` follows every page, including empty
filtered pages. Repeated `--exam` selects multiple attempt histories. `--username`
matches one exact account; `--q` remains substring search. Use `--format
json|jsonl|tsv|csv|table`, `--fields username,start,id,checksum` and optional
`--no-header`. Fields use dot paths; explicitly absent fields refuse rather than
inventing values. Null TSV values are empty; controls are refused. Timestamps are
Unix milliseconds. `--output FILE` publishes a complete, private, non-overwriting
export; failure emits no partial stdout. Limits are 10,000 rows/32 MiB.

`--saved-sources FILE|-` accepts the existing CSV header
`username,attempt,checksum` (64 KiB/200 students). `--input FILE|-` accepts at most
1 MiB/200 students, with CSV columns `username,attempt,checksum` plus optional
`duration_seconds,require_webcam`, or JSONL such as:

```json
{"username":"example01","settings":{"duration":6000,"webcam":true},"work":{"kind":"saved","attempt":"11111111-1234-4234-8234-123456789abc","checksum":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}
```

Every selected student must have exactly one row. Saved sources must cover the
whole batch; empty/template work must use one shared explicit starter. CSV camera
values are true/false or required/optional. Per-student values override shared
choices explicitly; unspecified webcam requirements preserve effective enrollment
policy. The same optional individual settings are available in the instructor's
additional-attempt review dialog. Neither path edits exam defaults or old grants.

Receipts use version 1, private owned 0700 parent directories and regular 0600
single-link files. They preserve original wire arguments across restart, validate
context/result scope, and publish atomically without replacing another intent.
Concurrent access refuses with an actionable busy error. `--error-format json`
emits code, outcome, request and retry guidance on stderr. Exit 0 means success,
1 an operational failure/refusal, 2 invalid usage. A failed output write can follow
a completed mutation: inspect its receipt before retrying. A confirmed receipt
is a historical result, not fresh authorization or current monitoring evidence.

## CLI-only outbound proxy

An optional `examctl.json` beside the selected `agent.json` supplies this CLI's
proxy without relying on sudo preserving environment variables:

```json
{"https_proxy":"http://proxy.is.depaul.edu:3128","no_proxy":"localhost,127.0.0.1,::1"}
```

Use root-owned 0600 in a root-owned 0700 directory. Explicit HTTPS_PROXY/NO_PROXY
environment values take precedence. Only HTTP(S) proxy origins without embedded
credentials are accepted; TLS verification, fixed callback origin, signed replies
and operation authorization remain mandatory. This does not alter the agent's
configuration or require a native service restart.

## State review and qualification

Local receipts/exports are metadata only: inspection, locking, expiry, crash and
restart cannot reserve an account, start time, consume a grant or release a hold.
Unknown requests retry with the same persisted identity and original wire body;
signed refusals require a new deliberate intent. Reviews retain existing server
expiry/cancellation/revision validation. Source synchronization persists all
per-grant acknowledgement identities before any pin/callback, verifies each fresh
signed plan, and refuses changed/revoked authority without converting retention
into release. Pending grants remain unavailable until durable native confirmation.
An expired/consumed/changed review cannot bypass ordinary admission/Begin checks.

Six focused real-process signed TLS regressions, actual root-mapped zsh → gateway →
native protected archives, and shared web per-student settings tests pass locally.
They cover empty pages/no partial exports, unsafe/private metadata, stdin,
projection/output failure, lost preview/confirmation/source replies and restart,
partial corrupt-source repair with stable identities, no duplicate issuance,
revocation never releasing pins, unchanged history/claims/clocks, and explicit
individual settings. Root mapping does not qualify SSH/PAM/cgroup enforcement;
that runtime/protocol is unchanged and retains its existing release evidence.

Full application/integration qualification passes 628 tests in 111 files (including
the root CLI opt-ins), plus full CLI races, affected native source/transport races,
typecheck/vet/native and application builds. Seven affected browser workflows pass
against exact image assets. Image startup/schema24→33/packaged assets
pass in a disposable production-maintenance container. The initial new fixture
publication race and browser label locator were corrected and their focused checks
passed before broader reruns. A combined image-browser run passed five workflows
then reached the unchanged five-per-minute instructor login limit; the other two
passed in a fresh isolated fixture. Failure contexts/logs are retained. None of
these fixture corrections required a product-policy change.

Deployment and final verification remain pending. No new code is deployed yet.
