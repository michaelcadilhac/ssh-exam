# Current checkpoint — complete CLI listings QUALIFIED LOCALLY

Current milestone: ordinary `examctl web … list` returns every matching metadata
row without `--all`; explicit `--limit` caps returned matches. Preserve signed
scope validation, bounded requests, cursor/watermark handling and no partial
stdout on failure. `--all` remains accepted by existing scripts.

Plan: (1) integrate all existing list entry points and focused actual CLI/TLS
regressions; (2) run CLI races/build/vet and qualify the exact atomic installer;
(3) commit/push, inventory and back up the installed CLI, atomically replace only
examctl, then verify complete/bounded authenticated reads and unchanged loaded
services/history. No web deployment, native restart, grading-helper installation
or student-record changes. Push/deploy explicitly authorized November12.

Acceptance: default lists cross empty/full pages; explicit limits count matches;
filters and monitoring watermarks survive; repeated cursors, wrong scope and
later-page failures emit no partial results. Every request stays bounded.
Status: integrated and qualified locally. All10actual CLI/TLS list entry points,
empty/exact filters, explicit limits, later-page refusal/privacy/cursor failures,
and multi-exam fresh IDs pass. Complete CLI race suite31.45s, vet/build/types,
exact-binary real gateway/zsh12.73s and namespace atomic install/recovery pass.
Frozen candidate SHA256:03e3600ae5825f41274480e00d1d4f151ef0ed6d3f617fe02502f0d9e1132564.
Next: commit/push, refresh native guard pins, stage audited bundle and install
only CLI with existing atomic procedure; then signed reads/public health/unchanged
roles-history acceptance. Installed CLI is still unchanged. Details/evidence:
docs/complete-cli-lists.md; var/collection-tests/complete-cli-lists.20261112/.

Earlier navigation release ed09efc/schema37 remains deployed. Corrected private
70-row grade comparison and local grading-helper fix cb58259 are complete; the
helper installation is a separate pending task. Original ten dirty documentation
screenshots are preserved. Detailed earlier evidence is in navigation-protection.md
and offline-midterm-grading.md. No open policy decision for this CLI milestone.
