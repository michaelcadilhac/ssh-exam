# Development instructions

## Authority and safety

- Preserve existing uncommitted work, including TODO.md. Local development,
  synthetic tests and coherent local commits are authorized; do not ask for
  approval of routine implementation or local commits. Never push or deploy
  without a new explicit instruction. Do not restart production services, change
  production configuration/student records, or interrupt exams.
  Store generated browser screenshots in per-test output; preserve existing
  documentation images as workspace data.
- Stop for a missing executable only when its required package is missing and
  the instructor must install it. First verify the intended environment, working
  directory and executable path/PATH. Correct a bad path or use the project's
  already-installed executable and continue; a new worktree need not contain its
  own node_modules. Do not install a missing package without authorization.
  A `command not found` string in expected negative-test output, a mock, or a
  synthetic student's malformed/corrupted command is not itself a missing
  dependency. Compare intended and received input and check the intended executable
  read-only. If it exists, preserve the failure and continue diagnosing/fixing the
  test or product. Do not stop the overall task solely on that output string.
- csc-sys is authorized only for the agreed guarded, disposable qualification
  environment. Preserve the host installation and student data. A busy/uncertain
  guard means no test, not permission to clear records or relax the guard.
- Preserve protected submissions/history, original deadlines, account holds,
  credential cleanup and monitoring enforcement. A timeout is not proof of a
  student violation. Never enable an incomplete safety mechanism.
- Ask about consequential policy/architecture choices, not routine details.
  Existing approvals are recorded in TODO.md and the current checkpoint; do not
  ask the same settled question again. Continue independent in-scope work while
  awaiting an answer.

## Deliver outcomes, not an expanding prerequisite tree

- Read TODO.md, design.md and the operational documentation relevant to the
  selected workflow; inspect the implementation before assuming work is missing.
  Use docs/todo-current-checkpoint.md to resume, not the entire historical log.
- Resolve source paths with rg --files before opening them; do not guess filenames
  or expand unchecked shell globs. Keep history/source reads scoped and bounded.
  If discovery does not show the intended file, resolve it in a separate call;
  never append a guessed read to discovery. Check relative paths against the
  command's cwd before launching a runner.
- Read source as plain text, not a JSON-escaped wrapper. Keep paths consistent
  with each command's cwd and patch hunks in file order, one target block per
  file. After a patch fails, inspect current context before retrying it.
  A truncated tool result is unread evidence: reread the relevant missing span
  before relying on it, especially operational safety prerequisites.
  When similar routes share checks, anchor edits to the exact enclosing route
  and verify which callers changed immediately afterward. Do not patch a generic
  authorization condition by its first textual match.
- Read an existing helper's signature, serialized fields and state ownership
  before calling it;
  preserve the complete logical transaction when reusing a fixture, including
  issuance, enrollment and claim. Assert a polled field exists in the producer's
  actual projection; prefer the public response when it owns the required fact.
  When adding mandatory capabilities/operations, inspect shared fixture producers
  as well as scenario mocks and run their public callers before broad qualification.
  Do not infer argument order or invent setter names. Bound individual browser
  actions and use observed accessible roles so a bad locator cannot consume the
  whole workflow timeout. A locator failure is not a product refusal oracle.
  A terminal window can exist while its input is still disabled. Before typing,
  await its verified-open marker, enabled input and focus on the intended stable
  pane; Enter on a still-focused toolbar button is not terminal input.
  When renaming UI text, migrate both positive and negative interface expectations;
  an absent old heading can silently weaken a refusal check. Scope repeated CSS
  classes to their named section rather than choosing the first matching element.
  Before interactive MFA/media acceptance, establish which computer the instructor
  can see and use. A headed browser on the development host is not visible to a
  remote Codex operator. Use an explicitly authorized separate profile on the
  instructor's host and loopback-only SSH transport; preserve personal profiles
  and never request or record passwords/MFA answers.
  First-grant fixtures use a fresh synthetic exam namespace and authored source;
  never clear history or relax source permissions to fit a prepared legacy base.
  Before broad browser qualification, compare synthetic exam/account names across
  the selected files; an isolated focus run can hide reuse of consumed grants.
  Give independent rapid management workflows separate synthetic instructors too:
  limits can be per authenticated actor, not IP/session. Diagnose an HTTP 429
  from its response before treating a later selector timeout as a product defect;
  never reset or relax rate limits to make qualification pass.
  Verify the requested browser fixture mode through public status before testing
  a protocol: real WASM checks require EXAM_BROWSER_SSH=1, not the Node fallback.
  Browser fixtures serve dist/web: rebuild after browser source changes before
  qualification. A test against stale built assets does not verify the edit.
  Typecheck changed test fixtures before broad qualification; the production
  server build excludes them and does not catch their type errors.
  Before a privileged cross-language interface run, read the actual wire producer
  and validate native probe JSON with a typed schema. Do not invent ticket fields,
  cgroup naming formats or object shapes from similarly named internal views.
  For Docker transfers, bind the target image to manifest.json's Config digest and
  rootfs diff IDs; a source engine may display the OCI manifest ID instead.
  Syntax-check generated operation scripts locally. Pass structured parameters;
  do not replace placeholder words across nested source strings. Read a failed
  prerequisite's result before launching a dependent operation, including within
  one orchestration cell.
  Use an exact owned test-runner process and verify its cleanup receipt; wrapper
  process exit alone does not prove a remote disposable guest has stopped.
