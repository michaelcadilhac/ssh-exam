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
remain safety prerequisites. The latest resumable status is in
[`docs/todo-current-checkpoint.md`](docs/todo-current-checkpoint.md).
On October 21 the instructor approved C1–C8 and
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

October22 follow-up approvals: C12 selects one bounded terminal supervisor per
user/attempt, not per pane or one shared across students; C13 selects reviewed
bulk NEW grant issuance for legacy unused enrollments from explicitly selected
current settings/version and a finite Begin window. Neither is implemented by
recording the decision; no production records or services are changed. Development
must follow the outcome-first guardrails in AGENTS.md; the scope retrospective is
in docs/development-retrospective.md.

October22 C14 approval: retain automatic repeatable five-minute/no-webcam sandbox
practice within an explicit finite operator-configured Begin window. Every new
grant saves its settings; no new Begin outside the window. Existing started
attempts retain their deadlines. Matching CLI/web configuration and native/gateway
window enforcement are implemented/tested locally; unified
issuance remains implementation work. No deployment. See
docs/exam-definition-management.md; the broad grant TODOs remain unchecked.

## Critical priority: eliminate heartbeat-induced false lockouts

- [ ] **Redesign monitoring liveness and execution authorization; do not turn a
  delayed control exchange into a student violation or destructive lockout.**
  Requested October 21. Initial read-only investigation confirms that the
  installed gateway serializes session messages, awaits an SSH renewal before
  acknowledging browser contact, and permits a 120-second command wait against
  a 15-second execution lease. Independent HTTP captures can keep succeeding
  while this path stalls. Browser confirmation/rebind, control-detachment and
  worker timers must also be investigated; the exact initiating fault is not
  established. Fresh terminal bytes during the reported interval were not proven.
  Keep individual incident details and student identities out of this repository.

  The instructor requires no false positives. Acceptance must demonstrate no
  timeout-induced violation, forced instructor approval, credential prompt,
  process termination or buffer loss while complete, fresh monitoring and the
  same authenticated ownership remain verifiable through a supported path.
  A missing reply alone proves neither student misconduct nor SSH loss. A
  genuine inability to verify required monitoring must still stop work safely;
  call this a technical safety hold, not a confirmed policy violation. It is not
  possible to guarantee uninterrupted work during arbitrary network partitions
  while also forbidding unverified work. Do not conceal that limitation, merely
  lengthen a timeout, suppress warnings, or treat camera/terminal traffic alone
  as authorization.

  Dependency-ordered plan and explicit acceptance/fault matrix:
  [docs/monitoring-liveness-plan.md](docs/monitoring-liveness-plan.md).

  1. Reproduce and trace each hop with synthetic accounts; distinguish monitoring
     receipt, renewal delivery/native commit and reply delivery. Establish the
     initiating-fault evidence before claiming the incident investigation closed.
  2. Isolate/coalesce bounded renewal handling from generic session queues and
     long commands; separate contact acknowledgements from native work permission.
     Add scoped, replay-safe recovery for lost replies and an authenticated
     alternate monitoring path; neither may manufacture fresh policy evidence.
  3. Implement a separate technical-uncertainty state with truthful UI/audit/
     alerts and complete examctl inspection/diagnostics. Any required hold depends
     on C3's verified all-writer freeze, input-epoch revocation and retained viable
     SSH/PTYs. Transport uncertainty must not routinely kill editors or force MFA.
     Preserve genuine policy locks, actual authentication loss and deadline rules.
  4. Implement the October 21 approved technical-hold recovery policy only after
     its evidence/containment prerequisites pass: automatic recovery requires
     positively verified same ownership, current complete monitoring and
     uninterrupted authorized coverage,
     with no actual policy violation or authentication loss. Otherwise retain
     explicit review/recovery; never silently override C3 continuation approval.
     No automatic clock refunds, deadline extension or completed-attempt reopening.
  5. Qualify real browser/WebSocket/WASM/SSH/native workflows with injected queue,
     command/reply, socket, worker, resource and restart faults, including healthy
     uploads/PTY traffic during a stalled renewal. Test genuine monitoring loss,
     hostile/stale/replayed evidence, freeze/thaw/input fences and deadline races.
     Require full integration, native race/build and browser evidence before any
     future drained rollout. Mixed versions must refuse unsafe enablement.

  **Status:** automatic recovery of positively verified infrastructure-only holds
  is now approved;
  actual policy violations/authentication loss retain their existing recovery
  requirements. H1 reproduces serial acknowledgement blockage with fresh HTTP
  screen/webcam uploads and a real authenticated SSH terminal channel (simulated
  shell/policy, not privileged containment). The old handler fails the regression.
  H2a candidate adds independent bounded monitoring/policy handling, typed contact-
  only receipts, page fences and shutdown draining. Nine focused interface/race
  checks and all361 application tests pass locally; three fresh browser checks
  cover receipt authority and actual WASM SSH with final state replies lost for
  17.5 seconds. All91 combined browser checks pass (11.2m); full native race/
  resource/namespace/compiler checks pass (core167.9s/CLI5.9s), build/vet/typecheck
  pass. H2a does not prevent
  native lease expiry when every renewal path stalls and does not implement
  technical hold/thaw. Native evidence/receipt recovery, alternate monitoring,
  input epochs and C3 verified containment remain open; this item stays unchecked.
  The initiating production fault remains unproven. No fix is deployed.
  H2b/H3 now also has an internal, unwired signed-evidence/age verifier and strict
  shared contract tested locally (364 app, fresh full native race/resource checks,
  static/build/typecheck and bounded signed-metadata fuzz); it cannot renew or thaw anything.
  Root epochs, complete evidence/coverage and durable receipt/commit plus C3
  containment remain prerequisites. See docs/monitoring-evidence-contract.md.
  H3b's bounded internal ledger now has coverage-gap identity, current component
  freshness, original retry receipts and sticky genuine policy loss, with22
  focused/compiled-Go interoperability checks and full 383 app/native race/resource
  qualification passing. It is not a live issuer; verified epoch handover/native
  journal/callback/C3
  integration remain open. Independent monitoring cutoff must not blind-freeze
  an old snapshot racing a healthy renewal. The critical item stays unchecked.
  Production remains unchanged; deployment is not authorized. Prioritize this
  correctness work over noncritical feature expansion when development resumes.
  October22 C10/C11 are now approved: verified renewals take effect in the live
  root authority without waiting for disk sync, while restart requires fresh
  verification and durable starts/deadlines/ownership/audit remain mandatory;
  develop and fully qualify stop-assisted freezing, preserving originally stopped
  jobs. Earlier awaiting-decision notes below are historical. Neither approval is
  implementation, completed barrier qualification or deployment authorization.
  The subsequent private C10 arbiter candidate now accepts complete verified
  renewals in memory independently of optional storage publication. Old-model
  wait-for-publication is RED0.018s; a separate retired-ticket launch is RED0.095s
  and corrected with exact current-ticket fences. Ten focused authority/process/
  publisher/storage races pass44.607s and four new cases pass twenty repeats
  3.428s with real blocked children and signed proofs. Full native race/resource/
  namespace/compiler/default-size passes core284.346s/CLI22.157s;426 app95.78s,
  static build/vet and35 Python pass;174 browser hashes match. No runtime caller/
  actor factory/watchdog/input/freeze integration
  is enabled. See docs/live-monitoring-renewals.md. The critical item stays open.
  The next R1a/C11 private reader observes bounded direct kernel cgroup.threads
  through pinned cgroup2 descriptors, rejecting fake/unsafe/incomplete views.
  Twenty native race repeats pass3.055s with actual surviving dead-leader workers
  in owned user scopes; parser fuzz passes94815 executions10.069s. Full native
  race/resource/namespace/compiler/default-size passes core269.086s/CLI25.771s;
  426 app93.15s, build/vet/35 Python and nine fresh browser/WASM SSH checks1.1m
  pass with174 hashes unchanged. This is not task/UID/stop verification, descendant/closed-
  launch coverage, a freeze receipt or a live caller. See
  docs/retained-thread-inventory.md and docs/retained-workload-barrier-plan.md.
  R1b's next unused observer now brackets exact thread PID/TGID/UID/start through
  pinned proc snapshots and group pidfd lifetime, preserving separate T/t/Z/D
  states rather than inventing no-writer proof. The actual wrong-UID mutant is
  RED0.109s and restored;20 corrected races pass3.173s and bounded metadata fuzz
  passes88319 executions11.017s. An initial main-thread-exit fixture failed and
  was corrected, not counted as PASS. Full native race/resource/namespace/
  compiler/default-size passes core286.609s/CLI27.791s;426 app96.14s, build/vet
  and35 Python pass;174 browser hashes match the fresh9-check/1.1m R1a run;
  full scope/descendant/closed-launch/input/freeze proof remains open. See
  docs/retained-task-observations.md. No live mode or production action.
  R1c's next unused pinned hierarchy reader now observes descendant cgroups and
  refuses observed changes/duplicates/budget exhaustion without partial coverage.
  Actual owned nested scopes remain64MiB/swap0/16tasks; a new child during verified
  frozen1 is still detected/refused. The shallow-walk mutant is RED0.052s and
  restored; twenty combined R1 races pass4.219s.426 app98.97s/build/vet pass;
  full native qualification passes core280.307s/CLI24.891s. This is not global atomicity, root launch
  exclusion or a freeze/input permit. See docs/retained-scope-hierarchy.md.
  H4a/C3 now has a private unused framed-input codec and canonical cross-language
  byte fixture. Actual encrypted SSH-channel and raw Linux PTY tests cover binary
  control keys, UTF-8, fragmentation, truncation, malformed headers and bounded
  payloads. The32KiB cap preserves the existing worker limit and supported Unicode
  pastes. Full native race/resource/namespace/compiler tests and all383 application
  checks pass; all91 browser checks pass again (11.2m) with exact WASM/runtime/
  JS/CSS/worker/HTML hashes unchanged before/after the run. No live
  bridge/worker input caller or capability uses it. Root epochs, per-pane revocation
  acknowledgements, queue discard, all-writer freeze and coordinated recovery are
  still required; a codec alone cannot preserve editor buffers safely. See
  docs/retained-ssh-input-protocol.md. This critical item remains unchecked.
  H4b now also has an internal, unused per-pane input/revocation gate. Ten focused
  cases pass ten native race repeats, including real PTY backpressure and a
  delayed partial old-epoch frame. Revocation never waits for a write; the drain
  deliberately does wait for its final return. A stale initial-write timeout
  false-revocation regression was reproduced in the candidate and fixed by
  rechecking current authority on timer delivery/renewal. Full native race/resource/
  namespace/compiler checks pass again (core171.9s/CLI5.8s), static build/vet pass
  and26 focused application/compiled-Go/real-interface checks pass. Browser artifacts
  remain hash-identical to H4a's91-check run. No native transition or live bridge
  uses it; durable cross-process
  registration/epochs, queue discard/all-writer freeze and authenticated negotiation
  remain mandatory. Drain alone is not freeze proof or permission to thaw.
  H4c adds a private unused cancellable pinned-PTY adapter and kernel-input discard.
  Actual PTY tests cover raw/canonical pending input, output preservation,
  backpressure cancellation, stale deadlines, failed discard and independent panes;
  all18 combined gate/adapter cases pass20 native race repeats (15.9s). Final full
  native race/resource/namespace/compiler checks pass (core170.3s/CLI6.4s), static
  build/vet and all383 application checks pass again (82.82s). Exact browser assets
  remain hash-identical to the91-check run. Legacy raw bridges/flags remain unchanged.
  This is not root cross-process authority, verified workload freeze or live
  retained SSH. No mode/capability or automatic recovery is enabled.
  H1/C1 diagnostics candidate adds explicit `list/info --read-only` before agent
  initialization: no reconciliation/chmod/lock/audit/network/subprocess or lease
  application. `--state` works without config/keys. Scoped paginated JSON separates
  captured state/lease facts from live SSH/monitoring/authorization; partial reads
  are not false expiry/misconduct. Focused core/actual compiled namespace-root CLI/
  help cases pass; full native race/resource/namespace/compiler checks pass
  (core168.0s/CLI9.2s), all383 app tests pass (81.89s), static build/vet/typecheck
  pass and bounded two-worker JSON fuzz passes119353 executions (11.02s elapsed).
  Exact browser artifacts remain unchanged from the91-check run. Unflagged legacy inspections
  retain their reconciliation behavior and are explicitly documented. See
  docs/native-read-only-diagnostics.md. This does not close the incident's initiating
  fault, root coordination or the critical item; nothing is deployed.
  Native clock groundwork now has an unused checked CLOCK_BOOTTIME integer reader
  and typed clock errors for the private input gate. A RED synthetic clock-jump
  test exposed an old long Go timer concealing elapsed authority; bounded current-
  cutoff rechecks fix that candidate defect without extending permission. Native
  repeats pass all22 clock/gate/PTY cases20 times (18.94s); final full native race/
  resource checks pass (core168.0s/CLI7.7s), build/vet and26 focused application/
  cross-language/interface checks pass. Legacy deadlines/access are unchanged.
  Gateway suspend/failure/precision handling and unsafe legacy /proc clock failure
  handling must be resolved with coordinated native transitions before enablement.
  Do not blindly substitute coarse os.uptime, invent time on an error, finalize/
  release on uncertainty or claim this was the production cause.
  The next private native authority/publication arbiter is also unused by runtime
  paths. It keeps bounded live decisions separate from future storage IO, checks
  current rather than old cutoffs, preserves original retry outcomes and rejects
  late publication after revocation. A persisted record cannot reconstruct its
  one-use live context. Fourteen focused signed-evidence cases pass twenty race
  repeats; full qualification is recorded in docs/todo-progress.md. This is not a
  durable journal, actual owner verifier, freeze or recovery workflow. Root
  ownership exclusion, isolated publication and coordinated containment remain
  required; this critical item stays open. See docs/native-monitoring-authority.md.
  Independent native process claims and a private bounded provisional publisher
  are now tested locally, including surviving children, actual OOM/runtime/disk
  faults, compiled root-mapped binaries, full native/app regressions and replay/
  concurrency fences. They enable no live renewal or retained mode. Per-renewal
  durability versus live-authority availability is now an explicit pending design
  question; fair scheduling, actual native peers, C3 barriers and combined
  qualification remain open. See docs/native-monitoring-publication.md.
  Gateway clock/unknown-focus groundwork now passes389 application checks,
  native-clock/UBSan/compiled-Go checks, full native compatibility, build/typecheck
  and all91 browser checks with nine exact artifact hashes. A RED stale-blur-
  after-gap classification is fixed without extending focus grace or authorizing
  unknown work. The evidence ledger remains unused; no live retained mode or
  automatic recovery is enabled. Container packaging remains unverified until a
  local Docker engine is available. See docs/gateway-monitoring-clock.md.
  A separate unused kernel process-lifetime guard now passes actual synthetic
  stop/continue/death, identity/JSON/close-race, fake-root refusal and late-authority
  tests plus full native qualification. A live pidfd alone is not authentication,
  current registration or freeze proof. Q3's disposable guest now passes actual
  SO_PEERCRED/OpenSSH-owner pinning across command exits and real connection exit,
  including five repeats of the final test artifact with unchanged host/base
  evidence. No installed command/attempt/lease is added. Current registration,
  native epochs/admission/IPC and all-writer C3 remain open. See
  docs/native-monitoring-process.md and docs/isolated-native-qualification.md.
  Q4 also qualifies15 actual cgroup/PTY freeze/discard/thaw cycles in the isolated
  guest, preserving synthetic process/memory state, stopping/resuming a background
  writer and refusing an uncontained UID. Skipping discard makes all five tests
  fail with STALE input; the mutant is removed. No actual editor/retained SSH,
  native admission/epoch transition or automatic recovery is claimed. Basic and
  SQPOLL asynchronous IO are available in that fixture, so deferred-IO behavior
  remains an explicit open gate. See docs/native-freeze-qualification.md.
  Q5's real deferred-IO experiment finds an unresolved compatibility failure:
  all18 unfrozen baselines succeed, but12 ordinary-dispatch frozen linked writes
  are canceled, identically across three repeats; forced-worker cases survive.
  Host/base preservation passes. This is not a completed freeze qualification;
  no syscall restriction, kernel change or live retained mode is introduced.
  See docs/native-async-io-investigation.md for exact evidence, unchanged
  acceptance and the separate synthetic job-stop experiment. The critical TODO
  remains open and no initiating production cause is claimed.
  October22 writer regression also confirms that a zombie main thread can hide
  a still-writing worker from the old UID checks. The local candidate now pins
  group lifetime/proc observations through signals and refuses missing live views;
  actual thread/cgroup and ordinary SSH-to-Begin regression passes locally.
  Final local qualification passes414 app checks, full native race/resource/build,
  five actual writer guest repeats,40 SSH/PAM/Begin/hold/restart assertions,11 real
  collector-death/healthy-SSH assertions and three actual CLI health cycles, all
  with host/base preservation. See docs/writer-thread-groups.md. This is not the
  production incident cause or completed retained-SSH/root-admission work. Add the
  documented dead-leader terminal case to C11 stop-assisted qualification; do not
  infer it from earlier Bash/Nano tests or enable a new signal policy. That
  separate guarded test now passes60 actual freeze/discard/thaw cycles, preserving
  acknowledged worker-memory/foreground/shell/original stopped-job state with
  unchanged host/base evidence. Full native race/resource/build and34 Python
  checks pass. It does not repair deferred-IO cancellation or complete root
  admission/retained SSH; C11 remains awaiting decision. Exact hashes/evidence:
  docs/native-async-io-investigation.md. No deployment or policy change.
  A further confirmed native admission issue is corrected/tested locally: ready/
  ACK socket IO no longer owns the global state lock, closes revoke queued pane
  tokens, replacements supersede old tokens and launch rechecks current authority
  before durable one-use consumption/scope tracking. Actual authenticated SSH
  with a withheld ACK and signed late close passes; restoring the old lock makes
  all three controls fail. Full426-app/native race/resource/build and35 Python
  checks pass, plus40 actual SSH/PAM/enforcement and11 collector-death/healthy-
  peer assertions, with host/base preservation. Exact hashes and limitations:
  docs/pane-admission-isolation.md. The later October22 local pane-open follow-up
  also moves private filesystem/PTY setup outside shared state, with nonblocking
  per-UID and one-copy-per-Engine bounds. Actual Unix/PTY slow-setup controls,
  close/cancel/no-late-launch, failure/FD/fence cleanup pass focused races;
  current-artifact full native core281.826s/CLI20.327s and429 app checks94.50s pass.
  Actual OS launch/readiness,
  C10/C11, retained SSH and the initiating incident remain open; no fix is deployed.
  End-to-end pane review also reproduces a UI false-positive: technical error
  text containing Page/owns triggered an ownership incident. Explicit gateway-
  classified ownership codes now distinguish it from retryable technical errors;
  verified ownership/monitoring/native guards remain. Three browser RED cases and
  actual authenticated WS regression cover this locally;17 fresh browser checks,
  full native/app qualification and builds pass. Evidence/fixture corrections are
  in docs/pane-admission-isolation.md. No incident cause is inferred.
  A separate local resource regression confirms received socket descriptors leaked
  on seven rejected/non-pane request paths. The candidate immediately owns/closes
  all returned rights, rejects truncation/extra rights and transfers one valid PTY
  exactly once. Twenty race repeats, actual PTY/descriptor checks,426 app, full
  native race/resource/build,35 Python and new exact-artifact actual SSH ACK,
  40 enforcement and11 collector-death/healthy-peer assertions pass; every host/base
  preservation check passes. Details: docs/native-gate-descriptors.md. This is not
  global connection-flood capacity, C3 completion, a production diagnosis or deployment.
  The local health-isolation increment also reproduces slow readiness IO blocking
  global state through public health, signed health and configuration publication.
  Observations now run outside state after existing validation/durable nonce
  consumption; configuration publication remains a short separate transaction.
  Busy refuses without false readiness/policy events and Begin never uses cached
  health. Focused/actual compiled namespace CLI checks,426 app, full native
  race/resource/build and35 Python checks pass. The exact artifact passes three
  actual signed-SSH held-health/independent-inspection repeats and40 enforcement
  assertions with host/base preservation. Its final11 worker/healthy-peer checks
  remain pending: new live/unresolved host work made the guard refuse BEFORE
  guest creation. See docs/native-health-isolation.md. Do not clear production
  records or substitute an older binary's receipt. This does not close the
  critical TODO, establish the incident cause or enable retained SSH/recovery.
  A following configured-account readiness fix reproduces an unbounded NSS wait
  through actual compiled namespace-root CLI. The candidate bounds the whole
  lookup pass/output/pipe drain while keeping current UID/login restrictions and
  fresh uncached Begin checks. Unknown provider results are unavailable, not
  misconduct. Full426 app/native race/resource/namespace/compiler/default-size,
  static/vet and35 Python tests pass;174 prior browser hashes match. New exact-
  artifact guest qualification remains pending on the idle-host safety gate.
  See docs/native-readiness-accounts.md. No production change or closed parent
  TODO/initiating-fault claim.

