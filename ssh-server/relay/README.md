# Browser SSH relay

The dedicated relay is installed at
`wss://csc-sys.cdm.depaul.edu/ssh-exam/relay`. It is **network infrastructure for
the browser SSH client**. Production enables the browser worker through
`browserSSH` configuration; marco carries authorization/status and monitoring
uploads rather than interactive terminal bytes.

The path is browser → csc-sys HTTPS/WebSocket relay → DePaul's existing
HTTP CONNECT proxy → sshjump → authenticated SSH forwarding to csc-sys. The
browser will run both SSH protocols and verify the existing configured host-key
pins. The relay carries encrypted bytes and does not accept passwords, interpret
authentication prompts, decrypt terminal traffic, or expose the agent's Unix socket.
It accepts only the fixed jump-host destination, preserving the jump-host MFA flow.

## Network configuration

csc-sys's current DNS servers disagree about `sshjump.depaul.edu`:
`10.128.22.100` returns NXDOMAIN, while `10.64.22.100` returns `10.192.202.6`.
Direct connections from csc-sys to either that address or the public jump address
time out. The existing `proxy.is.depaul.edu:3128` accepts CONNECT to `10.192.202.6:22`.
That host's Ed25519 fingerprint matches the current production pin:
`SHA256:dfHH4qjaoxDHOE1mIDtupLGWjmXQVVJUk0o75SdZUAc`.
The explicit internal address is administrator configuration, not a substitute
for browser-side SSH host-key verification. Revalidate it if institutional networking
changes. No system DNS, firewall rules, or SSH authentication settings are changed.

## Access protocol

Use the exact production Origin header. After the WebSocket upgrade, send one
text frame containing `{ "payload": "BASE64_JSON", "signature": "BASE64_ED25519" }`.
The exam webserver signs with its existing gateway key; the relay has only a copy
of the public key. The JSON payload has exactly these fields:

```json
{
  "audience": "exam-ssh-relay-class",
  "op": "relay-connect",
  "nonce": "random-single-use-nonce-at-least-16-characters",
  "issued": 1791945600000,
  "expires": 1791945630000,
  "origin": "https://ssh-exam.cadilhac.name",
  "target": "sshjump.depaul.edu:22",
  "username": "student",
  "exam": "sandbox"
}
```

Times are Unix milliseconds; tickets expire within 30 seconds of issuance.
Unknown fields, wrong scope, invalid signatures and replay are rejected before
opening an upstream connection. Durable private nonce records survive service
restart and expire independently of active SSH connections. A ticket authorizes
transport only, never account access or an exam start. Future web ticket issuance
must perform the existing enrollment/attempt/continuation checks and apply rate limits.
The backend issues tickets only inside the validated login control flow; there
is no generic public ticket-issuing or destination-selection endpoint.

The relay replies with the text frame `{"ready":true}` once the upstream is
connected. Subsequent messages are binary SSH bytes, with a 256 KiB frame limit.
Tickets go in the first frame, never in URLs, cookies or headers; nginx suppresses
access logging for this exact location. The service logs startup/configuration
status only, with no tickets, usernames, packets or SSH authentication messages.
It limits concurrent connections globally and per ticket username, requires a
ticket within five seconds, and closes upstreams when the browser disconnects.
WebSocket pings keep the existing HTTPS proxy alive. No client-specified destinations,
forwarded URLs or generic CONNECT endpoint are accepted.

## Build, test and install

Build with the project's documented Go 1.27 toolchain:

```sh
cd ssh-server/relay
go test -race ./...
python3 -m unittest install_test.py
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -o exam-ssh-relay .
sha256sum exam-ssh-relay
```

Copy the binary and this folder's configuration, installer, systemd and nginx
assets to a temporary directory on csc-sys, then run:

```sh
sudo python3 install.py ./exam-ssh-relay VERIFIED_SHA256
```

The installer validates its binary checksum, the existing root-controlled trust
key, the fixed proxy route, and the single existing HTTPS server block. It backs
up files beneath `/var/backups/ssh-exam/`, installs a hardened DynamicUser service
bound only to loopback, validates nginx, and gracefully reloads nginx. Installation
failure restores changed files and the prior relay service state. It does not restart
sshd, the exam agent, watchdog, reconciliation, or active student terminals.

Check `systemctl status exam-ssh-relay`, `curl http://127.0.0.1:9082/health/live`,
and `exam-ssh-relay -config /etc/exam-relay/config.json -probe`. Public access without
the allowed Origin/ticket must fail. A credential-free SSH handshake through a
valid ticket must match the existing host-key pin before any real authentication.

## Recovery and rollback

Disabling this relay does not alter existing account restrictions, original
deadlines, protected collections, or ordinary administrator access. Stop/disable
`exam-ssh-relay`, remove its include from the csc-sys HTTPS server, validate and
gracefully reload nginx. Restore the backed-up files if replacing an earlier relay
version. Retain private replay records until all outstanding tickets have expired;
never clear them while issuing live tickets. Do not restore any exam-agent state.

The browser worker implements selective password reuse and cleanup, phone MFA,
both host-key checks, signed agent acknowledgments to prevent client-forged
authentication/results, and authoritative class-server terminal recording.
Gateway signing keys and exam authority remain server-side. The class agent continues
local deadline collection and signed outbound status callbacks. An opaque relay alone
does not supply those application integration guarantees.
