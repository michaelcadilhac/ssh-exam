# Routine editor-lock omission email filtering

Revision **0f9278d** was deployed to https://ssh-exam.cadilhac.name/ on
2026-10-18 at 23:01:26 UTC.

## Policy

The collector continues to omit symlinks/special files safely and records every
omission in the immutable manifest. The webserver now suppresses omission email
for the exact collector record `PATH: symlink omitted (never dereferenced)` when
PATH has the Emacs lock basename `.#NAME` and its saved sibling NAME appears in the
same submission's regular-file inventory. Nested paths are matched within the
same directory. This does not follow the link, alter the archive, delete the lock
record or change collection/access policy.

Other links, special files (including ones with lock-like names), orphan lock
records, unknown omission reasons and any mixed manifest with another omission
continue to generate `Submission entries omitted`. Collection-failure alerts are
independent, including when a protected archive exists but workload cleanup fails.
Existing email history is unchanged; there were no omission emails awaiting delivery
at the pre-deployment queue check.

## Verification

- All **190 unit/integration tests**, typecheck and production build passed.
- Added coverage for root/nested editor locks, other symlinks, special files,
  absent/wrong-directory saved counterparts, unknown reasons and mixed omissions.
- Tests verify that the original manifest is untouched, omission records remain in
  persisted receipts byte-for-byte across restart/replay, other-omission emails still
  queue, and collection failures retain their alert and account hold.
- The running lifecycle module matches the tested SHA-256:
  `f386586dcee25d71db90ed5249fd7e0b8cd5838c339f6b4f9be637900df69146`.
- Public HTTPS readiness passes with productionReady/notifications true and
  maintenance false; the container is healthy and the systemd service is active.
- The unchanged frontend remains `/assets/index-BV-uhbr8.js`, SHA-256
  `f9fa8dc8e28eb24aa55a727c7bcf0b92bb98afa8ade0a90699a58a97ef28ecbf`.
  CSP is still present. No browser/UI behavior changed in this release.

## Deployment and rollback

Marco's normal checkout, Compose build, standard image tag and systemd service
were used. Student activity was checked before stopping the webserver and again
before its consistent offline backup. No preparing/active/locked attempt or
unresolved collection was present. No student resets or submission changes were
performed. Nginx, private configuration, SMTP, sandbox and administrator access were
preserved. No native class-server binary changed, so csc-sys needed no installation
or restart. Read-only Git checks disabled optional index writes to preserve the
normal checkout owner's permissions.

- Release tag: `ssh-exam-workspace:editor-lock-0f9278d`, also tagged as the standard
  `ssh-exam-workspace:1.0.0` service default.
- Image SHA-256:
  `e739a1d4c147212ff70599b3fdb16f7518035b21137b170f2e55fc5d9abbda57`.
- Backup/receipt on marco:
  `/var/backups/ssh-exam/20261018T230119Z-editor-lock-qsgw6web`.
- Previous image SHA-256:
  `ffdd06395a2009329b1d51b94c86d1f0a153ff99a60281e0091e355f24978473`.

For software rollback, drain student preparations/attempts, retag the previous
image as the standard default and restart ssh-exam. No schema rollback is needed.
Never replace newer attempts, monitoring records or protected submissions with the
backup. Apply the existing monitoring-backup expiration policy.
