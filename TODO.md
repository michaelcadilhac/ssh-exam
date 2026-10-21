# Deferred work

Reviewed October 20, 2026 (America/Chicago), after the 3 p.m. incident.

**Do not implement or deploy these items during the current exams.** This file is
a backlog, not authorization to restart services, change account policies, reset
clocks, or alter recovery enrollment. Use an agreed maintenance window for
changes that could affect students. Keep student identities, credentials and
individual incident records out of repository documentation.

Local implementation is authorized separately as of October 20. Progress,
dependency order, acceptance tests and decisions are tracked in
[`docs/todo-progress.md`](docs/todo-progress.md). All production deferrals above
remain safety prerequisites. On October 21 the instructor approved C1–C8 and
deployment to csc-sys after all required tests succeed, without another approval
request. Require verified safe drain, backups and compatibility; never interrupt
running exams. A local test result is not a deployment claim.
The instructor subsequently revoked deployment authorization on October 21:
**finish local development/testing only; do not deploy at the end.** All rollout,
migration, rollback and temporary-agent consolidation steps remain proposals.
The instructor subsequently authorized isolated qualification on csc-sys only
when it does not modify the current installation or interrupt exams. The October
21 nspawn smoke test passed with a disposable overlay/private network; it is not
full privileged qualification or deployment authorization.

## Firm design policy: examctl is the complete management interface

**If an exam-management operation can be done, it must be doable through
`examctl`.** This includes every exam-specific setting and action exposed in the
web administrator interface. `examctl` must be the self-contained,
self-explanatory Swiss army knife of exam management. The web interface is a
convenient alternative, not the exclusive owner of management capabilities.

Administrators must not need ad hoc scripts, direct database/JSON edits, hidden
endpoints or knowledge of repository internals to complete a supported workflow.
Cover exam creation, configuration and deletion; templates; enrollment and CSV
operations; per-student duration and webcam settings; current attempt clocks,
extensions and resets; interruption review and authorization; recovery grants and
saved-work restoration; account restriction inspection and permitted release;
collection, protected submissions and retention; monitoring; alerts and relevant
system configuration; and agent lifecycle and diagnostics. Any additional web
administration capability must also have a supported CLI equivalent. Commands
must clearly distinguish exam definitions, students, attempts and submissions.

Use the same validation, authorization, authoritative state, audit and concurrency
rules as the web interface. CLI completeness does not imply bypassing access
restrictions, replacing protected submissions or weakening recovery approval.
Make web-owned changes available through supported authenticated communication,
with explicit confirmation/pending status and conflict handling. Preserve the
agreed architecture; do not add a separate webserver-to-agent control API.
Explain which operations require the webserver and provide useful offline local
inspection/recovery where possible, without pretending disconnected changes have
been synchronized.

Help and errors are part of the interface contract. Every command must explain
what it does, required arguments, defaults, relevant state restrictions and
consequences, and show practical examples. A refusal must explain why, display
the relevant current state, and give concrete, state-appropriate next commands.
An administrator should be able to discover and finish a workflow using
`examctl` and its own help, without consulting the source code.

## examctl completeness and usability work

- [ ] **Audit command coverage against the complete management policy above.**
  C8 approved October 21: delete only unused exam definitions; archive those with
  history, preserving attempts/submissions. No cascade deletion or silent grant
  cancellation. CLI/web implementation and qualification remain outstanding.
  Inventory every web-admin action and setting, native operation and current
  incident-script workflow. Map each to a supported CLI command; record and fill
  all gaps. Include bulk operations and inspection of confirmed versus pending
  changes. Make the CLI and web UI agree after either changes a setting. Carry
  this firm policy into the canonical design and operator documentation.

