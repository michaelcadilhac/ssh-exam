# Local TODO implementation record

Updated 2026-10-20 (America/Chicago). This is a local development record, not a
deployment receipt. Production deferrals in TODO.md remain in force. Do not run
production commands, change student data, restart services, or interrupt exams.
Stop immediately if a command is not found. Preserve unrelated changes.

## Baseline and method

The working tree was clean when work resumed. TODO.md and design.md have been
read, along with the recovery, native cleanup incident, deployment and operator
guidance. No applicable AGENTS.md was found. Implementation inspection confirms
that alert coalescing, the deadline/renewal race, NULL-contact housekeeping,
recovery metadata restoration and CLI discoverability still need work.

Local baseline: typecheck/build pass, 278 unit/integration tests pass, race tests
pass in all three Go modules, and 28 selected Chromium tests pass. Tests use
synthetic local fixtures only. Loopback and dependency downloads require sandbox
escalation. Generated screenshot changes must not become product changes.

## Dependency-ordered milestones

| Milestone | Dependencies | Acceptance criteria and required verification | Status |
| --- | --- | --- | --- |
| M0: inventory and proposals | baseline | Map web/native/incident operations to CLI; map attempt/initialization/lock boundaries; present decisions with migration and acceptance cases | Investigating |
| M1: durable alert episodes and notification correctness | baseline | Distinct attempts/causes never merge; unchanged failures deduplicate after delivery/retry/restart; resolution/recurrence work; review requests remain audited; editor lock-only omissions are silent; actionable status/context. Regression and SMTP integration tests, typecheck/build | Core implemented/tested locally; C1 approved, explicit CLI reminder implementation pending |
| M2: renewal races and preparation housekeeping | M1 | Normal expiry has no new interruption; intentional actions survive delayed renewal results; stale replies cannot affect replacement ownership; never-contacted reservations do not generate cleanup; uncertain committed starts retained. Real WS/callback regressions and full integration suite | Implemented/tested locally; not deployed |
| M3: recovery restoration correctness | M0 source review | Preserve archived ordinary modes and mtimes safely; document absent metadata; test restrictive umask, nested files, make, failure/crash fences and other healthy attempts. Native race suite/build | Metadata and publication restart fences tested locally; full crash repair investigation open |
| M4: supported CLI workflows | M0 authority proposal | Ship coherent help/error improvements now; add full web-owned management only after authority/authentication decision. Exercise actual CLI help, refusals, local recovery and idempotency; native race/build and HTTP tests | Existing native help/refusals/export tested locally; C1 approved, implementation pending and grant policy awaits C2 |
| M5: screenshot-first review | baseline | No terminal fetch/play until deliberately opened; screenshot/replay/tab positions survive polling; active/completed browser coverage, no recording/retention change | Implemented/tested locally; not deployed |
| M6: stress, limits and final qualification | M1–M5 | Simultaneous synthetic attempts and failures, documented workload limits; integration/native race/build/browser checks; deployment/migration/rollback plan including all three live agent daemons | Local concurrency/load/compiler checks pass; broader privileged qualification and policy decisions remain open |
| D1: unified attempt grants/workspaces | M0 + instructor decision | Explicit grant policy, source/version freezing, monitoring/start window, 90-minute second attempt, callback/migration/idempotency acceptance cases | C1 approved; concrete grant proposal/C2 pending, investigation open |
| D2: retained SSH during lockouts | M0 + instructor decision | Writer freeze strategy, shell/buffer survival, native containment and ownership/loss cleanup agreed; current fresh-auth policy remains until coherent implementation/test | Concrete proposal presented; C3 pending, investigation open |
| D3: workspace retention and collection limits | M0 + instructor decision | Agree grace/holds/eligibility, CLI dry-run/cleanup and workload limits before deletion/limit policy changes | Concrete proposal and compiler measurements presented; C4 and workload-limit choice pending |

Each implemented milestone gets documentation, focused regressions, proportional
integration/build/race/browser checks, then a coherent local commit. Never label
an investigation finished solely because a proposal exists. TODO checkboxes only
mean implemented and tested locally when explicitly qualified; deployed status is
separate and remains **not deployed** throughout this work.

## Decision log

Approved C1 (October 20): root-run examctl on the class server reuses existing
agent authentication for outbound management, with explicit authorization and
auditing. This replaces the earlier browser-session recommendation. It is not
implemented or deployed yet; human attribution is not inferred from a root/agent
signature. See todo-design-decisions.md for required shared validation and replay/
idempotency/conflict safeguards. Local commits remain authorized without further
approval requests.

Pending investigation/decisions: grant snapshot/default policy and start window;
freeze-only versus terminate-workload retained transport; workspace grace/holds;
collection size settings versus measured compiler/debugger workload.