- Prioritize confirmed correctness/alerting defects and the critical liveness
  workflow. Maintain a short dependency-ordered plan with observable acceptance
  criteria. Distinguish necessary safety dependencies from optional enhancements.
  Use docs/todo-delivery-audit.md to reconcile overlapping checklist items and
  already-implemented capabilities before adding work. Keep production-only gates
  separate from local completion. Do not inflate completed counts or retain an
  unrelated future requirement as a reason to reimplement a working workflow.
- Work on one bounded end-to-end milestone at a time. Name its actual CLI/web/
  student entry point, intended outcome, required tests and stopping boundary
  before editing. Tests must exercise that entry point, not only private helpers.
- Check the intended operator host before selecting runtime dependencies. Offline
  grading uses bwrap and lightweight native resource controls; Docker is explicitly
  rejected for offline grading. This restriction does not apply to the existing
  local application-release image qualification in docs/release-readiness.md.
  Keep those task scopes distinct when reviewing tools. Installing files and
  checking help/syntax alone do not establish that the operator workflow runs on
  its intended host.
- Before adding a new abstraction/helper/prototype, identify its runtime caller
  and integration step in the current milestone. If those are not achievable in
  that milestone, justify and explicitly defer it; do not keep extending an
  unused component chain. A component test is not a delivered workflow.
- If investigation reveals another architectural prerequisite or the milestone
  grows substantially, reassess the scope immediately. Record what is necessary,
  what can be deferred, and the next integrated result. Do not spend repeated
  increments expanding foundations without reporting the lack of integration.
- Every management capability needs a supported, discoverable examctl workflow,
  useful help and actionable errors, consistent with web administration.

## Proportionate verification and honest reporting

- Reproduce each defect and add a meaningful focused regression. During edits,
  run affected unit/interface tests and targeted native races. Fix failures
  before advancing. Use actual isolated interfaces/kernel behavior when required;
  disclose mocked guards and untested privileged boundaries.
  Read the focused test's completion result before launching broad qualification;
  do not batch a broad-suite launch with collecting that still-unknown result.
  End the orchestration script after collecting focused results; review them in
  the model before a separate call launches broad tests, even if the log says OK.
- Do not edit a focused runner's source or tests while that run is active.
  Cached/transformed modules can otherwise mix revisions and invalidate its
  receipt. Freeze the relevant inputs, collect/read completion, then edit or
  launch broad qualification. Run independent checks as separate structured
  commands so a later successful command cannot hide an earlier failure.
- Before broad qualification, review each new durable/intermediate state for
  inspection, cancellation, crash/restart, expiry, stale completion and admission
  bypass. No pending operation may become an indefinite account reservation or
  execution permission. Complete this review before freezing milestone artifacts.
  For absence/no-start receipts, check contradictory durable workspace, submission
  and consumption evidence before the first broad run; a missing canonical row
  alone is not enough. Catching this late requires requalifying native artifacts.
- Read persistence-helper failure semantics before treating a callback as a
  transaction. Native WithState saves mutations even on callback error: validate
  every affected record before applying any batch change, and test refusal plus
  repair/retry through the real entry before broad qualification.
