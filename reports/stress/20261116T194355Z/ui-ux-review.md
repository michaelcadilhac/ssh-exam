# Prof's UI/UX review — 20261116T194355Z

Agent: Prof (`/root/prof_stress_review`). Reviewed November 16, 2026, using a disposable local instance of the current built website. This is the UX component of the requested stress run, not its capacity or production-readiness verdict.

## Verdict

The principal student workflow is understandable and usable in the reviewed desktop configuration: sign in, check setup, explicitly start, use four terminals, maximize/restore, finish, and return to sign-in. The instructor's next-attempt controls are materially clearer than the former selection/editor workflow. The reviewed 375px layouts fit their available width, starting files show their actual current choice, and next attempts are visibly distinguished from history.

The initial review found one confirmed accuracy defect: the Start confirmation promised **“The clock never pauses”**, despite supported pauses. It is now implemented and focused-tested locally as **“The countdown starts when you confirm”**, with no timer behavior change and no deployment. Several smaller consistency and explanation improvements remain. No P0/P1 UX blocker was observed in these bounded scenarios; that does not establish that every student/browser combination is flawless.

## Environment and evidence boundary

- Served `dist/web` from the existing `tests/browser/server.ts` fixture at loopback `localhost:3100`; public `/api/login-test` positively reported `browserSSH: true`. A separate test gateway was enabled. The parent verified that the built frontend bundle matched the deployed frontend.
- Chromium at `/usr/bin/chromium`, desktop viewport 1440×1000 and instructor narrow viewport 375×812. The narrow viewport evaluates responsive layout; it is not a real mobile browser/device qualification.
- Used only producer-defined synthetic exam/account namespaces and synthetic instructor credentials. Browser SSH/WASM performed actual local SSH handshakes. The shell, privileged agent and file-protection responses in this fixture are simulated; this UX review does not certify native containment or protected archives.
- No institutional MFA or real account was used. Screen capture was a synthetic canvas, keyboard-lock readiness was simulated, and there was no real webcam. The reviewed no-question MFA fixture exercises automatic acknowledgment, not DePaul MFA availability or Microsoft's internal implementation.
- SMTP was the fixture's private Unix-socket sink. At shutdown it had captured zero messages; one notification remained only in the disposable outbox. No external email delivery was attempted or claimed.
- Raw evidence is private under [`var/stress/20261116T194355Z/prof`](../../../var/stress/20261116T194355Z/prof). Screenshots contain synthetic identities only. Existing documentation screenshots were not modified.

## Confirmed findings

### UX-01 — P2: Start confirmation makes a false clock promise

**Observed.** [Start confirmation screenshot](../../../var/stress/20261116T194355Z/prof/student-start-confirmation.png) visibly says “The clock never pauses.” The current system supports manually pausing the countdown while work continues and an exam-wide pause-on-review option. This wording can cause students to misunderstand an instructor-approved pause.

**Implemented/tested locally, not deployed:** the sentence is now **“The countdown starts when you confirm.”** The [final rendered UI/relay receipt](../../../var/stress/20261116T194355Z/browser-final-ui-relay-1/playwright.json) passes both positive and negative copy assertions in the actual Start dialog, preserving the failed-Begin/no-start check. Build 5 passed. Timing authority/behavior did not change; the original screenshot above remains historical evidence.

### UX-02 — P3: Bulk editing still combines editing and cancellation

**Observed.** The [375px bulk edit dialog](../../../var/stress/20261116T194355Z/prof/admin-bulk-edit-mobile.png) is titled “Change next attempts” but offers both **Review changes** and **Review cancellation**. Its dismissal says **Close** even while a draft is being edited. A dedicated “Cancel next attempts” action already exists, and the [individual cancellation dialog](../../../var/stress/20261116T194355Z/prof/admin-cancel-next-mobile.png) has much clearer **Keep attempt / Cancel attempt** actions.

**Suggested fix:** keep the edit workflow to **Review changes / Cancel**; route cancellation through its existing dedicated action. Use **Close** only on a completed result or read-only view. Preserve the exact request identity and retry behavior for any uncertain submitted operation.

### UX-03 — P3: Date terminology remains inconsistent

**Observed.** The roster calls the field **Dates**, inline fields use **Opens / Closes**, bulk editing uses **Start window**, the next-attempt form uses **Start window**, and the [Add students dialog](../../../var/stress/20261116T194355Z/prof/admin-add-student.png) says **First attempt start dates**.

**Suggested fix:** use **Start dates** with **Opens / Closes** consistently. Remove “First” from the Add students label: it adds a distinction the instructor has explicitly rejected. This is a wording change; keep finite start bounds, exam-zone interpretation and exact saved instants unchanged.

