# Proposed TODO rollout, migration and rollback

**Proposal only; not executed. The instructor's latest October 21 instruction
revokes the earlier conditional csc-sys deployment authorization. Do not deploy
at the end of this work or execute temporary-service consolidation.**
This is a handoff plan for the local commits in todo-progress.md. Any future
separately authorized rollout requires a verified safe drain, private backups,
actual topology and mixed-version compatibility. Never interrupt exams, edit
student records or perform unsafe cleanup. Incident receipts are historical
evidence only; no production cutover/consolidation has been executed.

## Release scope and gates

October 21 monitoring correctness increment adds no schema/policy change: late
legacy recording callbacks obey tombstones, direct bounded replay refuses deleted
bytes, and startup/hourly retention failures are contained/redacted so they cannot
crash the gateway or skip other attempts. Physical purge failure is not an erasure
receipt; keep tombstones for retry. Drain all old transports before any future
downgrade to a writer that can recreate deleted files, and preserve deletion
records/retention through every backup restore. An older gateway also loses the
retention-error containment. Full monitoring CLI/shared intents/isolated purge
remain open. See monitoring-retention-fixes.md; no rollout is executed.

The restored-orphan read follow-up makes all legacy media/aggregate review honor
retained tombstones even with older restored bytes/rows. Protected manifest access
remains independent. No migration/policy change; a downgrade loses these guards,
so restore consistent files/ledger only after drain or retain a compatible reader.
C1gb2 now wires the candidate purge foundation into deletion/retention/lifecycle
callers with additive migration 017. Preserve job rows, first tombstone times and
the persistent monitoring-purge.lock inode in consistent private backups. Validate
Linux/procfs/util-linux, single-gateway topology, private storage and aggregate
memory/IO capacity before any separately authorized rollout. Jobs may outlive
retired preparation rows; never cascade/delete them to clear pending status.
Verification is timestamped current-directory absence, not backup/secure erasure.
An older gateway loses isolation/status and resumes synchronous recursive purge;
rollback requires drain and a compatible ledger/job-preserving plan, never an old
DB snapshot over newer deletion records. CLI delete/shared intents/full export
remain open. No migration or purge was executed on production; see
monitoring-purge-isolation.md.

C1gb3 adds additive migration 018 metadata-only deletion intent receipts and
shared reviewed web/root deletion. Pair gateway/browser/native CLI, explicitly
authorize monitoring.delete separately from reads, and retain 018 receipts with
017 jobs/tombstones. Boolean-only old web clients refuse and must reload; older
CLI/gateway do not support this workflow. Exact retries/new-parent child retries
must not requeue or reset backoff. A failed parent result remains durable; inspect
current status before a deliberate new parent/intent. Do not roll back to an old
database over newer deletion records or infer physical completion from acceptance.
Full media export/retired-job inventory and aggregate capacity remain open. This
does not authorize production schema changes, deployment or service consolidation.

C1gb4 adds additive019's status index and metadata-only purge inventory through
shared administrator HTTP and root CLI. Explicitly authorize monitoring.purges/
monitoring.purge only where needed; private-media read permissions do not imply
those new reads. Preserve tombstones/jobs even after attempt retirement. Retain
metadata request snapshots and use NEW request IDs for fresh status; none is a
secure-erasure receipt. A compatible rollback may leave the additive index but
must coordinate older configuration allowlists/gateway/CLI and keep all ledgers.
No production migration or operation was executed.

The local image-read follow-up needs no schema or configuration migration. Check
Linux/procfs and existing private monitoring directory ownership/modes; verify
normal full/thumbnail review, links/FIFOs/oversize refusal and deletion races in
the isolated candidate. An older reader loses these protections; retain a
compatible reader rather than restoring private bytes/clearing tombstones to
make errors disappear. Original upload bounds stay 1,500,000 bytes; thumbnail read
bounds are 2 MiB. This is bounded async IO, not worker/hardware-failure isolation.
No production permission edits, rollout or deployment are performed here.

