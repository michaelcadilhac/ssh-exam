# October 29 examctl scripting release

The instructor explicitly authorized implementation, commit, push and deployment.
The new workflow is documented in [examctl-scripting.md](examctl-scripting.md).
No real student grants are part of this development/release task.

## Qualified local result

The release adds complete metadata exports/projections, private resumable exact
operation receipts, bounded stdin/per-student settings, independently retryable
native source synchronization, CLI-only proxy configuration and the pure-zsh
course example. The web review uses the same optional per-student settings.
Existing immutable grant/window/source/Begin/hold policy is preserved. The optional
preview field changes neither schema33 nor the native execution wire.

Verification passed:628 application tests/111 files, actual root-mapped CLI →
signed gateway → native protected archives and zsh restart/lost-reply workflow,
6 focused process/TLS/privacy/output regressions, full CLI races, affected signed
transport/source-retention races, typecheck/vet/all-native/application builds,
7 affected browser workflows and exact-image production-maintenance startup/
schema24→33/history/clock/asset smoke. The image is
`sha256:1f3f79c61c5cf3010328e4b2321c62b29958169505e1e4be5153f3d21e572724`,
tag `ssh-exam-release:examctl-scripting-20261029`. All six extracted assets match
the qualified packaged assets; new JS/CSS match the source build. Browser checks
use the actual packaged pinned WASM. Separate fixture batches respect the existing
five-per-minute instructor login limit. Initial fixture-race/locator/rate-limit
failures and corrected evidence remain in the ignored run directory.

The unchanged native agent, watchdog, SSH/PAM/cgroup/runtime keep their existing
exact-release qualification; those privileged boundaries are not requalified by
root mapping and are not replaced in this release.

## Guarded activation and rollback plan

Fresh read-only inventory found110 web histories and174 native histories, no
unfinished attempts/preflights/auth workers/active leases/pending clock or access
restoration. It is observation, not a permanent drain guarantee. The canonical
agent/watchdog and relay remain running.

1. Freeze/hash audited code-only image/CLI/example/docs and operation scripts;
   commit and push to the existing origin. Stage only these artifacts in fresh
   private directories on marco/csc-sys. Bind loaded image to exported Config
   digest and rootfs diff IDs, not only its tag.
2. Back up the exact nginx site and install the previously qualified admission
   gate. Syntax-check/reload nginx only; verify public new-start refusal and
   continued health/callback/monitoring/finish routing. Wait for old nginx workers
   to exit naturally. Repeat full independent web/native drain guards. Any busy
   or uncertain condition preserves services/data and defers replacement.
3. Stop only the drained web gateway. Make a fresh root-private full data/config/
   media/SQLite/current-image backup on marco; verify integrity, membership and
   checksums. Select the frozen image through the existing EXAM_IMAGE environment
   line and existing no-build Compose/systemd unit. Preserve installation files.
4. Verify schema33, all durable rows/prior audit, protected history and fresh
   signed native readiness. Atomically replace only examctl on csc-sys, with a
   root-private backup of the old CLI/config and native history snapshot. Install
   the protected CLI-local proxy companion and zsh example/operator guide. Do not
   restart native agent, watchdog, SSH or relay or alter agent.json/student data.
5. Exercise installed help, signed read-only projections and public readiness/
   packaged assets without issuing grants. Verify unchanged native histories and
   service PIDs. Restore the exact nginx site and reopen admissions, then verify
   public health and unauthenticated admission refusals.

Rollback requires another admission fence and positive drain. Restore the prior
compatible schema33 web image/environment selection and atomically restore the
backed-up CLI; remove the new CLI proxy/example only after verifying ownership and
exact installed hashes. Preserve current DB/native state and every newer grant,
attempt, source pin, hold, audit and submission. Never restore older database/state
backups over newer authority. Native service consolidation was already completed
in the October27 rollout and is not repeated here.

## Deployment status

Pending. No new production artifacts installed yet. Frozen evidence and owned
operation scripts: `var/collection-tests/examctl-scripting.exs9o_2m`.
