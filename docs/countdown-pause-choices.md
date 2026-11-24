# Explicit countdown pause choices

November 23, 2026. Implemented/tested locally; not pushed or deployed.

Bounded milestone: the instructor attempt row offers **Pause until reconnect**
and **Pause indefinitely** for a stopped student's running countdown, without a
checkbox dialog. The existing `resumeOnWork` authorization resumes the saved
countdown only after successful exam resumption; SSH login, setup and approval
alone consume no saved time. Connected working students retain direct pause.
Original deadlines, monitoring holds, request identities and native confirmation
remain authoritative. No new native protocol or database state is needed.

Time edits already commit a durable request immediately. The class-server clock
polls once per second; native acknowledgment is required before the website may
claim the deadline changed. Dashboard polling adds up to five seconds of display
delay. While a clock change is pending, refresh at one-second intervals for at
most fifteen seconds, then return to the normal five-second rate. Never overlap
polls or keep resetting the fast-refresh budget for the same pending operation.

Acceptance: desktop/mobile menu choices submit the correct existing signed
timer intent; manual/automatic pause preserve time, history and holds; successful
exam resumption alone restarts the automatic countdown. A delayed clock change
appears promptly on confirmation, stays visibly pending before it, and a stalled
change cannot cause indefinite fast polling. Errors remain actionable/retryable.
Required checks: affected application HTTP/clock/continuation regressions,
TypeScript/build, actual built-asset instructor browsers and existing CLI help.
No new native race matrix or privileged qualification is needed for unchanged
native code/contracts. Preserve pre-existing documentation screenshots.

CLI equivalents remain `examctl web clocks pause-timer ATTEMPT --revision N`
(indefinite), the same with `--resume-on-work` (until successful exam resumption),
and `resume-timer` (explicit immediate countdown resume). Existing controls are
already deployed; the two-choice interface and faster display are local changes.

Verification:24affected HTTP/clock/signed-dispatch/automatic-resume checks pass,
as do TypeScript and the production build. Final built assets pass five focused
browser workflows (48.2s) and nine wider instructor workflows (28.5s), covering
both pause modes, mobile/keyboard operation, confirmed versus pending time,
bounded refresh including repeated HTTP errors, stale-data protection, filters,
exact retries and unchanged resume approvals. The mobile menu was visually
inspected; screenshots remain inside the private test output.

The first four browser cases passed while the polling-budget test's virtual
browser clock outran Node HTTP replies. That fixture now uses actual elapsed
time. Review also caught a failed-refresh retry-rate bug introduced in this
increment: retry timing must use the last request attempt, while stale-data
detection keeps the last successful update. The final regression measures both
healthy pending and failed replies. Original failed receipts are retained.

Evidence: `var/countdown-pause-choices/20261123/`; final source manifest
`inputs-qualified.json`, build and browser receipts/logs. No native execution,
wire protocol, application backend or SQL migration changed, so unchanged native
race/privileged evidence remains applicable. No full-app, new capacity test or
release-installation qualification is claimed. Production clocks/services were
not modified during this UI work. A fresh inspection found the student already
working with his countdown running, so no pause-mode correction was executed.
