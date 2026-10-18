# Monitoring confirmation ordering fix

Deployed revision **2e232b1** on 2026-10-18 UTC to
https://ssh-exam.cadilhac.name/.

## Cause and correction

The student WebSocket handler first applied the exam snapshot ordering check and
returned immediately if HTTP polling had already supplied newer state. That return
also skipped refreshing the monitoring acknowledgment timer. Repeated ordinary
reply ordering could therefore expire confirmation on a healthy socket, including
while starting an exam.

The original build reproduced the bug with three-second WebSocket response delays
and normal HTTP polling: it unnecessarily disconnected/rebound preflight after the
15-second threshold. The fixed build stays connected through that scenario, a
9.6-second activation and subsequent delayed pre-activation snapshots, then accepts
terminal input. An additional reconnect test confirms page ownership even when an
HTTP response overtakes the fresh bind acknowledgment.

Connection confirmation is now independent of state ordering. Bind and heartbeat/
preflight requests use one-use, connection-local confirmations measured with the
browser's monotonic clock. Only a matching reply less than 15 seconds old confirms
liveness. HTTP replies, unsolicited/replayed acknowledgments, expired requests and
retired sockets cannot do so. Exam state still passes the existing snapshot,
generation, deadline and local-lock checks. The timeout and instructor recovery
policy were not relaxed. Begin also requires a currently confirmed connection.

Incident audit/log diagnostics record numeric acknowledgment age and rejected-state
snapshot counts. Confirmation values and credentials are not logged.

## Release and verification

- Image: `ssh-exam-workspace:monitoring-2e232b1`, also tagged as the usual
  `ssh-exam-workspace:1.0.0` systemd default.
- Image SHA-256:
  `8aff0fd2d91276c63fb41d2bf1839a615b2042dd3be7932a79d4a63068dbfc3a`.
- Frontend: `/assets/index-JAQXHK2u.js`, SHA-256
  `ddace67b919c3c0ce30aceafc95424fae21dd54ff04b807bbbd9f2a1141b229c`.
- All 178 web unit/integration tests, typecheck and production build passed.
  Coverage includes real authenticated gateway confirmation echoes, one-use/replay
  checks, exact timeout boundaries and retired-connection isolation.
- Recovery/transition browser checks, both reply-ordering regressions and the real
  WASM SSH/MFA/single-sign-in handoff test passed. Genuine silence still expires;
  delayed continuation and late state replies cannot authorize input.
- Four deployed browser checks passed using production frontend assets with intercepted API
  fixtures, without modifying production student state. Public asset checksums and
  CSP match the tested build. Readiness is production-ready, notifications enabled
  and maintenance false.

## Student reset and recovery

No preparing, active, locked or unresolved attempt was present at cutover. Only the
requested student's ended `test` attempt
`547ae30e-6bab-4a89-83ab-78c20cb6799e` was reset, with a durable administrator-request
`reset-attempt` audit event and revocation of that student's `test` web sessions.
Enrollment, duration and webcam settings were preserved, as were other students'
records. The student must reload the page and sign in again to load the new client.

Before resetting, the native attempt was confirmed completed, protected, past both
deadlines and released with normal account policy. Its archive was checked against
both the agent and web metadata checksum. The native attempt/archive remain on
csc-sys; no recollection or replacement submission was made. Class-server binaries,
SSH/MFA/relay settings, administrator access, nginx, SMTP and sandbox configuration
were unchanged. No native agent restart was needed.

Marco backup and deployment/reset receipt:
`/var/backups/ssh-exam/20261018T194442Z-monitoring-3sqz6ft4`.
This includes the original database and monitoring data. Drain before rolling
software back to the previous image
`926aea51dd5e9e18358726eed81a93a29633eaa0780bf5b5415e06d7473fc278`;
retag it as the default image and restart the service. Do not restore old databases
or submissions over newer attempts. The authorized reset need not be reversed for
a software rollback. Reload student clients when changing protocol versions.
