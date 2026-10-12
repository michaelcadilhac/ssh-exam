# Application-host deployment

Prerequisites: Linux, Docker Engine, Compose v2 supporting --wait/--wait-timeout, nginx/systemd,
TLS certificates, private agent route and SMTP. Native components install separately.
Node baseline is 26.11.1-bookworm-slim with exact manifest digest in Dockerfile. Upgrade
tag/digest/dependencies together after testing, outside active exams.

For a host installation, use Node 26.x and reinstall with `npm ci` when upgrading from
Node 24. Native SQLite binaries are specific to the Node major version. Build and test
before restarting the gateway; restarting discards authenticated SSH connections.

    cd /opt/exam-workspace
    sudo install -d -m 0700 -o 10001 -g 10001 var/production
    sudo install -d -m 0750 deploy/config deploy/trust deploy/secrets
    cp examples/exam-config.example.json deploy/config/config.json
    cp examples/readiness.example.json deploy/config/readiness.json

Replace all placeholders, including verified SHA256-hex pins over decoded SSH public-key blobs,
trust paths, hostname/origin, notifications and actual signoffs. Obtain keys through trusted
institutional administration; ssh-keyscan alone is not verification. Keep maintenance true.
Client CA/certificate go in deploy/trust; private key/SMTP password in deploy/secrets, UID/GID
10001 mode 0400 with protected parents. Configuration/trust must be container-readable.

    docker compose build
    docker compose up -d --no-build --wait --wait-timeout 120
    curl -fsS http://127.0.0.1:3000/health/live
    curl -fsS http://127.0.0.1:3000/health/ready

Production fails closed without signoffs, HTTPS/mTLS/pins and SMTP configuration.
Bootstrap an administrator with your own interactive password. The source CLI supports EXAM_DATA
for initialization before signoff; ensure SQLite ownership is 10001 afterward, never ship a
default. Source commands: npm ci; EXAM_DATA=var/production npm run bootstrap-admin.
The built container also contains dist/scripts/bootstrap-admin.js for interactive Compose run.

Install deploy/nginx/exam-workspace.conf.example inside nginx's http context; replace hostname
and certificate paths. It supplies HTTP redirect/TLS, WebSocket upgrade, explicit forwarding
headers, 12 MiB body cap, 75-second live timeout and longer authenticated download timeout.
Logs omit bodies/cookies/query strings; private directories are never nginx aliases.
CSP is app-provided, with inline styles only for WinBox and no inline/eval scripts. Microphone
and system clipboard permissions are disabled. Add a narrowly scoped HTTP-01 ACME exception
if needed; follow institutional certificate renewal and test it before expiry.

    sudo nginx -t
    sudo systemctl reload nginx
    sudo cp deploy/systemd/exam-workspace.service /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable --now exam-workspace
    sudo systemctl status exam-workspace
    docker compose logs --tail=100 app

The oneshot unit manages Compose; container restart policy monitors the process. Run exactly
one gateway instance. No production Vite server or systemd inside Docker. Restrict outbound
connections to configured jump SSH, independent agent mTLS, SMTP and DNS/time facilities.
No runtime CDN access. Liveness is not proof of server guards/notifications.

After manual validation, set maintenance false during a drained configuration restart.
Restarting loses SSH and locks active attempts, so drain before upgrades. Set maintenance true,
wait for attempts to finish/protect/export, back up offline, build a version-tagged image,
test, deploy --no-build and verify readiness. Roll back the prior tag with preserved compatible
data/migration version. Never down -v. Keep certificate/trust rollback copies.

    docker compose stop --timeout 45
    scripts/backup var/production /secure/backups/exam-YYYYMMDD --gateway-stopped
    scripts/restore /secure/backups/exam-YYYYMMDD /secure/restored-data --gateway-stopped --deletion-ledger /secure/latest-metadata.sqlite

Restore to a new directory, merge latest tombstones, reconcile remote canonical attempts,
then switch the stopped mount. Retain the latest deletion ledger separately from old backups.
Encrypt/private-protect backups and enforce monitoring expiry. Live database-only copying
does not consistently back up SQLite WAL and files.

`preflightIdleMs` optionally configures the disconnected-preflight timeout in milliseconds
(default 600000). Connected preparation sends contact independently of fullscreen/capture
readiness; these signals never authorize or renew timed-exam execution. Expiry cleanup
also covers reservations whose SSH connection was lost during a gateway restart.

Original-interval isolation upgrade: install/rebuild the native agent and root machine checker,
apply the static managed-account shell and every SSH listener/channel/PAM/scheduler policy,
and repeat the disposable-account matrix in [ssh-server/README.md](../ssh-server/README.md).
The new native readiness flags intervalAccessHold, allSessionChannels, alternateServices and
schedulerIsolation default false; the gateway signoff additionally requires intervalAccessHold.
The production gateway refuses an older agent without interval-access-hold capability.
Do not deploy/roll back enforcement changes during outstanding holds. Existing started records
migrate conservatively to HELD; reconcile old protected bundles before releasing accounts.
Backup original deadlines, access states, initialized marker, UID mapping, audits and protected
bundles together. Stopping an agent must keep the static gate installed and fail closed.