The root CLI output-order follow-up needs no migration or new permission. Pair
normal gateway/CLI versions, retain exact request/child intents and require
nested target/intent/status validation before output. Only fully validated partial
clock batches print scoped JSON with exit1; malformed/private mismatches emit no
stdout. Older CLI rollback loses this defensive ordering; it must not justify
acting on a mismatched review. The collection measurement correction changes only
test assertions to inspect live kernel controls, not worker limits; account for
kernel/whole-host headroom rather than advertising an exact peak-byte guarantee.
C2a0/a1 remain unwired primitives, not installed template/version/grant management.
Future publication/migration and coherent retained-SSH changes require their
separate acceptance gates before becoming release scope.

C2a2 now adds a local candidate immutable catalog/CLI; it does not bind student
readers or confirm versions to the gateway. Before any separately authorized
rollout, qualify the exact artifacts in the disposable privileged guest on an
idle host; the current csc-sys precheck has two live/unresolved attempts and must
refuse testing, never reconcile them as test setup. Install the separate bounded
exam-template.slice only during that future authorized maintenance workflow;
absence refuses template operations, not student admission. Preserve the entire
template-catalog versions/jobs/audit and persistent worker.lock inode in consistent
private backups. No SQL migration, legacy directory rewrite or automatic version
selection/deletion accompanies this increment. Rollback must first drain template
workers; leave the additive catalog intact and keep a compatible inspection/
cleanup CLI rather than deleting its receipts or pretending legacy readers are
version-bound. Later all-reader/grant migration changes rollback requirements and
must have a separate coordinated plan. Nothing here reloads or installs a unit.

C2a3 adds optional native exact-version readers but no gateway issuance or SQL
migration. Legacy omitted-field settings/receipt hashes remain unchanged. Before
ever issuing a versioned snapshot, require the matching native capability,
root worker entry and separate bounded template slice; qualify real preflight/
Begin, multiple normal/admin panes, welcome, restart and missing/damaged sources
in the disposable privileged guest. Preserve catalog plus all versioned attempt/
receipt/archive metadata in consistent backups. After any versioned attempt
exists, **do not downgrade to an old state writer**: it can silently discard the
new hash and select mutable legacy sources. Use a compatible reader/writer or
roll forward after drain; never erase/rewrite history to make rollback work.
Old unversioned attempts retain their old semantics. Gateway confirmation/grant
migration needs its own future coordinated scope; nothing is deployed here.

The sign-in message correction leaves the existing five-starts/account/exam/
60-second limiter unchanged. It reports a bounded wait and continuing clock,
without retaining/retrying credentials or bypassing approval/holds. No schema
migration or policy change; old gateway rollback loses this diagnosis only.

C1ga adds shared bounded monitoring metadata/replay and transient read receipts,
without a schema migration. Pair gateway/CLI and explicitly authorize only needed
monitoring.show/list/replay operations; default is none. Keep tombstones/request
metadata through rollback. Current browser already uses incremental replay; the
legacy no-offset route now refuses oversized/partial batches with reload/cursor
guidance. An older gateway loses these bounds. Full export/shared deletion intents/
isolated purge remain open; see monitoring-cli.md. This is a future proposal only.

Candidate local changes: durable alert episodes/editor-lock notification policy;
renewal/deadline/admin-action races; unopened-preflight cleanup; recovery ordinary
file modes/available mtimes; native examctl help/refusals/audited exports; and
on-demand secondary terminal replay. The editor-lock notification suppression is
an intentional requested policy change; omissions remain in manifests. All other
security/timing/recording/retention restrictions remain in force.

October 21 native increment adds process-isolated collection, manifest/export/
access verification and short fenced state commits; see
collection-worker-isolation.md. Before including it, qualify privileged SSH/PTY
and workload behavior, install the bounded exam-collection.slice and coordinate
all native finalizers. Old/new finalizers must not run together: old code does
not honor the new per-attempt locks. Preserve state/archives, drain every old
collector and end all worker jobs before cutover or rollback. This does not raise
archive ceilings or implement grants/retained SSH/manual cleanup by itself.

