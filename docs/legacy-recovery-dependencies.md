# Legacy saved-work visibility and deletion safety

Local source update October 21, 2026; **not deployed**. Unified grant migration
and C8 definition retirement are still pending. This increment closes a confirmed
native retention bug: a released source submission could previously be deleted
despite an unused native-only recovery authorization depending on it.

## Supported inspection and refusal

```sh
examctl help recovery-grants
sudo examctl recovery-grants
sudo examctl recovery-grants --exam EXAM
sudo examctl info SOURCE-ATTEMPT
sudo examctl manifest SOURCE-ATTEMPT
```

The root CLI reads a bounded catalog outside shared state. It never starts an
attempt, edits a grant/marker, hashes an archive or reconciles account policy.
`unused` means no observed committed start/consumption marker. `consumed` binds a
marker to matching exam/account/UID/allowance, committed original interval and,
when present, exact staged source/authorization receipt. `uncertain` preserves
conflicting/missing history or the interval-before-marker crash boundary; it
never authorizes another start. `source_recorded_protected` is explicitly metadata,
not fresh integrity verification. Use `manifest` for the latter.

Native submission deletion through both root interfaces now refuses unused or
uncertain dependencies, and any unfinished restored attempt. Once the matching
consumer is completed, this particular dependency is closed: explicit source
retention may proceed if its own access/retention prerequisites hold. This does
not automatically delete anything, reopen the grant, cascade into the consumer's
submission or erase either historical attempt/checksum/consumption marker.
An explicitly previously deleted consumer bundle does not recreate a dependency
or make that consumed allowance reusable.

Unknown/malformed records, orphan/invalid markers, links, special files, unsafe
ownership/modes and excessive catalogs fail closed. Errors name validated exam/
account identities where available, not raw malformed contents. Preserve the
catalog/history for diagnosis/migration; never remove a marker or rewrite an
interval to force deletion. Limits: 10,000 records/exam directories, 20,000 files,
16 KiB/record, 36 bytes/marker, 16 MiB total record metadata. Large catalogs need
bounded migration, not silently skipped dependencies.

## Serialization and compatibility

Deletion owns the source-attempt and persistent catalog flocks while a bounded
OS worker verifies dependencies outside shared state, then uses a short final
eligibility/delete commit. Failed/invalid worker replies never permit deletion.
Saved-work Begin/repair shares the catalog lock across its consumption/publication
commit; staging already holds the source-attempt lock while verifying/copying.
Lock acquisition is nonblocking and never waits inside shared state. Busy catalog
means inspect/retry, with no new interval consumed and no account override.

**Legacy manual issuance/editing must be quiesced during deletion or migration.**
Old root filesystem writers do not participate in these locks; no protocol can
fence arbitrary concurrent root edits. Do not mix old/new native writers. This
read-only catalog is not a supported new legacy-grant creation/revision/removal
workflow and does not replace the approved unified management implementation.
The original separate-recovery runbook remains historical compatibility guidance,
not permission to create new authorities through ad hoc edits during this work.
Gateway retirement cannot infer complete native grant migration from this CLI
view alone; C8 stays disabled until authoritative migration/synchronization.

October25 follow-up investigation (NOT completed migration): current native
recoveryReference explicitly refuses an initial unified grant while a legacy
saved-work record exists. Deleting the JSON is unsafe: absence can select starter
initialization. A supported reviewed retirement/replacement must preserve the
original record/consumption history and make old admissions fail closed. The catalog identity discrepancy below is now reproduced/fixed locally; reviewed
migration remains open. An unused label alone must not authorize retirement or
clear C8's native fence.
The exact transition, crash/retry proof and CLI/web integration remain to implement
and qualify after the current liveness increment; this proposal closes no TODO.

## Verification and rollout

Tests exercise native/administrator deletion refusals, corrupt/unsafe/uncertain
catalogs, actual private staging/Begin/collection followed by explicit source
retention, unchanged child archives/markers/history, catalog/Begin serialization,
real malformed worker replies, and read-only catalog snapshots. The actual root-
mapped examctl process is tested for listing/filtering and held-source refusal
guidance using synthetic local files/keys. Namespace tests are not host-root PAM
or production qualification. No production submissions/records were read/deleted.

Install matching native writers/finalizers in a verified drained/backup window,
preserving catalogs and consumed markers. No schema conversion or deletion is part
of installation. Older code lacks these dependency/lock checks; do not downgrade
while saved-work authorizations exist or resume its source-deletion workflow.
See todo-rollout-plan.md for all services, backups and repair-forward constraints.

## October26 catalog identity correction (implemented/tested locally)

`examctl recovery-grants --exam EXAM` now uses the same exam/UID/committed-start
fence as native Begin when a consumption marker is absent. An interval since grant
issuance under the same UID but an earlier username is `uncertain`, never `unused`.
This is conservative inspection consistency, not authorization to retire/reissue
or a declaration of matching consumption. Marker-bound `consumed` still requires
its complete existing identity/interval/source proof. Other exams/UIDs, starts
before issuance and genuinely unstarted preparations retain their prior labels.

The actual root-user-namespace CLI and privately staged saved-work/Begin/restart
regression both reproduce the old `unused` result. Begin already correctly refuses
`already started`; it remains refused without live workspace publication, new
clock/marker, history/source/grant mutation, both before and after restart.
The first synthetic fixture omitted the prior interval's account hold, so normal
state loading added it; that failure is retained and corrected by supplying the
real existing hold, without relaxing byte-preservation assertions. Its unstarted
control also now has zero deadlines/PREPARING, rather than impossible history.

Corrected-fixture RED is limited to the two intended catalog assertions. Focused
three-repeat races pass core1.090s/CLI1.826s. Affected recovery/catalog/metadata/
consumption races pass17.818s, full native CLI/root-namespace/TLS races18.753s;
build/vet/diff checks pass. Receipts: /tmp/ssh-exam-catalog-uid-{red,
red-corrected-fixture,focus,core,cli,build,vet}.log. All runners completed.

No new state, worker, management mutation, account reservation or execution permit
is added. Inspection stays read-only; both unused and uncertain dependencies
already block source deletion. Current source changes only that bounded metadata
predicate. Release1641c8b's full621app/browser/42kernel/16x4 evidence continues to
cover its unchanged runtime contracts; those immutable binaries are not claimed
to contain this later catalog fix. No redundant app/browser/root-capacity run or
new native artifact qualification is claimed. Migration/revocation/retirement
still needs supported reviewed workflows; do not delete JSON/markers as a repair.
