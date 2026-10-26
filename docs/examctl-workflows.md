# Current examctl workflows

October26 current local workflow: saved-source issuance/source-sync and C7
new-attempt recovery are qualified through public CLI/web/student interfaces;
legacy native migration/retirement and destructive workspace cleanup remain.
Retained v1 interruption authorization preserves the original viable page/SSH:
explicit Continue requires fresh readiness and the existing scoped approval.
Actual SSH loss requires a reviewed NEW saved-work attempt with chosen allowance/
finite window, not reauth/claim of the original. Legacy recovery remains supported
on its original path. Release health requires matching native-loaded-role/v2;
no cached health is work permission. Exact local qualification, not deployment:
retained-release-qualification.md. Earlier staged status below is historical.

Local source update October 23, 2026; **not deployed**. Current coverage/source
audit and corrected global discovery: examctl-coverage-audit.md. Full web-management
coverage is not implemented yet; see the explicit inventory/decisions in
[todo-design-decisions.md](todo-design-decisions.md). The firm requirement is that
every supported management action has a supported CLI workflow, sharing authority,
validation, audit, revisions and idempotency with the web interface. No ad hoc
SQL/JSON edit or incident script is a supported replacement. Decision C1 is now
approved: root-run examctl on the class server will use the existing agent
authentication for outbound gateway management, with explicit operation
authorization and auditing. The signed protocol and `web exams list/show/create/update`
are now tested locally; reviewed retire-preview/delete/archive/unarchive for
lifecycle-tracked definitions is described in exam-retirement.md. Pre-existing
definitions refuse retirement until native reconciliation; full coverage remains
pending (see
agent-management.md). No browser-session login or extra CLI credential is required by the approved
design; browser administration keeps its current authentication.

