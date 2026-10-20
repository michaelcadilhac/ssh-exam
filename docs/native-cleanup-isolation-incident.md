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

## Completing the live handoff / rollback

Do not stop either PTY-owning daemon during remaining exams. In a fully drained
window (including preflights and unresolved collections), stop the temporary
`exam-agent-live-upgrade` service and restart the canonical `exam-agent` service.
Its installed binary is already patched. Then remove the temporary unit and the
`live-preserve.conf` RuntimeDirectory-preservation drop-in, reload systemd and
verify command admission, watchdog and public readiness. The temporary unit is
not enabled for boot; normal boot uses the patched canonical daemon.

Rollback likewise requires a fully drained window: restore the previous binary
from the protected backup, remove the temporary handoff service and restart the
canonical gate/watchdog. Keep current authoritative state, timing resets, audit,
lease journals, original submissions and recovery work. Never restore an old
state snapshot over post-incident student work. Old code does not consume the
independent lease journal, so never downgrade a watchdog during active exams.
