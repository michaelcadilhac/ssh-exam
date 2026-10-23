# Initial ordinary grants — implemented/tested locally

Not deployed. Qualification and limits are in unified-grant-first-attempt.md.
These are supported local/maintenance workflows, not authorization to run changes
on the current installation. C17 recovery synchronization is separately committed.

## Prepare and enroll

Use `examctl web grants help` or `examctl help grants`. Root uses existing pinned
agent authentication and the explicit named grants.list/show/revise/revoke
managementOperations allowlist (default deny); no browser/student credentials.

Before NEW ordinary enrollment, select an exact authenticated template version
and finite Begin window through the existing shared definition workflow:

```sh
sudo examctl templates verify v1 HASH
sudo examctl templates sync v1 HASH --reason 'Review immutable exam source'
sudo examctl web exams show midterm
sudo examctl web exams update midterm --revision DEFINITION_HASH --template-version HASH --earliest '2026-10-26T09:00:00-05:00' --latest '2026-10-26T09:30:00-05:00'
sudo examctl web students add midterm student01 --duration-minutes 90 --webcam optional
sudo examctl web grants list midterm --username student01
```

Definition revision is a hash; grant revision is numeric. Enrollment and initial
issuance commit atomically. CSV confirmation uses the same authority for NEW
rows. Missing exact source/window configuration refuses with no partial enrollment
or allowance. At issuance, inheritance resolves to effective values, including
webcam and collection limits. Default/enrollment edits afterward do not revise the
saved grant. Root attestation is historical metadata, not live availability;
native private staging and fresh Begin verification remain mandatory.

First issuance activates a new-enrollment writer fence for that exam. An old
gateway cannot add a new unused student without atomic issuance or insert a
legacy attempt for a known grant. Existing legacy enrollments/history are not
backfilled. Reenrollment cannot create another initial allowance or change an
issued snapshot. Additional exact-template grant workflows are now documented in
additional-grants-cli.md, with025 typed/lineage authority and coordinated-role
requirements. Independent empty/template source selection is described in
grant-workspace-sources.md; finite-window repeatable practice is in
sandbox-grants.md. Unified saved-work issuance still awaits C18 retention
integration. Reviewed NEW initial issuance for legacy unused enrollments is described
below; its qualification is in legacy-initial-grant-issuance.md.

## Reviewed NEW issuance for legacy unused enrollments

This does not reconstruct past enrollment settings or convert root-only recovery
grants. Select1..200 enrolled ordinary students with no grant or web attempt
history; native admission independently refuses known prior timed history or
conflicting saved-work authority. Current effective allowance/webcam are preserved
unless you later explicitly revise an unused issued grant. Review each resolved
snapshot, exact source and explicit finite Begin window before confirmation:

```sh
sudo examctl web exams show midterm
sudo examctl web grants issue-preview midterm student01 student02 --definition-revision DEFINITION_HASH --template-version SOURCE_HASH --earliest '2026-10-26T09:00:00-05:00' --latest '2026-10-26T09:30:00-05:00' --reason 'Review NEW initial grants for existing unused enrollments'
sudo examctl web grants issue-show PREVIEW_UUID
sudo examctl web grants issue-confirm PREVIEW_UUID --revision REVIEW_HASH --request REQUEST_UUID
sudo examctl web grants list midterm
# To cancel an unconfirmed review instead:
sudo examctl web grants issue-cancel PREVIEW_UUID --revision REVIEW_HASH
```

The definition/review revisions are hashes; unused-grant revisions are numeric.
The source hash must match the explicitly selected current definition. The Begin
window may lie outside its default window. Preview reserves no account or clock,
expires after fifteen minutes and is bound to its actor/class agent. Changed
definitions/enrollments or new history/grants require a new review; no partial
batch is issued. Failed/unavailable native verification never consumes time.

Reuse the SAME `--request` and arguments after lost replies. Confirmation and
`issue-show` retain the issued IDs across restart; they never issue twice. Use a
fresh request ID for fresh inspection. Confirmed review is an issuance receipt,
not current grant availability: inspect each grant before revision/revoke. Cancel
cannot undo confirmation or erase history. Explicit named grants.issue-preview/
issue-show/issue-confirm/issue-cancel authorization is default deny.