October22 integrated preflight candidate: new prepare-attempt readiness/home IO
no longer owns shared state. Durable pending checks remain inspectable/cancellable
without admitting work or starting time; late results recheck current authority
and cannot revive cancellation. Focused native/signed/CLI and signed HTTP callback
checks pass,426 app and six relevant browser workflows pass; final native
qualification passes core278.848s/CLI27.072s. See docs/preflight-isolation.md. This does not complete
the critical monitoring redesign, unified grants or CLI audit; nothing deployed.

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
  October22 administrator parity candidate now adds shared browser/root
  `web administrators list/show/create`, explicit named agent authorization,
  original-password strong-verifier retries, secret-safe TTY/stdin and no account
  overwrite. Full426 app/native race/build and actual CLI/TLS/PTY checks pass;
  all114 combined browser checks pass with174 unchanged source/runtime hashes.
  Migration021 contains
  sensitive verifier intents, not plaintext/fast password fingerprints. See
  docs/administrator-management.md. Full management/remaining items stay open;
  this is local work, not configuration enablement or deployment.
  C8 approved October 21: delete only unused exam definitions; archive those with
  history, preserving attempts/submissions. No cascade deletion or silent grant
  cancellation. CLI/web implementation and qualification remain outstanding.
  Inventory every web-admin action and setting, native operation and current
  incident-script workflow. Map each to a supported CLI command; record and fill
  all gaps. Include bulk operations and inspection of confirmed versus pending
  changes. Make the CLI and web UI agree after either changes a setting. Carry
  this firm policy into the canonical design and operator documentation.
  October22 per-pane CLI candidate now implements bounded no-write `panes
  list/show` and reviewed `panes close` with checked durable root/machine audit,
  scoped revisions, unique native incarnations and shared targeted student close.
  Legacy/startup-unverified records refuse rather than discard tracking. Final426
  app/full native race/resource/build and actual guest ACK/two-shell/root-CLI pass;
  the same exact candidate also passes40 guest enforcement and11 real collector-
  death/healthy-peer assertions, all host/base preservation passing. Exact tests/hashes
  and future drained mixed-version/rollback gates are in docs/native-pane-management.md.
  Manual close can lose that pane's buffers; it is not C3 retained lockout freeze.
  No deployment, direct state editing or whole-attempt substitute is implied.

