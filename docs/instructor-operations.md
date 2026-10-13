# Instructor operations

Bootstrap a local administrator interactively and visit /admin. Select an exam to
manage its visible roster. Add an existing course-server username with an optional webcam
override, or expand Import multiple students for CSV preview/confirmation. Remove requires
confirmation and removes enrollment only; attempt history and submissions are retained.
Removal blocks future Begin requests but does not end an already running exam. A server administrator can end an attempt locally with `examctl stop`; the dashboard has no stop action. Escape cancels removal and closes review dialogs. Sign out is in
the dashboard header.

 Configure ID/name/start window,
duration/webcam default/terminal count and root-approved template ID. Private per-enrollment
overrides snapshot before starts. Dashboard times are America/Chicago; UTC is persisted.
Start-window inputs use your device timezone.

Roster upload/paste supports CSV or selected one-username-per-line mode. Columns: username,
require_webcam, display_name, duration_minutes. Webcam true/yes/1 or false/no/0 is case-insensitive;
empty/inherit clears an override. Missing optional columns leave existing fields unchanged;
explicit blanks clear them. Duration is whole minutes 1–360. Privileged/unapproved identities
and invalid headers/values block confirmation. Limits: 10,000 students, 10 MiB.

Preview, then Confirm. Imports are transactional/idempotent add/update, never replacement;
omitted students are kept. Current attempt settings/deadlines stay fixed. Exports neutralize
formula-leading names. For individual/bulk webcam edits, paste just the chosen usernames and
require_webcam column using the same preview/confirmation; omitted duration/name stays unchanged.

Live table supports search/pagination and explicit active/locked/finalizing/collection failure/
completed/export states. Failed polling shows stale data. Review contains private images,
capture/receipt times, incident/student message activity and terminal timestamp replay.
Client reports are evidence, never automated misconduct scores.

Authorize only current locked incidents before deadline. Grants last five minutes or until
deadline and are single-use; students must restore current required conditions and Continue.
Replacement page/lost SSH needs approval; reauthentication stops capture before passwords.
Approval never grants time and is delivered during fresh SSH authentication, without a separate remote request.

Enable desktop alerts with a user gesture; desktop/sound require the open dashboard.
Test actual SMTP receipt before production. Durable outbox uses capped retries and records
delivery failures. Alerts have authenticated links, never images/one-click actions. Requests
are rate-limited; correlated triggers group within incidents. Local protection, export pending
and collection failure require different recovery actions.

Downloads require instructor auth/audit. Bulk downloads wrap protected archives without
unpacking programs; grade elsewhere. Ended monitoring deletion needs confirmation and keeps
submissions; monitoring also expires after 60 days. Deletion of the web download copy is a separately named
explicit operation; the protected original is removed only by local root examctl, disabled from automatic retention by default. Minimal attempt metadata/
checksums and deletion ledger remain. Maintain consistent private backups and current tombstones.

Submissions are automatic. Students do not upload or run submission commands. The optional
Finish exam action is irreversible; otherwise the class-server deadline watchdog collects
saved files even with a disconnected browser or gateway. Review original deadline, actual
completion/collection/protection timestamps, reason, checksum and the file manifest.
“Collection pending/failed” is not a successful submission. A secured protected copy with
transfer pending remains recoverable; downloads appear only after verified transfer.
Monitoring expires after 60 days; submission archives and receipts have separate retention.

Submission secured and account access are separate dashboard statuses. An early finish does
not release ordinary server access until the original deadline and verified protection/cleanup.
Finished attempts cannot resume even with an instructor continuation grant. The dashboard
shows the last class-server access-state check and any release-recovery failure. An outage
may leave that display stale; native state remains authoritative. Do not delete the protected class-server original while an interval hold exists. Root emergency overrides are deliberately outside the dashboard,
require already secured work and an audited reason, and do not reopen attempts.
