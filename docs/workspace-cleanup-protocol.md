# Reviewed manual workspace cleanup

October26 candidate in workspace-cleanup-delivery. Implemented with focused and
broad native tests locally; guarded installed qualification remains.
C4 stays open. Nothing is deployed. Earlier C4a/C4b receipts in
workspace-cleanup-delivery.md describe diagnostics, not this destructive worker.

Use the matched candidate CLI/agent/watchdog/reconcile cohort only. Older source
deleters do not understand the new archive pin. Never mix an old deleting role
with this workflow or use rollback as a way to bypass a pending cleanup.

```sh
examctl help workspaces
sudo examctl workspaces show ATTEMPT
sudo examctl workspaces dry-run ATTEMPT
sudo examctl workspaces cleanup ATTEMPT --review DRY_RUN_SHA256 --request NEW_UUID --reason 'Reviewed protected workspace cleanup'
sudo examctl workspaces cleanup-status ATTEMPT --request SAME_UUID
```

Cleanup is manual, with **no grace period** and no automatic queue. The root CLI
launches an independent bounded worker using the existing two-slot collection
pool, 256MiB/no swap/32 tasks/120s and a32768-descriptor bound. Attempt/job and
account workflow fences cover the entire mutation. It never signals another
process, releases account restrictions, changes a deadline or consumes a grant.
Status reads bounded metadata without waiting on the destructive job fence.
An absent receipt is only an observation; an in-flight worker may still accept it.

The worker requires a positively completed/protected attempt, no recorded units,
no policy/access errors, no retention hold or same-UID unfinished attempt, and
fresh streaming archive/manifest/checksum verification. The live regular-file
inventory must match protected bytes. Unknown private artifacts, special files,
hardlinks, new/changed entries, cross-mount trees and incomplete/opaque kernel
observations refuse. Symlinks are never followed. Directory/source identities,
all threads/process references and foreign namespace/mount aliases are observed.

Every regular file remains pinned under an exclusive Linux file lease: queued
SCM_RIGHTS/open/mapped references must refuse the barrier. Leases are rechecked
before removal and at phase boundaries; a break request aborts remaining removal.
All directories are pinned, made root-owned0500 and inventoried again before
quarantine. This also blocks non-root writers using a queued directory descriptor.
The quarantine parent is root-private0700 on the work filesystem; rename is
no-replace and the original inode is verified. Unlinks are relative to pinned
directories, no-follow, bottom-up, with exact inode/type/authority/link checks and
directory flushes. Unknown/newer bytes are preserved. As with native account
isolation, arbitrary privileged root writers must be administratively quiescent;
this is not protection against an adversarial host administrator.

| Durable phase | Inspect/restart/cancellation behavior |
| --- | --- |
| PREPARED | Audited intent, original inode inventory and literal lifecycle receipt bytes are durable before sealing. Explicit retry or intact cancellation. |
| SEALED | Some/all directory permissions may be sealed; original owner/modes are recorded. No unlinks authorized yet. Fresh retry/cancel reconciles canonical versus quarantine inode. |
| QUARANTINED | Exact original tree is private; canonical replacement is never overwritten. Intact cancellation can restore it. |
| REMOVING | Durable before the first unlink. Cancellation refuses; explicit retry removes only remaining original entries. Missing both targets after root removal can complete the same job after fresh archive verification/flushes. |
| COMPLETED | Original tree gone; receipts/history/archives/holds/clocks remain. Exact initial request is inspection, never a second deletion. |
| CANCELLED | Complete original tree restored without replacement and original directory modes/owners restored. New cleanup requires a new reviewed request; old receipt is retained in history. |

Lost/error replies require `cleanup-status`. To proceed, use its current review
with `cleanup-retry` or `cleanup-cancel`, the same request and a fresh reason.
Hold changes invalidate the review. Partial removal cannot be cancelled. Unknown
or replaced entries require preserving evidence and consistent verified repair;
the CLI never offers a force-delete/merge. Intact incomplete marker publication
remains inspectable and can be repaired by an explicit reviewed same-job action.
Actual missing/corrupt known records refuse; never edit JSON or remove markers.

