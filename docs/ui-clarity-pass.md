# Deep UI clarity pass — October 31, 2026

Local follow-up after ec00cba. The instructor reported late sandbox denial,
operator-only error text, a one-line hidden attempt fact and unexplained Allowed
attempts checkboxes. Prof reviewed the workflows and agreed each fix before
implementation. No new production deployment or configuration change is authorized.

## Confirmed cause and boundary

A read-only production check at 06:02 UTC confirmed sandbox's saved closing time
1793422740000 (October 30 at 23:59 America/Chicago), pinned files present, and eight
COMPLETED sandbox attempts for mcadilha with no unfinished attempt. Removing the
routine student schedule display had preserved the approved finite-window policy.
SSH confirmed account identity; setup checked new-practice availability afterward.
The late refusal came directly from AttemptGrants.practice(), bypassing the earlier
app.ts-only copy review. No production setting/student record was changed here.

## Agreed integrated corrections

| Surface | Correction | Preserved behavior |
| --- | --- | --- |
| Closed practice before credentials | Same plain closure for every username when the public/default closure is certain and no exam-wide saved/pending/unfinished/uncertain-hold exception exists | No username-status oracle; exceptions still authenticate; native/account checks remain |
| Authenticated student summary | Read-only practice_blocked describes selected saved settings or genuinely new-practice defaults; current active/history states take precedence | Independent grant windows, original clocks, protected completion and holds |
| Attempt choice | Fetch current selection/settings/availability from the existing authenticated GET; bounded 15-second singleflight with visible pending state | No reservation, issuance, claim or clock start |
| Closed/future status | Inline Check again preserves the selected ID and refreshes without MFA/reload | Guidance cannot authorize execution; fresh preflight/Begin remain |
| Revoked/stale choice | Plain typed ATTEMPT_UNAVAILABLE before shared selection, plus known preflight refusal; Check again discards the definitely refused ID and retrieves current choices | Current bound attempts/history remain readable; no automatic start or source substitution |
| Empty choices after definite stale refusal | Keep setup disabled and explain that the instructor must allow an attempt | Never-issued legacy behavior and automatic practice remain separate |
| Practice/cleanup errors | Plain known student refusals, including completion/access uncertainty and settings not ready | Operator diagnostics/status/cause and every original guard remain |
| Useful one-line facts | Legacy attempt note and student starting files are inline | Rich applied settings/history stay expandable |
| Allowed attempts | Visible Select labels, purpose/count/controls before cards, no disabled history checkboxes | Selection alone changes no permission; change/cancel review and confirm stay separate |
| Student defaults | Visible Default time and Webcam default labels; Started attempts keep settings | Explicit legacy unused-recovery allowance synchronization and immutable issued settings |
| Technical payloads | Three JSON/revision/UUID-only summaries say Technical details | Useful human facts stay visible; diagnostics stay available |
| Focus warning | Before work pauses instead of before lock | Same20-second grace, original deadline and native enforcement |

The public practice gate is deliberately conservative. If another account has a
potential saved/unfinished exception, an ineligible user may still authenticate;
the personalized post-authentication summary then explains availability. This is
an identity check followed by permission inspection, never execution authority.
No new durable/intermediate state, native protocol, account rule or clock policy
is introduced. New client pending/stale state is visible, refreshable and bounded;
a definite stale choice never silently retries a start or an unknown mutation.

## Review and verification

Prof's source review covered welcome/password/phone wait; setup/source/time/webcam;
working/paused/finished states; instructor roster/review/defaults; Allowed attempts;
another attempt/Add time/Cancel extras; and technical disclosures. Normal workflows
were already lean; the defects were missing exceptional-flow context and unclear
selection/status distinctions. This does not claim every possible privileged fault
or arbitrary malformed-client diagnostic is qualified by reading its prose.

Five admin, three public-auth/preflight and four baseline student-view checks
reproduced the reported gaps. The first frontend pass had 15 passing scenarios and
two invalid stale-choice fixtures: they revoked before initial metadata/menu load.
The retained snapshot showed only one remaining choice, so no selector existed.
The corrected fixtures await the actual two-choice menu BEFORE revocation and
bound actions explicitly. A separate metadata-timeout check exercises control
release with an accelerated browser-only timeout, no work start or silent retry.

All 22 focused real SSH/auth/session/preflight sandbox cases pass, including saved
open/future grants outside closed defaults, late closure, bound active reads,
revocation races, cleanup refusal/repair and contradictory completion. Metadata
uncertainty probes are explicitly synthetic legacy projections, not native policy
qualification. The auth closure checks also preserve incidents/outbox records.
Typecheck and fresh frontend/server builds pass. The unchanged Go1.27.2 WASM/runtime
are reused byte-for-byte from the deployed qualified image; no Go/native code changed.
All 18 final focused browser checks pass, including the corrected stale-choice
boundary, definite preflight refusal, empty choices and a stalled read releasing
controls. The full application suite passes 653 tests with 3 existing opt-in skips. All 86
broader affected browser workflows pass. The final display-only opening-time
correction is qualified separately below; no unchanged suite rerun is claimed.

Prof inspected actual desktop/mobile selection/defaults/legacy/blocked/source/
focus-warning renders. He accepted them except that mobile hid the Webcam column
header, making Default:Optional undefined. The final label includes Webcam.
Prof accepted the final desktop/mobile webcam-default and empty-choice renders
once the corrected runtime checks passed. No essential UX objection remains in
this reviewed scope. The full application/browser runs completed successfully.

The last factual check found minute-only formatting in the blocked opening hint.
A new public real-SSH future-window fixture fixes the opening at second47; its
old-format failure is retained. Changing only timeStyle from short to medium
passes three focused public workflows (future/open saved windows and late closure),
including refusal without permission/clock consumption before that exact instant.
Final types/server build pass. The source delta is exactly that formatting option;
all other product inputs and frontend assets match the successful broad runs.
Those unchanged suites were not repeated for this display-only correction.

No local or design blocker remains. This is implemented/tested locally, not pushed
or deployed. The production schedule still needs an explicit new finite interval
if the instructor wants to reopen practice. No account/clock/submission policy
was changed as part of the UI review.

Evidence and original failures: var/collection-tests/ui-clarity-pass.zsifuw12.
Generated screenshots stay in per-test output; original documentation images remain
untouched. No push/deployment, production configuration change or student action.
