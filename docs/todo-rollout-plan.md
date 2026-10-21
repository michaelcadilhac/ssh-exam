# Proposed TODO rollout, migration and rollback

**Not executed. Requires separate production authorization and an agreed drain.**
This is a handoff plan for the local commits in todo-progress.md. It does not
authorize production commands, configuration changes, student-record edits or
exam interruption. Current incident receipts remain historical evidence only.

## Release scope and gates

Candidate local changes: durable alert episodes/editor-lock notification policy;
renewal/deadline/admin-action races; unopened-preflight cleanup; recovery ordinary
file modes/available mtimes; native examctl help/refusals/audited exports; and
on-demand secondary terminal replay. The editor-lock notification suppression is
an intentional requested policy change; omissions remain in manifests. All other
security/timing/recording/retention restrictions remain in force.

Do not bundle unfinished unified grants or full authenticated management into
this release: C1/C2 are design-approved, not implemented/qualified release artifacts.
C3 retained SSH with a verified freeze and C4 manual workspace cleanup with no
grace period are also design-approved as of October 21, but unimplemented/
unqualified and outside this release. C5 also approves new grant webcam/Begin
policy, including windows outside the exam default; it is not implemented or a
retroactive production grant change. C6 now approves configurable 128/512 MiB
defaults with unchanged entry/depth limits and mandatory collection crash
isolation; implementation/fault/storage qualification are pending and outside
this release. Other policy decisions and investigation remain open. C4 does not
authorize deleting existing workspaces now.
No new root API/listener, account override, historical attempt transfer or automatic
workspace deletion is part of these changes. CLI management remains incomplete;
see examctl-workflows.md and todo-design-decisions.md for honest coverage.

Before release: repeat all local checks on the chosen revision, qualify metadata
restoration and signed renewal receipts on disposable privileged accounts with
the real watchdog, and verify recovery-grant compatibility. Actual process-death/
ENOSPC initialization repair remains unqualified; do not advertise it as solved.
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

Install matching gateway, connection-worker/browser receipt code and native
artifacts in the drained window. Native authenticated renewal refusals now carry
state without granting execution; older workers may lose this diagnostic detail.
Recovery extraction still verifies protected source bytes and strips privileged
bits. Older archives lack directory/ACL/xattr metadata; metadata restoration does
not invent it or rewrite the source. New ordinary modes/mtimes affect only newly
restored files, not previously initialized workspaces.

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
