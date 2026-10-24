# Retired terminal-recording faults (tested locally; not deployed)

Actual timed Engine.local → Unix/SCM_RIGHTS/PTY → recorder failure previously
dispatched asynchronous `lock-attempt` using only the attempt ID. If an explicit
pane close or authenticated-generation replacement won the race, the old failure
could lock the replacement and revoke its continuation. The actual interface
regression is RED2.183s on that implementation (two stale cases fail, genuine
current loss remains enforced). This is a local correctness finding, not the
identified cause of the production heartbeat incident.

## Bounded fix and acceptance

Capture the original generation, transport, verified account and interval from
the already-validated pane admission. On an actual recording error, publish one
in-memory pending notice before closing its old PTY, contain only its uniquely
named old native scope, then recheck current metadata under the canonical state
transaction. Require the same active/unexpired authority and exact still-tracked
closed/ready pane incarnation/current boot. An orphan proof alone is insufficient.
Changed deadlines are deliberately NOT part of this equality: an extension must
not exempt a current recorder from enforcement.

Normal pane cleanup joins an already-observed fault OUTSIDE shared state before
retiring its proof. This avoids a false negative in which the failure itself ends
the shell and cleanup removes its record before the worker can enforce the real
loss. No wait-for-fault is introduced when no fault was observed. Output/resize/
close errors coalesce to one worker. Its preliminary exact-unit manager request
has a two-second bound; no timeout proves cleanup or misconduct. Existing positive
scope-removal checks still govern normal metadata retirement.

A retired failure receives `retired-terminal-recording-fault` audit, never a new
policy violation, approval revocation or clock reset. The current real failure
retains the existing Class-server terminal recording failure lock/containment.
Output still records durably before forwarding, never raw keystroke capture.
No grant, deadline, hold, credentials, protected submission or historical attempt
is deleted/revised. No retained SSH/freeze/recovery capability is enabled.

Operator workflows remain `examctl info ATTEMPT --read-only` and `examctl panes
list/show ATTEMPT [PANE]`, then the existing reviewed exact `panes close` if needed.
Captured metadata is not live monitoring proof. A genuine current recording loss
requires repair of storage/quota/recording and the existing continuation workflow;
do not clear state, reset the clock or kill a shared agent to suppress it.

## Intermediate-state review

There is no new durable state, reservation, launch permit, journal or management
mutation. The pending notice belongs only to the existing recorder lifetime and
cannot be restored from disk. Concurrent close/replacement remains authoritative;
late work can audit the old fault but cannot lock its replacement. Natural
cleanup preserves a pending real fault until its current-state decision finishes.
Other accounts' state/leases are not held while waiting. Crashed coordinators
retain the existing independent watchdog/deadline rules, not a new restart grant.

An attempted full recording/IO join was explicitly withdrawn from this increment:
legacy blocking raw-input reads can outlive descriptor close until transport EOF,
and output forwarding also needs a qualified backpressure/cancellation contract.
The failed completion receipt and actual synthetic-coordinator stack dump are
retained at /tmp/ssh-exam-recording-fault-completion-{failure,diagnostic}.log.
No final-output/close-ack guarantee is claimed here, and neither the old pass nor
the withdrawn experiment qualifies timed C12 supervision. Address that lifecycle
as part of the next integrated timed-owner boundary, not by adding unused helpers.

## Verification

The real local Unix/PTY regression faults this synthetic attempt's recording
pathname, observes the actual fault-worker barrier, then races native targeted
close, generation/transport replacement or an orphan proof. Positive controls
keep the same current authority, including a real native clock extension, and
require the recording lock while preserving original timing/account holds.
Root SSH ancestry/PAM/manager namespace/final shell are fixture replacements in
owned user scopes; this is not new root-guest or multi-UID admission qualification.
Three final focused native race repeats pass21.954s, including practice-owner
death/isolation and shared recording-quota controls. The orphan-proof mutation
control is RED0.734s when only exact tracked-unit membership is removed; restored
before these final checks.35 affected signed HTTP/lifecycle/authenticated SSH
renewal-race checks pass10.37s. Native static build/vet and diff checks pass. Full
native race/resource/namespace/compiler/default-size qualification passes
core291.006s/CLI21.908s. All runners finished.

