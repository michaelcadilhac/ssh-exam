# Private preflight workspace staging

Local implementation October 21, 2026; **not deployed**. This D1 increment is not
the unified grant migration or version catalog. The later C6 settings increment
is documented separately in collection-limits.md.

## Behavior and authority

Matching gateway/native versions advertise `private-workspace-staging`.
Production readiness and preflight refuse older agents. After `prepare-attempt`,
the gateway sends signed, current-owner/transport-bound `prepare-workspace`.
Copy/verification runs in the bounded OS worker pool and exam-collection.slice,
outside shared state. Failure, death, hang or lost reply consumes neither time
nor a legacy recovery marker. Worker completion never automatically starts an
exam: a later explicit Begin is required.

Starter copying is streaming, bounded to the target's frozen collection limits
(new defaults 128/512 MiB; legacy absent fields 32/64 MiB), 10,000 entries and
depth 32. Directory enumeration is bounded before allocation.
Links, special files, mount crossings and detected concurrent source edits fail
closed. Ordinary modes and available nanosecond mtimes are preserved after
ownership changes; privilege bits are stripped. Practice mounts only practice
files, never staged work. Materials and writable-work initialization are separate.

Saved work is verified against the exact completed/protected source/checksum,
then extracted into a separate copy. Source bytes stay unchanged. Corruption
invalidates its verification anchor and retains a durable error; it never falls
back to empty/template work. Preflight does not write `.consumed`.

`WORK/ATTEMPT/workspace-ready/work` stays below real root-private parents. A
durable receipt binds attempt/account UID, full settings hash, source, legacy
authorization hash, template content inventory and directory device/inode. Retry
adopts the same private copy after publication-before-state death, even if the
template later changes. This freezes the **staged copy**, not the future C2
issuance snapshot. The empty-source primitive exists, but unified web/CLI source
selection and immutable template-version management remain pending.

## Begin, cancellation and repair

Begin holds the attempt lock and a per-UID workflow lock. A new preparation for
that UID cannot race an old ordinary-session purge after cancellation. Guard/OS
checks run outside shared state; inspection and cancellation remain responsive.
The final short transaction rechecks exact settings/source/transport/preparation,
current start window, account-policy readiness and signed-command expiration.
The gateway also rechecks page ownership/current connection/monitoring after
asynchronous SSH handoff/pane closure. A replaced page cannot start its successor.

Only then does the agent persist the original interval/access hold, claim the
legacy allowance, and publish via same-filesystem no-replace rename. Unexpected
live work is never overwritten. File copying, hashing and decompression no longer
happen at Begin or under shared state. Native failure after interval commit
preserves that interval/hold; no refund or new start is inferred.

Supported local workflows are discoverable without root/configuration:

```sh
examctl help workspace-prepare
sudo examctl info ATTEMPT
sudo examctl workspace-prepare ATTEMPT

# Interrupted committed publication only; never reopens working time:
examctl help workspace-repair
sudo examctl workspace-repair ATTEMPT --reason 'Corrected interrupted publication storage issue'
sudo examctl retry ATTEMPT --reason 'Publication repaired; secure original interval'
sudo examctl manifest ATTEMPT
```

Repair requires the exact private receipt/directory, preserves published edits
and original/current deadlines, and leaves COLLECTION_FAILED without a lease.
It never recopies a changed source, resets time, reopens completion or releases
restrictions. Unstarted failures use preflight/workspace-prepare retry. Unknown
receipts fail closed. Preserve private/orphan staging for diagnosis; no automatic
historical/live workspace cleanup is introduced. Normal failure removes only
that worker's exact unpublished temporary copy, never the protected source.

## Verification and remaining gates

### Reserved collection-name correction (local, not deployed)

Collection already reserves root MANIFEST.json, but the copier had accepted that
name from a starter tree. It could produce an uncollectable workspace before the
student wrote anything. Fresh staging now refuses the root entry (any type),
without starting time or consuming an allowance. Nested MANIFEST.json remains
permitted. Adoption and final Begin also inspect the name in retained private
stages: a valid old receipt/inode is not enough to admit known uncollectable work.
No file is automatically omitted, renamed, replaced or deleted by this check.

Inspect `examctl info ATTEMPT`. Correct the authored starter using a new, unused
template version; do not edit a version serving other preparations/active exams.
Configure future starts through the supported exam-settings workflow (and explicit
unused-grant revision once unified grants exist). An already frozen bad private
stage must not be recopied in place: cancel only its provably unstarted preparation
with `examctl cancel ATTEMPT --reason 'Reviewed invalid starter before Begin'`.
Wait for verified cancellation/account restoration, then retry student preflight.
Never apply this path to a committed interval or override access to shortcut it.
An invalid reserved file created after Begin still follows existing collection
recovery rules; this correction does not reopen work or discard saved bytes.

Signed preparation, explicit synthetic author repair, narrow nested-name allowance
and legacy adoption/Begin regressions pass with zero clocks/leases and preserved
source/private bytes. The initial signed fixture's key helper reset UID/GID;
the fixture was corrected, not account identity checks. A legacy-stage test
demonstrably failed against the old Begin/adoption path. Final full qualification
is tracked in todo-progress.md. This enforces the existing rule earlier, not a
new retention, timing, account or grant policy.

Regressions exercise signed scope/replay, native preparation/Begin/repair, clock
start after checks, idempotent Begin, cancellation/UID fencing, changed settings/
owner/expiration, metadata, unsafe trees, corrupt saved sources, real SIGKILL
after private publication, file-size resource failure and a supervised hung
child. Retry preserves original bytes; shared inspection/cancellation continues.
Actual local synthetic SSH/gateway tests cover lost staging replies and stale-
page Begin after handoff. Browser preflight/Begin fixtures now require staging.
Privileged guards/writer checks in native unit fixtures are injected; this is
not proof of installed host-root PAM/real student PTYs. The separate C6 large
disk-backed worker test covers default-size I/O/restore, not privileged writers.

Next: unified issuance/revise/revoke/consume authority; finite grant windows and
effective webcam snapshots; selectable empty/versioned/saved sources; native-only
legacy grant migration/visibility and protected-source deletion dependency fences.
C8 retirement still requires that visibility. Home/application preparation and
full privileged combined isolation remain under investigation. Do not label all
initialization, grants or examctl management complete from this milestone.

## Cutover and rollback

Coordinate gateway and **all** native writers/finalizers after drain, backup and
worker-slice installation (todo-rollout-plan.md). Preserve workspace receipts,
private trees, legacy grants/consumed markers, intervals and protected bundles.
Old writers discard unknown JSON fields and ignore the new attempt/UID locks;
never run them concurrently. Started historical attempts without staging receipts
continue existing enforcement/collection unchanged. Legacy unstarted preparations
require successful staging before Begin. Never manufacture a start for history.
Do not downgrade an unresolved publication to an initializer that ignores its
receipt and recopies changed defaults. Repair forward if rollback cannot preserve
current authority. No existing student workspace or temporary agent unit was
deleted by this work.
