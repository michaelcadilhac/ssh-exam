# Additional attempts and workspace sources

November1 policy update (local candidate): confirming another attempt replaces
earlier definitely-unused permission for the same student/exam, regardless of
overlapping or disjoint dates. Students receive one assigned attempt and never
choose between permissions. Started attempts, deadlines, history and holds stay
authoritative. Current qualification/migration: [single unused attempt](single-unused-attempt.md).

Local implementation/qualification only; not deployed. Evidence and privileged
limits: additional-template-grants.md. These commands do not authorize production
changes. Empty/separate-template initialization is implemented/tested locally
(grant-workspace-sources.md). Individual saved-work initialization is implemented
and tested locally through broad and guarded-root qualification. Nothing is deployed.
Sandbox practice uses the same review and inspection workflows with fixed policy;
see sandbox-grants.md for the candidate and its qualification status.

## Authorize and review

Root uses existing pinned agent authentication, with explicit default-deny
grants.additional-preview and grants.issue-show/confirm/cancel authorization.
Inspection and unused revision/revoke use the corresponding grants.list/show/
revise/revoke permissions. No browser or student credentials are used by examctl.
Discover everything with `examctl help grants` or `examctl web grants help`.

Select the current definition revision/exact attested template and a finite
explicit Begin window. Choose the additional allowance; each student's effective
webcam requirement is preserved unless `--webcam required|optional` overrides it.

```sh
sudo examctl web exams show midterm
sudo examctl web grants list midterm --username student01
sudo examctl web grants additional-preview midterm student01 student02 --duration-minutes 90 --definition-revision DEFINITION_HASH --template-version SOURCE_HASH --earliest '2026-10-26T18:00:00-05:00' --latest '2026-10-26T18:30:00-05:00' --reason 'Explicit separate additional template attempts'
sudo examctl web grants issue-show PREVIEW_UUID
sudo examctl web grants issue-confirm PREVIEW_UUID --revision REVIEW_HASH --request REQUEST_UUID
```

Replace the placeholders with the actual hashes/UUIDs. Whole minutes or exact
`--duration-seconds` are supported,60..21600 seconds. A review names1..200 enrolled
ordinary students and lasts fifteen minutes. It shows the resolved snapshot and
the exact earlier unused/pending permissions that confirmation will replace.
Preview reserves no account or clock. Changed definitions, enrollments or reviewed
predecessors require a new review; confirmation replaces permissions and publishes
the whole batch atomically. A setup or unfinished Start claim refuses replacement
until verified unstarted cleanup. Cancel an unconfirmed review with `issue-cancel PREVIEW_UUID --revision
REVIEW_HASH`; cancellation cannot undo confirmed issuance.

For scripts, `issue-show` supports `--format table` or `--format tsv` with fields
`replacement_count,replacement_refs` before confirmation and
`grant,replaced_count,replaced_refs` afterward. References show `UUID@revision`;
JSON parsing is unnecessary. New CLI confirmations carry the required policy
marker automatically; an old gateway rejects them before mutation.

The grant window can be wholly outside expired exam defaults. It limits actual
Begin, not finish: a late valid Begin still receives the full fixed allowance.
Later defaults/enrollment edits do not change issued settings. Time starts and
the grant is consumed only when native Begin durably fixes the original interval.
Unavailability or refusal before that boundary consumes neither.

Workspace initialization is independent of the exact material template and chosen
allowance. Omit work to use the materials starter at NEW issuance; choose
`--work empty`, or `--work template --work-template NAME
--work-template-version HASH` for a separately attested starter. The same flags
on unused `revise` explicitly change the source; omitting them preserves it,
including when materials change. Saved work uses `--work saved --work-attempt
SOURCE_UUID --work-checksum SOURCE_SHA256`; it requires the same student's
completed protected submission and preserves that exact source. There is no
mutable/latest or live-folder fallback. Matching web forms show the same choices
and hashes.

## Confirm saved-source retention on the class server

For one student's separate ninety-minute attempt, explicitly choose their
protected attempt/checksum and the new finite Begin window:

```sh
sudo examctl info SOURCE_UUID --read-only
sudo examctl web grants additional-preview midterm student01 --duration-minutes 90 --definition-revision DEFINITION_HASH --template-version MATERIAL_HASH --earliest '2026-10-26T18:00:00-05:00' --latest '2026-10-26T18:30:00-05:00' --work saved --work-attempt SOURCE_UUID --work-checksum SOURCE_SHA256 --reason 'Second full ninety-minute attempt from this student protected work'
sudo examctl web grants issue-show PREVIEW_UUID
sudo examctl web grants issue-confirm PREVIEW_UUID --revision REVIEW_HASH
```

Recorded info is inspection, not fresh archive verification; source-sync performs
that verification below. A saved-work preview may instead select a different
source for every student using --saved-sources FILE. This is implemented/tested
locally through full application, CLI-race and affected browser qualification.
Do not share one student's archive across owners or remove the ownership check.

