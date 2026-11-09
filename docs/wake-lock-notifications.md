# Screen wake lock and useful instructor notifications

November9: implementation, two ordered commits, push and deployment authorized.
Production is unchanged. Existing screenshots and student history are preserved.

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
