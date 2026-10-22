# Unified grants: authority and migration proposal

October22,2026. **Investigation, not implementation or deployment.** C2/C5/C7
and enrollment-time initial issuance are already approved. This document maps
remaining engineering boundaries; it does not reopen those decisions, create a
grant, revise history or declare the investigation complete.

## Inspected current implementation

| Boundary | Confirmed behavior | Required coordinated change |
| --- | --- | --- |
| migrations/005.sql | ordinary_exam_once is unique on exam/student except sandbox; account_busy and original access-hold insertion trigger are separate | Replace ordinary uniqueness only after one-use grant/claim enforcement exists; retain both account restrictions |
| roster-management.ts add/confirm/settings | Enrollment stores current overrides and initially UID0, not issuance/settings history; shared web/root writers already exist | Atomically issue the first settings copy during enrollment/import; later override/default edits do not revise it |
| app.ts student session/preflight/sign-in | Selects latest exam/student row; completed ordinary row rejects sign-in; PREPARING retries retain a snapshot made at first preflight | Select an explicit authorized grant/preparation or a continuing attempt, never latest-row permission |
| app.ts live SSH identity resolution | Root-signed resolve-course-accounts establishes current UID after real SSH; import cannot supply identity | Keep issuance settings separate from verified identity binding; UID0 is not an identity |
| app.ts Begin | Rechecks page/connection/current monitoring and native policy handoff before native activation; native interval is authoritative | Bind exact grant revision/preparation/Begin intent; preserve these existing checks |
| lifecycle.ts retirePreflight | Requires native no-start/restoration confirmation, then removes cancelled web row/monitoring to allow legacy uniqueness retry | New grant preparations need retained cancellation/claim history, not deletion of the entitlement or an inferred refund |
| native engine.go | Checks root identity/registered transport/account busy; Begin fixes clocks and holds; current lockout destroys paused workload | Add grant-specific admission/consumption without bypassing restrictions or pretending C3 is implemented |
| native workspace_jobs.go/recovery.go | Optional immutable version binding; native-only legacy saved-work JSON chosen before template fallback | Explicit recorded source in unified settings; missing expected source must never become fresh template work |
| protocol/sandbox.ts and app.ts | Built-in sandbox is repeatable, auto-enrolled after SSH, five minutes/no webcam, effectively unbounded availability | Preserve legacy behavior during transition; explicit finite-window policy for newly issued sandbox grants needs resolution |
| exam-admin.ts and web admin.tsx | Dashboard already groups retained attempts by student and renders attempt numbers; student admission still assumes latest row | Add grants as a distinct section and stable identities; cancelled preparation is not a completed timed attempt |
| lifecycle.ts authenticated callbacks | Reject mismatched attempt/exam/user/UID and changed original intervals; protection requires verified manifest | Extend exact grant/revision/intent scope; retain immutable clocks, verified submissions and callback replay rules |
| agent_template_versions (migration020) | Timestamped root attestations, not material contents or a live availability guarantee | Explicitly select exact attested version at issuance; native re-verification remains mandatory before Begin |

The existing sandbox migration test explicitly proves ordinary repeat refusal,
sandbox history retention and account-busy constraints. Preflight cancellation,
late-start and callback/clock tests protect additional boundaries. They are
compatibility evidence, not tests of a grant domain which does not exist yet.

## Proposed records and authority

The gateway owns authorization and immutable grant revisions. Root owns verified
Unix identity/SSH ownership, prepared work, actual one-use Begin, clocks, holds and
protection. Use existing separate pinned Ed25519 identities and purpose/audience/
nonce/replay checks; no inbound root control listener or general command queue.

Each grant has an opaque ID, exam/student/agent, issuance intent/reason/actor/time,
immutable revision records and a current revision pointer. Each revision fixes:

- explicit finite earliest/latest Begin timestamps, not intersected with current
  exam defaults for an additional grant;
- allowance, current effective webcam requirement unless explicitly overridden,
  terminal/capture policy and logical collection limits;
