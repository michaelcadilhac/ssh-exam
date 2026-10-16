# Instructor operations

Bootstrap the initial administrator interactively and visit /admin. **Add administrator**
creates additional accounts with the same permissions. Sign out is in the header.

First select an exam. The page shows only that exam's counts, students, attempt history,
incidents and monitoring. **New exam** creates an exam; **Exam settings** changes the selected
exam's name, start window, duration, default webcam setting, terminal limit and root-approved
material template. See [Creating an exam template](template-authoring.md) for the
folder format, authoring handoff and class-server installation. Settings apply to future attempts. Dashboard times use America/Chicago;
start-window inputs use your device timezone. Sandbox always starts with five minutes.

One table groups each student with every attempt beneath them, newest first. Enrollment
settings are on the student row; attempt rows show their own fixed monitoring requirement,
current status, countdown, collection protection and review controls. Removed enrollments
retain history. Students without attempts remain visible. Search/pagination works by student,
keeping each student's attempts together. **Working** requires that attempt's live SSH,
open browser connection and fresh contact. Clocks tick each second; status refreshes every
five seconds. Stale polling is marked. Attempt numbering stays stable through filters.

**Set duration** selects an individual future allowance (1–360 whole minutes) or restores
the exam default. **Set webcam** changes only future attempts, with required/not-required/
exam-default choices. Prepared and active attempts retain their original settings.
**Reset clock** sets a current countdown to the student's configured allowance, falling back
to the exam default, counted from the request time. **Extend time** adds 1–360 whole minutes
exactly to the current deadline. Both preserve an active student's connection and original
access restriction. Expired/finalizing/secured attempts cannot be reset or extended.

For bulk edits, select student checkboxes for future settings, or eligible attempt checkboxes
for current clocks. Bulk controls expand when selecting; page-wide selection buttons are
available. Confirmation identifies targets. Up to 100 clock changes are queued per request.
Each attempt uses a persisted unique request ID and revision; retries do not add time twice.
Results can be pending, confirmed or failed independently. Do not repeat a lost extension
with a new request as compensation. Refresh/review its pending state first.

A disconnected clock change stays pending until the agent confirms it at reconnection or
its signed outbound check before deadline collection. Absolute reset deadlines and additive
extensions survive delivery delays/restarts. Unavailable timing verification freezes work
at the last committed deadline and defers packaging; restore HTTPS/signature trust to recover.
A reset or extension does not authorize a locked student to resume or reopen finished work.

**Add student** enrolls a root-approved existing course account, with optional future duration
and webcam overrides. Removing enrollment requires confirmation; it blocks future Begin but
does not stop an already running exam or delete history, monitoring or protected submissions.
Only a server administrator can stop a running exam using local `examctl stop`.

CSV upload/paste supports headers `username`, `display_name`, `duration_minutes`,
`require_webcam`, or one-username-per-line mode. Missing optional columns stay unchanged;
blank/inherit duration/webcam restores the exam default. Webcam accepts true/yes/1 or
false/no/0; duration is 1–360 whole minutes. Preview, then Confirm; imports are transactional,
idempotent add/update, never replace omitted students, and never modify current clocks or
attempt settings. Use webpage bulk clock actions separately. Invalid accounts/headers/rows
block import. Limits: 10,000 students, 10 MiB. Roster CSV export is available.

Review contains authenticated, audited images, terminal replay, incident messages, collection
manifest, checksum and access recovery information. Client reports are evidence, not automated
misconduct scores. **Authorize resume** grants the current lock a single fresh-SSH recovery
before the deadline; sandbox grants the same authorization automatically. Students reauthenticate
with capture stopped, restore conditions and continue. Approval does not grant time.

Submissions are automatic: saved files are collected at expiration or irreversible Finish exam.
Archives remain in root-private storage on the SSH server. The webserver receives signed
completion/manifest metadata and monitoring; there are no submission download or web archive
deletion controls. Authorized server administrators use `examctl manifest` and `examctl export`
locally. Collection pending/failed differs from verified protection. Pending status delivery
never recollects work. A protected early finish does not release ordinary account access before
both original/current deadlines and verified workload cleanup. Root emergency overrides remain
outside the dashboard. Monitoring expires after 60 days; archives/receipts have separate retention.

Enable optional desktop/sound alerts while the dashboard is open. Test actual SMTP receipt
before production. Signed callback failures and the durable email outbox retain recoverability.
Alert links require normal authentication and never expose images or perform an action on GET.