- [ ] **Redesign help around discoverable management workflows.**
  Administrator candidate help covers full privilege consequences, named
  permissions, exact secret input, scope-safe metadata, original-intent retry,
  no reset/overwrite and actionable known-cause refusals. Unknown signed errors
  cannot leak credentials. The old missing workflow and candidate overly generic
  refusal each fail their real CLI regressions before correction. Actual private
  TLS and hidden-terminal checks, final426 app/full native repeat and114 browser
  checks pass locally. Do not count this as completed help for all pending grant/config
  workflows or deployed functionality.
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

  A later actual CLI/TLS regression confirmed wrong nested private-review scope
  was printed before rejection. Local validators now precede output; valid fully
  scoped partial clock diagnostics retain their JSON/exit1 contract. Dedicated
  actual root CLI/TLS/restart and companion-target unit regressions pass locally,
  including the full350 application tests. No new management policy/deployment.
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
  October22 local correction removes a confirmed side effect: refusal reporting
  called legacy List, reconciling access/rewriting state merely to explain an
  error. It now uses scoped read-only capture, preserves the original error/exit1,
  displays bounded recorded diagnostics and suggests working --read-only commands
  with the chosen config path. Original state/lock regressions are RED0.318s; the
  corrected actual compiled namespace-root workflow is RED0.405s when the old
  side effect is restored, then passes after restoration. See
  docs/native-read-only-diagnostics.md. Final full affected CLI races/TLS/namespace/
  PTY/help pass14.594s, three focused read-only core repeats1.097s and build/vet
  pass; no app/browser implementation or deployed policy change, and broader
  management/refusal coverage remains open.
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