Do not bundle unfinished unified grants or full authenticated management into
this release: C1/C2 are design-approved, not implemented/qualified release artifacts.
C3 retained SSH with a verified freeze and C4 manual workspace cleanup with no
grace period are also design-approved as of October 21, but unimplemented/
unqualified and outside this release. C5 also approves new grant webcam/Begin
policy, including windows outside the exam default; it is not implemented or a
retroactive production grant change. C6 now has a local configurable 128/512 MiB
implementation and real default-size worker/restore qualification; full
privileged/concurrent storage qualification remains an open release gate (see
collection-limits.md). C7 selects explicit new-attempt recovery from verified saved work
with instructor-chosen allowances, no automatic refunds or reopening completed
attempts; implementation/qualification remain pending. C8 approves deleting only
unused definitions and archiving definitions with history, preserving attempts
and submissions; implementation/investigation remain open. C4 does not
authorize deleting existing workspaces now.

C4a adds local known-attempt workspace metadata and audited revision-fenced hold/
release controls only. No fresh worker eligibility proof or deletion is enabled.
Preserve State/workspace-retention, workspace-retention.initialized and every
workspace-retention-ATTEMPT.known marker together with state/audit in private
consistent backups and any separately authorized rollback. Missing known data
fails closed, never implicitly released. Older unrelated state.json saves do not
discard these files; this does not authorize mixing native finalizers. No folder
is removed on upgrade, downgrade, hold release or deadline expiry. C4b/c proof/
cleanup, unknown-orphan workflow and privileged qualification remain open. See
workspace-retention.md; all rollout/deletion execution remains unperformed.
No new root API/listener, account override, historical attempt transfer or automatic
workspace deletion is part of these changes. CLI management remains incomplete;
see examctl-workflows.md and todo-design-decisions.md for honest coverage.

Before release: repeat all local checks on the chosen revision, qualify metadata
restoration and signed renewal receipts on disposable privileged accounts with
the real watchdog, and verify recovery-grant compatibility. Private work-staging
process-death/restart is tested locally; full initialization/ENOSPC/privileged
repair qualification remains open. Do not advertise every boundary as solved.
Confirm the artifact's recorded compiler/runtime versions and checksums. Build
versioned gateway/native artifacts without changing the running services.

## Drain and backup evidence

1. Obtain a separately authorized window. Prevent new admissions through the
   existing agreed maintenance procedure; maintenance alone is not a drain.
2. Enumerate every attempt via dashboard and native `examctl list`/`info`, not
   merely current ACTIVE rows. Require zero active/paused intervals, real
   preparations, live PTY bridges, pending timing changes/acknowledgements and
   unresolved collection/access-policy restoration. Keep never-claimed grants
   intact. A protected bundle alone does not prove writers stopped or access
   released. Confirm deadlines and native policy journals; use supported
   reconciliation only where eligible, never emergency overrides as shortcuts.
3. Verify every relevant source archive/manifest/checksum and outstanding grant
   or consumption marker. Record baseline current/original deadlines, revisions,
   settings, policies and callback sequences in protected operator evidence.
4. Consistently back up stopped gateway SQLite/WAL/files and deletion ledger using
   deployment.md, plus native state/initialized marker, per-UID policy journals,
   timing/reset records, lease/nonces/events, trust/config, protected bundles,
   workspaces and recovery grants/one-use/publication markers. Store privately;
   follow monitoring retention. Never copy only a live metadata.sqlite file.

## Migration and coordinated install

Migration 012 adds alert_episodes and its active-episode index. It neither rewrites
attempt history nor re-enqueues historical mail. Back up first, apply through the
normal gateway startup migration, verify schema and preserve outbox/audit data.
Do not drop this table or reset episode/outbox rows on rollback. There is no
unified-attempt uniqueness migration, grant conversion or workspace cleanup here.

Migration 013 adds management nonce/request/outcome records only. Preserve them
on rollback; do not clear acknowledged intents to force a retry. C1a implements
only signed definition reads; named managementOperations authorization defaults
to none. Matching gateway and native CLI are required, with no new class-server
listener. See agent-management.md. Verify actual gateway topology/scope before
coordinating a gateway cutover; csc-sys authorization alone is not silently
expanded to deploying on another host. This is not complete management or grants.

