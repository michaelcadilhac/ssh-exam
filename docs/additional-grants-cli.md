# Additional attempts and workspace sources

Local implementation/qualification only; not deployed. Evidence and privileged
limits: additional-template-grants.md. These commands do not authorize production
changes. Empty/separate-template initialization is implemented/tested locally
(grant-workspace-sources.md). Saved-work initialization remains unfinished.
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
existing unused/pending grants at review time. Preview reserves no account or
clock. Changed selected definitions/enrollments require a new review; confirmation
publishes the whole batch atomically. A new confirmed review authorizes another
attempt. Cancel an unconfirmed review with `issue-cancel PREVIEW_UUID --revision
REVIEW_HASH`; cancellation cannot undo confirmed issuance.

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
including when materials change. No mutable/latest fallback or saved-source
grant is supported yet. Matching web forms show the same choices and hashes.

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

The browser displays a saved review ID BEFORE confirmation. After a lost reply,
retry the exact pending request or reload and inspect that same saved review ID.
Do not authorize a replacement batch as a retry. Automatic browser intent
restoration is not implemented; the manual saved-review workflow is tested.

Students choose an authorization on the waiting page when several are usable.
An existing preparation retains its bound choice. A new attempt gets a separate
UUID/private workspace from its saved initializer; previous protected work/history and original
timing remain intact. The old attempt must have confirmed protected collection
and normal access release. Web/native account restrictions still refuse new work
while an original/current interval or recovery hold remains authoritative.

Native Begin requires fresh authenticated outbound agreement and the exact grant/
revision/type/lineage/source/owner. Retry the same attempt/intent after an unknown
outcome; committed native time is never rebased. An unused initial grant can
follow an explicitly additional grant only with positively retained original
identity/issuance history; missing or contradictory history refuses for inspection.
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
