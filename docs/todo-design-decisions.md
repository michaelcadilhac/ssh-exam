# TODO architecture investigation and decisions

Updated 2026-10-21, local source inspection and instructor decisions. **C1–C8 are
approved for local implementation. The instructor subsequently revoked the
conditional deployment authorization: do not deploy or execute service
consolidation at the end of this work. Nothing here is a deployment receipt.**
The instructor also approved the technical-only automatic recovery policy below.
Investigation remains open until decisions
and acceptance evidence exist.

## Present boundaries and CLI coverage

The gateway owns exams, enrollment, pending clock intents, continuation grants,
monitoring and the outbox. Native root state owns committed intervals, admission,
workspaces, protected archives, policy restoration and the recovery JSON grants.
Signed commands travel over student SSH; signed callbacks/timing checks travel
outbound to the gateway. Keep this architecture. Local examctl now supports
signed definition list/show/create/update; retirement/full coverage remain pending.

| Supported operation / setting | Present interface | CLI status and proposed workflow |
| --- | --- | --- |
| Exam ID/name/template, start window, future duration/webcam/terminal/collection limits | Shared ExamDefinitions web/root service | Local list/show/create/update with all setting flags, revisions, stable partial updates and durable retry; tested, not deployed |
| Exam definition deletion | Neither interface has a supported workflow | Missing; add explicit `exams delete` only after dependency/hold/history policy; never alias submission deletion |
| Single enrollment, removal, future duration/webcam | Shared RosterManagement web/root service | Local `web students list/add/remove/settings`, same inheritance/UID trust/sandbox and atomic batch rules; tested, not deployed |
| CSV preview/confirm/export/example | Shared RosterManagement web/root service | Local `web students import-preview/import-confirm/export/example`; retain active snapshots, stale-preview/consumption checks and safe output; tested, not deployed |
| Dashboard/filter/history/working status | Bounded gateway metadata and native info | Local `web attempts list/show` exposes frozen settings, presence and pending clocks without page/session/monitoring text; tested, not deployed |
| Reset current clock / add minutes, individual/bulk | Shared ClockControl/ClockManagement web/root services | Local `web clocks show/preview/reset/extend/reset-default/add`, reviewed amount/revision, stable child requests, partial status and no native wait in SQLite; 313 app tests, actual CLI/TLS and 74 browser checks pass, not deployed |
| Review interruption / authorize continuation | Shared InterruptionManagement browser/root service | Local `web interruptions show/review/authorize`, generation plus conditional monotonic review counter, audited reason/intent, original expiry and retention-safe transient private reads; 320 app/81 combined browser checks, actual CLI/TLS and native race pass, not deployed |
| Finish/pause/cancel/retry one attempt | Native admin operations | Existing `stop/finish/pause/cancel/retry`; improve help and state guidance |
| Inspect/close one pane and revoke its queued admission | Shared exact-target native student/root helper, unique unit incarnations and checked audit | Local `panes list/show/close` includes no-write bounded observation, scoped reviewed revision, root/machine audit before control, unknown/startup/legacy refusal and peer/clock/hold preservation. Full426 app/native race/build, actual root CLI/two SSH shells/enforcement/collector-death and174 unchanged browser hashes pass; see native-pane-management.md. Not C3 retention, cleanup proof or deployed |
| Inspect/reconcile original/current account restriction | Native state/helper journal | Existing `info/reconcile`; improve actionable release/deletion diagnostics |
| Workspace retention metadata / holds / cleanup | Native private per-attempt controls | Local `workspaces list/show/hold/release-hold`, audited hold revision and missing-record fail-closed markers; actual CLI/native race/app/build pass. No fresh eligibility proof, unknown-orphan cleanup or deletion is enabled; not deployed |
| Root emergency release | Native OverrideAccess | Existing `override-access`; retain secured-copy/termination/audit prerequisites; never suggest automatically |
| Protected manifest/export/delete | Native protected bundle | Existing `manifest/export/delete`; rename discovery as submission operations while retaining aliases; add export audit and explicit output safety |
| Recovery grants | Incident JSON and separate enrollment helpers | Missing; `grants create/validate/list/show/revoke` coordinated with unified model; cannot silently synchronize offline edits |
| Template install/version/inspection | Separate native immutable catalog, optional exact-version readers and signed metadata registry; gateway snapshots still legacy | Local `templates validate/install/list/show/verify/jobs/clean/sync`, root `web templates list/show` and read-only admin catalog pass actual CLI/TLS/native verification/restart and browser checks. Acknowledgement is timestamped evidence, not a live availability lease or source selection. Privileged guest and unified grant selection/issuance/migration remain pending; not deployed |
| Monitoring metadata/replay/media/deletion | Shared MonitoringManagement and durable isolated purge jobs | Local `web monitoring show/list/replay/image/export/delete/purges/purge-status`; private transient reads, complete purpose-signed private copies, reviewed ended-only deletion, durable isolated physical status and bounded retired-job inventory snapshots. Implemented/tested locally, not deployed; monitoring is separate from protected submissions |
| Alert test/outbox/manual reminders/desktop sound | Shared AlertManagement web/root service and browser-local preferences | Local `web alerts list/show/test/remind`, metadata-only inspection, stable intent/revision, explicit reason and no automatic reminders; 309 app tests, CLI/TLS/SMTP and 31 browser checks pass. Desktop permission/sound remain browser-local |
| Agent lifecycle/readiness/accounts | Native health/accounts and systemctl | Existing `agent start/stop/restart/status`, `health/accounts`; diagnose callbacks/leases/policy without stopping independent watchdog |
| Relevant system config/trust/retention | Root configuration/install scripts | Native `config show/validate` implemented/tested locally: bounded non-mutating selected-file/key inspection, path redaction and explicit not-applied/readiness flags. Final414 app/native race/build and unchanged113-browser artifact checks pass. Native mutations/apply, gateway config and full management still missing; service-affecting apply requires drain |
| Administrator creation/metadata/sign-out | Shared browser/root creation service and separate interactive bootstrap | Local `web administrators list/show/create`: named default-deny agent auth, strong-verifier original-password intents, hidden confirmed TTY/exact finite stdin, metadata/safe-error whitelists, no overwrite and same-form browser retry. Full426 app/native race/build, actual static CLI/TLS/TTY and all114 browser checks pass with174 unchanged source/runtime hashes. See administrator-management.md; not deployed/full management. Existing browser login/logout remain separate; root CLI needs no stored browser session |
| Incident transfers/compensation/approval refresh | Protected one-off scripts | Unsupported; do not port mutable transfers as a new general operation. Unified new-attempt grants express saved-work/time authorization; preserve old attempt identity/history |

