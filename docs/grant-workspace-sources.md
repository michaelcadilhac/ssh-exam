# Independent grant workspace sources

Local investigation/development, October 24, 2026. Nothing deployed.

The validated first C18 increment (bcc88e9) provides reviewed saved-source issuance through the real
HTTP API, compiled root-mapped examctl/TLS and instructor browser. Issued grants
remain PENDING_NATIVE. They fix the archive/checksum, allowance, webcam and finite
window immediately; no claim, account reservation, clock or history changes.
Confirmation retry reuses the same grant; inspect and revoke work after restart.
Eligibility requires that student's completed protected attempt and exact checksum.
That increment did not implement native retention/synchronization or saved-source
Begin. Those are wired in the current candidate below, awaiting full qualification.

Verification: all28 affected HTTP checks PASS151.23s; actual compiled CLI workflow
PASS7.20s (/tmp/ssh-exam-saved-source-real-cli-final5.log); two rebuilt real-WASM
browser workflows PASS17.2s (/tmp/ssh-exam-saved-source-browser.log); matched build
and typecheck pass. Final CLI races PASS1.367s and typecheck PASS after formatting
(/tmp/ssh-exam-saved-source-final-cli-races.log and final-static.log). The real
CLI test found missing --work-attempt/--work-checksum entries in the global argument
sorter; these now have a regression. Prior fixture failures (missing import,
source history inserted after grant-mode activation, history-free helper count)
are retained in the local logs. The corrected fixture authors protected history
in a separate namespace before issuance; no SQL fence or history was removed.

Pending-state review: physical PENDING_NATIVE is excluded by existing AVAILABLE
claim/admission checks. It never starts time or reserves an account; expiry cannot
create availability. Explicit revision/revocation and original idempotent review
remain inspectable. There is no native pin yet and no deletion-side claim in this
increment. A later native acknowledgement must bind the current exact revision
and cannot revive a revoked/revised/expired grant. Unknown native outcomes must
remain pending, not infer success from a missing record.

Bounded end-to-end target: existing additional-preview with --work saved and
exact protected --work-attempt/--work-checksum, reviewed issuance, durable class-
server retention confirmation, then student staging/fresh Begin with the full
chosen allowance. A supported explicit root CLI synchronization step uses the
existing signed outbound management identity. No student SSH, inbound native
listener, general command polling or new daemon is assumed. Web pending state
must offer inspect/cancel/retry and explain the same CLI completion workflow.
Native deletion must consult the durable pin under the existing source/catalog
lock. Verification runs outside shared state and the shared agent; source checks
may not crash or block every student's coordinator. Preserve original archives,
history/UID bindings/limits and finite settings. Root pins are data retention,
never account reservation or execution permission. Revocation/revision/consumed
release needs matching positive evidence, including all linked native consumers
and contradictory workspace/submission/consumption checks. No timeout releases
a source. Existing staging/publication/one-use/metadata barriers are reused.

## C18 individual workflow and state review (October24; tested locally)

Current runtime entries: instructor saved-source preview/confirm -> root
`examctl web grants source-sync GRANT --revision N` -> student preflight/staging/
fresh Begin. `source-show` inspects the durable native pin without hashing work.
The same signed outbound agent identity has explicit grants.source-plan and
source-confirm authorization. No student connection, root control listener,
general command poller or new daemon is required for native confirmation.

031 keeps immutable per-revision native acknowledgement history. Root source-sync
verifies the actual protected archive/manifest/UID outside the shared agent,
writes a private pin and independent initialized/known markers, fsyncs file and
directories, then acknowledges. Only an exact current acknowledgement promotes
PENDING_NATIVE to AVAILABLE. Failed/lost replies preserve data and retry the same
revision. A later release is a NEW confirmation intent. Pending grants count as
unused dependencies in definition-retirement review; none reserves an account or
starts a clock. Source settings/window/camera stay fixed, independently of current
default edits. A changed authenticated Unix UID refuses before web/native claim.

