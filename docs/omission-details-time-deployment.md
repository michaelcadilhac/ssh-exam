# Detailed omission emails and readable time displays

Revision **6fe6443** was deployed to https://ssh-exam.cadilhac.name/ on
2026-10-18 at 23:14:00 UTC.

## Changes

Omission email subjects now identify the username and exam ID. Bodies include both
identities, the attempt ID, and every omitted entry with its manifest reason. Each
entry is quoted/escaped so a student-controlled filename containing a newline cannot
impersonate a notification field. Detailed reports for separate attempts are kept
complete instead of being merged into a truncated summary; identical pending replay
reports still deduplicate. Routine editor-lock suppression and independent collection
failure alerts are unchanged. No file contents, images or credentials are emailed.
The signed manifest and protected submission are unchanged.

A shared display formatter now renders elapsed ages/durations with explicit days,
hours, minutes and seconds as appropriate. Monitoring images no longer accumulate
thousands of displayed seconds; interruption emails also use readable time remaining.
Countdowns show minutes:seconds below one hour and hours:minutes:seconds above it,
including student clocks, the roster, open review and clock-action dialogs. Clock
action dialogs now tick with the live dashboard clock instead of freezing when opened.
Duration/extension inputs and CSV values remain explicitly in minutes. Short focus
and recovery grace intervals appropriately remain in seconds; retention stays in days.

Submission review shows the attempt's frozen exam duration in readable units. Existing
started/deadline/collection timestamps retain their explicit Chicago timezone.
Unformatted manifest data is behind a separate **Raw manifest (technical)** disclosure,
with the storage units labeled. Device-local exam-setting inputs still convert to
absolute timestamps. No stored units, original/current deadlines, authorization,
collection, access restrictions or clock-change semantics changed.

## Validation

- Typecheck, production build and all **210 unit/integration tests** passed.
- Regressions cover email identity/details, mixed omissions, escaped filenames,
  complete long reports, pending replay deduplication, editor-lock suppression and
  collection failure alerts.
- Format tests cover rounding, expiration, hour/day boundaries, invalid values and
  explicit dates across daylight-saving changes.
- All **18 admin browser checks passed in Edge**, including desktop/mobile time
  displays, live clock dialogs, inline minute edits and preservation of review tabs,
  monitoring images and replay positions during automatic refresh.
- All **14 timezone browser checks passed** across UTC, Los Angeles, New York, London,
  Kathmandu, Honolulu and Kiritimati. These cover device-local exam settings and
  fixture SSH/MFA, individual allowances, clock reset/extension, original deadline
  preservation and collection. Old minute-only clock assertions were updated to the
  new hour notation before rerunning the timezone suite.
- **Two checks against the deployed frontend passed in Edge**, at 1280px and 430px.
  These used locally intercepted API fixtures, without changing production students.
- Public HTTPS readiness reports productionReady and notifications true, maintenance
  false. The container is healthy, systemd is active and CSP remains present. Deployed
  frontend and changed backend-module checksums match the tested build.

## Deployment and rollback

Marco's normal checkout/Compose/systemd workflow was used. No preparing, active,
locked or unresolved collection was present at cutover; activity was rechecked after
stopping the service before the consistent offline backup. No student reset or
submission mutation was performed. Private configuration, nginx, SMTP, sandbox and
administrator access were preserved. No native class-server binary changed, so
csc-sys required no installation or restart. No schema migration was introduced.

- Image tag: `ssh-exam-workspace:omission-details-6fe6443`, also tagged as the standard
  `ssh-exam-workspace:1.0.0` service default.
- Image SHA-256:
  `1eec4675e955a5cd2697df64c77320cbecc03fa4801c6b2618e98c49c26755ba`.
- Lifecycle module SHA-256:
  `c6fde94d195067b3d47aea2b8fdb9ef79aa07940620c8d7886a85a2034782c0e`.
- Shared time module SHA-256:
  `8cf597b65930bf52ba5a61696c9cb8a8e91175a9b93918687b9c20cbc16f686e`.
- Frontend: `/assets/index-ChJkGmWi.js`, SHA-256
  `5b4d9996f11e511f0c28f85a0786ac53d9997182475dfebb23e51293411f422c`.
- Backup/receipt on marco:
  `/var/backups/ssh-exam/20261018T231354Z-omission-details-oj_g7d_3`.
- Previous image SHA-256:
  `e739a1d4c147212ff70599b3fdb16f7518035b21137b170f2e55fc5d9abbda57`.

To roll software back, drain student preparations/attempts, retag the previous image
as the standard default and restart ssh-exam. Preserve newer database, monitoring,
receipts and submissions; do not restore old data to reverse a presentation update.
Reload pages when changing frontend versions. Existing sent email history is unchanged.
Apply the normal monitoring-backup expiration policy.
