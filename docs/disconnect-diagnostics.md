# Disconnect diagnostics and relay startup budget

November6,2026. Explicitly authorized implementation, push and deployment.
Implemented locally; final qualification and production rollout are pending.
All three new real-WASM workflows pass83s total:16.5s relay delay, real60s expiry
with outer-supervisor/reference and actual SSH close/IPC privacy. Current isolated
whitelist/sink regression passes. Frozen-source full suites/release gates follow.
Historical incidents remain documented in disconnect-failures-review.md: absent
close/cutoff information cannot be reconstructed by installing this change.

## Student and operator outcomes

The actual browser WASM relay dial/ticket/ready operation now has60seconds rather
than15. SSH/MFA has its existing bounded stage. Successful authentication/transport
setup does not start an attempt, consume its permission or alter its allowance.
Existing monitoring freshness, positive ownership, holds and deadline rules stay
unchanged. A diagnostic timeout is not a student violation.

The relay records one structured close outcome for each accepted connection:
first observed copy direction, ping failure, relay shutdown/lifetime, upstream
dial or ready-send failure; fixed error class, safe WebSocket close code, duration
and byte counts. Both copy workers and the ping worker are joined before cleanup
completes. The diagnostic does not contain SSH traffic, tickets, signatures,
nonces, credentials, MFA answers, user-supplied error text or destinations.

A24-character SHA256 prefix of the signed payload's base64 text correlates the
relay outcome with gateway observations. It conveys no reusable ticket or work
authority. The gateway obtains this reference from its own issued ticket.
The current browser SSH watcher retains a sanitized Wait/keepalive cause instead
of discarding it; failed pane/command operations retain a fixed stage/category
through the existing browser-control and isolated-worker interfaces. Old workers
and retired SSH transports cannot affect replacements. Extra browser fields and
unknown categories are rejected. Repeated hints are deduplicated and bounded;
the final close report has a reserved slot. Sink failure cannot fail an operation.
A single started observation carries the reference to the surviving connection
supervisor, which retains it with the operation-timeout/exit record even when
its own deadline expires before the browser or worker can reply.

Browser observations are explicitly untrusted diagnostics. They do not authorize
work, lock/unlock an attempt, alter monitoring facts, send a misconduct alert or
bypass signature/owner checks. The existing actual loss handling is unchanged.
Host-key-pin alerts keep their separate trusted refusal workflow.

At a real native ACTIVE→LOCKED transition, the existing audit and service journal
record the observation stage/error class, generation/clock revision, positively
observed SSH exit and writer hold, and—when available—the last native authority
sequence/revision, cutoff/deadline BOOTTIME values, fixed causes and publication
state. Unavailable authority is recorded as unknown, never manufactured. Original
user-facing technical-hold wording remains unchanged. The gateway separately
records the same generation's last screen/webcam arrival and contact metadata.
These arrival timestamps are not native execution permission. No capture pixels,
terminal contents or editor data are read for these diagnostics.

## Investigation workflow

Use `sudo examctl info ATTEMPT --read-only` and
`sudo examctl panes supervisor ATTEMPT` to inspect current native state/ownership.
These remain observations, not authorization to thaw or reopen anything.
Inspect the incident time window in existing operational logs:

```sh
# Class server: structured relay outcomes and native hold diagnostics.
sudo journalctl -u exam-ssh-relay.service --since 'YYYY-MM-DD HH:MM' --until 'YYYY-MM-DD HH:MM'
sudo journalctl -u exam-agent.service -u exam-deadline-watchdog.service --since 'YYYY-MM-DD HH:MM' --until 'YYYY-MM-DD HH:MM'
# Web server: SSH transport/monitoring hold observations.
sudo docker logs --since 'YYYY-MM-DDTHH:MM:SS' --until 'YYYY-MM-DDTHH:MM:SS' ssh-exam-app-1
```

Correlate `reference` in relay output with `relay_reference` in gateway output;
then use attempt/generation and timestamps to join native observations. Native
audit.ndjson beneath the configured state directory and gateway audit preserve
the same safe facts for postmortem review. First observed completion identifies
what the relay observed, not necessarily the original physical network fault.
EOF, timeout, worker failure and missing evidence must not be called misconduct.
No new management setting, remote control service, database schema or protocol
for execution authority is introduced.

## Acceptance and release plan

Evidence: var/collection-tests/disconnect-diagnostics.20261106/.
Focused browser/gateway/input/privacy checks13pass, current browser-Go/client
races and relay close/privacy/race checks pass. Actual PTY/supervisor tests cover
a real23-second evidence-production gap without a new clock/generation/hold,
actual proof expiry, pinned SSH exit and clock recovery. The initial unavailable-
authority oracle wrongly demanded positive facts; its corrected exact retry
passes and no production enforcement changed. Final real-browser tests use a
private relay to delay worker sockets: the first page-level interception did not
reach those sockets. Observed UI/Origin/CSRF behavior is asserted rather than
turning locator or fixture refusals into product conclusions. The real60s case
also exposed an omitted isolated-control message whitelist entry and an outer-
supervisor timeout preceding the worker report. Both paths now carry the reference
and fixed stage through the surviving process. Native/app enforcement is unchanged.
A separate real23s relay-read/pong stall passes against the actual60s ping budget;
only the first-ping cadence is accelerated in that test.

Before rollout: freeze web/WASM/five native artifacts and revised installer scope
`disconnect-diagnostics-v1`; run full application, affected browser and native race/
actual-supervisor checks. Qualify exact image/schema37 preservation, delayed signed
startup, current-data recovery and existing guarded five-binary relay/nginx install.
Reuse verified immutable recording backup coverage. Deploy only after a fresh
complete student/unfinished-attempt drain; admin-only signout is already authorized.
Preserve relay trust/config/service files, original snapshots/history and CURRENT
data. Recovery uses the matched candidate and qualified forward resume; older
writers or historical DB restoration cannot reopen admissions. Public readiness,
exact assets, loaded roles, diagnostic availability and preserved records gate
completion. No human live student/MFA acceptance is claimed by synthetic tests.
