# Instructor timing and capture timeline

Attempt rows now show exam start/end dates and elapsed/time taken, with Chicago timezone
labels. Unstarted attempts show preflight opening time. Completed rows no longer display
an empty remaining clock. Pauses count toward elapsed exam time; finished intervals stop
at their effective end. Unknown historical end times do not keep ticking.

Review keeps preflight/exam start, end, elapsed/time taken, current deadline and connection/
terminal status visible across sections. Timing details include preflight duration, configured
allowance/webcam, original deadline, last browser contact, dated clock changes/actor and
attempt ID. Access warnings are visible immediately; access restriction/release dates appear
with server recovery details. Submission has execution/collection/protection dates and readable
file/omission counts and reasons; technical manifest and checksum remain available.

Each main screen/webcam picture now has its own keyboard-accessible history slider, selected
capture timestamp and receipt tooltip. Live follows incoming captures while the attempt is
working at the existing capture/poll cadence. Sliding selects history and preserves the frame
identity across polling and section changes. Pause/finish freezes the capture; resume requires
an explicit Live selection. Screen and webcam selections and terminal replay positions remain
independent. Image failure has a retry action; no timestamp dropdown or duplicate history
picture remains.

Database migration 010 adds only nullable `preflight_started_at`. New preflights record the
first opening on the webserver and preserve it on reconnect/restart. Existing attempts retain
NULL (“Not recorded”); last contact is not used to invent historical dates. No class-agent,
account policy, authentication, deadline enforcement or protected submission format changes.

Validation:

- Typecheck and production build passed.
- 257 server/unit/integration tests across 42 files passed; focused final timing helpers passed.
- Migration regression upgrades an existing version-9 attempt without altering its start/end,
  preserves new preflight dates on restart and applies once.
- 22 Chromium browser tests passed: grouped roster, inline/bulk settings, authorization,
  clock requests, errors/slow updates, monitoring deletion, incremental replay, mobile layout,
  history/live/pause/resume, human-readable timing and omission details, and SSH logout/finish.
- Actual fixture SSH preflight creation verifies the timestamp is populated before the timed
  start. Desktop/mobile screenshots were inspected at 1280, 430 and 390-pixel widths.
  Capture fixtures use synthetic images; no production student photos were copied.

Rollback must preserve the current database/deadlines/submissions. Migration 010 is additive;
older server versions ignore the nullable column. Do not remove the column or restore an old
state backup over newer attempts. Restore the previous complete image under the normal drain
barrier if necessary; the native agent needs no rollback for this UI deployment.

## Production verification

Deployed revision `a9bc573` on October 19, 2026, at 18:34 UTC. Both live and offline
cutover checks found no preparing/active/paused/unresolved attempts; no student was interrupted.

- Image: `ssh-exam-workspace:admin-timing-a9bc573`, also normal `:1.0.0` tag.
- Image SHA-256: `5f8189fc46130f84ca87725fa9f996fe402645499f6440ed62a5b74d97322654`.
- Previous image: `988ef297127a0b6644a6f6462755ebc2aa3b1b39da498fd809d6e271f1d41fc4`.
- Private backup/receipt: `/var/backups/ssh-exam/20261019T183428Z-admin-timing-vvt9_teo`.
- JavaScript `/assets/index-Dmv0O7y9.js` SHA-256:
  `fb574400e5094ac0324b4e905bf5c29a9040659cd8b7157fd3caa0b83f1bab02`.
- Stylesheet `/assets/index-BTmCEDaV.css` SHA-256:
  `62b964202b5f17de47508675c2e69a1028ee0c2b9edc737cca0e06fee7ea2e0b`.

The public admin HTML references these exact tested assets; deployed hashes match the local
production build. The container is healthy with zero restarts. Readiness is production-ready,
maintenance false, notifications enabled. Schema version 10 is installed; all 15 existing
attempts retain their identity, state, original/current deadlines, start/end, protection and
checksum exactly. Their unrecorded preflight dates remain NULL. Two instructor accounts,
sandbox and configurable instructor email recipients remain intact. Native class-server
binaries/configuration were not changed by this deployment.
