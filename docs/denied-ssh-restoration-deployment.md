# Denied SSH restoration and cleanup diagnostics

## Incident and correction

Attempt `904703c4-f74d-4c27-b45e-678b884cb2b1` belonged to adomecq in exam `test`.
On October 18, 2026 (America/Chicago), SSH disconnected at 19:06:19; the 19:06:30
logout cleanup alert incorrectly claimed the class agent was unavailable. The exception
was discarded, so its exact cause cannot be recovered. The agent remained running.
The student reconnected, began at 19:07:55 and finished at 19:09:49. The submission
was protected with SHA-256 `28140501833f04e9b8815618c61961ff81d38fd4eef7bf44aff1f3ee542d3b33`.

An ordinary SSH connection at 19:11:21 was correctly denied during the original interval.
Its idle unprivileged SSH transport process, PID 1513193, remained until 19:13:21.
The original deadline was 19:12:55. The restoration scan treated that process as an
uncontained writer, causing a misleading “collection refused” alert. Account policy
was restored at 19:13:24. The protected artifact was never lost or replaced.

The agent now records verified denied transports after protected completion. A release-only
check recognizes the root-installed SSH daemon directly under the recorded privileged
monitor, revalidates its boot/PID/start/UID identity and rejects writable regular-file
descriptors. It does not exempt session children, arbitrary processes or forged variables.
The record is persisted privately and omitted from callbacks. Collection and activation
keep the strict process barrier; original/current deadlines still control restoration.

Preflight cleanup records the failed operation/stage and operational cause in structured
webserver logs, audit and contextual emails. Native cancellation rejections log their real
source error. Unknown SSH text and request contents are excluded to protect secrets.
Lost replies are reconciled before reporting pending cleanup; committed starts preserve
recovery and timing. Identical pending retries do not send duplicate alerts.
Restoration emails identify student, exam and attempt and distinguish secured work from
unconfirmed protection/termination. They no longer call account restoration a collection.

## Validation

- 255 TypeScript unit/integration tests across 41 files, typecheck and production build pass.
- New HTTP logout regression checks actual structured logs, sign-out, contextual email
  and retention of unresolved preflight state.
- Focused cases cover disconnected commands, native rejection, confirmation failure,
  lost replies, concurrent committed starts, deduplication and secret-free diagnostics.
- Five browser cleanup/activation regressions passed; one opt-in protected-handoff case
  was skipped by its existing fixture condition.
- Native race tests and vet pass; regressions cover forged proofs/variables, actual
  uncontained processes, writable deleted files, private callback metadata and native logs.
- An opt-in root test ran on csc-sys with a disposable account, isolated loopback OpenSSH
  server and temporary agent fixture state. Shell, command, SFTP and SCP were denied after
  early finish. The original deadline remained enforced. A real Python background writer
  blocked restoration after an engine restart; stopping only that writer allowed release
  while the same denied idle SSH process remained alive. Protected checksum was unchanged.
  This test uses fixture collection/cgroup operations; existing agent tests cover those
  operations. It never enrolls or changes a real student's account.

Run the root qualification with a compiled core test binary and
`EXAM_RELEASE_SSH_TEST=1 ... -test.run=^TestDeniedIdleSSHRestorationWithRealOpenSSH$`.
The test refuses to reuse its fixed UID 29980 or an existing account.

## Deployment and rollback

Deployed code revision `e10ff5e` on October 19, 2026. Both class-server state and the
webserver database had no preparing, active, locked or unresolved collection attempts.
The native installer used its state-lock drain barrier with PREPARING also prohibited,
so no preflight or timed attempt was cancelled. No account policy/configuration changed.

- Web image: `ssh-exam-workspace:denied-ssh-e10ff5e`, also the normal `:1.0.0` service tag.
- Image SHA-256: `988ef297127a0b6644a6f6462755ebc2aa3b1b39da498fd809d6e271f1d41fc4`.
- Previous image: `ddb8071015526b55c745ca1efe158f6508c7d4ff2c60004d11082ad39515c8c2`.
- Private web backup/receipt: `/var/backups/ssh-exam/20261019T172017Z-denied-ssh-o6sl5x74`.
- Native binary/configuration backup: `/var/backups/ssh-exam/20261019T172010Z-browser-ssh-3xvb6log`
  (the existing upgrade tool retains its historical backup label).
- Installed exam-agent SHA-256: `8c6902288517eb466139ff951cddf6e08fd65c51a3c838e69c83daf1b235a344`.
- Installed exam-login SHA-256: `32fcf80b2f135bf36e3e6fa88452f85750516c525684ca6a133d5fc24586a19e`.
- Installed examctl SHA-256: `e31d840051ce380989fd891403cd3d230b0e082217340611d0310359e6523e39`.
- Installed exam-info SHA-256: `3c62e75960e6b9c19a5bd9156bafb6de60f887f9ed97f203a8a201bfaccde1e0`.

All four installed native hashes and all three changed compiled server modules match the
local build. Public readiness reports production ready, maintenance false and notifications
true. The web container is healthy with zero restarts; agent and independent watchdog are
active with zero restarts. Native health is ready and still lists mcadilha as the unrestricted
administrator sandbox. Its login shell remains `/bin/bash`; native configuration is byte-for-byte
unchanged. The disposable qualification account was removed.

An isolated check imported the exact deployed server modules, exercised failed cancellation,
retry deduplication and secured-submission restoration alerts against temporary data, and passed.
It neither touched production attempts nor sent mail. Frontend assets are unchanged.
The affected adomecq attempt remains COMPLETED/protected, policy NORMAL, access RELEASED,
with no access error. `examctl manifest` verified the same original protected checksum.

Rollback requires drained attempts and the existing guarded native/web installation procedure.
Restore the previous binaries/image, preserving current state, policy journals, deadlines and
protected submissions. Never restore the backup state snapshot over newer attempts or archives.
No database/schema rollback is needed. Older agent code ignores the new denial bookkeeping
and reverts to its stricter restoration scan, so denied idle SSH can again delay release.
