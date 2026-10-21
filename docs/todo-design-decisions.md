# TODO architecture investigation and decisions

Updated 2026-10-21, local source inspection and instructor decisions. **C1–C7 are
approved for local implementation; the other proposals remain pending.
Nothing here is a deployment receipt.** Investigation remains open until decisions
and acceptance evidence exist.

## Present boundaries and CLI coverage

The gateway owns exams, enrollment, pending clock intents, continuation grants,
monitoring and the outbox. Native root state owns committed intervals, admission,
workspaces, protected archives, policy restoration and the recovery JSON grants.
Signed commands travel over student SSH; signed callbacks/timing checks travel
outbound to the gateway. Keep this architecture. Local examctl does not currently
manage gateway-owned state.

| Supported operation / setting | Present interface | CLI status and proposed workflow |
| --- | --- | --- |
| Exam ID/name/template, start window, future duration/webcam/terminal limit | POST /api/admin/exams (upsert) | Missing; `examctl web exams list/show/create/update`, conditional revision to prevent lost edits |
| Exam definition deletion | Neither interface has a supported workflow | Missing; add explicit `exams delete` only after dependency/hold/history policy; never alias submission deletion |
| Single enrollment, removal, future duration/webcam | roster add/remove/settings endpoints | Missing; `web students add/remove/settings`, same schemas and bulk transaction |
| CSV preview/confirm/export/example | roster import-preview/import-confirm/export/example | Missing; `web students import --preview`, confirm stored preview ID, export/example; retain exact active snapshots |
| Dashboard/filter/history/working status | exam dashboard and attempt list endpoints | Missing; `web attempts list/show`, show pending versus confirmed clock changes and stale data |
| Reset current clock / add minutes, individual/bulk | reset-clock and attempts/clocks endpoints | Missing; `web attempts clock reset/extend`, explicit revision and durable request ID; native reset operation exists but no CLI wrapper |
| Review interruption / authorize continuation | recordings metadata, dashboard and authorize endpoint | Missing; `web interruptions list/show/authorize`, generation-bound and five-minute/deadline bounded; no root bypass |
| Finish/pause/cancel/retry one attempt | Native admin operations | Existing `stop/finish/pause/cancel/retry`; improve help and state guidance |
| Inspect/reconcile original/current account restriction | Native state/helper journal | Existing `info/reconcile`; improve actionable release/deletion diagnostics |
| Root emergency release | Native OverrideAccess | Existing `override-access`; retain secured-copy/termination/audit prerequisites; never suggest automatically |
| Protected manifest/export/delete | Native protected bundle | Existing `manifest/export/delete`; rename discovery as submission operations while retaining aliases; add export audit and explicit output safety |
| Recovery grants | Incident JSON and separate enrollment helpers | Missing; `grants create/validate/list/show/revoke` coordinated with unified model; cannot silently synchronize offline edits |
| Template install/version/inspection | Native filesystem/operator procedure | Missing; `templates list/show/validate/install`; version/freeze sources, root traversal checks |
| Monitoring metadata/replay/media/deletion | recordings/media/delete-monitoring endpoints; native retention | Missing; `web monitoring list/export/delete`, named confirmation/tombstones, separate from submissions |
| Alert test/outbox/desktop sound | notifications/test, attempt feed, browser preferences | Missing; `web alerts test/list/show`; desktop permission/sound are browser-local and must be described as such |
| Agent lifecycle/readiness/accounts | Native health/accounts and systemctl | Existing `agent start/stop/restart/status`, `health/accounts`; diagnose callbacks/leases/policy without stopping independent watchdog |
| Relevant system config/trust/retention | Root configuration/install scripts | Missing; `config show/validate`, redacted values, staged/apply distinction; service-affecting apply requires drain |
| Administrator creation/sign-out | web administrator endpoint / bootstrap script | Missing; agent-authenticated administrator management for root CLI; existing browser login/logout remain separate, with no saved browser session needed by root CLI |
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
using their existing session/Origin/CSRF checks. **Approved design only: management
protocol/CLI implementation and qualification are still outstanding.**

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
**Design approved; implementation/race/repair tests remain pending. No existing
workspace has been deleted.**

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
**Approved requirements only; no limits or isolation code have changed yet.**

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

## Remaining policy question C8 (pending)

This remaining question is not approved by approval of C1–C7.

- C8: recommend archiving exam definitions with history, allowing permanent
  deletion only for unused definitions. Protected submission deletion remains a
  separate targeted retention operation; no cascade through attempt history.
