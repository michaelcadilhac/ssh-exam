# Manual workspace cleanup delivery

Local investigation/development only; no deployment or production deletion.
Approved C4 policy remains manual, no grace period, preserve authoritative clocks,
account restrictions, protected archives/history and source grants. Same-UID active
work or uncertain usage can defer cleanup without interrupting any process. Archive
dependencies are not live-folder dependencies. Existing approvals/state review:
workspace-retention.md. No new policy question is pending.

Dependency-ordered public milestones:

1. Correct `examctl workspaces show/list` metadata. Confirmed source discrepancy:
   native preparation records `WorkPath=Engine.directory()` (normally `/work`),
   the destination visible inside the exam. Current retention metadata instead
   compares it to the private host path and incorrectly blocks ordinary records.
   Old tests authored the host path, masking this. Acceptance: real root-mapped CLI
   and producer-based native tests recognize valid recorded sandbox directories,
   retain exact derived host target, preserve holds/history/bytes, still report
   eligible/archive_verified=false and reject malformed recorded paths. Run focused
   RED→GREEN, full workspace/CLI races and build/vet. No cleanup enabled here.
2. Deliver `examctl workspaces dry-run ATTEMPT` through a bounded independent
   worker. Fresh protected archive verification, initialized state/hold/identity,
   no pending repair/staging or same-UID active work, complete pinned process/thread/
   namespace/mount/fd/cwd/root/mapping proof. Refuse unknown/unreadable/oversized/
   changing observations. No signals, account changes or deletion. Integrate the
   existing mount helper into this actual caller; no unused scanner chain. Prove
   real foreign same-device aliases and nonstudent uses through the CLI before
   broad qualification. Point-in-time preview is never a deletion permit.
3. Deliver reviewed `workspaces cleanup`, inspect/retry/cancel where reversible,
   with worker-owned job/account fences, private same-filesystem exact-inode
   quarantine, durable audit/phase receipts and bounded no-follow removal. Recheck
   archive/state/holds/use at deletion; protect the archive while an interrupted
   cleanup still needs it. Review every new phase for inspection/cancellation,
   crash/restart/expiry/stale completion/admission bypass before freezing artifacts.
   Integrate pending cleanup evidence with source deletion/no-start inventories;
   do not silently skip quarantines or let one crash grant execution/account holds.
   Qualify actual CLI/help, all relevant Linux references/fault boundaries, healthy
   peer enforcement and saved-work restore from unchanged archive afterward.

Do not stop after metadata or a helper: continue to the integrated safe cleanup.
Full privileged boundaries require the agreed guarded disposable csc-sys guest;
local namespace fixtures alone do not qualify host-root/PAM/cgroups. Busy/uncertain
host guard means no test. New bundle approval, if tool review requires it, must
refer to a complete audited exact artifact; previous286 approval covers only it.

Detailed cleanup protocol is not final merely because this plan exists. The
worker/usage lifetime barrier and crash-state layout remain under investigation.

## C4b integrated observation, October26 (local; not cleanup qualification)

`sudo examctl workspaces dry-run ATTEMPT` now reaches a separate root-only worker
under the existing collection slice/resource bounds and two heavy-work slots.
It holds the attempt job and account workflow fences, reads initialized private
authority, respects retention/state/same-account unfinished blockers, verifies
the full protected archive, inventories exact workspace objects, and observes
pinned process lifetimes, all threads, mount source roots, cwd/root, fd/mapping
identities and inotify watches. It repeats tree/attempt/hold identity checks.
Unknown, oversized, opaque or changing observations refuse. No signal, account
change, interval/grant/source mutation, background operation or deletion exists.

`usage_observed` means that bounded observation completed; `snapshot_clear` means
it found no blocker/reference. **eligible remains false.** A sequential /proc
observation cannot by itself fence future/in-flight references. The required
deletion lifetime barrier, complete asynchronous/reference qualification and
durable quarantine/retry protocol remain C4c work. This is a usable diagnostic
increment, not a claim that the complete C4 investigation or TODO is finished.
Do not extend another unused scanner chain: qualify the actual cleanup barrier
and public reviewed/retry journey next, or report a concrete unresolved boundary.

State review before broad qualification: no new durable job/intermediate state,
account reservation or execution permission. OS-owned locks release on worker
exit; resource/runtime exhaustion produces no queued action or eligibility.
Restart needs a new inspection; an old report never authorizes deletion. Scope/
nonce/ID, contradictory/missing/oversized replies and root executable ownership
are checked before reporting. Private --workspace-inspection-worker exists only
in examctl, never a student/native RPC. Installed cgroup/PAM/host-root boundaries
remain unqualified for these new artifacts.

