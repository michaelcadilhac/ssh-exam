# Cleanup alert disposition after confirmed success

Local correctness milestone, October 23, 2026. Not deployed.

## Workflow and reproduced defect

Entry: authenticated signed native `/api/agent/events` cancellation reports;
operator inspection: shared web notifications and `examctl web alerts show`.
Native attempt errors intentionally retain earlier cleanup/restoration failures.
The gateway incorrectly treated the first successful cleanup report containing
that history as a new current failure. It also left an existing failure episode
open after positive success. Two real signed HTTP regressions fail in 1.09 seconds;
three unresolved/missing-proof controls pass. The oracles observe a spurious
episode and pending outbox mail instead of a resolved/cancelled episode.

## Corrected behavior and state review

Only exact authenticated no-start cancellation with BOTH signed
`cancellation_cleanup_complete=true` and `policy_state=NORMAL` resolves the
cleanup-error episode and its pending mail/reminders. Missing/false cleanup or
pending/failed restoration remains unresolved; retained errors still produce an
actionable report. No timeout, CANCELLED label alone or missing reply is success.
Existing identity, chronological/grant/consumption checks run before this branch.

Keep the original error audit. Separate audit deduplication from current alert
disposition: repeated unresolved reports deduplicate through the durable episode,
but a genuine new unresolved report after confirmed resolution must open a fresh
episode even with the same retained error text. Restart/duplicate replies preserve
that disposition. No new state/operation/permission or migration is introduced.
Original clocks, account restrictions, submissions and monitoring enforcement do
not change. Already accepted SMTP messages cannot be recalled; status becomes
resolved, while unsent pending messages/reminders are cancelled through the
existing alert lifecycle.

## Acceptance and qualification

Signed HTTP callbacks cover positive success first, missing/false cleanup,
restoration pending, success after failure, restart, repeated reports and genuine
recurrence. Actual admin notification reads observe cancelled/resolved and new
pending episodes. Preserve the error audit and unchanged original account hold/
null clocks. Shared root CLI alert metadata/SMTP/reminder coverage remains required.

Focused callback checks pass 13 tests; all 36 affected callback/SMTP/reminder/
alert-management checks in seven files pass in 21.15 seconds. Server build,
typecheck and formatting pass. All **495 application tests in 93 files pass in
244.78 seconds**, including compiled root CLI/TLS workflows. Focused completion
was reviewed before broad qualification. Native implementation and browser/client artifacts are unchanged
from f8738d2, so its full native and current browser evidence still applies to
those surfaces. Do not rebuild/reassign older evidence to changed artifacts.
Their recorded hashes remain unchanged. No native/browser suite was repeated
for this gateway-only disposition change; actual signed HTTP/admin status and
SMTP/interface tests cover it. Logs: /tmp/ssh-exam-cleanup-alert-disposition-*.log.
All runners completed; no command was missing.
