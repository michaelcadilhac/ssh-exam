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
After the first login, use **Add administrator** in the instructor dashboard to create
additional accounts. Each has the same administrator permissions. Choose a unique
username and confirm a password of 12–1024 characters. Creation is audited; an
existing account is never overwritten. The CLI remains available for initial
bootstrap and operator recovery through creation of a separate account.

Install deploy/nginx/exam-workspace.conf.example inside nginx's http context; replace hostname
and certificate paths. It supplies HTTP redirect/TLS, WebSocket upgrade, explicit forwarding
headers, 12 MiB body cap, 75-second live timeout and bounded authenticated monitoring responses.
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
wait for attempts to finish/protect, back up offline, build a version-tagged image,
test, deploy --no-build and verify readiness. Roll back the prior tag with preserved compatible
data/migration version. Never down -v. Keep certificate/trust rollback copies.

    docker compose stop --timeout 45
    scripts/backup var/production /secure/backups/exam-YYYYMMDD --gateway-stopped
    scripts/restore /secure/backups/exam-YYYYMMDD /secure/restored-data --gateway-stopped --deletion-ledger /secure/latest-metadata.sqlite

Restore to a new directory, merge latest tombstones, reconcile remote canonical attempts,
then switch the stopped mount. Retain the latest deletion ledger separately from old backups.
Encrypt/private-protect backups and enforce monitoring expiry. Live database-only copying
does not consistently back up SQLite WAL and files.

Preflight expires fifteen minutes after opening, even if a background page continues
sending contact. The class agent persists its preparation timestamp and enforces
expiry locally without the browser or webserver; restarting or signing in again
never extends an existing preparation. Expiry closes practice workloads, revokes
unused admission/handoff tokens, discards temporary preflight data and restores
any unstarted account setup through the existing recovery transaction. It never
starts or collects an exam. Students may sign out and sign in for a fresh preflight,
without instructor authorization or exam time consumed. A committed exam start is
excluded from preflight expiry.

`preflightIdleMs` optionally shortens disconnected-preflight cleanup (default 900000).
It cannot extend the fifteen-minute absolute preparation limit. Connected preparation
sends contact independently of fullscreen/capture readiness; these signals neither
extend preparation nor authorize/renew timed-exam execution. Existing native records
without a preparation timestamp receive one persisted fifteen-minute grace period unless
an administrator can establish their age from authoritative web metadata.

Disconnected cleanup commands and command timeouts wait for signed local-expiry
confirmation before notifying instructors. The grace is two minutes after the
later of expected expiry or the first failed command. The durable outbox/audit
binding survives restarts and cannot be postponed by retries; signed cancellation
or a committed start suppresses unsent/retrying warnings. Explicit command
rejections and reported native cleanup errors still alert immediately. See
[cleanup confirmation alerts](preflight-confirmation-alert-deployment.md).

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


Exam-dashboard/storage upgrade: drain active/preflight attempts and install the matching
native agent and webserver together. Native health must advertise `server-only-submissions`;
additive clock operations also require `clock-extend`. No new keys or network listener are
needed. Preserve original/current deadlines, revision history, request IDs, callbacks and
protected class-server bundles. The webserver rejects former archive uploads with 410 and
has no submission download/deletion routes. Historical web copies are not automatically
removed: verify the corresponding authoritative root-protected archive/checksum on csc-sys,
then retire obsolete web copies and their backups under the operator retention policy.
Do not restore an older transfer-enabled agent to implement a UI rollback. Keep watchdogs,
current schema/state, pending timing changes and account holds intact.

## Temporary student restrictions

New configurations use `temporary_account_policy: true` and an empty `accounts` map;
only explicit trusted administrator sandbox exceptions belong in that map. Do not run
`enroll-accounts` for ordinary students. Web enrollment authorizes their signed SSH
registration and NSS identity resolution without persistent OS account changes.

Install `scripts/account-policy` as root-owned mode 0755
`/usr/local/sbin/exam-account-policy`, together with the updated isolation checker and
native binaries. The daemon launches only that fixed helper through systemd-run, outside
its read-only namespace; do not grant the webserver sudo, root SSH or a general control
API. Enable the independent watchdog/reconciliation units. The web metadata migration
009 stores policy setup/restoration state separately from submission/access state.

Drain and restore legacy permanent enrollments before enabling this mode; it rejects
ordinary static-account entries. Preserve mcadilha's administrator sandbox exception.
Qualify normal access, automatic protected SSH handoff, early finish, deadline restoration and outage
recovery with the disposable guest. Directory-backed deployments additionally require
SSSD local-override initialization and exact override round trips without per-exam
SSSD restarts. Set `guards.json`'s `temporaryAccountPolicy` to true only after qualifying
the actual installed provider and enabled access routes. Unsupported jobs/services fail
preflight without deleting their configuration. See
[temporary account isolation](account-admission-proposal.md) and the
[recovery procedure](recovery-runbook.md).

Single-sign-in upgrade: install the matching browser WASM module, webserver and class agent.
Install the root-owned `exam-principals` helper, then review/apply `ssh-server/scripts/install-handoff
--administrator ADMIN`. It generates a dedicated root-private exam CA and validates the effective
SSH include before reload. Existing unrelated CA/principals integrations require explicit operator
integration; the installer refuses them rather than replacing them. No new listener or webserver
SSH access is added. Health must advertise `single-sign-in-handoff` and report ready before
reopening admission. Drain unstarted setup and active attempts before upgrading. Never remove
an active account policy or roll back its state to perform a software rollback.

## Connection process capacity

Connection workers are supervised OS processes, not additional HTTP instances. Configuration
`connectionWorkers` controls concurrent live login/attempt workers (default 32, range 1–128).
New logins at the limit are rejected without evicting students. Every worker has a 64 MiB V8
heap cap, bounded IPC and reduced thread counts. The default Compose memory budget is 4 GiB
and its PID/task allowance is 1,024. Core-file limits are zero for the supervisor and
inherited workers, to avoid writing process-memory dumps on fatal failure; provision higher memory and task capacity before increasing
worker count. The heap cap does not count native allocations, and these processes still share
the host/container. Linux workers raise their OOM score above the HTTP supervisor. A worker
crash/hang is an attempt-local interruption and durable email, not a webserver restart. Check
the configured SMTP recipients in `smtp.to`; no recipient is hard-coded in the worker.

## Candidate monitoring purge runtime (not deployed)

Local C1gb2 adds migration 017 and one supervised purge worker, not another HTTP
instance. Require Linux/procfs and util-linux /usr/bin/flock (explicitly installed
in the candidate image and checked by doctor). Preserve private numeric ownership
and the persistent 0600 monitoring-purge.lock inode; never unlink it to bypass a
surviving worker. The worker has a 32 MiB V8 heap cap, not a hard RSS/cgroup limit;
include it in aggregate container/SSH capacity qualification. No synchronous
fallback is allowed. Jobs survive retired preparations, retry safely and expose
honest logical deletion versus timestamped current-directory absence. Backups
retain both tombstones and jobs, without resurrecting monitoring. A separately
authorized rollout/rollback must drain old/new purgers and preserve that ledger;
an older gateway loses isolation and status. See monitoring-purge-isolation.md and
todo-rollout-plan.md. No production change or migration is authorized here.