Receipts: /tmp/ssh-exam-recording-fault-{red,orphan-mutant,final-focused,
callbacks,native}.log. Application/browser/WASM source and built artifacts have
not changed: the preceding435-app/22-browser/build/typecheck evidence still
covers those unchanged surfaces. Those suites are not redundantly rebuilt/rerun
for this native-only fault fix; affected callback/SSH checks are freshly run.
The latest read-only csc-sys guard is BUSY; no new upload/guest/install occurs.


## October24 retained-Continue correction (local candidate)

The actual signed Begin/framed-pane/pause/fresh Continue regression reproduced a
false negative: after two approved Continues, unlinking only its synthetic pinned
log caused real capture failure and exact scope containment, but canonical state
stayed ACTIVE. The old immutable recording generation was incorrectly treated as
a replaced owner. RED4.883s: /tmp/ssh-exam-continued-recording-red.log.

A pane proof now records `recording_continued_generation` only in the same durable
transaction as a fresh signed same-pane Continue. The recording hash, report
identity, original generation, transport, UID, incarnation and start stay fixed.
Fault reconciliation accepts that explicit association only for the current
registered retained owner and still-tracked ready/closed exact pane. Arbitrary
new generations, changed transports/accounts/boots/starts and orphan proofs still
retire the fault. This is negative evidence, never a permit or fresh monitoring.

The first focused candidate exposed a cancellation incompatibility (retained as
/tmp/ssh-exam-continued-recording-focus.log): a durably staged but unexecuted
Continue left its proposed fault generation behind after the supervisor positively
restored its previous held owner. That same cancellation transaction now restores
the association to the verified held generation. No timer or missing reply can
perform that restoration. Matching crash/retry and expired pending Continue still
require fresh verification before any execution.

`examctl panes reports ATTEMPT` exposes original `recording_generation` on
producer reports and the separately captured canonical `continued_generation`.
Inspect with `examctl info ATTEMPT --read-only`; reconcile through existing
`examctl reconcile`. Preserve unsafe/pending reports, storage and original clocks;
repair the actual recording failure before an explicitly approved continuation.
No force-clear, new grant, refund, history deletion or production enablement.

State review: association shares the existing exact pane's lifetime/bounds and
creates no reservation, actor or launch. Before durable Continue it is absent or
previous; after commit it follows the saved current owner but permits no work.
Lost commit replies retry/reverify through the existing live supervisor; owner
restart never restores authority. Verified cancellation restores the held owner
and association together. Expiry/collection retain original cutoff rules; a stale
report must still pass immutable owner/context/version/boot/UID/scope checks and
canonical revalidation. Association cannot excuse recording loss or extend time.

Focused native race PASS40.726s: actual continued fault, fault after clock change,
synthetic replaced-generation negative control, positive cancelled-pending retry
and actual pending expiry. Actual pane replies identify infrastructure failure
and explicitly say no student violation; original allowance/account hold remain.
Remaining validation: complete affected recording/continuation races, build/vet,
full native milestone qualification and fresh guarded disposable root artifacts.
Application/browser/client source is unchanged from the575-app/23-browser bulk
milestone; those receipts cover only unchanged surfaces, not this native fix.


