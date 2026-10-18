# ssh-exam.cadilhac.name deployment

> Initial installation/history record. The subsequent SSH command and callback
> architecture is now deployed on both hosts; see [the upgrade record](ssh-command-deployment.md)
> for transport and migration history, and [qualification](production-qualification.md)
> for current SMTP delivery, isolation evidence and remaining installation restrictions.

Installed on 2026-10-12 on `marco` (Arch Linux), following TagMix's conventions:

- Checkout: `/home/micha/src/ssh-exam`, public HTTPS Git remote.
- `/opt/ssh-exam` symlinks to that checkout.
- `ssh-exam.service` is enabled and manages the `ssh-exam` Compose project.
- `docker-compose.yml` is a tracked symlink to `compose.yaml`.
- The app binds on host `127.0.0.1:3001`; TagMix keeps port 3000.
- nginx configuration: `/etc/nginx/servers.d/ssh-exam.conf`.
- TLS uses the existing certificate at `/etc/letsencrypt/live/cadilhac.name-0002/`.
- Removed only the two obsolete ssh-exam redirect blocks from nginx.conf. Backup:
  `/etc/nginx/ssh-exam-backups/20261012T210007Z/`.
- Environment: `/etc/ssh-exam/ssh-exam.env`, also the checkout's ignored `.env`.
- Private config/trust/secrets: `deploy/config`, `deploy/trust`, `deploy/secrets`.
- Persistent data: `var/production`, owned by container UID/GID 10001.

The dedicated gateway client certificate was issued locally; only its client key and public
trust chain were transferred over SSH. The CA private key was not transferred. The initial
database contains the existing instructor account hash and sandbox; it contains no test
attempts, sessions, recordings or submitted work. Sandbox retains its five-minute repeatable
behavior, absent validity window and automatic continuation approval.

The service runs with `NODE_ENV=production` and production configuration, in explicit
maintenance mode. HTTPS and instructor login/dashboard are verified. Container liveness
passes and `/health/ready` returns 503 with maintenance true and productionReady false.
This is intentionally distinct from production exam qualification. The persistent class-agent
network route, full class-server isolation and notification delivery remain to be configured
and verified; the readiness flags remain false. Do not enable the privileged functional-test
agent or replace missing signoffs with true values to make production readiness pass.

Verification: pinned Node 26 Docker image builds on this host, non-root container is healthy,
nginx and systemd unit validate, HTTP redirects to HTTPS, instructor login succeeds, sandbox
is visible in the dashboard, and 86 local application tests pass. TagMix's service and proxy
remain unchanged. See [dashboard screenshot](screenshots/deployed-instructor.png).

Update using:

```sh
cd ~/src/ssh-exam
git pull --ff-only
sudo docker compose --project-name ssh-exam --file docker-compose.yml build
sudo systemctl restart ssh-exam
```

Changing nginx assets also requires copying the new file to servers.d, running `sudo nginx -t`
and reloading nginx. Preserve private configuration and data across updates; never run
`docker compose down -v` for an update. Restart only after draining active attempts.

The 2026-10-18 [inline admin update](inline-admin-deployment.md) was deployed
through a temporary nginx frontend overlay to preserve an open student preflight.
That document records its verification, rollback and removal during the next drained
webserver restart.

The [activation recovery deployment](recovery-diagnostics-deployment.md) removed
that temporary overlay during a drained restart later on 2026-10-18. The standard
nginx proxy and normal image-based deployment workflow are in use again.
