# Pause alert correction and Edge compatibility

Revision **2bd25c8** was deployed to https://ssh-exam.cadilhac.name/ on
2026-10-18 at 20:18:54 UTC.

## Behavior

Pausing intentionally disconnects student SSH. That can cancel the outstanding
lock-command reply; it is not evidence that the class agent stopped. Disconnected
command transports now have a distinct internal error type. The original
`Exam interrupted` email remains; an expected disconnect no longer generates the
misleading `Class agent unavailable` follow-up.

Unconfirmed lock commands retain an audit event named
`lock-acknowledgment-pending`, recording the requested generation and either
`ssh-disconnected` or `command-failed`. Unexpected command failures still generate
`Exam pause confirmation pending`, explaining the uncertainty and the local
watchdog. Neither emails nor the new audit detail include raw exception messages
or credentials. Signed callbacks still supply authoritative class-server status.

Immediate input blocking, SSH disconnection, local execution leases, deadlines,
collection and instructor-authorized recovery are unchanged. The compatibility
warning, sign-in notice, fullscreen keyboard-lock error and current browser guidance
now explicitly include desktop Microsoft Edge. Capability and permission checks
remain mandatory.

## Validation

- All **180 unit/integration tests**, typecheck and production build passed.
- Regressions cover cancellation of a real browser command on connection close,
  the interruption-only email for a disconnected pause, a distinct alert for other
  failures, unchanged deadline/locked state and secret-free diagnostics.
- **Nine Edge browser checks** passed locally: compatibility failures, visible
  fullscreen errors, socket recovery, active reload and delayed monitoring replies.
- **Two native Edge tests** passed with and without webcam requirements, including
  actual fullscreen/display capture/Keyboard Lock, browser WASM SSH with fixture MFA,
  terminal input, multiple panes and finish. The isolated Linux display, synthetic
  camera, automated permissions and local MFA fixtures do not qualify Windows or
  real DePaul phone approval; see [compatibility evidence](compatibility.md).
- **Eight checks against the deployed frontend passed in Edge**: unsupported
  browser messaging, brief socket recovery, active reload/input blocking and delayed
  monitoring replies. Recovery API/WebSocket responses were locally intercepted
  fixtures; production student state was not modified by these checks.
- Public HTTPS readiness is production-ready with notifications enabled and
  maintenance false. The frontend checksum and all four changed server-module
  checksums match the locally tested build. CSP is present.

## Deployment and recovery

The normal marco checkout, Compose image and systemd service were used. No student
preparation, active/locked attempt or unresolved collection was present at cutover;
this was checked again after stopping the service and before taking the consistent
offline backup. No student attempts were reset. Nginx, private configuration, SMTP,
sandbox, administrator access and class-server binaries were unchanged. No csc-sys
installation/restart was required for these webserver and frontend changes.

- Image tag: `ssh-exam-workspace:pause-alert-2bd25c8`, also tagged as the standard
  `ssh-exam-workspace:1.0.0` service default.
- Image SHA-256:
  `ffdd06395a2009329b1d51b94c86d1f0a153ff99a60281e0091e355f24978473`.
- Frontend: `/assets/index-BV-uhbr8.js`, SHA-256
  `f9fa8dc8e28eb24aa55a727c7bcf0b92bb98afa8ade0a90699a58a97ef28ecbf`.
- Lifecycle module SHA-256:
  `c3230c2fd06eb760718f0f3656e23c02d50565c6588d301d90446b4d6f537a0a`.
- Backup/receipt on marco:
  `/var/backups/ssh-exam/20261018T201847Z-pause-alert-tgr2peqv`.

The prior image is
`8aff0fd2d91276c63fb41d2bf1839a615b2042dd3be7932a79d4a63068dbfc3a`.
For software rollback, first drain preparations/attempts, retag that image as the
standard default and restart ssh-exam. No database/schema rollback is required;
never overwrite newer attempts, monitoring records or protected submissions with
the backup. Reload student pages to pick up the changed frontend text. Existing
sent email history is preserved.