**Decision C1, approved by the instructor October 20:** root-run examctl on the
class server will reuse the existing root-owned agent identity for authenticated
outbound HTTPS management, with explicit authorization and auditing. This
supersedes the earlier administrator-session recommendation; neither browser
session storage nor a separate CLI token is required for this workflow. Remote
non-root CLI login is not part of this approval.

The existing agent authenticates status/recording callbacks and timing requests;
it does not yet authorize general gateway administration. Add explicit management
operations with purpose/audience/scope checks, bounded freshness, persistent
request/replay/idempotency records and revision conflict handling. A valid ordinary
callback signature must not implicitly become permission for arbitrary management.
Reuse the web administration's shared validation, authority, transaction and audit
rules rather than introducing independent state edits. Audit the authenticated
agent/root identity, operation/targets/reason and confirmed versus pending result.
Do not claim verified human attribution from caller-supplied names or environment.

Native operations remain root-only and usable offline; help remains available
without root. Web-owned operations need the webserver and must report outages or
pending native confirmation honestly. Keep HTTPS verification and protected key
handling, no new webserver-to-agent control API, student credentials, generic
command polling or disconnected SQL/JSON editor. Browser administrators continue
using their existing session/Origin/CSRF checks. **Partial implementation: management
protocol and definition reads/configuration CLI are tested locally
(agent-management.md, exam-definition-management.md); retirement/full coverage
and production qualification remain outstanding.**

## Unified attempts and workspace initialization

