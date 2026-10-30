# Unified sandbox practice grants (C14)

Current production setup: the instructor explicitly requested completion on
October 30. Existing sample files are now published/selected and practice has a
finite window through tonight at 23:59 Chicago. Sign-in/preflight automatically
issues eligible practice grants. See [current setup and operator workflow](sandbox-setup-2026-10-30.md).
The dated implementation/qualification notes below describe earlier stages.

Implemented/tested locally, October23,2026; not deployed. Evidence, retained
failures, artifact identity and privileged limits are below.

## Entry points and acceptance boundary

Operator: existing `examctl web exams show/update sandbox` and Exam settings
select an attested exact material version and finite practice Begin window.
Student: verified SSH auto-enrollment -> preflight -> explicit Begin. First
ordinary grants still snapshot at enrollment; automatic sandbox allowances are
separate repeatable practice policy, fixed to300 seconds/no webcam/four terminals.
Save every new allowance/source/window before preparation; fresh C15 agreement
and the actual final commit start its one-use interval. Started deadlines and
existing continuation/account restrictions stay unchanged.

Automatic issuance must reuse an existing unused grant, including cancelled
unstarted claims, rather than creating allowances on retries. After positively
completed/protected/released consumption, it may issue the next allowance from
current operator settings. Expired/revoked/unresolved authority is not missing
authority: do not automatically replace it. Expired unused settings require an
explicit unused revision; revoked authority needs explicit reviewed NEW issuance.
Provide that through the existing additional-preview/show/cancel/confirm CLI and
web workflow scoped to sandbox policy. This avoids introducing an unsupported
root JSON editor or an automatic revocation bypass. An explicit new grant window
remains independent of later default edits, as already approved in C2/C5/C14.

Grant list/show/history/revise/revoke must expose the same practice identity and
fixed policy in CLI/web. Distinct PRACTICE provenance/native purposes prevent
ordinary/additional grants from being relabelled as repeatable sandbox authority.
No practice grant may bypass prior holds, duplicate claims, source checks or
monitoring. Existing private-staging/collection workers remain isolated.

## Inspected boundaries and necessary compatibility work

Current sandbox auth verifies course UID and auto-enrolls; preflight normalizes
the fixed policy and uses legacy prepare/Begin. Native prepare currently rejects
all sandbox Grant bindings. The shared SQL claim fence recognizes initial vs
additional only. Grant inspection and CLI response validation also recognize no
practice provenance. Existing signed callbacks/C15 are reusable; no new inbound
root listener, generic command polling or credentials are needed.

Update these actual callers together. A source-capable finite-window agent is
not automatically practice-grant capable. Refuse old roles before new allocation.
New gateway practice always uses saved grants. After positive retained native
practice-grant history activates the mode, refuse grantless preparation/final
Begin across accounts; SQL likewise fences older gateway inserts after issuance.
Do not infer mode from missing legacy rows. Legacy protocol remains compatible
before activation for existing qualification/root workflows, never a new portal
fallback. Give actionable cancellation/reissue guidance; do not rewrite an
unstarted snapshot to manufacture history. Already-started legacy continuation/inspection/finalization
retains original timing and enforcement. Future cutover requires a verified drain
of unstarted legacy practice, matching writers and all existing rollback gates.

Additive027 claim/writer fencing must preserve every old row, FK, receipt,
original interval and source binding. Pending reviews/grants reserve no account;
PREPARING/Begin uncertainty retains existing expiry/cancellation/contradiction
rules. Review inspection/cancellation/lost reply and explicit unused revisions
are part of this integrated result, not later optional foundations.

Focused SSH reproduction is RED4.12s: actual preflight sends grantless legacy
preparation to the grant-aware fixture. Initial implementation passes first,
old-role and cancelled-retry cases, but explicit revoke/expiry tests exposed an
existing management defect: confirmed cancellation leaves its claim PREPARING
until another preflight retires it, preventing operator changes after logout.
Necessary repair in this same integrated workflow: positively signed native
cleanup-complete plus NORMAL account restoration releases only a proven no-start
claim; incomplete cleanup/restoration stays blocked. Historical original revisions
must still validate later retirement after an allowed unused revision/revocation.
Neither a missing reply, CANCELLED label alone nor missing current grant evidence
may release authority. This adds a receipt field, not a permission/clock/hold.
Its exact failure/restart/absence/contradictory-consumption cases need focused
native and HTTP coverage before broad qualification. Manual reviewed NEW practice
and repeated consumption are now integrated in the candidate below.