Use a regular CSV file of at most64 KiB and1..200 distinct rows, with this exact
header and each student's actual protected source UUID/checksum:

```csv
username,attempt,checksum
student01,SOURCE_01_UUID,SOURCE_01_SHA256
student02,SOURCE_02_UUID,SOURCE_02_SHA256
```

```sh
sudo examctl web grants additional-preview midterm --saved-sources selected-sources.csv --duration-minutes 90 --definition-revision DEFINITION_HASH --template-version MATERIAL_HASH --earliest '2026-10-26T18:00:00-05:00' --latest '2026-10-26T18:30:00-05:00' --reason 'Explicit second ninety-minute attempt from each student selected protected work'
sudo examctl web grants issue-show PREVIEW_UUID
sudo examctl web grants issue-confirm PREVIEW_UUID --revision REVIEW_HASH --request REQUEST_UUID
```

CSV rows select participants when no usernames are given. An explicit username
list must match every CSV row exactly; duplicates, omissions and unselected owners
refuse. Do not combine this flag with shared --work flags. Review each source,
allowance, effective webcam and finite window before confirmation. Confirmation is
atomic; losing one source's protection issues no partial batch. Preserve CSV,
request and review IDs after reply loss; inspect the SAME review after restart.
Changed contents require new review. Each grant still needs source-sync below;
pending grants never reserve accounts or time.

Web: enter usernames, select Protected saved work and fill each separately labelled
attempt/checksum. Correct an owner refusal and preview again; inspect both rows
before confirming. A lost confirm offers exact retry and saved-review inspection.
Revoking unused permission preserves all prior attempts and protected history.

To compare/select submissions, use the selected exam's student rows: each attempt
has its own numbered Review action. Open Timing and monitoring details for its UUID/timing, and
Submission for its collection reason/status/inventory. Student Actions → Attempt
grants shows the new grant's source UUID/checksum and claimed new attempt UUID;
match those exact IDs rather than assuming the latest row is the graded one.
No submission replaces its source and no automatic grading preference is imposed.

The matching CLI inspection/export workflow is:

```sh
sudo examctl web grants list midterm --username student01
sudo examctl web grants show GRANT_UUID
sudo examctl info SOURCE_UUID --read-only
sudo examctl info NEW_ATTEMPT_UUID --read-only
sudo examctl export SOURCE_UUID --output /PRIVATE/NEW-SOURCE-EXPORT
sudo examctl export NEW_ATTEMPT_UUID --output /PRIVATE/NEW-ATTEMPT-EXPORT
```

Select actual IDs from grant source/claim history. Export uses a new private file
and refuses overwrite; inspect any partial output after an interrupted export.
These commands never reopen an attempt, release a hold or choose a grading policy.

Saved-source issuance first creates PENDING_NATIVE. It reserves no account,
consumes no time and cannot begin. Confirm the exact archive's durable native pin
through the existing root-authenticated outbound management connection:

```sh
sudo examctl web grants source-sync GRANT_UUID --revision 1
sudo examctl web grants source-show GRANT_UUID --revision 1
sudo examctl web grants show GRANT_UUID
```

Only the matching durable acknowledgement makes the grant AVAILABLE. The web
grant dialog shows this exact completion command; refresh after synchronization.
`source-show` inspects private native metadata without allocating accounts or
reconciling student access. Corrupt/missing archives, changed Unix UID and stale
revisions refuse with inspection/repair guidance. Do not issue a replacement
grant as a retry. A lost acknowledgement leaves the pin inspectable; retry the
same grant/revision and the printed `--request UUID` to acknowledge that same
outcome. Starts still require fresh authenticated Begin and receive the whole
saved allowance only then.

An unused grant can be explicitly revised or revoked through the existing CLI
or web workflow. Its previous native pin remains until `source-sync` for that
previous revision obtains a fresh positive retirement plan. Use a NEW request
UUID for retirement. Synchronize the new saved revision separately. Consumed
pins release only after every recorded native consumer has verified protected
completion or positive no-start cleanup; missing records never prove absence.
Closing pins block new preparations and continue protecting the archive. No
timeout or expired Begin window releases a dependency. Release does not delete
submissions/history, clear account holds or authorize workspace cleanup.

## Inspect, revise and revoke the exact grant

```sh
sudo examctl web grants list midterm --username student01
sudo examctl web grants show GRANT_UUID
sudo examctl web grants revise GRANT_UUID --revision 1 --duration-minutes 75 --reason 'Explicit unused additional allowance revision'
sudo examctl web grants revoke GRANT_UUID --revision 2 --reason 'Withdraw unused additional authorization'
```

Grant revisions are numeric; definition/review revisions are hashes. List/show
pagination and immutable history are documented in initial-grants-cli.md. A
prepared, Begin-pending or consumed grant cannot be silently revised/revoked.
Inspect its original native attempt with `examctl info ATTEMPT_UUID --read-only`.
Positively cancel only an unstarted preparation before revision; a timeout never
proves no start or refunds an allowance.