- [ ] **Redesign help around discoverable management workflows.**
  October 21 C1a: signed root-agent gateway management and `web exams list/show`
  are tested locally, including the compiled CLI against the real gateway over
  isolated local TLS/restart. Default-deny named operation authorization, replay/
  idempotent request records, pinned reply validation and machine/root audit are
  implemented. Further management capabilities, complete CLI/web parity and
  deployment remain open.
  C1b now adds shared web/CLI create/update for all current definition settings,
  revision conflicts, partial preservation, durable browser retry and before/
  after audit, tested through compiled CLI/TLS, HTTP and 40 browser checks.
  This closes configuration writes, not retirement or full management. Native-only
  legacy recovery grants must become visible/migrated before safe C8 archival.
  C1c adds shared roster/CSV list/add/remove/settings/preview/confirm/export/example
  workflows, tested through actual compiled CLI/TLS, 302 application tests,
  native race/build and 28 browser interface/SSH checks. No caller UID is trusted,
  no active snapshot/clock/hold changes, and consumed previews retry after expiry.
  C1d adds shared alert metadata/test/explicit audited reminders without automatic
  escalation. C1e adds bounded attempt/clock-intent inspection, individual reset/
  extension and explicit bulk/default-allowance workflows. Gateway acceptance is
  distinguished from native application; retries preserve each intent. Confirmed
  timestamp/default-allowance races are fixed, with matching web/CLI fences and
  regression tests. See docs/attempt-clock-management.md for local qualification.
  C1f adds private paginated interruption review/current approval inspection and
  shared audited authorization. Exact generation plus monotonic review revision
  fixes stale/new-reason approval races; retries preserve original expiry and
  private metadata receipts cannot replay deleted monitoring text. All 320 app
  tests, native race/build and 81 combined browser checks pass locally. See
  docs/interruption-management.md. Other management gaps remain open; no local
  increment is a deployment claim.
  Local status: all currently supported native commands have process-tested help,
  examples, defaults, restrictions, units and exit-code guidance without requiring
  root/configuration. Unknown syntax and target/reason/filter misuse point to help.
  C1 now approves existing agent authentication for root-run gateway management;
  C2 also approves unified fixed-at-issuance grants. Implementation, qualification
  and the remaining policy defaults are pending, so this item is open.
  The current help is insufficient. Provide a clear command overview, consistent
  grouping/naming, command-specific help and examples for normal use and recovery.
  Explain identifiers, target selection, time units/timezones, privilege needs,
  destructive effects, exit status and machine-readable output. Invalid syntax
  and unknown commands should point to the relevant help, not just print a terse
  failure. Review the CLI as a first-time administrator with no repository context.

- [ ] **Make refusal messages actionable, especially deletion and access release.**
  Local status: CLI refusals show target type, attempt/account, original/current
  deadlines, protection/policy/writer errors and exact inspection/reconciliation
  commands. Emergency release remains separate and conditional. Broader web/CLI
  parity and complete end-to-end management qualification remain open.
  “Submission cannot be deleted until the account restriction is released” is
  insufficient by itself. Explain whether the target is an exam or a submission,
  which attempt/account blocks the operation, the original/current deadlines,
  protection status, outstanding writers or restoration failures, and the exact
  inspection/reconciliation commands to run next. Explain when normal release is
  eligible and how to verify it. If an emergency override is relevant, explain
  its prerequisites, privileges, required audited reason and consequences; never
  invoke or recommend it as an automatic shortcut. Clearly distinguish deleting
  an exam definition, deleting a submission, cancelling an unstarted preparation,
  finishing an attempt and restoring ordinary account access.

- [ ] **Validate end-to-end CLI usability and error guidance.**
  Walk through creating an exam, importing students, changing settings/time,
  inspecting and authorizing an interruption, staging recovery, diagnosing failed
  collection, restoring eligible access and deleting the intended resource using
  only command help. Include offline/partial failures, conflicting edits, retries
  and dangerous-operation refusals. Test that suggested next commands actually
  work in the state being reported and preserve audit/security requirements.

## Design investigation: unified exams, attempts and workspace initialization

The current recovery workflow exposes a missing abstraction: ordinary exams
largely allow one attempt per student, while recovery effectively authorizes
another attempt with previously saved work. Investigate a unified model in which
an exam can have multiple explicitly allowed attempts, each with its own timing,
workspace initialization and immutable submission. A recovery should be expressible
through that model without requiring a separate exam or another special agent path.
This is a design investigation; agree on the proposal before implementation.

Local design status: C2 is approved October 20—unified grants with settings fixed
at issuance and explicit audited revisions for unused grants. Implementation,
migration and crash/race qualification are still open. C5 now approves webcam/
window policy; C7 selects new-attempt outage recovery with instructor-chosen
allowances and no automatic refunds/reopening. Approval is not a
deployment or historical-record change.

- [ ] **Map the present model and its restrictions.**
  October 21 local D1b increment exposes native-only legacy authorizations through
  `examctl recovery-grants` and blocks dependency-blind source deletion, including
  uncertain consumption and unfinished restored attempts. Tests/status are in
  docs/legacy-recovery-dependencies.md and docs/todo-progress.md. This does not
  migrate authorities or make C8 retirement safe; those remain open/not deployed.
  Review exam definitions, enrollment, attempt uniqueness, sandbox repeatability,
  interruption continuation and the new recovery entitlements. Identify where
  “one attempt” is enforced in schemas, admission, SSH/account policy, callbacks
  and UI. Distinguish resuming an unfinished attempt from authorizing a new one.
  Determine which recovery-specific mechanisms can become general attempt policy.

- [ ] **Propose explicit authorization for additional attempts.**
  Consider per-exam attempt limits/defaults plus per-student and bulk grants,
  including one additional attempt and intentionally repeatable exams. Define
  eligibility, expiration, revocation before use, audit reasons and concurrent
  login behavior. A pending allowance must not be represented as an already
  running attempt or consume time while waiting or doing preflight. Keep the
  default single-attempt policy until deliberately changed.

