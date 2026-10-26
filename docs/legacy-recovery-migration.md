# Reviewed native legacy recovery migration

October26,2026. Partial local candidate in the isolated legacy-recovery-revocation
worktree, committed286acd9 and locally validated; PUBLIC web qualification and
broader migration remain incomplete. Not deployed.
Baseline076a5c1 now aligns catalog uncertainty with Begin's UID fence. Public
retained release1641c8b is independently qualified; this management migration is
not a new prerequisite for retained SSH.

## Confirmed boundaries

`recoveryReference` refuses a unified grant while a native legacy record exists.
Deleting the record is unsafe: absence can select starter work. Both catalog and
admission use a strict known-field parser. The canonical cancellation envelope preserves exact original bytes and a
validated receipt. Older strict readers refuse its purpose; permissive old readers
obtain unusable zero identity/allowance fields. A sidecar alone is insufficient: old
admission readers would ignore it. Revocation must remain irreversible; corrections
use a reviewed NEW unified grant, never reopening the old one-use authorization.

Unused is not enough for mutation. Preview/confirmation must reject consumed or
uncertain intervals, pending allowance publication, outstanding preparations and
contradictory durable workspace/submission/consumption evidence. A missing row
alone cannot prove no start. Preserve all files and return exact inspection/repair
commands on unknown/busy state. Existing per-UID/catalog locks are nonblocking;
old manual root writers must be quiesced. No clock, account disposition, process
termination, submission deletion or enrollment-time settings backfill is allowed.

## Approved handoff: cancel first, then issue the replacement

The smaller workflow is explicit revoke-then-issue: `recovery-grants revoke-preview`
and a revision/reason-fenced `revoke` permanently close ONLY a reviewed unused
legacy authorization. Existing reviewed NEW unified issuance then chooses saved
source/settings/finite Begin window, with class-server durable source retention
before availability. Operators can inspect each result and retry lost replies;
the student has no usable grant between revocation and successful issuance. A
failed replacement cannot reopen the old authorization or fall back to starter
files. Source/attempt history and independent account holds remain protected.

The alternative is a joined replacement: stage the NEW unified grant and verify/
retain its source, durably revoke the old authority, then make the replacement
available. This avoids revocation before a replacement is ready, but introduces
an explicit cross-authority handoff state, cancellation rules and stale-completion/
restart proof. It must never leave an indefinite account reservation or permit
both authorizations to start. It cannot be called a transaction across two hosts.

The instructor approved the explicit two-action workflow: cancel the old unused
permission, then create the replacement. Use existing supported issuance rather
than adding a compound protocol. Initial CLI cancellation and focused
refusal/crash tests pass locally; no production permission has been cancelled.
Existing ordinary recovery remains functional until explicitly cancelled under
the future reviewed workflow. The joined alternative above is deferred.

## Bounded implementation and acceptance after decision

Public entries must include discoverable root CLI preview/revoke/inspection and
matching web status via authenticated native acknowledgement; full migration is
not complete at a private parser/helper or native-only status. Shared reviewed
NEW issuance remains the sole replacement model. Legacy definition reconciliation
must preserve its native-unreconciled fence until all authoritative dependencies
are positively accounted for; no flag clearing or metadata deletion shortcut.

Exercise actual compiled CLI/root namespace and signed web/TLS: unused success,
consumed/uncertain/prepared/pending/contradictory evidence refusal, stale review,
changed source/identity, audit/publication failures, lost reply/restart/idempotency,
old-reader refusal and delayed old prepare/Begin. Then actual joined NEW saved-work
preflight (zero clock) → full chosen allowance at Begin → protected export, with
original records/intervals/holds intact. Bulk review must bind each exact account/
source/settings/window; no historical snapshot is invented. Requalify affected
native/application/browser interfaces at that coherent milestone; production
migration/rollout/rollback remain proposals only.


## Concrete native cancellation format and finite implementation plan

Use a dedicated canonical revocation envelope, not a sidecar and not merely an
extra ignored field. Preserve the original JSON bytes in bounded base64 plus
its SHA256 and a strict reason/review/time/root-actor receipt. The envelope has
no top-level legacy exam/user/UID/duration/source fields: even a permissive old
JSON decoder obtains invalid zero identity/allowance and must refuse its existing
required checks. Strict old readers refuse the purpose. The file remains present;
no missing-file starter fallback is introduced. New readers strictly validate the
envelope, original16KiB record and hash, with a bounded32KiB envelope. Original
intervals, grants, protected archive bytes and account policy are unchanged.
This is an implementation refinement; the approved two-action policy is settled.