## Verification and commits

M1 local evidence: all 282 unit/integration tests pass (48 files), including
real local SMTP rejection/retry across application restart, duplicate review
requests, fourteen repeated secured-submission failure callbacks, omission
filtering, distinct causes/students/generations and resolution/recurrence.
Typecheck and application/WASM build pass. The earlier targeted run caught a
legacy pending-report dedup regression; fixed before the full passing run.
Migration 012 is additive. See alert-episodes.md for SMTP's acceptance/commit
boundary and the explicit reminder capability still pending C1.

M0 source map and concrete proposals are in todo-design-decisions.md. Four
questions (C1–C4) were initially presented without assuming approval. C1 is now
approved as recorded above; other choices and investigation remain open. No
production access or deployment performed. Verification entries below describe
the decisions and implementation state at their original milestones.

Local commit f9f2232 records M1 and the plan/proposals. M2 evidence: 294 tests
pass (50 files); typecheck/build and full native race suite pass. Real SSH →
worker IPC → monitoring WS regressions cover deadline, administrator pause/finish
and genuine failure. Additional fences cover seven owner/revision changes; native
tests cover authenticated rejection state and refused started cancellation.
Housekeeping tests cover restart and uncertain activation. See
renewal-cleanup-correctness.md for mixed-version rollout/rollback behavior.

Local commit a6eecf5 records M2. M3 metadata/restart regressions pass in the full
native race suite. Recovery preserves available regular-file metadata under 0077
umask; real make/PAX/legacy tests and unchanged-source checks pass. Publication
restart fences preserve clocks, consumption and later student edits. The larger
initialization/repair transaction and every-boundary process-death/ENOSPC tests
remain explicitly incomplete, pending C1/C2. See recovery-metadata.md.

Local commit 09880d7 records M3. M4 native race suite passes, including real CLI
subprocess help/usage checks for all current commands and immutable, durably
audited protected exports with audit-write failure. Full web-owned management,
explicit alert escalation and recovery grant/repair workflows remain C1/C2
dependent; no claim of complete CLI coverage is made.

Local commit a3f87df records M4. M5 typecheck/build and 52 Chromium checks pass
(admin redesign, real browser SSH interface and SSH cleanup suites). Tests cover
active/completed screenshot-first review, zero unrequested replay reads, tab/pane/
slider retention, close/reopen, incremental refresh and network recovery. Generated
documentation screenshots are excluded from the implementation commit. See
review-on-demand.md; no recording/retention/security policy changed.

Local commit 97a2c6c records M5. M6 adds a 16-attempt native concurrency regression
with real protected archive IO, blocked/refused termination, independent renewal/
cutoff and delayed signed TLS callbacks. Full native race checks and opt-in real
GCC workload measurements pass. The corrected local load harness passes with 16
ACTIVE synthetic students, 64 panes, 89 heartbeat acknowledgements, zero pending
and zero errors. It now exits unsuccessfully on missing admissions/acknowledgements;
the first run exposed a stale fixture rather than a production identity bug.
See todo-local-qualification.md for exact observations and remaining shared-lock/
privileged qualification gaps. todo-rollout-plan.md proposes additive migration,
controlled verification, all-three-daemon consolidation and compatible rollback;
none has been executed.

Final M1 follow-up: policy/access alert context now uses current authenticated
state and distinguishes reported from gateway-verified protection. Preflight,
worker and host-key diagnostics have observed timezone/identity and safe next
steps; untrusted reasons are quoted. New signed HTTP and real SSH regressions
pass. One focused test initially mislabeled a reported hostname as a host role;
the label/assertion were corrected, then all 296 tests in 50 files passed.
Final typecheck, gateway/WASM build, native static build/vet, three-module race
checks and the separate compiler measurement pass. The 52-test browser result
covers the unchanged final review implementation. No command was found missing.

Checkpoint: further unified-grant/full management/retained-SSH/cleanup policy
implementation now has C1 approval; other policy choices remain pending in
todo-design-decisions.md. Shared-lock isolation,
every-boundary recovery repair and actual course workload sizing remain open;
proposals and synthetic measurements are not completion evidence for them.

## Proposed rollout boundary

Separate instructor authorization and a verified maintenance/drain window are
required. Back up current authoritative state, timing requests, per-UID policy
journals, signed event/nonce state, recovery grants/consumption markers, protected
archives and receipts. Do not roll back by restoring old state over new work.
Consolidate the canonical agent plus exam-agent-live-upgrade and
exam-agent-deferred-recovery only after active attempts, actual preflights,
pending timing and collection/access recovery drain. Preserve the independent
watchdog/reconciler; verify socket ownership, callbacks, capabilities and boot.
Detailed rollout/rollback instructions will follow the validated local changes.