Native consumer UUIDs are registered before canonical preparation. Foreign
history, orphan work and cross-grant UUID reuse refuse. A consumer link is data
retention, never permission. Private saved staging binds the exact grant/source
and retention hash in the existing receipt; full hash/metadata verification and
both source/target limits still apply. Unified grants use their existing C15
canonical one-use interval, rather than legacy recovery consumption marker files.
Legacy authority/storage/consumption guards are unchanged. A native legacy grant
still conflicts until reviewed migration; this candidate does not silently retire
or convert it. There is no source fallback, refund or reopened historical attempt.

Retirement has retained -> closing -> released phases and retains its exact
positive fresh gateway retirement plan. Closing blocks new consumers and keeps
the archive pinned; a started recorded consumer may still repair its original
publication. Release requires every linked native consumer to be either freshly
protected/verified COMPLETED or a positively cleaned no-start tombstone, with no
contradictory clock/owner/work/submission/consumption evidence. Missing rows alone
refuse. No timeout releases a pin. Partial publication/lost markers are inspectable;
known-record loss refuses instead of recreating missing consumer history. Exact
JSON shape rejects aliases/nulls/unknown fields; FIFO/link metadata refuses without
blocking. Released records/history persist and stale retain plans cannot revive
them. Account holds, submission retention and manual workspace cleanup are separate.

Focused evidence: actual root-mapped CLI/TLS/full archive/lost-ack/retry/unused
release PASS1.270s; actual native deletion/consumer/loss/malformed-metadata and
signed saved staging/SIGKILL/restart/fresh Begin/protected collection PASS7.623s.
Three real student SSH/HTTP cases PASS16.21s, including old-role and UID refusal;
actual signed acknowledgement/definition-retirement HTTP PASS1.08s. Native byte
verification and gateway acknowledgement are separate interface tests at this
stage; their mocked boundaries are explicit. Earlier saved staging failures
exposed a legacy-only consumption-storage probe and receipt key whitelist;
both are corrected without removing C15 one-use or legacy fences. The crash
oracle now requires the actual SIGKILL plus its existing private receipt.