Migration 005 enforces `ordinary_exam_once(exam,username)` except sandbox;
`account_busy` and `account_access_hold_insert` fence concurrent/reserved/held UIDs.
Student exam/preflight/login queries select the latest attempt, retire only
confirmed cancelled preparations, and treat completed ordinary exams as exhausted.
Native prepare checks UID Busy; pause/registration/admission bind transport and
generation. Callback ingestion matches attempt UUID and immutable exam/account/
timing. Dashboard already groups retained history and numbers sandbox attempts.
Recovery is a separate exam plus one-use root JSON, checked at preparation and
activation; a consumption marker and committed start fence reuse across crashes.

Approved C2 model: an explicit grant record with UUID, exam/student/UID, attempt
allowance,
source choice, source attempt/checksum or template version, not-before/latest-start,
webcam/terminal snapshot, actor/reason, revision, and unused/claimed/revoked state.
Grant availability is distinct from PREPARING and consumes no time. Default exam
policy remains one attempt. Explicit individual/bulk grants add one attempt;
repeatable exams require a deliberate default-limit policy. Resume retains the
same attempt/deadline and is never represented as a new grant.

Workspace choices are `empty`, `template VERSION`, and `saved ATTEMPT CHECKSUM`.
All create a separate writable workspace exactly once. Protected sources are
immutable and verified before use; missing/damaged sources fail closed, with
omissions shown for explicit review. Only available ordinary file metadata is
restored; no buffers/processes/ACLs or invented directory metadata. Material
template selection is independent of saved-file initialization and time allowance.

**Decision C2, approved by the instructor October 20:** use the unified grant
model with settings fixed at issuance and explicit, audited revisions for unused
grants. Snapshot duration, webcam/terminal settings, material/template version,
workspace source and the selected start window; later enrollment/default edits
must not silently change an issued grant. A revision/revocation must fence any
in-progress preparation and race safely with Begin. Once consumed, the grant's
snapshot/history cannot be rewritten. Exact compensation and a new full 90 minutes
are separate allowance modes; neither depends on file source. The earlier
alternative of resolving mutable enrollment defaults at Begin is not selected.

October 21 refinement approved: enrollment/import issues the first ordinary grant
with its settings copy immediately. Later default edits need explicit revisions
of unused grants. This is not the C3 process freeze. A confirmed immutable
material/source version and finite Begin window are required before issuance;
existing enrollment migration remains engineering work, not an implicit resnapshot.

Verify/stage the source privately before committing Begin; no writable exam work
or time consumption is exposed during waiting/preflight. Failed/abandoned preflight
does not consume the grant, and retries/concurrent claims cannot create extra
attempts. Maintain the default single-attempt policy and all prior account holds.
Webcam/start-window policy is approved separately in C5; C7 selects explicit new
attempts for crash recovery, with no automatic refunds. No
production recovery window/enrollment changes are implied. **Design approved;
implementation, migration and crash/race qualification remain outstanding.**

The second-midterm use case becomes a bulk grant on the **same exam**: 5400 seconds,
saved source selected per student from their secured first attempt, explicit
start window and frozen individual webcam setting. Actual Begin starts a fresh
90-minute clock after source validation/staging; waiting/preflight consume none.
Both submissions stay visible/comparable; selection for grading is a separate
instructor decision. Ordinary prior restrictions must release normally before
claiming; emergency handoff remains an independent audited root operation.

Migration must preserve all UUIDs, archives, original/current deadlines, holds,
grant consumption and recovery links. Replace ordinary uniqueness only after
grant claim is transactional on both servers. Use existing signed SSH commands
and durable callbacks for authorization/claim acknowledgments; offline CLI state
must remain explicitly unsynchronized. Use grant/operation IDs for retries and
fence start/claim crash boundaries. Keep existing recovery paths until migration
and rollback are proven. Acceptance includes template/empty/saved starts,
compensation and second full attempts, abandoned preflight, simultaneous claims,
revocation races, both servers restarting/outages and prior outstanding holds.

## Retained authenticated SSH during locks

Today `Lifecycle.onPaused` closes the connection, native
`disconnectPausedWorkload` freezes then terminates cgroups, and resume rejects the
old transport. The requested policy explicitly supersedes that behavior, but
retaining SSH alone cannot preserve buffers or prevent background file writes.

