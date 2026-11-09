# Screen wake lock and useful instructor notifications

November9: implementation, two ordered commits, push and deployment authorized.
Deployed17:44:19Chicago /23:44:19UTC, runtime79ecd97/schema37, after a full drain.
Existing screenshots and student history are preserved.

Delivery plan:

1. Student setup/workspace requests a best-effort screen wake lock while visible
   and unfinished; release on hiding, finish or leaving, reacquire on return/focus.
   Permission denial/unsupported APIs cannot block setup or change monitoring,
   input authority, restrictions or clocks. Late asynchronous grants must be
   released after leaving; no duplicate requests or immediate retry loops.
   Verify through actual workspace browser entry points, including existing
   fullscreen enforcement, then commit this milestone separately.
2. Replace per-retry setup emails with one delayed, durable notification for
   persistent sign-in trouble; successful setup cancels pending notice. Keep all
   diagnostic/audit history. One email per actual interruption includes subsequent
   student explanations in the same incident rather than fresh automatic emails.
   Existing serious faults, explicit manual reminders, holds and clock behavior
   remain intact. Verify public student/admin/CLI and actual SMTP workflows,
   retries, restart, resolution and meaningful new occurrences; commit separately.
3. Qualify the exact matched web image with unchanged native/CLI artifacts, startup
   writers, preservation, current-data recovery, browser and nginx checks. Push
   both milestones and execute the prepared guarded deployment after all student
   sessions/unfinished attempts drain. Authorized admin-only signout is allowed.
   Reuse verified recording recovery coverage. No production changes during tests.

Evidence: `var/collection-tests/wake-notifications.20261109/`. Deployment timing
marker was captured at the start of this work. Final thresholds and evidence will
be recorded here after inspection of existing notification ownership.

Milestone1 implemented/tested locally: the original browser regression failed
because no request was made. Four focused cases and the complete10-case affected
workspace transition cohort now pass, plus typecheck/build. The browser API is
stubbed for deterministic battery/denial/revocation/pending-grant scenarios; no
actual desktop sleep/lock prevention is claimed. Existing fullscreen enforcement
is asserted through the student UI. No new mandatory capability, readiness fact,
permission prompt, configuration setting, native authority or clock change.

Milestone2 implemented/tested locally. Intentional notification policy changes:

- For an unstarted sign-in/setup operation-timeout, one existing durable episode
  is scoped to agent/exam/student. At least two failures are required before the
  first notice becomes due five minutes after the first failure; retries/restart
  cannot slide that deadline. A lone timeout is cancelled at delivery. Successful
  authenticated sign-in or verified workspace preparation resolves/cancels it.
  Thirty minutes without failures starts a new occurrence on a later retry.
  Older connection failures cannot reopen a notice after a newer connection
  recovered. No fake attempt, account hold, grant or clock is created.
- True worker crashes, host-key failures and failures in already-started exams
  retain their existing notifications/enforcement. Retained setup routing cleanup
  still runs even when its timeout email is deferred. Notification persistence
  errors cannot prevent successful sign-in or retained-routing cleanup.
- Each real interruption sends once. All accepted student review messages remain
  in the incident/audit; the latest nonempty explanation may update an original
  notice still pending with zero delivery attempts. Already attempted/sent mail
  stays immutable. A legacy/non-notifying pause gets one fallback notice on its
  first request; edits/retries/restart add no automatic email. A new interruption
  generation can notify again. Explicit operator reminders are unchanged.

Inspection/reminders continue through existing web Notifications and
`examctl web alerts list/show/remind`. Sign-in episodes have an explicit
`sign-in/AGENT/EXAM/STUDENT` metadata scope rather than an invented attempt UUID.
Reminders include the correct sign-in context and cancel on verified recovery.
No new configuration, CLI operation, schema migration, native protocol or timer
change. Historical sent messages remain untouched; they cannot be recalled.

