# Manual private workspace retention — investigation and local controls

October 21, 2026. C4 policy is approved; complete cleanup and its qualification
are **not complete**. C4a metadata/hold controls are implemented/tested locally;
there is no cleanup command or production deletion. Latest instruction: keep all development/testing local; do not
deploy or consolidate services.

October26 metadata correction (implemented/tested locally): `WorkPath` is the saved
directory inside the exam (normally `/work`), not the host UUID source. `show/list`
now return `recorded_directory` separately from `path`; future directory defaults
do not invalidate that historical value. Host paths still derive only from pinned
Config.Work/attempt identity. Relative/unclean/root/NUL/oversized saved directories
remain blocked. Eligibility/archive_verified still false; no cleanup enabled.
Producer-based and actual CLI RED→GREEN tests, affected workspace/snapshot races
1.672s and full CLI/root-namespace/TLS races16.472s pass with build/vet. Web/student
runtime unchanged; C8's622 app/11 affected browsers plus real-WASM input evidence
still applies to those unchanged surfaces. No redundant app/browser/new csc run.
Detailed current delivery plan: workspace-cleanup-delivery.md.

## October22 hold-record correctness follow-up (tested locally; not deployed)

The actual root-user-namespace CLI reproduced an incomplete v1 record with its
held field removed as `held:false`/`candidate:true` (RED0.142s). Eligibility still
remained false and no cleanup command exists: this was incorrect protection
metadata, not a claim that any workspace was deleted. The previous JSON decoder
also accepted null/duplicate/case-aliased held fields through default/last values.

Existing v1 writers serialize all eleven fields, including false/zero values.
The reader now requires that exact complete, non-null schema, valid UTF-8,
unambiguous JSON and existing identity/revision/owner/file checks. Negative audit
UIDs are invalid; legitimate zero/root attribution is retained. No format/version
change, backfill, hold release or valid-history rewrite is performed. An existing
incomplete record is malformed, never an absent/new hold. A genuinely never-
initialized retention history keeps the existing explicit revision0 workflow.

Rollback requires no hold-file migration for valid v1 records, but an older
permissive reader is not a repair path for malformed data: never accept its
defaulted released/candidate output or overwrite evidence to bypass this refusal.
Preserve all independent markers, records and audit alongside authoritative state.

`workspaces show/list/hold/release-hold` all refuse before publishing replacement
metadata or accepting a new hold-control audit. Preserve the corrupt record and
known/initialized markers; restore a consistent verified private backup. Do not
edit JSON/remove markers or run release-hold to bypass the refusal. Complete valid
true/false records remain supported, with unchanged original/current deadlines,
account holds, protected submissions, saved work and independent retention policy.
Existing workspaces inspections still use their documented native initialization/
job fence; this does not turn them into the newer no-write diagnostic interface.

State/failure review: no new durable/pending state, reservation, permit, worker or
management capability. Reads remain bounded16KiB and outside shared state after
the existing short native snapshot; link/FIFO/owner protections and per-attempt
concurrency fences remain. Unknown/corrupt metadata always blocks control; no
timeout, missing field or decoding normalization establishes cleanup eligibility.
Manual cleanup, archive verification and complete kernel-reference proof remain
unimplemented/disabled; no production policy or record changes.

Three focused race repeats pass core1.269s/CLI2.658s: all eleven fields missing/
null, actual root-namespace CLI show/list/hold/release refusals for missing/null/
duplicate/case-alias, exact bad bytes and audit preservation, valid true/false
round trips and existing hold/loss/audit/link/busy controls. The CLI fixture invokes
the real CLI entry in a compiled test executable, not a privileged installed-role
qualification. Full native race/resource/namespace/compiler/default-size
qualification passes core312.137s/CLI29.516s; static build/vet and diff checks pass.
All runners finish. No app/browser/WASM source or artifact changed; preceding
broad application/browser and affected callback evidence covers those unchanged
surfaces. No redundant web rebuild/rerun or new root-guest qualification is claimed.
Receipts: /tmp/ssh-exam-workspace-hold-schema-{red,acceptance,native}.log.

## C4a supported local metadata/hold workflow

```sh
examctl help workspaces
sudo examctl workspaces list --exam midterm --limit 50
sudo examctl workspaces show ATTEMPT
sudo examctl info ATTEMPT
sudo examctl workspaces hold ATTEMPT --revision 0 --reason 'Retain workspace for explicit investigation'
sudo examctl workspaces release-hold ATTEMPT --revision 1 --reason 'Investigation complete; fresh usage proof still required'
```

