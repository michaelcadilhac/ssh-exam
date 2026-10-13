# Application-host deployment

Prerequisites: Linux, Docker Engine, Compose v2 supporting --wait/--wait-timeout, nginx/systemd,
TLS certificates, Ed25519 command/callback keys and SMTP. Native components install separately.
Node baseline is 26.11.1-bookworm-slim with exact manifest digest in Dockerfile. Upgrade
tag/digest/dependencies together after testing, outside active exams.

SMTP settings and recipients are administrator-configurable in `deploy/config/config.json`.
For network SMTP use `host`, `port`, `secure`, optional `user`/`passwordFile`, `from` and
`to` (an address list). Network SMTP always requires verified TLS. When the webserver
and OpenSMTPD share a host, an optional private Unix socket avoids a network relay and
requires no SMTP password:

```json
{"smtp":{"socket":"/run/mail/smtp.sock","from":"exam@example.edu","to":["instructor@example.edu"]}}
```

The Compose mount `deploy/mail:/run/mail:ro` must contain only this local endpoint.
On marco, register a dedicated locked, nologin `ssh-exam` service account with
UID/GID 10001 if those IDs are unused. Create `deploy/mail` owned by UID/GID 10001 mode 0700, install
`deploy/systemd/ssh-exam-mail.socket` and `.service`, and enable the socket. It exposes
the protected endpoint through systemd-socket-proxyd to OpenSMTPD's dedicated loopback
listener at `127.0.0.1:2526`, with the existing DKIM filter and outgoing tag. Configure
`listen on 127.0.0.1 port 2526 filter "dkimsign" tag DKIM_OUT` on marco. OpenSMTPD's
default `/run/smtpd.sock` uses an enqueue handshake rather than a raw SMTP stream and
must not be used as this proxy target. The loopback listener follows the mail daemon
across restarts. Socket mode 0600
limits callers to the application UID. The TCP transport remains encrypted; the Unix
transport uses local IPC and does not request TLS or authentication. Both transports
have bounded connection/greeting/idle timeouts. Delivery rejection remains in the durable
outbox with retry/backoff; SMTP acceptance does not prove final recipient delivery.

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
The pinned agent callback public key goes in deploy/trust; gateway signing key/SMTP password go in deploy/secrets, UID/GID
10001 mode 0400 with protected parents. Configuration/trust must be container-readable.

    docker compose build
    docker compose up -d --no-build --wait --wait-timeout 120
    curl -fsS http://127.0.0.1:3000/health/live
    curl -fsS http://127.0.0.1:3000/health/ready

Production exam starts fail closed without signoffs, HTTPS/signatures/pins and SMTP configuration.
Initial production installation may boot with `maintenance: true` while signoffs and
notifications are pending: the operator dashboard remains available, liveness passes,
readiness returns 503, and new student authentication/preflight/activation is blocked.
Removing maintenance without the complete production report and notifications fails startup.
Maintenance does not authorize privileged functional-test mode in production.
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
connections to configured jump SSH, SMTP and DNS/time facilities.
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

## cadilhac.name installation

On `marco`, `/opt/ssh-exam` links to `/home/micha/src/ssh-exam`. The `ssh-exam.service`
unit reads `/etc/ssh-exam/ssh-exam.env` and uses the tracked `docker-compose.yml` symlink.
Set `EXAM_HOST_PORT=3001` in that environment file (and the checkout's ignored `.env`
for manual Compose commands); TagMix retains localhost port 3000. Install
`deploy/nginx/ssh-exam.cadilhac.name.conf` in `/etc/nginx/servers.d/`, removing the old
domain-only redirect blocks from nginx.conf after taking a backup. The existing
cadilhac.name certificate covers this hostname. Validate nginx before reloading.

    cd ~/src/ssh-exam
    git pull --ff-only
    sudo docker compose --project-name ssh-exam --file docker-compose.yml build
    sudo systemctl restart ssh-exam

Private configuration, readiness, trust certificates, client key and database stay out of
Git. Preserve `/data` and the original attempt/deadline state when updating. To enable exams,
verify signed commands through student SSH, outbound agent callbacks and instructor notifications, verify the
production class-server guards, complete the readiness report, then remove maintenance
during a drained restart. Keep sandbox in the exam configuration; its normal isolation and
protected collection requirements still apply, with automatic continuation authorization.

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


The native class agent connects outbound to this HTTPS origin to post signed status events
and verified archives. No route from this host to a separate class-agent endpoint is needed.
Configure `agent.id`, `agent.signingKey`, `agent.callbackPublicKey`; the matching class
configuration uses `agent_id`, `gateway_public_key`, `callback_url`, `callback_key`.
Private `gateway-signing.key` is mounted as `gateway_signing_key`; only the class callback
public key is mounted at `/run/trust/agent-callback.pub`. Dedicated nginx archive callbacks
allow 128 MiB, while student uploads keep their 12 MiB cap. Remove old control tunnel/API
credentials after draining and verifying the new route. See the native migration procedure and
[installed production activation record](production-qualification.md) for marco/csc-sys.

Readiness signoff additionally requires `sshCommandTransport` and `statusCallbacks` after
actual command/callback and recovery checks. Both default false. See
[the installed qualification record](production-qualification.md) for evidence and remaining
installation restrictions; disposable-guest isolation does not alter host account policy.
