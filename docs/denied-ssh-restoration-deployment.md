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
