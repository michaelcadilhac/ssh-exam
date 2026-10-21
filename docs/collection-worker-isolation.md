# Collection process isolation — local implementation

October 21, 2026. Implemented/tested locally; **not deployed**. This addresses the
C6 crash-failure domain, not the reported incident's unconfirmed original cause.
Archive ceilings remain 32 MiB/file and 64 MiB total until the configurable-limit
milestone is qualified. No workspaces, student records or production services were
changed. Full privileged SSH/PTY and worst-case workload qualification remain open.

## Runtime and durable boundaries

Authenticated student finish, root stop/finish/retry and deadline reconciliation
all first commit FINALIZING, revoke execution/admission and preserve authoritative
timing/reason. They then invoke a separate root coordinator executable through
systemd-run, never a goroutine pretending to provide fatal-crash isolation.
Only exam-agent and examctl have the private worker entry; the setuid exam-login
launcher does not. Input is a bounded private pipe, with version/action/attempt/
nonce-bound replies. There is no configurable shell command or production test
bypass. Unknown, truncated, oversized or mismatched replies fail closed.

Each worker owns a nonblocking per-attempt flock for its whole operation, including
publication and cleanup. Two persistent slot flocks bound heavy work across
agents/watchdog/CLI. Lock order is attempt, slot, short global-state transaction;
never wait for a worker or acquire an attempt lock while holding global state.
Busy work remains honestly pending, and later reconciliation/retry resumes it.
Tick uses two independent worker lanes, so a stalled job cannot monopolize all
due jobs. Independent cutoff attempts every due workload before archiving; one
failed cutoff does not suppress others' finalization.

Per-worker limits are 256 MiB RAM, no swap, 32 tasks, 100% CPU quota, nice 10 and
120 seconds, with bounded shutdown and cgroup-wide OOM/kill handling. The separate
exam-collection.slice caps aggregate memory at 512 MiB and tasks at 96. Workers
are never placed in frozen student scopes or the PTY-owning daemon's cgroup.
Production readiness and launches refuse an absent/unbounded aggregate slice.
The parent supervises systemd's exit and timeout; killing only systemd-run is not
treated as proof that its worker died. The surviving worker's flock prevents
overlap until it actually exits. No fatal worker failure propagates as an
in-process panic to the gate.

Writer freeze/containment checks, compression, archive hashing, termination and
temporary cleanup run outside global state. Short fenced commits record:

1. Job ownership and the immutable attempt/timing/settings/generation snapshot.
2. Verified published protection/checksum/timestamps before termination.
3. COMPLETED only after termination and temporary cleanup succeed.

Failure affects only the matching attempt/job. Protected-but-not-cleaned-up is
distinct from unprotected failure; either retains the normal account hold. A
worker/coordinator crash after publication causes verification/adoption of the
same bundle, never live-work recollection or replacement. Partial staging remains
private and is not a submission; automatic orphan-stage cleanup is not added.

Manifest/export, elapsed-account release and emergency-release verification also
use isolated workers. Emergency override still requires its explicit root reason,
verified protection/no writers and durable audit, with a fenced commit. Deletion
and exports share the attempt lock. Slow output copies stay outside global state.
Shared-state loading no longer secretly hashes archives or waits for systemd.

Callback state retains only a small digest of worker-verified manifest metadata,
not all historical inventories. Bounded regular-file metadata is checked against
that anchor when preparing events; archive bytes are never hashed under the
global lock. Old state has no anchor until a worker verifies the bundle; it is
not granted fabricated verification. Public receipts hide native job ownership.
Metadata over 4 MiB or over the unchanged 10,000-entry bound fails closed.

## Operator workflow and compatibility

Use `examctl help collection`, `info`, `manifest`, audited `retry`, and `reconcile`.
FINALIZING is pending, not completion. A worker error never authorizes deleting a
bundle, overriding access, resetting time or silently dropping an answer.
The existing installer includes the new slice; install/reload it in the drained
maintenance workflow before enabling the new agent/watchdog/CLI. Preserve the
independent watchdog, callbacks, original/current clocks, state/markers and work.
Do not restart any PTY owner during an exam.

State adds small manifest anchors and job tokens; existing bundles are unchanged.
Back up state and artifacts consistently. Do not run old and new finalizers
concurrently: old code uses only the global lock and cannot honor new per-attempt
locks. Drain every old agent/watchdog/reconciler/CLI collector before cutover or
rollback. Roll back binaries only after all new jobs and units have ended; retain
additive state, archives and clocks. Verify/adopt existing bundles on restart.
Temporary-service consolidation remains a separate proposed drained procedure.

## Local verification and outstanding qualification

Native tests exercise real child panic/exit/SIGKILL, address-space/file-size
bounds, hangs, malformed replies, protected publication before state commit and
death after the protected-state commit. Healthy signed renewals, channel admission,
fresh/replacement registration, generations and deadlines remain intact. The
16-attempt cleanup/callback test now requires ordinary inspection to complete
while termination is blocked, not merely independent renewals/cutoff.

Opt-in tests additionally verified actual user-systemd `oom-kill` (about 174 ms)
and `timeout` (about 2.14 s), actual ENOSPC/read-only tmpfs inside disposable user+
mount namespaces, unprivileged permission denial, preserved work/holds and safe
retry. These test services use 64 MiB/2 seconds to trigger failure promptly; they
qualify kernel enforcement mechanisms, not 256 MiB/120-second workload sizing.
All privileged writer hooks in these child fixtures are explicitly simulated.
No host account enrollment, production configuration or exam service was touched.

Reproduce from ssh-server with `EXAM_COLLECTION_USER_SYSTEMD=1
EXAM_COLLECTION_USERNS=1 go test -race ./...` (one command; isolated local host
support required). The new slice passes systemd-analyze verification. The parser
also reports a pre-existing removed CPUAccounting option in exam.slice; this is
not a collection-worker error. Local root sudo requires a password; do not claim
installed root/PAM/real SSH-writer qualification from these unprivileged tests.
Combined real privileged PTY survival, larger concurrency/storage sizing,
initialization isolation, interrupted cleanup and full end-to-end release/CLI
qualification remain release gates. Continue independent approved work meanwhile.