- [ ] **Define clear `/work` initialization choices.**
  October 21 further source investigation confirms materials/welcome still read
  mutable template paths after starter staging. Immutable catalog and all-reader
  version binding are prerequisites for fixed-at-issuance grants; source map,
  ordered increments and acceptance are in docs/template-grant-investigation.md.
  This is an ongoing investigation, not an implemented catalog/grant migration.
  October 21 local increment: ordinary/legacy-saved work stages privately in
  bounded OS workers before Begin, without clock/marker consumption. Exact
  receipt/source/owner fences, atomic no-replace publication and explicit
  no-reopen repair are implemented; regression/qualification evidence is tracked
  in docs/private-workspace-staging.md and docs/todo-progress.md. Unified source
  selection/version catalog/migration and privileged combined qualification
  remain open. Not deployed; the full investigation is not complete.
  Evaluate starting empty, resetting to a specified template's starter files, and
  preserving saved work by copying a selected prior attempt's verified protected
  snapshot. Clarify what “fresh,” “reset” and “preserved” mean in both interfaces,
  which source/version is selected and when it is frozen. Each new attempt gets
  its own workspace; never modify or reuse a secured submission as writable work.
  Do not imply that unsaved editor buffers or process state are restored. Define
  behavior when the source is unavailable, damaged or has documented omissions.

- [ ] **Separate time allowance and monitoring settings from workspace choice.**
  An additional attempt might receive the exam default duration, an individual
  duration, or explicitly credited remaining time plus compensation, regardless
  of which files it starts with. Specify when webcam/template/duration settings
  are snapshotted and how later edits affect unclaimed grants versus started
  attempts. Start the new clock only at actual Begin. Preserve each original
  attempt's timing, collection and account restriction history; define a safe
  handoff if a prior interval is still restricted, without implicit access overrides.

- [ ] **Support a second full 90-minute attempt after the midterm ends.**
  Include this explicit instructor use case in the unified design: after the first
  midterm is over and its submission secured, grant students another attempt with
  a new full 90-minute allowance, starting from their own saved files from the
  first attempt. This is additional working time, not reimbursement for an outage
  or continuation of an unfinished original clock. The second countdown starts
  only when the student actually begins that attempt; waiting and preflight consume
  none of it. Restore a verified copy into a separate workspace, preserving
  recoverable metadata, and keep both attempts and protected submissions immutable
  in the history. Make individual and bulk authorization available through both
  web admin and `examctl`. Specify the allowed start window, monitoring settings
  and how instructors compare/select submissions without assuming a grading policy.
  The general model should express this without inventing a special recovery exam.

- [ ] **Design one coherent web-admin and `examctl` workflow.**
  Allow an administrator to authorize another attempt, choose its workspace source
  and allowance, inspect pending authorization, and revoke an unused grant through
  either interface. Show all attempts under the same student and exam, with attempt
  number/ID, start/end, reason, source linkage and submission status. Clearly show
  “another attempt available” separately from preflight, active, paused and completed.
  Apply the firm `examctl` completeness/help policy to every resulting operation.

- [ ] **Specify authority, migration and acceptance scenarios.**
  Define durable authoritative records and authenticated synchronization using the
  existing architecture, one-use/idempotency rules and crash/retry handling. Plan
  migration of ordinary exam uniqueness rules, sandbox behavior and recovery
  records without changing historical submissions or interrupting current exams.
  Compare scenarios: a retake with template-reset work; recovery with preserved
  work and compensation; a second full 90-minute attempt starting from the completed
  midterm's saved files; an extra attempt with empty work; an abandoned preflight;
  simultaneous login attempts; unavailable webserver; restarts; and outstanding
  original account restrictions. Record open design choices for the instructor
  rather than implementing assumptions. Keep current recovery grants functional
  until a replacement is agreed, tested and safely deployed.

## Instructor review interface

- [x] **Make screenshots the primary review interface; terminal replay is secondary.**
  Implemented/tested locally October 20; not deployed. Replay requires explicit
  opening and pane selection, stops reads when closed/hidden, and preserves
  positions. Active/completed and live refresh browser regressions pass. Recording,
  retention and authorization are unchanged.
  Lead attempt review with screen captures and, when required, webcam captures,
  using the existing timeline sliders and live mode. Make terminal replay an
  explicitly opened, on-demand tool for investigating a particular interval or
  pane, rather than a prominent/default review view. Preserve the selected tab,
  timeline position and replay position during live refreshes. Avoid loading or
  playing terminal recordings until requested. This is a presentation/loading
  change, not authorization to stop recording or alter retention. Test active and
  completed attempts, switching between screenshots and replay, and auto-refresh.