New actual root/PAM/SSH qualification uses the same retained-policy guest:
real source-sync/unused deletion refusal -> new monitored additional saved grant ->
archived Nano bytes despite a changed old live folder -> full90-minute Begin ->
protected consumer/explicit pin release with original account hold intact. The
first native source was frozen (agent SHA256
66826c1ddc90cca014881307d65b95c3a9fe82bf30c2c6f37d2c5a317950de69).
The first guest reached source-sync refusal before pinning: its synthetic plan
copied legacy settings without the exam ID required in a new snapshot. The
fixture now authors that ID; product validation is unchanged. Failure evidence
is /tmp/ssh-exam-saved-source-root-qualification.log and private
/var/tmp/ssh-exam-overlay-abyxrfn3; host/base preservation passed. A fresh bundle
saved-source-artifacts.fx82ytez changed only that Python fixture and ran
as /tmp/ssh-exam-saved-source-root-qualification2.log.42 Python tests, matched
build/typecheck/vet and two rebuilt browser workflows (14.7s) pass. Browser
pending-state acceptance now asserts the exact supported source-sync command.
The private Go-overlay mutation omitting checkGrantSourceDependencies fails both
actual public deletion routes at the explicit refusal oracle (0.601s), proving
the regression detects removal of this fence; repository code was unchanged.
The second guest passed all27 functional assertions, including the actual saved
Begin/full allowance/collection/release, then its old final runner assertion
incorrectly demanded that the new90-minute restriction be released. The fixture
now positively verifies exactly that completed/protected saved consumer, source,
pin, allowance and still-authoritative hold; all other guest work must be idle.
It never clears a hold.43 Python safety tests cover refusal of active, unprotected,
wrong-grant/UID/allowance, expired or unrelated holds; the host idle guard is
unchanged. The third fresh guest exposed a separate intermittent retained-mode
job-control defect before saved recovery: unordered stop/continue let Bash report
Nano stopped. Evidence and its bounded parent-order fix belong in
live-monitoring-runtime.md. No failed guest is counted as a full pass.
Final exact root run5 PASSES all27 assertions, including twelve Nano cycles,
all six linked-IO pairs, source-sync before availability, unused deletion refusal,
archived bytes despite poisoned old live work, full90-minute Begin, protected
consumer/explicit release and both still-authoritative holds. OVERLAY_QUALIFICATION_OK
and FULL host binaries/config/authority/base preservation pass. Log
/tmp/ssh-exam-saved-source-root-qualification5.log, session66821 completed0;
private /var/tmp/ssh-exam-overlay-b4ffkxx2. Exact bundle
saved-source-ordered-artifacts.x8di_ur3,62,304,810bytes, remote
/var/tmp/ssh-exam-saved-source-upload.lotHuS/bundle; agent SHA256
7e02717a891d5ab373ec0d2775266c248d27a7c72c135ca55135c72e6a5f3279,
core test664dc34892a32e5db0cc3d30d2e71d81804da726bb58f564ac40b215ed376244.
Capture in this guest remains explicitly synthetic; real gateway/JPEG/browser
coverage is separate.22 affected rebuilt browser checks pass1.8m (session99975
completed0). Full application103 files/574 checks PASS301.75s; full uncached native
race/resource/compiler/default-size qualification PASS core509.239s/CLI29.781s.
Logs: /tmp/ssh-exam-source-retention-application-full.log (22474 completed0),
native-full.log (96334 completed0), browser-broad.log (99975 completed0).
Final actual root-mapped CLI/TLS/catalog contention check PASS1.288s, including
private owner/mode/inode, exact signed plan receipt, no pin/ack while the shared
catalog is held and successful retry after release. A private Go overlay omitting
native flock enforcement fails at that actual CLI refusal oracle and instead
reaches retained/lost-ack publication (0.034s); neither a timeout nor missing
fixture file is counted. Receipts: /tmp/ssh-exam-source-retention-catalog-cli-final.log
and catalog-mutation.log. The final extension changes ONLY a CLI test, outside
the root artifact manifest; runtime source/contracts stay frozen. Original exact
qualified bundle remains the artifact receipt. No deployment or source-history
migration is claimed. Bulk saved issuance still needs per-student source mappings.
Before future availability, drain ALL source-blind writers and install matching
roles. Back up031, source-retentions, independent source-retention markers and
all existing interval/receipt/consumption history. Do not roll back to a writer
which cannot enforce saved sources or retention. Production remains untouched.

## Bulk saved-source workflow (October24; implemented/tested locally)

Runtime entries remain additional-preview/issue-show/confirm/cancel in CLI and
Authorize additional attempts in web admin. Additional preview now accepts
saved_sources, exactly one explicit username/attempt/checksum per selected user,
mutually exclusive with shared work. Ownership, protected completion, UID and
checksum use the existing per-row snapshot check. Nothing chooses a latest archive.
CLI --saved-sources FILE reads bounded regular CSV; its rows can select the users,
and any explicit participant list must match exactly. Web renders each student's
source pair and reviews it with their effective webcam and fixed allowance/window.
Signed CLI replies must match every requested source before confirmed output.

State review before broad qualification: no new table/native authority format.
Only existing immutable review rows and exact request intents retain the mapping.
Reviews expire/cancel without account reservation. Confirmation rechecks current
definition/enrollment/source in one transaction; if the second source loses
protection, the first issuance rolls back too. Confirmed rows stay PENDING_NATIVE
until separate existing root pin acknowledgements. A failed native sync cannot
authorize another student's work or alter a deadline. Original review/confirmation
retry after reply loss/restart never adds another grant. Changed CSV contents
cannot amend the original intent/review. Explicit revision/revoke, source deletion
fences, consumption/no-start and history rules remain. Pending grants now count in
the existing-grant warning, consistent with its displayed label.

Focused actual HTTP atomic/source-loss checks pass1.12s; affected HTTP5 checks
pass2.18s. Actual compiled root-mapped CLI against the REAL gateway/TLS passes
7.19s: swapped signed sources refuse before stdout; lost confirm/restart/exact
retry preserve reviewed sources; malformed/duplicate/oversized CSV and mismatched
participants refuse. Argument-order race check passes1.018s. Real browser bulk
review/refusal-correction/lost-confirm/revoke/history passes5.6s. Its430px review
screenshot was inspected; source hashes wrap. Earlier fixture6-to7 authored-history
count and single-grant selector failures are retained and corrected from actual
state; neither failed run counts as final qualification.

