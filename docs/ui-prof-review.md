# UI review with Prof

October 30, 2026. Local development and testing only. No push, deployment,
production changes or real student actions are authorized for this review.
Prof is the professor reviewer agent requested by the instructor. He reviews
changes before implementation; the accepted decisions below record that agreement.

## Goals and scenarios

| Task                   | Entry and result                                                    | Maximum screens/dialogs |
| ---------------------- | ------------------------------------------------------------------- | ----------------------- |
| Give another attempt   | Select students; choose time/window/files; review and create        | 2                       |
| Add time               | Select current attempts; enter minutes and confirm                  | 1                       |
| Cancel extra attempts  | Select students; review their unused extras; cancel selected extras | 1                       |
| Change unused settings | Select students; choose unused attempts and settings; review        | 2                       |
| Change future defaults | Select students; choose default time/webcam and save                | 1                       |
| Open practice          | Sandbox settings: choose existing starter and finite dates; save    | 1                       |
| Let a student resume   | Review interruption and approve; student explicitly resumes         | 2                       |
| Review/download work   | Open the named attempt and view/download its saved files            | 2                       |

Prof rejects typed/copy-pasted usernames when roster selection exists, source
UUIDs/checksums/hashes when recorded metadata exists, RFC3339 input, seconds for
ordinary time limits, and shell commands as the final web workflow step. A form
with multiple stages still counts by screens, not only physical modal elements.

## Agreed design

Use attempt, extra attempt, time limit, time remaining, start window, starter
files, saved work, webcam required/optional, Allow resume and Resume exam.
Keep protocol terms, internal states, references and exact hashes in Details.
Keep short material consequences visible: irreversible finish, the running clock,
saved versus unsaved files, real capture/retention facts and actual access holds.
Never describe a timeout as misconduct or mail-server acceptance as delivery.
Ordinary exams awaiting approval retain the direct instruction **Instructor review
required**; sandbox pauses say **Work paused**. The state and required action must
remain clear in their actual context.

Keep the useful overview filters. Show one compact selection-action menu when
students are selected. Another-attempt form → review/result is two screens; reuse
the selection and fetch settings, source candidates and template versions. Preserve
each student's effective time/webcam by default. Existing source selection must
refuse an ambiguous/unprotected/missing latest started submission. Starter fallback
is limited to the explicitly approved no-start case or an explicit choice.

Add time keeps the existing clock batch transaction/request protocol. Cancellation
uses exact unused-grant revisions and retained request identities, with honest
individual results; preparing/started attempts refuse. Nothing to cancel is a
normal result. Separate Current clocks from Unused attempts and Future defaults.
No optimistic success or blanket batch-success label after partial failure.

Saved-work state reads Preparing saved work until durable native confirmation.
On October 30 the instructor approved developing a separate class-server service
that polls through existing authentication and accepts only saved-file protection
tasks. It must reuse isolated verification/durable source retention, never add
archive I/O to the shared agent, and require no student credentials or arbitrary
remote commands. This approval is for local development/testing only.

Prof accepted a **retain-only** first service: durable setup tasks in the issuance/
revision transaction, a stable confirmation request, isolated bounded child work,
fresh retain-only plan checking inside the child, and retry/status in the same web
review. Native confirmation remains the only path to Ready. A successful native
confirmation cannot be overwritten by a later failure report. Older pending grants
remain inspectable and get an exact reviewed Retry setup path. Revocation cancels
permission/setup, but any native pin already created stays protected for explicit
operator retirement. Automatic archive deletion/retirement is outside this scope.

## Validated first increment

Students are selected directly in the roster, with one compact action menu shown
after selection. Add time retains the existing transaction and names selected
students whose clocks are excluded. Cancellation shows each selected student's
unused extras or Nothing to cancel, preserves preparing/started attempts, and
keeps unknown request identities across close/reopen. A fresh authenticated
Cancelled status reconciles a lost reply. Full diagnostics are in row Details.

Prof viewed the 430px partial-result screenshot and accepted this bounded outcome.
The four new browser cases cover partial results/exact retry, close/reopen,
excluded clock targets and an uncertain cancellation becoming Started. A first
run caught select-all hidden with the mobile table header; the control is now
outside that header, not an enforcement/test bypass. The final 12-case browser
regression includes those four plus desktop/mobile layout, existing clock retries,
roster import and a real-WASM SSH clock workflow: all pass 45.0s. Three real HTTP
additional-grant regressions, typecheck and fresh builds also pass. Mocked API
cases qualify UI orchestration; the real HTTP/WASM checks are separate evidence.