## Lockout policy change: retain authenticated SSH while the page remains open

Local design status: C3 approved October 21—retain authenticated SSH and preserve
shells/editor buffers through a verified freeze during policy lockouts. All work,
including background writes, remains blocked; clock/deadline enforcement and
fresh authentication after actual ownership/transport loss remain intact.
Coordinated implementation and containment/liveness tests are still outstanding;
the approval is not a production change or a completed investigation.

- [ ] **Reflect instructor approval immediately on the paused student page.**
  The status endpoint already returns `authorization`, but the workspace status
  handler ignores it and continues showing generic instructor-review messaging
  after approval. Show distinct waiting, approved, expired/revoked and resumed
  states, using the current attempt/generation and server time. Promptly reflect
  instructor approval without a page reload or another review request. Clearly
  list the remaining steps: reconnect SSH only if necessary, restore missing
  screen/camera/fullscreen/keyboard conditions, then continue. With retained SSH,
  do not ask for login again. Make expired or superseded approval explicit rather
  than silently reverting to “waiting.” Updating the message must not itself
  unlock input or bypass readiness checks. Test live approval, stale/out-of-order
  updates, expiration, a new interruption, both retained/lost SSH paths and successful
  continuation with a single approval. Implement only after the current exams,
  coordinated with the transport-retention changes below.

- [ ] **Keep the existing SSH connection alive through policy lockouts.**
  When a student leaves fullscreen or another condition locks the attempt, retain
  the authenticated SSH transports for as long as the same page remains open and
  the connections are viable. The student should restore the required conditions
  and obtain continuation authorization under the attempt's policy without having
  to enter their password or complete MFA again solely because a lock occurred.
  This explicitly supersedes the current rule that every policy pause disconnects
  SSH and requires fresh authentication. Update the canonical design, student
  messages, recovery UI, native admission and tests together when implementing it.

- [ ] **Separate retained transport from permission to work.**
  A live SSH connection must not allow terminal input, new panes/channels, remote
  commands, file transfer or background writes while locked. Design a safe writer
  freeze/containment strategy compatible with keeping SSH alive; decide how shells
  and editor buffers can survive without permitting unmonitored work. Keepalive
  and authenticated control/status traffic must not renew execution permission or
  unlock an attempt. Restore work only after required capture/fullscreen/keyboard
  conditions and generation-bound continuation approval are confirmed. Keep the
  original clock, account restrictions and independent deadline collection intact;
  a finished attempt must never reopen. Preserve the existing focus grace period.

- [ ] **Define connection ownership, loss and cleanup behavior.**
  Bind reuse to the same authenticated student, attempt, page and retained SSH
  transport. Close retained connections when the page closes, the student logs
  out/finishes, or the deadline ends access; handle missing browser-close events
  through bounded server-side liveness checks. A reload/browser crash, actual
  transport loss or server restart may require fresh SSH authentication if the
  authenticated connection cannot survive. Explain that distinction accurately.
  Do not retain passwords for reconnection or automatically retry credentials.
  Test repeated fullscreen/keyboard/capture lockouts, instructor approval while
  SSH remains alive, page closure/reload, network failure, background writers,
  multiplexed channels, deadline expiry while locked and another unaffected attempt.

## Confirmed alerting issues

- [x] **Deduplicate failure emails across delivery, retries and restarts.**
  Local status (October 20): persistent episodes, resolution/recurrence, distinct
  causes/generations and SMTP retry/restart regressions implemented and tested.
  CLI authority is now approved (C1: existing agent identity for root-run examctl).
  October 21 M1/C1d now adds shared web/examctl delivery metadata, test and explicit
  audited revision-fenced reminders, with unchanged automatic deduplication and
  cancellation of obsolete unsent reminders. 309 application tests, actual CLI/
  gateway TLS and SMTP retry/restart, native race/build and 31 alert/definition/
  admin browser checks pass locally. See docs/alert-management.md; not deployed.
  `Lifecycle.alert()` in `apps/server/src/lifecycle.ts` only coalesces recently
  pending messages. Once sent, the same unchanged failure can generate another
  email on every callback/reconciliation. The incident produced 14 collection
  warnings about one already-secured submission. Persist an alert episode keyed
  by attempt, event type and relevant generation/cause; track resolution and
  deliberate escalation. Do not merge distinct students merely because subjects
  match, or truncate away a distinct failure. Test repeated callbacks, SMTP retry,
  restart, cause changes, resolution and recurrence, and simultaneous failures.