### UX-04 — P3: Add students initially focuses a populated date instead of the missing username

**Observed.** The [Add students screenshot](../../../var/stress/20261116T194355Z/prof/admin-add-student.png) opens with focus in the already populated **Opens** control. The **Username** field—the immediate missing information for “One student”—is lower down and unfocused.

**Suggested fix:** focus Username for the one-student mode and the file input/control for CSV mode. Keep the prefilled dates visible and editable. Use the modal's existing explicit initial-focus mechanism rather than changing general focus trapping.

### UX-05 — P3: A completed attempt displays an ambiguous connection status

**Observed.** The [completed review](../../../var/stress/20261116T194355Z/prof/admin-completed-review.png) correctly says **Files saved** and shows ended time, but its Connection field says **Connection unconfirmed · 0 terminals**. A closed connection is expected after successful completion; the wording can look like an unresolved problem.

**Suggested fix:** for a positively completed attempt, identify the terminal connection as ended, or omit this live-status field. Retain **Connection unconfirmed** for unfinished attempts when contact is genuinely uncertain. Do not infer live connectivity from an old snapshot.

### UX-06 — P3: Single-student starting-file identity is repeated unnecessarily

**Observed.** The [Add next attempt form](../../../var/stress/20261116T194355Z/prof/admin-allow-another.png) repeats the source exam/attempt through the source-exam disclosure, current choice, and an immediately following saved-work summary. The exact source is useful; the repetition makes the form longer without providing another decision.

**Suggested fix:** keep one concise current-source summary with exam, attempt number and date, plus a **Change** action when alternatives exist. Retain an explicit chooser when the instructor is selecting a different source; never silently substitute starter files for an unavailable protected source.

## Source-only candidates and documentation findings

These are not claimed as rendered failures in the reviewed scenarios:

- **Maintenance copy makes an unconditional clock claim (P2):** `deploy/nginx/maintenance-maps.conf` says an already-running exam's countdown continues, and `tests/browser/maintenance.spec.ts` expects it. A generic unavailable page cannot establish that a timer was not already paused. Use neutral status/retry guidance and update the two presentation bodies and their visible-message test together, preserving actual authoritative timing. This was inspected as source during the later evidence audit, not newly rendered in this UX session.

- **Student instructions are stale (P2):** `docs/student-instructions.md` still describes choosing among multiple offered attempts, says the clock always runs during review, and describes some page/SSH-loss recovery as requiring a new attempt. Reconcile it with the current single-next-attempt rule, actual timer-pause settings and approved files-only same-attempt recovery. The phone-approval button should be conditional because the server can send a zero-question MFA notice.
- **Pause dialog could explain continuing work (P3):** `apps/web/src/admin.tsx` says remaining time will stay fixed but does not explicitly say work can continue. Add one short sentence explaining that approved policy. The existing seeded `locked` scenario did not expose this timer action, so this review did not render that dialog; its absence there was not treated as a product failure.
- **Sandbox fixed controls need an explanation (P3):** the code disables the next-attempt camera/time controls for sandbox. The [rendered sandbox settings](../../../var/stress/20261116T194355Z/prof/admin-sandbox-settings.png) shows no short explanation of its fixed five-minute/webcam-off practice policy. Add the explanation next to the fixed values rather than making them look like unavailable editable defaults. A sandbox next-attempt row itself was not rendered in this review.

## Reviewed workflows and positive observations

