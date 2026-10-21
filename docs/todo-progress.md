# Local TODO implementation record

Updated 2026-10-21 (America/Chicago). This is a local development record, not a
deployment receipt. The instructor's latest October 21 instruction revokes the
earlier conditional csc-sys deployment authorization: **do not deploy, including
at the end of local work.** Provide a rollout/migration/rollback proposal only;
do not execute temporary-agent consolidation. Never interrupt exams, reset clocks
or change production student records. No production cutover has been executed.
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
| C1a: root-agent management foundation | approved C1 | Explicit named authorization/purpose/audience; persistent replay/idempotency across restart; root-machine audit and pinned HTTPS replies; actual examctl/gateway list/show workflows, help/refusals and no native/student mutation | Implemented/tested locally; mutations/full coverage and deployment pending |
| C1b: shared definition configuration | C1a | Shared web/CLI create/update for every definition field, stale/missing revision refusal, partial preservation, durable web/root retry and historical immutability; actual CLI/HTTP/browser/build/native race tests | Implemented/tested locally; not deployed |
| C1c: roster/CSV management parity | C1b | Shared web/CLI list/add/remove/settings, CSV preview/confirm/example/export; same inheritance, sandbox, UID-verification, active-snapshot, stale-preview/idempotency rules; actual CLI/HTTP/browser/race/build tests | Implemented/tested locally: 302 application tests, native race/build/typecheck/vet, 28 browser roster/interface/SSH checks; not deployed |
| C8: definition retirement | C1b + unified grant migration/visibility | Previews, unused-only delete/history archive, no stranded active preparations/unused legacy or unified grants, conflict/retry/browser/native CLI tests | Approved; implementation/qualification pending migration of native-only legacy grants |
| M5: screenshot-first review | baseline | No terminal fetch/play until deliberately opened; screenshot/replay/tab positions survive polling; active/completed browser coverage, no recording/retention change | Implemented/tested locally; not deployed |
| M6: stress, limits and final qualification | M1–M5 | Simultaneous synthetic attempts and failures, documented workload limits; integration/native race/build/browser checks; deployment/migration/rollback plan including all three live agent daemons | Worker/fatal/resource/disk increment tested locally; larger limits, privileged combined qualification and rollout still open |
| M6a: collection process-failure isolation | investigate current native collection; prerequisite to enabling larger limits | Real isolated collection worker death/hang/resource/disk faults leave shared agent/PTYs, healthy monitoring, deadlines and admissions unaffected; durable protected publication/restart and native race/integration checks | Native worker/short-transaction implementation and fatal-child, actual user-systemd OOM/runtime, permission/user-namespace ENOSPC/read-only regressions pass locally; privileged SSH/PTY/workload gates remain open |
| D1: unified attempt grants/workspaces | M0 + instructor decision | Explicit grant policy, source/version freezing, monitoring/start window, 90-minute second attempt, callback/migration/idempotency acceptance cases | C1/C2/C5/C7 approved; implementation, migration, safe source-recovery and crash/race investigation remain open |
| D1a: isolated private preflight staging | M6a + approved C2/C7 | No clock/marker consumption or exposure before Begin; exact source/owner receipt; bounded copy/restore; crash/retry, cancellation/UID/Begin fences and explicit no-reopen repair; native race, SSH/HTTP/browser/build | Implemented/tested locally: 304 app tests, all three Go-module race checks, native resource opt-ins, static build/vet/typecheck/build and 28 browser/SSH checks; unified grants/privileged qualification/deployment remain open |
| D1b: legacy source dependency safety | D1a + preservation policy | Supported read-only native catalog; refuse unused/uncertain/unfinished source deletion; serialize consumption/deletion; preserve all markers/child submissions/history; actual CLI, malformed catalogs/worker replies and race/resource checks | Implemented/tested locally: full native race with worker/systemd/user-namespace/CLI opt-ins, static build/vet and actual root-mapped CLI; migration/C8/privileged deployment gates remain open |
| D2: retained SSH during lockouts | M0 + instructor decision | Writer freeze strategy, shell/buffer survival, native containment and ownership/loss cleanup agreed; current fresh-auth policy remains until coherent implementation/test | C3 approved; verified-freeze implementation and containment/liveness qualification remain open |
| D3: workspace retention and collection limits | M0 + instructor decision | Agree grace/holds/eligibility, CLI dry-run/cleanup and workload limits before deletion/limit policy changes | C4/C6 approved; C6 shared setting/snapshot/collector/restore implementation and default-size local worker test pass, full regression in progress; manual cleanup and privileged/concurrent sizing remain open |

