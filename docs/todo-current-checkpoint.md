# Current checkpoint — verified UI release, authorized cutover

October 31, 2026. Source ff9e0f3 includes e57c3ec's password field fix, removes
routine student Start window/date ranges, and focuses the first sign-in field
on mount. Prof agreed each change. Local/source verification COMPLETE; instructor
explicitly authorized push/deploy all three fixes.

- Four new red checks reproduce summary/focus failures; four focused checks pass.
  Final36 selected browser workflows PASS against the exact packaged Go1.27.2
  WASM/assets: focus/no theft, timing across seven zones, instructor date entry,
  attempt choice, saved settings, restored sessions, password/OTP/notices/retry,
  sixteen simultaneous signed-in clients with zero clock. Typecheck/build PASS.
- Earlier unchanged SSH/Node/auth29, Go client/private split-identity races PASS;
  current exact image production-maintenance startup/schema24→35/history/clock/
  asset smoke PASS. No native/CLI/schema/policy changes; no full-app rerun claimed.
- Image ssh-exam-release:ui-ff9e0f3. Exported Config59a026af…; source engine54b936a0….
  Source from clean git archive; original ten dirty screenshots remain untouched.
- Web/class code-only private stages uploaded and byte-verified; image loaded on
  marco, not activated. Independent native guard PASS; all175 native histories,
  native PIDs/config/CLI proxy/worker/relay intact. Web guard initially refused
  one session; instructor signed out, repeat PASS with110 histories and no owners.
- Next: push verified commits; fresh web guard, admission fence/public refusal,
  fresh native guard, capacity-checked full private backup BEFORE web stop;
  web-only activation, table/config/native preservation checks, reopen/acceptance.
  Do not restart any native service or restore older state. Busy guard means stop.

Evidence: var/collection-tests/student-summary.japy2oc9 (regressions),
var/collection-tests/ui-followup-rollout.dgw3btoc (frozen scripts/qualified image/
production receipts). Runtime production still6b7c62b/schema35 until activation.
Existing deployment/backups/rollback: docs/prof-ui-deployment.md. Root filesystem
space remains a separate maintenance concern; preserve all student data/backups.
