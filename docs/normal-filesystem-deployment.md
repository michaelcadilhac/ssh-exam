# Normal filesystem and roster deployment

Deployed revision **c9d04f4** on 2026-10-18 UTC to marco and csc-sys.
The public site is https://ssh-exam.cadilhac.name/.

## Running release

- Marco checkout: `/opt/ssh-exam` (the existing home-directory symlink).
- Image: `ssh-exam-workspace:normal-filesystem-c9d04f4`, also tagged as the existing
  systemd default `ssh-exam-workspace:1.0.0`.
- Image SHA-256: `dfbe4e6793feb1d8673bf8e5a7a3936b080045f5f1ae0eccfe266b8d0d7465bb`.
- Frontend: `/assets/index-DefhK2xy.js`; browser SSH WASM SHA-256 remains
  `6d2bd4609e2fc1f7ef91b4912a1fb2c4100df63c1b314508916ce1e337579f8a`.
- Native exam-agent SHA-256:
  `1d774e49fe12ddd75aca316ac9ccd93fe0a3cda48b82b64f91a1671d26069cb1`.
- Class configuration: `host_filesystem=true`, `rootfs=/`. The temporary per-toolchain
  mounts and service dependencies were removed. The previous minimal rootfs remains
  on disk for recovery but is excluded from student access.

The new web image includes the pending case-preserving roster import changes and
row-specific validation messages. Privileged/service names remain rejected regardless
of capitalization. The native enrollment utility is synchronized as well.

## Preservation and availability

Installation required no live/preparing/unresolved attempts, no remaining workload
cgroups and restored account policy. No exam or preflight was cancelled. Administrator
passwd/group records and unrestricted sudo were verified unchanged. Sandbox remains
available. All administrator, exam and enrollment rows and all started attempt
identities/timestamps/checksums matched the web backup. Native started attempt timing,
original deadlines and submission checksums also matched their baseline.

The webserver was briefly placed in maintenance during cutover, then reopened.
Public readiness confirms `ready=true`, `productionReady=true`, `maintenance=false`,
`notifications=true`, `mode=production`. The class agent reports `host_filesystem=true`,
`ready=true`, `production_ready=true`, `missing=[]`. Agent, independent deadline
watchdog and reconciliation timer are active. No nginx, SMTP, MFA, host pin or browser
relay setting changed.

The checkout's Git metadata ownership was restored to the existing repository owner
so the normal `git pull --ff-only` workflow works again.

## Verification

The 170 web unit/integration tests, typecheck and production build passed. Browser
coverage includes 73 standard checks and the two browser-SSH-only handoff/recovery
checks. A startup test was corrected to await activation before reading the deadline;
its focused rerun passed. The remaining browser tests passed in the full run.

Native regression/race tests, vet and two installer tests passed. The exact installed
binaries match the verified bundle. The final real namespace test passed under the
agent's ProtectSystem, ProtectHome, PrivateTmp, NoNewPrivileges and setup-capability
settings, using unused UID/GID 29999 and the deployed filesystem policy. All **2,152**
public installed commands were executable; GCC/G++/GDB, Python, Java, Emacs and Vim ran
successfully. Home/software writes failed, ordinary home files were readable,
private temporary/application storage was writable, host control sockets were hidden,
and all student capability sets were zero. Editor mount tests reject redirects outside
the read-only home and writable ancestor/descendant mount overlap.

## Recovery

- Marco backup: `/var/backups/ssh-exam/20261018T053603Z-host-filesystem-f2n4iwby`.
  Contains the original config, database/data backup, previous image and receipts.
- Previous web image is additionally tagged
  `ssh-exam-workspace:pre-normal-filesystem-c9d04f4`.
- Class backup: `/var/backups/ssh-exam/20261018T053620Z-host-filesystem-n9k_stnb`.
  `files.json` maps configuration, binaries, old toolchain mount units and dependencies
  to numbered backup files. The installation receipt includes checksums and health.

See [class-server recovery instructions](../ssh-server/README.md#normal-server-filesystem-deployed-student-environment).
Drain before rollback; restore software/configuration, never stale attempt state over
new deadlines or submissions. Database/data snapshots are for recovery inspection and
must not replace newer production records during an ordinary image rollback.
