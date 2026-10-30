# Current checkpoint — Prof UI review

October 30, 2026. Active user task: review every web sentence and streamline exam
administration with the requested professor agent Prof. Agree fixes with Prof
before implementation; routine tasks take at most two decision screens. Local
changes/tests/commits only. No push, deployment, production edits or restarts.

Agreed plan and scenarios: docs/ui-prof-review.md. Prof accepted the terminology,
selection-based workflows, concise material warnings and technical Details.
The instructor APPROVED a separate, narrowly scoped class-server background
service for automatic saved-work setup, development/testing only. No open user
question. Prof remains the reviewer; use collaboration.followup_task if idle.

Audit: var/collection-tests/prof-ui.hGHi2EWM. All 32 web source modules inventoried:
copy-before.tsv/json and source-before.json. Prof categorized all 1,854 candidates
(includes duplicated JSX/internal strings, NOT a sentence count); 163 exact text
replacements in prof-copy-decisions.tsv; notes in prof-copy-review-notes.txt.
Never overwrite this baseline when generating the after inventory.

Current increment: always-visible student selection, selection-only action menu,
one-dialog cancellation of unused extra attempts and explicit time-change scope.
Files: admin.tsx, student-actions.tsx, cancel-extra-attempts.tsx, grant-options.ts;
new focused browser tests: tests/browser/prof-bulk-actions.spec.ts.
Prof's initial seven objections are corrected; parent-held unknown cancellation
intents survive close/reopen, current REVOKED reads reconcile safely, started
history is disclosed, missing students named, diagnostics in Details. Additional
edge fixes cover consumed-during-close and malformed claims. Add time names
selected students omitted from its eligible current-clock targets.

Validated first increment: Prof VIEWED and ACCEPTED the 430px partial-result
screen. Four focused browser cases pass 7.3s. Final 12 browser regressions pass 45.0s
(new cases + desktop/mobile selection, retry/reset, roster import and actual
WASM SSH clock workflow). Three actual HTTP additional-grant regressions pass 1.10s;
typecheck and fresh builds pass. First mobile Select all failure is retained in
bulk-browser.log; the control is now outside the hidden responsive table header.
Evidence: bulk-regression.log/results, bulk-browser-final.log/results,
bulk-http.log, bulk-existing-typecheck.log and bulk-existing-build.log. Original
raw copy inventory remains untouched. No application/native protocol change.

NEXT: streamline the another-attempt
and stored-source/template selection workflows. Existing affected bulk-browser
checks have been migrated and public callers pass. No test runner remains active.
Ask Prof to review each next scenario/rendered result before calling it complete.
Prof accepted the RETAIN-ONLY worker design: no automatic archive retirement;
existing native pins from cancelled/stale work remain protected for explicit
operator cleanup. Detailed acceptance is in docs/ui-prof-review.md.

Next increments: streamline another-attempt/source/template selection and unused
settings; deliver the approved isolated saved-work service through supported CLI
and web entries; apply the complete copy ledger and obtain final Prof acceptance.
No pending operation may reserve an account, consume time, hide an unknown result,
weaken protected history/deadlines/holds or claim Ready before native confirmation.

Prior production setup remains as recorded in docs/sandbox-setup-2026-10-30.md
and docs/examctl-scripting-deployment.md. Latest prior local commit 941d776; full
prior checkpoint is in that commit. Sandbox starter/window setup is complete,
not part of this UI release. All ten original dirty PNGs must remain untouched.