These are real/effective-root local commands, usable offline from the gateway,
not an additional agent API. List pages known native attempts (100 default,
maximum 200, exclusive ID cursor); unknown/orphan folders remain preserved and
are not enumerated or eligible. Show reports bounded metadata, exact configured
UUID path, decimal-string device/inode identity, current/original interval,
recorded protection, hold and obvious blockers. It does not recursively read saved
work, verify archives, terminate units, release accounts or delete anything.

`candidate=true` is only a metadata observation. **eligible=false and
archive_verified=false always remain explicit in C4a**, even if the native
record contains a protected checksum. A protected COLLECTION_FAILED attempt,
active/preparing work, unsafe parent, missing publication or unresolved access
error is not a candidate. Releasing a hold does not certify eligibility. There
is no deletion command, automatic retention job or grace period.

Hold controls require the current integer hold revision (not clock revision or
definition hash) and 8..1000 UTF-8 bytes of operator reason. They use the same
nonblocking per-attempt fence as finalization/staging, returning/fsynced intent
audit before record publication, private atomic/fsynced record writes and exact
identity/revision validation. The reason is permanent operator evidence; do not
copy private student messages. Actual root UIDs are recorded, not a claimed human
from SUDO_USER. A stale/lost-reply retry cannot clear a later hold: inspect fresh
show, review, then explicitly choose a new revision. No silent revision adoption.

Metadata lives in State/workspace-retention/ATTEMPT.json, not a new state.json
field which older unrelated writers could discard. A root-level initialized
marker and per-attempt known markers detect lost record/directory data. Missing
known metadata, wrong identity, bad JSON, unsafe permissions/owner, links/special
files or marker corruption refuse; they never imply release. Markers publish by
atomic no-replace rename, not a visible partial file. Opens are nonblocking so a
FIFO cannot strand inspection/control. Incomplete marker publication with an
otherwise intact valid record remains visibly blocked and can be repaired by a
deliberate reviewed control. Actual loss/corruption needs a consistent verified
private backup; do not erase markers/JSON to manufacture an unheld state.

Back up all retention records/markers with native state/audit. Preserve them on
rollback and do not interpret resilience to an older state.json save as permission
to mix old/new native finalizers. Workspace holds affect workspace retention,
not clock/account authority or independent protected-submission retention. The
current native commands do not delete old work, so an older binary cannot be
used as a supported workspace-cleanup bypass. No install/migration/deletion has
been performed. Full local evidence is recorded in todo-progress.md.

## Confirmed implementation boundaries

Native collectAndComplete verifies/publishes protection, terminates the attempt's
recorded units and removes disposable temporary storage, then marks COMPLETED.
It intentionally leaves Config.Work/ATTEMPT and its work files. Completion clears
Units, so historical unit names alone cannot be used as fresh no-writer proof.
verifyRelease also re-verifies the archive and may terminate recorded units; it
is **not** a read-only cleanup eligibility probe. Do not reuse it blindly in a
dry run. inspectWriters checks student UID containment, not every other process's
namespace mounts/open handles. There is currently no mount-usage inventory.
October22 C4b0 now adds an internal unused bounded mountinfo/source-root
relationship primitive, not that full inventory or a cleanup decision. Actual
private-namespace same-device file/directory aliases and escaped names are
tested; a mountpoint-only mutant fails the real kernel regression, then is
removed. Full app/native race/build and bounded fuzz pass; web artifacts stay
identical. See workspace-mount-observations.md. Complete process/namespace/fd/
cwd/root/mmap/lifetime barriers, fresh archive/holds and actual deletion-phase
proof still must precede any supported dry-run eligibility/cleanup workflow.

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

C4a inspection/control refuses a busy per-attempt job immediately and explicitly
says a hold change was **not accepted or queued**. Reusing the generic collection
pending error would falsely imply a retained request; focused core and actual CLI
regressions verify that no record/revision changes and unrelated state remains
responsive. Recorded start/end, policy/access state and bounded errors are shown
alongside original/current deadlines so legacy/failed-state blockers are visible.

## Dependency-ordered implementation increments

1. C4a inspection/holds (implemented/tested locally): discoverable root examctl workspaces list/show and explicit
   audited hold/release controls with optimistic revisions. Bounded metadata
   inventory, exact configured UUID target/inode identity, no link following,
   retained ordinary/current deadlines, independent submission/grant identity.
   Distinguish recorded facts/candidate eligibility from fresh worker proof.
   Unknown/orphan/unsafe folders stay preserved and clearly refused. No deletion
   in this increment; do not advertise metadata or an archive anchor as full
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