Each implemented milestone gets documentation, focused regressions, proportional
integration/build/race/browser checks, then a coherent local commit. Never label
an investigation finished solely because a proposal exists. TODO checkboxes only
mean implemented and tested locally when explicitly qualified; deployed status is
separate and remains **not deployed** throughout this work.

## Current native increment (October 21)

C6 limits increment after local commit 1874c65 (D1b) now implements explicit
128 MiB/file and 512 MiB total new defaults, shared web/CLI validation, frozen
native snapshots and compatible legacy 32/64 MiB interpretation. No historical
attempt/clock is migrated. Collector/verifier/private starter/saved restore agree;
directory enumeration is bounded before allocation. Defensive nil refusal is
paired with a repaired unsafe-archive fixture so tests still exercise traversal.
The native capability and production gateway admission require matching versions.
Full application suite passes: 306 tests/53 files; typecheck and 40 definition/
admin/seven-timezone browser checks pass. Exact/exceeded logical limits, source/
target mismatch without consumption or false corruption, immutable legacy
settings encoding, historical holds/clocks and custom sandbox limits are covered.

The real 512 MiB high-entropy disk-backed collection/restore passes under unchanged
256 MiB/no-swap/32-task/120-second user-systemd workers: observed collection
15.57s, 27 concurrent healthy signed renewals; restore 19 renewals; maximum
acknowledgement 1.129s, unchanged healthy generation/deadline, exact file hashes,
536,915,257-byte archive and no target interval/legacy-marker consumption. Live
MemoryPeak samples reached 268,435,456 bytes in both workers without OOM. This
includes reclaimable disk page cache and is not unlimited memory/capacity proof.
Two earlier tmpfs runs actually OOM-killed only the worker at that bound; new
production admission refuses known tmpfs/ramfs State/Work storage with preserve/
drained-migration guidance. No existing data is moved/deleted. A slow-renewal test
first included unflushed fixture creation; flushing setup before measurement
corrected that contamination. Test-only RemainAfterExit instrumentation blocked
systemd-run --wait; removed, using live peak samples instead. Do not present those
failed test runs as successful qualification. Separate blocked-lock tests retain
sub-second bounds; the real I/O test requires renewals below three seconds versus
the 15-second execution lease. Full native race/resource/compiler/default-size,
build/vet/static pass. All three Go-module race checks pass; the full native
suite with actual worker/systemd/user-namespace/CLI/compiler/default-size opt-ins
passes in 109.5s. Application/WASM build passes (existing large-bundle warning).
All 28 browser interface/real synthetic SSH checks pass (3.8m), in addition to
the 40 definition/admin/timezone checks. Final capability regression also rejects
an otherwise-ready agent missing only collection-limits-v1. Generated screenshots
are restored, not product edits. This C6 setting/compatibility/default-size
increment is implemented/tested locally; Full
privileged SSH/PAM/PTYS and simultaneous worst-case capacity remain open. See
collection-limits.md. No deployment and no command-not-found.

