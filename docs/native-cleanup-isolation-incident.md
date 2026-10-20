# Native cleanup isolation and October 20 recovery

## Cause

At 14:59:41 America/Chicago, the class agent secured an expired attempt's
submission and stopped its workload. systemd left the stopped scope's cgroup
directory present, with `populated 0` and `frozen 1`. The collector incorrectly
required the directory itself to disappear. It retried a ten-second wait while
holding the shared native state lock. Monitoring commands queued behind that
lock; other students crossed the fifteen-second renewal limit and were locked
at approximately 15:00:08–18. Neither the webserver nor class server restarted.

## Fix and regression evidence

Native revision `8c9fe56` accepts cgroup removal or verified hierarchical
`populated 0` as proof of termination. An empty direct process list does not prove
descendant writers stopped. Malformed/missing population data remains fail-closed.

Signed monitoring renewals now have their own per-attempt lock and durable,
root-private journal. They do not acquire the shared collection lock. Signature,
account/SSH registration, verified transport, active state, deadline, prior live
lease, boot, generation and nonce checks remain enforced. Publication is followed
by a revocation recheck; consumers cannot apply a lease to a new transport or
pause generation. Nonce replay checks survive restart. The watchdog rereads the
journal after slow work and immediately before deciding that a lease expired.

The complete native race suite and vet passed. Regressions cover an indefinitely
blocked real protected-finalization path, both successful and failed termination;
another authenticated attempt still renews within one second. A watchdog delayed
past its old in-memory expiry consumes the new journal and keeps that attempt
active. Tests also cover empty frozen scopes, descendant writers, malformed status,
replay/restart, forged scope/signature, revoked registration, boot changes, pauses,
finished attempts and stale generation/transport journals.

## Live deployment

Installed at `2026-10-20T20:16:38Z` (15:16:38 America/Chicago), binary SHA-256:

```text
9e4c3d09834237f07deecb890acfc18a2a278aceeda060e1727cff404ecb736c
```

Protected backup and receipt on csc-sys:

```text
/var/backups/exam-agent/20261020T201633Z-cleanup-isolation-4s9twgfm
```

The independent watchdog was replaced first (PID 2030212). A replacement command
listener, `exam-agent-live-upgrade.service` (PID 2030214), then inherited the
canonical agent's resolved service restrictions and serves the same Unix socket
with `-handoff`. The existing daemon (PID 1655586) remains alive for its open PTY
bridges. No SSH daemon, relay, webserver or existing terminal bridge was restarted.

All thirteen attempts active at the handoff retained their state, generation,
timing and workload records, and each published a fresh authenticated journal.
At 20:24 UTC, sixteen attempts were active with fresh leases and there had been
no new hold events since deployment. The web container retained its 15:57 UTC
startup and zero restarts. Public readiness was production ready, maintenance off,
notifications enabled. No new native errors appeared in the replacement services.

## Incident compensation

The instructor explicitly waived individual approval for this incident. The four
still-unfinished paused attempts received audited native clock resets, preserving
their original deadlines and crediting repair downtime. Their release allowances
are remaining time at the original interruption plus ten minutes, rounded upward
to whole minutes by the clock-control interface. Individual allowances, attempt
identifiers and administrator approvals are retained in the protected audit trail.

Only these four generation-1 interruptions are automatically preauthorized. A
bounded incident helper refreshes their existing short grants until they resume,
expire, advance generation, or four hours elapse. It changes no future violation
policy and does not bypass password/MFA, capture or readiness requirements.

Five paused attempts expired before repair completed. Their original submissions
remain completed and immutable. Separate attempts were created under
`midterm-recovery`, using the same template, individual monitoring settings and
saved work restored from checksum-verified protected archives. Student identities,
attempt links, checksums and individual allowances remain in administrator-only
recovery markers and the authenticated dashboard audit, not this repository.

Recovery duration is the original remaining seconds plus 600 seconds, rounded
up to the next second. Only regular manifest-listed files were restored into
new private workspaces; every restored file was independently checked for size
and SHA-256. All original archive checksums were unchanged. Original account
restoration was verified before making the new preparations available. The
normal single-attempt constraint and recovery authorization policy were not
globally weakened, and no database schema change was made.

These students sign in to `midterm-recovery`, complete preflight and begin their
saved-work continuation. The four unexpired students reconnect to `midterm`.
Instructor approval is already provided; normal SSH/MFA is still required.

The incident waiver helper also queues the compensated countdown when each of
the four original attempts actually returns to ACTIVE. The normal authenticated
heartbeat path delivers that reset, so waiting for reconnection does not consume
the refunded allowance. This is an incident-scoped administrator operation,
not a permanent automatic-approval policy.

## Additional admission repair

A separately reported student was blocked by an abandoned, unstarted `test`
preflight while trying to enter `midterm`. The root administrator used
`examctl cancel ATTEMPT --reason REASON`, followed by
`exam-agent -config /etc/exam-agent/agent.json -reconcile`. When callback delivery
timed out, the verified native cancellation was synchronized through the
webserver's lifecycle/monitoring code by an administrator script. No timed exam
was cancelled. Native verification at 20:28 UTC showed that student ACTIVE in
the midterm; all thirteen handoff-cohort attempts also remained ACTIVE at their
original generations with fresh monitoring leases.

