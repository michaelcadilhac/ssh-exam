# Current milestone — timer controls and sixty-second timeouts

November 6, 2026. Development/testing/deployment authorized, including with an
admin signed in. No new push instruction. Production remains ONLINE and unchanged.
Started November 6 04:54:44 UTC. Preserve the ten pre-existing modified
`docs/screenshots` images; never stage or overwrite them.

## Implemented locally

- Operational network/SSH/browser/relay/monitoring budgets are sixty seconds;
  poll cadence, exam durations, preflight15min and kernel/resource bounds differ.
  Evidence/bootstrap v2 reject old15s interpretations. The browser confirmation
  helper now also shares60s and retains64 outstanding one-use acknowledgements.
- Existing native watchdog polls signed authorized clock intents once per second.
  Fast admin/CLI staging no longer waits on student SSH. Durable requests remain
  pending until the live supervisor acknowledges; exact retries add no time twice.
- Verified negative SSH-exit evidence may span an older clock revision of the
  EXACT same immutable connection lifetime. Files-only recovery adopts current
  clock without granting new time, attempt or permission.
- Pause countdown permits untimed MONITORED work; original interval stays in
  history. Explicit resume starts the saved remainder. Adjustments while paused
  affect that saved remainder. Normal monitoring/recording holds still apply.
  Finish after the old deadline protects files and records the actual end time;
  completed protected attempts cannot reopen, including after restart.
- Admin menu and root examctl pause-timer/resume-timer, existing clocks.reset
  authorization, revision/audit/idempotence and new native capability fence.
  Allow resume supports custom1..525600minutes or --no-expiry, default5min.
  Completion/revocation/countdown still apply; new grant Start windows stay finite.
- Full CLI/root-TLS/restart and scripting workflows pass. Strict metadata readers
  accept only the new bounded timer fields; private/unknown fields still refuse.
- Exact monitoring-timeouts-v2 installer supports five binaries plus the relay
  timeout snippet, preserving configuration/trust/service bytes. Production guard
  checksum refreshed; an unmocked regression now binds it to the actual file.

## Verified

Evidence: var/collection-tests/timer-controls.20261105a/.
- Native full races pass (native-timer-final.log, core273.605s).
- All28 actual user-systemd/PTYS/supervisor modes pass (356.213s), including
  real work past a one-minute deadline, monitoring loss while paused, no-expiry
  fresh files recovery preserving pause, explicit countdown resume and safety
  holds. Separate paused protected-Finish/restart regressions pass.
- Application broad run:820pass/1fixture failure/3opt-in skips. The migration
  fixture omitted two newly derived zero timer fields. Its corrected focused
  cases pass while retaining equality of every stored field. Focused final
  confirmation/timer/migration tests pass8; expiry/retained restoration pass19.
- Browser broad:82pass/2timing-fixture failures; both corrected cases now pass.
  Retained WASM verifies no early reconnect and actual60s expiry. Paused input
  uses one REAL browser/server/socket clock and works past the actual1min
  deadline; virtual jumps had outrun asynchronous replies. All84 unique selected
  cases pass across broad/corrected runs. Final full application suite active.
- Full types and browser/WASM/server builds pass. New joined native/browser
  timer+no-expiry+SSH recovery scenario is implemented/typechecked, not run yet.
- Operator tests:19native/35matched-web/10guard pass; overlay safety27 pass.
  Those service mocks do NOT establish privileged installation qualification.

## Current release qualification / exact next action

The real five-binary installation passes in the guarded root overlay, including
actual nginx invalid-config refusal, stopped roles, same-candidate repair/retry,
reload and preserved relay trust. All7 real SSH/workspace/collection/deadline
assertions pass. Independent cleanup confirms inactive unit/MainPID0/no owned
processes. See native-install-qualified.json and native-install-root-4.log.
Earlier fixture nginx scratch/log-path refusals are retained. Host nginx/runtime
were reused read-only; no package install or base/production modification.

Reusable private scripts: prepare-native-bundle.py and run-native-install.py
under the evidence directory. First upload directory:
/var/tmp/ssh-exam-timer-test-upload.7mwyFsdu. Candidate binaries compiled once in
native-release/; Go runtime source has not changed since full races/matrix.
New test bundle hash/manifest in native-install-bundle-audit.json; current root
run location appears at the beginning of native-install-root-N.log. Root guard
requires idle host and verifies unchanged base/live files/authority.

NEXT: freeze/commit the validated runtime and build/export ONE matched image.
Run joined shipped-WASM/native timer+files recovery using a
separate standard retained-policy manifest (native-install's extra files cannot
be passed to its exact-manifest runner). Qualify exact startup
writers/tombstones/due-purge/signed-poll expiry
and CURRENT-data forward recovery. Then stage and deploy the rehearsed matched
web/four-native/relay cohort. No production fencing until ready. Do not ask
settled timer/approval questions or routine local-commit/upload permission.

## Production / preservation

Fresh read-only inventory: marco118terminal histories, zero unfinished attempts,
one admin session, readiness200. csc-sys185terminal histories, zero unfinished.
Recheck before privileged qualification and cutover. Native history SHA:
625a8141cbb492f1942f4f1e91b410847bab22df0be59a5d4cf730e854d1709d.
Web c5f95f7 Config5d9d429e/schema37; marco HOST3001/container3000.
Native d744e5b four roles; relay PID893011, SHA12f5d0cca4bb9bba93bc6b5fb78894f53be8084d11b0f90b980ba6dd98ef5a76.
Prior current recovery: /data/ssh-exam-claim-clock-c5f95f7-20261105 (web/shared
immutable media) and /var/tmp/ssh-exam-clock-repair.r_1nli9m-root (native).
Verify current coverage, no blind old-snapshot reuse or GB media recopy.
Use docs/files-only-resume-release.md and its frozen operate.py/manifests as the
previous matched procedure. New timer JSON is forward-only: no old writer rollback.
Admin-only sign-out may be atomically audited; preserve zero-student guard.
9537f34 is the first local commit. Second controls increment remains uncommitted;
all other original dirty files are the ten screenshots. Nothing pushed/deployed.
