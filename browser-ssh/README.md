# Browser SSH client

The production SSH client runs in a dedicated browser Web Worker. It uses the
pinned `golang.org/x/crypto/ssh` implementation compiled with Go 1.27.2 to WASM;
the matching Go runtime and binary are self-hosted. `npm run build` builds these
assets locally; the Dockerfile builds them in a pinned Go stage, so the webserver
needs only Docker rather than an installed Go SDK.

Set web configuration `browserSSH` to:

```json
{"relay":"wss://csc-sys.cdm.depaul.edu/ssh-exam/relay","audience":"exam-ssh-relay-class"}
```

The backend performs existing login/enrollment/attempt checks before issuing a
30-second relay ticket over the authenticated login control socket. The worker
authenticates sshjump (including multi-round/zero-prompt phone MFA), SSH-forwards
to the pinned class host, and reuses the password for that host once. Host-key
verification occurs before credentials for each host. Unknown hidden prompts
remain explicit; password changes and rejected/repeated passwords do not trigger
automatic retries. Other terminals reuse the authenticated connections.

SSH passwords and MFA answers never travel to marco. The UI clears its fields and
answer references immediately after posting to the worker. The worker scopes a
mutable password buffer to one login, zeroes it where practical and drops its
dialogue/credential references on success, failure, cancellation, disconnection
or authentication timeout. Callbacks refer only to a cleared holder after login.
JavaScript/Go/WASM strings, runtime allocations and transport copies cannot be
guaranteed erased; cleanup and worker termination are best-effort, not secure
memory erasure. No credential is persisted, logged, recorded or retained for
reconnection. The worker is terminated on logout/pause/completion.

Interactive input and output bypass marco. Control requests still use its
authenticated WebSocket: signed commands go through the student's SSH connection,
and root-signed receipts bind account, kernel transport, nonce, result and expiry.
Pane receipts bind the admission token hash and actual attempt/pane. The backend
verifies these before trusting a browser result. Private signing keys remain on
servers. A control socket may rebind within the existing 15-second grace; reply
caching prevents repeated root operations. Browser/worker/SSH loss requires fresh
login; original deadlines and continuation policy do not change.

Class-server PTY output, resize and lifecycle records are authoritative and
private. Raw keystrokes and authentication are not recorded. Root records output
before forwarding it; storage/quota failure stops the pane and locks the attempt.
Signed offset-based callbacks deliver batches to the webserver for instructor
replay, with durable offsets and byte-verified idempotent retries. The webserver's
deletion tombstones prevent uploads resurrecting deleted monitoring. Local class
recordings expire after 60 days; protected submissions have separate retention.
Screen/webcam images, incident handling and notifications continue on marco.

Run `go test -race ./client` for authentication and cleanup tests. Run the app's
Vitest suite for signed receipts/recording retries and
`EXAM_BROWSER_SSH=1 npm run test:browser` for actual WASM browser login, terminals,
capture, interruption/recovery and sandbox tests against disposable SSH fixtures.
The native agent race suite covers signed receipts and fail-closed recording in
addition to the existing deadline/collection/access tests. Fixture MFA is not a
claim of human DePaul phone approval; production checks can stop at the real
password prompt without requesting or storing a user's credential.

Upgrade the class agent before activating the web configuration. Use the
drained-attempt `ssh-server/scripts/upgrade-prebuilt` with a verified native bundle.
The old backend transport remains for development and rollback compatibility.
Rollback requires maintenance/drained attempts and the documented matched binary
and configuration restoration; never restore a stale agent state snapshot.

Initial temporary-account setup does not require a second student login. The worker creates
an ephemeral Ed25519 key, and the authenticated, signed class-agent channel issues a public
certificate scoped to the unstarted attempt. The worker rechecks the same class host pin and
uses that certificate to replace only the class connection through the retained jump client.
The root principals helper authorizes the exact grant once; root SSH start-time fencing and
all per-channel admission checks remain mandatory. The private key stays in worker memory,
is cleared on success/failure/cancellation/timeout, and is never used for exam reconnection.
Auth callbacks/configs are removed after the handshake; cleanup is best-effort runtime memory
hygiene. Retiring the bootstrap client's watcher must not report loss for its replacement.
