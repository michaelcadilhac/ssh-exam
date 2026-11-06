# Current milestone — timer controls and sixty-second timeouts

Requested November 5; work continues November 6. Implemented/tested LOCAL ONLY.
Plan and detailed evidence: docs/timer-controls-followup.md. Preserve the ten
original modified docs/screenshots files; do not commit or overwrite them.

## Implemented

- Browser/gateway/native/relay operational network budgets and monitoring
  freshness: 60 seconds. Focus grace: 60 seconds. Poll cadence, preflight 15
  minutes, exam durations and resource/kernel containment bounds stay separate.
- Explicit evidence/bootstrap v2 purposes reject old 15-second proofs before
  Start/authority. Actual native Begin verifies full allowance only at Start.
- The existing watchdog fetches already-authorized clock intents once per second
  over authenticated outbound HTTPS, independent of student SSH/old deadline.
  Existing web/examctl authorization, revision, intent, audit and retry remain.
- Failed live clock handover stays durably pending. Identical-history callbacks
  at the same revision confirm only after an actual supervisor acknowledgement.
- A verified SSH-exit proof may span an older clock revision of the EXACT same
  immutable connection lifetime. The actual old owner is retained as negative
  evidence; an unavailable hold is never called verified. Fresh saved-file
  continuation adopts the current clock without new time, grant or attempt.
- Exact monitoring-timeouts-v2 deployment scope supports a fifth matched relay
  binary and timeout snippet, preserving its config/trust/service files. Local
  public operator tests pass; privileged installation qualification is pending.

## Verification

Evidence: var/collection-tests/timer-controls.20261105a/.
- application-clock-final.json: 817 pass, zero fail, 3 opt-in skips.
- Signed clock/SSH-exit/files-resume regressions pass. Actual local user-systemd
  PTY/supervisor clock handover and files-resume-clock pass.
- Native supervisor matrix: 23 cases pass; two expiry fixtures corrected from
  old 17–18s waits/old signed envelope/short synthetic approval. Actual 60s
  live expiry and pending-expiry/fresh retry now pass separately. Approval uses
  the ordinary five minutes; no enforcement was weakened.
- Browser: 18 unique selected cases pass across the initial 14 and corrected
  5-case run. Initial four Start refusals came from the fixture's old 15s cap.
- Final types/build pass; relay and browser-Go races pass. Build required the
  authorized local sandbox escalation for the installed Go subprocess.
- Operator CLI: 18 native, 35 matched web and 10 bridge tests pass. Service
  controls in these tests are mocked; do not call them privileged qualification.
- Final full native race suite passes: native-all-clock-final.log, core 273.172s.
  This default suite skips opt-in privileged/systemd tests; actual local
  supervisor evidence is listed separately above.

## Approved policy and current next milestone

The instructor answered both dialogs consistently:
1. Pause only the countdown; the student keeps working under normal monitoring.
2. Customize Allow resume approval validity, including no expiry. Exam completion,
   revocation and the actual countdown still apply. This does not change the
   finite explicit window for starting a new attempt.

No timer-pause or infinite-approval control has been implemented yet. Next:
commit the validated timeout/clock-delivery increment, then implement these two
controls through native authority, public web and examctl workflows. Pausing must
persist remaining time and keep monitoring/SSH/holds enforced; no completed
attempt may reopen. Preserve original deadlines and audit the intentional new
untimed-work policy. Finish the matching release after its feature scope settles.
Exact image/current-data recovery and disposable five-binary/relay installation
qualification are still required before maintenance.

## Production / authorization

Testing and deployment authorized, including with admin signed in. No new push
instruction. Preserve students and guards; no production mutation has occurred.
Read-only initial inventory: marco 118 terminal histories and one admin session;
csc-sys 185 terminal histories, zero unfinished started attempts. Recheck fresh.

Current web c5f95f7, Config image
5d9d429e063bb61b3adab3d3688e3332b8e89fdc8dee6ccb66a54388330d2804,
schema 37, marco host port 3001 (container 3000). Native d744e5b four roles;
relay unchanged PID 893011. Recovery stages:
/data/ssh-exam-claim-clock-c5f95f7-20261105 (web + shared immutable media),
/var/tmp/ssh-exam-clock-repair.r_1nli9m-root (native backup/candidate).
Prior matched workflow: docs/files-only-resume-release.md. New candidate is NOT
release-ready: no frozen image or actual installation/recovery receipt exists.
Do not run relay/install.py unchanged: it overwrites config from the example.
No commit or deployment exists yet for this follow-up.