## Implemented candidate and pre-broad state review

The candidate now integrates automatic grant-aware preflight, explicit reviewed
NEW practice in existing CLI/web grant workflows, immutable source/settings,
strict policy/native purposes, fresh C15 Begin, correct blocked waiting-page
policy and protected completion/repeat. Focused actual root CLI:12 cases in9.54s and
rebuilt browser/WASM/SSH cancellation -> revoke -> reviewed NEW -> two protected
five-minute attempts pass26.7s. The430px review screenshot was inspected. These
are local checks, not completed broad/privileged qualification or deployment.

PRACTICE grants use the same AVAILABLE/CONSUMED/REVOKED and bounded review/claim/
Begin intent states. Reviews reserve no account, expire in15minutes and support
actor-bound inspect/cancel/idempotent confirmation across restart. Shared source,
roster/default revision and fixed300-second/no-webcam/four-terminal validation
refuse stale/mixed-policy confirmation without partial issuance. Explicit NEW
practice and unused revision preserve prior identities/deadlines/consumption.
Default edits do not revise existing unused or active snapshots. Blocked unused
practice displays its saved policy and instructor guidance; completed grants
yield to current defaults only for a genuinely NEW repeat.

Automatic repeat requires exact positive agreement among grant/current revision,
claim/hash/UID, original attempt/settings/type/issuance order, consumed Begin
intent/original interval, protected completion and released/explicitly overridden
access. Missing/contradictory lineage refuses NEW authorization. The web does
not release account restrictions because time passed. Native independently
enforces original holds, UID reservations, typed scopes and one-use; its real
signed worker/archive/TLS acceptance passes8.524s and final-window fence5.062s.
Before allocating automatic practice or a preparation, require the matched
practice/cleanup/ordered/source/staging capabilities; fixture=true is no bypass.
027 preserves all rows and activates the old-gateway sandbox insertion fence on
first grant issuance. Native positive retained PRACTICE history fences grantless
prepare/final Begin, including other accounts; committed legacy intervals stay
unchanged. Legacy protocols before mode activation remain compatibility paths,
not a new portal fallback or permission to mix deployed writers.

Cancellation adds cancellation_cleanup_complete, not execution permission.
Root resets it before cleanup and sets it only after scoped unit/temporary/home
cleanup succeeds. Strict contradictory workspace/submission/consumption evidence
still precedes absent-preparation receipts. An unapplied policy with no durable
generation/error is explicitly NORMAL even when no temporary policy was needed;
an applied policy still requires its verified restoration receipt. Gateway claim
retirement requires BOTH signed cleanup=true and NORMAL, exact no-start identity
and all retained consumption evidence across the WHOLE grant before monitoring
purge. Missing/false/failed cleanup or restoration keeps claims blocked and
inspectable; matching native cancel/restoration is the supported retry. Crash
before durable proof produces no release; retry repeats the same safe cleanup.
The bit cannot reopen or change a started interval. Old roles missing this
contract refuse before new allocation, not a permissive fallback.

Revisions after cancelled claim release retain the original immutable revision
and settings/work hash for later tombstone retirement. A revision mismatch is
allowed only for an already positively CANCELLED claim; unresolved/consumed
claims and contradictory original intervals always refuse. No current row's
absence or new revision may erase original consumption. The expanded regression
inserts consumption under ANOTHER retained claim: the old per-attempt-only mutant
is RED5.06s, incorrectly deleting a monitoring frame (0 instead of1), then is
removed. Restored whole-grant checks pass. Source/current policy/capabilities
remain frozen for final qualification; no earlier bundle qualifies these fields.

Focused cleanup tests pass1.161s for actual invalid recorded-unit metadata and
unsafe temporary-link refusal, successful signed retry/inspection/restart,
unapplied NORMAL and failed applied restoration, plus absent-recovery evidence.
The first fixture incorrectly injected an unrelated terminate hook; it did not
reach refusal and is not evidence. Corrected tests reach the real unit-validation
and temporary-directory boundaries; no production process is signalled. Three
HTTP cases24.62s prove old cleanup-role refusal before issuance and that cleanup/
restoration remain independently blocking until the exact signed callback.
Four ordinary cancellation/UID/contradiction cases also pass32.64s; whole-grant
contradictions pass two actual SSH cases16.01s.