October 21 issuance timing decision: enrollment/import issues the initial ordinary
grant and saves its settings immediately. Later defaults require explicit unused-
grant revisions; do not defer the snapshot until preflight. Confirmed immutable
template/source versions and finite Begin windows are issuance prerequisites.
Existing enrollment migration and implementation remain outstanding.

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
  October 21 source investigation confirmed legacy materials/welcome still read
  mutable template paths after starter staging. The C2a3 native candidate now
  binds explicit versions consistently; current gateway-issued snapshots remain
  legacy until authenticated catalog visibility and grant issuance/migration.
  Immutable versions are prerequisites for fixed-at-issuance grants; source map,
  ordered increments and acceptance are in docs/template-grant-investigation.md.

  C2a4 metadata visibility is now implemented/tested locally: root `templates sync`
  verifies local bytes before signed acknowledgement, `web templates list/show`
  and the read-only administrator catalog share exact-version metadata. Additive
  migration020 changes no student/grant/attempt/history record. Stable retries
  preserve acknowledgement age; new requests explicitly refresh, and registry
  presence is never a live availability lease or automatic selection. Actual
  compiled CLI/native verifier/TLS/restart, HTTP/unit, four catalog browser and
  full361 app/91 combined browser/fresh native race checks pass. See
  docs/template-catalog.md. Later C2a2/a3 notes below describe their earlier narrower
  checkpoints; signed metadata acknowledgement is no longer unimplemented.
  Source selection/unified issuance/migration and privileged guest qualification
  remain open; all changes are local, not deployed. Critical monitoring work
  remains the active priority.

  C2a1 adds an internal, still-unwired exclusive private-copy primitive with
  independent copied-byte/source verification, metadata preservation and flushes.
  Focused race tests include 128 MiB streaming, actual child SIGKILL/fresh retry,
  mutation and same-device source bind-alias refusal. The subsequent C2a2 local
  candidate adds a separate bounded worker/pool, atomic no-replace catalog,
  supported `templates validate/install/list/show/verify/jobs/clean`, strict IPC
  and owned crash cleanup. Focused race/process/CLI/storage/mount/resource tests
  pass, including fresh full native race (core155.8s/CLI5.7s), 350 app tests,
  typecheck/build/static/vet and 29 browser-SSH checks. Privileged system-manager
  guest evidence remains pending. The csc-sys idle-host guard refuses its two live or
  unresolved attempts. No production source/student path was changed. All-reader
  native binding is now added below; signed catalog acknowledgement and unified
  grants remain unimplemented;
  see docs/template-catalog.md. Not deployed; investigation remains open.
  This is an ongoing investigation, not an implemented catalog/grant migration.

  C2a3 now adds native optional exact-version binding for private starter work,
  normal/admin materials and welcome. Omitted fields preserve legacy JSON/hash/
  receipt/history compatibility; explicit versions never use mutable fallback
  or latest. Full byte verification runs in bounded staging and a separate OS
  worker before Begin, outside shared state; ownership/settings/generation/window
  fences recheck before any interval/policy commit. Practice reads no catalog.
  Signed restart/edit/corruption, actual verifier death/hang, stale-snapshot and
  real read-only namespace IO regressions pass. Full native race/resource/
  namespace/compiler/default-size suite (core163.1s/CLI7.3s), app350/65 (73.2s),
  typecheck/build/static/vet and three fresh browser-SSH isolation/cleanup checks
  pass locally. Gateway confirmation/selection, issuance/migration and privileged
  system-manager qualification remain open. No deployed or historical snapshot
  was changed; the full investigation is still open.
  October 21 local increment: ordinary/legacy-saved work stages privately in
  bounded OS workers before Begin, without clock/marker consumption. Exact
  receipt/source/owner fences, atomic no-replace publication and explicit
  no-reopen repair are implemented; regression/qualification evidence is tracked
  in docs/private-workspace-staging.md and docs/todo-progress.md. Unified source
  selection/version catalog/migration and privileged combined qualification
  remain open. Not deployed; the full investigation is not complete.
  A further confirmed correctness fix now refuses root MANIFEST.json starter
  entries before clock start, including bad retained private stages at adoption/
  Begin. Source/private bytes stay intact; nested names remain permitted. Signed
  preparation/repair and legacy Begin regressions pass; fresh full native race/
  resource suite (110.4s), 346 app tests, typecheck/build/static/vet pass. This is
  earlier enforcement of the collector's existing reserved-name
  rule, not automatic file cleanup or a catalog/grant implementation.
  C2a0 additionally has a tested internal, unwired source inspector (safe pinned
  traversal, observed mutation checks, per-tree entry/depth bounds, real same-
  device mount refusal and 128 MiB streaming). C2a2's separate local catalog/CLI
  and C2a3 native binding candidates are described above; no published-version
  acknowledgement or gateway version selection exists yet;
  investigation and migration remain open. See template-grant-investigation.md.
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
  Local partial implementation (October22): scoped read-only status metadata and
  stale-reply/expiry fences now drive explicit approval/revocation/expiry feedback
  without automatic reauthentication, review requests or Continue. A deliberately
  disabled status handler makes the real gateway/WASM SSH approval regression
  fail; the mutant is removed. Six unit/HTTP checks, all395 application checks,
  build/typecheck, all111 expanded browser checks and six desktop/narrow/clock
  follow-up browser cases pass. Retained-path fixtures prove presentation only,
  not actual C3
  buffers/freeze; this checkbox stays open. See docs/student-continuation-status.md.

  A separate confirmed browser queue bug is fixed/tested locally: closing a pane
  invalidates unsent input and late errors before a replacement reuses its UI ID.
  Both old success/failure cases are RED; all398 app and113 fresh browser checks
  pass after the fix. This cannot recall bytes already sent to the worker/SSH;
  native per-pane epochs and complete C3 barriers remain required. See
  docs/browser-input-lifetime.md. No native retention mode is enabled.

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

