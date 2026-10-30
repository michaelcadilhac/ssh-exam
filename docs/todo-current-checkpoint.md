# Current checkpoint — Prof UI review complete locally

October30,2026. Local development/testing/commits only. NO push, deploy, production
configuration/student changes or restarts. No user decision or local implementation
task remains open. Automatic saved-work setup was approved for local development.

The UI milestone is committed with this checkpoint; use git log -1 to resolve its
revision. Earlier local commits:2ec0562 selection/cancellation;503bd9c retain-only
worker, migrations034/035 and CLI;195e3a9 grading-only Docker scope clarification.
Native/CLI code remains503bd9c. Original38/38 deployed release is separate.

Prof agreed the fixes before implementation and accepted the final desktop/mobile
workflows. Another/first attempts and unused-setting changes take two screens;
adding time and cancelling unused extras each take one dialog. Students/settings/
source versions are retrieved. Saved-work setup/retry stays in the current screen;
only durable native confirmation can make it Ready. Per-row unknown requests keep
their identities; current status never substitutes for an exact mutation receipt.
History, sources, original deadlines, holds and monitoring enforcement remain intact.

Evidence: var/collection-tests/prof-ui.hGHi2EWM. Final-focus ledger covers49 web/
shared/HTML files,2353 overlapping extraction candidates (NOT sentences), zero open
issues; earlier snapshots remain immutable. Full details: docs/ui-prof-review.md
and docs/automatic-saved-work-setup.md. Operator guide updated alongside code.

Verification complete:

- Clean full application run:643pass/3deliberate skips,330.59s;
  prof-final-full-app.log. Clock built/verified before direct Vitest. Backend,
  protocol and native inputs unchanged since that run; no unnecessary rerun.
- browser-qualification-reconciled.json accounts for all204 declared cases:
  192unique passes,12deliberate native-bundle/measurement skips, no uncovered cases
  beyond those skips. Segmented runs use unchanged q3 runtime/assets. Failed
  copy/branch/fixture receipts remain; no guard/history cleanup obtained a pass.
  Ordinary and sandbox headings stay branch-correct; generic no-pause guards
  reject both. Real late ResizeObserver callback/sign-out/access checks pass.
- Real packaged-WASM sixteen-account sign-in passes after a prior retained account
  remains held. Capacity owns fresh synthetic identities; zero starts/deadlines.
- Actual signed CLI/gateway/archive, reply loss/revocation/coordinator SIGKILL,
  kernel resource containment and opted-in CLI races pass; source-worker feature
  document records exact receipts and limitations. Early-Enter public red/green
  and actual-WASM fault/closure/later-health regressions also pass.
- Private image4d68e4b8…: schema11/24→35, clock ABI, exact assets, unchanged attempts/
  enrollments and no invented grants pass. Owned image fixtures removed; private
  base image kept. post-signout-final-frozen-inputs.json pins350 source/test/config
  files and6 exact assets. No source/asset drift after final qualification.
- No runner remains. final-browser-cleanup.json verifies50 logged owned processes
  exited and ports3100/3101 closed. All10 original dirty docs/screenshots PNGs are
  byte-identical to examctl-scripting.exs9o_2m/original-image-hashes.json and remain
  UNCOMMITTED workspace data, excluded from this milestone.

The new worker is NOT installed/enabled. Exact root-service mount/LSM qualification
in a disposable privileged environment remains a pre-enable release gate; the
user-systemd resource proof is not that test. Browser fixtures simulate shell/media,
so the12 native skips do not establish new privileged/MFA/human-capture proof.
No production enablement is authorized. Next action only after a new instruction:
follow the matched rollout/migration/rollback plan in automatic-saved-work-setup.md,
qualify the exact root unit, and perform synthetic web→pin→Ready→fresh Begin
acceptance before enablement. Existing agent consolidation needs no change.