| Scenario | Evidence and outcome |
| --- | --- |
| Welcome and initial focus | [Welcome](../../../var/stress/20261116T194355Z/prof/student-welcome.png): Exam ID receives focus, primary action is clear, recording/privacy disclosure is present, no grant/UUID/hash is exposed. |
| Synthetic sign-in and summary | [Summary](../../../var/stress/20261116T194355Z/prof/student-summary.png): actual local WASM SSH completes; the summary shows time, camera and starting files without asking the student to choose an attempt. |
| Setup and explicit Start | [Setup](../../../var/stress/20261116T194355Z/prof/student-setup.png): numbered prerequisites, practice terminal, disabled Start until ready, no countdown before Start. Start opens a deliberate confirmation. |
| Four terminals and enlarge | [Four panes](../../../var/stress/20261116T194355Z/prof/student-four-terminals.png), [maximized](../../../var/stress/20261116T194355Z/prof/student-maximized-terminal.png): clear timer, four-pane limit, arrange/maximize/restore work; this normal maximize operation did not exit fullscreen. This does not diagnose prior student incidents or qualify every browser/OS. |
| Finish | [Finish confirmation](../../../var/stress/20261116T194355Z/prof/student-finish-confirmation.png), [returned sign-in](../../../var/stress/20261116T194355Z/prof/student-finished-signout.png): saved-versus-unsaved work and account restriction consequences remain explicit; successful finish returns directly to sign-in. |
| Next-attempt overview | [Desktop](../../../var/stress/20261116T194355Z/prof/admin-unused-desktop.png), [375px](../../../var/stress/20261116T194355Z/prof/admin-unused-mobile.png): next attempt uses a distinct blue card/marker, actual duration/camera/dates/files are visible, no extra attempt-selection checkbox exists. Deliberately changed exam defaults remain clearly separate from the older saved attempt settings. |
| Inline time and dates | [Time](../../../var/stress/20261116T194355Z/prof/admin-inline-duration-mobile.png), [dates](../../../var/stress/20261116T194355Z/prof/admin-inline-dates-mobile.png): time becomes an ordinary prefilled field, date controls are native/prefilled, no technical date string is required. All measured document widths stayed within the 375px viewport. |
| Starting files | [375px file dialog](../../../var/stress/20261116T194355Z/prof/admin-starting-files-mobile.png): shows the actual published-starter choice and readable source name, with Review changes / Cancel. No copied hash or attempt identifier is required. |
| Bulk edits and cancel | [Bulk edit](../../../var/stress/20261116T194355Z/prof/admin-bulk-edit-mobile.png), [cancel](../../../var/stress/20261116T194355Z/prof/admin-cancel-next-mobile.png): selected count and eligible count are stated, unused attempts are not selected again, history/file preservation is explicit in cancellation. Draft previews were inspected; no permission was cancelled. |
| Add another attempt | [Form](../../../var/stress/20261116T194355Z/prof/admin-allow-another.png): latest allowance/webcam/source are fetched without copying IDs. Form/review confirmation counts and partial-failure behavior require the automated functional cases; this visual review did not submit an additional grant. |
| Review | [Completed review](../../../var/stress/20261116T194355Z/prof/admin-completed-review.png): useful timing facts, ordinary tabs, timestamped playback controls, compact refresh, technical details collapsed. This short synthetic screen-only recording does not qualify webcam synchronization, long VP9 playback or slow-download corner cases. |

## Later browser-DOM audit: hidden corrective date guidance (UX-08, P2)

While the full browser suite was still running, Prof inspected its saved [additional-attempt error DOM](../../../var/stress/20261116T194355Z/browser-corners-1/browser/prof-another-attempt-one-s-c809c-t-a-reason-prompt-at-1280px/error-context.md) and the actual `grant-issuance.tsx` handler. A stale fixture supplies Closes November 6 before Opens November 15, and the form correctly refuses to preview it. The visible alert says only “Could not continue. Check the details and try again”; the useful closing-date correction is hidden in collapsed Details. Show known field-validation guidance directly next to the field/ordinary alert, while keeping arbitrary server diagnostics collapsed. Preserve strict date validation and exact pending-intent semantics. This is actual DOM/source evidence, not a newly viewed screenshot; the stale fixture itself is not a product failure.

## Harness failures retained; no false product conclusions

The first capture attempt serialized a TSX `__name` helper into a synthetic media initializer without defining it in the page. Fake capture consequently failed and Chromium encountered an X image error. The corrected owned harness defined the serializer helper and used the headless platform; the student workflow then succeeded. Original logs/screenshots remain under `prof/first-attempt/`.

Additional failed locators were test setup/oracle mistakes: the initial date editor had not been cancelled by Escape, so bulk editing was correctly disabled; a previous abandoned setup no longer had unused-attempt edit controls; the visible completed state was **Files saved**, not **Completed**; and the legacy seeded locked attempt did not expose the expected countdown-pause action. Fresh producer-defined grant01 and the observed Cancel/Files saved controls supplied the follow-up evidence. These failures were retained rather than counted as product regressions.

## Cleanup and recommended next actions

The owned Chromium runs finished and closed. The exact fixture parent received SIGTERM and exited 0; all five recorded fixture/gateway descendants were gone, and loopback 3100/3101 independently refused connections afterward. Receipts: [before](../../../var/stress/20261116T194355Z/prof/cleanup-before.json), [after](../../../var/stress/20261116T194355Z/prof/cleanup-after.json). No production process, account, configuration, exam or recording was changed.

UX-01 is corrected and tested locally by the coordinator after Prof approved the wording; nothing is deployed. Next prioritize the stale student instructions and short pause explanation. Keep remaining P3 changes bounded, with focused visible-copy/focus regressions. The [stress report](report.md) separately records the discovered-and-fixed stale individual target in bulk editing, native recovery observations and unresolved capacity findings.