- [x] **Distinguish intentional administrator actions from lease failures.**
  Implemented/tested locally October 20; not deployed. Authenticated refusal
  state/reason survives SSH receipts and worker IPC; delayed ownership/timing
  replies are fenced. Native cancellation of a started attempt remains refused.
  An administrator pause during the recovery transfer rejected an in-flight
  renewal; the gateway reported “Class-agent lease renewal failed.” Review the
  heartbeat handler in `apps/server/src/app.ts`, native pause callbacks, and
  `Lifecycle.lock()`. Carry the intentional action/reason through the race instead
  of replacing it with a generic monitoring failure. Keep genuine failures
  visible and never let a late reply pause another generation or attempt. Test
  administrator pause, transfer, finish and cancellation against in-flight renewals.

- [x] **Do not report normal deadline expiry as a lease-renewal interruption.**
  Implemented/tested locally October 20; not deployed. Current-deadline checks
  before renewal and after rejection reconcile expiry without a new incident.
  Earlier interruption history and genuine pre-expiry failure alerts are tested.
  Three October 20 alerts reported “Class-agent lease renewal failed” with zero
  time remaining. Audit timing places the gateway locks 119–363 ms after the
  authoritative deadlines; native collection completed successfully, archive
  checksums verified and account access was restored. The heartbeat error handler
  in `apps/server/src/app.ts` checks ACTIVE state/generation/connection ownership,
  but not whether the deadline passed while the renewal was in flight. Reconcile
  normal expiry/finalization instead of creating a new pause, approval requirement
  or interruption email. Keep terminal input blocked and deadline collection
  authoritative. Test renewal/deadline races with delayed status callbacks and
  replies, while still alerting genuine renewal failures before expiry; preserve
  real earlier interruptions in the history. Defer implementation until exams drain.

- [x] **Coalesce repeated review-request emails for the same interruption.**
  Implemented/tested locally October 20; not deployed. Distinct trimmed messages
  notify once per generation; all accepted requests are audited. No automatic
  reminders, and the existing rate limit remains.
  The review-request endpoint currently permits two requests per minute and
  enqueues an email on every accepted request. Reloads/retries generated repeated
  identical requests. Preserve all useful requests in the dashboard/audit, but
  make email notification idempotent per interruption/message, with a clear policy
  for changed messages or reminders. Test double-clicks, reload, retries and a
  genuinely new interruption; do not prevent students from asking for help.

- [x] **Give every actionable alert enough context and accurate status.**
  Implemented/tested locally October 20; not deployed. Lifecycle/preflight/worker
  failures carry identity, Chicago observed time, deadlines, verified protection,
  current restriction/policy and inspection guidance. Unbound sign-in and host-key
  diagnostics state what is unknown and give safe next steps. A reported secured
  copy is not called gateway-verified before manifest validation; reasons are
  quoted. Complete CLI management remains a separate open item above.
  In particular, “Collection requires recovery” still uses only an attempt UUID
  and raw errors. Include student, exam, attempt, event time with timezone,
  confirmed cause, collection/protection status, account restriction status and
  the appropriate dashboard reference. Distinguish secured submission plus failed
  termination/restoration from an unprotected collection failure. Quote untrusted
  filenames and reasons and retain secret-free logging. Audit other alert paths
  for the same gaps; apply the revised editor-lock notification policy below.

- [x] **Suppress editor-lock omission emails even when the saved sibling is absent.**
  Implemented/tested locally October 20; not deployed. Mixed email reports filter
  routine lock entries; protected manifests and collection failure alerts remain
  unchanged. Canonical design documents this intentional notification policy.
  The instructor does not want warnings for routine Emacs `.#NAME` lock symlinks,
  including when the corresponding saved file `NAME` is not in the submission.
  Remove the current saved-sibling requirement for suppressing these notification
  entries. Keep every omission in the protected manifest and never follow or
  restore the lock symlink. An editor lock alone must not trigger an email or a
  separate missing-answer warning. When omissions are mixed, omit routine lock
  entries from the email while still reporting other omitted entries and actual
  collection failures. Do not broadly suppress arbitrary symlinks or other unsafe
  entries. Test lock-only omissions with and without a saved sibling, mixed
  omissions and genuine collection failures. This supersedes the narrower current
  suppression rule; defer implementation and deployment until exams have drained.

## Preflight and recovery correctness

- [x] **Explain SSH sign-in rate limits without blaming credentials.**
  Confirmed during local combined browser qualification: the sixth fresh sign-in
  inside the existing five-attempt/60-second window showed a generic password/
  MFA error. Local implementation now reports the remaining wait and continuing
  clock, audits a bounded rate-limit stage and keeps the limit/credential cleanup
  unchanged. Real WebSocket regression, full 327-test app suite and all 81 combined
  browser checks pass. The fault fixture waits out the original
  window instead of disabling/resetting enforcement. Not deployed.