Final refusal review caught another avoidable implementation assumption: native
WithState saves callback mutations even when the callback returns an error. The
new actual pending-cancel regression injects an inconsistent SECOND private pane
record; RED4.231s observes the first association partially reverted, blocking
repair/retry. Validation now stages ALL changes before touching associations and
publishes held/resume status only after those checks. Refusal leaves an unverified
hold and no resume entitlement; repairing only the injected record then succeeds
through the same public Admin/Continue entry. Final focused five-case native race
PASS40.954s, /tmp/ssh-exam-continued-recording-final-focus.log. AGENTS now requires
reading failure/persistence semantics and this refusal/repair oracle before broad
runs. This discovery happened after the previous successful full/root runs, so
those receipts do not qualify the corrected artifacts.

Previous candidate full native races/resources passed core522.417s/CLI31.427s;
root28 assertions and FULL installed host binaries/config/authority/base
preservation passed. Exact old candidate continued-recording-artifacts.02re7un0,
62,741,870bytes; agent76579f56877920bee525f61a54b1d95fb25349743b74e9d5681ca2bcd2a98ae9,
core98039bd459ac683e34b5e81da11deb9377ac9cd9adafc3be6cf85cc88019aef5;
private /var/tmp/ssh-exam-overlay-5lcu2utj. All old runners ended. Final candidate
must be freshly qualified. The root extension also covers verified supervisor
SIGKILL after saved-work Continue with a pinned, positively identified
HUP-ignoring writer; pidfd exit is its containment oracle, not an elapsed sleep.


Final root run1 reached the new saved-work owner-death case, then the fixture's
systemctl kill on a scope returned an auxiliary-process EINVAL. This is a failed
qualification, not product success or an unknown student violation. Host/base
preservation PASS; log /tmp/ssh-exam-continued-recording-final-root.log, private
/var/tmp/ssh-exam-overlay-h11r9v8f. Corrected injection pins the reported supervisor
pidfd, verifies its exact manifested test executable and examterminal cgroup,
signals that pinned process, and positively observes its pidfd exit. It still
requires the identified HUP-ignoring writer's own pidfd exit and canonical lock.
Only linux_qualification.py/its checksum changes: every final native binary/test
is byte-identical. Fresh43 safety checks and syntax validation PASS. Retry bundle
continued-recording-pidfd-artifacts.mrf2qe1x,62,746,415bytes, remote private
/var/tmp/ssh-exam-continued-recording-pidfd-upload.SneYJE/bundle. Final native
suite remains running on unchanged final source; root retry session41994,
/tmp/ssh-exam-continued-recording-pidfd-root.log, private
/var/tmp/ssh-exam-overlay-jw4pophr. No completed-final qualification is claimed yet.


Final corrected qualification is COMPLETE locally: full uncached native
race/resource/namespace/compiler/default-size suite PASS core520.605s and
CLI30.752s (/tmp/ssh-exam-continued-recording-final-native.log,55018 completed0).
Root retry29 assertions PASS, OVERLAY_QUALIFICATION_OK and FULL installed host
binaries/config/authority and guest-base preservation PASS
(/tmp/ssh-exam-continued-recording-pidfd-root.log,41994 completed0;
/var/tmp/ssh-exam-overlay-jw4pophr). This includes actual continued recording I/O
failure, pinned supervisor death/HUP-writer exit after saved-work Continue,
twelve Nano cycles, six linked-IO pairs, original-deadline restoration and protected
saved recovery/pin retirement. Agent SHA256
cbd8c731202665a8750c784ed9df611a890315a9a225571536127f38fcdb910b;
core test9e78bb5c79285eff4907311a72a4a4812b19f785a764b71860229e2092455374.
43 safety checks, final five-case40.954s focus, owner-death2.290s focus, builds/vet
and diff checks PASS. All runners ended. Original failed receipts remain recorded.

Root capture remains explicitly synthetic; unchanged application/client/browser
surfaces retain575-app/23-browser evidence. This qualifies these actual recording
fault/owner-loss and cancellation boundaries, not all coordinator deaths,
last-child/partial-thaw/loaded-role or combined real capture/root16/64 boundaries.
Guard OFF; no deployment, production modification or broad-liveness completion.
