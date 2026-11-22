# Student instructions

> Updated November 17, 2026.

An **attempt** is one timed sitting of an exam, with its own time limit and
opening/closing times.

## Sign in and check your setup

1. Use desktop Chrome, Edge or Chromium. Save other class-account work: starting
   closes your other server sessions and processes. Follow your instructor's
   reference and monitor rules. References may be physical documents or files
   read through exam terminals.
2. Enter the exam ID and your enrolled username, then choose **Sign in**. Enter
   your password when asked. It is reused for the class server, then
   discarded. Keep the page open; the number for your phone app may take a moment
   to appear.
3. Approve the current sign-in request on your phone and keep this page open.
   Sign-in continues when approval is confirmed. If the page shows **I approved
   on my phone**, choose it after approving. Do not enter the phone approval
   number on the exam page; follow the displayed instructions for other
   verification-code prompts.
4. Check the exam name, time limit and webcam requirement. Choose **Check setup and
   practice**, then complete the numbered buttons in order:
   - **Share entire screen:** select the display containing the exam, not a tab
     or window. Browser checks cannot verify all additional displays.
   - **Enable webcam**, when required: check that the preview is clear and
     correctly framed.
   - **Enter fullscreen**, then **Lock keyboard** as a separate action.
5. Use **Practice terminal** to check your editor and keyboard shortcuts. This
   uses no exam time. Setup expires
   **15 minutes after you open it**, even while connected. Before starting,
   **Sign out** cancels setup and closes practice terminals; you can sign in again.

Sandbox practice lasts five minutes and opens when your instructor schedules it.
If it is closed, ask your instructor. **Check again** refreshes availability after
an opening or permission update; it does not start the exam or use an attempt.

Capture starts after sign-in, when you enable sharing. Setup images may be retained
if you start; abandoned setup images are deleted.

## Start and work

Choose **Start exam** and confirm. The server starts and enforces your clock only
when starting succeeds; no second password or phone approval is normally needed.
If the result is unclear, check the current status before trying again. A delayed
reply does not reset a clock that already started.

The countdown normally continues during disconnections and instructor review.
Check **Time remaining** or **Countdown paused**. Your instructor may pause the
countdown, including automatically during review. Pausing the countdown alone
does not stop terminal work; other exam checks still apply. Time is not added
automatically. Opening/closing times control when you can start, not the deadline
after starting.

Save answers in the directory shown in the toolbar, normally **`/work`**. Read
provided files in **`/materials`**. Use `exam-info` to check your deadline and work
directory. Files outside the work directory and unsaved editor changes are not
submitted.

Use terminal title bars to move, rename, maximize or minimize windows;
**Arrange terminals** tiles them and **Terminals** lists minimized terminals. Save
before closing a terminal: its programs will stop. Escape closes optional dialogs,
but not paused-exam or file-saving screens.

Your shell/editor settings are available through a read-only home directory.
Temporary cache, history and editor state are discarded after the attempt's
processes end; they are not submitted or copied back to your real home.

## If work pauses

Keep the original page and terminals open. **Do not reload to fix a pause.** A
temporary update or monitoring delay may recover automatically while the original
page and connection still work. A delay or timeout alone is not a misconduct finding.

**Local update, not yet deployed:** If a required check is interrupted, typing
pauses and a warning gives you **15 seconds** to restore it. Return to the exam
and use any restore buttons shown. Typing returns automatically after the checks
pass; you do not need to ask your instructor for a brief, verified recovery.
Screenshots continue where possible. Repeated interruptions share the same window.
Connection delays may instead show **Reconnecting** while typing stays paused;
a timeout alone is not a reported student violation.

The exam timer keeps running unless your instructor pauses it. If the warning
expires with required checks still missing, follow the review instructions below.

Request instructor review when asked. After approval, restore missing screen/webcam
sharing, fullscreen and keyboard checks, then choose **Resume exam**. This uses the
same attempt if the original page and connection still work; no time is added. A
pause can preserve terminals and unsaved editor changes; save regularly anyway.

If the page or SSH connection is lost, ask your instructor to approve resuming.
Sign in again when asked. Saved files reopen in new terminals; running programs
and unsaved edits are not restored. Your deadline stays the same unless your
instructor changes it. A finished attempt cannot resume. Your instructor may
instead allow a new attempt from saved files, with a separate time limit.

## Finish and file collection

Saved work-directory files are collected automatically when time expires or you
finish. **No upload, submission command or archive is needed.** Unsaved editor
changes are excluded.

**Finish exam** is optional. Save first: confirming it closes your terminals,
collects saved files and signs you out. That attempt cannot be reopened. Closing
the browser does not finish the exam. Do not assume it pauses the countdown.

**Files saved** confirms a protected copy. If saving/protection needs attention,
contact your instructor; do not submit another copy yourself. Capture stops when
the attempt ends.

Finishing early does not restore ordinary access to your class account. Restrictions
remain until the original deadline (or a later deadline your instructor sets) and
confirmed file collection. Signing out, closing the browser or receiving a new
attempt does not by itself release those restrictions.

## Privacy and the exam clipboard

We record screen images every five seconds, webcam images when required, and
terminal output. We do not record audio or raw keystrokes. Monitoring normally
expires after 60 days; saved submissions have separate retention. Recorded
events are for instructor review, not automatic misconduct findings. Browser
monitoring cannot rule out other devices or compromised operating systems.

The exam clipboard stays within your attempt and does not change your computer's
clipboard. Paste between exam terminals with **Ctrl+Shift+V** or right-click
**Paste**. In terminal Emacs, **C-w** cuts and **M-w** copies the selected region;
normal **C-y** still works.
