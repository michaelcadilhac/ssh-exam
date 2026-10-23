# Unified grants: first ordinary attempt milestone

Local development only, not deployed. Approved policy: C1/C2/C5/C15; initial
settings snapshot at enrollment/import. C17 legacy recovery allowance
synchronization is validated/committed locally as32e1eec; C16 authority
placement is an independent open question, not a global blocker.

## Integrated acceptance boundary

Actual entry points: web/`examctl web students add` and CSV confirmation; web/
`examctl web grants` inspection, explicit unused revision and revocation; student
SSH login → preflight → Begin; authenticated native outbound grant verification.
Deliver the first ordinary grant end to end. Do not stop at additive tables or
unused protocol helpers. Additional grants/work choices, reviewed legacy bulk
issuance and sandbox repeat issuance follow as separately integrated increments;
retain existing ordinary uniqueness/account-hold enforcement until their one-use
replacement is tested. No student-record migration/backfill during schema startup.

## Dependency order and acceptance

1. Add immutable revision, preparation and Begin-intent records. Shared new
   enrollment/import saves exactly one initial settings/material/work snapshot
   atomically; retries cannot resnapshot defaults. Require the approved finite
   Begin window and exact authenticated template version. Existing legacy
   enrollments/history remain legacy, not invented issuance-time snapshots.
2. Shared web/root grant list/show/history/revise/revoke with useful help/errors.
   Explicit revision/revoke refuses an unresolved preparation/Begin, rather than
   claiming withdrawal while old authority could still start. Default/roster
   edits do not revise issued grants. First issuance starts with exact template
   work; later empty/saved-work choices are not implied by this first boundary.
3. Bind student preparation to the selected initial grant/revision/settings/work.
   Old native roles refuse a distinct grant-aware purpose before execution.
   Confirmed cancelled claims remain history and release only after native
   no-start/policy evidence; timeout alone never refunds or releases authority.
4. Reserve one durable Begin intent. Native freshly verifies it over existing
   authenticated outbound HTTPS, outside shared state; check identity, revision,
   window, monitoring/owner and exact snapshot again before original native
   interval/hold publication. Missing verification starts no clock. Unknown
   outcome retains the original intent/attempt; exact retry reconciles its
   interval rather than creating another allowance. Preserve consumption/history.
5. Review all new durable states before broad qualification: inspection, cancel,
   expiry, crash/restart, stale reply, mixed-version refusal and admission bypass.
   Native preflight expiry still bounds account reservations; lost Begin replies
   need positively fenced no-start, never an automatic timeout refund.

## Required tests and evidence

Focused shared HTTP/TLS/actual CLI enrollment/CSV/retry/settings/revision/revoke;
student synthetic SSH/preflight/Begin and snapshot changes; signed native commands
plus real authenticated outbound TLS verification with injected outage/replay/
wrong-owner/stale revision/cancel/expiry/duplicate-Begin faults; native setup seams
disclosed, real private staging/publication/consumption where affected. Browser
enrollment/grant controls/student Begin with old-role refusal. Then full affected
application/integration/native race/resource/build/typecheck/browser suites at the
coherent boundary. Preserve the existing uncommitted screenshot and use per-test
image output. Commit validated increments locally and continue independent work.

## Implemented/tested locally (October23; not deployed)

Shared enrollment/add and NEW CSV rows issue an immutable initial ordinary grant
in their existing transaction, before enrollment publication. Require an exact
attested material/starter version and finite explicit Begin window. Missing source
configuration rolls back enrollment/audit/issuance together. Initial issuance is
one per agent/exam/student; reenrollment never invents another allowance. Existing
legacy enrollment/history is not backfilled. Sandbox and additional grants remain
separate pending increments. Ordinary uniqueness and account-busy/access-hold
constraints have NOT been relaxed.

Migration023 adds grant/revision/claim/Begin-intent and metadata request records,
plus attempt bindings. First issuance activates a per-exam new-enrollment writer
fence. In that exam an old writer cannot enroll a new unused student without
atomic issuance, or insert a legacy attempt for a known grant. Existing legacy
history/enrollment remains usable without fabricated issuance-time settings.
Grant-backed attempt settings/bindings are immutable. No existing student record
is backfilled, converted or deployed by schema addition.

