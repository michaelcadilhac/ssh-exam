# Recovery allowance and admission consistency

Local development only; not deployed. Synthetic identities/data only.

## October26 first-observation and Begin compatibility correction (implemented/tested locally)

Confirmed through authenticated SSH/web entry: without an explicit allowance edit
or a previously remembered recovery source, preflight accepted an older agent's
health and sent ordinary prepare-attempt. A second actual interface regression
changed the reported role after valid preflight; Begin still started/consumed its
full allowance. Both are RED in recovery-first-observation-red.log (8.79s).

Intentional compatibility tightening, within the existing recovery-aware-agent
requirement: EVERY unconverted ordinary/legacy preflight requires recovery-
allowance-sync-v1 before any native preparation or web PREPARING insertion, even
on first observation with no edit/source history. A matching agent must positively
answer its existing authenticated probe before ordinary template selection.
Fresh legacy Begin also checks current capability/readiness under its existing
busy fence. The new guard applies to unstarted work only; already-started clocks
and monitoring are unchanged. Unified grants/practice retain their separate
already-required typed authority and source checks. Nothing is auto-migrated.

Unknown/unavailable/old role is an actionable admission refusal, never misconduct
or permission to continue. Begin guard failure returns safe verification/retry
guidance without activation-failed audit, activation reconciliation, grant/time
consumption or a new pending operation. Its finally releases the existing busy
fence. Inspect sudo examctl health; repair matching roles only in separately
authorized drained maintenance, then retry the SAME saved preparation/source.
This does not authenticate a deliberately replaced root authority backup or prove
arbitrary pre-observation data was never lost; consistent legacy inventory/backup
and matched installation remain future production gates.

Pre-broad state review: no new schema, durable/intermediate state, reservation,
execution permission, native protocol/worker, key or configuration change. Checks
precede prepare/activate; existing preflight expiry/positive cancellation and all
source/UID/interval/one-use fences remain. A lost health reply creates no positive
receipt or clock; stale page/connection/window/readiness still recheck before
actual activation. Source restoration/crash repair remains the tested original
workflow. Do not bypass the guard for fixture/development health in product code.

Focused all11 initial cases PASS50.07s, including no-history old-role refusal and
Begin role loss. Expanded missing-capabilities and exact same-preparation repair
retry are added; affected staging/handoff cases pass. Cleanup regression now
models a matching saved allowance, then a storage refusal AFTER the required
source probe so it still reaches absent native preparation/cancellation. Its old
source UUID was not RFC-valid and one old3600 assertion remained; corrected the
fixture, never the schema or product duration fence. All3 cleanup outcomes now
PASS24.85s. Build/types/browser/full app qualification follows; not deployed.

Current focused browser journey PASS11.2s with real Chromium/WASM/SSH: first
preflight refusal creates no web/native attempt; Begin role-loss refusal keeps
the same zero-clock preparation and no activation-failed audit; repaired roles
start that same allowance and protected finish completes. The first fixture
control lacked existing Origin/CSRF authentication, then retry clicked behind
the displayed Workspace error dialog. Corrected the test to use the authenticated
session/control and observed Close button; no product guard was relaxed.

First full run322.63s:615 pass,8 fail,2 intentionally unselected root-namespace
CLI cases. All8 failures are the shared live-monitoring mock's old empty capability
list, so the new gate correctly refused BEFORE their intended retained-session
stage. The fixture now advertises/answers the current empty-catalog probe; all8
affected real HTTP/SSH retained-contact/Continue/SSH-exit tests pass17.77s. Keep
the failed full receipt (...application.first.log). Search shared producers as
well as per-scenario mocks when a protocol prerequisite changes. Full repeat
enables EXAM_MANAGEMENT_USERNS=1 so its two actual CLI/TLS cases run too.

Local build/typecheck PASS. Local Go1.27.3-X:nodwarf5 generated WASM3143b590...,
whereas the release image pins Go1.27.2. Those are different artifacts: final
packaged-image browser checks must use its extracted assets, without attributing
earlier C8 WASM1bea6f8e evidence to a newly compiled client. No new native protocol
or class-server executable/production installation is changed by this web guard.

## Bounded implementation plan