Public entries: `recovery-grants revoke-preview EXAM USER` and
`recovery-grants revoke EXAM USER --review HASH --reason TEXT`, with list/inspection
showing revoked history and exact lost-reply retry returning the stored receipt.
Use per-UID/catalog nonblocking fences and fresh safe state/catalog/orphan evidence;
reject prepared/consumed/uncertain/pending authority, unknown workspace/submission
folders and contradictory live publication/initialization/consumption on no-start
records. Do not rely on a missing canonical row or a permissive unused label.

No durable pending reservation is needed: write/fsync a private temporary record
outside the catalog, check returning/fsynced audit, recheck review/no-start proof
under fences, atomically replace the canonical file and sync both directories.
Before replacement the original grant remains in force; an abandoned temp is
non-authoritative and cannot reserve an account. After uncertain completion,
inspect/retry the SAME review/reason; never silently adopt a new target. Preserve
crash residue for bounded supported diagnosis. Old ad hoc writers must be quiesced.

Legacy preflight/reconcile/Begin must refuse revoked records before a clock or
starter selection; explicit valid NEW unified grants may use their own selected
source after revocation. Unified saved-work availability still requires durable
native retention, and all historical holds/access disposition remain separate.
Revocation may remove ONLY this unusable old grant's source-deletion dependency;
independent holds, new pins, unfinished restored work and normal verified manual
submission retention still apply. Revocation itself deletes no source or workspace.

Exercise actual root-mapped CLI, stale/audit/write/restart/idempotent refusals,
old permissive/strict-reader controls and contradictory durable evidence first.
Then integrate native root qualification: create synthetic old authority in the
same target exam, revoke through compiled CLI, reject delayed old preparation/
Begin, issue/sync the reviewed NEW saved-work permission through existing web/CLI,
zero-clock preflight/full allowance at Begin and protected exact files. Do not
close C8 reconciliation or general migration merely because revocation is tested.
This path is a release compatibility gate for remaining unused native grants.
It is partially implemented, with the joined replacement qualification still open.


## Current bounded candidate and state review

Public root CLI preview/revoke/list, conservative no-start proof and atomic
canonical envelope are implemented in the isolated branch. Focused core and actual
root-mapped CLI tests pass: stale/refused review; consumed/pending/prepared/renamed
start; orphan/published work and contradictory submission; unsafe audit; matching
NEW grant versus wrong UID/late legacy evidence; exact lost-reply retry. Actual
SIGKILL at staged/audited/published/before-source-directory-sync/fully-synced
boundaries preserves canonical inspectability, original bytes/intervals/holds and
protected source. Same-intent restart/retry completes both directory syncs. This
is process-crash qualification, not a power-loss test or joined deployment.

Review snapshots now include sorted blockers, so repairing a refused preview
requires new review. Revoked identity and contradictory markers/starts still
refuse admission; valid independently signed NEW sources use their own authority.
Strict envelope cases reject duplicate/null/alias/unknown/trailing/oversize fields,
invalid times/hash/actors and noncanonical base64. Exact old JSON bytes survive;
older strict/permissive-reader controls fail closed. A valid envelope seeds the
existing parser fuzz target.

Before publication the original permission remains authoritative; private temp
residue outside the catalog grants nothing and reserves no account. Durable audit
precedes publication. After publication inspection shows irreversible cancellation;
only the same review/reason repairs uncertain durability, with no receipt change.
No clock, source deletion, process action or hold release occurs. New grants still
need their own durable source retention and fresh Begin verification. Expiry and
cancellation of those grants remain the existing workflows. All contradictory
canonical/workspace/submission/consumption evidence is checked before broad runs.

Retained failures: review-red and envelope-red reproduce candidate defects before
fixes. The first extended CLI fixture restored equivalent JSON by serialization,
invalidating its final byte oracle; corrected cleanup restores the exact original
bytes. Refusals themselves already preserved each test's authored bytes. Logs:
/tmp/ssh-exam-revocation-{review-red,review-green,envelope-red,crash-focused,cli-refusals,cli-refusals-fixed,cli-focused}.log.