Focused actual compiled CLI checks pass: real quiet/unrelated watch, foreign
open/cwd/mmap/watch references, same-device directory/file binds in a FOREIGN
mount namespace, chroot-hidden bind, detached namespace FD and bind-held namespace
handle; retention hold then explicit release; corrupt archive checksum then
repair/retry; missing resource profile, worker death, oversized/wrong-scope reply.
Authoritative JSON and saved answer remain unchanged. Only the system-manager
interface is mocked inside a disposable user/mount/PID namespace; its PID1 dies
on timeout and namespace handshakes have independent bounds. Focused final3.311s;
three namespace/protocol repeats6.516s; parser/inventory race1.027s. Broad next.

Retained failures: unrelated-watch initially watched the target's outer UUID
folder, so correctly counted as use; moved that fixture outside the target.
Old blanket inotify refusal was reproduced; exact watches now correlate internal
kernel s_dev encoding to stat device/inode, permitting unrelated watches. A plain
chroot first produced an already-refused empty mount table; a mounted chroot
then reproduced an actual false-clear observation (RED1.141s). Different or
changing process root views now refuse, with three repeats5.977s. A bind-held
nsfs handle was already refused by the strict mount-root parser; corrected that
test oracle, without relaxing parsing. Initial state-byte comparison captured
pre-normalization fixture JSON; baseline now follows completed metadata setup.
Hold refusal oracle now uses the actual existing message. Failure logs remain
under /tmp/ssh-exam-workspace-*.log; no failure is counted as successful coverage.

Inotify format/encoding references: Linux
[fdinfo producer](https://github.com/torvalds/linux/blob/master/fs/notify/fdinfo.c)
and [kernel device encoding](https://github.com/torvalds/linux/blob/master/include/linux/kdev_t.h).
Opaque io_uring/fanotify containers and unrepresented namespace handles refuse;
do not signal unrelated services or interpret missing details as no-use evidence.

Broad boundary qualification PASS: full native CLI races20.858s; affected native
workspace/source/snapshot/catalog races14.954s; separate CGO-disabled build and
vet, diff check. Web/application/ordinary native execution are unchanged, so C8's
622 app/11 affected browsers/real-WASM and image evidence remains applicable to
those unchanged surfaces. No new installed resource/host-root proof is inferred.
No active runner, guest, production action or workspace deletion.

C4c investigation during independent application qualification: a private local
Unix socket pair can retain a regular file ONLY in queued SCM_RIGHTS, while proc
FD inventory shows only the inspecting process's own descriptor. A synthetic
kernel probe confirms a fresh exclusive F_SETLEASE refuses that queued reference
and succeeds after it is received/closed; original bytes remain unchanged. Linux
file leases cover regular files, not directory references (the real directory
probe returns EINVAL). This is evidence for a necessary cleanup-worker barrier,
not an enabled helper, complete proof or deletion. Do not generalize the regular-
file result to directories/namespace/admission races. Quarantine, full inode/use
barriers and durable retry still must integrate at the public cleanup entry.
Primary semantics: Linux [lease implementation](https://github.com/torvalds/linux/blob/v6.17/fs/locks.c)
and [lease interface](https://man7.org/linux/man-pages/man2/F_GETLEASE.2const.html).

Metadata correction: native producer-based default/custom directory regressions
RED0.046s and actual root-mapped CLI RED0.031s reproduced the wrong host-path
comparison. Focused GREEN under race core1.095s/CLI1.633s verifies recorded_directory
separately from the immutable host UUID target, future defaults preserve old paths,
malformed paths still block, and eligibility/archive_verified remain false. First
CLI selector selected no cases; it is explicitly excluded from interface evidence.
No new durable state/worker/reservation/permission is added. Existing hold metadata,
clocks, source records and saved bytes are unchanged. Broad native/CLI checks next;
this correction does not close C4 or enable deletion.

Broad metadata qualification PASS: affected workspace/hold/snapshot races1.672s;
full native CLI/root-user-namespace/TLS races16.472s; CGO-disabled build/vet/diff.
Source change is limited to offline workspace metadata/help/tests. C8's unchanged
web/application/student/kernel surfaces do not need requalification for this
projection fix. No new privileged cleanup proof or executable deployment claimed.
Logs /tmp/ssh-exam-workspace-directory-{red,cli-red,focus,core,cli}.log.