- [x] **Complete monitoring management and resilient physical purge.**
  Implemented/tested locally October22; **not deployed**. Shared web/root
  monitoring readers, reviewed deletion, durable isolated purge/status/inventory
  and complete private export are now covered by supported workflows. Final414
  app checks/79files, full native race/resource/build/typecheck and all113 fresh
  frozen-artifact browser checks pass. All140 source/runtime hashes match;
  see docs/monitoring-export-qualification.md. Protected submissions, deadlines,
  holds, credentials and60-day monitoring policy are unchanged. This completes
  the local workflow/purge item, not whole-host capacity certification, hardware/
  process isolation for media reads, production rollout or complete examctl.
  Earlier incremental checkpoints below record the work's chronology.
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
  A subsequent failing HTTP regression confirmed legacy review/media could read
  older bytes/metadata restored alongside a retained tombstone. Full/thumbnail
  reads now refuse and aggregate review hides restored monitoring but keeps the
  protected manifest. Full 332-test working-tree suite, 16 focused CLI/HTTP/unit
  checks, 28 monitoring/admin browser checks and build/typecheck/native race
  compatibility pass. The isolated purge process boundary has focused fatal/
  hang/heap/permission/link tests but is still unwired; see
  docs/monitoring-purge-isolation.md. Physical purge and shared deletion remain open.
  C1gb2 now connects the local candidate to durable isolated purge jobs for manual,
  retention and preflight-retirement callers; no recursive purge in those request/
  lifecycle paths. First tombstone/enqueue are atomic; jobs survive retired rows,
  retry with bounded backoff and fence old workers/results. CLI show/web review
  distinguish logical deletion from timestamped current-directory absence. Full
  341 app tests/61 files, actual CLI/TLS/status and real HTTP/SSH/PTY nine-fault
  regression pass; all 28 admin/monitoring browser checks, typecheck/build and
  native race compatibility pass. Shared reviewed deletion intents,
  CLI delete/full export/retired-job inventory and qualification remain open.
  No migration was applied to production and nothing is deployed.
  C1gb3 adds shared named/revision/reason/intent-fenced ended-only deletion and
  `examctl web monitoring delete`, with metadata-only durable retry receipts.
  Exact retries/new-parent child intents do not reset purge backoff. Browser
  confirmation captures the review and preserves sent intent after lost replies.
  Focused shared/HTTP/real SSH tests, compiled CLI/TLS/restart, all 344 app tests/62
  files and all 31 admin/monitoring browser checks pass. Fresh native race/resource/
  compiler/default-size checks pass (108.1s core), static build/vet/typecheck/build
  pass. Whole-media export/retired-job inventory and wider management remain open;
  nothing is deployed.

  C1gb4 adds read-only `web monitoring purges` and `purge-status ATTEMPT`, with
  shared bounded authenticated HTTP inventory, ID pagination, stored-status
  filters and visibility after preparation retirement. Metadata-only management
  outcomes are labeled snapshots; NEW requests get fresh status, not filesystem
  verification. 346 app tests/64 files, compiled CLI/TLS/restart, unit/HTTP/privacy/
  index and native race/build/typecheck checks pass locally. All84 combined browser
  checks pass (10.6m); the final root inventory audit-label regression/full346
  repeat also passes. Whole-media
  export and broader management remain open. Migration019 is local only.

  A new authenticated regression confirmed stored image symlinks could expose
  unrelated protected-fixture bytes. Local bounded async pinned/no-follow reads
  now reject links/special files/oversize/altered originals and recheck tombstones
  immediately before response publication. A separate deletion race regression
  was proved failing without that last fence. Four HTTP regressions include real
  FIFO images plus healthy concurrent HTTP in a disposable child server. Full350
  application tests, 84 browser-SSH checks, build and typecheck pass; this adds no
  CLI capability/retention change and
  does not complete media export or OS-level read fault isolation. Not deployed.
  C1gc1 is now implemented/tested locally: discoverable root image/original/thumbnail
  reads share the existing web reader, capacity and deletion fences. Exact scope,
  length/digest and private-output validation are tested through the compiled CLI
  and real TLS; signed mismatches cannot print or create files. A removed final
  deletion-fence mutant makes the HTTP regression fail; restored before full
  checks. Fifteen focused, all400 application and full native race/resource checks,
  static/build/typecheck and49 frozen-artifact browser checks pass. All18 hashes
  match; see docs/monitoring-image-qualification.md. One image is not a whole export; C1gc2 and this
  checkbox remain open. See docs/monitoring-export-plan.md and monitoring-cli.md.
  C1gc2's complete-copy workflow is now wired locally and in final qualification:
  `examctl web monitoring export ATTEMPT --output NEW_DIR`, separate named
  authorization, bounded purpose-signed stream, original/derived captures, exact
  raw recording prefixes/tails, history and hash manifest. Actual streaming TLS/
  root CLI, bad signed packets, truncation/trailing data, destination races,
  append/overwrite/history/deletion faults and real socket cleanup checks pass.
  Held export IO preserves real authenticated SSH, signed renewals, new panes,
  captures and health in the synthetic fixture. Initial full413 application checks
  pass; final qualification now passes414 application checks, full native race/
  resource/static/build/typecheck and113 fresh browser checks with140 identical
  source/runtime hashes. This increment and the monitoring workflow/purge item
  are complete locally, not deployed. No protected-submission/hold/deadline or
  retention change. See docs/monitoring-export-qualification.md for exact status.

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
  October22 metadata safety candidate reproduces two shared-lock FIFO stalls in
  actual Begin child processes and five accepted unsafe/ambiguous records, then
  corrects them with pinned private directories, bounded no-follow/nonblocking
  grant/marker reads and shared strict catalog/admission JSON validation. Sixteen
  Begin cases, actual root CLI privacy/refusal, decoder fuzz and426 app checks
  pass; final full native race/resource and fresh9-browser checks pass, plus new
  exact-artifact guest40 enforcement/11 collector-death/3 root-pane repeats with
  host/base preservation. No interval, marker, archive
  or hold rewrite, unsafe-record fallback or production change. See
  docs/recovery-metadata-safety.md. Every-boundary recovery and unified issuance/
  expected-source compatibility remain open; this broad item stays unchecked.
  A following separate workspace-receipt correction now reproduces and fixes
  another FIFO/shared-lock stall plus accepted hardlinked/duplicate receipts.
  Nine Begin-process cases and actual root CLI start refusal preserve interval,
  private work and source; full426 app/native race/resource, static/vet,35 Python
  and bounded decoder fuzz pass. The new exact-artifact guest passes40 enforcement,
  11 real collector-death/healthy-peer and3 root-pane repeats, all host/base
  preservation passing;174 frozen browser source/runtime hashes still match.
  See docs/workspace-receipt-safety.md; no source recopy, metadata invention,
  account release, deployment or completed initialization claim.
  A later local C7 qualification increment now kills actual disposable children
  at six private/start/consumption/work-rename/initialized boundaries in both
  operator-first and native-watchdog-first order. Thirty-six cases include24
  actual namespace-root CLI repair/refusal operations and102 healthy signed peer
  renewals, exact source manifest/archive/identity/hold and new-answer hashes.
  A temporarily removed durable-start fence makes the new test fail and is
  restored. Final focused matrix6.465s, full native race/resource/namespace/
  compiler/default-size core256.144s/CLI21.434s,426 app91.32s, static/vet and35
  Python checks pass. Only private non-configurable test checkpoints are added
  to runtime; no new recovery policy is enabled. OS account/writer guards are
  fake in this matrix; actual disk-fault boundaries/new exact-artifact privileged
  combined qualification/unified expected-source migration remain open. See
  docs/workspace-publication-crash-qualification.md; no production change.
  A subsequent actual private-tmpfs ENOSPC regression confirms an empty final
  consumption marker prevented supported root CLI repair; readonly errors were
  also masked as conflicts. Both are RED on the old writer. A local candidate
  atomically publishes a complete single-link marker from an unnamed private
  inode across current/legacy writers, preserves typed IO errors and probes
  known bad consumption storage before Begin in the isolated staging worker.
  Existing malformed/foreign markers are NOT overwritten. Three expanded native
  race repeats pass12.678s with48 actual child-death cases, real disk/readonly/
  CLI/healthy-peer workflows; marker race/privacy/refusal checks pass too. Full
  native race/resource/namespace/compiler/default-size passes core273.777s/
  CLI23.267s;426 app97.88s, build/vet,35 Python and actual CLI help pass. A
  separate RED signed-Begin case now refuses a matching consumed UUID without
  known chronological original clocks before admission or new time consumption.
  Two raw archive fixtures were corrected to use the nonconsuming extractor,
  not relax the durable-start guard. All174 browser hashes still match. The
  explicitly approved code-only bundle is uploaded/checksum-verified in a private
  csc-sys test directory; initial guards refuse BUSY. A later guarded run passes
  three actual pane/health/root-CLI repeats with host/base preservation; the next
  enforcement run is refused before guest creation on new live/unresolved host
  work.40/11 enforcement/worker assertions and hardened consumption-filesystem
  compatibility remain pending for that artifact. New exact-
  artifact hardened guest/whole recovery gates remain open. See
  docs/recovery-consumption-atomicity.md.
  No clock/hold/grant-format, account policy or production change is implied.
  A later separate extraction regression is RED0.476s: real private staging
  ENOSPC was mislabeled saved-file verification failure. Copy/sync/close errors
  now retain their IO category; actual hash mismatches still refuse. The expanded
  eight-scenario storage matrix passes three native race repeats5.349s with
  source/interval/hold/peer and usable-retry checks. Full native race/resource/
  namespace/compiler/default-size passes core279.751s/CLI23.357s;426 app96.01s,
  build/vet and35 Python pass;174 browser hashes still match. See
  docs/recovery-storage-diagnostics.md. No source, authority,
  historical marker or production change, and no completed recovery claim.
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
  October22 C4b0 implements/tests an internal bounded mountinfo/source-root
  relationship prerequisite, including actual private-namespace same-device
  directory/file aliases and escaped paths; a wrong mountpoint-only mutant fails
  and is removed. Full414 app/native race/build, bounded fuzz and140 unchanged
  web-artifact hashes pass. This is NOT complete mount/process-use proof,
  eligibility or a cleanup command; those and fresh archive/hold/state/admission
  fences remain required. See docs/workspace-mount-observations.md. No workspace
  is deleted, grace period introduced or production state changed.
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
  October22 local verification follow-up closes a missing aggregate zero-swap
  readiness check; individual workers and the supplied pool already disabled
  swap. Exact-property missing/nonzero refusal is tested through actual CLI and
  real guest kernel limits, plus same-candidate11 worker-death/healthy-SSH and39
  enforcement assertions with host/base preservation. Full414 app/native race/
  resource/build and140 unchanged web-artifact hashes pass; see
  docs/collection-pool-readiness.md. This does not close remaining capacity/stress
  qualification or deploy anything; preserve the original interval/holds/history.
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
