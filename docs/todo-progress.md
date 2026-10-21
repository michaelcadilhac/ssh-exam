# Local TODO implementation record

Updated 2026-10-21 (America/Chicago). This is a local development record, not a
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
| M4: supported CLI workflows | M0 authority proposal | Ship coherent help/error improvements now; add full web-owned management only after authority/authentication decision. Exercise actual CLI help, refusals, local recovery and idempotency; native race/build and HTTP tests | Existing native help/refusals/export tested locally; C1/C2 approved, management/grant implementation and qualification pending |
| M5: screenshot-first review | baseline | No terminal fetch/play until deliberately opened; screenshot/replay/tab positions survive polling; active/completed browser coverage, no recording/retention change | Implemented/tested locally; not deployed |
| M6: stress, limits and final qualification | M1–M5 | Simultaneous synthetic attempts and failures, documented workload limits; integration/native race/build/browser checks; deployment/migration/rollback plan including all three live agent daemons | Earlier synthetic checks pass; C6 now requires collection OS-worker crash isolation and real fatal/hung-job multi-attempt qualification, not yet implemented |
| M6a: collection process-failure isolation | investigate current native collection; prerequisite to enabling larger limits | Real isolated collection worker death/hang/resource/disk faults leave shared agent/PTYs, healthy monitoring, deadlines and admissions unaffected; durable protected publication/restart and native race/integration checks | Approved C6 requirement; next native correctness priority, not implemented |
| D1: unified attempt grants/workspaces | M0 + instructor decision | Explicit grant policy, source/version freezing, monitoring/start window, 90-minute second attempt, callback/migration/idempotency acceptance cases | C1/C2/C5/C7 approved; implementation, migration, safe source-recovery and crash/race investigation remain open |
| D2: retained SSH during lockouts | M0 + instructor decision | Writer freeze strategy, shell/buffer survival, native containment and ownership/loss cleanup agreed; current fresh-auth policy remains until coherent implementation/test | C3 approved; verified-freeze implementation and containment/liveness qualification remain open |
| D3: workspace retention and collection limits | M0 + instructor decision | Agree grace/holds/eligibility, CLI dry-run/cleanup and workload limits before deletion/limit policy changes | C4/C6 approved: manual cleanup/no grace and configurable 128/512 MiB defaults with crash isolation; implementation/qualification remain open |

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

Approved C2 (October 20): unified grants with settings fixed at issuance and
explicit audited revisions for unused grants. Stage verified sources privately
before Begin, consume once with the new committed interval, preserve default
single-attempt policy/history/holds, and safely fence revisions against preparation
and Begin. This is an approved design, not implementation/migration/deployment.
Webcam/start-window policy is approved separately in C5; C7 selects explicit new
attempts for crash recovery rather than automatic refunds/old-attempt reopening.

Approved C3 (October 21): retain authenticated SSH and preserve shells/editor
buffers through a verified workload freeze during policy lockouts. Input/channels/
background writes remain forbidden; only current readiness and valid scoped
continuation authorization permit thaw. Keep the running clock, independent
deadline collection, focus grace and credential cleanup. Separate locked-page
liveness from execution permission; actual ownership/transport loss may require
fresh SSH. Failed freeze stays fail closed. This is not implemented or deployed.

Approved C4 (October 21): manual workspace cleanup with no grace period; no
automatic deletion. Retain verification, writer/mount/use/dependency checks,
explicit holds, dry-run, exact-target concurrency fences and audit. Preserve all
protected submissions/history/grants, account restrictions/deadlines and separate
monitoring retention. The earlier 14-day recommendation is superseded. No cleanup
has been implemented or performed.

Approved C5 (October 21): new grants preserve the student's current effective
webcam requirement unless explicitly overridden, and require an explicit finite
Begin window fixed at issuance. An extra-attempt window may be outside the exam's
default window; do not intersect windows or reopen ordinary admissions. All
admission/Begin layers must honor the selected grant, while preserving account
holds. Latest Begin is not latest finish and does not shorten a started interval.
No existing production windows, webcam snapshots or records were changed.
Implementation/migration and interface/native regressions remain outstanding.

Approved C6 (October 21): configurable per-exam collection defaults of 128 MiB/file
and 512 MiB total, retaining 10,000 entries/depth 32. Explicit mandatory acceptance:
a collection crash/hang must not crash the shared agent, disrupt healthy PTY/SSH
ownership or lock out other students. Implement supervised bounded per-attempt OS
workers and short fenced state commits; preserve independent renewals/cutoff and
all writer/protection/access checks. Test actual fatal worker/resource/disk/hang
failures with another active attempt and admission/reconnect, not only returned
errors. The instructor's reported earlier crash is recorded as motivation, not an
unverified diagnosis. Code/limits are not changed or deployed by this approval.

Approved C7 (October 21): outage recovery uses explicitly authorized new attempts
from verified saved work, with an instructor-chosen allowance. No automatic
refunds or reopening completed attempts. Secure old saved work first if collection
failed; otherwise use the existing immutable protected snapshot. Copy into a
separate workspace, preserve all original history/markers and prior account holds,
and start the new allowance only at Begin. Existing ordinary manual clock controls
remain available but are not a separate crash repair/refund system. Technical
source recovery still needs implementation and failure tests; no records changed.

Only C8 exam-definition archival/deletion remains undecided among the eight
questions. See todo-design-decisions.md. Actual workload/storage, source-recovery
and privileged crash qualification remain open; approval is not implementation/
test evidence.

Implementation order update: investigate/isolate native collection failure before
enabling higher collection ceilings. CLI authentication/shared management work can
proceed independently; larger workloads must not amplify the unresolved crash/
shared-lock failure domain. The current discussion records decisions only.

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
questions (C1–C4) were initially presented without assuming approval. All four
are now approved as recorded above, as are C5–C7; C8 and investigation remain open.
No production access or deployment performed. Verification entries below describe
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
implementation now has C1–C7 approval; C8 remains pending in
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