1. Student `/api/student/preflight` → failed native `prepare-attempt` →
   `/api/logout` → authenticated cancellation → new preflight. Accept a durable
   native cancellation tombstone for an absent, fully identified preparation,
   not an unauthenticated not-found/timeout inference. Preserve started attempts;
   fence delayed preparation across restart. Test signed native commands and the
   actual gateway login/preflight/logout/retry interfaces, including uncertainty.
2. Shared instructor/`examctl web students settings` allowance edits → unused
   native recovery grant. C17 approved October22: an explicit per-student
   allowance edit authorizes duration-only synchronization at the next
   authenticated preflight; refuse consumed/already-prepared grants.
   Keep strict duration/source checks; preserve source identity/checksum and
   consumption history. Default edits must not silently revise saved grants.
3. Retry private saved-work staging → actual Begin. Test refusal consumes no
   grant/clock, retry keeps the protected source, and only Begin commits the full
   chosen allowance. Review cancellation/restart/stale completion/expiry races;
   then affected integration/native race/build/browser qualification and a
   coherent local commit. Do not deploy or alter installed/student state.

Implementation boundary for C17: shared settings/add/CSV writers retain a durable
monotonic explicit-edit ledger (including inheritance resolved at edit time,
never retrospectively from changed defaults). A distinct signed preflight
operation reconciles only that allowance, preserving grant identity/source/
checksum/creation/reason, then returns an exact grant hash. The distinct recovery
prepare purpose requires that hash through staging/Begin; missing/changed authority
never becomes template fallback. Native revision provenance prevents rollback by
older signed edits. Atomic publication uses only a private unpublished metadata
file, visible to native catalog inspection and safely superseded by authenticated
retry; it is not a claim, reservation, clock or execution permission.

Stopping boundary: a validated integrated recovery admission workflow, or a
genuine outstanding policy/authority blocker, accurately recorded here and in
the current checkpoint. No unified-grant expansion is required for this repair.

## Investigation

The gateway inserts PREPARING before native preparation. Native recovery metadata
validation can reject before inserting any attempt. Existing signed cancellation
and inspection return the same ownership refusal for absent and foreign attempts;
gateway retirement correctly requires positively confirmed cancellation. Thus an
absent preparation can strand the web uniqueness/account reservation. Never relax
that confirmation requirement or infer absence from arbitrary command errors.

## Implemented cancellation workflow

Gateway logout sends the web preparation's exact UUID/exam/account UID/settings
over the existing signed SSH command. After checking gateway signature, nonce,
expiry, authenticated student, registered transport and account identity, root
can atomically record CANCELLED_BEFORE_START for a genuinely absent UUID. This
permanent no-start tombstone prevents late/replayed preparation after restart.
No UID-wide process termination or account-policy helper runs for absent state.
Surviving exact workspace/submission targets or existing/unavailable recovery
consumption evidence refuse cancellation rather than issuing a contradictory
no-start receipt after an incomplete authority restore. Nothing is deleted.
Existing native attempts still use normal unstarted-only cancellation. Inspection
and retirement still require matching positive native cancellation and normal
policy acknowledgment; a timeout/not-found/error never permits web deletion.

Operator workflow: `examctl help cancel-absent`, then only for the exact web orphan
`examctl cancel-absent UUID --exam EXAM --username USER --reason 'Concrete reason'`.
It resolves UID from native approved accounts, writes the normal management audit,
and refuses every existing native UUID. Use `examctl info UUID --read-only` to
inspect; a previously written tombstone remains visible. Reconnect/preflight lets
the gateway verify cancellation/retire its web row. This is not source deletion,
allowance revision, account release or a repair for missing/corrupt native state.

Focused signed native reproduction was RED0.083s (owner mismatch); native
cancellation/identity/restart and real root-mapped CLI checks now pass. Actual
synthetic SSH login/web preflight/logout/retry checks pass6 tests19.47s together
with cleanup regressions. Expanded actual native retry/stage/Begin passes1.112s:
saved source/checksum/answer/archive preserved, marker absent during failed
preflight/staging/blocked Begin setup, full4500seconds committed only after setup,
then consumed by the exact new UUID. OS readiness/home/activation checks are test
seams; archive verification/staging/publication/consumption are real. The allowance
repair at that earlier milestone was explicit fixture setup, NOT delivered
synchronization. C17 below now replaces it with the real signed reconciliation.

