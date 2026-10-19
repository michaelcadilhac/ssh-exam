# Browser closure and reload recovery audit

Implementation revision **76dd88b99133af6c2c8789c17127a25107bcc6d4** was deployed
on 2026-10-19 at 06:10:26 UTC (01:10 Chicago time).

## Finding and correction

The browser SSH control connection previously enforced its 15-second reconnect grace
only through a timer. If event-loop timer dispatch was delayed, a late bind could
clear the overdue timer and extend that grace. Attach now checks monotonic elapsed
time before clearing the timer. At or beyond 15 seconds it retires the connection and
requires fresh authentication. The short control-channel recovery path remains valid;
terminal input stays blocked until both monitoring and SSH control recovery complete.

Closing the entire browser, reloading an active attempt, and reloading while a terminal
is opening were tested. Old terminals and pending opens are retired. Recovery for a
regular exam requires instructor authorization and fresh SSH authentication, with the
attempt and original deadline unchanged. Reloading the locked screen preserves an
unconsumed authorization; a subsequent interruption requires a new one. Old control
tokens cannot reconnect, including after a replacement login. Completed attempts
cannot reopen through the login/recovery path. Sandbox policy is unchanged.

An existing reload test suppressed sendBeacon, while actual incident reports used the
monitoring WebSocket. It now suppresses that actual incident transport so server-side
abandonment detection is exercised without relying on a cooperative page-exit report.
New fixture-only instrumentation reports actual admitted SSH panes and the test server
PID; it is absent from the production server.

## Verification

- Typecheck and production build passed; **241 unit/integration tests passed** across
  38 files. Boundary tests cover 14,999 ms, exactly 15,000 ms and 20,000 ms without
  dispatching the timer, including complete pending-operation and pane cleanup.
- Three new sequential browser tests passed using the actual WASM SSH client and
  disposable local SSH/relay hosts: complete browser-context closure without an
  incident report; reload during an unacknowledged terminal open; and server stability
  for 125 seconds after the latest reload/completion cleanup. The same server PID
  remained healthy and no stale SSH panes remained beyond the former 120-second
  orphan-request failure window.
- Recovery checks include denied reconnection without approval, an approval preserved
  across a locked-page reload, a new approval required after another interruption,
  retired control-token rejection, preserved saved work, unchanged deadlines and
  terminal input blocked until authorized restoration. Finished-attempt sign-in is
  rejected before requesting another password.
- Existing active-page reload and two-channel brief network-recovery browser tests
  also passed. The pending-open/completed-attempt scenario was repeated separately.
- Isolated processes importing the deployed backend passed both short/expired grace
  checks and the prior terminal-close, natural-exit and shutdown assertions. These
  checks did not touch production attempts or SSH sessions.
- Public readiness reports production ready, notifications enabled and maintenance
  disabled. Systemd is active, the container is healthy and restart count is zero.
  The fixture runtime endpoint returns HTTP 404 in production. The deployed backend
  module checksum matches the tested local build.

Browser tests simulate capture/keyboard permissions and use disposable SSH/MFA
fixtures; they do not claim a live student's DePaul phone approval was exercised.
No class agent, relay, SSH daemon, account configuration or collection policy changed.
The frontend and WASM assets are unchanged from the preceding deployment.

## Deployment and rollback

Both live and offline cutover checks found no preparing, activating, active, locked,
finalizing or failed-collection attempts. No active attempt was interrupted. State and
configuration were backed up privately before replacing the image. Administrator
access, sandbox, monitoring and secured submissions were preserved; no schema change
or attempt reset was needed.

- Image: `ssh-exam-workspace:browser-recovery-76dd88b`, also tagged as the normal
  `ssh-exam-workspace:1.0.0` service default.
- Image SHA-256: `037c0b3d9ef0111aa01b35947124d8d305634db4ebd70bf061920a2d6713a4c4`.
- Browser SSH backend SHA-256:
  `164ff8b71b412a25bed173b0d49b69b288287d4e27b2880e6ee1f57717e8fe90`.
- Private backup/receipt:
  `/var/backups/ssh-exam/20261019T061016Z-browser-recovery-m88yagj9`.
- Previous image SHA-256:
  `e37da4e7e46be5c2c10f8c5c6a7b2bf4236d603cabd28f7f0959e4cd2083ce5a`.

Rollback requires draining attempts, retagging the previous complete image as the
service default and restarting ssh-exam. Preserve current data, secured submissions,
monitoring and authoritative deadlines; do not restore an older database over newer
attempts. Apply the established monitoring-backup expiration policy to the private
backup.
