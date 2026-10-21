# Manual private workspace retention — investigation

October 21, 2026. C4 policy is approved; the implementation and qualification below
are **not complete**. No cleanup command or production deletion is introduced by
this proposal. Latest instruction: keep all development/testing local; do not
deploy or consolidate services.

## Confirmed implementation boundaries

Native collectAndComplete verifies/publishes protection, terminates the attempt's
recorded units and removes disposable temporary storage, then marks COMPLETED.
It intentionally leaves Config.Work/ATTEMPT and its work files. Completion clears
Units, so historical unit names alone cannot be used as fresh no-writer proof.
verifyRelease also re-verifies the archive and may terminate recorded units; it
is **not** a read-only cleanup eligibility probe. Do not reuse it blindly in a
dry run. inspectWriters checks student UID containment, not every other process's
namespace mounts/open handles. There is currently no mount-usage inventory.

D1a privately stages and publishes work under the same per-attempt job fence and
per-UID workflow lock. A committed-but-unpublished attempt needs those exact
files/receipt for repair and is never cleanup-eligible. COMPLETED with a valid
protected copy is distinct from protected COLLECTION_FAILED, which still needs
cleanup/repair. Unknown records/orphan paths need separate evidence; do not infer
eligibility from an old directory name or the presence of an archive file.

Legacy saved-work restoration reads verified protected archive bytes, not the
old live workspace. Therefore an unused saved-work grant is a dependency on the
protected source bundle, **not by itself a reason to retain the old workspace**.
The D1b submission-deletion dependency check must not be copied as a workspace
retention prohibition. Test actual saved-work restore after cleanup while keeping
source archive/checksum/grants/consumption markers unchanged. Unified grants must
retain this separation when implemented.

Native WithState persists mutations even when its callback returns an error; it
is not a rollback transaction. Native Audit is best effort. New hold/cleanup
controls therefore need validated/audited-before-mutation ordering and a
returning, fsynced audit path, not assumptions from the gateway SQLite services.
Heavy verification/inspection/deletion must stay outside the shared state lock
and outside gate/PTY owners, under the existing bounded OS-worker boundary.

## Dependency-ordered implementation increments

1. C4a inspection/holds: discoverable root examctl workspace list/show and explicit
   audited hold/release controls with optimistic revisions. Bounded metadata
   inventory, exact configured UUID target/inode identity, no link following,
   retained ordinary/current deadlines, independent submission/grant identity.
   Distinguish recorded facts/candidate eligibility from fresh worker proof.
   Unknown/orphan/unsafe folders stay preserved and clearly refused. No deletion
   in this increment; do not advertise a proposal or an archive anchor as full
   cleanup qualification.
2. C4b fresh dry-run proof: bounded protected archive verification plus current
   state/holds, confirmed empty attempt cgroups/student writers, mount namespace
   and process-usage inspection, no active preparation/recovery/repair dependency.
   Enumerate relevant live namespaces, not only /proc/self/mountinfo: a bind mount
   in another namespace need not appear in the worker's own mount table. Decode
   mountinfo paths and map filesystem roots correctly, including a configured
   Work mountpoint. Check exact directory/file identities for other processes'
   cwd/root/open/mapped files where needed. Missing permission, uncertainty,
   oversized inventory or runtime/resource failure refuses without deletion.
   Never kill unrelated/healthy processes to make a dry run succeed.
3. C4c explicit cleanup: a reviewed exact-target intent, required audited reason,
   optimistic hold/job revision and durable retry/crash receipt. The worker owns
   the per-attempt fence for the entire destructive phase even if the CLI dies;
   parent-owned read-only check locks alone are insufficient. Recheck proof,
   state/identity/holds at actual deletion. A private same-filesystem quarantine
   rename can fence the exact inode before bounded no-follow removal, with fsync
   and durable phase receipts; a crash/partial removal needs a supported exact
   retry, never broad orphan deletion or a new target silently adopted from the
   canonical path. Preserve receipt evidence, protected bytes, all history and
   legacy/unified grant records. No automatic/background cleanup or grace period.

These are routine safety mechanisms for approved C4, not new policy defaults.
No eligibility should require waiting past the original access deadline solely
for retention; neither cleanup nor a hold releases that independent restriction.
A new active attempt for the same UID or unverifiable usage may conservatively
defer cleanup, with exact current blockers and supported next inspection steps.
Do not interrupt a running exam to reclaim an old folder.

## Acceptance and remaining investigation

Each increment needs actual compiled CLI/help/error workflows and native race/
static build/vet checks. Hold changes/audit failure/state save failure/restart and
concurrent finalization/staging/cleanup must preserve every prior receipt/clock.
Destructive qualification additionally needs real Linux namespace bind mounts,
open/cwd/mapped-file usage (including nonstudent supervisors), path replacement,
unsafe links/mount crossings, unreadable /proc, process death/resource/runtime/
disk faults, quarantine/publication/partial-removal crashes, and exact retries.
Keep a simultaneously healthy signed renewal/admission/callback workflow live;
no shared agent crash, changed deadline/generation or unintended process signal.
Restore saved work after cleanup and prove byte/metadata equality against the
unchanged protected source. Browser regression evidence must match any web-facing
changes; native-only local controls do not imply a new inbound API.

The exact mount/usage scanner, crash-retry state layout and privileged installed
host qualification remain under investigation. User/mount/PID namespace tests can
prove local kernel/filesystem mechanisms but not replace institutional PAM/SSH/
cgroup admission qualification. No check here is marked implemented or deployed.