**Decision C3, approved by the instructor October 21:** retain authenticated SSH
and preserve shells/editor buffers through a verified freeze during policy
lockouts. Revoke pane/control work admission and confirm every student workload
frozen; keeping the connection alive must never permit background writes.
Preserve the shells/editor buffers while frozen, keep SSH/PTY supervisors and
watchdog outside those cgroups,
discard queued input and block new channels. Only signed generation/page/transport
bound Continue after current readiness and valid continuation authorization under
the attempt's policy may thaw. Reflect approval/expiry/revocation promptly on the
same page without unlocking by message alone. The exam clock keeps running.
Deadline cutoff/finalization still freezes/protects/terminates independently;
unsaved buffers are not protected submissions and need not survive finalization.

Use a separate bounded locked-page/transport liveness protocol permitting only
status/keepalive, never work or renewed execution permission. Expiration of the
old execution lease must revoke work, but must not alone force fresh SSH if the
same locked page and retained transport remain demonstrably live. Page/ownership
liveness loss, page closure/reload, actual SSH failure or restart retires retained
ownership and can require fresh authentication. Never retain passwords or replay
credentials. Failed freeze remains fail closed with explicit recovery. The
alternative of routinely terminating viable shells during policy pauses is not
selected. **Design approved only; coordinated implementation, containment tests
and deployment remain outstanding.**

Test background writers and detached/multiplexed channels at each pause/continue/
deadline boundary, repeated lockouts and out-of-order authorization. UI approval
status must use current generation/server time and never unlock by itself. This
requires coherent native, worker, gateway and browser changes; do not ship one
layer claiming the new policy alone. Keep the existing focus grace.

October21 additional source investigation (still open): both bridgePTY in pty.go
and bridgeRecordedPTY in terminal_recording.go currently forward input with
unconditional io.Copy into the inner PTY. They are outside the frozen workload
scope. That is compatible with today's terminate-on-pause path, but simply
removing terminate/Connection.close would allow locked-period input to queue for
a later thaw. C3 therefore needs a server-enforced input-revocation/barrier and
queued-input discard protocol for BOTH bridges, not a browser disableStdin flag.
Scope membership/freezer confirmation and channel/exec/transfer refusal must be
acknowledged before a retained pause is reported safe; late input/admission and
old generations must not cross the thaw boundary.

A mere mutex around raw forwarding also cannot identify old-generation bytes
delayed upstream in SSH/TTY buffers. Design the complete input epoch/admission
protocol and test delayed old frames as well as local queues before wiring a
barrier. Do not hold a global state lock across a potentially blocking PTY write,
introduce an unbounded input queue or retain credentials. Capability/version
negotiation must refuse mixed bridges that lack the fence. This also reinforces
the verified-drain gate for canonical/temporary agent consolidation; no such
cutover or new input protocol is authorized for production by this source review.

quiesceWriters additionally changes workspace ownership/mode for final collection;
it is not a drop-in pause implementation. A retained-pause barrier must verify
all writers without making the eventual student workspace inaccessible or
misusing collection/protection state. Lifecycle.onPaused, workspace state messages,
execution-lease expiry and resume transport checks remain coordinated dependencies.
Next proposed increment is an internal input-gate/barrier primitive with actual
PTY tests for queued input, freeze/continue races and shell/editor survival, then
separate authenticated locked liveness and coherent native/gateway/browser wiring.
No retained SSH behavior, new liveness authority or thaw path is implemented by
this investigation, and the larger item must remain unchecked.

## Workspace cleanup, limits and recovery repair

**Decision C4, approved by the instructor October 21:** manual workspace cleanup
with **no grace period**. This supersedes the earlier 14-day suggestion; retaining
a duplicate workspace after all safety checks is not a functional requirement.
No automatic deletion is authorized. Provide supported inspection, dry-run,
explicit cleanup and hold/release workflows with audit and actionable refusals.

Cleanup can become eligible immediately after verified protected bundle/manifest
integrity, confirmed termination of all writers, no active mounts/use or
initialization/recovery/repair dependency, and no administrator hold. Archive
creation alone is insufficient: termination can fail after protection succeeds.
Recheck eligibility and exact target ownership under concurrency fences at the
actual deletion, not only during dry-run. Never delete active/paused/needed
preparations or collection-failed work. Preserve protected sources, grants,
consumption history, receipts and audit. Later saved-work attempts restore from
the protected source, not the old workspace. Cleanup does not release account
restrictions, change deadlines or alter submission/60-day monitoring retention.
Historical orphans need separate supported inspection/proof, not blanket deletion.
**C4a metadata/hold controls are implemented/tested locally;
fresh eligibility, actual cleanup, unknown-orphan recovery and privileged race/
repair qualification remain pending. No existing workspace has been deleted.**

