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

## Local results

### Student summary and welcome focus follow-up (October 31)

The instructor rejected the routine student **Start window** disclosure. Prof
agreed to remove it and the opening/closing range in attempt choices, while
retaining the time limit, webcam requirement, starting files and explicit choice.
Choice labels keep the creation time to distinguish otherwise similar attempts.
Closed practice still explains that the instructor must open it. Instructor
scheduling and actual too-early/closed refusals remain unchanged; this supersedes
the earlier student expandable-window recommendation below.

The welcome form also lacked initial focus. Use React's mount-time autofocus:
student Exam ID, login-test Username, instructor Username. Delayed initialization
must choose the correct form first; later typing/rerenders must retain the user's
focus. Restored sessions and active authentication must not mount a welcome form.
Prof agreed this behavior. One real-WASM summary check and three focus checks
reproduced the old failures. All four focused cases pass after the view-only fix,
along with typecheck and fresh frontend build. All 36 selected browser workflows
then pass against the exact new image assets, including seven timezone start/
clock/finish workflows, instructor date entry, multiple-attempt selection, initial
saved settings, restored sessions, password/OTP waits and sixteen WASM clients.
The pinned Go1.27.2 image's WASM differs from the local Go1.27.3 build; these final
checks use the image's actual bytes. Production-maintenance image startup passes
with synthetic schema24→35/history/enrollment preservation and native-clock ABI.
The instructor explicitly authorized push/deployment of all three verified fixes
(including e57c3ec's password follow-up); the guarded web-only cutover is next.
Evidence: var/collection-tests/student-summary.japy2oc9.

### Submitted password field follow-up (October 31)

The instructor reported that the cleared password field remained visible while
waiting for the phone prompt. The earlier oracle checked an empty value and a
disabled input; neither establishes that a completed field disappears. Prof agreed
the bounded correction: use **Password** for the two app-authored prompts, hide
submitted fields until a fresh challenge, and retain the waiting status and
Cancel. App-authored instructions/errors and the student guide drop “shared.”
Raw host messages, host/round binding, explicit OTP responses, password reuse and
credential cleanup are unchanged. Same-host notices cannot resurrect a submitted
field; a new challenge restores only its own empty inputs. No durable state,
authority, deadline, admission or account policy changes.

Three red browser checks reproduced visible submitted fields at desktop/mobile
widths and for a genuine OTP. After the fix, all four focused browser checks pass,
including blank rounds, notices, cancellation and fresh empty prompts. The current
Node SSH/auth/security/receipt and auth-display unit checks pass (29); the Go SSH
client race suite, full typecheck and fresh clock/WASM/web/server build pass.
All 16 affected browser scenarios pass against rebuilt assets: desktop/mobile
wait, OTP, notices, failures/retry, session restoration, actual-WASM SSH pane
cleanup/logout/finish and sixteen simultaneous signed-in clients with zero exam
clock. The private split-identity adapter's updated real TCP/SSH race check also
passes. Prof accepted both rendered waiting screens. Public fixture status verifies
real browser SSH; WASM/runtime hashes match the freshly built public assets.
No agent/kernel/state/CLI behavior changed, so earlier native/root qualification
remains applicable; this bounded display/copy fix does not need a new privileged
release qualification or unrelated management suite. All ten original dirty
screenshots are unchanged and unstaged. This follow-up is local only; production
remains on 6b7c62b. No deployment or push was performed.
Evidence: var/collection-tests/password-wait.aop_n05o.

### Phone sign-in and terminology follow-up after 976b7d5

Prof found that the password-to-phone wait was only represented by a low-contrast
disabled button. Agree: put live progress above raw server history; show a prominent
number only for the existing strictly recognized DePaul phone challenge, explain
that it belongs in the phone's Authenticator app, and label the existing explicit
empty acknowledgment **I approved on my phone**. A generic verification code still
requires its own input. Password-only progress must not match one-time-password
prompts. Raw SSH messages, host/round fences, response clearing and all authentication
behavior remain unchanged; no response is automatic and no progress claims success.

Use **Start exam**, **attempt/extra attempt**, **time limit**, **opening/closing
times**, **setup**, **instructor approval** and **saved files** in ordinary prose.
Wire/CLI operation names and audit-only diagnostics keep their exact identifiers.
Student-facing server refusals must retain their safety facts without instructing
students to run administrative commands. No eligibility predicate, status code,
clock, hold or stored historical record is changed. Root and Prof agreed the exact
70 public student/error-handler literal sites and 14 ordinary instructor refusal
messages before implementation. New audit details can contain the shared helpers'
clearer prose; stored reason identifiers and existing history are not rewritten.
Instructor errors explain changed settings, stale reviews and unused-only changes
without demanding command names, hashes or internal lifecycle terms. CLI/API names
and technical/native receipts remain exact. The finished student's receipt labels
its IDs/checksum **Technical details**; cancelled setup reasons remain ordinary
Details. No new screen or management operation is introduced.

Acceptance: desktop/mobile password waiting and phone instructions are readable;
the phone number appears in the ordinary view with no Code input; no empty answer
is sent before explicit confirmation; generic OTP still sends the typed value;
blank/notice rounds, cancellation and raw banners remain correct. Exercise actual
student refusal endpoints and retain their no-start/unchanged-authority checks.
Three new phone checks reproduced the old failure, then passed after the fix.
Prof accepted actual 1280px/430px screenshots: progress, number, phone instructions
and one confirmation button stay in view above long synthetic banners. A genuine
one-time-password prompt stays distinct. Seven auth unit checks and 74 focused app
checks pass (the latter includes those seven); authority/source/clock assertions
remain intact. The student guide now matches the current setup expiry, labels,
saved-file recovery and original-deadline restrictions. The earlier guide's
reload/SSH-loss wording was stale, not a newly changed policy.

Final qualification: eight additional focused HTTP checks pass. Full `npm test`
passes 644 checks, with 3 existing opt-in skips (330.0s), including the current
worktree's native-clock pretest. Typecheck, fresh frontend build and server build
pass. No new kernel/native race is required: native/SSH/protocol/CLI code is
unchanged; the three server files have 84 approved public-message edits and zero
other token changes, including unchanged template interpolations.

All 95 selected browser scenarios are covered with actual WASM SSH and the separate
gateway process, verified through public fixture status. The broad run passed 94
(10.5min); the remaining test looked for the old recovery-role error. Its retained
snapshot showed the intended new refusal. After collecting the run, only its two
message oracles changed; the complete workflow then passed in 7.6s, including no-start,
unchanged source/allowance and successful retry checks. Product/assets and the
other 94 scenarios did not change, so their evidence remains applicable. The
initial failure is retained. The unchanged two-minute post-cleanup health soak
was excluded; prior qualification applies to its unchanged implementation. No
native-bundle/privileged claim follows from this simulated host/media fixture.

The strengthened legacy HTTP test also exposed an old reused cancellation request:
it now verifies that conflict and separately uses a fresh intent to reach the
cancelled-review refusal. No production code changed to accommodate either test.
Source/test/served-asset manifests show no run-time drift; the exact existing
qualified SSH WASM/runtime was restored after Vite copied its public directory,
before browser qualification. Cleanup checks confirm all 76 logged owned processes
exited, ports 3100/3101 closed and all 10 original dirty screenshots unchanged.
Prof's final acceptance covers the actual desktop/mobile phone screenshots and
the agreed plain terminology/technical disclosures. Evidence:
var/collection-tests/prof-login-terms.g_qplfoq. Implemented/tested locally only;
no push, deployment, production changes or open design decision.

### Second UI/UX pass requested after ce33086

The follow-up found useful saved settings inside Technical details and individual
attempt cards below the full edit form. Prof agreed a bounded presentation fix:
put time limit, webcam, start window, starting files, issuer/date and reason in the
ordinary saved-settings disclosure; keep only references/hashes/revisions in
Technical details. Individual Allowed attempts starts with its cards and visible
start windows, then the existing edit fields. Bulk editing stays fields-first.
Both retain the existing form → review/result flow; no new dialog or authority.

Timing details must not expose an attempt UUID alongside useful timing facts.
Starter-file hash disclosures should explicitly say Technical details. Issuance
review keeps its reason under Details and nests raw review/status/JSON separately.
Exact short durations use the existing formatter, e.g. **1 min 35 sec**, not decimals.
Local date/time pickers and minute inputs already satisfy ordinary entry; preserve
unchanged exact instants and explicit repeated-DST choices. Human exam names/slugs,
usernames and attempt numbers remain useful identifiers.

Acceptance: desktop/mobile inspection exposes useful facts/source navigation
without diagnostics; UUID/hash text stays invisible until Technical details is
opened; 95 seconds reads **1 min 35 sec**; individual cards precede editing controls;
bulk changes, cancellation and native date inputs retain their existing behavior.
Evidence: var/collection-tests/prof-ux-repeat.kl_ojws9. This follow-up is implemented
and tested locally; the earlier validated candidate below is ce33086. Three focused
checks reproduced the old layout/display issues. The final six focused checks
pass in15.4s after fresh web builds and typecheck; eight duration/date/view unit checks
also pass. Prof viewed all four new desktop/mobile ordinary-view screenshots and
accepted the placement, readable wrapping, source links and closed diagnostics.
His final singular-count correction is included and tested.

The earlier inspection test opened Technical details before checking the useful
facts and used text-content assertions. That verified the data but missed the UX
problem. The new checks require visible facts and the source link before technical
expansion, an attempt card in the first viewport, hidden UUID/hash text until an
explicit diagnostic action, and card-before-editor order. A separate check confirms
native local date/time and numeric minute controls; source and timing references
remain hidden in their ordinary views. Technical file details accurately names the
submission's path/checksum/raw-manifest disclosure; useful collection facts remain
outside it. No server, native, CLI, protocol or authority change is involved.

All80 affected browser cases pass in4.9min, including real-WASM extra/initial/
legacy/practice starts, unused revision/cancellation, partial/unknown replies,
history/source navigation and all seven timezone workflows. No cases are skipped
in this affected run. Dates, exact unchanged seconds/milliseconds and repeated-hour
choices remain intact. final-ui-inputs.json binds the source/test files and actual
served assets; there is no drift after qualification. The already-qualified SSH
WASM/runtime is byte-identical; no native rebuild was needed. All27 logged test
processes exited and both fixture ports closed. The ten original dirty screenshots
remain byte-identical and unstaged.

This is presentation-only qualification. The previous full application/native/
release-image receipts below belong to ce33086/503bd9c as stated, rather than
proving a new shipping image. No push/deployment occurred. A future release needs
its matched new image and the already-documented exact root-worker hardening gate.

### Prior validated candidate

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
