# Retained Continue after a partial transition

October24,2026: implemented/tested locally. Guard OFF; no deploy.
Actual entry: signed monitored Begin/framed pane -> CLI policy hold -> finite
approved Continue -> failure after first real cgroup thaw or SIGCONT -> verified
re-hold -> fresh same-authorization retry. No new service or public protocol.

## Confirmed defect and bounded correction

RED10.031s in both actual owned-scope cases: the failure correctly revoked input/
authority and re-held work, but recovery then sent the NEW live actor as the
policy authorization's previous owner. The gateway correctly refused it: its
unconsumed authorization still names the original owner. Receipt:
/tmp/ssh-exam-partial-transition-red.log. Local SSH ancestry is a test seam; the
scope/PTY/native IPC/TLS and kernel transitions are real.

Preserve the original previous owner in the existing in-memory prepared intent.
The existing local reply separately returns HeldOwner from the current live
supervisor, rechecking its exact prepared nonce/owner. Commit verifies the fresh
signed proof against the original authorization, and the root IPC against the
actual held actor. Missing/mismatched actor metadata refuses before another
canonical commit. No gateway ownership/expiry check is weakened. No positive
permission comes from saved metadata. This is NOT a new allowance: the original
started clock continues throughout pause/failure, without refunds or reopening.

## Operator/student workflow

Inspect `examctl info ATTEMPT --read-only`, `examctl panes supervisor ATTEMPT` and
`examctl panes reports ATTEMPT`. ACTIVE/resuming is a pending operation, never a
claim that work may run. The supervisor's held/unverified observation and original
interval must remain inspectable. Repair actual infrastructure/monitoring and
retry Continue on the same authenticated page/SSH while its original explicit
authorization remains valid. New authorization uses existing audited web/examctl
interruption management; failure cannot invent one. An intentional `examctl pause
ATTEMPT --reason ...` cancels pending continuation and preserves its hold/clock;
continue only with the resulting current approval. Never clear state, reset time
or restart an owner with needed buffers to bypass repair.

## State review before artifact qualification

| Boundary | Required behavior / inspected caller |
| --- | --- |
| Original held owner | Same live peer/claim/page, original authorization previous-owner; no authority from disk. |
| Canonical ACTIVE/resuming | Existing pending state; original clocks/holds/grant/history. Native admission requires RetainedHold empty in access.go before minting a pane token AND before launch. A pre-pause token has been revoked/retired by its owner binding. |
| First accepted thaw/SIGCONT | Fresh signed authorization/coverage already verified. Any later error revokes every input gate/live authority and schedules the same positive stop/freeze barrier; never mark a failed transition complete. |
| Verified re-hold | Keep original authorization owner distinct from current live actor. Retry needs a fresh signed nonce/proof, unchanged peer/scope and still-valid authorization; no new time/attempt. |
| Cancellation | Existing pause increments the policy generation; finishRetainedPause uses positively held owner. Its batch validation precedes mutation because WithState saves on callback error. Signed locked-owner observations are metadata only; new approval remains explicit. |
| Coordinator restart | Alive supervisor may retain its intent/actor, but retry still verifies fresh HTTPS. A restarted/lost supervisor cannot reconstruct permission from saved fields. |
| Expiry/stale completion | Original deadline/collection still applies. Expired/revoked authorization refuses; live nonce/owner checks reject stale replies. Missing replies are UNKNOWN, never proof of misconduct or no work. |
| Admission during pending transition | New regression observes verified pre-fault authority at the exact blocked kernel checkpoint, then requires the real signed pane-admission entry to refuse because resuming is pending. No new admission mechanism is needed. |

Fault controls are test-only compiled callbacks, NIL in installed executables.
They consume a bounded private regular0600/single-link/current-owner request only
for the exact attempt/stage, optionally waiting at most3s for a separately bounded
release. Root observes real kernel partial state before releasing an injected
error; timeout is NOT its fault oracle. No production config/environment switch.

## Current verification / fixed remaining matrix

Five affected native cases PASS40.684s; all15 monitored-entry cases PASS92.019s.
Stronger blocked-stage/admission + retry focus PASS10.321s. Real authenticated
gateway HTTP rejects the live actor used as authorization previous-owner and
accepts the unchanged original owner, preserving expiry/capture age/unused state;
three affected interface files18 tests PASS5.54s.43 Python/syntax checks PASS.
Logs: /tmp/ssh-exam-partial-transition-{focus,native-affected,admission-focus,
http-focus,http-affected,python}.log. Final fresh-root/broad receipts are below.
Prior c7b3bd0 artifacts do not qualify changed native code.