Fixture corrections are retained in /tmp/ssh-exam-sandbox-grants-*.log. Repeating
while the original restriction is HELD correctly refuses authentication. Updating
a protected manifest's historical access state correctly refuses replacement:
the native-event fixture now keeps the ORIGINAL manifest and changes only live
access metadata. Globally advancing Date.now was invalid across the isolated SSH
worker's real UTC freshness checks; the fixture keeps protocol UTC real and uses
an explicitly controlled native release dependency with an actual signed event.
It does NOT qualify real privileged elapsed-deadline release. Native hold and
historical-repeat tests are separate; installed SSH/PAM/cgroup release still
requires guarded qualification. No protocol freshness check was relaxed.

Legacy grantless sandbox staging is replaced by the dedicated grant-aware SSH
cases, rather than counted as a supported new practice workflow. Coverage maps
to lost-stage-reply (one frozen copy/same grant/no clock), manual future window
(no native preparation/allocation), explicit NEW outside closed defaults,
old-role/no-cleanup-capability refusal, unchanged active interval after defaults
close, and actual post-verification native expiry. Generic legacy ordinary and
versioned page/handoff/staging regressions remain unchanged. This is migration
to the supported interface, not relaxed acceptance or removed window coverage.

## Verification and remaining boundaries

Final application qualification: **490 tests in 93 files, 248.05 seconds**.
Full native race/resource qualification: core **362.430 seconds**, CLI
**26.056 seconds**, with collection/user-management namespaces, owned user-systemd
scopes, compiler workloads and large-collection opt-ins. A follow-up real signed
preflight transport replacement, retained private workspace, fresh TLS Begin and
protected archive test passes in **7.425 seconds**; native production code is
unchanged from the full run. Build, typecheck, static native build/vet, formatting
and diff checks pass. All runners completed.

Final review after the earlier 487-test baseline reproduced three additional
no-start contradictions: CONSUMED grant status, retained web original interval,
and protected/checksum metadata with no Begin intent. All three SSH/logout cases
fail before correction in 13.14 seconds: monitoring count becomes 0 instead of 1.
The final gateway guard checks this independent evidence across the entire grant
before cancellation, retirement or purge. Nine focused contradiction/ordinary/
practice cancellation cases pass in 47.50 seconds, then the final 490-test run
passes. No native/client artifact or permission changes in this correction.

The full browser baseline finishes **134 passed, 11 failed in 13.9 minutes**.
Failures expose stale fixture producers: eight new ordinary definitions lacked
attested exact hashes, one abandoned preflight retained its old mocked transport,
expiry reused another test's reserved account, and clipboard paste raced Modal's
animation-frame focus restoration. Corrections select exact sources, model real
native transport replacement, use a dedicated expiry account and observe actual
modal/focus boundaries. They do not relax production enforcement.

All **13 focused corrections and prerequisite workflows pass in 2.1 minutes**
on the final gateway. All **62 final affected browser checks pass in 6.0 minutes**:
complete interface, grant/source/definition workflows, preflight expiry, clipboard,
seven timezones and workspace transitions. The 430px review was visually inspected.
Unaffected baseline checks retain matching client/native artifact evidence; this
is not a claim of a single 145-pass final-gateway run. The earlier already-loaded
gateway does not qualify the additive guard; the final application and affected
browser runs do. No failure remains unresolved.

Both final builds retain index-CXs17zTB.js, index-C1aTgsRk.css and
ssh-worker-FM5arK7Q.js. client.wasm SHA256:
31a2f4ec0800addecb63a144595e968928c85afab09b3038c29c04e2b225951b.
All recorded client/runtime hashes and the pre-existing dirty PNG remain unchanged
(/tmp/ssh-exam-sandbox-grants-artifact-sha256.txt). Local receipts are in
/tmp/ssh-exam-sandbox-grants-* logs: final-app/final-browser,
browser-corrections-focused, broad-native, retry-transport-native and
final-evidence-red/green. Committed tests preserve reproduction after those
local logs expire.

The checks exercise actual shared HTTP, compiled root CLI, synthetic SSH,
signed native preparation, real staging/collection children and fresh outbound
TLS. Browser native OS activation/release and integration native callbacks use
explicit fixtures; these do not establish installed-role SSH/PAM/cgroup or real
privileged elapsed-deadline release. No new remote bundle, host installation or
production capacity is qualified. The last host guard was BUSY; no new remote
operation is attempted here.

Saved-source C18 and retained-authority C16 remain pending decisions. Neither is
implemented/enabled here. C14 does not fix heartbeat lockouts or preserve shells
through lockouts. All production/student state and protected history remain
untouched. Future migration/rollback and three-agent plus independent-practice
owner consolidation are proposals only in todo-rollout-plan.md.