Runtime changes are limited to issuance protocol/server/UI and CLI input/reply
validation. Native core, SSH client, per-grant binding/fresh Begin, durable pins
and kernel containment are unchanged. Exact C18 race/root evidence applies to
those boundaries; no newer artifact is claimed qualified by an older bundle.
Final full application104 files/575 checks PASS298.51s
(/tmp/ssh-exam-bulk-saved-application-full.log,7318 completed0). Full CLI races
PASS22.406s (...-cli-races-full.log,65485 completed0); final typecheck/CLI vet and
matching web/server/WASM build pass. Final23 browser checks across eight FRESH
private fixture instances ALL pass (...-browser-isolated.log,62231 completed0);
per-file logs/screenshots: /tmp/ssh-exam-bulk-browser-isolated-q04h6ung. The earlier
combined run was21 pass/2 rate-blocked, not a pass: its shared instructor session
budget prevented retirement/login from reaching their intended oracles. Per-file
fixtures preserve the production180/minute and login5/minute guards. No limiter
or enforcement was relaxed; legacy browser actions now have an explicit10s bound.
Runtime code stayed frozen; no redundant app/native rerun followed fixture-only
changes. Unchanged C18 core509.239s/root27 evidence remains for those boundaries.
The local code commit is next. No deployment.

## Current model and preserved restrictions

New ordinary enrollment/import saves one initial grant in023;024's reviewed
legacy-unused issuance creates NEW authority without reconstructing history.
025 permits explicit ordered additional grants while retaining the one-unbound-
ordinary-attempt index for legacy rows, initial lineage and UID/one-use claims.
027 expresses repeatable practice as finite-window saved grants.026 records the
independent work source immutably;031 and native sidecars protect unused saved
sources before availability. Shared CLI/web issuance/revision and student
selection/preflight/Begin use those same snapshots, not later enrollment defaults.

Canonical native Begin fixes each original interval and consumption intent.
Account restrictions and protected collection are separate admission authorities:
another grant never overrides an existing held interval. Interruption Continue
resumes the SAME attempt; a new saved-source grant creates a separate attempt and
workspace. Historical attempts/submissions and legacy native recovery files/
consumption markers remain authoritative. Recovery-specific verified restoration
is reused for general saved initializers; it does not copy live work, restore
process memory, refund clocks or reopen completion. Native-only legacy authority
migration/retirement is the remaining separate workflow, never implicit conversion.

## Current bounded milestone

Entry points: `examctl web grants additional-preview` and unused-grant `revise`,
their web administration forms, then student preflight/Begin. Accept an empty
starter or an exact attested template independently of the exact materials
template. Preserve saved allowance, webcam, finite Begin window, original history
and account restrictions. Stage privately through the existing bounded worker;
bind the source in the grant, native preparation/receipt and fresh C15 exchange.
Refuse older native roles before allocation. No failure consumes time or a grant.
Settings-only revisions preserve the saved work source; source changes must be
explicit. Default new enrollment still uses the selected materials' starter.

Required checks: actual shared HTTP and compiled root CLI authorization/revision,
student SSH/preflight/Begin including tampering and old-role refusal, signed
native real staging/TLS/restart/races, rebuilt browser issuance/revision, then
affected broad application/native/build/browser qualification. Review every
durable state and contradictory no-start evidence before broad qualification.
Stop this increment at working empty/separate-template sources; saved-source
retention is a separate integrated increment using the approved choice below.

## Saved-source retention investigation (C18 approved October23)

The existing native saved-work worker already verifies a completed protected
attempt/checksum and copies its immutable archive. It never needs the old live
workspace. However `checkSubmissionDependencies` sees native legacy recovery
records and unfinished staged consumers, not unused gateway grant records.
Exposing saved-source issuance without an additional fence would permit native
submission deletion to strand an unused grant. Both root deletion interfaces
share the source/catalog locks today; arbitrary old root writers must stay
quiesced during any future cutover.