## State/failure review before broad qualification

- Inspect: native tombstones use existing list/info and signed inspect; root CLI
  help explains absence vs existing/history. Web cancellation follows normal
  audit/monitoring cleanup and retires only after another confirmed inspection.
- Cancel/restart/stale completion: tombstone is durable under the same state
  transaction as preparation publication. Delayed initial prepare sees cancelled;
  pending preparation uses its existing changed-state fence. Restart never turns
  the tombstone into permission. Normal command expiry/replay checks remain.
- Expiry/reservations: cancelled rows reserve no account, issue no pane admission,
  carry no interval/lease and cannot Begin. They remain history, not pending work.
  Unknown cancellation retains the web row and existing original UUID until
  positive reconciliation, without inventing a new attempt or resetting clocks.
- Started/foreign/invalid identities: refuse without changing their state,
  deadlines, source, consumption or holds. Missing/unsafe native state is not
  absence proof. Exact surviving workspace/submission/consumption evidence also
  blocks absence proof; it is retained for review, never reconciled away. This
  bounded guard has no cross-namespace scan or new cleanup authority. No broad
  cleanup, force-unlock or template fallback is added.
- Storage failure/lost reply: no unconfirmed web retirement; retry reconciles the
  native tombstone if durably committed. Never remove initialized/consumed state.
- Compatibility: old agents still refuse absent cancellation, leaving pending
  cleanup safely; do not claim the gateway alone fixes installed old roles.
  Future rollout must preserve cancelled native UUIDs across rollback/restore.

## Qualification and remaining scope

Final affected gateway checks pass47 tests22.99s; full application qualification
passes438 tests/84 files114.47s. Three rebuilt browser/WASM SSH expiry, pane/exit,
logout/relogin/finish and active-logout checks pass39.4s. The screenshot originally
wrote to the tracked documentation path; it now writes to per-test output, with
the exact changed test passing16.7s and the existing uncommitted image left out
of the commit. Final CLI-only discovery review adds cancel-absent to root help;
its focused checks pass1.862s and full CLI race passes16.347s. Static native build,
vet, matching gateway/web/WASM build, final typecheck and diff checks pass. The
ordinary Vite bundle-size and Node deprecation warnings remain non-fatal.

An earlier full native pass (core302.974s/CLI30.766s) precedes the final
surviving-evidence safeguard and is not that safeguard's qualification. Three
focused final races pass core1.453s/CLI1.636s, including both signed and root
refusals without changing the evidence, plus the positive retry/Begin workflow.
The contradiction check should have preceded that first broad run; AGENTS.md
now names it explicitly to avoid another late full native qualification cycle.
Fresh final full native race/resource/namespace/compiler/default-size qualification
passes core303.991s/CLI26.717s, followed by static build/vet. All runners finished.
No application/browser/runtime contract changed after their recorded qualification;
only the native contradiction refusal and test-artifact destination changed, with
fresh focused/native and affected-browser checks respectively. Logs are the local
`/tmp/ssh-exam-recovery-admission-{focus,app,native-final,browser,browser-final}.log`
receipts (CLI/static/vet completion also appears in the tool transcript).
No installed-role SSH/PAM/cgroup guest qualification or production repair
is claimed: native signed commands and actual root-mapped CLI use synthetic
accounts; real SSH/web tests use a signed control fixture. No new workload or
containment mechanism is enabled by this cancellation-only fix.

## Approved C17: explicit allowance → signed recovery preflight → exact Begin

Implemented/tested locally, not deployed. Shared web/root/CSV roster
writers record only explicit allowance authorizations in migration022. Inherit
captures the default at edit time; exam-default/webcam-only/omitted-column edits
do not revise grants. Root management request IDs and consumed CSV previews make
exact retry idempotent; batched failures roll back both roster and edit ledger.
No historical edit is backfilled. Existing unexplained mismatches require saving
the intended allowance explicitly again.

