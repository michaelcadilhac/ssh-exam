# Unified grants: first ordinary attempt milestone

Local development only, not deployed. Approved policy: C1/C2/C5/C15; initial
settings snapshot at enrollment/import. C17 legacy recovery allowance
synchronization is now approved and being qualified independently; C16 authority
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

Current status: inspected existing roster/admission/uniqueness/template catalog,
signed management and native deadline-verification interfaces. Implementation in
progress; this plan is not issuance/admission implementation or qualification.