NEXT: complete current focused CLI/core checks and supported refusal guidance;
exercise delayed old preflight/Begin refusal and actual cancellation→existing NEW
saved-source issuance/zero-clock staging/full chosen Begin/protected export. Then
run affected/full native-race/CLI/build checks and fresh guarded exact-artifact
qualification. Native dependency acknowledgement for legacy definition retirement
and the complete web migration remain separate open acceptance; no TODO closure
is implied by this initial cancellation workflow.


Current broad qualification: focused current native review/crash/parser1.306s and
CLI/help2.235s pass;80 Python safety checks pass5.966s after using the required
local-listener permission (the first restricted run's11 socket errors are retained).
Full native race/resource/namespace/compiler/default-size run is active. Its CLI
package passes24.048s, but the two512MiB collection benchmark observes one legacy
renewal3.9908s over the unchanged3s disk-IO bound; both collections/31 renewals
otherwise succeed. Cause unclassified, not blamed on cancellation or discarded.
Finish/inspect the runner, then focus that case alone before advancing. The new
guarded driver joins actual cancellation of a synthetic60-minute permission to
the existing separate NEW saved-source/full90-minute Begin/protected export case;
no root execution/new native artifact is claimed yet.


The first full native run completed: CLI24.048s PASS; core582.003s has only the
recorded legacy-IO benchmark failure. Its isolated unchanged-bound repeat passes
39.018s (renewal2.035s/inspection2.263s). A final complete package-serialized repeat
is running; native source inputs are frozen. Current CLI --json compatibility and
help pass1.687s; types and80 Python checks pass after explicitly updating the
existing mocked source-envelope test. Actual guest proof still remains. Both the
root driver and existing PUBLIC C7 browser workflow now include cancellation of
an exact synthetic60-minute old permission before their separate NEW saved-source
availability/staging/Begin/export workflows. Native parent directory modes are
asserted individually; no existing permissions are repaired. Root artifact/upload
has not occurred yet. This extends existing integrated callers, not a new runtime
protocol or a deployed capability.


Final complete native repeat PASS: CLI19.828s/core577.997s, zero failures. Packages
run serially; the actual simultaneous two512MiB workers and all original acceptance
bounds remain. Its maximum renewal2.467s/inspection2.170s pass. All333 frozen native
inputs match after completion; README documentation added afterward changes no
runtime.25 skips are root-guest/installed-environment or child entrypoints; those
are not claimed as host-root qualification. Build/vet/types/Python80 pass. The
original3.9908s benchmark failure remains retained and its initiating storage
variation is not proven. Logs: /tmp/ssh-exam-revocation-native-final.jsonl,
revocation-concurrent-repeat.log, revocation-build.log, revocation-vet.log,
revocation-types.log and revocation-python-final-fixed.log in /tmp/ssh-exam-*.

Next milestone boundary: commit this locally validated CLI/workflow increment,
build its exact immutable binaries, then qualify BOTH guarded root90-minute and
PUBLIC web20-minute saved-source replacements. Do not mark that integration or
migration complete before those interfaces run. No new production authorization.


Exact committed native candidate286acd9 is frozen at MAIN
var/collection-tests/legacy-revocation-artifacts.8eegzvz6 (sibling .source.json).
Agent49b0a7e101151d8d7cf6f949ae33237e781635912fdd7e13c4dd96c3d2faa421;
core125b205cb1e1f4c77c90a2960b6097ef713f936267b22839987a934062bec234.
Build records VCS286acd9/modified=false.18 files/63,687,566bytes were audited code-
only; user explicitly approved their exact digest/private destination after tool
review rejected reuse of the earlier bundle's consent. Upload86118 verifies all
files at /var/tmp/ssh-exam-browser-native-upload.revocation286acd9_835ac9c4d31d43da.
No keys/config/env/student data/submissions crossed that boundary.

Guarded root52816 PASS43. Actual CLI cancellation/exact retry and delayed signed
old preflight/prepare refusal consume no clock/reservation; separate NEW saved
source availability, zero-clock staging/full chosen90min Begin, exact archived
Nano bytes, protected completion, pin retirement and independent account hold pass.
Existing actual writer/SSH/editor/linked-IO/clock/fault controls also pass. Guest
3xpz5gxp/unit99a51ef0fe9e4c9db7eb578013414e8b independently exit0, files/base/host
attempt authority unchanged and inactive. Capture/test-role adapter is explicit;
this is not yet the updated PUBLIC browser workflow. Logs:
/tmp/ssh-exam-revocation-{artifact-build,upload,root}.log. No production action.