The gateway Agent.call uses a live authenticated student SSH session for commands.
Native status delivery is outbound authenticated HTTPS and explicitly does not
poll commands. Existing root management and C15 use that same outbound identity;
there is no general gateway-to-root network command route. Do not assume a live
student connection exists when an instructor authorizes recovery.

Approved October23: the class server durably confirms a source-retention reference
before a saved-source grant becomes available. Show honest pending state in
CLI/web; confirmation/retry must be idempotent, inspectable and cancellable, with
no account reservation, execution permission or started clock. A native source
pin survives gateway outages. Release needs positive matching revision/revocation
or finished-consumer evidence, never an elapsed timeout or missing web row.
This requires class-server participation before the grant is usable, and a
bounded authenticated synchronization workflow using the existing identities.

Alternative: allow issuance from retained web evidence while the class server
is offline, but require fresh authenticated gateway deletion authorization for
every native submission deletion. Durable deletion intents must fence new source
references and reconcile crashes/lost replies. A gateway outage then blocks
native deletion. Neither option permits deleting protected dependencies or
inferring archive integrity from an old metadata acknowledgement.

The instructor selected durable confirmation in the October23 question dialog.
This decision does not complete C7, enable saved-source grants or migrate legacy
recovery authorities. C16 is also settled: live monitoring/input authority belongs
in the existing ONE supervisor per user/attempt, with recording IO isolated.

## Pre-qualification state review

Empty/separate-template sources add no authority state or background operation.
The existing fifteen-minute actor-bound review remains inspectable/cancellable,
reserves no account and cannot confirm after expiry or changed definition/roster.
Confirmation revalidates the exact material and starter catalog selections and
commits the whole batch transactionally. Lost replies reuse the original review/
request and return original IDs. Historical `ADDITIONAL_TEMPLATE` provenance and
review-kind names are retained for compatibility: these grants still select exact
template materials, while their writable initializer is now independent.

AVAILABLE grants retain the original finite Begin window and immutable revision
history. A settings-only revision preserves work; explicit work revision/revoke
requires no unresolved/consumed claim or independent Begin interval evidence.
Missing starter bytes cannot justify fallback, new authority or a clock refund.
Saved sources may now be reviewed and issued pending native confirmation; they
remain excluded from AVAILABLE admission until C18 is integrated.

026 adds nullable immutable attempt grant_work. Existing default-source attempts
remain unchanged/null, preserving their old wire bindings. Nondefault sources
must match the exact grant revision at SQL insertion: an older writer omitting
the source refuses. Native preparation/state, private receipt, fresh outbound
verification/reply and callbacks retain the same explicit source. A changed,
null, malformed or unknown receipt source cannot establish successful staging.
Original prepared claims cannot switch grants or sources. Private stages are
inaccessible before Begin, and existing publication/restart/inode barriers apply.
Staging checks exact read-only materials even for empty work; independent source
selection does not remove the full system filesystem, materials or monitoring.

The actual final clock/one-use commit retains the same authoritative windows,
intervals and per-attempt/UID locks. Cancellation/no-start still requires the
existing independent consumption/workspace/submission contradiction checks before
monitoring deletion; the retained grant_work participates in immutable binding
comparison. No source setting changes those proof requirements. Started history,
account holds and credentials are untouched. The new compiled capability is a
protocol fence, not proof all installed roles match or retained SSH is enabled.

Before any future cutover, back up026 and every native Work/receipt field, drain
all writers and install matching roles. Older native writers may drop fields;
never mix them with live explicit-source attempts or roll back to a source-blind
writer. Repair forward or restore a consistent backup only without losing newer
one-use history. No migration, deletion, drain or rollout has been executed.

## Supported local operator workflow

Use existing named grants.additional-preview and grants.revise authorization.
The existing exact material selection remains mandatory in every command.