- For independent actor protocols, audit every writer of shared admission/cleanup
  proof. Force benign diagnostic writes and real faults while each readiness,
  reply and acknowledgement handshake is blocked, through the actual entry,
  before the first broad run. An acknowledgement must not invalidate final exec
  release or reviewed control; containment must not wait for a startup notice.
- Run broad application/integration/native-race/build/browser checks at coherent
  milestone boundaries according to affected surfaces and risk. Do not rerun
  unchanged application/browser suites for every private native helper. Record
  why existing evidence still applies; rerun when artifacts/contracts change.
- Integration/browser suites require local TCP/Unix listeners; native resource
  tests also need the owned user-systemd bus/scopes. The restricted sandbox denies
  these even when compilers and focused tests work. Request the tool's local-test
  sandbox escalation at the outset, without asking the instructor to approve
  routine testing. Do not waste a full suite on known-denied listeners. Separate
  permission failures from product regressions and stop only the exact owned test
  runner before retrying; never terminate unrelated processes or services.
- Use `npm test` for application suites so its native-clock pretest runs in the
  current worktree. Direct Vitest is allowed only after explicitly building and
  verifying that worktree's clock addon. A sibling worktree's generated artifacts
  do not supply it. If widespread monitoring/preflight refusals coincide with a
  missing addon, stop only the owned runner, build the existing prerequisite and
  verify a focused real interface before rerunning the broad suite. Never add a
  clock fallback or relax enforcement to make the tests pass.
- Do not weaken acceptance criteria or production enforcement to obtain a pass.
  A failed test fixture must be distinguished from a product defect; retain the
  failure and explain the correction. Never infer new-artifact qualification
  from an older test bundle.
- Verify that a regression's setup actually reaches the intended refusal/state.
  Resolve focused selectors from declared test names; a no-tests receipt is no
  verification. Before extending a long interface fixture, match the real
  producer's serialized schema and define its intended final state. A test of a
  preserved long-lived hold must verify that exact hold, not demand early release
  or weaken the host idle guard to satisfy an unrelated final assertion.
  If a mutation control passes, strengthen its oracle or record the limitation;
  never count it as proof. Prefer direct observable effects over assumptions about
  unavailable workers, incidental timestamps or coalesced filesystem events.
  Bound mock accept, connection and completion waits independently; assert private
  fixture modes/owners and the intended request/reply stage. The runner's default
  timeout is not a refusal oracle. Wait for the exact protocol boundary under test,
  not merely shell output or an incidental timestamp.
  Crash tests must verify the exact signal exit, not merely any failure. A PID
  namespace's init can ignore self-directed SIGKILL; keep a separate reaper as
  PID1 and kill the ordinary worker. Panics/timeouts never qualify process death.
- Put cross-process fault controls in an existing directory visible and writable
  in each actor's actual mount namespace; inspect service hardening first.
  Publish readiness from the service whose readiness is claimed: a helper's
  ProtectHome, mount or capability view can differ. Qualify both healthy and
  unavailable publication in the actual service context; an unavailable-only
  synthetic fixture cannot establish that a healthy service reports correctly. If a
  worker ends before its checkpoint, report its outcome immediately instead of
  hiding it behind the checkpoint wait timeout.
- Report progress in usable outcomes and remaining gaps, not commit/test counts.
  Distinguish investigated, awaiting decision, implemented/tested locally and
  deployed. Proposals and unused helpers do not close a TODO investigation or
  establish that a feature works. Checked-item counts are not effort percentages.
  A progress/ETA request is not a pause: answer promptly in commentary and resume
  the authorized work. Do not end the turn merely to deliver a status report or
  after a validated increment while actionable work remains.
- Keep the current checkpoint concise: current milestone, validated revision,
  verification, open decisions and exact next action. Put detailed evidence in
  the relevant feature document; append historical progress only at meaningful
  boundaries. Avoid duplicating every test receipt throughout the documentation.
- Commit validated coherent increments locally. Before stopping, preserve an
  accurate checkpoint and explain any genuine blocker; do not stop after a plan
  or an isolated helper when actionable integrated work remains.

The process failure and its concrete causes are recorded in
[docs/development-retrospective.md](docs/development-retrospective.md).