`examctl web grants help` / `examctl help grants` expose list/show/history paging,
explicit unused revision and revocation, named default-deny root authorization,
audited reasons, current-revision CAS and durable identical-request retry. Web
student actions use the same authority. Omitted settings remain saved values;
default/enrollment edits never revise issued grants. The portal and preflight show
the saved settings even after defaults change. Preflight may precede earliest
Begin; expired grants cannot allocate a new preparation. Only actual Begin is
window-gated, never an intersection with later definition defaults.

Native distinct signed prepare/Begin purposes bind grant/revision/hash, full
settings, actual account/transport and exact private workspace receipt. First
verified claim retains UID across cancellation; neither web nor native may
silently rebind it. Native Begin uses existing pinned outbound HTTPS/root Ed25519
authentication, originally distinct grant-begin/v1 purpose (superseded locally by
challenged grant-begin/v2; see challenged-preflight-capture.md), fresh nonce/expiry and exact
owner/boot/intent scope, outside the shared state lock. Unavailable/wrong/stale
verification starts no clock. Commit rechecks the same source/settings, command/
verification expiry and Begin window after final metadata IO, using the actual
sampled start timestamp. Native start/hold/one-use history is authoritative.

## Durable-state/failure review BEFORE first broad qualification

- Issuance/revisions/mode: bounded CLI/web inspection, explicit unused CAS/revoke,
  retained immutable revision/actor/reason history. No permission, account claim,
  clock or automatic expiry refund from those metadata rows. Enrollment removal
  keeps authority/history/mode. Supplied settings freeze at issuance; inheritance
  is resolved then, not during later default edits. Failed batch transactions
  publish nothing. A revoked/consumed grant cannot become AVAILABLE by reenrollment.
- Claim: created atomically with its web preparation; existing native preflight
  lifetime/cancellation bounds apply. Claim history keeps exact UID/revision/hash
  after positively confirmed cancellation, not deletion/refund by timeout. A later
  UID change refuses for reviewed NEW authorization. Native retained attempts
  independently fence identity changes and committed consumption, even if web
  metadata is stale. An unresolved claim blocks unused revision/revocation.
- Begin intent: one durable original UUID/transport per preparation. No clock/
  execution permit from PENDING or verified_at. Exact retry reuses it; fresh
  signed verification is required before an unstarted native Begin. Restart/lost
  reply never creates another interval. A committed native start reconciles its
  original intent/start/deadlines without requiring another permission exchange.
  Actual start may be followed by publication failure; that committed interval
  is consumed/history, NOT refundable or a fresh-preflight failure.
- No-start/monitoring: cancellation needs exact native UUID/exam/user/UID and
  normal policy restoration. Missing identity, claim history, consumption state
  or independent Begin start/deadline evidence blocks confirmation/retirement
  BEFORE monitoring deletion. Recheck within retirement transaction. The prior
  native absence fence also rejects workspace/submission/legacy consumption
  contradictions. Missing canonical rows/timeouts alone never prove no start.
- Private work/receipt: exact grant binding is part of staging/protection fences.
  Missing or changed receipt/source refuses; no template/latest fallback, live
  recopy or buffers-as-saved-work inference. Legacy saved-work authority conflicts
  with this initial-template workflow rather than silently changing initialization.
  Private abandoned work stays for approved manual C4 proof/cleanup, not auto-delete.
- Compatibility: new purposes/capability and known-grant SQL writer fences reject
  unsafe downgrade admission. Staged new receipts have a field older strict
  readers reject. This is NOT permission to run an older native writer against
  new canonical state: ALL native writers/watchdogs/forced-command helpers,
  including the three temporary agents, must be coordinated after full drain.
  An old native writer may drop unknown state fields; old-native downgrade with
  new/pending authority is unsupported. Keep admission closed and use compatible
  forward repair; no mixed-writer or installed-role qualification is claimed.
