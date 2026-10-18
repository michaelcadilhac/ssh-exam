# Single-sign-in handoff qualification and deployment — 2026-10-17

Release `0d07c4c` is deployed on marco and csc-sys. Students authenticate with their
password and phone MFA once, complete preflight once, and click Begin exam. Account
setup automatically replaces only the class transport through the existing jump
connection. No second login screen or repeated capture/fullscreen/keyboard setup is
shown. Your administrator sandbox exception and normal recovery policy remain intact.

## Validation

- Clean release snapshot: 149 application tests across 30 files, TypeScript checking
  and the production build passed. Unrelated local roster/import changes were excluded.
- 14 Chromium transition/recovery tests passed. The actual WASM SSH, signed receipt,
  certificate-authentication and HTTP fixture proved one authentication start, one
  password/MFA interaction sequence, one display-sharing request, uninterrupted
  fullscreen, a working practice pane followed by an exam pane, unchanged attempt ID,
  zero clock before activation and the full 90-minute duration afterward. The clean
  source snapshot independently passed both focused browser tests.
- Browser SSH Go tests passed under the race detector. They verify one password and
  phone approval, retained jump authentication, no password fallback during handoff,
  class host pins checked before credentials, rejection of broader certificates,
  retired-transport watchers not closing replacements, and mutable private-key cleanup
  after success, failure, cancellation and timeout.
- Native Go tests passed under the race detector; go vet passed. Certificate tests
  cover attempt ownership, exact principal, forced dispatch/PTY-only permissions,
  bounded validity, stale/finished setup, unsafe keys, one-use registration, callback
  redaction and bounded rejection of an invalid monotonic policy fence.
- All 31 Python account-policy, principals and installation-check tests passed.
- The isolated systemd-nspawn guest on csc-sys passed 31 full real OpenSSH assertions:
  the original isolation/collection matrix plus ordinary-command denial for handoff
  certificates and new-transport authentication denial after grant consumption. The
  final build's kernel-tick guard passed three focused handoff assertions and two
  abandoned-setup/restart assertions. Ordinary SSH/SFTP and the exact account baseline
  were restored; all journals were NORMAL before the guest was stopped.

The disposable SSH guest initially lacked a global SSH drop-in include; the installer
correctly rejected ineffective configuration and rolled it back. Only the guest's
fixture configuration was amended before rerunning successfully. The real host already
includes its SSH drop-ins. Actual csc-sys algorithm policy accepts Ed25519 user
certificates and Ed25519 CA signatures. Existing SSSD authorized keys, password/MFA
requirements, administrator shell/groups/sudo, and per-user SSSD behavior were preserved.

No institutional student password or phone-MFA approval was obtained or simulated as a
real student login. The real ppanagop account passed read-only eligibility/isolation
checks; the student performs the final institutional login check.

## Deployment receipt

The user explicitly approved ending the sole unstarted preflight for this deployment.
It was cancelled without starting a clock. No timed exam was interrupted. Existing
administrator accounts, exams, enrollments, started attempt timestamps/checksums and
class-server original/current deadlines were verified unchanged.

- Web image: `ssh-exam-workspace:single-sign-in-0d07c4c`, also tagged `1.0.0` for the
  existing systemd/Compose update convention.
- Image digest: `sha256:37d7e55896fdf4b4661c9b05d757ea63a1e08bc798df9489195c48283465f2bf`.
- Native agent SHA-256: `6c2f8e49c5ed5241c93d95719e71bdb688108f55d3588c6d948c6eae30388c89`.
- Public and installed-container WASM SHA-256 both match:
  `6d2bd4609e2fc1f7ef91b4912a1fb2c4100df63c1b314508916ce1e337579f8a`.
- Public bundle: `/assets/index-wIoQSlKj.js`. It contains the automatic preparing state
  and no former `secure-access-reauth` transition.
- Public readiness: ready and productionReady true, maintenance false, notifications
  enabled. The signed class-agent configuration advertises `single-sign-in-handoff`.
- Dedicated CA: root-private `/etc/exam-agent/handoff-ca`; root-owned principals helper
  `/usr/local/sbin/exam-principals`; global SSH drop-in
  `/etc/ssh/sshd_config.d/05-exam-handoff.conf`. No separate control listener was added.
- Metadata remains at additive schema 9. All agent services and independent recovery
  mechanisms remain enabled; mcadilha remains the sole explicit sandbox administrator.

Root-private backups and receipts:

- marco: `/var/backups/ssh-exam/20261018T045611Z-single-sign-in-fzzvrart`
- csc-sys native/config: `/var/backups/ssh-exam/20261018T045600Z-single-sign-in-jpy8akik`
- csc-sys SSH installer: `/var/backups/ssh-exam/20261018T045644Z-ssh-handoff-a12tul9x`

Do not restore inspection state snapshots over newer attempts or submissions. Drain and
restore any temporary policy before binary/SSH rollback. Initial handoff credentials
cannot resume paused/active attempts; recovery still requires its existing instructor
approval and fresh interactive authentication. Students must reload the site to obtain
the matching browser/worker code before testing this update.
