# One student list per exam

November 2, 2026. Implemented, tested and release artifacts qualified locally at
`e5e10f305dd02619d0e936b198b459b07e68e669`. No production changes, push or deployment.

The dashboard counted usernames from exam setup and historical attempts, while
the web/CLI roster and CSV export counted only the old setup rows. This made the
same midterm appear to have70 students but only66 selectable students. The four
missing setup records exist under midterm-recovery. The private audit confirms
these exact four students were transferred to recovery on October20 and their
original attempts were subsequently returned to midterm. Their original midterm
setup records were not restored along with that history. No normal student-removal
audit exists for them. This was incident-recovery bookkeeping, not course removal.
Read-only evidence is retained under
`var/collection-tests/exam-student-list.20261102/incident-audit.stdout`; names, UID
values and individual allowances stay out of this document.

Approved policy: a student with any attempt or permission remains in the exam's
student list. Remove student works only before either exists. Cancel next attempt
controls another start; it never alters started attempts, deadlines or holds.

Dependency-ordered milestones and acceptance:

1. Use one read-only exam-student catalog (legacy setup rows, attempts and this
   agent's permissions) for dashboard, paginated CLI/API lists, CSV export and
   selection. All70 students are selectable; editing next attempts explicitly
   reports66 editable permissions and four students without one. No enrolled/not
   enrolled distinction appears. Reads create no access, grant or clock. Test
   actual HTTP listing/export, browser selection, scope/pagination and refusal
   to remove a student with history or permission.
2. Allow attempt for a known student with missing legacy setup metadata through
   the existing reviewed issuance workflow. Validate every target and saved source
   first, then restore UID0 compatibility metadata and issue/replace permissions
   atomically with an audit. A read or preview must not restore sign-in or revive
   an earlier permission. Test stale batches, rollback/retry, saved-source pending
   verification and unchanged history, deadlines and account restrictions.
3. Exercise the installed local CLI against its synthetic TLS fixture, including
   all70 identities in JSON/TSV/CSV, then affected application/browser suites,
   fixture types and production build. Update design/operator docs and checkpoint;
   commit coherent validated changes locally. Push/deployment require a new
   explicit instruction.

The compatibility admission rows remain internal. Do not blindly backfill them or
replace admission checks with catalog membership: old deliberate removals must
not reactivate an unused permission. No schema migration is planned.


State/authority review before affected qualification: the catalog introduces no
stored state. Compatibility metadata restoration shares the existing SQLite
confirmation transaction with permission issuance, replacement and audit; failure
rolls the whole operation back. Existing review expiry/cancellation and exact
request-ID retry remain authoritative. Saved-source permissions still enter the
existing inspectable/cancellable/retryable pending-retention workflow, reserve no
account or clock and require native confirmation before use. Metadata cannot
replace authenticated UID verification, restart completed attempts, alter deadlines
or bypass admission, claim, archive, monitoring or account-hold checks. Focused
refusal/retry, changed-source and repeat-confirmation checks cover these boundaries.


Deployment/migration/rollback plan (not executed): build and qualify the matched
schema37 web image and CLI from the validated commit. The current deployment
controller now has the narrow, locally qualified
`unified-exam-student-list-v1` scope for this policy change (37 workflow cases).
Preserve the
existing zero-session/zero-active-exam guards, signed native readiness and all41
authority-table checks. Take a fresh database/small-file snapshot, reusing only
verified warmed recording objects; fence admission and restart only the web
service. No database backfill, native binary/service change or exam permission
issuance is part of deployment. Acceptance compares all70 student identities and
read-only counts across the interfaces, verifies exact public assets/help and
checks native/configuration/history preservation. A prior reader permits the old
removal policy, so declare it incompatible for public reopening: any rollback
preserves CURRENT data behind maintenance until a compatible forward repair is
available. Never restore an older database or issue attempts as a smoke test.


Final review also caught legacy Add student/CSV paths that treated missing setup
metadata as a new student. They could reuse old permission while recreating access.
The correction must refuse an already-known student on Add, and reject CSV repair
both at preview and fresh confirmation before any write. Actual new students and
existing complete setup records keep their documented import behavior. This is an
admission safeguard, not a return to separate visible student lists. Targeted
regressions include a mixed batch and history/permission appearing after preview.


Verification completed for the feature:

- The final full application run passed763 cases, with one intentional opt-in skip
  and one stale duplicate-Add400 assertion. That assertion now requires409 plus
  Allow attempt guidance; its complete five-case SSH identity file passes. Thus
  all764 non-opt-in cases pass across the full/focused receipts, not an alleged
  completely green repeat of the full suite. Earlier three stale policy/text
  failures were corrected and their22 affected cases passed before this final run.
- New public HTTP coverage checks identical70-student lists/CSV, inert reads,
  history/grant-only membership, permanent-removal refusal, atomic reviewed new
  permission, stale-source/batch refusal and Add/CSV non-restoration races.
- Actual signed root-mapped CLI/TLS covers17-item pagination and all70 identities
  in JSON/TSV/CSV/export, saved settings and refusal safeguards. The CLI package
  race suite passes27.066seconds; native agent/core binaries are unchanged.
- Node-mode public browser checks pass91 affected scenarios, six focused bulk
  scenarios and the corrected keyboard-removal scenario. A separate retirement
  follow-up passes four new70/66/malformed-list cases and five real-HTTP workflows
  plus the public70-student selection. Types and fresh frontend/build pass. These
  admin UI cases do not claim fresh native/WASM exam-protocol qualification.
- Actual repository deployment-controller tests pass37 workflows, including the
  three newly scoped cases. Privileged host transport remains mocked here;
  unchanged prior real nginx/signed-startup timing evidence is reused explicitly.

Detailed receipts: `var/collection-tests/exam-student-list.20261102`,
`historical-student-grants.gh8f0xum`, `known-student-cli.cuecpvds`,
`permanent-students-policy-fixtures.oy8uha8e`, `unified-student-cli-race.5jbi33vh`,
`unified-student-browser.3yolmtls` and `canonical-retirement-browser.8b5bj03h`,
all below `var/collection-tests`. Original failures and fixture corrections remain
alongside the final evidence. No production student permission was issued.


Exact release packaging is complete at
`var/collection-tests/exam-student-list-image.z06tc__w/completion.json`.
The image Config is `57eadb81064d5642f9b8cc602c59462ca54b508631dc94eecac3fd8e9d9f4c2e`;
its295,859,712byte archive binds the actual exported Config/rootfs identity.
All180 image inputs and363 CLI source paths match committed bytes. The static
Linux/AMD64 CLI is SHA256
`f772edfc022dea5ae2b247b61ade4adb5ac2f75d5a327e2103020df59b8e1989`;
actual help and embedded source revision pass. Its modified flag reflects only the
ten preserved documentation screenshots. Exact-image startup retains all41 old
schema37 table rows, prior attempt/settings, protected/video artifacts and native
boot-clock enforcement, inventing no permission. The private smoke container,
derived image and synthetic keys/data are removed. Shipping WASM/runtime hashes
match the earlier qualified release; local toolchain-generated WASM differs and is
not the packaged binary. Non-WASM image assets match the fresh browser build.
The newly corrected retirement dialog passes its nine workflows and a joined
70-student selection check without repeating unrelated browser scenarios.

The candidate contains local release/location plans and exact helper hashes.
Fresh production inventory, native/history/configuration pins, an idle drain and
current backup coverage must be rechecked under a new deployment instruction.
No upload, production directory creation or student permission issuance occurred.
Do not rerun historical temporary agent-consolidation steps: this update retains
all existing native services and needs only the matched web/CLI installation.
There are no remaining policy decisions or local feature blockers.
