# Private-desktop real-account exam test

2026-10-20. The requested 30-minute run uses `mcadilha`, not a student identity.
Status: passed. Protected collection and monitoring were independently verified.

## Environment and scope

The browser runs on a separate Xvfb display with its own window manager, Xauthority
and D-Bus session. Screen capture is of that virtual display; the user's normal
desktop is not captured. Screen sharing, fullscreen and Keyboard Lock use actual
browser APIs rather than mocked readiness flags.

The page uses production APIs, the class-server relay, configured SSH host keys,
DePaul phone MFA, and the installed class agent/watchdog. A local static-asset
override loads the candidate sign-in diagnostic frontend without restarting
production services. The subsequent phone-approval and recovery-feedback UI
changes are verified separately by browser regressions; they are not retroactively
part of the already-loaded page.

The password is entered directly into a loopback-only temporary form, then passed
in memory to the normal browser authentication flow. It is not entered into chat,
written to files, included in process arguments, or recorded in screenshots/traces.
The form clears its references and mutable request buffers where practical;
JavaScript memory cleanup remains best-effort. Host messages and user answers are
separate. DePaul number matching needs an empty `Code:` response after phone
approval; this is a user-confirmed acknowledgment, not an OTP or a second password.

`mcadilha` uses the existing administrator sandbox exception. Ordinary administrator
access remains intact. This run checks functionality and collection, and does not
qualify isolation against an unprivileged student trying alternative access paths.

## Attempt

- Exam: `sandbox`; attempt `121d8b7e-4c4c-411f-a835-0e596e52610b`.
- Start: `2026-10-20T06:53:21.643Z` (01:53:21.643 America/Chicago).
- Original deadline: `2026-10-20T06:58:21.643Z`.
- This attempt alone received an audited 32-minute clock reset, confirmed at
  revision 1. Effective deadline: `2026-10-20T07:25:23.963Z`.
- The shared sandbox still has its normal five-minute duration. The original
  deadline remains recorded, unchanged.
- The test waits for 1,800 actual monotonic seconds after beginning. No browser or
  server clocks are accelerated. Finishing is requested only after that wait.

## Exercised workflow

Real authentication, preflight, readable practice instructions and account lookup;
installed GCC, GDB, Python and Emacs; floating initial window and maximize/restore
icons; closing the practice terminal; actual capture/fullscreen/keyboard lock;
beginning the exam and confirmed clock reset; shell input and saved files;
compilation and debugging; editing/saving with terminal Emacs; Emacs clipboard
output and pasting into another terminal; closing and replacing a terminal without
reauthentication; a background writer and periodic saves throughout the run.

The final check must confirm a protected checksum-verified archive, exact saved
file contents, stopped background writer, immutable repeated finish, sign-out,
and unchanged agent/watchdog processes.

The existing interactive-shell warning `Failed to connect to bus: No medium found`
is still visible for this account. It did not prevent shell input, Emacs, GCC,
GDB or Python from working. This run does not diagnose its origin or change the
account's personal startup files, and does not expose a desktop session bus to
restricted student shells to suppress it.

## Fixes found during testing

- Failed SSH login now preserves escaped host instructions in expandable details,
  separately from cleared password/code answers. This makes upstream errors
  diagnosable after the login dialog closes.
- The exact known DePaul phone-number challenge offers **Continue after phone
  approval**, which sends an empty response only on explicit user action. Other
  hosts and ordinary OTP prompts retain their normal input fields.
- Repeated disconnected status no longer erases reconnect errors or repeatedly
  invalidates an in-progress recovery action. New interruptions still clear stale
  feedback. Authorization requirements and blocked terminal input remain enforced.
- Terminal-cleanup browser tests now use dedicated synthetic fixture accounts so
  a prior test's deliberately held exam cannot deny their independent login.

Details: [sign-in and recovery diagnostics](ssh-sign-in-diagnostics.md).

## Automated validation

- 278 unit/integration tests passed; typecheck and production build passed.
- 15 sign-in/recovery browser regressions passed, including phone acknowledgment,
  retained host details, reload/offline recovery, stale replies, unchanged-gap
  error visibility and blocked input before authorization.
- Three additional browser tests passed: attempt exceptions, rejections, process
  death, resource exhaustion and hangs do not interrupt another exam; email
  alerts/retries and recovery authorization remain enforced; closing shells,
  panes, logging out/back in and finishing leave no stale sessions.

A broad browser run exposed existing cross-file synthetic-account reuse: tests
that leave an original exam interval held can deny later tests reusing that same
account. That run was stopped and is not counted as a full-suite pass. Relevant
specifications are also run with fresh fixture servers. Fixture SMTP is mocked;
failure-isolation tests do not send test mail to instructors.

## Final outcome

The monotonic soak lasted **1,800.003 seconds**. Finish was requested after saving
the final answer; native completion was `2026-10-20T07:23:24.887Z`
(02:23:24.887 America/Chicago), **1,803.244 seconds after start**. Protected
collection was secured at `07:23:24.913Z`. The UI returned to sign-in with zero
terminal windows and an unauthenticated session (HTTP 401).

The root-only class-server archive is:

```text
/var/lib/exam-agent/submissions/121d8b7e-4c4c-411f-a835-0e596e52610b/submission.tar.gz
```

Its companion `manifest.json` remains in that protected directory. Archive SHA-256:

```text
c629525595cd6b26d711345ab73695174b43cbcd4457ddd56fead45b9842cf9b
```

Direct archive inspection verified exact answer, Python source, Emacs save and
clipboard-copy contents; C source and compiled ELF binary; five periodic progress
saves; and 591 background-writer entries. The background log stopped changing
after finish. A second administrator `examctl finish` changed neither completion
metadata nor the archive checksum. No native errors or tracked exam units remained.

The webserver independently reported COMPLETED/protected with the same checksum.
All **361 screen images** were present, spanning 1,800.374 seconds with a maximum
gap of 5.373 seconds. Three valid terminal recordings contained 992 events in
112,367 bytes. No interruption audit events or attempt alerts were found.

Class agent/watchdog PIDs stayed at 1655586/1655591, both active with zero restarts.
The administrator's `/bin/bash` and sandbox exception remain intact. The private
browser, virtual desktop and temporary password form were closed afterward.

The UI fixes and regression tests described above are local changes; production
services were not redeployed or restarted as part of this test. The protected
submission and audit records remain on their normal servers. Detailed transient
test receipts and screenshots are in the private local directory
`/tmp/ssh-exam-private30-YUAruv`; no authentication screenshot, password or response
value is included in the test receipts.

The user subsequently requested deployment; see the
[production receipt](ssh-sign-in-diagnostics-deployment.md) for that separate
web-only rollout.
