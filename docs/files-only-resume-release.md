# Files-only resume: release preparation

Requested November4,2026; started23:59:06UTC. Preparation/qualification only:
production stays online. Runtime source c7ed0d6 includes feature0c52b07; its
native binary bundle and joined browser/SSH qualification are already frozen in
var/collection-tests/files-only-resume.20261104a/. Preserve those exact native
bytes and the ten existing dirty documentation screenshots.

## Delivery plan and acceptance

1. Register an exact files-only-resume scope in the existing matched web/native
   installer. Reuse its forward-only handoff, four binary/loaded-role pins,
   current-data preservation, freeze/drain and recovery rules. Test public
   prepare/apply/handoff/resume/refusal/recovery phases; unknown scopes and old
   writers must still refuse. No application or native behavior changes.
2. Build and export one image from committed runtime source. Freeze Config,
   rootfs layers, archive and shipped assets; verify actual schema37/history/
   clock/media compatibility and startup/background writers in isolated Docker.
   Exercise real signed poll expiry, delayed fresh support, seeded tombstones
   and due purge rechecks, and recovery of an already-running candidate without
   changing its snapshot. Reuse unchanged qualified proxy timing where its exact
   scripts/configuration match.
3. Rehearse the exact native installer in the existing guarded disposable guest
   against the frozen four binaries, including hardened source-worker failure/
   repair and original-deadline/collection/SSH assertions. Independently verify
   guest shutdown and unchanged host/base. Prepare reviewed manifests, measured
   recovery coverage and a concrete execution/recovery runbook for marco/csc-sys.

Stop at a frozen, reviewable release with passing installation, preservation,
recovery and reopening receipts. Do not apply maintenance, restart production,
alter production configuration/records, issue grants or change clocks. Any busy
qualification guard refuses its test. A new production deployment instruction
remains separate from this preparation milestone.

## Qualified artifacts; cutover not executed

All three preparation milestones pass. Evidence and the concrete execution/
recovery sheet are under
`var/collection-tests/files-only-resume-release.20261104a/`. This is artifact and
workflow qualification, not a production PREPARED/ONLINE controller receipt.
No production stage/state directory, maintenance fence, video pause, service
restart, live binary installation, configuration or student-record change was
made. Only the private immutable backup store was warmed, as described below.

The image was built once from committed runtime source
`c7ed0d6ba52c7841b3baaeee2d9a3103d3e987f8` in 77.58 seconds. Its exported Config is
`sha256:5aced132a0c43db08084db7711556b9960b0e3f71c58c7aeebf6cca4b1e3edfd`;
the 295,876,608-byte archive SHA256 is
`1d071b64bdca84a84264fba7428a3c3bffd6ab7261dfec879f4e494df13c9988`.
The local engine's manifest identity differs from that Config identity; the
archive Config and rootfs diff IDs were verified rather than equating those IDs.
`image-assets.json` binds all eight shipped web assets. Seven match the prior
browser qualification; the pinned Docker compiler produces a different WASM.
Both actual-WASM browser scenarios and the joined native/browser recovery were
therefore rerun against the shipped bytes before restoring the generated host
WASM. No application/native runtime source changed during this preparation.

The four native binaries are the exact previously qualified feature bytes:

| Binary | SHA256 |
| --- | --- |
| exam-agent | 773a5dd8e042a3d118230f19cfed44147b3e6499863988033cf0dd8f3ee2e06b |
| examctl | 2769f05fc3110fe5c5afaf183ae01148e935ab9eb67e9721ac8b2dffb62224db |
| exam-login | 1c87dea227fedd93303039919954c74133890f83e3aae60bfee0331ffd4fb73b |
| exam-info | 16f4032a51b675152b89c672daa77da0d46ca9b6003647ef5251aa912e6380d8 |

The installer registers only the exact `files-only-resume-v1` scope alongside
the existing policy scope. It retains schema37, incompatible-old-writer refusal,
four-file/loaded-role pins, positive drain, handoff expiry, preservation and
forward recovery. Unknown suffixes/versions and mismatched source refuse before
stopping anything. The final controller and test inputs are frozen separately
from the committed application-image source.

## Verification and limits

