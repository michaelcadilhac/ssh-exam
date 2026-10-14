# csc-sys browser SSH relay installation

Installed on 2026-10-13 Chicago time (2026-10-14 UTC). This document records the
initial relay preparation. The browser SSH client has since been activated;
see [the application rollout](browser-ssh-deployment.md) for the current
deployment, verification and rollback instructions.

The new endpoint is `wss://csc-sys.cdm.depaul.edu/ssh-exam/relay`, served by the
existing HTTPS certificate and nginx virtual host. The dedicated
`exam-ssh-relay.service` runs with DynamicUser and no capabilities, binds only to
`127.0.0.1:9082`, and trusts a public copy of the existing gateway signing key.
No public ticket-issuing API was enabled. Signed tickets are required before any
upstream connection, and SSH passwords/challenges are never handled by this relay.

Because csc-sys's institutional DNS servers disagree about sshjump and direct
outbound SSH connections timed out, the relay uses the existing institutional
proxy `proxy.is.depaul.edu:3128` with fixed CONNECT destination `10.192.202.6:22`.
The internally reachable jump host's Ed25519 fingerprint matches the production
pin `75f1c7e2a8daa310c7384d66203b6ea4b1968e65d0555254934a3be527595007`.
It remains the logical host `sshjump.depaul.edu`, preserving the existing MFA path.

Installed binary SHA-256:
`12f5d0cca4bb9bba93bc6b5fb78894f53be8084d11b0f90b980ba6dd98ef5a76`.
The installer backed up changed files to
`/var/backups/ssh-exam/20261014T032021Z-relay-qzkmp533`.
Configuration is `/etc/exam-relay/config.json`; the copied verification key is
`/etc/exam-relay/gateway.pub`; durable replay state is managed by systemd beneath
`/var/lib/exam-ssh-relay`. The nginx location is an include at
`/etc/nginx/snippets/exam-ssh-relay.conf` within the existing csc-sys HTTPS block.

Verification completed:

- Go race tests cover signature/scope/expiry rejection, concurrent one-use tickets,
  replay after restart, persistent-state failures, connection limits, binary byte
  preservation, upstream cleanup on browser disconnection, fixed HTTP CONNECT,
  buffered SSH greetings, and proxy refusal.
- Python tests cover nginx changes scoped to one HTTPS block, idempotence, and
  rejection of missing/ambiguous configuration.
- Configuration and credential-free upstream probe passed before installation;
  nginx validated and was gracefully reloaded.
- The relay is healthy, unprivileged and loopback-only. Existing exam-agent,
  watchdog, reconciliation timer and nginx remain active; SSH and exam services
  were not restarted and student/account state was not changed.
- A 30-second diagnostic ticket was signed on marco using the existing key
  without exporting the private key. A client connected to the public WSS URL,
  completed SSH host-key verification against the production pins, and terminated
  after the SSH no-credential authentication query. No student password, MFA
  answer, or authenticated student session was used. The temporary ticket file
  was deleted.
- Public wrong-origin and invalid-ticket connections were rejected.

Source, protocol, installation and rollback details are in
[`ssh-server/relay/README.md`](../ssh-server/relay/README.md). The checks above
qualified the relay infrastructure only; application and browser verification
are recorded separately in [the application rollout](browser-ssh-deployment.md).
