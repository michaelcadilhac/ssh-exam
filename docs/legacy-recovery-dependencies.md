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