Current implemented collection limits (32 MiB/file, 64 MiB total, 10k entries,
depth 32) remain unchanged until the approved C6 implementation below is qualified.
Recording limits are unrelated. Source sizes/omissions should be shown before
authorizing a saved-work grant; no silent regular-file omission.

Recovery currently commits ACTIVATING/start before extraction. A failure must not
reset markers or overwrite a possibly changed workspace. C1/C2 approve verified
private staging before Begin for new grants, then short atomic publication with
write-ahead initialization state. Technical diagnosis/source recovery still needs
crash/fault tests and supported commands, not ad hoc file replacement. C7 below
selects explicit new-attempt grants for outage recovery rather than a separate
repair-and-refund workflow that changes or reopens the original interval.

## Grant monitoring and Begin windows (C5 approved)

**Decision C5, approved by the instructor October 21:** preserve each student's
current effective webcam requirement (exam default plus individual override) when
issuing a new grant, unless explicitly overridden for that student or grant batch.
Resolve and show the actual requirement before issuance, then fix it under C2;
do not guess physical location or silently reevaluate it at Begin.

Require a finite, explicit earliest/latest Begin window for every new grant, with
unambiguous date/time/timezone. An additional attempt's window is independent of
the exam's default window and **may lie entirely outside it**. Do not intersect
the two windows or globally reopen the exam to make an extra grant usable.
Exam selection, authentication, preflight, native admission and Begin must agree
on the selected eligible grant's window/identity and preserve all other account
restrictions. Ordinary admission still uses the ordinary exam's default window.

The window controls actual Begin, not a hard finish time: starting near latest
Begin still grants the full fixed allowance. Waiting/preflight consume no exam
time but cannot evade the latest-Begin bound. An unused expired grant stays in
history and requires an explicit audited revision to reopen; closing its window
never shortens an already-started interval. Changing defaults or future grant
windows never changes existing production grants, attempts, deadlines or webcam
snapshots. **Design approved, not implemented or deployed; add web/CLI and native
regressions for a second attempt after the default exam window has closed.**

## Collection limits and crash containment (C6 approved)

**Decision C6, approved by the instructor October 21:** configurable per-exam
collection limits, defaulting to 128 MiB per file and 512 MiB total logical regular
file contents. Keep 10,000 entries and depth 32 unchanged. Provide matching audited
web/CLI configuration, effective-limit inspection and preparation checks. Capture
effective limits with grant/attempt/bundle identity so defaults do not silently
change an issued grant or make historical protected sources unreadable. Collector,
verifier and saved-work restoration must agree on the applicable limits; preserve
all immutable sources/history and legacy compatibility. Exceeded limits fail
closed with actionable diagnostics and retained work, never omitted saved answers
or a falsely successful/partial protected bundle. Actual workload/storage and
concurrent-deadline qualification remain required before any deployment.

The instructor additionally requires collection failure isolation, reporting a
prior collection crash that crashed the agent and locked out all users. Treat
prevention as a mandatory acceptance criterion; do not assume the already-tested
shared-lock/renewal repair proves process-crash containment or establishes the
reported incident's exact cause.

Run failure-prone per-attempt collection/verification/cleanup work in supervised,
resource-bounded OS workers, with durable attempt/job identity, atomic protected
publication and independently verified results. Merely catching returned errors
or using an in-process goroutine is insufficient for fatal crash/OOM isolation.
Do not hold the shared state lock while waiting for workers, compression, IO,
termination or callbacks. Use short durable state transitions, per-attempt
ownership/version fences and safe policy-lock ordering. Keep shared gate/PTY
bridges, signed renewals, watchdog/cutoff, management/admission and callback
coordination independent of one failed/hung job. A worker failure affects only
its target, remains visible/recoverable and cannot authorize work, reset clocks,
replace protected bundles, release restrictions or kill a healthy student's
connection.