Web: selected exam → Issue legacy grants → enter named students/reason and select
the current source/window → Preview NEW grants → inspect each saved policy →
Confirm NEW grants. The dialog supports exact lost-reply retry and saved review
inspection after reload. REVIEWED_NEW provenance distinguishes these authorizations
from ENROLLMENT snapshots. Matching reviewed-initial-grants-v1 native support is
required before preparation; older roles refuse without allocating an attempt.
Do not remove history, holds or recovery records to make a refusal disappear.

## Inspect, revise, revoke

```sh
sudo examctl web grants show GRANT_UUID
sudo examctl web grants revise GRANT_UUID --revision 1 --duration-minutes 75 --reason 'Explicit unused allowance revision'
sudo examctl web grants show GRANT_UUID --before 2
sudo examctl web grants revoke GRANT_UUID --revision 2 --reason 'Withdraw unused authorization'
```

List pages have limit1..200 and an exclusive UUID `--after`; show includes50
immutable revisions with `history_next` for `--before`. Revise changes only named
fields. Use whole minutes OR exact seconds; webcam required/optional, terminal
limit, exact material/starter template version, logical collection limits and
explicit RFC3339 earliest/latest are supported. A grant's window is independent
of later exam defaults and limits Begin, not finish. Normal monitoring/account
holds/deadlines remain authoritative after start.

Web administration: student Actions → Attempt grants. Inspect saved settings,
revise the unused snapshot or revoke with a reason. A lost reply retains the
original intent/body for retry. Current revision/status is rechecked server-side;
do not interpret an old cached result as current availability. The enrollment
setting editor changes defaults, not the issued initial grant.

`--request UUID` retries IDENTICAL intent after a lost CLI reply. A refreshed read
or different change needs a new UUID. Confirmed metadata is not native execution
permission. History, claims, original interval and audit remain intact.

## Preparation/Begin and refusal handling

The local challenged-preflight candidate requires matching grant-begin/v2 native/
gateway roles and current loaded browser capture. It refuses missing/stale capture
before starting time; a refusal is not a policy violation or consumed allowance.
Restore preflight capture and retry the original preparation/Begin intent. Use
`examctl web grants show GRANT_UUID` and `examctl info ATTEMPT --read-only` for an
uncertain outcome; do not clear grants/intents/history or reset time. Mixed roles
refuse before commit. State review and qualification status:
[challenged-preflight-capture.md](challenged-preflight-capture.md).

PREPARING/BEGIN_PENDING claims block revision/revocation. A verified Unix UID is
bound on first claim, not trusted from import/enrollment UID0. Cancellation keeps
that binding; a changed UID requires reviewed NEW authorization, never rebinding
the old allowance. Inspect the exact native attempt with `examctl info UUID
--read-only`; use normal supported cancel only for a confirmed unstarted attempt.
An exact absent web orphan has `examctl help cancel-absent`, with all contradictory
workspace/submission/consumption evidence preserved. Never delete rows/markers to
force a retry or infer no start from a timeout.

Native Begin needs fresh signed outbound HTTPS agreement using existing root
agent identity. Unavailable/stale/wrong agreement starts no clock. Retry the SAME
intent/attempt; a committed native interval is consumed, not a new allowance.
Private publication failure after committed start requires protection/recovery of
that original interval, never an automatic refund. Positively cancelled claims
remain history; a fresh preparation still gets the full allowance at actual Begin.

This first workflow initializes from its exact template. A conflicting native
legacy saved-work authorization refuses rather than silently falling back or
changing work source. Later independent empty/template and reviewed legacy NEW
issuance workflows are documented above; they do not convert saved-work authority.
Saved-source retention/migration remain required before a complete unified rollout.

## Future rollout/rollback gate

No deployment is authorized. Drain active/preparing/pending work and independent
owners; coordinate ALL gateway/native/watchdog/forced-command writers, including
the three temporary agents. Preserve consistent DB/WAL, mode/request/revision/
claim/intent records, native grant bindings/tombstones/one-use history and archives.
Older native writers may discard unknown fields: do not run them against new
authority. Stage receipts also contain a field old strict readers reject. If no
compatible rollback exists, keep admission closed and repair forward. Retained
SSH/technical-hold recovery, C13 migration and C8 retirement are not enabled by
this candidate. Consolidation remains the unexecuted todo-rollout-plan.md proposal.