```sh
sudo examctl web grants additional-preview midterm student01 --duration-minutes 90 --definition-revision HASH --template-version MATERIAL_HASH --earliest 2026-10-26T09:00:00-05:00 --latest 2026-10-26T12:00:00-05:00 --work empty --reason 'Explicit additional attempt with empty starter'
sudo examctl web grants additional-preview midterm student01 --duration-minutes 90 --definition-revision HASH --template-version MATERIAL_HASH --earliest 2026-10-26T09:00:00-05:00 --latest 2026-10-26T12:00:00-05:00 --work template --work-template STARTER --work-template-version STARTER_HASH --reason 'Explicit independent exact starter selection'
sudo examctl web grants issue-show PREVIEW_UUID
sudo examctl web grants issue-confirm PREVIEW_UUID --revision REVIEW_HASH
sudo examctl web grants show GRANT_UUID
sudo examctl web grants revise GRANT_UUID --revision 1 --work empty --reason 'Explicit change of unused workspace source'
```

Run templates verify/sync for each exact version first; template metadata is
historical attestation, never proof the class server is currently online. CLI
help/errors explain unsupported combinations and retry guidance. Web additional
authorization and unused-grant revision show the same source choices and reviewed
material/starter hashes; the student waiting page shows the selected source.
Omitting work at NEW issuance uses the materials starter. Omission on revision
preserves the saved work source, including when material settings change.

## Local verification and limits

Validated source based on f895663; no deployment. Shared HTTP review/revision
tests prove independent sources, atomic/idempotent confirmation, preserved work
on settings edits, explicit source-only revision, invalid/unattested/saved-source
refusal and zero clocks/claims from failure. A correctly established current
claim with an omitted empty source reaches026's exact writer refusal and rolls
back. Student SSH cases prove explicit empty preparation/fresh Begin, old-role
refusal before allocation, tampered-source rejection/retry and immutable attempt
source. Actual compiled root CLI/TLS covers additional empty issuance, restart/
lost reply, settings-only preservation and explicit template-source revision.

Native signed source acceptance now crosses the actual production-framed OS
worker protocol. Real post-private-publication SIGKILL leaves the exact receipt/
copy; retry adopts it, restart and fresh TLS Begin preserve the fixed allowance,
and another actual child collects/verifies the protected archive including the
source binding/original interval. Empty archives have zero student files;
separate starter archives contain the actual chosen bytes. Missing sources,
changed fresh replies and null/unknown/unsafe receipt work fields refuse.
Focused native core5.342s/CLI1.293s, additional real-child/crash8.336s and final
process-through-protected-archive acceptance10.457s pass.

All474 application tests/91 files pass212.52s. Full native race/resource/user-
namespace/owned-user-systemd/compiler/default-size qualification passes
core355.447s/CLI29.250s. Static native build/vet and UI/WASM build/typecheck pass.
Final UI assets: index-C1aTgsRk.css and index-Dpy6fis2.js. Final39 rebuilt browser
checks pass3.3m, including CLI-consistent source choices/revision, safe correction
of a refused source, explicit student selection and actual WASM SSH/Begin.
430px rendered management screenshot was inspected; the private per-test output
fits without horizontal overflow. Existing uncommitted repository PNG is excluded.

Failures retained in /tmp/ssh-exam-work-sources-*.log: first student tamper oracle
expected400 rather than the correct409; a label locator was corrected from the
observed combobox role. An initially unregistered browser starter exposed a real
form defect: confirmed404 revision refusal retained the pending intent and
disabled correction. Definitive400/403/404/409 now permits correction; uncertain
network/server outcomes keep the original request. The regression explicitly
reaches that refusal, corrects to the attested source and completes revision.
The first broad browser run was37pass/2fail: one stale first-menu expectation and
a real narrow-toolbar overflow after adding grant buttons. Correct wrapping and
explicit viewport/keyboard-wrap assertions pass focused3cases14.6s, then all39
pass against the final rebuild. Do not describe that failed broad run as a pass.

The last production change after app/native qualification was admin-only CSS;
browser checks were repeated. The final native test extension adds actual child
crash/archive coverage without changing production Go/contracts; its focused
race result supplements the unchanged full native evidence. No redundant broad
application/native repeat is claimed. Native privileged systemd/writer/account
setup remains injected in this synthetic source fixture. Local namespace/resource
tests do not prove installed-role SSH/PAM/cgroup qualification; no csc-sys access,
student data, installed services or production configuration was used/changed.
