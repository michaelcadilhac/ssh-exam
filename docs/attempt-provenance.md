# Attempt → grant → workspace provenance

October25,2026. Current local implementation milestone after08d415b. Not deployed.
The genuine-SSH-loss policy dialog is independent and remains pending; no choice
is assumed. Installed retained mode remains OFF.

Public entries: instructor exam dashboard/history/review and supported
`examctl web attempts show/list`. Outcome: each attempt directly identifies its
APPLIED grant revision/hash, issuance reason/order and workspace source, with a
link/inspection path to the exact grant and recorded saved-source attempt. Keep
unused/available grants distinct from preflight, active, paused and completed
attempts. Do not infer historical settings from current defaults or the current
revision of an unused grant after an old cancelled preparation.

Inspected implementation: dashboard groups/labels attempts correctly but only
shows a separate initial grant under each student; attempt rows/review lack the
grant/source join. AttemptManagement's bounded shared CLI/HTTP projection omits
grant_id/revision/hash and template_version. Existing AttemptGrants stores exact
revision snapshots and supports CLI/web show/history/revise/revoke/issuance; do
not reimplement these operations. Runtime callers for a shared read-only
provenance projection will be dashboard and AttemptManagement, integrated in
this milestone.

Acceptance: use the historical revision/hash on the attempt, never current
settings; validate agent/exam/account linkage; show missing/inconsistent/legacy
metadata honestly without hiding other history; expose saved-source number/ID and
recorded submission status, not fresh native integrity claims. No grading choice,
new admission/clock/hold/credential/archive action. Existing grant inspector and
source review should be directly discoverable. CLI and web share projection.

Tests: authenticated dashboard/attempt-management HTTP and compiled CLI workflow,
including multiple attempts, cancelled preparation followed by grant revision,
source from another exam or absent gateway history, bad cross-owner link and
unused/pending/closed-window grants. Real browser history/review/direct inspection
at desktop/narrow width using an isolated synthetic exam/accounts. Rebuild assets
before browser qualification; preserve documentation images. Focus first, review
states/projections, then affected integration/build/browser checks at the coherent
boundary. Stop this milestone at usable provenance; native migration, destructive
cleanup and config activation remain separate outcomes.

## Candidate and state review

The shared `AttemptGrants.forAttempt` projection reads the attempt's immutable
grant ID/revision/hash and the corresponding historical revision. The current
grant status/revision is labelled separately. It validates the configured agent,
exam/account, saved snapshot hash and issuance lineage. Legacy or unavailable
linkage remains explicit without hiding the attempt or guessing defaults.
Saved-source history is linked only for the same username AND Unix UID; the
source may belong to a different exam. Recorded protection/checksum agreement is
not a fresh native archive verification. An unavailable history link preserves
the source ID/checksum and gives inspection guidance, never an archive-loss claim.

There are no new durable/intermediate authority states, clock or native writes.
Existing preparation/cancellation/expiry/restart rules and immutable bindings
remain intact. Dashboard unused-grant counts exclude every non-cancelled claim;
available, future-window, closed-window and pending-native retention are distinct.
The count is bounded to200 with a more indicator; malformed metadata is labelled
unavailable. These counts confer no admission or work permission. Signed CLI
reads retain the existing request-ID snapshot/replay semantics: use a new request
for a fresh observation. No new cancellation, pending reservation or bypass path.

The browser opens the exact grant even when absent from the first catalog page;
its CURRENT settings are distinct from the applied snapshot in review. Direct
review-to-grant navigation replaces the review dialog, avoiding competing focus
traps. Cross-exam source review selects that exam and its exact historical
attempt. All generated screenshots go to per-test output.

## Focused evidence and retained failures

Initial HTTP85594 refused an invalid synthetic preparation fixture. Corrected
HTTP16068 reproduced the missing grantContext through the actual dashboard.
HTTP76062 then passed3files/9tests. Final HTTP5731 passes4files/10tests, including
captured instants before/after the saved Begin window, pending source retention,
claimed-grant exclusion and cross-exam source history. Corrected focus71566
passes3tests/3files8.91s, including the compiled root-mapped CLI over local TLS,
restart, historical revision/hash and a mismatched historical source UID. Only
the never-started preparation lifecycle and native retention receipt are
synthetic; real native archive enforcement is separately qualified, unchanged.

CLI93526 refused fixture enrollment lacking an exact template version, before
creating a preparation. The fixture now supplies its independently attested
version; refusal was preserved, not weakened. Browser87646 passed both1280/430px
source/grant paths6.8s. Extended browser73988 then reproduced two simultaneous
dialogs from the direct review link. Closing review first passes final focused
browser70890 (3cases5.9s), plus types40065/build92904 and help89656 (race1.740s).
Broad app24250 passes584checks/107files310.65s; CLI13022 passes all races and
namespace interfaces18.454s. No new native authority/storage/OS boundary changed.

The first broad browser11843 ran in fallback mode by mistake (44pass/2fail/1skip).
Initial-grant's null owner was fixture mode, not qualified WASM behavior; it now
asserts public mode before admission. Playwright defaults its private server to
real WASM, with explicit0 for fallback. Correct-mode61602 passed initial Begin
but reproduced the same mobile grant-menu failure. An isolated menu56786 pass
omitted its predecessor history and did not prove the taller layout corrected.
Composed86069 reproduced the failure again; focus-only suppression was insufficient
and was reverted. Diagnostic48854 positively observed the late scroll event at
the SAME positioned anchor. Ignore that queued event, preserve real movement
dismissal. Final composed81426 passes8cases20.1s, including all3 prior grant
workflows, actual mobile menu click, unchanged-anchor/real-scroll and keyboard
controls, both provenance widths and unavailable-source guidance.

A final CLI consistency review found attempt numbers absent from management
projection. Signed HTTP31637 reproduces undefined number. The candidate counts
stable same-exam/account insertion order like the dashboard, independently of
list cursor/filter. The compiled CLI fixture now preserves2cancelled preparations
and verifies numbers1/2 plus their original grant revision after restart/revision.
Final focus30455 passes21checks/4files10.59s; types80959/build51134 pass. Final
app3494 passes584checks/107files306.28s. Browser78836 passes47 composed scenarios
3.1m, with versioned-source skipped by its worker's old environment guard even
though the server was WASM. The default now propagates to BOTH server and test
workers; types11042 pass, and11303 executes/passes that exact-source WASM/SSH/Begin
scenario10.4s with no environment override. This is47 composed +1 fresh scenario,
not a claimed48-case composed run. That final change affects runner setup only;
production JS/server/WASM inputs and the47-case artifact are unchanged. Full native
runtime races/root qualification are not repeated for this metadata/UI increment;
unchanged CLI races13022 and the earlier native evidence retain their stated scope.
All runners finished. Logs: `/tmp/ssh-exam-attempt-provenance-*.log`.

Browser API responses are controlled UI fixtures; actual HTTP projections and
compiled CLI/TLS are separately exercised above. UID drift is confined to a
synthetic source row and restored; immutable grant protections remain enabled.
Absent gateway history rendering is browser-tested; no protected history is
deleted to manufacture a server fixture. No privilege/SSH/PAM/cgroup format or
authority change is introduced by this metadata milestone. Prior root receipts
do not qualify rebuilt native artifacts from08d415b or the new CLI help.
