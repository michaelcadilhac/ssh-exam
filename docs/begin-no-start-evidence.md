# Fresh Begin requires consistent no-start evidence

October23,2026. Local correction, not deployed. The actual entry is the
authenticated native `POST /api/agent/grant-begin` callback. No management
capability, database migration or execution permission is added.

`PREPARING`, `AVAILABLE` and a pending intent were insufficient: a contradictory
restore could also retain an interval, protected submission, registered owner
or consumption on another claim. The callback signed a new Begin response in
seven reproduced cases. The eighth fixture initially violated the unique
unresolved-claim index; corrected to a retired claim with a consumed intent, it
also reached the callback and wrongly returned200. The index was never disabled.

The callback now shares cancellation's exact claim/revision/settings and
whole-grant no-start verification, including registered ownership. Refusal occurs
before capture verification and `verified_at` publication. Original attempts,
claims, intents, sources and grants remain unchanged; no clock is consumed.
The error directs operators to inspect native status and preserve history.
Never clear contradictory history or reset a grant to force admission; reconcile
the matching native outcome using the existing inspection/recovery procedures.

State review: this is a synchronous read-only guard with no new pending state,
reservation, worker or crash/restart behavior. Existing positively committed
start recovery bypasses unused-Begin verification and retains its original
interval. Old already-signed replies retain the existing exact native
intent/one-use/freshness fences; this change neither extends nor reissues them.
The shared cancellation guard also refuses contradictory registered ownership.

Focused authenticated HTTP/signature/JPEG fixture:10 PASS1.43s, including valid
fresh Begin and all eight refusals with unchanged attempt/grant/verification
metadata. This fixture does not run real SSH or privileged containment. Full
application suite:551 PASS/100files291.46s, including actual synthetic SSH/grant
Begin and cancellation workflows. Typecheck and server build pass. Browser/
client/native bytes are unchanged, so their existing qualification is applicable
to those unchanged artifacts only. Current unrelated C3 native WIP requires its
own qualification; it is not part of this correction.

Logs: `/tmp/ssh-exam-begin-contradiction-{red,other-red,focus,app,types,build}.log`.
The first RED includes the disclosed fixture failure; the corrected other-claim
RED positively reaches HTTP200 before the fix.