M1/C1d adds shared notification metadata/test/manual-reminder workflows and
migration 015's reminder linkage/successful browser-intent records. Authorize
only required alerts.* operations; preserve episode/outbox/intent/audit history.
Queue acknowledgement is not delivery. No automatic reminders, recipient
overrides or exam permissions are introduced. Reload old browser clients because
test now requires a request ID. An older gateway cannot cancel new reminders on
episode resolution; quiesce mail delivery and reconcile pending reminders with
compatible tooling before any separately authorized downgrade. Do not erase
rows or reset tries to force resend. See alert-management.md; no rollout executed.

C1e adds attempt/clock CLI metadata and shared synchronous clock staging, without
a schema migration or alternate native control route. Keep migration 007/013
requests, actor/target IDs, revisions and original/current intervals through
rollout/rollback. Matching browser/gateway are essential: default resets now bind
the displayed/reviewed allowance and reject stale or missing amounts. Old clients
must reload; an old gateway could discard the new expectedSeconds and recompute
another amount. Do not downgrade with new confirmations or pending intents unless
the amount/retry/deadline fences remain verified. No automatic refund, completion
reopen, hold release or old-history rewrite. Qualify signed pending delivery and
partial retries, not just root queue acceptance. See attempt-clock-management.md.

C1f adds shared interruption review/authorization and migration 016's conditional
review counters/successful intent ledger, not new SSH execution permission. Keep
matching gateway/browser/CLI, counters/triggers, 013/016 receipts and tombstones.
Old empty-body approval clients must reload. Private read receipts contain only
metadata; retries re-read unchanged retained data or refuse, never replay deleted
text. An older gateway cannot uphold the reviewed-generation/counter fence, even
with the triggers retained. Quiesce authorization/admission and live clients
before any separately authorized downgrade, or repair forward; do not overwrite
newer approvals/deadlines/deletion tombstones with an old DB backup. See
interruption-management.md. Retained-SSH C3 and deployment remain unimplemented/
unexecuted respectively; approval alone never thaws native work.

C1b adds shared conditional definition create/update and migration 014's browser
intent ledger. Preserve both intent ledgers on rollback. Older settings clients
must reload to obtain revisions; unversioned overwrites now refuse instead of
silently replacing newer settings. Partial CLI updates preserve omitted values;
no historical attempt/default-clock rewrite is part of migration. Definition
retirement is not enabled: native-only legacy grant dependencies need migration/
visibility first. No C8 history deletion or grant cancellation is authorized by
configuration writes.

C1c adds shared roster/CSV CLI workflows without another schema migration.
Authorize only required students.* operations and preserve preview consumption,
UID-verification and management-request records. Existing active snapshots,
deadlines and holds do not change on import/settings/removal. Consumed-preview
retry after expiry is intentionally accepted as a no-op, not new admission.
See roster-cli.md. Enrollment and native/unified grants remain distinct until
the approved migration; do not claim definition retirement is safe yet.

C6 requires matching gateway/native capability `collection-limits-v1` before new
admission. New preparations explicitly freeze both limits; legacy absent native
fields remain 32/64 MiB and old private receipt hashes stay unchanged. Do not
migrate historical settings or rewrite protected archives. Validate the private
State/Work mount layout: new production admission refuses tmpfs/ramfs, after a
real default-size tmpfs worker OOM. Any required storage move must be separately
planned after drain, with private consistent copies, exact checksums/ownership,
mount verification and reversible configuration; never move live student work.
Do not raise worker limits to hide storage accounting. Qualify real privileged
writers, simultaneous worst-case files/archives/restores, disk latency and free
space before inclusion. Old binaries may discard the new settings fields on
save and enforce old archive caps; prohibit mixed writers and downgrade only
when every remaining snapshot/bundle is demonstrably compatible, otherwise
preserve current state and repair forward. No storage move/deployment is executed.