Required fault evidence includes real collection-worker panic/abrupt exit/SIGKILL,
bounded memory/resource failure, hangs, disk/permission errors, malformed results,
restart/publication recovery, simultaneous larger collections, delayed callbacks
and another healthy active attempt plus new admission/reconnect. Verify stable
shared-agent/PTY ownership, continued heartbeat/lease acknowledgements, unchanged
healthy deadlines/generations, independent cutoff and protected source integrity.
Native worker/short-transaction isolation is now implemented/tested locally in
2891567; see collection-worker-isolation.md. Larger limits, full privileged
SSH/PTY/workload qualification and deployment remain outstanding.

## Outage recovery allowance (C7 approved)

**Decision C7, approved by the instructor October 21:** recover through explicitly
authorized new attempts from verified saved work, with an allowance chosen by the
instructor. No automatic refunds and no reopening completed attempts. This
supersedes the earlier suggestion of a dedicated repair/time-credit workflow for
the original attempt; ordinary explicit instructor clock controls remain, but
are not the selected outage-recovery mechanism.

If a protected submission already exists, use that exact immutable verified
source. If collection did not complete, first diagnose, quiesce/terminate writers
and secure/verify the old saved workspace through the supported collection path;
never substitute an unsafe live directory or overwrite an existing protected
bundle. Each new attempt receives a separate writable copy and starts its chosen
allowance only at Begin, under the C2/C5 grant settings/window. Saved files are
restorable, not process memory/editor buffers lost in a crash.

Keep original attempt identity/timing, submissions, markers, failures and audit
history. No reset of consumption markers, implicit additional grant, repeated
refund on callback/retry, automatic source substitution or access-hold override.
Normal prior restriction/termination/restoration eligibility still applies; an
emergency override remains a separate specifically authorized operation. Native
and web/CLI grant retries must be idempotent and show pending versus confirmed
source/authorization state. Preparation failure before Begin consumes no allowance
and needs no refund. **Design approved; supported source recovery and new-grant
implementation/qualification are still pending. No student records were changed.**

## Exam definition retirement (C8 approved)

**Decision C8, approved by the instructor October 21:** permanently delete only
unused exam definitions; archive definitions with history, preserving attempts
and submissions. No deletion cascade through grants, attempts, protected sources,
receipts or audit. Preview exact resource/dependencies and audit confirmation.
Archive must not strand active preparations/attempts or silently cancel grants;
refuse with actionable inspection/resolution guidance where necessary. Unarchive
restores visibility, not completed attempts, elapsed windows or consumed grants.
Keep native submission deletion and manual workspace cleanup distinct, with their
own safety/retention rules. Monitoring retention is unchanged. Matching web/CLI
workflows and conflict/retry tests remain outstanding.

## Implementation/deployment authorization (October 21)

The instructor initially resumed TODO under all eight decisions and authorized deployment
to csc-sys after all required tests succeed, without another approval request.
This supersedes the blanket local-only deployment deferral for that target, not
the prohibition on interrupting exams, weakening safeguards or changing student
records as a shortcut. Verify drain, backups, artifacts and compatibility before
cutover. No production change or temporary-service consolidation is recorded as
having happened. The instructor subsequently revoked that authorization: **local
development/testing only; do not deploy at the end or consolidate live agents.**
Only separately authorized isolated qualification that leaves the current install
and running exams untouched is allowed on csc-sys. The current work is local.

## Technical-only monitoring recovery (approved October 21)

The instructor approved automatic recovery of a positively verified infrastructure-
only technical hold, not automatic recovery of actual policy violations or lost
authentication. Require the same authenticated ownership, complete current
monitoring and uninterrupted authorized coverage, no input from a retired epoch,
verified all-writer containment and an unexpired attempt. A timeout or fresh
camera/terminal bytes alone cannot establish those facts. Unproven gaps retain
explicit recovery/review without being mislabeled student misconduct. Genuine
policy locks and actual ownership loss keep their existing authorization/fresh-
authentication rules. No automatic refund, clock stop/extension or reopening of
completed attempts. See monitoring-liveness-plan.md: H1/H2a is a partial local
contact-path candidate; full native evidence, alternate path and C3 verified
containment/thaw are not implemented or deployed.

## Active-renewal durability (C10 approved October22)