Prof's later request is addressed by the common start-window summary and placing
each outcome before its row details. Final acceptance is recorded below.

## Dependency-ordered milestones

1. Inventory every web text surface and review the rendered desktop/mobile flow.
   Record retained/shortened/moved text and unresolved gaps. Implement Prof's
   agreed copy, source/version retrieval and selected-student actions using the
   existing APIs. Acceptance: no routine IDs/hashes, one Add time dialog, one
   cancellation screen and two another-attempt screens. Regressions exercise real
   HTTP services and browser actions, including partial/stale/unknown outcomes.
2. Deliver the separate saved-work service through its real examctl/service entry
   and the actual web issuance lifecycle. Acceptance: durable pin before Ready;
   bounded isolated collection; observable retry/error/cancel; restart and reply
   loss preserve request intent; expiry/stale revisions cannot start work. Add
   supported CLI help/status/retry workflows and integration/native race checks.
3. Complete the remaining copy/interaction ledger, ask Prof to review the rendered
   result, fix his objections, and run affected integration/browser/build checks.
   Keep screenshots per run and preserve original dirty documentation images.
   Commit validated increments locally; report production/migration steps only.

## Current local result

Prof accepted the source/copy review and the rendered mobile/desktop workflows.
The final-focus context ledger classifies every candidate in 49 web/shared/HTML files;
its 2,353 overlapping extraction candidates are not a sentence count. Before and
final inventories are separate immutable artifacts. Exact final verdict and
screenshots are in `var/collection-tests/prof-ui.hGHi2EWM`.

The final another-attempt and unused-settings screens pass eleven packaged-browser
scenarios (39.9s, `prof-inline-setup-focused-browser.log`). They cover finite dates,
repeated DST minutes, exact seconds, per-student settings, mixed fetched files,
no-op revisions, partial/unknown outcomes, storage faults and exact retry across
reload. Prof viewed the actual mobile review and desktop partial-result images.
The final reset preview also formats exact seconds consistently. Selected existing
saved-work permissions show setup status/retry in place, without a settings change,
per-row polling or another dialog. Task success alone never displays Ready.

Shared display status now requires positive `true`/`1` protection before saying
Files saved. Unknown or stale contact says Connection unconfirmed. Neither change
alters admission, enforcement or historical data. Material warnings about time,
file protection, capture, retention and account restrictions remain visible;
technical references and complete diagnostics are available in Details.

Unused changes use existing per-grant transactions, not an all-or-nothing batch:
the review shows each outcome independently. Only named fields change; blank fields
stay unchanged, and true no-ops create no revision. A missing reply retains each
original request ID across close/reload. Current status never proves that an
unknown exact request succeeded. History and setup retry are available in the same
screen. Existing CLI list/revise/revoke workflows provide the same capabilities.

The retain-only service is committed locally as503bd9c, with actual signed
CLI/gateway/archive, coordinator-death, resource-containment and race evidence in
`automatic-saved-work-setup.md`. It remains uninstalled. The clean application run
passes643 checks (3 deliberate skips). Segmented qualification against the same
q3 runtime/assets covers all204 declared browser cases:192 unique passes and12
deliberate native-bundle/measurement skips. `browser-qualification-reconciled.json`
retains each case's failed and final passing receipts without double counting.
The final ten-case oracle run passes nine; its one test-only stale resize hook was
then corrected, and both actual callback/sign-out and completed-attempt checks
pass17.8s. No product change was needed: the test captures the actual native
ResizeObserver callback for the current pane, verifies its connected ownership,
then invokes it after disposal with no page errors or access restoration.

The final350 source/test/config inputs and six exact packaged assets are unchanged
after qualification. All50 logged owned browser processes exited and both fixed
fixture ports closed. The ten original dirty documentation images remain byte
identical. Native/CLI code remains503bd9c, so its existing signed gateway/archive,
resource and race evidence still applies. Exact root-service mount/LSM qualification
remains a separate pre-enable release gate; current browser fixtures simulate shell
and media and do not claim that privileged proof. No candidate behavior is
deployed, pushed or enabled.
