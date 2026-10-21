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