- Restore: retain DB/WAL/FKs, request/mode/revision/claim/intent history and native
  tombstones/one-use fields/protected archives together. Do not restore earlier
  AVAILABLE or UID/revision state over newer consumption. Contradictory interval
  evidence refuses cancellation/new claims/revision rather than erasing history.
  Native significant transitions remain durable; starts still get ordinary
  monitoring/deadline/access enforcement. This does not enable C3/C9 retained mode.

## Focused evidence and limits

Actual compiled root-mapped CLI/TLS + shared HTTP roster/grant checks pass15 cases
7.18s (later current-interface combined run26 cases52.11s). Current signed SSH
student/recovery/UID checks pass12 cases52.34s. Native signed command/real private
staging/authenticated outbound TLS/restart/one-use/UID races pass core12.911s/
CLI1.563s. CLI help syntax/refusal checks pass1.199s after fixing the explicit
`web grants help` entry point. Matching build/typecheck pass. Two actual rebuilt
Chromium workflows pass16.7s: initial settings through real WASM SSH/fresh Begin/
Finish; and real CSV/enrollment/unused revision/revoke with the first revision
reply lost and exact UUID/body retry. Screenshots use per-test output.

Independent-consumption-before-purge mutant is RED5.03s: monitoring row count
falls from1 to0. Guard restored, canonical11-case student/recovery run passes
45.35s before the later UID addition, then the current12-case run passes above.
The final commit-boundary regression is RED6.761s: command expiry, verification
expiry and window closure all reached the exact late-metadata boundary and still
started clocks. A final sampled-time fence now corrects that; current final
focused races pass core19.564s/CLI1.749s BEFORE broad qualification. Retain the
failure logs, not as passes. Current combined interfaces pass26 cases52.11s;
CLI guidance passes1.199s. An affected lifecycle run exposed eight fixture
failures: incomplete cancellation identities, empty source definitions for NEW
enrollment and historical attempts seeded after re-enrollment. Exact identities,
synthetic source attestation and correct legacy history ordering preserve the
original oracles; those32 checks now pass13.26s. Typecheck passes.

Fixture corrections: bad template counters failed before intended404 RED;
corrected synthetic metadata then reaches the missing workflow. Store.attempt
throws for absence, so the retry oracle was corrected. The mock must preserve
native cancellation tombstones instead of recreating the same UUID. A consumed-
evidence conflict correctly returns409. Existing clock/roster fixtures now seed
their claimed preexisting legacy history BEFORE reenrollment; new students use
an exact attestation. No real enforcement guard was disabled to obtain a pass.

Native OS home/readiness/account activation are explicit test seams; immutable
template verification/private staging/publication and signed TLS are real.
Browser SSH uses synthetic hosts/native control, not installed SSH/PAM/cgroup
qualification. No csc-sys/production action, migration, deployment or clock/student
change is claimed. Current logs: `/tmp/ssh-exam-initial-grants-*.log`.

The state review was completed before broad launch. All focused checks above
finished and were reviewed before the separate broad launch. Native advertises
ONLY initial-grant protocol support, not retained authority/SSH or complete
unified migration. Full native race/resource/namespace/compiler/default-size
qualification passes core346.922s/CLI42.618s. Matching native static build/vet,
gateway/WASM build and typechecks pass. Eight final rebuilt Chromium checks pass
59.5s: saved-grant portal/WASM SSH/Begin/Finish, enrollment/CSV and grant revision/
revoke at430px, immutable source, both1280/430px existing settings, fifteen-minute
preflight expiry and both real-SSH cleanup paths.

The first broad application run passed457 tests but failed one old identity
fixture: NEW enrollment used an empty exam definition. The fixture now supplies
an exact synthetic attested source and finite window, preserving its original
no-account-list/UID0/live-identity assertions. All five focused identity tests
pass8.99s. No application/native enforcement changed for this fixture correction;
the final full application run passes458 tests/88 files159.32s. Existing matching
native/browser evidence still applies because only that synthetic test setup
changed afterward. Formatting/diff checks pass. This integrated milestone is
ready for its coherent local commit; nothing is deployed. Continue with extra/
work-source grants, reviewed legacy issuance and sandbox snapshots; the broad
grant TODOs remain open until those scenarios pass.
