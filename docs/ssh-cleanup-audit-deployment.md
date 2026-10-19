# SSH cleanup audit and deployment

Revision **035d0c6** was deployed on 2026-10-19 at 05:07:42 UTC
(00:07 Chicago time).

## Changes

The audit covered terminal close/natural exit, preflight sign-out, active-session
logout, secured completion, SSH loss, control rebind and fallback server-side SSH.

- Concurrent closes share a single awaited signed close. The browser no longer races
  a direct worker close against the server-authorized operation. Queued input to a
  closing pane is dropped while other panes stay usable.
- Natural shell exit releases the corresponding backend pane slot. Exits before an
  open reply cannot resurrect an admitted/ready pane. This notification is untrusted
  bookkeeping only: the privileged class agent independently checks actual channels,
  scoped admission, attempt state and terminal limits.
- Worker callbacks, results and queued input are scoped to their worker lifecycle.
  Logout/close releases the worker, control socket, reply cache, outstanding callbacks,
  pane buffers and authentication listener. Late events cannot affect a new login.
- SSH admission has a ten-second gate bound and cancels when its pane/connection is
  closed. Command channels close on shutdown or their 120-second operation timeout.
  Duplicate pending opens are rejected; old pane cleanup cannot remove its replacement.
- Failed socket sends discard their pending timer/reference. Rebind installs its close
  handler before replay, so a failed replay still enters bounded detachment cleanup.
  Socket errors terminate the affected socket rather than becoming unhandled events;
  a failed best-effort close notification cannot interrupt transport teardown.
- Secured completion retires matching connection ownership and disables intentional
  loss callbacks, preserving a newer login. Protected-copy verification still precedes
  intentional collection teardown. Logout retains the established interruption policy;
  original deadlines and access holds remain unchanged.
- Fallback SSH admission now settles once and clears listeners/timers on close, error,
  timeout, rejected/malformed admission and success. Failed/late channels are closed;
  established channel errors remain handled.
- Large Unicode input uses surrogate-safe chunks of at most 8,000 UTF-16 code units,
  below both the gateway message limit and worker's 32 KiB UTF-8 cap. This prevents
  an oversized input rejection from being misreported as a closed terminal.

No class-server native binary, account policy, namespace, collection implementation,
SMTP, host-key, password/MFA policy or administrator configuration changed. The browser
WASM client changed and was deployed with the web application; the class agent and
relay did not need restarting. No student attempt was reset or extended.

## Verification

- Production build/typecheck passed; **238 unit/integration tests passed**.
- Go SSH-client tests passed with the race detector, including command/admission
  cancellation, duplicate pending opens/closes and preserving another terminal.
- **Ten browser checks passed** (seven actual WASM/SSH workflows and three controlled
  activation-transition fixtures): six repeated
  shell exits beyond the pane limit, closing one of multiple panes, preflight logout,
  fresh sign-in, early finish/verified collection/sign-out, direct active logout with
  unchanged deadlines, protected handoff, sandbox repeat/recovery, terminal controls,
  activation failures/focus grace and two-channel network recovery. The existing
  fullscreen-activation test now waits for fullscreenchange before asserting Keyboard
  Lock loss; the fullscreen promise can settle before that event is delivered.
- The **exact deployed WASM and matching runtime** were downloaded and exercised in
  two additional browser tests against disposable local SSH fixtures. Both passed.
  Local generated artifacts were restored afterward. Production and local toolchain
  build metadata can yield different WASM hashes; production bytes were tested directly.
- **Four deployed-frontend checks passed** using intercepted API/socket fixtures for
  recovery feedback, clipboard isolation and real Emacs output; no production student
  records were changed. An isolated process importing the deployed backend also passed
  natural-exit, coalesced-close, retained-other-pane and pending-shutdown checks.
- Public production readiness and notifications are true, maintenance false. Systemd
  is active, the container is healthy and its restart count is zero. Public frontend
  and backend module checksums match the tested source build.

These tests use disposable SSH/MFA fixtures, not a live student's DePaul phone approval.

## Deployment and rollback

The normal marco checkout/Compose/systemd workflow was used. No preparing, activating,
active, locked or unresolved collection was present at either pre-stop or offline
cutover checks. A private consistent state/configuration backup and startup rollback
were prepared. Existing submissions, monitoring, sandbox and administrator access were
preserved. There was no schema migration.

- Image: `ssh-exam-workspace:ssh-cleanup-035d0c6`, also tagged as the usual
  `ssh-exam-workspace:1.0.0` service default.
- Image SHA-256:
  `e37da4e7e46be5c2c10f8c5c6a7b2bf4236d603cabd28f7f0959e4cd2083ce5a`.
- Frontend: `/assets/index-CT2FrWTe.js`, SHA-256
  `6f98fbf874e31b08bbdc28cb3ba41989686c9aec0dd6294504487fa75c28195b`.
- Deployed WASM SHA-256:
  `4dc044a72c3f09b190f7cc3e6560c03b9319a90f3e1aef42491b12f7c9165cf7`.
- Browser SSH backend SHA-256:
  `6f35378166ae84a2c6fcbffa422e74d2e10ab5b9585fb5407158bc7d6b39b7f5`.
- Private backup/receipt: `/var/backups/ssh-exam/20261019T050732Z-ssh-cleanup-psl1ia4j`.
- Previous image SHA-256:
  `937b1310d6c8ea4f2aace9b39b86ff8d80decc8a0869ab5277dc509de14cce1a`.

Rollback requires drained attempts, retagging the previous complete image and restarting
ssh-exam; it restores the old browser assets and backend together. Preserve newer data,
monitoring and secured work. Reload pages after deployment. Apply the established
monitoring-backup expiration policy to the private backup.
