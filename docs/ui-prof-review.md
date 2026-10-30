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

Prof's later copy-pass request remains open: compact repeated dates and put each
outcome before its row details. This acceptance is not whole-app completion.

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

## Current state

Prof explicitly accepted the above UI scope and safety constraints before product
edits. Detailed source/copy inventory and test receipts are under
`var/collection-tests/prof-ui.hGHi2EWM`. The first selection/cancellation increment
is validated; milestone 1 continues with another attempts, source/version retrieval
and unused settings. The automatic saved-work service is approved but not
implemented. No new behavior is deployed.