- [ ] **Complete monitoring management and resilient physical purge.**
  October 21 local correctness increment prevents late legacy callbacks from
  recreating tombstoned recordings and contains retention permission/inventory
  failures instead of crashing the gateway or blocking later attempts. Seven
  focused regressions, 323 application tests/57 files, native race/build and all
  81 combined browser checks pass. See docs/monitoring-retention-fixes.md. This does not complete
  supported CLI export/deletion, shared retry/confirmation or isolated/nonblocking
  physical purge; those remain open and nothing is deployed.
  C1ga now implements shared bounded web/root summary, watermark-paged frame/
  terminal metadata and one-batch replay with transient receipts and private
  output validation. Focused actual CLI/TLS/restart/deletion/output and shared
  HTTP/unit regressions, all 327 app tests, native race/resource/build and all
  81 combined browser checks pass locally. See
  docs/monitoring-cli.md. Whole media export/shared deletion intents/isolated
  purge remain open; this is not a complete-management/deployment claim.

- [x] **Harden cleanup against records that never became real preflights.**
  Implemented/tested locally October 20; not deployed. Housekeeping requires
  real contact/preparation evidence and unset start/deadline fields. Regression
  covers never-contacted records, legacy contact, lost activation and restart.
  Housekeeping in `apps/server/src/app.ts` treats `last_contact = NULL` as an old
  contact (`COALESCE(last_contact,0)`), so unused recovery placeholders generated
  five false cleanup emails. Those incident placeholders have been removed and
  replaced with independent native recovery grants; the general housekeeping
  predicate still needs review. Distinguish an unclaimed reservation from an
  actual preparation, including legacy records and lost activation replies.
  Never retire an uncertain started attempt. Test never-contacted records, real
  abandoned preflights, delayed signed confirmations and application restarts.

- [ ] **Provide supported recovery-grant administration and visibility.**
  Coordinate this work with the unified attempt-model investigation above; avoid
  cementing a second, separate exam-management model solely for recovery.
  Grants currently use root-owned JSON under
  `STATE/recovery-preparations/EXAM/USERNAME.json`; enrollment is updated separately.
  Add audited, idempotent `examctl` operations to create, validate, list, inspect
  and revoke only unconsumed grants. Verify protected source identity/checksum,
  allowance, enrollment and original account restriction disposition. Expose
  signed status to the dashboard so “recovery available, not started” is explicit,
  with source-attempt linkage and the correct allowance. Preserve student-SSH
  commands and agent-to-webserver callbacks; do not reintroduce a control API.
  Keep ordinary policy and explicit approval for emergency handoffs unchanged.

- [ ] **Require a recovery-aware agent and detect mismatched configuration.**
  The new restoration feature is not currently advertised as a dedicated health
  capability. Guard against an incompatible rollback serving a recovery as an
  ordinary fresh exam. A missing grant or disagreement between enrollment duration
  and root grant must be explained before Begin; never silently serve starter
  files instead of saved work. Add readiness/installation checks and a supported
  repair path that preserves the original archive, audit and one-use history.

- [ ] **Extend recovery restoration crash/failure tests and repair procedures.**
  C7 approved October 21: recovery uses explicit new attempts from verified saved
  work with instructor-chosen allowances; no automatic refunds or reopening
  completed attempts. Preserve and safely secure the old work/history first;
  technical source recovery is still required, but a separate old-clock repair/
  compensation mechanism is not the selected workflow.
  Investigated; still open. Local restart regressions now cover published work
  before/after initialized-marker persistence and refusal to overwrite later
  student edits. Full process-death/disk-error qualification and a supported
  repair transaction remain pending the initialization/authority design decision.
  Existing tests cover delayed start, preflight expiry, restart/one-use fencing,
  identity/checksum rejection and unsafe archives. Still test process death and
  disk/permission errors at each boundary: committed start, consumption marker,
  extracted staging tree, workspace rename and `initialized` marker. Activation
  currently commits the clock before restoration; interrupted activation can enter
  collection recovery with an empty or incomplete destination. Establish how an
  administrator safely restores the verified source and accounts for unavailable
  time without resetting one-use markers or overwriting student changes. Test
  with the real watchdog and a second healthy attempt. Treat this as a recovery
  robustness gap, not evidence that a deployed student's restoration failed.

- [x] **Preserve recoverable filesystem metadata when restoring saved work.**
  Implemented/tested locally October 20; not deployed. Ordinary modes and archived
  mtimes are reapplied after ownership, with restrictive-umask, nested executable,
  PAX precision, legacy absence, checksum and real make regressions. See
  docs/recovery-metadata.md for explicit unavailable-metadata limitations.
  Reapply archived file modification times and other relevant metadata actually
  available in the verified archive, within filesystem precision and isolation
  constraints. Restore ordinary permission bits deliberately rather than letting
  the agent's restrictive umask silently change them; retain the intended student
  ownership and never restore privileged ownership or setuid/setgid capabilities.
  Apply metadata in the correct order, with directory modes/timestamps restored
  after children where directory metadata exists. Document what current archives
  contain and what cannot be reconstructed: do not invent original directory
  metadata, ACLs, extended attributes, access/birth times or change times that were
  not recorded or cannot safely be restored. Consider future archive-format changes
  separately, without rewriting existing protected submissions. Keep checksum,
  path/link and safe extraction checks intact. Test timestamp precision, executable
  permissions, restrictive umask, nested directories and metadata absent from older
  archives, including how restoration affects tools such as `make`.

