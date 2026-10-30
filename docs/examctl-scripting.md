# Shell scripting with examctl

October 29, 2026: generic scripting improvements. The instructor authorized
implementation, commit, push and deployment; this development task issues no
student grants. These extend the completed 38-item release. Current installed
versions and activation/rollback receipts are in
[examctl-scripting-deployment.md](examctl-scripting-deployment.md).

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
The revised repository script copies each student's **current effective midterm
duration and webcam setting**. Explicit enrollment overrides win; empty overrides
inherit the saved midterm definition defaults. These settings do not come from
the recovery/source attempt. Pure zsh writes the resolved seconds/boolean values
into `sources.csv` (saved work) and `starters.jsonl` (starter files), supplied
through `examctl --input`. JSONL is generated with zsh, not parsed. `defaults.tsv`
and `students.tsv` retain the captured source settings and exact starter version.

It still exports both exams' attempt histories and selects each enrolled student's
latest **started** attempt for saved files. By explicit October30 policy, students
with **no positive start timestamp** in either exam receive the pinned midterm
starter template. No history and cancelled/unstarted preparations qualify; no
old attempt, workspace or account hold is removed or reopened. Existing started
history with an ambiguous, missing-checksum or unprotected latest source still
refuses, with no starter/older-work fallback. Review and
confirmation freshly validate owner/checksum and eligibility; the export is not
an atomic snapshot. Enrollment edits before confirmation trigger the existing
stale-review refusal. Existing prepared reviews keep their original settings;
updating the script never rewrites or refreshes them.

The matched script and CLI are deployed together. The CLI now serializes
template/empty input using only its strict workspace-union fields; native
`templates sync` also honors the same protected CLI proxy settings as other
outbound management. No web/agent/schema change or service restart is needed.

The midterm definition must select an exact installed/attested template version.
The instructor approved the existing staff snapshot `sys1-midterm-a` version
`af76dd3a110aad9fc2277f93633f798fc80cee17157c2157293c11b2901c4341`
(31 files, 80,994 bytes). Source publication/selection is separately audited;
the script never chooses mutable/latest content or changes the definition.

Use `prepare DIRECTORY BEGIN_FROM BEGIN_UNTIL`, without a shared minutes argument.
Use a **new directory**, including after the former `no started attempt` failure;
preserve failed preparations and any existing review/confirmation receipts.

```zsh
sudo zsh /usr/local/share/ssh-exam/examples/second-go.zsh prepare \
  /root/midterm-second-go-20261030-starters \
  "$(date --iso-8601=seconds)" '2026-11-06T23:42:00-06:00'
# Inspect BOTH displayed groups, sources.csv and starters.jsonl before applying.
sudo zsh /usr/local/share/ssh-exam/examples/second-go.zsh apply \
  /root/midterm-second-go-20261030-starters
```

This is the requested window from command execution until Friday November 6,
2026 at 11:42pm America/Chicago (CST, UTC-06:00). Deployment itself neither
schedules nor issues grants: only the operator's prepare/review/apply does.
The cutoff governs **Begin**, so a student starting shortly before it receives
the full allowance and may finish afterward. Supply the actual finite Begin
window for future use; there is no shared allowance argument. `prepare` creates
a review only. `apply` confirms
that exact review and verifies each protected native source before making its
grant available. Each new attempt receives its full allowance only at actual
Begin; existing attempts, deadlines, holds and submissions stay unchanged.

Saved-work and starter groups use existing separate CLI reviews. `groups.tsv`
records which exist; `window.tsv`, `plan.version` and `plan.sha256` retain/check
the original settings/source selection. Saved reviews keep `review.receipt`,
`issued.receipt`, `synchronization.receipt`; starter reviews use
`starter-review.receipt` and `starter-issued.receipt`. Starter grants need no
saved-archive pin, while every saved grant still requires native source-sync
before availability. Neither kind consumes time or claims an account at issuance.

If a preview reply is lost, use `resume-review DIRECTORY`. It retries an existing
intent or creates a missing group's review from the original hashed plan; it
does not re-export/reclassify students or adopt new defaults. Changed/incomplete
plans refuse. If apply is interrupted
or a source acknowledgement is lost, repeat `apply DIRECTORY`. Preserve the whole
directory: its request IDs distinguish a retry from another grant issuance.
The two groups are not one atomic issuance: failures can leave one confirmed or
available and another pending. Inspect the receipts and repeat **apply in the
same directory**; never use a new preparation to retry an unknown confirmation.
Old saved-only review directories retain their original scope and arguments;
upgrading never retroactively adds starter students to them. If an old preparation
failed before creating a review, choose a new directory rather than deleting it.
Confirmed policy refusals stay refused. Inspect `issue-show --from-receipt
REVIEW --format table`, repair the cause, and deliberately create a new reviewed
intent where appropriate. An expired review cannot be renewed by replaying it.
For a partial source-sync refusal, inspect each grant/pin; do not blindly issue
another batch. The original single-grant `source-show/source-sync GRANT --revision
N` workflows remain available for deliberate repair and source retirement.
For either group, `examctl web grants issue-show --from-receipt REVIEW --format
table` inspects it; the matching `issue-cancel --from-receipt REVIEW --receipt
CANCEL_RECEIPT` cancels only an unconfirmed review. Confirmed grants need their
normal explicit revoke workflow and saved-source retention rules.

## Generic data and input contracts

The separate [offline midterm grading example](offline-midterm-grading.md) reuses
these exports and native protected-export to write a reviewable CSV. It runs the
supplied grader in disposable bwrap sandboxes, with zero for no submission and
separate error reports. No application grading service or student-record edit is
introduced. Its qualified script/helpers are installed on csc-sys under
`/usr/local/share/ssh-exam/examples/` by separate instruction. The instructor
rejected Docker: grading uses bwrap and transient resource limits, with direct
`run --local DIRECTORY` on the class server or remote SSH mode. No real submissions
have been graded during development/installation.

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

Seven focused real-process signed TLS regressions, actual root-mapped zsh → gateway →
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

Installed read-only verification exposed a zero-row export defect: a nil slice
was mistaken for an operation envelope, causing absent-field errors or a spurious
JSONL row. The actual CLI/TLS regression reproduced it, then passed for all five
formats with an explicit empty collection. Full CLI races, vet and actual gateway/
zsh qualification were repeated. This CLI-only fix changes no web/native contract;
the unchanged628 application/seven packaged-browser/image evidence remains valid.
Current deployment status is in the linked activation record.

The local midterm-profile script follow-up passes its real root-mapped zsh →
CLI → signed gateway → native-source workflow and all14 affected integration
checks, typecheck and zsh syntax. Explicit120-minute/no-camera and inherited
default profiles survive preview restart/retry and produce available verified
grants without claims or history changes, even when source-camera settings
differ. Enrollment edits still invalidate a pending review; no guard was relaxed.
CLI/server/native/browser code did not change, so their prior release evidence
still applies. Evidence: `var/collection-tests/midterm-profile-script.pckce5pl`.
This script revision is local only; the installed copy and existing reviews are
unchanged.
