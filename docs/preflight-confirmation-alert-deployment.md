# Preflight cleanup confirmation alerts

The reported attempt expired locally at 23:01:05 CDT on October 19, 2026.
The gateway emitted a disconnected-SSH cleanup warning at 23:01:08; the signed
cancellation arrived at 23:01:30. The agent had already stopped the practice
workloads, recorded no errors and confirmed no account policy had been applied.
The warning was premature; cleanup did not require the student to reconnect.

## Behavior

Missing SSH command replies and command timeouts retain their real diagnostic
and audit record, but defer their warning until two minutes after the later of
the expected local preflight expiry or the first observed command failure. An
early logout therefore waits for the existing fifteen-minute local expiry, plus
the delivery grace; it does not raise an alarm two minutes into a healthy preflight.
Legacy preparations without a start timestamp use the first persisted failure as
the beginning of a bounded fifteen-minute expiry allowance.

The existing durable outbox stores the send deadline. An atomic audit binding
ties that notification to its attempt, so retries and webserver restarts neither
extend the wait nor duplicate the warning. There is no schema migration, new
agent polling or separate control connection. The class watchdog and signed
callbacks remain the source of cleanup status.

A trusted cancelled/unstarted report cancels the unsent warning, including SMTP
retries. A committed start also suppresses it without changing exam timing or
recovery authorization. The mail loop rechecks the current state immediately
before sending; an SMTP failure cannot turn a cancelled notification back into
a pending one. Already accepted mail cannot be recalled.

An unresolved preparation after the grace still produces a contextual warning
that **confirmation is overdue**, without claiming the agent is down or that
cleanup requires another student login. Explicit command rejections remain
immediate. Signed native cleanup errors produce a separate immediate, deduplicated
report; cancellation state alone does not conceal a reported cleanup failure.
Untrusted SSH/password/MFA text remains excluded from diagnostics and notifications.

## Validation and rollback

Regressions cover the reported short callback delay, early logout, missing callbacks,
durable restart/retry timing, late signed status, concurrent committed starts,
invalid callback signatures, genuine native errors, normal alert delivery and an
SMTP failure in flight after cancellation. Tests use synthetic accounts, generated
fixture signing keys and a mock SMTP transport, without contacting DePaul MFA or
sending instructor email.

Validation on October 20, 2026: all 277 unit/integration tests and three browser
workflow tests passed. Type checking and the production build passed. Browser
coverage includes fifteen-minute preflight expiry and fresh login, repeated
terminal closure and sign-in, and active logout with the original deadline intact.

Deploy the web image through the existing drained upgrade and preserve metadata,
outbox, audit, monitoring and protected-submission state. Native agent binaries,
SSH policy and configuration do not change. When rolling back, inspect pending
deferred preflight warnings: older code respects the stored outbox deadline but
does not cancel or recheck them on later signed confirmation. Never restore a
database snapshot over newer attempts/deadlines or signed reports.

## Production receipt

Deployed code revision `a32f3bb` on October 20, 2026 at 05:56 UTC. Image
`ssh-exam-workspace:preflight-alert-a32f3bb` has SHA-256
`f1d226b04c24a9d460003133a086dab538b18ac65caf9d667948c7fbb815d91a`.
The protected backup is
`/var/backups/ssh-exam/20261020T055605Z-preflight-alert-xc80zivy` on marco.

Public readiness confirmed production ready, maintenance off and notifications
enabled. The container was healthy with zero restarts, and both compiled server
modules matched the tested local build. All 25 attempt records retained their
state, timing and submission metadata. The reported preparation remained cancelled
without a start or deadline. Frontend assets were unchanged. The class agent and
deadline watchdog remained active without deployment or restart; mcadilha retained
its `/bin/bash` administrator shell.