Web: selected exam → Authorize additional attempts → select students, allowance,
explicit window and optional webcam override → Preview additional grants →
review → Confirm additional grants. Student Actions → Attempt grants exposes
every initial/additional grant, with selection and further pages. Explicit unused
revision affects the selected UUID; other grants and prior attempts stay intact.
The roster's initial-grant summary is labelled separately from enrollment defaults.

## Lost replies and student admission

Keep the original request ID and identical CLI arguments after a lost reply,
including the original timestamps. Use a fresh request ID for fresh status.
`issue-show` on the original preview returns its retained issued IDs across
restart; confirmed metadata is history, not current unused availability.

After a lost reply, retry the exact current-policy request or inspect the original
saved review. Do not authorize a replacement batch as a retry. The browser retains
unknown intent across reload. An older unmarked request is never blindly replayed:
positive confirmed status supplies its actual receipt; an unconfirmed old review
needs a fresh review under the new policy. CLI legacy unknown retries likewise
require authenticated confirmed status before replaying their original bytes.

Students receive the sole assigned attempt on the waiting page. New confirmation
replaces earlier unused permission even when their dates do not overlap. An
existing preparation retains its bound authority and cannot be silently replaced.
A new attempt gets a separate
UUID/private workspace from its saved initializer; previous protected work/history and original
timing remain intact. The old attempt must have confirmed protected collection
and normal access release. Web/native account restrictions still refuse new work
while an original/current interval or recovery hold remains authoritative.

Native Begin requires fresh authenticated outbound agreement and the exact grant/
revision/type/lineage/source/owner. Retry the same attempt/intent after an unknown
outcome; committed native time is never rebased. Superseded initial permission
remains revoked history and cannot be used after its replacement. Existing native
lineage checks remain additional safeguards; missing or contradictory history
refuses for inspection.
Root-only legacy saved-work grants remain protected and may conflict with this
template initialization. No live-work copying, source fallback or automatic
reopening/refund is part of this workflow.

## Future rollout gate

Migration025 and ordered-template-grants-v1 need matching gateway, CLI and EVERY
native state writer. Preserve rowids, exact initial-grant edges, all current
revisions/claims/intent/consumption, protected sources and legacy receipts. Old
initial receipt encoding stays readable; older writers against enriched state
are unsupported. Drain preparing/pending/active work and independent practice
owners, including all three temporary/canonical agent owners, before any future
installation or consolidation. Keep admission closed and repair forward when a
compatible rollback is unavailable. The unexecuted plan is todo-rollout-plan.md.

Independent sources additionally require026 and independent-workspace-grants-v1,
including the native Work field/private receipts in every writer/backup. Older
default-source bindings stay readable; do not mix source-blind native writers.

## Sandbox practice (C14)

Configure an attested exact material version and finite Begin window with
`examctl web exams show sandbox` and the revision-fenced `web exams update`
workflow in exam-definition-management.md. For example, select actual hashes
from the catalog and definition before replacing the placeholders below:

```sh
sudo examctl web templates list
sudo examctl web exams show sandbox
sudo examctl web exams update sandbox --revision DEFINITION_HASH --template TEMPLATE_NAME --template-version TEMPLATE_HASH --earliest '2026-10-26T09:00:00-05:00' --latest '2026-10-26T17:00:00-05:00' --reason 'Open finite practice with verified exact materials'
```

Changing just the window does not upgrade a legacy mutable source. No installation
is changed by this documentation. Authenticated preflight automatically
saves a five-minute/no-webcam/four-terminal PRACTICE grant within that window.
Cancelled unstarted preparation reuses it. Each next automatic allowance requires
positive protected completion and normal access release of the preceding attempt.
No waiting or failed preparation consumes time; each actual Begin fixes a new
five-minute interval. Closing defaults never changes an issued grant or interval.

Inspect with `web grants list sandbox --username USER` and `web grants show UUID`.
Expired unused grants require explicit `web grants revise UUID --revision N`
with the selected finite dates and reason. Revoked grants do not regenerate;
authorize reviewed NEW practice through `web grants additional-preview sandbox
USER --duration-minutes 5` with the usual definition/source/window/reason flags,
then `issue-show`, `issue-confirm` or `issue-cancel` as above. Manual windows may
be outside closed defaults. Policy stays300 seconds/no webcam/four terminals;
other values refuse. Web: Authorize practice grant; Student Actions → Attempt
grants for inspection/revision/revoke. Earlier grants and attempts remain history.

For an unresolved preparation, inspect native `info ATTEMPT --read-only` and use
the supported cancellation/restoration workflow. A CANCELLED label or timeout
alone cannot release its claim. Matching signed cleanup-complete AND NORMAL
policy plus consistent no-start evidence are required before unused changes.
Never clear claims or consumption records to force a retry. Migration027 and
matching practice/verified-cancellation roles are future drained rollout gates;
no installation, migration or production change is performed here.
