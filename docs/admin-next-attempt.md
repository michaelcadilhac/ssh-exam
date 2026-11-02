# One next attempt on the instructor dashboard

November 1, 2026. Implemented and validated locally at `2694afd`; no push or
deployment authorized. The candidate image and CLI source manifests are bound to
that implementation commit, separately from later documentation-only commits.

The instructor requested an interface that matches the existing single-unused-
attempt policy. A fresh Prof agreed on one **Next attempt** row, with its opening
and closing dates, time limit, webcam, starting files and status visible directly
on the dashboard. **Edit settings** opens the prefilled editor in that row, with
the existing exact review before saving. **Cancel attempt** uses the same reviewed
cancellation for every issuance type. History remains separate and intact.

One **Allow attempt** workflow serves students with and without prior attempts.
It retains the existing explicit replacement review when unused permission exists.
Bulk actions operate on the selected students' sole unused attempts, without a
second attempt-selection step. First/extra labels and independent future-default
controls disappear from the dashboard.

The saved configuration of the latest attempt supplies new time/webcam settings,
terminal and collection limits. A newer unused or cancelled configuration remains
the latest saved configuration. Exam defaults supply a student with no history;
legacy imported accommodations remain a compatibility fallback where no saved
attempt exists. New dates remain explicit and reviewed, and starting files retain
their existing explicit selection and verified-source requirements. Historical
enrollment fields and CLI compatibility endpoints are preserved, without exposing
a second set of editable defaults in the website. Reviewed settings sources must
remain unchanged at confirmation.

Bounded milestones and acceptance:

1. Dashboard projection and issuance resolve the latest saved configuration,
   reject stale reviewed sources, and preserve all started/history/clock/hold data.
   Exercise the HTTP dashboard and issuance/confirmation entry points, plus CLI
   help and affected preservation workflows.
2. Main-page display/edit, common creation and cancellation operate without the
   obsolete first/extra/default/second-selection controls. Browser checks cover
   exact prefills, dates/DST, no-op and source preservation, stale authority,
   unknown-result retries, mixed selected students and narrow screens.
3. Read focused results before broader affected browser/application checks;
   typecheck fixtures, rebuild served assets and run the production build. Prof
   reviews actual renders. Record local completion separately from deployment.

The implementation is complete locally. Prof reviewed actual 1280/430px renders
and accepted the final layout. His two findings are fixed: desktop actions stack
inside the visible table, with bounding-box and hit-area regressions, and an
existing setup/working/paused attempt changes Ready to **Waiting for current
attempt**. The latter uses an unfiltered server fact, so a history filter cannot
hide the current attempt and produce a misleading Ready label. Closed, future and
saved-work-preparation statuses keep their distinct explanations.

Opening a recent request for another group remounts its scoped form, retrieves
known students' saved configuration from the dashboard, and recovers the original
request from its correctly scoped retry cache. Unknown off-page configuration is
not presented as an invented latest value; the server still resolves and reviews
the saved settings. Clock resets retain their existing explicit reviewed amounts
and revision guards; only their explanation was simplified. No deadline or clock
policy changed.

Verification evidence:

- `var/collection-tests/next-attempt-editor.hn2dsq0_`: frozen focused7 and complete
  30-case editor checks pass, including no-op/exact seconds/DST/source preservation,
  claimed/duplicate refusal, all-issuance cancellation and unknown-result retry.
- `var/collection-tests/admin-next-browser.k47_dy77`: complete81-case dashboard,
  creation, bulk, source/history, layout, real WASM/Start and retry cohort passes.
  The final isolated recent-request adoption correction passes a separate 8-case
  focused follow-up; the other reviewed workflows are unchanged. Original fixture failures
  are retained, including old headings/menus/defaults and the required-camera
  journey, which now positively checks a challenged webcam upload before Start.
- `var/collection-tests/admin-revision-application.dq8sgt68`: full application run
  recorded737passes,8 obsolete historical-camera fixture failures and3 existing
  opt-in skips. Corrected web/native historical snapshots retain the intended
  accommodations; all8 affected SSH/preflight/Begin cases pass on rerun. Final
  dashboard/latest-settings/provenance6 pass, and full examctl races pass. This is
  combined current-code coverage, not a claim that the original full invocation
  exited successfully. No enforcement was relaxed.
- Full fixture typechecking, frontend build and the exact local schema37 production
  image/startup/history/video/native-clock checks pass. The candidate is in
  `var/collection-tests/admin-next-attempt-image.gyl41pn1`; all179 image inputs and
  304 CLI source files are bound to manifests. Packaged frontend assets match the
  tested build; pinned production WASM remains unchanged. Original dirty screenshots
  are preserved.

Deployment remains separately authorized work. There is no schema migration or
native-service consolidation/restart in this revision. Backend default selection
and dashboard projections changed, and CLI help changes its binary digest:
**do not attest unchanged backend/CLI for the stock UI-only deployment command**.
Before a production cutover, qualify the matched same-schema web/CLI procedure,
fresh idle/native guards, current media-cache coverage and fresh database/small-file
backup. Keep the site online during preparation. An older issuer lacks the new
latest-settings semantics/source validation; prefer compatible forward repair and
review any code rollback against CURRENT data. Never restore an old database,
revive permission, drop source pins or reset a deadline to roll back presentation.
