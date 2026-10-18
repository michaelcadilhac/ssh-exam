# Automatic attempt-review refresh deployment

Deployed to `ssh-exam.cadilhac.name` on October 17, 2026 (Chicago), October 18 UTC.
Application source: `46a7d4b`. This release updates the web application only; the
class-server agent and account-isolation configuration were not changed.

Open reviews refresh images, incidents/messages, terminal choices and recording
events every five seconds, and on browser focus/connectivity recovery. Existing
selections and replay position survive refresh. Recording reads use validated
byte cursors and bounded batches instead of repeatedly downloading entire files.
Requests do not overlap; closing a review aborts its pending requests and stops
polling. Network failures retain the current review and offer retry.

Validation: type checks and production build passed; 145 unit/integration tests
and 38 Chromium browser tests passed. One browser-SSH-mode-specific test was
skipped in the standard interface suite. The production administrator session
confirmed image history, recording playback, selected tab/position retention,
manual refresh and successful automatic incremental requests.

The cutover verified that no exam had started, backed up persistent data and
configuration, and checked the running image and readiness afterward. Schema
version remains 8. Administrator, exam, enrollment, attempt, preview and
continuation rows and configuration fingerprints were unchanged. Readiness,
production qualification and notifications are enabled; maintenance is off.

Production image: `ssh-exam-workspace:live-review-46a7d4b`
(`sha256:e0f940eec8e78640c19054d9574a244eeb4c9b348877ea5fa78b3d188c55e110`).
Previous image is retained as `ssh-exam-workspace:pre-live-review-46a7d4b`.
Backup on marco: `/var/backups/ssh-exam/20261018T030947Z-live-review-web-cjfdvxhk`.

For rollback, first drain started attempts, tag the retained previous image as
`ssh-exam-workspace:1.0.0`, and restart `ssh-exam.service`. Keep current metadata;
this release has no schema migration, and restoring the old inspection snapshot
would discard subsequent activity. Monitoring backups remain subject to the
60-day deletion policy. Protected submissions remain on the class server.