- materials/WELCOME exact catalog version, separately from work initialization;
- work source: empty, exact template starter version, or this student's protected
  source attempt plus verified checksum; never a writable prior /work directory.

The initial revision is saved in the enrollment/import transaction. Snapshotting
settings must not trust an import UID: first live signed SSH resolves identity,
and root verifies the same UID/account restrictions for every preparation/Begin.
Once an attempt binds identity, later UID change refuses for explicit review;
neither a cached registry nor a matching username may replace the original UID.

Default ordinary entitlement is one initial grant. Additional grants are explicit
audited authorizations, not extra unguarded attempt rows or automatic refunds.
Continuation remains a generation-bound authorization of an unfinished attempt,
not another grant, new allowance or submission reopening.

Use separate preparation/claim and Begin-intent records. A grant can have multiple
confirmed cancelled preflights but at most one committed timed attempt. Preserve
those cancelled claims/history. At most one unresolved claim/Begin per grant and
one account workflow per UID may exist. Keep native original/current holds and
web account_busy enforcement independently; a valid grant never releases them.

## Proposed claim/Begin transaction

1. Student chooses a specific usable grant. In one short web transaction, compare
   its current revision, eligibility/window, enrollment and account conflicts;
   reserve a preparation ID. Do no SSH/network/archive IO in that transaction.
2. Signed student SSH carries the exact grant/revision/settings/source hash and
   preparation identity. Root checks actual peer/current registration and native
   account holds. Stage/verify private work in existing bounded workers before
   any countdown/consumption. Empty means an actually new empty tree; materials
   remain the separately fixed version. Missing/damaged explicit sources refuse.
3. Begin keeps page/current complete monitoring/account-handoff checks. The web
   authority atomically reserves one Begin intent against that exact revision.
   A revision/revocation cannot report successful withdrawal while this intent
   could still start. Busy/unknown is explicit, not silently "unused".
4. Proposed narrow root outbound Begin verification uses existing agent HTTPS
   authentication, analogous to deadline timing verification but a distinct
   purpose. Bind agent, student verified UID, grant/revision/hash, preparation,
   owner/boot epoch and one Begin intent. Replies are not arbitrary commands or
   a callback control queue. A changed/revoked revision cannot receive permission.
5. Root rechecks the current intent/ownership/window/private receipt/guards under
   its final exclusion fence, then durably commits the original start/deadline,
   hold and consumption identity once. Publish/adopt only the verified work inode;
   no extraction under a running clock or partial-work fallback.
6. Exact retries/status callbacks reconcile the original native result. They
   never create a second interval or rebase a deadline on retry time. A missing
   reply is UNKNOWN, not failure-to-start proof. Original one-use markers and
   historical attempts/submissions remain durable.

Before implementing step4, resolve the narrow availability contract explicitly:
the supported browser Begin already needs the webserver, but requiring root's
outbound reachability is an additional path prerequisite. Recommended: require
fresh outbound agreement for unified Begin/revision withdrawal, fail before time
starts, and provide actionable retry/diagnostics. Do not introduce an offline
permit that appears immediately revocable while root could still consume it.

An abandoned preflight consumes no allowance. Reuse/revision after an uncertain
Begin is different: require a root-authenticated durable retirement fence for the
old intent/epoch plus no-start proof. A timeout, expired browser session, absent
callback or a gateway restart is insufficient. If a clock did start, preserve
that attempt and use the explicitly authorized new-attempt workflow; no refund.

## Required crash/race qualification