D1a is local commit b70ff78: private staging now precedes Begin.
Full native race suite with opt-ins passes, including actual child death and
resource/runtime failure/retry. Focused tests cover source immutability/metadata,
cancellation/owner/settings/expiry, signed Begin freshness, UID admission fencing
and no-reopen publication repair. Actual synthetic SSH/gateway regressions cover
lost staging replies and replaced-page Begin. All 304 app tests/52 files pass;
the first full run caught an outdated readiness fixture, corrected with a new
old-agent fail-closed assertion before rerunning. Static build/vet/typecheck and
application build pass. All 28 browser/interface/real synthetic SSH checks pass
(3.6m), including required staging in the fixture before Begin. Final native race
suite with opt-ins passes again after corrupt-source and healthy signed-monitoring
resource regressions. All three Go-module race checks pass. Generated screenshots
were restored to baseline, not committed as product changes. See
private-workspace-staging.md. Unified grants, legacy migration/source dependency
fences, raised limits, retained SSH and complete management remain actionable.
Nothing deployed; no command-not-found has occurred.

D1b in progress: confirmed native source-deletion dependency gap now has bounded
read-only `recovery-grants` inspection and isolated deletion checks. Unused,
uncertain and unfinished saved-work dependencies refuse; completed consumed
history remains immutable and does not force retaining sources forever. Actual
staging/Begin/collection/deletion, child/source/history preservation, malformed/
unsafe/uncertain metadata, worker-protocol refusal and catalog/Begin locks pass
focused regressions. The real root-mapped CLI lists/filters without state writes
and gives actionable held-source refusal. Full native race/resource/CLI suite
passes (35.5s), as do CGO-free build/vet and diff checks. Application/browser
evidence is unchanged from b70ff78; this increment changes no web/Node behavior.
Existing manual root issuers must be quiesced; catalog inspection
does not complete unified authority/migration or enable C8 retirement. See
legacy-recovery-dependencies.md. No production changes.

C8/deployment scope recorded in local commit 807d3af. M6a now implements separate
bounded OS workers, persistent per-attempt/slot locks, short fenced protection/
completion commits and isolated manifest/export/access verification. Healthy
signed renewals/admissions/registration and ordinary state inspection remain
available during fatal/hung collection. Real child panic/exit/SIGKILL, malformed
replies, address-space/file limits, publication-before-state and protected-before-
cleanup death/retry pass. Actual local user-systemd OOM/runtime and isolated tmpfs
ENOSPC/read-only plus unprivileged permission faults pass; source/holds survive
and retry completes. One failed cutoff no longer suppresses other collections.
See collection-worker-isolation.md for architecture, commands and honest limits.

Full native race suite with both opt-ins passes; application 296/50 unit/integration
tests, typecheck/build, native CGO-free build/vet and other Go-module race checks
pass. All 52 Chromium admin/interface/real synthetic SSH-cleanup tests pass (5.1m);
generated screenshots were restored to their clean baseline. No missing command
has occurred. User-systemd and user namespaces are available; local Docker daemon
is absent and sudo requires a password. Do not infer installed root/PAM/real PTY
qualification from test writer hooks. Continue approved independent work while
privileged qualification remains a rollout gate. No production contact/cutover,
workspace deletion, archive limit increase or service consolidation has occurred.

Local commit 2891567 records that worker increment. C1a now adds default-deny
named root-agent HTTPS management, purpose/audience/freshness, persistent request/
nonce records (migration 013), machine-root audit and pinned signed responses.
`examctl web exams list/show` is tested through the actual compiled CLI and real
gateway via isolated local TLS, including restart-safe same-ID retry, refreshed
reads and authorization revocation. No native state or student attempt is created.
All 300 application tests / 51 files pass with the namespace interface opt-in;
full native race checks pass with worker/systemd/user-namespace/CLI opt-ins,
plus build/typecheck/vet/static build. See agent-management.md. This is a read-only
foundation, not full management. Browser 52/52 evidence above is the preceding
worker milestone; no new browser UI changed in C1a. Continue shared definition
mutations/retirement and remaining approved increments; no production contact.

