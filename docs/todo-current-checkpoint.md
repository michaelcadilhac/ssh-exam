# Current checkpoint — grant-detail UX follow-up complete locally

October 30, 2026. Local development/testing/commits only. No push, deployment,
production configuration/student changes or restarts. No decision or local
implementation task remains open. The follow-up commit contains this checkpoint;
use git log -1 to resolve its revision. Baseline: ce33086.

Prof agreed the fixes before implementation and accepted the actual desktop/mobile
screens. Allowed attempts now starts with individual cards: status, time limit,
webcam, start window and starting files. Bulk editing remains fields-first. Review
→ Starting files and settings exposes useful historical facts/source navigation
before diagnostics. UUIDs, hashes and raw records require explicitly technical
disclosures. Durations use `1 min 35 sec`, not decimal minutes. Date/time
inputs remain local native controls, with minutes for limits/clock adjustments;
exact unchanged values and DST choices are preserved. Existing edit/review stages,
request identities, mutation semantics and all safety authority are unchanged.

Evidence: var/collection-tests/prof-ux-repeat.kl_ojws9. Details/scenarios and rendered
review: docs/ui-prof-review.md. Operator and design documentation updated.

- Three red browser checks reproduced the old hierarchy/display problems.
- Final six focused desktop/mobile/timing checks PASS (15.4s).
- All 80 affected browser cases PASS (4.9min), no skips: inspection, issuance,
  revision/cancellation, unknown/partial replies, actual-WASM grant starts and
  all seven timezone workflows. Eight focused date/duration/view unit checks pass
  via npm test, including the current-worktree native-clock pretest.
- Typecheck and fresh frontend build pass. final-ui-inputs.json pins source/test
  files and actual served assets; no post-run drift. Exact existing qualified
  browser SSH WASM/runtime was preserved; its source/protocol did not change.
- cleanup.json confirms 27 logged owned processes exited and ports3100/3101 closed.
  No runner remains. All 10 original dirty documentation screenshots are unchanged
  and UNCOMMITTED; their baseline is in this evidence directory's baseline.json.

This follow-up changes only six frontend components, the targeted interface test
and documentation. Backend/protocol/native/CLI remain unchanged from ce33086;
CLI/native worker source is503bd9c. Prior 643-app/192-browser/full native/image
receipts belong to those prior revisions as documented, not a new release image.
Original 38/38 deployed release remains separate; no production behavior changed.

Remaining release-only gates: build/qualify a matched shipping image containing
this frontend; qualify the exact root worker unit's mount/LSM behavior before
installation/enablement. The worker is still uninstalled. User-systemd resource
proof and simulated browser shell/media do not establish that privileged boundary.
No deployment is authorized. Only after a new instruction, follow the matched
backup/drain/migration/synthetic-acceptance/rollback plan in
docs/automatic-saved-work-setup.md. Preserve pins/history/deadlines/holds and never
restore an older database over newer authority. Existing agent consolidation
needs no change.
