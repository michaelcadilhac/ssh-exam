# Exam-wide countdown pause during review

November 6, 2026. Implemented and tested locally; release qualification in progress.
Production remains unchanged until the guarded matched rollout completes.

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