C1a is local commit 6cd9a1e. C1b: a shared definition reader/writer replaces
browser upsert. Flag-driven `web exams create/update` supports every current
definition field, explicit RFC3339 windows, conditional revision and partial
patches that preserve omitted settings. Browser forms retain request IDs on lost
replies; migration 014 stores successful browser definition intents. Historical
attempt settings/deadlines/holds are not changed. All 301 application tests / 51
files pass with actual compiled CLI/gateway TLS create/update/restart coverage;
all 40 browser retry/conflict, admin and seven-timezone checks pass, as do full
native race checks with opt-ins, build/typecheck/vet/static build. No production
deployment is implied; see exam-definition-management.md.
Local commit f208a4c records C1b. Next: extract roster/CSV services without
weakening unresolved UID=0 (only trusted student SSH resolves identity), explicit
inheritance, sandbox duration, preview conflict/consumption and history/snapshot
preservation. Parse large CSV outside management SQLite transactions; do not
introduce a generic admin-route proxy. Further clock/review/alert/monitoring/admin/
template/config workflows remain in the coverage inventory. Do not persist fast
plaintext-password fingerprints when later adding administrator credential
operations; design their secret handling before implementation.

C1c: RosterManagement now owns web/root roster/CSV operations;
`web students` exposes every current workflow with inheritance/minute units,
named removal confirmation, bounded file/stdin preview, confirm, pagination and
exclusive private CSV outputs. Pure async CSV parsing runs outside SQLite; the
management transaction repeats authorization/freshness before publication.
Request/reply bounds now cover the existing 10 MiB import workflow (12 MiB signed
requests, 16 MiB reply envelopes). Already-consumed previews confirm idempotently
even after expiry; unused expired previews still refuse. Root validation receipts
omit raw invalid-username values while preserving row/reason; browser diagnostics
remain compatible. Actual compiled CLI/gateway tests cover all roster operations,
verified UID preservation/no trust in caller-supplied UIDs, active snapshots, stale imports,
atomic failed batches, safe outputs and restart/idempotency. All 302/51 application
tests pass and native race/build/typecheck/vet pass; all 28 browser roster/
interface/SSH-cleanup checks pass. Generated screenshots were restored. See
roster-cli.md; no production changes occurred.
Source review found legacy recovery grants only in root native JSON, invisible
to a gateway-only archive check. Complete their unified migration/visibility
before claiming C8 can retire definitions without stranding unused grants.

Deployment access check: only non-mutating SSH service-status inspection was
attempted. The configured csc-sys jump route timed out during banner exchange;
one direct-route attempt also timed out on port 22. No authenticated remote
session, service/configuration change or student-record access occurred. Local
SSH config was inspected without printing key/proxy-command contents. Do not
claim deployment access verified, change host-key policy or repeatedly retry
credentials. Continue independent local work; a functioning route is a rollout
prerequisite. Browser assets must finish building before starting the static
test server: the first C1b run's two new tests saw an old bundle; both pass with
a fresh server/current build, and the full 40-test group passes.

## Decision log

Approved C1 (October 20): root-run examctl on the class server reuses existing
agent authentication for outbound management, with explicit authorization and
auditing. This replaces the earlier browser-session recommendation. It is not
fully implemented or deployed yet; the later C1a entry records the tested read-only
foundation. Human attribution is not inferred from a root/agent
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

Approved C8 (October 21): delete only unused exam definitions; archive definitions
with history while preserving attempts/submissions and distinct retention rules.
All eight choices are approved and implementation is resumed. See
todo-design-decisions.md. Actual workload/storage, source-recovery
and privileged crash qualification remain open; approval is not implementation/
test evidence.

Implementation order update: investigate/isolate native collection failure before
enabling higher collection ceilings. CLI authentication/shared management work can
proceed independently; larger workloads must not amplify the unresolved crash/
shared-lock failure domain. Current implementation order: M6a process-isolated
collection/short transactions; C6 compatible limits and C4 manual cleanup; C1
shared authenticated management; C2/C5/C7 grants/private initialization and C8
retirement; C3 coordinated retained SSH/UI; full qualification and safe rollout.

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
are now approved as recorded above, as are C5–C8; implementation/investigation
remain open.
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
implementation now has C1–C8 approval, recorded in
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