Independent storage-worker investigation exposes another false-hold mechanism:
requiring a durable disk commit on every execution renewal can exhaust existing
authority during a filesystem stall, even while full monitoring and the same
authenticated ownership remain verifiable. The private arbiter/publisher still
models publication-before-acceptance; no live code uses it.

The instructor approved the recommended split: renew execution in the positively
verified live native coordinator without waiting for disk sync. Keep grants,
authoritative deadlines, ownership/epoch transitions and audit durable. Renewals
remain bounded by the original15s complete-evidence window and current deadline;
no keepalive, frame alone, stale receipt or queued retry adds permission. A
coordinator restart loses positive authority: do not restore it from disk, and
require the verified freeze/recovery protocol before working again. This may
lose immediate durable confirmation of the last renewal, which must be reported
as unknown/pending rather than fabricated or accused as misconduct.

Mandatory durable per-renewal commit, with technical holds during storage stalls
despite healthy monitoring, is not the selected policy. C9 technical
recovery, genuine policy/authentication rules, original/current deadlines,
protected history and account restrictions remain unchanged. Independent local
work continues; no production or live mode is altered. The publisher remains
useful for durable transitions under either choice. Fair bounded scheduling and
measured admission capacity are prerequisites, not inferred from two flock slots.

The simultaneous default-size collection experiment measured signed operations
delayed up to2.7s, with the longest traced exchange dominated by fsync/rename.
This supports the availability tradeoff, not a diagnosis of the production
incident. Refactor the unused publication-before-acceptance arbiter before any
live integration. No installed lease, timeout or watchdog behavior changes from
the approval alone.

## Stop-assisted retained-workload freezing (C11 development approved October22)

The instructor approved developing and fully qualifying the stop-assisted
approach. Cgroup-only freezing canceled12 linked asynchronous writes in the
isolated experiment; narrow stop-assisted IO/editor/dead-leader tests preserve
those writes, memory and originally stopped jobs. These are not a completed
all-writer freeze, root admission or retained-SSH implementation.

The coordinated barrier must close pending/new launches, revoke and drain every
pane's input, identify/pin every writer including surviving worker threads,
preserve pre-existing job stops, verify stopped/frozen coverage and discard old
input before any authorized thaw. Include actual editors, deferred IO, competing
launches, process/thread exit/reuse, namespace escapes, failures/restarts and
deadline/ownership races. Failed/unknown containment remains fail closed. Do not
introduce a syscall restriction or kernel change to make tests pass. C3/C9,
deadlines, account holds and credential cleanup remain unchanged. This approval
authorizes local development/guarded testing only, not deployment or production
signals. See native-async-io-investigation.md and monitoring-liveness-plan.md.

## Retained terminal supervision (C12 approved October22)

The instructor selected one bounded supervisor per user/attempt, owning that
attempt's terminal panes. This supersedes the suggested per-pane topology;
there must not be one shared terminal supervisor across students. Supervisor
failure is contained to its own attempt. Preserve it outside the coordinator's
kill/OOM domain, with authenticated role/ownership/epoch IPC, closed launches and
independent cutoff. Capacity and actual process-death/SSH/input/freeze integration
remain to qualify. This authorizes local development, not installation or an
enabled retained mode. See retained-workload-barrier-plan.md.

## Legacy unused enrollment migration (C13 approved October22)

Use reviewed bulk issuance of NEW grants from explicitly selected current
settings/version and a finite Begin window. Do not fabricate original enrollment-
time settings, backdate authority, revise used grants or change active/historical
attempts and protected submissions. This supersedes earlier awaiting-decision
notes. The review/confirmation transaction, matching CLI/web workflows and
migration qualification remain to implement; no records are migrated by approval.

## Repeatable sandbox grants (C14 approved October22)

Use an explicitly operator-configured finite Begin window for sandbox practice.
Within that window, automatically issue fixed-settings grants for repeatable
five-minute/no-webcam practice. Outside it no new practice may Begin; existing
started attempts retain their original/current deadlines and continuation rules.
Do not invent an always-open or automatically rolling window. This intentionally
replaces indefinite sandbox admission for new grants, not ordinary account holds,
protected history, monitoring or verified-collection requirements. CLI and web
must expose the same window configuration. Approval is not implementation or
deployment. Finite-window CLI/web configuration and gateway/native admission are
implemented/tested locally; unified fixed-settings grant
issuance/migration remain pending. See exam-definition-management.md.

