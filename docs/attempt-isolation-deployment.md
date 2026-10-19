# Attempt connection process isolation

Connection isolation was deployed on 2026-10-19 at **16:52:23 UTC (11:52 Chicago)**.
The implementation is `4c35e12` (following `d6eed75`); deployment configuration is
`30d4009d9d58bb183bf71b08261440112a901aee`.

## Behavior

Each login/retained attempt connection owns an OS child process. Browser SSH control,
agent signing/receipt verification, admission, command timers and connection/pane cleanup
run there, as does the fallback server-side SSH implementation. The HTTP process holds
only supervised, bounded IPC proxies and authoritative database/monitoring/notification
state. SSH clients are not instantiated in the HTTP process.

An uncaught exception, unhandled rejection, fatal signal, V8 heap exhaustion or hung
connection worker retires only that worker. Pending operations reject, its browser SSH
transport closes, its pane bookkeeping is removed and its active attempt is locked.
Regular exam recovery needs a new instructor authorization and fresh SSH authentication;
the attempt, saved work and original/current deadlines remain intact. There is no
automatic worker restart with retained credentials. Sandbox's automatic authorization
policy is preserved. A failure during unstarted sign-in/preflight is reported as such
and does not invent an instructor-approval requirement or start an exam clock.

Lease failures are scoped to their initiating generation and connection: a delayed failed
lease cannot produce a duplicate pause or interrupt a replacement authenticated connection.
Retired child messages cannot revive old panes or disturb a newer login. Exceptions in
minimal proxy event/teardown callbacks are contained too. Intentional logout, finish and
service shutdown do not create worker-failure alerts.

The surviving supervisor audits the failure and enqueues one contextual email identifying
student, exam, attempt, unique event and a fixed cause/exit diagnostic. It uses the existing
durable retry outbox and configurable `smtp.to` recipients. It does not log/email worker
exception text, stdout/stderr, terminal contents, request arguments or credentials. A
separate event ID prevents distinct failures from being coalesced during an SMTP outage.

Workers have a 64 MiB V8 heap limit, reduced thread counts, a 10-second heartbeat bound,
125-second supervisor RPC bound and 2-second shutdown kill fallback. IPC is capped at
8 MiB per packet/16 MiB queued in each direction, with at most 64 pending operations;
HTTP control queues and slow control sockets also have byte bounds. Admission defaults
to 32 workers (`connectionWorkers`, 1–128); at capacity new logins are refused without
evicting existing students. Compose's PID allowance is 1,024 and core-file soft/hard
limits are zero, inherited by workers. Provision memory/PID budgets before increasing
capacity. Linux workers raise their OOM preference above the HTTP supervisor.

These boundaries contain attempt connection failures. The host/container, shared HTTP
APIs, metadata storage, monitoring image processing, network and mail infrastructure
remain shared services; this is not a separate machine per student or a malicious-code
sandbox. Existing best-effort JavaScript credential-erasure limitations still apply.

## Verification

- Typecheck, production build and **246 unit/integration tests across 39 files** passed.
- Real child-process/SSH tests cover fatal failure during an outstanding operation,
  pending-request/pane cleanup, a working sibling terminal and signed commands, late
  child replies, throwing proxy listeners, intentional shutdown, admission capacity
  and slot release. Existing secret-free logging, password reuse, MFA and authentication
  cleanup checks pass, with HTTP cancellation now checking actual child exit. Direct
  in-process SSH tests retain the mutable-buffer/callback cleanup assertions.
- A two-student browser test uses the actual WASM SSH client and disposable SSH/relay
  hosts. It injects **five actual faults**: uncaught exception, unhandled rejection,
  SIGKILL, blocked worker event loop and heap exhaustion. After each, the other student's
  server PID, worker PID, active state, terminal echo and original/current deadline
  remain unchanged. Saved work survives the affected student's authorized fresh SSH
  recovery; a consumed authorization cannot authorize the next failure.
- That workflow verifies one email per failure, student/exam/attempt context, no secret
  text and no misleading class-agent outage alert. A temporarily rejecting SMTP fixture
  proves durable queuing, retry and actual delivery. The full workflow was repeated
  against the final implementation, together with two-channel recovery; both passed.
- **Seven existing browser regressions passed**: complete browser closure, reload during
  pending terminal creation, the same healthy server beyond the former 120-second
  timeout window, active reload/instructor recovery, brief two-channel reconnection,
  repeated shell exits/pane close/sign-out/fresh login/finish, and direct active logout.
- The exact production image was tested in a disposable network-disabled container.
  After installation an isolated process imported the deployed modules, started two
  actual compiled workers, killed one and verified surviving sibling signed commands
  and pane input, full failed-worker cleanup and silent intentional exit. No production
  student records or live student connections were used by that check.
- Deployed checksums match the local build. Public readiness reports production ready,
  notifications enabled and maintenance disabled. Systemd is active, the container is
  healthy and restart count is zero. Fixture runtime endpoint is HTTP 404; fault injection
  and test SMTP servers are not part of the production build.
- A clearly labelled production alert-path test was accepted for
  `michael@cadilhac.name`, no rejected recipients, SMTP response
  `250 2.0.0 cc4ee0f8 Message accepted for delivery`. This confirms SMTP acceptance,
  not independently observed inbox delivery. Actual failure emails use the durable outbox;
  production SMTP recipients remain configurable.

Browser permission/capture and phone-MFA behavior are simulated by the disposable fixtures;
these checks do not claim a live student's DePaul phone approval was exercised. Native
class-server agent/relay binaries, account policy and deadline collection code did not change.
Frontend and WASM assets are unchanged from the previous deployment.

## Deployment and rollback

One abandoned preflight had no browser contact for over ten hours. The class agent
independently confirmed PREPARING with no start/deadline; its normal audited cancellation
path returned CANCELLED_BEFORE_START, policy NORMAL and no remaining units, delivered by
signed callback. No timed attempt was reset or interrupted. Both live and offline cutover
checks then found no preparing, activating, active, locked or unresolved collection attempts.
Administrator access, sandbox, monitoring and protected submissions were preserved.

- Image: `ssh-exam-workspace:attempt-isolation-4c35e12`, also tagged as the normal
  `ssh-exam-workspace:1.0.0` service default.
- Image SHA-256:
  `ddb8071015526b55c745ca1efe158f6508c7d4ff2c60004d11082ad39515c8c2`.
- Supervisor proxy SHA-256:
  `a263db9d39795a3461bd142df66a8244fbb81a0b99cb4ac7087a0cd23fb76d33`.
- Worker SHA-256:
  `1736a318ca9743270eccfbc9eba8d0d1a60cba397f0c3830cb04ff4ef11f8ba1`.
- Application SHA-256:
  `2692f840fb50c0cd7fbe1d5517e26159424f70b30a99f299cb4adedc89ff8c17`.
- Private consistent backup/receipt:
  `/var/backups/ssh-exam/20261019T165212Z-attempt-isolation-q35bx_ak`.
- Previous image SHA-256:
  `037c0b3d9ef0111aa01b35947124d8d305634db4ebd70bf061920a2d6713a4c4`.

Rollback requires draining attempts, retagging the previous complete image as the service
default and restarting ssh-exam. Preserve current metadata, monitoring, protected work and
authoritative deadlines; no database/schema rollback is needed. Retain zero core-file limits.
The old image removes connection-process isolation. Apply the established monitoring-backup
expiration policy to the private backup.