- [ ] **Confirm the intended recovery webcam policy and start window.**
  Local design status: C5 approved October 21—preserve each student's current
  effective webcam requirement unless explicitly overridden, and require a finite,
  explicit Begin window fixed at grant issuance. An extra attempt may have a window
  outside the exam default window; do not intersect them or reopen ordinary
  admissions. Implementation, web/CLI/native verification and migration remain
  open; no existing production grants, windows or snapshots were changed.
  The incident setup preserved individual webcam settings and opened a very broad
  start window for delayed returns. Confirm the instructor's intended policy and
  make it explicit in the dashboard and grant tooling. Email text alone is not
  authorization to change enrollment. Do not change prepared/active attempt
  snapshots or consume waiting allowances while resolving this.

## Maintenance and further validation

- [ ] **Define and implement private workspace cleanup after secured collection.**
  Local design status: C4 approved October 21—manual cleanup with no grace period,
  superseding the earlier 14-day proposal. Verified archive/manifest, confirmed
  termination, no mounts/use/repair dependencies, holds, dry-run and audited
  exact-target concurrency checks remain required. No automatic deletion or
  cleanup of existing folders has been performed; implementation/tests remain open.
  October 21 source investigation/ordered safety increments are recorded in
  docs/workspace-retention.md. Existing release verification can terminate and
  cannot stand in for a dry run; other-namespace mounts/process use need fresh
  proof. Saved-work grants depend on the archive, not the retained live folder.
  Investigation is not marked complete merely because a proposal exists.
  C4a now implements local `workspaces list/show/hold/release-hold`, bounded known-
  attempt metadata, audited hold revisions and metadata-loss fail-closed markers.
  Actual CLI, full native race/resource/compiler/default-size opt-ins, 320 app
  tests and static build/vet/typecheck/build pass; full qualification is in
  docs/todo-progress.md. Candidate is not eligibility: no fresh archive/usage
  proof or workspace deletion command is enabled. Full C4 remains open.
  Original attempt work folders currently remain indefinitely even after the
  protected submission is secured. Decide on retention/grace periods and an
  explicit eligibility rule before implementing deletion. A secured archive alone
  is not enough: require verified archive/manifest integrity, confirmed termination
  of all writers and no active mount/use, and account for outstanding recovery or
  administrator holds. Never delete active, paused, unstarted-but-needed or
  collection-failed work. Preserve the protected archive, receipts, audit history
  and recovery grants; cleanup must not release account restrictions or change
  their original deadline. Verify recovery can still restore from the protected
  archive after the old workspace is gone. Keep workspace retention distinct from
  both submission retention and the 60-day monitoring policy. Provide audited
  `examctl` inspection, dry-run, cleanup and hold controls with actionable refusal
  messages. Use safe traversal without following student-controlled links, make
  retries/restarts idempotent, and test races with finalization, recovery startup,
  failed collection and administrator inspection. Reclaim historical orphaned
  folders only through the agreed policy, not an immediate blanket deletion.

- [ ] **Consolidate the live agent handoffs after a verified drain.**
  The canonical agent, `exam-agent-live-upgrade`, and
  `exam-agent-deferred-recovery` retain existing PTY bridges. Do not stop any of
  them while students may still depend on them. Once active attempts, real
  preflights, pending timing changes and unresolved collection/access recovery
  have drained, follow `docs/native-cleanup-isolation-incident.md`: stop the two
  temporary services, start the patched canonical service, remove temporary units
  and the preservation drop-in, and verify socket ownership, watchdog, callbacks,
  readiness and boot behavior. Preserve grants, consumption markers and archives.
  Check that obsolete incident helper processes have exited; do not use broad
  process-name killing. Review documentation that still refers to only two gates.

