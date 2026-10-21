# Instructor operations

Bootstrap the initial administrator interactively and visit /admin. **Add administrator**
creates additional accounts with the same permissions. Sign out is in the header.

Local pending upgrade: the unchanged ordinary-exam SSH sign-in limit is five
starts per account/exam within 60 seconds. A refusal now gives the remaining wait
instead of blaming passwords/MFA; an existing attempt's clock and holds continue.
Wait, then deliberately sign in again—do not retain/retry credentials automatically
or reset restrictions to work around the limit. This message correction is not
deployed and does not change instructor authorization requirements.

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

Each attempt also shows its interruption count. Expand it directly in the table to see every
recorded pause, its reasons, start/end, duration and approvals. The disclosure works with
keyboard Enter/Space and stays open during refresh. A continuous pause remains one entry
when further reasons arrive or an approval is revoked. **Awaiting resume** means approval was
given but the student has not successfully continued; it does not stop the pause duration.
Expired/replaced/revoked approvals and automatic sandbox approvals are identified separately.
A resumed interval stops at successful Continue; a pause that reaches the exam end is labeled
**Ended with exam**. The same history appears in Review → Activity without duplicating the
incident reasons. History uses server timestamps and explicit Chicago timezone labels.

Older records preserve known reasons and dated approvals, but say **Duration not recorded**
when the old implementation did not record the actual resume. Do not interpret an approval
as proof that the student resumed. Monitoring deletion/60-day expiry also erases this history;
rows then show **History deleted**, not an assertion that the attempt was uninterrupted.

Click a student's displayed duration or webcam requirement to edit it in the table.
Save applies the change; Cancel or Escape discards it and returns focus to the value.
Use the student's **Actions** menu for enrollment removal. Use an attempt's **More** menu for clock actions. **Review** opens monitoring,
incidents and recovery for that particular attempt. Controls support keyboard navigation
and Escape; opening review focuses Close review, never Authorize resume.

**New exam** and **Exam settings** configure the name, start window, duration, default
webcam requirement, terminal count and root-approved material template. See
[Creating an exam template](template-authoring.md) for authoring and installation.
Materials template names identify files installed on the SSH server. Settings apply to future attempts. Attempt rows show start/end dates and time taken, or the live countdown and elapsed time. Unstarted rows show when preflight opened. Dashboard times use America/Chicago; start-window
inputs use your device timezone. Sandbox always starts with five minutes.

The duration value selects an individual allowance (1–360 whole minutes) or restores
the exam default. The webcam value changes the requirement, with required/not-required/
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
screen and webcam captures with independent history sliders and terminal replay. Each image shows its capture date/time and receipt time in the tooltip. Drag the slider or use its arrow keys; **Live** follows incoming captures only while the student is working. Live uses the existing capture cadence and five-second refresh; it is not a continuous video stream. Pausing/finishing freezes the selected image, and resuming does not silently return an instructor to Live. The open review refreshes
automatically every five seconds and when the page regains focus or connectivity. Activity
and recording updates preserve the selected review section, historical image, terminal and
replay position. Recording refreshes fetch only new events; they do not restart playback.
Refresh and inline retry remain available after a network failure. The timing summary stays available across review sections: preflight opened, exam started/ended, elapsed/time taken, current deadline and connection/terminal status. Expand **Timing and monitoring details** for preflight duration, original deadline, configured duration/webcam, last browser contact, clock-change dates/actor and attempt ID. Elapsed exam time includes pauses because the clock continues; it stops at the recorded effective end or current cutoff. Historical preflight dates that were never recorded say **Not recorded**. Activity lists incidents
and student messages for that attempt. **Authorize resume** grants the paused attempt one fresh-SSH recovery before
its deadline; sandbox grants authorization automatically. Approval does not grant time.
In the local C1f implementation (not deployed), **Authorize resume** first opens
confirmation for the reviewed generation/revision and an audited reason. Polling
cannot silently authorize a replacement or changed student request. After a lost
reply, retry the unchanged confirmation; it cannot extend expiry. Expiry remains
five minutes or the current deadline, whichever comes first. Fresh SSH/current
monitoring and Continue are still required; retained-buffer freeze is not enabled.
`examctl web interruptions help` exposes the same review/authorization workflow
using the root agent identity. See interruption-management.md for private read
retention, revisions and compatibility. Existing deployed behavior is unchanged.
The review stays current even if its attempt no longer matches the roster filter.

Submission distinguishes collection pending/failed from a verified protected copy. It
shows collection/execution/protection timestamps, file and omission counts/reasons, manifest/checksum, and server-access recovery/release dates; no
archive downloads are offered. Monitoring deletion requires explicit confirmation naming
the student and attempt and keeps the submission. Client reports are evidence, not
misconduct scores. Administrative actions and sensitive recording access remain audited.

Local C1ga (not deployed) adds `examctl web monitoring help`: shared summary,
bounded frame/terminal metadata pages and byte-cursor terminal replay. Explicit
private output saves one batch, not all monitoring; all retries recheck deletion
and store metadata only in permanent request records. Current browser replay uses
the same bounded reader. Local C1gb2 now queues isolated physical purge without
blocking deletion/retention/preflight retirement on filesystem work. Web review
and CLI show distinguish immediate logical deletion from pending/running/retry
and timestamped verified-absent status. This verifies only the current private
directory, not backups or secure erasure. Keep deletion records/locks; diagnose
storage/permissions and allow durable automatic retry. See monitoring-cli.md and
monitoring-purge-isolation.md; full media export/shared deletion intents/CLI delete
were still open at C1gb2. Local C1gb3 now adds the same reviewed deletion workflow
to CLI and web review: ended eligibility, named student, exact review revision,
audited reason and stable intent. Start with `examctl web monitoring show ATTEMPT`
and `examctl web monitoring help`. Exact retries do not requeue/reset backoff;
fresh show reads physical status. Full media export and retired-preparation job
inventory remain outstanding. Not deployed.

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

Local pending upgrade: [durable alert episodes](alert-episodes.md) distinguish an
unchanged failure from a new cause or recurrence. Review requests remain in the
audit but repeated identical messages email once per interruption. Routine Emacs
lock links no longer require a saved sibling to suppress omission email; their
manifest entries remain intact. This is locally implemented, not deployed.

Interface previews using disposable test data:
[desktop](screenshots/admin-redesign-desktop.png) ·
[narrow window](screenshots/admin-redesign-mobile.png).

### Activation and cancelled preflights

An activation pause names the failed browser/connection conditions and records that
reason in the incident audit and server log. Brief focus loss during activation has
the same 20-second grace period as active work. The countdown continues after a
server-committed start. A later execution-lease timeout does not replace the original
pause reason; the class-server cause is recorded separately.

An abandoned preflight can be retried once the agent confirms it never started and
account policy is normal. If policy was never applied, the agent explicitly confirms
that fact after cancellation/restart. Actual restoration failures remain blocked and
are reported as account-restoration failures rather than uncertain start status.

Monitoring acknowledgment freshness is independent of status snapshot order. Healthy
WebSocket replies still confirm the connection when HTTP polling delivers newer exam
state first. The 15-second network limit and instructor recovery policy remain in
force; delayed, replayed or previous-connection replies cannot reopen a paused exam.
Monitoring incident diagnostics include acknowledgment age and rejected-snapshot count.
