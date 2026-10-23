# Development instructions

## Authority and safety

- Preserve existing uncommitted work, including TODO.md. Local development,
  synthetic tests and coherent local commits are authorized; do not ask for
  approval of routine implementation or local commits. Never push or deploy
  without a new explicit instruction. Do not restart production services, change
  production configuration/student records, or interrupt exams.
- Stop immediately if an executable/command is not found. Do not silently install
  it or substitute another command to continue the task.
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
- Read source as plain text, not a JSON-escaped wrapper. Keep paths consistent
  with each command's cwd and patch hunks in file order, one target block per
  file. After a patch fails, inspect current context before retrying it.
  A truncated tool result is unread evidence: reread the relevant missing span
  before relying on it, especially operational safety prerequisites.
- Read an existing helper's signature and state ownership before calling it;
  do not infer argument order or invent setter names. Bound individual browser
  actions and use observed accessible roles so a bad locator cannot consume the
  whole workflow timeout. A locator failure is not a product refusal oracle.
- Prioritize confirmed correctness/alerting defects and the critical liveness
  workflow. Maintain a short dependency-ordered plan with observable acceptance
  criteria. Distinguish necessary safety dependencies from optional enhancements.
- Work on one bounded end-to-end milestone at a time. Name its actual CLI/web/
  student entry point, intended outcome, required tests and stopping boundary
  before editing. Tests must exercise that entry point, not only private helpers.
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
- Before broad qualification, review each new durable/intermediate state for
  inspection, cancellation, crash/restart, expiry, stale completion and admission
  bypass. No pending operation may become an indefinite account reservation or
  execution permission. Complete this review before freezing milestone artifacts.
  For absence/no-start receipts, check contradictory durable workspace, submission
  and consumption evidence before the first broad run; a missing canonical row
  alone is not enough. Catching this late requires requalifying native artifacts.
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
- Do not weaken acceptance criteria or production enforcement to obtain a pass.
  A failed test fixture must be distinguished from a product defect; retain the
  failure and explain the correction. Never infer new-artifact qualification
  from an older test bundle.
- Verify that a regression's setup actually reaches the intended refusal/state.
  If a mutation control passes, strengthen its oracle or record the limitation;
  never count it as proof. Prefer direct observable effects over assumptions about
  unavailable workers, incidental timestamps or coalesced filesystem events.
  Bound mock accept, connection and completion waits independently; assert private
  fixture modes/owners and the intended request/reply stage. The runner's default
  timeout is not a refusal oracle. Wait for the exact protocol boundary under test,
  not merely shell output or an incidental timestamp.
- Report progress in usable outcomes and remaining gaps, not commit/test counts.
  Distinguish investigated, awaiting decision, implemented/tested locally and
  deployed. Proposals and unused helpers do not close a TODO investigation or
  establish that a feature works. Checked-item counts are not effort percentages.
- Keep the current checkpoint concise: current milestone, validated revision,
  verification, open decisions and exact next action. Put detailed evidence in
  the relevant feature document; append historical progress only at meaningful
  boundaries. Avoid duplicating every test receipt throughout the documentation.
- Commit validated coherent increments locally. Before stopping, preserve an
  accurate checkpoint and explain any genuine blocker; do not stop after a plan
  or an isolated helper when actionable integrated work remains.

The process failure and its concrete causes are recorded in
[docs/development-retrospective.md](docs/development-retrospective.md).
