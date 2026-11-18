# Host socket inventory correction — local qualification

The 70-student endurance run stopped after 55 students / 220 terminals when the
next terminal was refused. The native agent reported an apparently exposed socket
under `/usr/local/sbin/exam-agent/`. The affected attempt retained its original
deadline, authenticated SSH owner and existing working terminal. This is separate
from the earlier, still unclassified, policy HTTP 503.

The socket was bound through a pinned directory descriptor and inherited by its
attempt supervisor. Linux records that process-relative name in `/proc/net/unix`.
Resolving `/proc/self/fd/N` in the inventory process can use a different, reused
descriptor and invent an exposed path. A deterministic cross-process test
reproduces the refusal with both publisher and scanner descriptors reused.

The correction preserves pinned-directory binding. For process-relative names,
the inventory obtains a bounded, complete, read-only `NETLINK_SOCK_DIAG` snapshot
and verifies `UNIX_DIAG_VFS` device/inode against the actual private native socket.
Only the existing watchdog socket and UUID-named attempt supervisor sockets qualify.
Their directories must be canonical, owned by the effective user and mode 0700;
the socket must be owned by that user, mode 0600 and have exactly one link.
Basename or directory-prefix matches alone never establish identity.

Unknown sockets, mismatched identities, unsafe private paths and unavailable or
incomplete metadata refuse readiness/new admission with operator guidance.
Connected stream endpoints cannot accept new pathname connections; bound datagrams
remain checked. Retired sockets require positive absence from a newer complete
kernel dump. One bounded re-observation handles inventory changes. Existing
workloads, deadlines, grants, holds and monitoring authority are not modified.

The installed agent service already permits AF_NETLINK. No service capability or
address-family change is part of this correction. The Linux UAPI defines the VFS
payload as inode followed by kernel device number; a real kernel probe and local
headers establish this order and the kernel device encoding.

Local evidence under `var/stress-remediation/20261117/host-socket-identity/`
preserves the failing old behavior and seven passing focused checks: inherited FD
reuse, foreign same-name sockets, hardlinks, writable private directories, malformed
metadata and existing exposed-socket behavior. The complete native race suite
passes in `native-go-validation-2/`, with frozen source/build and runner cleanup
verified. Native static checks also pass.

Actual `examctl health` now passes all five disposable-guest cases: private alias
accepted, same-name foreign socket refused, explicit repair/retry, and metadata
refusal/availability under actual systemd address-family restrictions. The browser
New terminal/editor/pause/Continue/protected-finish workflow passes with the new
v17b binaries in `var/stress/20261117T174000Z/native-editor-9/` (102.807s, one case,
no skips/failures/flakes). Independent native preservation is FULL; the exact
native/Marco/local runners and listeners are cleaned up, frozen inputs unchanged.

The first upload receiver failed before extracting files; its destination was
verified empty and preserved. The first guest workflow attempt (editor8) stopped
before allocating a guest because the bundle owner differed from the existing
SSH public-key uploader. All candidate hashes and private modes were verified
before correcting ownership to match the established test account. These owned
setup failures retain separate receipts and are not native product failures.

Timer controls and files-only recovery also pass with v17b in
`native-timer-recovery-4/` (110.937s, one case, no skips/failures/flakes): countdown
pause while work continues, immediate extra allowance, genuine SSH-loss recovery,
no-expiry resume approval and protected completion. FULL independent native,
Marco and local cleanup and unchanged frozen inputs are verified.

Multi-student recovery also passes in `native-recovery-7/` (589.734s): all
16 students / 64 original terminals recover after a 75-second proof outage,
preserving buffers, ownership and original deadlines, then all 16 submissions
are protected. Independent native preservation is FULL; the exact guest and
local runner/processes/listeners are stopped, frozen inputs unchanged.
Concurrent collection is qualified by the separate result below. No deployment
or 70-student/90-minute acceptance is claimed.

Collection attempt2 stopped before the intended SIGKILL: a fresh worker guard no
longer saw both archive writers after an earlier successful observation. The
native snapshot had two unprotected FINALIZING attempts and fourteen ACTIVE,
with no LOCKED attempts; FULL native/local cleanup and preservation pass.
Independently, a focused regression proves that an unrelated descriptor closing
after `/proc/PID/fd` enumeration made the old test observer drop a live collector.
The fixture now skips only that retiring descriptor, while a closed archive
writer remains unverified. All38 bridge checks and that negative control pass.
This does not establish the exact cause of attempt2's guard miss. New v17c changes
only the collection observer and sanitized failure context; native binaries and
the other seventeen bundle files are byte-identical to v17b. Fresh collection
qualification is running; no original failure is relabelled successful.

Attempt3 delivered the intended signal and observed COLLECTION_FAILED, then its
retry fixture refused a later FINALIZING snapshot. Existing `Engine.Tick`
automatically retries failed finalization; `Admin("retry")` and `finishCollection`
support already-finalizing/completed jobs. The fixture now accepts those supported
states while rejecting ACTIVE, LOCKED and PREPARING. It still requires the killed
job to have failed, continued peer input, original deadlines and verified archives.
It accepts pending or already-completed asynchronous verification replies and
surfaces bridge refusals directly. Final40 bridge checks and typecheck pass.

A bounded local-user process probe proves journal SIGKILL fields and exact cleanup;
the new actual-guest oracle requires the killed unit's own EXIT_CODE=killed and
EXIT_STATUS=9 before reporting injection successful. Other units/signals refuse.
This is fixture qualification, not a new production mechanism. Auditedv17d retains
the same native binaries. Earlier failed
receipts and their FULL preservation/cleanup results remain separate.

Collection5 now passes in511.524s (one case, no skips/failures/flakes):16students/
64terminals,508MiB simultaneous collection, exact unit/PID SIGKILL9, a new durable
parent worker error, actualCLI retry, continued input from14peers before and after
compression/export, and16protected byte-verified submissions. The browser checks
the durable error instead of demanding the intermediate failed state persist;
automatic retry and all original interval/hold/protection requirements stay in
force. The original missing-error typecheck failed and was corrected using the
typed snapshot baseline; final typecheck passes. Exact native preservation is
FULL; guest/local runners/processes/listeners are stopped, frozen inputs unchanged.
Evidence: `var/stress/20261117T174000Z/native-collection-5/` and
`var/stress-remediation/20261117/native-socket-collection-4/completion.json`.
The native milestone is locally validated; the full-class endurance remains open.
Unchanged application/browser evidence remains applicable; this native change
requires a new audited code bundle and fresh relevant kernel/workflow evidence.
