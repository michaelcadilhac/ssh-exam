# Browser SSH production rollout

Activated on 2026-10-13 Chicago time (2026-10-14 04:49 UTC).
Application and native agent source: `6233337`.
Production site: <https://ssh-exam.cadilhac.name>.

## Unsupported-browser view update, 2026-10-15

Web source `0ca6ada` omits the student form and its supporting login notices when
browser requirements are unavailable, retaining the compatibility message and
instructor sign-in link. The form also stays absent while compatibility checks
are pending. Build/type checking and seven focused browser scenarios passed.

- Current image: `ssh-exam-workspace:hidden-form-0ca6ada`, also tagged `:1.0.0`.
- Image ID: `sha256:a941a0fd41ae6acae6165bd4234be6deeda38c09e925a28c204523dd4f606a74`.
- Previous image: `ssh-exam-workspace:pre-hidden-form`.
- Web configuration/consistent metadata backup:
  `/var/backups/ssh-exam/20261015T164733Z-hidden-form-eohpeiog`.

## Browser compatibility update, 2026-10-14

Web source `44d7500` adds compatibility checks before student SSH authentication.
Missing fullscreen, screen sharing or keyboard lock, recognized embedding-policy
restrictions, insecure contexts and queryable denied permissions disable student
sign-in and preflight/reconnection controls. The form handler rechecks before any
authentication request, including forced submissions. Instructor sign-in remains
available. Loading the page does not request fullscreen or capture permissions;
actual permission grants remain part of preflight.

Verification covers 102 application tests and 17 browser scenarios, including
five incompatible/denied environments and a forced-submit guard. Independent
compatibility test clients use distinct fixture IPs so their extra visits do not
consume the existing student's anonymous rate-limit budget; production limits
are unchanged. Live Chromium checks confirmed supported sign-in is enabled,
missing keyboard lock disables student login before any authentication request,
instructor sign-in remains available, and production readiness is healthy.

- Image at this update: `ssh-exam-workspace:browser-check-44d7500`.
- Image ID: `sha256:e6e956a2cb900e7a5fe5edef32b3fad0769d0b5e43cf6e8f24141e065fa5a12b`.
- Previous image retained as `ssh-exam-workspace:pre-browser-check`.
- Web configuration/consistent metadata backup:
  `/var/backups/ssh-exam/20261014T160125Z-browser-check-6ek06er0`.

The native agent, exam state, account policy, signing keys and host pins were not
changed by this web-only update. Browser tests also wait for the reconnection
response before navigating, so the test does not cancel session revocation.

## Preflight and exit update, 2026-10-14

Application/native source for this update is `fc54019`. Preflight now describes trying
tools rather than starting work. Its toolbar omits administrator access-policy
details, the unexplained directory path and duplicate capture readiness. The
single active-exam exit is Finish exam: confirmation collects work and signs out
after protected completion. Preflight retains Sign out; pending/failed collection
stays visible. Administrator sandbox confirmations reflect its actual exception.

Practice files are now student-owned/readable/writable despite the root agent's
private umask. Additional panes preserve edits, older root-owned files are repaired
without replacing contents, and symlinks/hardlinks/special entries are rejected.

- Image: `ssh-exam-workspace:lean-fc54019`.
- Image ID: `sha256:4284a38b0675006d29b39d6a3243f468837952917f94ad41b3ffdcbe2ef6e1e6`.
- Previous browser-SSH image retained as `ssh-exam-workspace:pre-lean-preflight`.
- Web configuration/consistent metadata backup:
  `/var/backups/ssh-exam/20261014T154303Z-preflight-web-064pmq6m`.
- Native binary/config inspection backup:
  `/var/backups/ssh-exam/20261014T154052Z-browser-ssh-3b45_3o8`.

All 95 application tests, 12 browser scenarios, type checking/build and the native
agent race suite passed. Practice ownership/private-umask, preservation and unsafe
entry tests also ran successfully as root on csc-sys, including repair of an actual
root-owned fixture file. No timed attempt was interrupted; the guarded installer
cancelled an unfinished sandbox preflight before replacing the agent. Reload and
open a fresh preflight after this update. Existing administrator access, sandbox,
browser SSH, notifications and production readiness remain enabled.

The current native checksums are:

```text
715b9dd82e9a39171f808548d781680d349a0a6db89e835f107e78116931e030  exam-agent
a94f50cf3a7b99ec466bf66efe6e83b4f90262fd58d938bbf691798bfbbf3117  exam-login
22b76858def2a62dfd5df5ce899597267021f03f8c33a9448ed553372fbf3390  examctl
203c7f47c10362acdfdf0b93f12e1a7c85fd5b59dca623d64bd0db1583c9a3a8  exam-info
```

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

## Initial browser SSH release and backups

Marco checkout is `/home/micha/src/ssh-exam`, linked from `/opt/ssh-exam`.
The existing systemd unit, nginx virtual host and port 3001 remain in use.
The Docker build produces the pinned Go/WASM client and matching runtime, so
no Go installation is needed on marco.

- Candidate image: `ssh-exam-workspace:browser-6233337`.
- Running service tag: `ssh-exam-workspace:1.0.0`.
- Initial image ID: `sha256:2f45b16d2307622531ae491a1929b5ec138458fd2495073662f5c5c3c1af002f`.
- Prior image retained as `ssh-exam-workspace:pre-browser-ssh`.
- Private config and consistent SQLite inspection backup:
  `/var/backups/ssh-exam/20261014T044930Z-browser-web-47ytvbix`.
- Initial rollout native binary/config inspection backup on csc-sys:
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

The initial browser SSH release native checksums were:

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
