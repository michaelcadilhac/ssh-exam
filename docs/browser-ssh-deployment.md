# Browser SSH production rollout

Activated on 2026-10-13 Chicago time (2026-10-14 04:49 UTC).
Application and native agent source: `6233337`.
Production site: <https://ssh-exam.cadilhac.name>.

## Running architecture

SSH runs in the browser's dedicated Go/WASM worker. Its encrypted byte transport
is `wss://csc-sys.cdm.depaul.edu/ssh-exam/relay`, then the fixed institutional
route to sshjump. The browser authenticates sshjump, handles its phone MFA,
opens SSH forwarding to csc-sys, verifies that host's pin, and authenticates it
using the same temporary password. Terminal input/output and SSH credentials
do not pass through marco. The fixed relay and proxy route are described in
[the relay installation record](browser-ssh-relay-deployment.md).

Marco still serves the application and authorizes attempts/channels. Signed
commands travel through the authenticated student's SSH connection. Root-signed
receipts bind responses to the account, verified SSH transport, request nonce,
expiry and actual pane. The class agent records PTY output before forwarding it
and sends signed recording/status callbacks to marco. Screen/webcam capture
continues through the existing browser-to-webserver path. The agent's persisted
deadlines, collection and access restrictions remain independent of browser and
webserver availability.

The sandbox exam remains available, and mcadilha retains its administrator
shell and sudo access under the existing administrator sandbox exception.

## Installed releases and backups

Marco checkout is `/home/micha/src/ssh-exam`, linked from `/opt/ssh-exam`.
The existing systemd unit, nginx virtual host and port 3001 remain in use.
The Docker build produces the pinned Go/WASM client and matching runtime, so
no Go installation is needed on marco.

- Candidate image: `ssh-exam-workspace:browser-6233337`.
- Running service tag: `ssh-exam-workspace:1.0.0`.
- Image ID: `sha256:2f45b16d2307622531ae491a1929b5ec138458fd2495073662f5c5c3c1af002f`.
- Prior image retained as `ssh-exam-workspace:pre-browser-ssh`.
- Private config and consistent SQLite inspection backup:
  `/var/backups/ssh-exam/20261014T044930Z-browser-web-47ytvbix`.
- Latest native binary/config inspection backup on csc-sys:
  `/var/backups/ssh-exam/20261014T043304Z-browser-ssh-7s_epme4`.

Only `browserSSH` was added to the private production configuration:

```json
{
  "relay": "wss://csc-sys.cdm.depaul.edu/ssh-exam/relay",
  "audience": "exam-ssh-relay-class"
}
```

Existing host pins, signing keys, notification settings, readiness signoff and
student/account policies were preserved. Private configuration and database
snapshots are not committed to Git.

The final installed native checksums are:

```text
4bc704c8da137a9b3aab248fe462ca1c27a12102ec4bc6e0a4076bcee2dbee8b  exam-agent
e18c19f3b4db97ddde114d0b18ddbbb34161de30e85f19c063d0273cd06c666b  exam-login
0ffd1db269d457551e3d41d7e78af1fd86fd322bdd816198e8e2d6de4d10895f  examctl
14276ad674384ed694528e678238a87b961c87d032b563dcb2f8254fe504b926  exam-info
```

The guarded native upgrader was invoked with Python and a SHA-verified bundle.
It refused started/unresolved attempts, stopped command admission under the
state lock, and left the independent deadline watchdog running. An orphaned
practice workload from an old cancelled preflight was stopped by its recorded
cgroup; ordinary mcadilha sessions were preserved. Cancellation now cleans up
practice processes, and the local reconciliation tick retries that cleanup.

## Verification

- All 95 Vitest tests passed, including signed response binding, tampering,
  recording retries/conflicts and monitoring deletion tombstones.
- The Go SSH client race tests passed for shared-password authentication,
  phone MFA, explicit unknown prompts, host verification before credentials,
  rejection without password retries, multiple channels and credential cleanup.
- The native agent race suite passed, including authoritative recording failure,
  signed receipts, cancellation cleanup and existing collection/access tests.
- All 12 browser scenarios passed with real WASM SSH over a local relay and
  disposable SSH hosts, exercising MFA, terminals, capture,
  interruption/continuation and sandbox.
- Production `/health/ready` reports ready, production-ready, notifications
  enabled and maintenance disabled; `/api/login-test` reports browser SSH enabled.
- A fresh headless Chromium loaded the deployed worker, reached the real DePaul
  BlueKey password prompt for sandbox/mcadilha through the public relay, and
  cancelled successfully. The password field was empty throughout and removed
  after cancellation; no browser errors occurred.
- A gateway-signed registration through mcadilha's existing authorized SSH key
  produced a verified root-signed, transport-bound browser receipt from the
  installed class agent. It did not start an exam or use a student password.
- Installed hashes, class-agent/watchdog/reconciliation/relay services and
  mcadilha's normal shell/sudo access were checked after installation.

The live checks did not enter a password or approve phone MFA. Fixture MFA
coverage is not a claim that a human completed DePaul phone approval during
deployment. To exercise that final user path, reload the site, select `sandbox`,
sign in as `mcadilha`, and complete the ordinary DePaul prompt/phone flow.

## Updates and rollback

Normal web updates retain the existing conventions:

```sh
cd /opt/ssh-exam
git pull --ff-only
sudo docker compose --project-name ssh-exam --file docker-compose.yml build
sudo systemctl restart ssh-exam
```

The production environment selects port 3001. Preserve its private config,
trust files, secrets, data volumes and readiness settings. Native updates use
`python3 ssh-server/scripts/upgrade-prebuilt BUNDLE` as root on csc-sys after
started/unresolved attempts have drained; never overwrite live agent state with
an inspection snapshot.

For a web rollback, pause new starts and drain active attempts first. Stop the
web service, restore the matching private configuration from the web backup,
tag the retained prior image as `ssh-exam-workspace:1.0.0`, and restart the
service. The new agent remains compatible with the legacy backend SSH transport,
so a web rollback does not require rolling back the native binaries. Preserve
all current metadata, root recordings, deadlines and protected submissions.

Do not restore the SQLite or agent-state inspection backups as part of ordinary
rollback: doing so would discard newer attempt, restriction and submission state.
Leave the class deadline/watchdog services running. Removing the relay is only
appropriate after browser clients have drained and the legacy web transport has
been restored; follow the separate relay rollback instructions then.