Start with `examctl help`, then `examctl help COMMAND` or `COMMAND --help`.
Use `examctl help web` for gateway-owned definition reads and request-ID retry
semantics. Explicit gateway operation authorization defaults to none.
Every current definition setting also has a create/update flag; updates require
the current revision and preserve omitted fields, rather than resetting create
defaults. See exam-definition-management.md for both interfaces and migration 014.
Sandbox uses the same `web exams show sandbox`/revision-fenced `update sandbox
--earliest RFC3339 --latest RFC3339` workflow. C14's local candidate keeps practice
repeatable/five-minute/no-webcam but requires an explicit finite Begin window;
new installs start closed. Defaults never rewrite saved preparations or started
deadlines. Unified saved practice issuance is now an integrated candidate;
qualification and policy details are in sandbox-grants.md. No deployment.
Use `examctl help grants` or `examctl web grants help` for initial enrollment-time
snapshots, reviewed NEW legacy-unused initial issuance, reviewed additional
attempts, and paginated inspection/unused revision/revoke. Initial/additional
workflows are qualified locally; saved-source grants and complete legacy recovery
migration remain unfinished. Exact materials and writable initializer can differ:
`--work empty` or `--work template --work-template NAME --work-template-version
HASH`. Later defaults never revise issued grants. Review confirmation saves
authority; only fresh native Begin starts time. See initial-grants-cli.md and
additional-grants-cli.md for complete flags, finite windows, idempotent review/
request retries, protected history and supported cancellation/restoration guidance.
Collection setting flags are `--collection-file-mib` (default 128) and
`--collection-total-mib` (default 512), in logical MiB, not allocated/compressed
size. Existing preparations/attempts/bundles keep their snapshots; absent legacy
fields mean 32/64 MiB. See collection-limits.md before selecting larger values;
worker resource/time bounds do not automatically grow with an allowance.
`examctl web students help` now covers roster list/add/remove/settings and CSV
preview/confirm/example/export with shared validation, inheritance, UID trust and
historical snapshot rules. See roster-cli.md for units, limits and safe output.
`examctl web alerts help` covers shared delivery metadata, exact outbox inspection,
test and explicit revision/reason-fenced manual reminders. Queued is not sent;
desktop permission/sound are browser-local. See alert-management.md. No automatic
escalation or original episode/retry reset is introduced.
`examctl web attempts help` and `examctl web clocks help` now describe bounded
gateway inspection, individual reset/extend, default-allowance preview and explicit
bulk clock requests. Native application may remain pending; outer gateway
confirmation is not an effective deadline. Reviewed default amounts and per-target
request IDs fence edits/retries. See attempt-clock-management.md and final progress.
`examctl web interruptions help` covers private paginated history/student requests,
current approval inspection and reviewed generation/revision/reason-fenced
authorization. Exact retries retain expiry; private read caches contain metadata
receipts only and cannot replay deleted monitoring. See interruption-management.md.
Existing fresh SSH/readiness/Continue checks remain mandatory; no retained-buffer
freeze or automatic resume is implemented by gateway approval.
`examctl web monitoring help` adds shared bounded summary, watermark-paged frame/
terminal metadata and one-batch terminal replay. Private reads cache metadata
receipts only, recheck deletion and validate scope before printing/saving. Explicit
output is a new 0600 file or stdout, not a complete media export. See monitoring-cli.md
for byte cursors, privacy, offline limits and qualification. Local C1gb2/3 add
isolated durable purge/status and shared reviewed
`web monitoring delete ATTEMPT --confirm USERNAME --revision HASH --reason TEXT`.
Use show's deletionReview, retain the request/child intent for lost replies and
inspect fresh physical status separately. Local C1gb4 adds bounded `purges`
list/filter/pagination and read-only `purge-status ATTEMPT`, including retired
preparation jobs. These metadata outcomes are snapshots: NEW request for fresh
status, never a filesystem proof. Complete-copy export is described below; see
monitoring-purge-isolation.md and monitoring-cli.md.
The local C1gc1 candidate adds `web monitoring image ATTEMPT FRAME [--thumbnail]
--output NEW_FILE`, with separate monitoring.image authorization, the shared web
image reader/capacity, transient private-read receipts and scoped digest checks
before output. A listed frame must belong to the named attempt. Output is one
new0600 JPEG, never a complete export; downloaded copies require private operator
retention. See monitoring-cli.md for limits and current qualification status.
The local C1gc2 candidate adds `web monitoring export ATTEMPT --output NEW_DIR`:
separate monitoring.export authorization, a bounded purpose-signed stream,
originals/thumbnails/exact raw recordings/history, hashes and no-replace0700
private publication. Complete signed end plus clean EOF, successful flush and
exit0/confirmed:true are required. Failures retain private incomplete/unconfirmed
output and explain same-request retry with a NEW directory. Never concatenate
old partial copies. This is an observed inventory/prefix copy, not a globally
atomic exam snapshot, protected submission or permission to work. Downloaded
copies have independent operator retention. See monitoring-cli.md and
monitoring-export-plan.md for boundaries and current qualification.
The local native configuration candidate adds `config show` and `config validate
--config FILE`, with default path redaction and explicit --paths metadata. It
never initializes state, opens a control socket, reconciles holds/deadlines or
applies/restarts. Show needs no signing-key read; validate adds bounded pinned
key/optional-CA checks. Observe a separately staged file with --config, never
mistake validated:true for runtime readiness or applied configuration. See
native-configuration-inspection.md for limits/current qualification. Configuration
mutations/gateway configuration remain pending; no ad hoc edit workflow is added.
Help runs without root or installed configuration. Unknown commands, missing or
extra targets, missing reasons, invalid flags and ambiguous filters explain the
relevant help before attempting root/configuration access. Actual native
operations remain root-only. Exit codes: 0 success, 1 operational refusal, 2 usage.
JSON timestamps are UTC milliseconds; durations are seconds. List displays UTC
RFC3339 deadlines unless `--json` is selected. `--config FILE` works before or
after a command. List filters never silently constrain a mutation targeting a UUID.

An ordinary local diagnosis starts with:

```sh
sudo examctl list --read-only --active
sudo examctl list --read-only --exam midterm --json
sudo examctl info ATTEMPT --read-only
```

`info --read-only` distinguishes recorded state, original/current deadlines,
protection flags and account/policy/writer diagnostics, without proving current
permission or fresh archive integrity. Refusal reporting uses this same zero-write
reader, not legacy list/reconciliation. It preserves the original error/exit1,
prints bounded escaped diagnostic text and gives working read-only inspection
commands, retaining a nondefault configuration path. Explicit reconciliation is
separate and may mutate state; it is never needed merely to explain a refusal. Collection
recovery requires fixing the stated cause before an audited `retry`; a protected
bundle must never be overwritten. `reconcile` handles eligible state across all
attempts and may perform due collection/timing checks/restoration; it is not a
read-only dry run.

