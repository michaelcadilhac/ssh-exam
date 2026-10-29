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

**Deployed and online October 29, 2026; verified at 19:12 UTC (14:12 Chicago).**
Source commits07b6fa5 (scripting/shared review) and46bcfa2 (empty exports) are
committed and pushed to the existing origin/main.

- Web07b6fa5 runs on marco with unchanged schema33. Installed Config digest:
  `sha256:3549374a286f7b261bc6d75f7bc834cb1999a2ef17fb019454beaadd9d97fda5`.
  Exported Config and every rootfs diff ID match the loaded target image. The
  source engine reports OCI ID1f3f79c6… for those same exported blobs.
- CLI46bcfa2 is installed on csc-sys, SHA256
  `eb31116080c19646bb9e4b8e8c634df268f4772a6083b683ab2d92f08dc8c0a1`.
  The protected `/etc/exam-agent/examctl.json` supplies CLI-only proxy settings.
  `/usr/local/share/ssh-exam/examples/second-go.zsh` and matching docs are installed.
- Native source872fe80 remains unchanged. Agent4007876, watchdog210730 and
  relay893011 retain their PIDs. Agent configuration is byte-identical; the
  canonical socket owner, reconciler and account/lease/cgroup guards pass.
  No native, SSH or relay restart, migration, grant issuance or student edit.
- All38 durable tables and prior audit compared equal at activation, preserving
  all110 web histories. Final history hash64bbe769… remains identical. All174
  original native histories also remain identical. Ordinary account restoration,
  deadlines, source pins, protected submissions and existing grants are preserved.
- Fresh signed native roles, production readiness/notification flags, verified
  public TLS and all six packaged assets pass. The original nginx site hash
  `1d9b11f5d88128ef58509bc740f23d1f1d55777410c7f12a82e9636ad50be787` is restored;
  public start routes apply ordinary unauthenticated refusals instead of the
  temporary fence. Final inventory has no unfinished attempts or pending cleanup.
- Actual installed root CLI help, complete exams/roster/multi-exam histories,
  empty grant list and private definition receipt pass over signed HTTPS with
  ambient proxy variables cleared. Only aggregate counts/hashes were printed;
  no student rows were transferred into the release evidence.

Fresh root-private rollback backups remain on their owning hosts:

- marco `/var/backups/ssh-exam/scripting-20261029-x1mk36_6`: full data/config/media,
  SQLite integrity/FKs and prior image; 13,570,457,600 bytes, 153,801 members,
  SHA256 `df9a5de96f66464cade3dd34263129b327f3043fb0ab7ad554b99ba490bdfba2`.
- csc-sys `/var/backups/ssh-exam/scripting-cli-20261029-pmuk8m_o`: original CLI0c95fe05…,
  intermediate CLIbf9c0064…, configuration and private history snapshot. Neither
  native state nor submissions were rewritten. Follow the drained compatible
  rollback plan above; never overwrite newer authority with these backups.

Installed verification exposed the genuine zero-result projection defect: nil
rows were treated as a result envelope. It was reproduced through the actual
CLI/TLS entry, corrected in46bcfa2 and passed all-five-format regression/full CLI
races/vet/actual gateway-zsh checks before CLI-only replacement. The final real
empty-list probe passes. The unchanged628 application/seven packaged-browser/
image evidence continues to apply; no web/native contract changed in that fix.
Original failures and frozen evidence/scripts are retained in
`var/collection-tests/examctl-scripting.exs9o_2m`. No open release blocker remains.

The initial all-old-nginx-workers wait refused because two shutting-down workers
continued unrelated requests to8181. They were preserved. A separate read-only
proof pins their identities, requires exactly one443 HTTP/1 client and its sole
loopback8181 current upstream per worker, no listeners/exam3001/named upstreams,
and no configured HTTP2/HTTP3 or keepalive-minimum override. Matching installed
nginx1.30.3 disables keepalive reuse once exiting, so these current non-exam
requests cannot become future exam requests. All other old workers exited. This
classifies ownership instead of terminating unrelated work; any different socket
or configuration refuses. Basis: [nginx graceful reload](https://nginx.org/en/docs/control.html),
[matching finalization source](https://github.com/nginx/nginx/blob/release-1.30.3/src/http/ngx_http_request.c#L2707)
and [keepalive minimum default](https://nginx.org/en/docs/http/ngx_http_core_module.html#keepalive_min_timeout).
Original refusal and scoped proof are retained alongside the normal full drain
and public fence receipts.
