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
| M1: durable alert episodes and notification correctness | baseline | Distinct attempts/causes never merge; unchanged failures deduplicate after delivery/retry/restart; resolution/recurrence work; review requests remain audited; editor lock-only omissions are silent; actionable status/context. Regression and SMTP integration tests, typecheck/build | Core implemented/tested locally; explicit CLI reminder awaits C1 |
| M2: renewal races and preparation housekeeping | M1 | Normal expiry has no new interruption; intentional actions survive delayed renewal results; stale replies cannot affect replacement ownership; never-contacted reservations do not generate cleanup; uncertain committed starts retained. Real WS/callback regressions and full integration suite | Implemented/tested locally; not deployed |
| M3: recovery restoration correctness | M0 source review | Preserve archived ordinary modes and mtimes safely; document absent metadata; test restrictive umask, nested files, make, failure/crash fences and other healthy attempts. Native race suite/build | Pending |
| M4: supported CLI workflows | M0 authority proposal | Ship coherent help/error improvements now; add full web-owned management only after authority/authentication decision. Exercise actual CLI help, refusals, local recovery and idempotency; native race/build and HTTP tests | Pending / design-dependent |
| M5: screenshot-first review | baseline | No terminal fetch/play until deliberately opened; screenshot/replay/tab positions survive polling; active/completed browser coverage, no recording/retention change | Pending |
| M6: stress, limits and final qualification | M1–M5 | Simultaneous synthetic attempts and failures, documented workload limits; integration/native race/build/browser checks; deployment/migration/rollback plan including all three live agent daemons | Pending |
| D1: unified attempt grants/workspaces | M0 + instructor decision | Explicit grant policy, source/version freezing, monitoring/start window, 90-minute second attempt, callback/migration/idempotency acceptance cases | Await proposal and decision; no implementation authorized yet |
| D2: retained SSH during lockouts | M0 + instructor decision | Writer freeze strategy, shell/buffer survival, native containment and ownership/loss cleanup agreed; current fresh-auth policy remains until coherent implementation/test | Await proposal and decision |
| D3: workspace retention and collection limits | M0 + instructor decision | Agree grace/holds/eligibility, CLI dry-run/cleanup and workload limits before deletion/limit policy changes | Await proposal and decision |

Each implemented milestone gets documentation, focused regressions, proportional
integration/build/race/browser checks, then a coherent local commit. Never label
an investigation finished solely because a proposal exists. TODO checkboxes only
mean implemented and tested locally when explicitly qualified; deployed status is
separate and remains **not deployed** throughout this work.

## Decision log

Pending investigation: authenticated examctl access to web-owned state without a
new webserver-to-agent API; grant snapshot/default policy and start window;
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
questions (C1–C4) have been presented; none is assumed approved. Investigation
remains open. No production access or deployment performed.

Local commit f9f2232 records M1 and the plan/proposals. M2 evidence: 294 tests
pass (50 files); typecheck/build and full native race suite pass. Real SSH →
worker IPC → monitoring WS regressions cover deadline, administrator pause/finish
and genuine failure. Additional fences cover seven owner/revision changes; native
tests cover authenticated rejection state and refused started cancellation.
Housekeeping tests cover restart and uncertain activation. See
renewal-cleanup-correctness.md for mixed-version rollout/rollback behavior.

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
