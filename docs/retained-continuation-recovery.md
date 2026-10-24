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

## Coordinator acknowledgement loss (current local candidate)

Actual signed Continue can lose its coordinator after the supervisor successfully
resumes but before canonical ACTIVE/resuming is cleared. RED4.267s reaches that
exact boundary, retains the live original supervisor, discards only the local
coordinator monitoring bridge and retries through the same signed entry. Old
code returns success with `retained_hold=resuming`, leaving pane admission closed
and the fresh coordinator unregistered for monitoring. Receipt:
/tmp/ssh-exam-coordinator-ack-loss-exact-red.log. This local bridge reset is NOT
proof of actual process-death handling; that remains a guarded-root gate.

The initial positive RPC and the positively verified live resume-result retry now
share canonical completion and monitoring initialization/registration. The live
result must match the original boot deadline; durable completion checks exact
owner, nonce, generation, clocks, ACTIVE state and pending/complete hold before
mutating. Changed/expired state refuses. No new approval, pane epoch, saved permit
or allowance is created. A missing/dead supervisor cannot supply this result.

State review: a partial live transition still uses fresh signed recovery/re-hold;
a fully resumed live transition completes only its existing exact intent; an
already completed retry is idempotent. Coordinator key/client initialization
failure preserves pending metadata for repair. Actual authority/gates keep their
original cutoff during an unavailable coordinator. An expired authority cannot
complete from disk and must undergo the existing verified hold/recovery path.
Concurrent changed ownership/clock/lock refuses before metadata mutation. No new
durable state, indefinite reservation or policy exception is introduced.

Five affected native interface modes PASS27.105s, including positive fresh signed
renewals in the replaced coordinator and unchanged shell memory/epochs after
retry. Final boot-deadline focus PASS13.250s,43 Python/build/vet PASS. Native inputs
are frozen for the root run. The driver kills only the exact pinned private
coordinator at that blocked checkpoint, restarts its existing private service,
retries the same approval, and requires a unique positive peer command after the
original15-second seed has expired. Root33-case workflow ACTIVE19873,
/tmp/ssh-exam-coordinator-completion-root.log, private overlay-02qr3vj0.
Bundle coordinator-completion-artifacts.nf0kzt84 (62,835,074bytes), native agent
cacedd784eb58591eff977f052c919bc3a31e6dec62133d759dbf5246bf2f601,
coreba5cc9c9e5a98112fd722f8941c7e67b1cdf54b95f91c786fa2d8f4bfae8c5d5.
This first new root run FAILED before reaching coordinator loss: the earlier
scope-thawed re-hold observed an uncontained student-UID process and refused a
held receipt. /tmp/ssh-exam-coordinator-completion-root.log,19873 completed1,
private /var/tmp/ssh-exam-overlay-02qr3vj0. FULL installed/base preservation PASS.
The process's actual classification is not established; neither weaken the guard
nor assume that a preceding successful root run proves this case resolved.

The refusal now captures bounded pinned PID/UID status and entry/transport/peer/
lifetime-check flags, without command lines or credentials. Enforcement and
exemptions are unchanged. Focused coordinator/partial-mode checks PASS17.544s:
/tmp/ssh-exam-coordinator-uncontained-diagnostic-focus.log. Fresh diagnostic
artifacts are being built to identify the actual refusal. No final broad native
run has started for the new candidate. Admission remains OFF.

Diagnostic root31615 completed1: both partial transitions passed, then the new
coordinator fixture failed before signalling because it expected full attempt
fields from the deliberately narrower read-only info DTO (KeyError retained_hold).
Receipt /tmp/ssh-exam-coordinator-identity-root.log, overlay-gl10zll5; FULL host/
base preservation PASS. It supplies no coordinator-death qualification and does
not resolve the earlier uncontained-process observation. Correct the fixture to
the existing full `examctl info` result; no inspection/enforcement schema change.
43 Python/syntax checks pass. Corrected source is frozen for root63740,
/tmp/ssh-exam-coordinator-full-info-root.log; bundle
coordinator-full-info-artifacts.f8bxtbj6 (62,828,417bytes), agent
b47ba3af33f66ddca06bfd67eb690f857fb8093a10b9d053cbeb81cded48936e,
corec162e638b10a8f368ec49e3c278fd7602721f1f0f30f8d891f4a29f7eaabd499.
Native bytes match the diagnostic run; only the Python fixture changed.

That frozen coordinator candidate now PASSES root33,63740 completed0, FULL host
and base preservation: /tmp/ssh-exam-coordinator-full-info-root.log, private
overlay-altvip9u. Actual pinned coordinator SIGKILL/restart, fresh same-approval
completion and a unique positive peer command beyond the original15s seed pass,
alongside Nano, asynchronous writes, protection/deadlines and saved-source checks.
Capture is synthetic. This qualifies that exact older candidate only.

### Strict re-hold retry after transient inventory refusal

A separate exact signed-entry regression reproduces a permanently unverified
hold after one explicit inventory refusal (RED9.296s). The supervisor's existing
periodic revoked-authority observer omitted resume-unverified. It now retries
that cause through the SAME complete UID/thread/input/stop/freeze barrier, with
the same worker bound and no positive execution authority. Persistent unknown
writers remain unverified; no new exemption, approval, allowance or account
release. Deadline collection, original clocks and ownership checks remain.
Cancellation/expiry still use existing pending-transition rules. No new durable
state or reservation is introduced; retries cannot resurrect a lost supervisor.

Current three focused modes PASS17.523s. A private overlay removing ONLY this
cause recognition FAILS the exact current re-hold refusal9.297s, proving the
regression reaches it. Logs /tmp/ssh-exam-rehold-inventory-{retry-focus,
retry-mutation}.log. Root will additionally inject a one-shot private inventory
refusal, require its exact consumed receipt and positive full kernel re-hold,
then use fresh signed Continue with unchanged buffers/time. The old isolated
uncontained-UID sample's exact process class remains unknown; this fixes a proven
permanent-retry omission without pretending to establish that historical cause.

Builds/vet/43 Python PASS. New source/test inputs frozen; exact bundle
coordinator-rehold-artifacts.s5nogi73 (62,831,215bytes), agent
479cc54b61ea13c98a1e5ffb4c1c2020f14c88fc193be9e575870fbc6ba05e79,
coredbffd6f4b3ab0d9303c5b93827db7f4c7e2e3ffe83dbf795c56e982c08af2603.
Fresh exact-artifact root34 PASSES,22163 completed0, FULL host/base preservation:
/tmp/ssh-exam-coordinator-rehold-root.log, overlay-1csb90qn. Actual one-shot
inventory refusal/strict re-hold, coordinator restart/post-seed fresh command,
Nano, linked IO, protection and original-deadline restoration all pass. Capture
is explicitly synthetic; combined real-capture/capacity qualification remains.

Final uncached native races/resources/userns/compiler/default-size qualification
PASSES core538.190s/CLI26.047s,6361 completed0, completion read from
/tmp/ssh-exam-coordinator-rehold-final-native.log. Builds/vet/43 Python and focused
mutation controls pass. The unchanged gateway runtime/protocol and client retain
the18 affected interface checks and prior575 app/23 browser evidence. This
increment is implemented/tested locally, not deployed or retained-mode enablement.
The earlier unknown UID process's exact origin is not established by these tests;
refusals remain strict, inspectable and retried without granting execution.