Resources have separate workflows:

- `templates validate/install/list/show/verify/jobs/clean`: separate bounded
  immutable local catalog, expected content hash, exact install UUID retries and
  explicit owned failed-staging cleanup. Results are not gateway-confirmed or
  selected for any student; current student readers stay legacy. No published-
  version deletion. See template-catalog.md for prerequisites, units and the
  distinction between local interface/resource tests and pending privileged
  system-manager qualification.
- `workspaces list/show/hold/release-hold`: local bounded known-attempt metadata
  and audited revision-fenced workspace holds. Candidate is not eligibility;
  no archive/writer/mount-use proof or deletion command is enabled. Missing known
  metadata fails closed, not released. See workspace-retention.md; original/
  current access restrictions and protected submissions do not change.
- `recovery-grants [--exam EXAM]`: read-only native legacy authorization catalog,
  consumed/uncertain history and recorded source state. Not new grant issuance
  or fresh archive verification. Source deletion refuses pending dependencies;
  see legacy-recovery-dependencies.md for exact safety/compatibility boundaries.
- `workspace-prepare ATTEMPT`: private pre-Begin staging without time/allowance
  consumption; normally automatic in preflight. `workspace-repair` completes an
  interrupted committed publication without reopening/resetting time, followed
  by explicit protected finalization. See private-workspace-staging.md.
- `cancel ATTEMPT --reason ...`: only provably unstarted preparation.
- `stop` / `finish ATTEMPT --reason ...`: irreversible protected collection of a
  started attempt, retaining original/current interval restrictions.
- `delete ATTEMPT --reason ...`: destructive protected-submission retention action
  after COMPLETED and actual access/policy release; retains attempt history and
  never deletes an exam definition.
- `override-access`: a separate, approved root emergency operation requiring
  verified protection/termination and a durable concrete reason. Never automatic.

Read each command's own help for prerequisites and examples. Release cannot be
made eligible by changing a deadline, deleting a marker or removing enforcement.
Every remaining writer/restoration failure must be reconciled. Native offline
state is authoritative locally; it does not claim the gateway received a callback.

`examctl help collection` explains supervised workers, bounded resources, pending
versus failed/protected status and repair commands. Stop/finish/retry can return
FINALIZING when a worker is busy; this is pending, never completion. Verification,
collection, termination/cleanup and release checks run outside the shared state
lock. Install the supplied bounded exam-collection.slice before enabling the new
production agent/watchdog/CLI; missing bounds fail closed. Do not mix old global-
lock finalizers with new per-attempt workers. See
[collection-worker-isolation.md](collection-worker-isolation.md) for exact limits,
safe cutover/rollback and remaining privileged qualification.

Protected retrieval is local, verified and durably audited before bytes are read
out. Export copies outside the global state lock, so a slow destination does not
block other students' deadlines:

```sh
sudo examctl manifest ATTEMPT
sudo examctl export ATTEMPT --output ./submission.tar.gz
```

The destination is a new 0600 file; existing files/symlinks are refused. I/O,
sync/close or audit failures report failure; inspect any partial destination
before retrying. Default export still emits binary tar.gz on stdout for existing
workflows, with errors on stderr. It never uploads archives to the gateway.

`agent status` inspects the shared gate. `agent stop/restart` can interrupt PTY
bridges and requires a fully drained authorized maintenance window; these actions
leave the independent watchdog/reconciler in place. Three live daemons may own
PTYs until the separately documented handoff consolidation. No service action
has been executed as part of this local development.

Process-level tests invoke the actual CLI entry point for every command's help,
usage errors, target/reason restrictions and unavailable configuration. Native
tests verify protected export, immutable bytes and refusal when audit persistence
fails. Create/import/clock/authorize workflows now have actual CLI/gateway tests;
saved-work grant migration, retirement/cleanup/configuration writes and current
exact-artifact root-host qualification remain pending. This document does not
imply CLI completeness or deployment. Current initial/additional/practice and
empty/separate-template workflows are supported; use examctl web grants help.