Five final focused service/HTTP/SSH/SMTP tests pass, including actual dispatcher
acceptance, single-failure suppression, successful retry, restart, late messages,
manual reminders and preserved absence of attempts/clocks. The fixture accelerates
only the supervisor's connect timer to1.5seconds; production60seconds is unchanged.
An admin read correctly refused login-only fixture mode; the test now reopens its
persisted data in normal development mode instead of relaxing that restriction.
51operator tests pass, including forward recovery/current snapshot and exact
installed-versus-loaded CLI pinning. Broad application/browser and final image
qualification remain before push/deployment. Reviewed web-only release scope:
`wake-lock-notifications-v1`, using the existing controller/forward-recovery path.
All native binaries, installed CLI and loaded source worker remain unchanged.

Release qualification complete locally, runtime79ecd97/schema37, image Config
1741701b8cf623e69c24820cc018a3eb8cc170d52034d3f50fd4d1dd5412c307.
Full146-file suite:863pass/1existing opt-in skip, including actual root-mapped
compiled CLI/TLS management using unchanged installed CLI1a8272c2. Four wake-lock
and the complete10-case workspace cohort pass;10exact-image browser workflows
cover wake locks, notification management and real WASM clocks/input/finish.
The real five-fault isolation workflow passes while another student keeps working
and serious faults still deliver through SMTP. Its old test clicked a correctly
disabled pre-approval button; it now checks both that UI and the actual400server
refusal. The actual flat session response was used to correct its CSRF lookup;
those failed/interrupted fixture receipts are retained. Individual actions are
bounded, with a separate75second wait for the deliberate60second hang.

51operator scenarios pass. Exact image schema/media compatibility,63.48-second
real signed-poll startup,41preservation contracts, due physical-purge rechecks,
11mutation refusals and already-running-candidate CURRENT-data recovery pass.
Actual TLS/nginx maintenance/reload passes0.116seconds. Owned containers/nginx/
synthetic keys are removed. Unchanged native authority/relay/Go sources reuse
prior race/kernel/capacity qualification; no new human MFA or physical sleep
prevention is claimed. Local operation generation additionally refuses an active
exam, student session and wrong current image before producing any staging plan.

Before cutover, one student remained active until finishing/signing out; the
existing original-deadline guard cleared after17:36:50Chicago. The read-only watch
observed a complete drain at23:37:36UTC. Both feature commits were already pushed;
no student was interrupted. Original documentation images remain unchanged.

Production acceptance: public TLS/nine exact assets, signed CLI/help, all five
unchanged binaries/four current role PIDs,41contracts, original snapshot and
released recording pause PASS.132web/200native histories preserved. Preparation
20.90s reused1,324,421,366media bytes with0new copies. Fresh database164,909,056bytes
plus442,925bytes of other metadata/configuration were copied. Maintenance80.77s;
apply84.63s. Recorded start22:38:50UTC→reopening23:44:19UTC65m29.04s includes
32m20.26s of measured waiting for the student/original-deadline drain.

The native baseline check detected an independent source-worker restart at06:12
CST November9. It loaded the already-installed/qualified CLI1a8272c2. Diffing its
worker/catalog/core source against the prior95c7798 worker found no changes; only
unrelated exam-management flags/results differ. Private staging continued before
that local assertion was resolved; no installation/fence/restart occurred until
source comparison and fresh complete guard verification passed. All loaded roles
were then pinned to their actual current identities and preserved through cutover.
One preparatory refresh observed a transient service descendant and refused; the
strict independent recheck passed, as did all six apply refreshes. No relaxation.

The old worker's idle `{task:null}` response is incorrectly rejected by its strict
catalog helper, producing repeated log errors. Valid queued-task handling is
unchanged and no source tasks were pending at cutover. This separate diagnostic
follow-up is recorded inTODO, not patched during deployment. No native binaries
were installed or services restarted. Recovery uses the qualified matched image
with CURRENT data/original snapshot; old-mailer reopening remains refused.
Private frozen plan and receipts:var/collection-tests/wake-notifications.20261109/ops/.