The live authenticated student path reconciles duration only, with checked native
audit, per-UID/catalog/state fences and monotonically increasing provenance. The
source/identity/checksum/creation/reason are unchanged. Distinct signed recovery
prepare/Begin operations enforce the exact grant hash and full saved settings;
old purposes cannot start a newly source-bound attempt. Durable authenticated
source expectations survive cancelled web preparation retirement, preventing a
missing grant from becoming ordinary starter work. This does not qualify unified
grants or add any refund, source-change or automatic recovery authority.

### New durable/intermediate-state review BEFORE broad qualification

- Explicit ledger: inspect via `examctl web students list`; no execution/claim/
  reservation. Migration adds no backfill. Enrollment removal retains the audit
  ledger/counters. Default edits do nothing. Preserve IDs/counters during restore;
  native older/equal-conflicting edits refuse. A fresh explicit edit may supersede
  an unused one; prepared/consumed grants refuse. Active history never changes.
- Native publication: checked audit records authorization before mutation. A
  complete private synced `.pending` file is unpublished metadata, visible in
  `examctl recovery-grants`, NOT a clock, account reservation or permission. A
  pending file blocks legacy admission. Same/newer authenticated edit can complete
  or supersede it after restart; older/equal-conflicting/foreign/orphan metadata
  refuses without erasure. Canonical rename + lost reply retries the same applied
  revision. Storage/audit faults never authorize execution; preserve residue.
- Authenticated source expectation: inspection lives in the gateway's protected
  database and native catalog. It supplies no new start/fresh archive proof.
  Changed UID/source/checksum/creation refuses; missing native metadata after
  cancellation/retirement/restart refuses instead of template fallback. No
  expiry/automatic removal invents another source. Legacy same-exam reissuance is
  not introduced; choose a separately approved new grant/exam workflow instead.
- Preparation receipt: immutable exact grant hash persists with existing bounded
  preflight and normal cancellation; already prepared grants cannot be revised.
  Replayed signed commands, expiry, registered transport/UID changes, stale hash,
  mismatched settings and legacy Begin purposes refuse before OS setup and again
  at native final scope. Existing workspace/source/consumption checks remain at
  staging/actual Begin. Cancellation uses the previously qualified contradictory-
  evidence guard; a missing canonical row alone is not no-start proof.
- Admission/concurrency: awaiting signed checks re-read enrollment/latest edit/
  SSH owner before web preparation insertion. Exact native locks prevent
  concurrent preparation/consumption/revision. Settings edits never rewrite a
  PREPARING snapshot; cancel positively and preflight anew. Unknown Begin retains
  the UUID/interval; failure never consumes allowance or grants a refund. Original
  holds/deadlines/protected archives and monitoring enforcement remain unchanged.
- Compatibility: recovery capability and distinct purposes require matched roles.
  Old agents refuse revised unknown metadata; no silent fallback. Preserve
  migration022 tables/counters/attempt receipts and native revision/source hashes
  across backup/rollback, together with cancellation and one-use history. Older
  writers that discard them are not a supported rollback.

Focused evidence:35 web/SSH/actual CLI/interface tests pass44.54s; final native
race cases core8.413s/CLI1.563s and final typecheck pass. The previous bad synthetic
source UUID caused six new tests to fail before their intended boundary; fixture
now uses a valid RFC UUID, without weakening the parser. The failed receipt is
retained in `/tmp/ssh-exam-recovery-sync-focus.log`; corrected nine-case run
passes40.07s. An initial new test helper had an invalid TypeScript payload type;
it was corrected, and final typecheck is clean.

Final qualification:449 application tests/86 files135.39s; full native races with
all local resource/namespace/compiler/default-size opt-ins core319.645s/
CLI26.719s; five matching rebuilt Chromium checks49.0s (desktop/narrow allowance
editor, actual WASM SSH preflight expiry and two pane/logout/relogin/Begin/finish
paths). Native static build/vet, gateway/web/WASM build, typecheck and diff checks
pass. All runners finished. Local logs:
`/tmp/ssh-exam-recovery-sync-{focus-combined,native-focus-final,app,native,browser,build,static,vet,typecheck-final}.log`.
The generic Vite bundle-size and Node deprecation warnings are non-fatal.
Browser admin API interception covers presentation, not native kernel enforcement;
signed SSH web tests and signed native staging/Begin exercise the recovery
contract. Native OS readiness/home/activation remain explicit test seams; real
archive/source/staging/publication/consumption and namespace-root CLI execute.
No csc-sys/installed-role/production qualification is claimed or performed.
No application/native artifact changed after these broad runs; only operator/
progress documentation was finalized. The existing generated screenshot remains
uncommitted and preserved; new browser screenshots use per-test output.

