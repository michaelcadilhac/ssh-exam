# TODO architecture investigation and decisions

2026-10-20, local source inspection. **Proposal, not an implemented or deployed
policy.** Investigation remains open until decisions and acceptance evidence exist.

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
| Administrator creation/sign-out | web administrator endpoint / bootstrap script | Missing; `web administrators add`, login/logout/session inspection; securely prompted credentials |
| Incident transfers/compensation/approval refresh | Protected one-off scripts | Unsupported; do not port mutable transfers as a new general operation. Unified new-attempt grants express saved-work/time authorization; preserve old attempt identity/history |

Proposed complete web workflow: examctl calls the existing authenticated HTTPS
administrator API as an administrator, including Origin/CSRF and the same
validation/audit/concurrency checks. Store only an expiring session in an
owner-only local file; prompt for passwords without echo and never save them.
Native commands remain root-only and usable offline. CLI login/help need not be
root. Refuse insecure HTTP except explicit loopback development. No new
webserver-to-agent control API, root SSH credential or disconnected SQL editor.
Pending web intent is confirmed only by a signed native result. A separate scoped
CLI-token design is an alternative requiring a new credential lifecycle and
revocation/audit surface. **Decision C1: reuse admin sessions or add tokens.**

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

Propose an explicit grant record with UUID, exam/student/UID, attempt allowance,
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

**Decision C2:** recommend freezing duration, webcam, material/template version,
source and an explicitly chosen finite start window at grant issuance. Later
enrollment edits affect future grants; edits to an unused grant require an audited
revision. Alternative: resolve enrollment defaults at Begin, which makes a pending
grant's displayed allowance/monitoring mutable. Exact compensation and a new full
90 minutes are separate allowance modes; neither depends on the file source.
Preserve current individual webcam settings unless the instructor deliberately
changes the grant. No production recovery window/enrollment changes are implied.

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

**Decision C3:** recommend a retained-page pause that revokes pane/control work
admission and confirms every recorded cgroup frozen. Preserve the shells/editor
buffers while frozen, keep SSH/PTY supervisors and watchdog outside those cgroups,
discard queued input and block new channels. Only signed generation/page/transport
bound Continue after current readiness and instructor approval may thaw. Deadline
cutoff/finalization still freezes/protects/terminates independently. Lease expiry,
page loss/reload, actual SSH failure or restart retires ownership and follows fresh
authentication. A bounded locked-page liveness protocol permits status/keepalive
only, never work or a renewed execution lease. Failed freeze remains fail closed
with explicit recovery. Alternative: retain SSH but terminate workloads, preserving
saved files while losing buffers and opening new shells after approval.

Test background writers and detached/multiplexed channels at each pause/continue/
deadline boundary, repeated lockouts and out-of-order authorization. UI approval
status must use current generation/server time and never unlock by itself. This
requires coherent native, worker, gateway and browser changes; do not ship one
layer claiming the new policy alone. Keep the existing focus grace.

## Workspace cleanup, limits and recovery repair

**Decision C4:** recommend manual-only `workspace cleanup --dry-run` initially,
with a 14-day minimum grace after secured collection and explicit administrator
holds. Automated deletion should require a separately enabled policy. Eligibility
also requires verified bundle/manifest, no writers/mounts/initialization or recovery
use and no administrator hold. Never delete protected sources/audit/receipts or
release access through cleanup. Alternative: automatic cleanup after a selected
grace period, adding scheduler and race/hold requirements before enablement.

Current collection limits (32 MiB/file, 64 MiB total, 10k entries, depth 32) remain
unchanged pending synthetic compiler/debugger measurements and an instructor
choice. Recording limits are unrelated. Source sizes/omissions should be shown
before authorizing a saved-work grant; no silent regular-file omission.

Recovery currently commits ACTIVATING/start before extraction. A failure must not
reset markers or overwrite a possibly changed workspace. Recommend verified
read-only staging before Begin for new grants, then short atomic publication with
write-ahead initialization state. Existing interrupted starts need a repair command
that first diagnoses which boundary committed, refuses student changes, and records
time compensation separately. Implementing that transaction and compensation
policy requires agreement and crash/fault tests, not ad hoc file replacement.
