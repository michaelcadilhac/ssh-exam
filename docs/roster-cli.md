# Shared roster and CSV management — local implementation

October31/November1 UTC follow-up DEPLOYED (runtime63903bd, matching CLI): **Exam defaults** is explicit in the UI; Add students
has editable first-attempt dates. Both `students add` and `import-preview` accept
paired `--earliest/--latest` RFC3339 dates; omitted flags preserve inheritance.
Add optionally accepts `--definition-revision`. Explicit fields require the new
gateway capability and `students.list` authorization before mutation. CSV review
binds chosen dates/current definition/per-target rows; changed dependencies need
review again. Retained consumed previews retry idempotently; identical CLI request
IDs keep their durable outcome after the ten-minute preview pruning. Later web
retries need a fresh review. Existing permissions and
history stay intact. Verification/status: [enrollment-default-dates.md](enrollment-default-dates.md).
The dated implementation record below is historical.

October 21, 2026. Implemented/tested locally; **not deployed**.
RosterManagement is shared by web administration and root examctl;
neither interface edits active attempt snapshots, clocks or account restrictions.
Unified grants and full management are still pending.

Use `examctl web students help` (also `examctl help students`) for all workflows:

```sh
sudo examctl web students list midterm --limit 100
sudo examctl web students add midterm student01 --duration-minutes 120 --webcam optional
sudo examctl web students settings midterm student01 student02 --webcam inherit
sudo examctl web students import-preview midterm --file roster.csv
sudo examctl web students import-confirm midterm PREVIEW_UUID
sudo examctl web students export midterm --output ./roster.csv
sudo examctl web students example midterm
sudo examctl web students remove midterm student01 --confirm student01
```

Explicit gateway managementOperations authorization names each students.*
operation; default is deny. Authentication, purpose/audience/nonce, durable
request-ID retry and pinned HTTPS replies use the existing agent identity, not
browser cookies or student credentials. Use a new request ID for a refreshed
read or changed intent; a lost reply retries identical arguments with the printed
UUID. New enrollments always have unresolved UID=0 until trusted student SSH
verifies the account. No CLI/API-supplied UID becomes authoritative.

## Settings and history

Duration overrides use 1..360 whole minutes or `inherit`; exam-definition duration
flags separately use seconds. Webcam accepts required/optional/inherit. Add
defaults to inheritance. Settings changes only named fields for 1..1000 unique
students. Sandbox allowance remains five minutes or inheritance. These settings
affect future defaults, not current attempt clocks; fixed issued-grant behavior
will be handled by the pending unified-grant model.

Approved C17 additionally makes an explicit student allowance edit authorize
duration-only synchronization of an UNUSED native saved-work recovery grant at
the student's next authenticated preflight. For example:

```sh
sudo examctl web students settings retake student01 --duration-minutes 75
sudo examctl web students list retake
sudo examctl recovery-grants --exam retake
```

`recovery_allowance_edit` in student-list JSON records the saved revision, seconds,
actor and time. `inherit` captures the exam duration WHEN SAVED, not after later
default changes. Explicit supplied CSV duration (even an unchanged value) uses
the same authority; omitted duration/webcam-only/default edits do not. Existing
mismatches without an edit ledger require explicitly saving the intended duration
again; migration does not invent past approval. Root retry of a lost reply uses
the SAME request UUID so it cannot create another revision.

Native `allowance_revision` records applied provenance and
`pending_allowance_revision` is unpublished crash residue, not execution permission.
Retry latest settings through authenticated student preflight; do not delete or
hand-edit markers. Source/checksum/identity/creation/reason stay fixed. Prepared
or consumed grants refuse revision: inspect, positively cancel an unstarted
preparation, then sign in for a fresh preflight. Started attempts keep their
interval and cannot be refunded/reopened. See recovery-admission-consistency.md.

Removal requires a named CLI confirmation and removes enrollment only. It never
deletes attempts/submissions, cancels a native recovery grant, finishes work or
releases an original interval hold. As under the existing web workflow, inspect
active attempts/reauthentication needs before removal; enrollment may be needed
for a later login until the unified-grant admission model is implemented. History
and native authorization/collection enforcement remain independent.

## Import, preview and export

CSV supports username, require_webcam and duration_minutes; `--mode lines` reads
one username per line. File/stdin (`--file -`) input is bounded to 10 MiB and
1..10000 unique valid course usernames. Files are never executed. Omitted columns
preserve existing overrides; blank/inherit explicitly inherits. Preview shows
add/update/unchanged rows and active attempts whose snapshots will not change.
Confirmation refuses a changed roster or expired unused preview, and commits all
rows/consumption/audit atomically. Already-consumed previews remain successful
no-ops even after the ten-minute preview interval: this fixes a retry refusal,
not a reopening of unused previews or exam allowances.

CSV parsing yields outside SQLite transactions. After parsing, root management
rechecks authorization/freshness and records the confirmed preview/outcome. Signed
request/reply limits (12/16 MiB) cover the existing import workflow and pagination;
student list defaults to 100, max 200, with an exclusive username cursor. Root
validation receipts retain row/reason but omit raw invalid username values; web
diagnostics remain compatible. Do not log raw imports or credentials.

Export/example emit CSV, not JSON, to stdout by default; request IDs/diagnostics
go to stderr. `--output` exclusively creates a new mode-0600 file, never replacing
an existing file or symlink. Write/sync failures return failure and can leave a
partial new file; inspect it before retrying. Export retains CSV formula escaping
and deterministic username order. Native protected submission export is separate.

## Verification and rollout

302 application tests / 51 files pass with actual compiled root-mapped CLI and
real local gateway TLS workflows for all roster operations, imports/retry,
preservation, safe output and revocation. Signed HTTP regressions cover UID trust,
active snapshots, explicit inheritance, stale previews, atomic failed/duplicate
batches, sandbox limits, bounded pagination and safe validation receipts. Native
race checks with all local fault/CLI opt-ins, typecheck/build/vet/static build pass.
All 28 Chromium roster/interface/real synthetic SSH-cleanup checks pass (3.6m).
Generated screenshots were restored to baseline. All data/accounts/keys are
synthetic. No additional schema migration or
production records/config/services are changed by this increment.

Install matching gateway/CLI after safe drain/backup and authorize only required
named operations. Preserve request/outcome and preview-consumption records on
rollback; never remove them to force an import. csc-sys connectivity remains a
rollout prerequisite, not yet verified after jump/direct SSH timeouts. Legacy
native-only recovery grants still require unified migration/visibility before
safe definition archival or unused-only deletion can be completed. C17 adds
migration022 and native revision/source-hash fields; retain the edit ledger,
source expectations, receipts/counters and all native markers in consistent
backups/rollback. Never downgrade to a writer that drops these records or replays
an older allowance. This update is local only; current qualification is recorded
in recovery-admission-consistency.md, not the historical totals above.
