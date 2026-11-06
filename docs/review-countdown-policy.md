# Exam-wide countdown pause during review

November 6, 2026. PUSHED, DEPLOYED AND ONLINE at 19:24:15 UTC (13:24 Chicago).
Runtime source c62f0cc includes the prior automatic-resume commit 0fd1289.
Existing exam definitions remain off by default; no student setting was changed.

In **Exam settings**, enable **Pause countdown while instructor review is needed**.
It is off by default. This is a live exam-wide policy, separate from saved attempt
settings: existing grant hashes, allowances, original intervals and history do not
change. Enabling handles eligible current review holds from now, without refunding
earlier time. Disabling prevents future automatic pauses; it does not silently
restart an already paused countdown.

A real instructor-review hold on a started, unfinished monitored attempt queues
the existing signed pause-clock request with automatic resume on work. Native
confirmation is authoritative: a pending request leaves the current clock in force.
Technical interruptions eligible for automatic recovery do not trigger this policy.
No timeout invents a review hold. Protected, ended, expired and legacy attempts do
not acquire new time. Enabling refuses incompatible active legacy attempts or
missing native timer capabilities with repair guidance.

The countdown restarts only after successful **Resume exam**, including verified
native restoration and browser input acknowledgement. Signing in, requesting or
approving resume, and failed recovery do not restart it. The previous automatic
resume workflow binds the exact pause, causal audit boundary and successful-work
instant across retries, restart and queued time changes. Manual timer actions
win for that interruption; an existing manual pause remains manual. A later real
interruption is evaluated independently. Completion never reopens an attempt.

The existing root clock poll retries delivery; there is no new daemon, schema or
native execution mechanism. One durable review-handled audit marker per generation
prevents duplicate automatic pauses after restart. Deferred delivery is inspectable
in clock requests/audit and cannot authorize execution or reserve another account.
Cancel/finish, expiry, revision and stale-reply checks remain those of the existing
clock workflow. Monitoring, SSH restrictions, protected files and account holds
continue independently of the paused countdown.

Matching CLI workflow:

```sh
sudo examctl web exams show EXAM
sudo examctl web exams update EXAM --revision HASH --pause-on-review on
# Use off to stop future automatic pauses; show reports the saved setting.
```

The flag also works on exam creation; help and strict response validation cover it.
The website reports the actual timer state in review/recovery messages.

## Local verification and release boundary

Evidence: `var/collection-tests/review-countdown.20261106/`.
Focused HTTP/signed-native/student-Continue regressions: 33 pass. Actual compiled
root-mapped CLI through authenticated local TLS: pass (opt-in enabled). Full CLI
race tests and affected native clock race tests pass. Nine current-asset browser
scenarios, fixture typecheck and application build pass. The earlier disabled-opt-in
CLI run was skipped, not counted; enabled runs caught and fixed shared flag parsing
and strict exam-response projection before the passing run.

Release uses the existing reviewed-web-native controller, exact scope
`review-countdown-policy-v1`, and unchanged four-role native installer. The agent,
login and info binaries are reused byte-for-byte; the CLI changes. The loaded
saved-work worker must match the installed CLI, so the qualified drained matched
rollout reloads that role. Relay/SSH remain running. Reopening requires signed
readiness, current-data preservation, exact loaded binaries and public acceptance.
Recovery is forward with current data and the matched candidate; older writers
must not reopen. Original snapshots and shared media recovery coverage are retained.

## Deployed release and recovery

Full application qualification: **840 pass, one existing opt-in skip**, 142 files,
396.97 seconds. Exact image schema-37 smoke and real delayed signed startup pass:
63.05 seconds against a 62-second synthetic publisher, with due purge/tombstones,
60-second nonces, 41 preservation contracts and CURRENT-data recovery without
another start or replacing the original snapshot. Matched controller47 and
historical proof-repair5 pass. Actual guarded four-binary installation, three
reloaded roles, live policy, pane/collection/clock checks pass. Independent cleanup
confirms the exact guest unit inactive/MainPID0/exit0, no owned processes, unchanged
host/base files and student authority. Unchanged proxy templates reuse the actual
0.220-second master-reload qualification from timer-controls.20261105a.

The release image Config is `sha256:2ff55a02b9618001e3254c0da5d6335ebf523d43ee5860da1875ad8702cacf84`;
its exported manifest Config and rootfs layers are bound to the local source image.
CLI SHA256 is `0ed88c8d42584b0b0978f4aca2fd5fdd58fc28ed09e2d0867c39c4284a5802cb`.
The other three native binaries are byte-identical to their previously installed
versions. The four-file guarded procedure reloads the saved-work worker to match
the new installed CLI. Relay PID910635 and its binary remain unchanged; SSH was
not restarted. No schema/configuration/permission migration was needed.

Online preparation took10.35 seconds. The existing1,047,562,391 recording bytes
were verified/reused, with zero new media objects/copies. The current stopped web
snapshot contains126,509,056 database bytes plus343,358 nonmedia bytes; the fresh
native backup is206,120,960 bytes. Both original snapshots remain intact.
Maintenance lasted184.05 seconds, with no unexpected cutover failure or rollback.
Public TLS/eight assets, readiness/notifications, exact installed/loaded cohort,
actual signed read-only examctl and CLI help pass. All41 preservation contracts
passed before reopening; recording pause is RELEASED. Extra read-only acceptance
initially used an unsupported help spelling/wrong background-status field, then
incorrectly reran the idle-only preservation oracle after its own signed CLI read.
Those receipt mistakes were corrected against the real interfaces; production
and enforcement were unchanged. The recorded pre-reopening proof remains intact.

Release preparation/feature work was already underway before the18:43:08UTC timing
marker: the exact instruction-to-completion elapsed time was not captured and is
not claimed. From that marker to reopening was41m07s, including remaining feature
qualification, real CLI corrections, artifact build and installation rehearsal;
maintenance is reported separately above. This was a matched feature release, not
an already-prepared UI-only cutover.

Private deployment state/artifacts:

- Web stage: `/var/tmp/ssh-exam-review-countdown-20261106-c62f0cc-12c6f172-web` on marco.
- Web state: `/data/ssh-exam-review-countdown-20261106-c62f0cc-12c6f172-state`, phase ONLINE.
- Native stage: `/var/tmp/ssh-exam-review-countdown-20261106-c62f0cc-12c6f172-native`, phase VERIFIED.

Recovery preserves CURRENT data and the matched candidate; never restore an old
snapshot over subsequent authority or reopen older writers. Use the existing
qualified controller resume/current-data forward repair if needed. No pending
release action or policy question remains. Original dirty screenshots are preserved.