Back up State/workspace-cleanups, workspace-cleanup-history, independent initialized/
known markers, audit, Work/.workspace-cleanup-quarantine, all existing native
authority/source/consumption records and protected submissions as one consistent
set. Pending jobs pin the archive independently of state.json. Both native archive
deletion entries check this pin in their isolated check-delete worker; terminal
release requires positive physical consistency and durable receipt/directory
flushes. Existing saved grants and unfinished restores keep their separate pins.
Cleanup does not delete protected history or receipt bytes outside student work.

No-start/revocation and unused-definition proof inventories the independent
cleanup catalog and quarantine. A missing canonical native row or absent work/
archive folder cannot erase positive started history in these receipts. Unknown
residue and inconsistent known metadata refuse before acknowledging no-start.
Jobs hold no account reservation or execution permission, expire their worker
resources on exit and require explicit future action; no background retry exists.

Focused evidence: actual compiled CLI with513 regular files, real foreign open/
cwd/mmap/watch/mount/namespace and queued-only SCM_RIGHTS refusals, stale review,
unarchived-byte/audit/FIFO refusal, exact cleanup/replay/discovery and unchanged
HELD history/archive. Private namespace worker tests exercise7 exact SIGKILL
boundaries, live status while fenced, target-only ENOSPC/EROFS, incomplete markers,
holds/review revisions, replacement inode, cancellation/retry and actual saved-work
prepare from the unchanged archive with zero new clock. Synthetic target UID is
mapped for restore; these are not installed root/PAM/cgroup or multi-UID proof.

Earlier phase-death receipts are invalid: a PID1 fixture's ignored self-kill led
to a panic/nonzero result falsely standing in for death. The corrected fixture
keeps a separate PID1 reaper and requires exact137 (SIGKILL); panic and timeout
fail the oracle. Three corrected race repeats pass14.394s; subsequent history/pin
checks pass focused5.709s/6.018s. Original logs/failures remain in /tmp/ssh-exam-
workspace-cleanup-*.log. EROFS initially failed at fixture mount permissions;
required bind-remount NOSUID/NODEV/NOEXEC flags fixed the setup, with no product
enforcement relaxation. The temporary invalid runner and its exact namespace
descendants were stopped; no production process was involved.

Broad native races PASS core348.394s/CLI24.430s; static build/vet and all291
frozen native source hashes PASS. Final frozen focus CLI8.300s/core6.301s.
Before closing C4: finish fresh guarded exact-artifact
resource/multi-UID/queued-directory/healthy-peer and source-restore qualification,
then update the current checkpoint/TODO with actual receipts. Web/app/WASM are
unchanged; C17's625 checks and packaged browsers cover those unchanged surfaces.

The guarded driver is now prepared: worker-isolation adds actual CLI lease-break
refusal/cancellation, restoration of real student-owned directories, and a
different UID's queued directory descriptor which could write before sealing but
must receive EACCES afterward, alongside the healthy SSH/renewal peer. The saved-
source profile removes the original folder before the existing reviewed NEW
90-minute saved-work workflow. Driver/nested-child syntax and21 runner-safety
tests pass; these are preparation evidence, not actual root acceptance. Source
UID20001/probe29978 unused/peer29979 distinct are confirmed read-only in the
private guest. Native binaries remain2ff7ca4. A temporary SIGTERM mutation is
rejected at exact143; the original test is restored and all291 hashes match.

Upload is blocked by automatic approval review, which explicitly limits retained
authorization to the older286 artifact. No upload/guest test ran. The corrected
18-file45,698,592-byte code-only bundle is MAIN var/collection-tests/workspace-
cleanup-2ff7ca4-fixed.ti4yc5e6; adjacent .audit.json pins every file and source.
Digest08e2b42b6bbc5abd8db1a352aed2afe4fd5cac0711a893ac9ea2df10ad87b35e.
The prior39f1... question/bundle is superseded after correcting the native JSON
producer's omitted legacy grant in the test consumer. Current dialog offers
scoped future audited code-only corrections, exact-corrected-only or local-only.
No credentials/config/student data or deployment is included. Await the actual
answer and refresh guards; permission/elapsed time never establishes acceptance.