| Entry point | Result and evidence |
| --- | --- |
| Matched deployment CLI | 23 final prepare/apply/handoff/resume, fault/recovery/refusal scenarios pass; `operator-focused-final.log` |
| Existing deployment/native/bridge CLI | 40 web, 16 native and 9 guard cases pass; `operator-{web,native,guard}.log` |
| Backup/restore CLI | 14 synthetic media/history/WAL/corruption/prune/warm/restore cases pass; `backup-restore.log` |
| Exact production image | schema37, 41 prior rows, native clock, no invented grants and media compatibility pass; `image-smoke.log` |
| Real image startup/current-data resume | 63.07 seconds, 13 signed polls, old/expired support refusal, seeded tombstone/due purge, 11 mutation refusals, 41 preservation contracts, original snapshot unchanged and zero extra starts; `image-startup-recovery.log` |
| Shipped WASM | current approval and legacy preparation refusal/repair both pass; `packaged-browser.log` |
| Guarded native installer | all four files replaced/all three roles reloaded, hardened source-worker refusal/repair and seven real SSH/policy/collection/original-deadline assertions pass; `native-install.log` |
| Shipped WASM + actual native roles | genuine SSH loss, fresh SSH/MFA/capture, SAME attempt/deadline/grant/hold, saved-file read and protected Finish pass in 53.7 seconds; `packaged-browser-native.log` and root log |

CLI phase/fault tests mock privileged transport. The populated image runs real
startup writers, signatures, SQLite, candidate HTTP and recovery/preservation;
its native transport, service dispatch and proxy are synthetic. The native
installer uses a disposable guarded systemd-nspawn guest, four real release
binaries and actual hardened roles; its before cohort uses the same code with
distinct ELF footers/inodes, and its web handoff is synthetic. The joined browser
uses real WASM/class SSH/PAM/cgroups/private workspace/native enforcement but
synthetic jump MFA/media. No new human production sign-in or clock is claimed.

Unchanged proxy renderer/templates, public-readiness helper, backup, native
controller/guard and preservation verifier match the previous operator freeze.
Reuse the actual November2 guarded production reopening receipt, including its
bounded asynchronous nginx check: the whole web resume took 45.38 seconds;
separate proxy latency was not measured. Do not present the mocked CLI timing as
proxy or production timing. `reused-qualification.json` binds this reuse. Earlier
application/race/66-browser qualification still applies: only two deployment-test
files differ among the 741 frozen feature inputs. No broad unchanged suite was
repeated. Final changed Python/operator/operation-driver syntax passes.

Both owned guests independently exited 0, are inactive/dead with MainPID and
ControlPID zero, and have no owned processes. Host binaries/config/authority and
guest base are unchanged. Local ports 3100/3101/9444 are closed; generated host
WASM was restored. All ten original dirty documentation screenshots retain their
baseline hashes. See `native-independent-cleanup.json` and local cleanup receipt.

## Recovery coverage and next execution

Read-only November4 inventory: marco still runs image e60c3972/schema37 with 114
historical attempts, zero unfinished attempts and one signed-in web session.
csc-sys retains the prior native568daaf roles/PIDs, 181 histories and zero
unfinished attempts/future deadlines. These observations are not a cutover drain.
Fresh full guards remain mandatory; changed history/PIDs require a newly reviewed
plan rather than alteration of an existing prepared snapshot.

The private incremental warm took 2.36 seconds: 128 new objects/25,110,318 bytes,
reusing 970,286,469 bytes. It opened no database and published no snapshot. The
subsequent identity scan took 0.24 seconds and proves all 6,913 current files /
995,396,787 bytes recoverable with zero new media required. About 66 GB remains
free. The retained old image's Config/layers match the current installation; its
archive hash remains pinned for the existing prepare guard. Backup/restore tests
and the prior consistent baseline establish the restoration path, but the final
CURRENT database/small-file and native state/work snapshots are still required
after the appropriate guarded stops. Never restore the previous database over
newer records or duplicate all recordings for this update.

`release.json`, `locations.json`, `operator-freeze.json`, `staging-archive-audit.json`
and `plan-validation.json` bind the exact local image/operator/native archives.
`matched-execution.md` gives staging, online preparation, drain/snapshot, native
installation, signed proof refresh, reopening, acceptance and phase-specific
forward recovery commands. The remote locations have not been created; staging
and the online PREPARED phase belong to a newly instructed execution. No build,
new feature or further policy decision is needed. One web session must sign out
before cutover; do not invalidate it. Existing three-agent consolidation is
retained, with no extra service/SSH/relay restart or migration.

One initial read-only metadata probe omitted the existing Python helper's module
directory. It failed before inventory, was corrected to use that directory and
then passed. This was a probe-path error, not a missing package or production
defect. No production change was used to repair qualification.
