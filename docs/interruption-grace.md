# Fifteen-second interruption grace

Requested and deployed November 22, 2026, as runtime/controller df3c434 on csc-sys.
The instructor chose to pause typing during
this window and restore it automatically once the required checks pass.
[Deployment, preservation and recovery](interruption-grace-release.md).

## Student behavior and policy

The active workspace uses one 15-second window for detected focus, visibility,
fullscreen, keyboard, screen/webcam and connection interruptions. Typing stops
immediately. Available capture keeps its five-second cadence, with an immediate
screen-sample attempt when grace starts. The warning offers the required restore
buttons. Returning inside the window requires fresh challenged screen and any
required webcam observations; an old in-flight sample cannot clear the warning.
The same attempt, permission, clock and original deadline remain in effect.

Overlapping/repeated failures share the first cutoff. Changing the failed
condition, refreshing status, a late healthy message or an old capture cannot
restart the window or undo expiry. A fully verified recovery ends that interval;
a later independent interruption gets its own window. Unresolved browser-policy
loss becomes the existing instructor-reviewed hold at expiry.

Confirmed SSH death, revoked ownership and native verification failure still
contain execution immediately. The grace preserves available browser capture and
delays the persistent interruption interface; it never resurrects a transport or
thaws a native hold. The established authenticated/authorized recovery workflow
still applies. Existing automatic technical recovery still requires fresh proof;
elapsed time alone does not fabricate a violation. A connection-only interruption
that outlasts the warning stays in blocked technical reconnection, rather than
becoming a student policy report. Fresh verification is still required to restore
typing. An actual browser-condition failure still uses the bounded policy window. Closed pages and ended screen
shares cannot guarantee a screenshot. Deadlines and explicit Finish remain hard
boundaries, including during grace. The timer continues unless separately paused
by its existing instructor control.

Normal interruption notifications are due no earlier than the first cutoff.
Existing critical containment-confirmation alerts retain their safety behavior.
Low-level 60-second operation timeouts and native evidence-age limits are unchanged.
When negative readiness is observed, gateway evidence is clipped to the original
15-second grace, never extended by delivery or retry. Missing/expired observations
remain technical uncertainty rather than proof of continuous noncompliance.
Already accepted native authority remains subject to its original signed cutoff;
this change does not introduce a new native freshness protocol. Begin/Continue
still require complete current readiness.

## Implementation and operator workflow

The existing internal focus_lost_at column now anchors the shared interval;
no SQL migration, per-student override or new management setting is introduced.
The page-bound conditions message carries its original generation and validated
physical browser observations. Upload/verification health is a separate input
gate; a failed upload never reports a live screen/camera track as ended. Retired generations cannot clear/start a current interval.
Required-condition grace starts/clears are audited; initial safe condition observations remain
inspectable without recording credentials or a reusable ownership secret.
Challenged capture remains the separate source of signed execution evidence.

Existing management applies: `examctl web attempts show ATTEMPT`,
`examctl web interruptions show ATTEMPT` and
`examctl web interruptions authorize ATTEMPT` match the instructor dashboard. A transient
recovered grace consumes no attempt, resume approval or time allowance. An
expired policy hold uses the existing Allow resume action. Native inspection
remains `examctl info ATTEMPT --read-only`. This is an intentional replacement of
the former 60-second focus-only grace and immediate browser-condition locks.

## Acceptance and verification

The milestone exercises the actual student workspace and authenticated WebSocket
entry, with synthetic accounts/data and no production changes or email delivery.
Acceptance requires a shared first-loss cutoff, blocked input, continued available
capture, fresh verified recovery, preserved deadlines and refusal of late/stale
messages. Native safety containment must remain independent.

- The full application run completed with 996 passing checks, four old-policy
  expectation failures and three opt-in skips. Those four expectations were
  corrected: negative readiness is now a valid observation, real policy expiry
  takes 15 seconds, and the reason describes all required conditions.
- The subsequent affected run passed all 72 state, ledger and public-interface
  checks in six files, including all four corrections, real expiry/restart,
  generation refusal and safe clock arithmetic. Unchanged application coverage
  is reused; a second all-green full application run is not claimed.
- Native `TestMonitoringEvidence` race checks pass; no native code changed.
- Final TypeScript checking and the production build pass.
- The real WASM/SSH focus workflow passes: fresh challenged recovery restores
  actual terminal input, preserves the deadline and expires exactly once.
- The actual retained WASM/SSH test passes after a control delay exceeding
  60 seconds: the same shell, buffer and deadline survive, new input succeeds,
  and stale input is never replayed. Delayed verification remains inert until
  released. The shared-cutoff fullscreen case also passes using durable state.
- The 16-case grace/activation/separate-local-gateway run passed on the preceding
  UI snapshot, including
  protected policy holds and scoped approval across restart, lost policy report
  and receipt delivery, and native pause refusal/retry.
- A further real WASM capture test reproduced a policy hold after a 17-second
  verification refusal while sharing stayed live. After separating physical
  readiness and upload health, its coalesced-render and long-outage phases pass
  with actual terminal input and unchanged owner/deadline. The live input gate is
  restored after verified facts even if React coalesces the entire interval.
- All 15 selected grace/activation/preflight/real-focus cases pass against the
  final built assets (1.9 minutes). The current long-upload/coalesced-input
  workflow passes separately (35.3 seconds). The unchanged gateway ownership,
  review/receipt and native contracts retain their earlier coverage; no fresh
  full application-suite, privileged kernel or class-capacity pass is claimed.

Earlier failed browser receipts are retained. They found and corrected inaccessible
restore buttons, a healthy setup activation incorrectly starting grace, and legacy
active screenshots lacking the fresh challenge needed for recovery. A deadline
refusal was correct; its test was corrected to assert the rendered saving state.
The wider browser runs also retain obsolete policy expectations corrected for
15-second escalation, plus the technical-delay misclassification and an input
barrier state bug. The correction separates technical uncertainty from observed
browser-condition expiry and keeps both the visible barrier and browser SSH input gate
closed through asynchronous verification. Tests wait for that verified boundary,
not merely disappearance of a reconnecting message.

The exact-source receipts, logs and per-test images are private under
`var/interruption-grace/20261122/`. These browser fixtures use actual built assets
and WASM/SSH, with synthetic media and mocked authority where stated in the tests;
they are not new privileged native-freeze or class-capacity qualification.

No SQL migration or new CLI management operation is required. Existing database
fields and native wire contracts are unchanged. The deployed transition permits
only qualified forward recovery with the same candidate and CURRENT data;
reopening the previous policy writer is refused. Preserve attempts, audit, media,
account holds and the original recovery snapshot. Do not restart around active exams.

Local cleanup: all owned durable test runners exited and their cgroups are empty;
the final browser listener is closed. Failed and successful receipts are retained,
including the original upload-failure reproduction. Existing documentation PNGs
were preserved and excluded from the feature commit.