| Fault boundary | Required result |
| --- | --- |
| Enrollment/import commit or reply loss | Exactly one initial grant with its original settings; same request cannot resnapshot defaults |
| Revision versus preflight/Begin | Either original revision begins once, or its retired intent cannot start; no success message for an ineffective revoke |
| Staging death/ENOSPC/source corruption | No clock/consumption; original source and private work preserved; healthy peers/control remain available |
| Web intent committed but native request lost | Unknown/reserved until fenced native no-start proof; no automatic second authorization |
| Native clock committed but marker/callback/reply lost | Exact original interval/consumption restored; no empty fallback, recopy or reopening |
| Concurrent logins/grants/UID remap | One current account reservation and verified owner; wrong UID/agent/page/revision/source refuses |
| Original submission protected but access still held | New Begin refuses with exact restriction/deadline/restoration guidance; no implicit override |
| Deadline/window/clock revision races | Window only controls Begin; already started deadline stays authoritative; stale replies cannot restore work |
| Old native/gateway/browser | Refuse unified operations before material release/Begin; no downgrade to mutable legacy source or unsigned metadata |

Exercise actual CLI/TLS/HTTP/browser/WASM/native interfaces, not only validators.
Include a second full90-minute saved-work attempt after midterm, independent
outside-default window, empty/template reset, abandonment, unavailable web/root
outbound path, restarts, explicit unused revisions and both individual/bulk flows.

## Shared management workflow proposal

All names below are **proposed, not currently runnable**. Shared web/root services
must expose grants list/show/history; reviewed issue/confirm for individual and
bulk targets; explicit unused revision; revoke/status and source verification
diagnostics. Reuse existing named default-deny root authorization, metadata-only
idempotent intents and audited conflict handling. CLI help must distinguish
authorization accepted, native preparation, Begin pending/unknown, consumed and
confirmed withdrawal. Scope refusals to exact IDs and working next commands.

The normal workflow is select exam/students, select immutable material version and
work source, explicitly choose allowance/window/webcam override if any, preview
the per-student snapshot/dependencies, then confirm the reviewed revision/reason.
Web uses the same preview and confirmation authority. Retry the original intent
after a lost reply rather than rebuilding its snapshot from current defaults.
Bulk saved work selects each student's own source/checksum, never one student's
source for all. History retains both submissions without implying a grading rule.

## Migration, retirement and rollback gates

- First add records/version negotiation and compatibility writers; no index drop,
  admission switch or student-record backfill as a side effect of schema startup.
  Test old-writer refusal against new-mode definitions. Preserve legacy JSON/hash
  encodings and source behavior for existing preparations/started/history rows.
- Existing unused enrollments lack issuance-time snapshots. Instructor choice
  remains open: reviewed bulk new issuance from explicitly selected current
  settings/window/version, or individual reissuance. Label it new issuance, never
  pretend those were original enrollment-time settings. No migration is executed.
- Reconcile root-only legacy recovery records/consumption with signed explicit
  identities. Preserve source dependencies and markers; uncertain records remain
  unavailable for migration/definition deletion rather than treated as absent.
- Sandbox's current indefinite/repeatable admission is not a finite new grant
  policy. Resolve that transition separately; do not silently invent a rolling
  window or interrupt existing sandbox attempts. New ordinary-grant engineering
  and independent correctness fixes need not wait for that policy choice.
- C8 may delete only unused definitions after authoritative grant/claim/native
  legacy dependency proof. Archive historical definitions without destroying or
  stranding attempts/submissions. Never silently cancel a grant to make deletion
  eligible. Keep source-version/submission dependency history independent of a
  current enrollment/definition's discoverability.
- A future separately authorized rollout requires drain, consistent private
  DB/WAL/native-state/audit/receipt/source backups and exact mixed-version tests.
  Preserve every grant/intent/consumption record on rollback. An old writer must
  not reopen single-use authority or restore an old DB over newer work. Prefer
  compatible forward repair with admission closed. Temporary agent consolidation
  remains the separate proposal in todo-rollout-plan.md, not an action here.

Implementation order: shared immutable validation/snapshot and version selection;
additive domain/one-use/idempotency tests; web/root issuance/inspection/revision
parity; dedicated native expected-source/claim/Begin protocol and fault barriers;
student selection/history UI; reviewed migration and safe definition retirement;
full combined qualification. Keep the broad TODOs unchecked until implementation
and their required scenarios actually pass.