The cancellation itself was through examctl. Incident clock adjustments and
webserver continuation approvals used administrator helpers; those operations
are not currently exposed as examctl subcommands.

## Subsequent cohort consolidation

The instructor subsequently requested that the entire nine-person interruption
cohort use `midterm-recovery`, superseding the split recovery arrangement above.
The four unfinished attempts were paused, checkpointed and transferred in place
on both servers. Their attempt IDs, saved work, original start/deadline and account
policy ownership remained unchanged. Only those students' old login sessions
were revoked; their new recovery enrollments and generation-scoped approvals were
created without restarting services or disturbing unaffected exams.

Saved files were verified against the protected pre-transfer checkpoints. The
four transferred clocks use the original interruption's remaining time plus ten
minutes, rounded upward to whole minutes by the clock interface. A scoped helper
refreshes approvals and reapplies that allowance at continuation; a later explicit
instructor time adjustment takes precedence. The five already-created recovery
preparations retain their restored files and allowances. All nine enrollments,
native clock acknowledgments and reconnect grants were verified. Callback delivery
drained normally after the transfer; old pre-transfer snapshots are recorded as
historical sequence entries and cannot overwrite the administrator's transfer.

Student identities, checkpoint paths and individual allowances remain only in
the protected operator audit and recovery records.

## Deferred recovery correction

The instructor subsequently required recovery time to remain untouched until
each student actually begins recovery, even if they return after the old or
compensated deadline. This supersedes the transferred live clocks and temporary
approval/clock-reset helpers described above.

The four transferred originals were returned to their original exam label before
being collected through the normal protected finalizer. Their original timing and
work history remain intact. The instructor explicitly approved the four audited
root-only access overrides needed to hand these secured originals off to separate
recovery attempts. This is an incident exception, not a change to normal interval
restrictions. Other students and administrator access remain unchanged.

All nine recovery entitlements are persisted under the root-private class-server
`recovery-preparations` directory, independently of attempt state. Each binds exam,
account/UID, exact remaining seconds at the original interruption plus 600 seconds,
the original submission UUID/checksum, creation timestamp and administrator reason.
The recovery exam's start window remains open for delayed returns. No live attempt,
deadline, expiring authorization grant or helper process is needed while waiting.

The normal sign-in creates a fresh preflight. The independent fifteen-minute
preflight expiry remains in force; abandoning it does not consume the recovery
entitlement. Only Begin commits the interval, using the full individual allowance.
The agent then restores manifest-listed regular files from the verified protected
original into the new private workspace. It rejects unsafe paths/links, unexpected
or missing files, changed hashes and identity/allowance mismatches. It never copies
the possibly changed original live workspace or overwrites an existing workspace.
A durable consumption marker plus persisted start history prevents a second grant
after crashes or restarts. Normal monitoring and subsequent interruption policy
still apply after the new interval starts.

Regression tests cover delayed start across restart, expired preflight followed
by a new preparation, exact wall/monotonic deadlines, immutable original archives,
one-use crash fencing, invalid grants, damaged sources and unsafe archive entries.

Deployed at `2026-10-20T21:00:39Z` using an additional handoff listener,
`exam-agent-deferred-recovery.service` (PID 2176941). Installed binary SHA-256:
`2ae1dca01f903ca085a851aca665e049d8befe964450e50f83d14c44501cfc6d`.
Protected backup: `/var/backups/exam-agent/20261020T210039Z-deferred-recovery`.
The prior two gate daemons and independent watchdog were left running, with
unchanged PIDs and zero restarts; the webserver was not restarted. All seventeen
other active attempts remained ACTIVE with unchanged generations and timing, and
no new lock events. One student changed their terminal-pane list normally during
verification. The full native race suite and vet passed. The nine enrollments
were checked against their root entitlements and protected archive checksums;
unused, never-contacted placeholder preparations were retired with audit records,
and their pending false cleanup notices were cancelled. No recovery attempt or
countdown remained running after preparation.

## Completing the live handoff / rollback

Do not stop either PTY-owning daemon during remaining exams. In a fully drained
window (including preflights and unresolved collections), stop both temporary
`exam-agent-live-upgrade` and `exam-agent-deferred-recovery` services, then restart
the canonical `exam-agent` service.
Its installed binary is already patched. Then remove the temporary units and the
`live-preserve.conf` RuntimeDirectory-preservation drop-in, reload systemd and
verify command admission, watchdog and public readiness. The temporary unit is
not enabled for boot; normal boot uses the patched canonical daemon.

Rollback likewise requires a fully drained window: restore the previous binary
from the protected backup, remove the temporary handoff service and restart the
canonical gate/watchdog. Keep current authoritative state, timing resets, audit,
lease journals, original submissions, recovery entitlements/consumption markers
and recovery work. Never restore an old
state snapshot over post-incident student work. Old code does not consume the
independent lease journal, so never downgrade a watchdog during active exams.
