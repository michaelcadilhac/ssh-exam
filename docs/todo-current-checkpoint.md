# Current local TODO checkpoint

Updated October 23, 2026. Local development, tests and commits only. **Never
push/deploy, consolidate agents or change production records/config/services.**
Stop on a missing executable; none was missing. Follow AGENTS.md.

## Current milestone: exact renewal receipt recovery — validated locally

Last validated local commit: **00c6c7f**, pending timed-owner cohort fenced before
recording IO. The working candidate connects native signed receipt recovery,
both gateway transports and loaded WASM exact-command cancellation. It recovers
only a positively committed original legacy cutoff; no query renews work, changes
time or invents confirmation after agent restart. Missing probes preserve the
original command path, with no earlier failure timeout. No retained mode enabled.

State review, runtime callers, failed controls, exact artifacts and verification:
[renewal-receipt-recovery.md](renewal-receipt-recovery.md).

- Focused native signed-entry PASS 16.495s; confirmation-bypass mutant RED 0.018s.
  Ten actual HTTP/WS/worker/SSH recovery/refusal/clock cases pass. Real SSH exact
  cancellation/full client race PASS 1.049s/1.572s; actual WASM focus PASS 12s.
- Full application PASS **524 tests / 97 files, 284.09s**. Full native race,
  resource, user-namespace, compiler and default-size IO PASS **core 431.478s /
  CLI 39.509s**. Builds, vet/types and 35 Python runner safety checks pass.
- Guarded exact-candidate timed-owner guest PASS 9 assertions, including actually
  discarded renewal reply and two exact signed queries; evidence
  `/var/tmp/ssh-exam-overlay-43b6iwk0`.
- Collector guest PASS 12 assertions, 24 healthy renewals (maximum 0.087440s),
  exact retry and unchanged intervals; `/var/tmp/ssh-exam-overlay-faydv6nj`.
  Both wrappers exit 0; all host/base preservation checks pass.
- Full browser PASS **150/150 scenarios, 15.2m**, including the actual WASM
  dropped-reply case. All runners ended; frozen source/client hashes match.

Frozen 551-file source manifest:
`/tmp/ssh-exam-renewal-receipt-qualified-source.sha256`, SHA256
`e6d98315111d0a695686202e5b850949925ce2b03762a55cf64a220db268e1b3`.
Private audited bundle:
`/var/tmp/ssh-exam-renewal-receipt-upload.ihb3080l/bundle`.
Agent `8ba2588bd917852d38063a1bb3b8c4ba53ac69ce3aead3a01d2c5401b0fc64f7`;
core test `6408147f18a2ed525fb861d2d95aba46313dd6cae28d4ea0fe830e26cffbfcff`.
Client manifest `/tmp/ssh-exam-renewal-receipt-browser.sha256` still matches.

**Exact next action:** commit this validated increment locally (all generated
screenshots restored except the preserved original below). Then continue the actual retained
policy-pause → verified hold → approved Continue workflow described in
[retained-workload-barrier-plan.md](retained-workload-barrier-plan.md), including
its source-writer map. Do not expand another unused helper chain or claim C3/C16
complete. Current policy pauses still kill shells.

## Settled decisions and remaining scope

**C1–C18 are settled; no unanswered design question.** See
[todo-design-decisions.md](todo-design-decisions.md). C16 places live monitoring/
input authority inside the ONE supervisor per user/attempt, isolated from recording
IO. C18 requires durable native retention confirmation before a saved-source grant
is usable; pending inspection/cancel/retry reserves no account or clock.

Critical live authority, all-writer stop-assisted freeze/input discard and C9
recovery remain open. So do saved-source retention/migration, legacy retirement
reconciliation, destructive cleanup, full management and installed-role/capacity
qualification. Main TODO count remains 11/38, not an effort percentage. Incident
cause is unproven. Container packaging is unverified: configured local Docker
socket is absent; no daemon start or production context was substituted.

Earlier validated scopes: ca8873b registered-page identity (029), 7bc50fe real-root
timed ownership, 3450963 collector isolation, 00c6c7f pending owner race; detailed
receipts/limits are in their feature docs and [todo-progress.md](todo-progress.md).
Fresh guarded disposable csc-sys qualification is authorized; busy/uncertain means
NO TEST. No installed host service/config/student data was changed.

[The rollout/migration/rollback plan](todo-rollout-plan.md), including the proposed
canonical/live-upgrade/deferred-recovery agent consolidation and independent
attempt-owner drain, is **unexecuted**. Preserve newer authority/receipts/history;
never stop needed PTYs or downgrade incompatible writers. Repair forward with
admission closed if a compatible drained rollback is unavailable.

Original dirty `docs/screenshots/preflight-fifteen-minute-timeout.png`: 31754 bytes,
SHA256 `144029a4ed00609c40b57f14c90ebe8888fede0d0f1cd11acda4cf1ca4b68eeb`;
backup `/tmp/ssh-exam-preserved-preflight-screenshot.png`. Never stage/restore it.
Local commits need no instructor approval.