## Fresh native Begin verification (C15 approved October22)

Unified Begin requires fresh agreement over the native agent's existing
authenticated outbound HTTPS path. Bind its distinct purpose to the exact
grant/revision/settings/source, verified account, preparation, owner/boot and
one-use Begin intent. Unavailable verification refuses before the clock starts,
with actionable retry/inspection guidance; it is not a student violation or
proof that a previously uncertain Begin never started. No offline permit or new
browser-relayed challenge protocol is introduced. Existing started deadlines,
holds/history and original one-use outcomes remain authoritative. This settles
the availability choice, not implementation, migration or deployment.

## Live work-authority placement (C16 awaiting instructor decision)

This does not reopen C12's ONE supervisor per user/attempt. The remaining choice
is whether that process also hosts the live monitoring-proof arbiter/input-cutoff
loop, or an additional authority process per attempt does so. The private C10
arbiter has no live seal factory/caller; current practice supervisors own PTYs
without loading global Engine state. See live-monitoring-renewals.md and
retained-workload-barrier-plan.md.

Recommend colocating the arbiter, input gates and kernel cutoff/barrier control
with the attempt supervisor: no extra authority-to-gate decision hop, coordinator
failure stays outside its lifetime and failures remain attempt-local. Isolate and
bound recording/publication IO from that loop; do not copy the global Engine or
agent private signing keys/passwords/MFA into it. It may receive the scoped
settings/epochs and public gateway verification material needed to verify proofs.
The shared agent retains authenticated outbound transport and canonical durable
metadata coordination. Actual authority restart still needs fresh positive
verification, never permission from a disk snapshot or old timeout.

The alternative keeps ONE terminal supervisor but adds a separate authority
process per attempt, isolating authority failures from PTY ownership at the cost
of another resource budget, lifetime claim and authenticated IPC/barrier boundary.
Either requires real peer/epoch/loaded-role agreement, durable significant
transitions, all-writer/input freeze and complete CLI/web/qualification before
retained mode can be enabled. No deadlines, hold/recovery policy or verification
requirements change. The instructor has been asked; neither option is implemented
by this proposal. Independent correctness/retention work continues meanwhile.

## Explicit recovery allowance synchronization (C17 approved October22)

An explicit per-student allowance edit in web administration or the shared root
`examctl web students settings` workflow authorizes duration-only synchronization
of an UNUSED native legacy saved-work grant at the next authenticated preflight.
Explicit duration CSV/add input uses the same authority. Inheritance records the
exam allowance at edit time; later exam-default edits do not revise the grant.
Do not infer historical approval from existing mismatched enrollment rows: save
the intended allowance explicitly again when no recorded edit exists.

Keep grant/account identity, saved source/checksum, creation time and reason fixed.
Prepared/started/consumed grants refuse revision; cancellation must positively
confirm no start before a fresh preflight. No failure or waiting consumes a clock
or allowance. Retry preserves the source and receives its complete chosen
interval only at actual Begin. Distinct signed reconcile/prepare/Begin purposes,
monotonic revision provenance and exact source hashes must refuse stale/mixed
roles and missing authority instead of falling back to starter files. This is a
bounded legacy recovery repair, not unified-grant issuance or deployment.

## Saved-source availability and retention (C18 awaiting decision)

Unused gateway saved-work grants are invisible to existing offline native source
deletion. Confirmed source inspection: native checkSubmissionDependencies covers
legacy recovery grants/unfinished restored attempts; Agent.call needs student SSH,
and outbound callback delivery does not fetch commands. Saved-source issuance
cannot safely be enabled on that basis alone.

Recommend durable class-server retention confirmation before such a grant becomes
available, with honest pending/inspect/cancel/retry and no account reservation or
clock. This requires class participation before use, but offline source deletion
can retain durable pins. Alternative: allow offline issuance from retained web
evidence, requiring fresh gateway authorization and durable race/crash fencing
for every native deletion; web outage then blocks deletion. Existing authenticated
agent identities remain in use; neither option weakens protection/history/holds.
The instructor has been asked asynchronously. Evidence and next integration
boundary: grant-workspace-sources.md. Independent empty/template sources continue.