Remaining retained release matrix is finite: this partial-transition qualification;
coordinator/control death; last-task exit during hold; actual loaded-role mismatch;
combined real capture/root16 students/64 panes with bounded concurrent collection.
A newly reproduced defect may require a bounded repair; unrelated enhancements
are deferred. Independent migration/cleanup/configuration/CLI workflows follow the
current confirmed bug. No broad TODO checkbox or production acceptance is closed.


The private admission mutation control FAILS at the exact public-entry oracle
(4.264s): removing ONLY access.go's existing RetainedHold check admits a pane
while pre-fault authority is verified and the kernel checkpoint is blocked.
/tmp/ssh-exam-partial-transition-admission-mutation.log. Repository unchanged;
the restored real guard passes10.321s. This proves the refusal is exercised,
not a coincidental lack of authority or a runner timeout.


First fresh root attempt FAILED before its intended checkpoint, not at a valid
partial-transition oracle: /tmp/ssh-exam-partial-transition-root.log,83462 ended1,
private /var/tmp/ssh-exam-overlay-10s6h6fa. FULL installed/base preservation PASS.
The control was placed under /run, while the actual service uses ProtectSystem=
strict and permits writes only to selected paths. Scope processes inherit that
mount namespace. The controller also failed to expose an early command outcome.
No hardening/guard is relaxed: test callbacks now derive their private control
from the already-owned supervisor state path, and the controller independently
bounds checkpoint/completion and immediately reports a finished command. Local
blocked-transition/admission/retry focus PASS11.912s after this fixture correction.
AGENTS records the precise writable-namespace/early-worker rule. Old frozen
partial-transition-artifacts.lo187qs0 does not qualify corrected test artifacts;
fresh build/root retry follows before the final broad native run.

The corrected root fixture reached both real partial states. Thaw re-held, but
first-SIGCONT re-hold refused with `no such process` rather than producing a held
receipt: /tmp/ssh-exam-partial-transition-diagnostic-root.log, private
/var/tmp/ssh-exam-overlay-n6cfwf35. FULL host/base preservation PASS. This is an
unresolved product qualification failure, not a successful root receipt.

A deterministic owned local fixture now pins a synthetic helper, fully exits/
reaps it, positively checks its process pidfd and ESRCH cgroup read, then returns
that exact pinned object during the failed Continue's re-hold. Old code fails
the real pane re-hold (RED9.282s); it wrongly treats this exited process as an
unverifiable live writer. The bounded correction checks the pinned whole-process
lifetime after cgroup-read failure: only positive full exit permits skipping the
object; live/unknown lifetime still refuses. It never treats ESRCH alone, a dead
main thread, or a missing proc entry as proof. No new state/permission/cleanup
exception is introduced, and complete UID/scope rechecks remain required.

Both partial-transition public-entry cases, including the exact retired helper
and same-buffer approved retry, PASS11.979s:
/tmp/ssh-exam-retired-hold-process-focus.log.43 Python checks/native builds/vet
PASS. Source/test inputs frozen for fresh guarded root qualification; current
bundle partial-transition-exit-artifacts.qs90b9mo (62,805,389bytes), agent
02bd5b9de02b2eeb05d78b78f0281c13be8a7e93dd1d0b6bae348ecf0cbdb921,
core49705f3fd9e2f81d5d89501877caad1b71e81c086502ec22cf3110b2e7f72c43.
Fresh exact-artifact root qualification PASSES all32 assertions, including both
observed partial kernel transitions, positive all-scope re-hold, the same finite
approval retry, Nano memory, original stops, linked asynchronous writes and
deadline/protected-work/hold checks. FULL host binaries/config/authority and guest
base preservation PASS. Receipt: /tmp/ssh-exam-partial-transition-exit-root.log,
private /var/tmp/ssh-exam-overlay-zjsb0ufn; root session57048 completed0. Capture
is explicitly synthetic, not combined real-capture/capacity qualification.

Final uncached native race/resource/namespace/compiler/default-size qualification
PASSES core516.317s/CLI26.807s, session98888 completed0; completion read from
/tmp/ssh-exam-partial-transition-final-native.log. Existing affected gateway18-test
evidence remains applicable: the gateway runtime/protocol and its regression are
unchanged. Existing full575 app/23 browser evidence covers unchanged runtime/
client artifacts. Focused pinned lifetime/dead-main-thread/hierarchy controls
also PASS1.068s in /tmp/ssh-exam-retired-hold-lifetime-controls.log. Builds/vet and
43 Python checks pass. This increment is implemented/tested locally; no deployment
or broad TODO closure. Retained admission stays disabled for the remaining finite
failure/role/capacity matrix.