Install matching gateway, connection-worker/browser receipt code and native
artifacts in the drained window. Native authenticated renewal refusals now carry
state without granting execution; older workers may lose this diagnostic detail.
Recovery extraction still verifies protected source bytes and strips privileged
bits. Older archives lack directory/ACL/xattr metadata; metadata restoration does
not invent it or rewrite the source. New ordinary modes/mtimes affect only newly
restored files, not previously initialized workspaces.

D1a adds private preflight work staging and mandatory production capability
`private-workspace-staging`, not a unified grant/schema migration. Deploy matching
gateway and every native writer only after drain/backup. Preserve workspace
receipts, private directories and legacy consumed markers. Old writers ignore
attempt/UID locks and discard receipt fields: never mix them. Existing started
attempts are not restaged or reset; unstarted preparations need successful staging
before Begin. Repair interrupted committed publication without reopening time,
then secure it through explicit finalization. Never downgrade an unresolved
publication to an old initializer that ignores receipts. See
private-workspace-staging.md for tests and remaining qualification. Broader
home/application initialization, legacy grant catalog/source dependency fences
and privileged real-SSH/workload gates remain open; do not deploy this increment
merely because unit tests passed.

D1b source-deletion guards and `recovery-grants` add no schema conversion and
delete nothing on install. Preserve catalogs/markers; quiesce manual legacy
issuers and coordinate every native writer because old code ignores catalog/
attempt locks and source dependencies. Do not downgrade source-deletion behavior
while outstanding saved-work authorities exist. Catalog visibility is not the
authoritative unified migration needed for C8 retirement. See
legacy-recovery-dependencies.md for qualification and constraints.

## Consolidate all three agent listeners (proposal only)

The canonical `exam-agent`, `exam-agent-live-upgrade` and
`exam-agent-deferred-recovery` may each own historical PTY bridges. Do not stop
**any** while those bridges may be needed, and do not mistake socket ownership
by one listener for proof that the other daemons are unused.

After the verified drain and backup, follow the installed-service procedure in
native-cleanup-isolation-incident.md: stop both temporary listener services, start
or restart the patched canonical service as appropriate to its recorded state,
remove the two temporary units and the `live-preserve.conf` preservation drop-in,
and reload systemd. Preserve the independent watchdog/reconciler and static
account/channel gates throughout; verify compatible watchdog code separately.
Do not kill by process name or restart SSH/relay services. Inspect scoped incident
helpers by their recorded identity; confirm they have exited or coordinate their
retirement, never revive obsolete approval/reset loops.

Confirm a single canonical command-socket owner, correct socket path/permissions,
no stale temporary listener, current recovery/lease/timing capabilities, callback
delivery and nonce continuity, watchdog/reconciler health, canonical boot enablement
and no temporary listener boot activation. Preserve recovery grants, consumed
markers, initialized workspaces, original archives and historical receipts.

## Post-install acceptance and rollback

Using controlled synthetic accounts in the authorized window: verify production
readiness and callback signatures; one delivered alert plus repeated unchanged
failure suppression; normal deadline finalization without a new incident; an
intentional admin action; exact deferred-start allowance and metadata-restored
saved files; source checksum immutability; normal original/current-deadline access
restrictions and credential cleanup; screenshot-first review and native CLI help,
diagnosis/refusals/export audit. Do not modify existing student records for smoke
tests. Verify all queues drain and compare protected baseline records. Reopen
admissions only after recorded acceptance; deployed status needs a new receipt.

Rollback requires a new verified drain, not merely switching files during active
exams. Retain compatible prior versioned artifacts and all **current** authoritative
data. Never restore old state over subsequent work, erase grants/consumption
markers, reset deadlines, remove protected bundles or recreate deleted monitoring.
Do not downgrade to code that ignores independent leases or treats saved-work
grants as fresh template starts. If no compatible rollback exists, remain fail
closed/in maintenance and repair forward. An older gateway may again duplicate
mail or mislabel renewal expiry; acknowledge that limitation without deleting
episode history. Existing restored files keep their modes/mtimes. Record the
chosen artifacts, checks and result privately; nothing here has been deployed.