- [ ] **Isolate collection failure from the shared agent and other students.**
  Partial local implementation October 21: supervised bounded native workers,
  per-attempt locks, short fenced protection/cleanup commits and isolated export/
  release checks. Actual fatal child, systemd OOM/runtime, permission and isolated
  ENOSPC/read-only regressions pass; healthy signed workflows and blocked-cleanup
  inspection remain available. See docs/collection-worker-isolation.md.
  October 21 Q1 also passes 39 strict real SSH/PAM/cgroup/staging/watchdog/repair
  assertions in a bounded disposable csc-sys guest overlay, with host/base
  preservation checks. See docs/isolated-native-qualification.md. This is not
  simultaneous default-size qualification. Q2 now repeats all 39 in normal-root
  mode and passes 11 real collector-death/healthy-PTY/admission/renewal/private-root
  assertions with exact retry and unchanged holds/deadlines. Host/base preservation
  passes; no installation was changed. Cross-namespace cleanup, saved-source/
  every-boundary recovery and concurrent workload qualification, initialization isolation and
  deployment remain open. The later C6 increment below adds new snapshot limits;
  legacy historical limits remain unchanged.
  Required by C6 October 21 before enabling larger limits. Investigate the
  instructor-reported prior collection crash without assuming its exact cause.
  Run failure-prone per-attempt collection in supervised bounded OS workers,
  outside long shared-state-lock transactions. Preserve protected publication,
  writer checks, original/current deadlines and account restrictions. Inject real
  worker panic/exit/SIGKILL/resource/disk/hang failures while another attempt and
  admission/reconnect stay healthy; prove the shared agent/PTYs do not crash or
  create unrelated lockouts. This is an open implementation/qualification item,
  not covered by tests that only return an error from a mocked writer operation.

- [ ] **Broaden the multi-attempt stress and fault-injection coverage.**
  C6 now additionally requires actual collection-worker crash/hang/resource/disk
  fault containment: the earlier returned-error/blocked-hook regressions do not
  prove that a fatal collection crash cannot kill the shared agent or lock others.
  Partial local qualification: 16 native attempts, four 4 MiB protected archives,
  blocked/refused termination, 12 independent renewals/cutoff and 28 delayed signed
  callbacks pass. A 16-student/64-pane application run includes measured heartbeat
  acknowledgements. In that earlier baseline shared state inspection/admission
  waited behind collection; the October 21 worker increment now requires a
  nonblocking inspection regression. Q2's two-account real privileged combined
  crash/PTY/admission qualification now passes; worst-case simultaneous workloads
  and larger concurrency remain open, not inferred from that narrow result.
  See docs/todo-local-qualification.md; no production capacity claim is made.
  The shared cleanup blockage and independent renewal journal have fixes and
  regression tests. Test realistic simultaneous deadlines and larger archives,
  deliberately slow/hung termination, callback delays, reconnects and new
  admissions together. Measure lease age, web heartbeat acknowledgement latency,
  state-lock wait, watchdog cutoff latency and callback backlog. The October 21
  worker increment removes collection's long shared transaction and adds actual
  process/resource/disk faults; do not mistake the earlier waiting test below for
  current code behavior. Investigate any
  remaining long critical sections without weakening writer checks, deadlines,
  monitoring authorization or per-attempt isolation. This is additional assurance,
  not a confirmed recurrence of the repaired blockage.

- [ ] **Review collection limits against actual exam workloads.**
  Local policy C6 approved October 21: configurable per-exam defaults of 128 MiB
  per file and 512 MiB total; retain 10,000 entries/depth 32. Mandatory collection
  crash isolation has a local bounded-worker implementation. The following local
  C6 increment adds shared web/examctl configuration, frozen 128/512 MiB new
  snapshots and legacy 32/64 MiB preservation across collector/verifier/restore.
  Real GCC source/object/executable protection and a real 512 MiB high-entropy
  disk-backed collection plus private restore pass with concurrent signed healthy
  renewals. Actual tmpfs output OOM motivates new-admission storage refusal, not
  weakened worker bounds. See docs/collection-limits.md and todo-progress.md for
  final test status. Course/debugger sizing, concurrent worst-case storage and
  worst-case privileged workload qualification remain open. Q2's narrow real
  SSH/PAM/PTY/fatal-collector tests pass; no capacity/deployment claim is implied.
  Original collection limits were 32 MiB per-file / 64 MiB total logical size,
  10,000 entries and depth 32 (`collection.go`). These are separate
  from the increased configurable monitoring-recording limit. Check whether normal
  compiler/debugger outputs can exceed them, then decide on configuration and
  instructor-facing preparation checks. Preserve safe filesystem traversal and
  fail-closed collection; do not silently omit saved answers to meet a limit.

## Completion evidence for future work

- [ ] Add focused regressions for each changed behavior, then run appropriate
  integration/race tests in an isolated environment before scheduling deployment.
- [ ] After the maintenance rollout, verify delivery of a small controlled alert
  test, exact recovery timing and saved-work restoration, normal access policy,
  dashboard status and absence of duplicate alerts. Record the revision, checks
  and deployment outcome without publishing student information.

References: `docs/native-cleanup-isolation-incident.md`,
`docs/recovery-runbook.md`, `design.md`, and the protected October 20 alert/audit
records. The reviewed 43 automatic emails were all accounted for by the incident
or recovery operations; none established a separate unexplained outage.