Future separately authorized rollout: verify drain, back up consistent gateway
and native authority/audit/consumption/source archives, update matching gateway,
native command/watchdog and CLI roles, then synthetic post-install checks. C17
requires additive gateway migration022 and native revision metadata. Preserve native cancellation tombstones on rollback
so old UUIDs remain fenced; never restore old state over newer starts/consumption
or delete an orphan web row to force retry. Consolidation of the three temporary
agent services and independent practice owners remains the guarded proposal in
todo-rollout-plan.md, not an executed action or required restart during exams.

## Final current-source correction qualification, October26

All625 application/integration checks across110 files PASS335.54s, no skips;
EXAM_MANAGEMENT_USERNS=1 exercises both actual root-mapped CLI/TLS workflows.
Native authority/source/restart/crash/storage evidence remains the fresh41.678s
matrix in unified-grant-acceptance.md; no Go/native protocol or enforcement path
changed here. Build and final typecheck/diff checks pass.

Local pinned release image ssh-exam-release-test:recovery-compatibility-033-67c74bba8133,
sha256:4d969bbeebc956f56b38f71e76b8096fbd3137d86de6e3f61fab410742559dae.
Source digest67c74bba81334f7c99f8dcd53bdc8ba19dea535fd68b3e9b5941ccc8377f54b4.
Its private UID10001/read-only/no-network/cap-dropALL fixture upgrades24->33,
preserves exact original HELD history, invents no grants/reconciliation and verifies
CLOCK_BOOTTIME/native ABI and served asset hashes. Labelled fixture/container,
synthetic keys/data and unstarted export container are independently removed;
base image retained. Explicit local Docker Unix socket only; no production action.

Extracted Go1.27.2 WASM is1bea6f8ef01e81532d5fa8a7064047f93fd2fc729391bad6fe109b51193b3e40;
JS51cc420a907399b8a7d65b757e8a0c4ea4896e05df6080cf2f183ca053861520.
Critical real-WASM compatibility/refusal/same-preparation repair/finish PASS11.3s.
Five affected Chromium checks PASS59.5s: reviewed NEW legacy issuance/lost reply,
preflight expiry, repeated SSH EOF/targeted closure/logout/relogin/finish, active
logout and exact-source legacy Begin. This includes ordinary, versioned, grant-
aware and finite practice paths. It is not new privileged SSH/PAM/cgroup proof.

The first broader browser run was4 pass/1 fail: repeated exit had no command echo
and an unexpected extra pane, before the intended EOF. Its helper only waited for
window count, without proving shell readiness/focus. The corrected helper waits
for the actual prompt, verifies the observed Terminal input textbox is focused
and targets real sequential keyboard/Enter events there. Focused EOF workflow
PASS22.7s, then all5 broader checks pass. Original trigger is not proven solely
by that snapshot; retain browser-packaged.first.log. No product/UI change or
acceptance weakening. This browser-only fixture edit changes no Vitest input or
image build input, so no unchanged full application/container rerun is needed.

MAIN var/collection-tests/recovery-first-observation.sources.json pins698 source/
config files,73 local build outputs and the6 exact packaged frontend assets,
with image provenance and that explicit post-application browser-only delta.
Prior manifests/local-Go frontend are preserved. Logs /tmp/ssh-exam-recovery-first-
observation-{application,build,types-final,docker-build,artifacts,container,browser-
packaged-focus,browser-packaged,ssh-focus}.log; retained earlier failures have
.first.log or dedicated red/focus receipts. All sources/assets match after runs.
Original main screenshots/stashes remain preserved. No active runner/guest.
Production installation, inventory/drain/live acceptance and three-agent
consolidation remain separate unexecuted proposals in todo-rollout-plan.md.
