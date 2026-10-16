> Historical deployment record. Current archive policy keeps submissions on the SSH server; automatic web transfer/resume-export described below has been retired. See [instructor operations](instructor-operations.md) and [recovery](recovery-runbook.md).

# SSH-command architecture deployment

> Historical migration record. Later fixes, SMTP delivery and strict Linux isolation testing
> are recorded in [production qualification](production-qualification.md).

Upgraded `marco` and `csc-sys` on 2026-10-12 (Chicago; 2026-10-13 UTC).
The architecture release is `7633669`; the subsequent migration fix adds audited
local archive-export controls for historical test submissions.

## Webserver: marco

The checkout remains `/home/micha/src/ssh-exam`, symlinked from `/opt/ssh-exam`.
`ssh-exam.service` manages the Compose project. nginx serves
`https://ssh-exam.cadilhac.name` through `127.0.0.1:3001`; TagMix's port, service
and configuration were left intact. The Node 26 production image was rebuilt.
Database migration 006 was applied without changing the instructor or sandbox.

The gateway's Ed25519 private key is generated on marco and mounted as
`/run/secrets/gateway_signing_key`. The class agent's callback public key is pinned
at `/run/trust/agent-callback.pub`. Private configuration, keys and database remain
outside Git with their existing restricted ownership. The secrets directory gives
the checkout owner's group write access so ordinary `git pull --ff-only` can update
its tracked README; private key files remain readable only by container UID 10001.
An interrupted checkout update was saved in a recoverable Git stash.

HTTPS nginx accepts the signed archive route up to 128 MiB; other routes retain
their existing limits. nginx configuration and the Compose container were validated.
Backups are root-private at
`/var/backups/ssh-exam/20261013T031034Z-web`, including a consistent SQLite backup,
configuration and nginx/unit files. The prior image is tagged
`ssh-exam-workspace:pre-ssh-callbacks`.

## Class server: csc-sys

The agent, account gate, `examctl` and `exam-info` are static native binaries with
verified SHA-256 manifests. The agent accepts commands only through its Unix socket
and peer-verified student SSH channels. The former TCP control API on port 9443 is
no longer listening. `/usr/local/bin/exam-control` dispatches to the signed command
gate for the existing trusted-account test profile; the production account-shell
and ForceCommand installation rules remain in `ssh-server/README.md`.

The gateway public key is root-owned at `/etc/exam-agent/gateway-signing.pub`.
The callback private key was generated on csc-sys and remains root-private at
`/etc/exam-agent/callback.key`. Only public keys were exchanged. The fixed callback
origin is `https://ssh-exam.cadilhac.name`; the watchdog/reconciliation service
drop-ins use the institution's outbound HTTPS proxy. They do not poll for commands.

`exam-agent`, `exam-deadline-watchdog` and `exam-reconcile.timer` are enabled and
active. Original state, deadlines, account mappings, templates, work and protected
archives were retained. There were no active attempts during the migration. The
root-private backup is `/var/backups/ssh-exam/20261013T031038Z-class`.

The 12 historical protected test submissions have no corresponding attempt records
in the fresh production webserver database. Their archive uploads are explicitly
paused with audited reasons, while their protected copies remain available through
`examctl manifest` and `examctl export`. They are not falsely marked as transferred.
`examctl export-status` reports this distinction. Import matching historical records
before using `resume-export`; retry uses the protected copy. New attempts have no
export pause and use normal automatic verified transfer. Status callbacks continue.

## Verification and remaining qualification

- Public HTTPS and instructor page return 200; container liveness/health pass.
- Signed configuration/status callbacks reached the production database.
- A gateway-signed command registered a real mcadilha SSH connection, another
  channel used its transport binding, and replay of the same command was rejected.
- The native race suite passes, including persistent export-pause/resume, verified
  copies and fail-closed audit checks. The prior architecture release passed 88
  application tests, 12 browser tests and 8 installation-checker tests locally.
- The old API listener is absent. Independent deadline services remain active.
- All 21 historical attempt records and 12 protected submissions are retained.

Production maintenance remains enabled. mcadilha retains its existing privileged
functional-test exception, home, shell and recovery access; the exception's original
expiration was preserved. The class agent explicitly reports production readiness
false. Full account isolation and notification delivery remain unqualified; readiness
flags are not replaced with fabricated signoffs. Deployment is complete, but this
installation is not approved to start production exams.

Normal web updates still use `git pull --ff-only`, Compose build and
`systemctl restart ssh-exam`. Native updates require the documented drained-attempt
binary/config migration. Restore binaries and compatible configuration together;
never restore a stale state snapshot over a newer deadline or protected submission.
