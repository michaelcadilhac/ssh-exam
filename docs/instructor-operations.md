# Instructor operations

Bootstrap the initial administrator interactively and visit /admin. **Add administrator**
creates additional accounts with the same permissions. Sign out is in the header.

First select an exam in the top bar. The exam toolbar contains **Exam settings** and
**Add student**; **New exam** remains beside the exam picker. Global **Administration**
contains **Alerts**, **Add administrator** and **Sign out**. Notification setup and SMTP
recipients remain deployment-controlled; Test email alert reports queueing, not delivery.

A compact overview filters **All students**, **Working**, **Needs attention** and **Secured**.
The filter menu also offers individual states and webcam requirements. Search and filters
apply across the entire roster before pagination. Every matching attempt appears beneath
its student, with stable attempt numbers. Rows show current webcam requirements and live
clocks; the student row separately labels future settings. **Working** requires live SSH,
an acknowledged browser connection and fresh contact. Updates poll every five seconds;
clocks tick every second. Failed or silent updates are marked stale and clock edits are
blocked until fresh data arrives. Removed enrollments retain their history.

Use a student's **Actions** menu for future duration, webcam settings and enrollment
removal. Use an attempt's **More** menu for clock actions. **Review** opens monitoring,
incidents and recovery for that particular attempt. Controls support keyboard navigation
and Escape; opening review focuses Close review, never Authorize resume.

**New exam** and **Exam settings** configure the name, start window, duration, default
webcam requirement, terminal count and root-approved material template. See
[Creating an exam template](template-authoring.md) for authoring and installation.
Materials template names identify files installed on the SSH server. Settings apply to future attempts. Dashboard times use America/Chicago; start-window
inputs use your device timezone. Sandbox always starts with five minutes.

**Set duration** selects an individual future allowance (1–360 whole minutes) or restores
the exam default. **Set webcam** changes only future attempts, with required/not-required/
exam-default choices. Prepared and active attempts retain their original settings.
**Reset clock** sets a current countdown to the student's configured allowance, falling back
to the exam default, counted from the request time. **Extend time** adds 1–360 whole minutes
exactly to the current deadline. Both preserve an active student's connection and original
access restriction. Expired/finalizing/secured attempts cannot be reset or extended.

For bulk edits, first choose **Bulk actions…**: Set duration/Set webcam targets students'
future settings; Reset clock/Extend time targets eligible current attempts. Then select
rows or use **Select page**. One selection scope is active at a time; changing the action,
exam, search, filter or page clears selection. Apply shows the named targets and scope
before confirmation. Clock changes are capped at 100 attempts per request. Each request
has a persisted identity and revision, so retrying cannot add time twice. Pending changes
remain visible on the attempt row, and partial failures remain in the action dialog.

A disconnected clock change stays pending until the agent confirms it at reconnection or
its signed outbound check before deadline collection. Absolute reset deadlines and additive
extensions survive delivery delays/restarts. Unavailable timing verification freezes work
at the last committed deadline and defers packaging; restore HTTPS/signature trust to recover.
A reset or extension does not authorize a locked student to resume or reopen finished work.

**Add student** opens one dialog: choose **One student** to enroll a root-approved existing
course account with optional future duration and webcam overrides, or **CSV file** to upload
a roster. Download the example CSV from that dialog and replace its sample usernames.
Selecting a file automatically validates it and shows a preview; **Confirm import** applies it.
There is no CSV paste field or display-name setting. Removing enrollment requires confirmation;
it blocks future Begin but does not stop an already running exam or delete history, monitoring
or protected submissions.
Only a server administrator can stop a running exam using local `examctl stop`.

Enrollment and CSV preview do not require an `examctl accounts` listing or an online
class agent. Account existence, identity and SSH-side eligibility are checked during
the student's SSH login, before preflight. Enrollment itself never provisions a
server account or changes its access policy.

CSV upload supports headers `username`, `duration_minutes`, `require_webcam`.
Usernames preserve capitalization and must match the approved course-server account exactly.
They contain 1–32 characters: an initial letter followed by letters, digits, underscores,
or hyphens. Invalid usernames are reported with their row number and value.
Missing optional columns stay unchanged;
blank/inherit duration/webcam restores the exam default. Webcam accepts true/yes/1 or
false/no/0; duration is 1–360 whole minutes. Preview, then Confirm; imports are transactional,
idempotent add/update, never replace omitted students, and never modify current clocks or
attempt settings. Use webpage bulk clock actions separately. Invalid accounts/headers/rows
block import. Limits: 10,000 students, 10 MiB. Roster CSV export remains available through the
authenticated API.

**Review** has Monitoring, Activity and Submission sections. Monitoring provides the
latest authenticated images, image history and terminal replay. The open review refreshes
automatically every five seconds and when the page regains focus or connectivity. Activity
and recording updates preserve the selected review section, historical image, terminal and
replay position. Recording refreshes fetch only new events; they do not restart playback.
Refresh and inline retry remain available after a network failure. Activity lists incidents
and student messages for that attempt. **Authorize resume** grants the paused attempt one fresh-SSH recovery before
its deadline; sandbox grants authorization automatically. Approval does not grant time.
The review stays current even if its attempt no longer matches the roster filter.

Submission distinguishes collection pending/failed from a verified protected copy. It
shows collection timestamps, manifest/checksum and server-access recovery details; no
archive downloads are offered. Monitoring deletion requires explicit confirmation naming
the student and attempt and keeps the submission. Client reports are evidence, not
misconduct scores. Administrative actions and sensitive recording access remain audited.

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

Interface previews using disposable test data:
[desktop](screenshots/admin-redesign-desktop.png) ·
[narrow window](screenshots/admin-redesign-mobile.png).
