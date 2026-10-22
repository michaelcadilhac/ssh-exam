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
