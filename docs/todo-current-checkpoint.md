# Current checkpoint — attempt editor simplification tested locally

November 1, 2026. The requested UI follow-up is complete locally. Nothing is
pushed or deployed. The source baseline is baf87f2; the final local commit and
qualified input hashes are recorded in the completion receipt below.

Allowed attempts opens an overview; Edit settings opens saved values and files.
Cancel editing discards only the draft. Untouched source references, seconds and
DST occurrences remain exact; stale revisions refuse. The selected source shows
its exam code, attempt and date, including on narrow screens. Personal exam-name
editing and all six instructor Reason inputs are removed; contextual audit/history
and exact unknown-request identities remain. Refresh uses labelled circular-arrow
controls. Close, Cancel editing, Back and Done match their actual effects.

Verification: final 15 focused browser cases pass; all 134 selected affected
scenarios have passing current-artifact coverage (broad 128 pass / 6 fixture
failures, then corrected 9 pass including all failed cases and shared-helper
callers). Runtime inputs/assets stayed identical; only three test files changed
for those corrections. Full fixture types and production build pass. A fresh Prof
accepted desktop/mobile and dedicated source views at 320/375/430px. Owned fixture
listeners are closed; ten preexisting dirty screenshots stay byte-identical and
unstaged. Backend, protocol, CLI and native execution are unchanged. SSH WASM
source is unchanged; the locally rebuilt bundle has Git build metadata and was
used by the real-WASM checks. Earlier native qualification is not newly claimed.

Scope, intentional UI changes, retained failures and future web-only rollout:
docs/attempt-editor-simplification.md.
Exact input/artifact hashes, local commit and verification/cleanup receipts:
var/collection-tests/admin-form-cleanup.ztdlo53r/completion.json.

Production remains f0c7e10/schema 36 with matched examctl; admissions were reopened
by the previous authorized deployment. No remote production action in this task.
Private backups and current policy/rollback: docs/single-unused-attempt-deployment.md.
One unused permission, authoritative deadlines, claims, holds, pins and canonical
agent consolidation remain unchanged. Original 38-item release count unchanged.

No open decision or blocker. Next: instructor's next instruction. A new push or
deployment requires explicit authorization; the new UI needs no schema migration
or native-service restart. Preserve current records during any code rollback.
