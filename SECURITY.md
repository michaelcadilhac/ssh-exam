# Security boundary

Server-authoritative identity, deadline, authorization and protected collection are distinct
from client-reported fullscreen, focus and images. Client evidence is not remote attestation.
Other devices, compromised browsers/OSes and trusted-root compromise are outside scope.
Incidents require review and are not automatic misconduct findings.

Production needs institutional, browser, server-guard, collection and notification signoffs,
plus agent readiness. Reports are operator attestations, not cryptographic proof. Do not
set flags to make a demo work. Privileged integration must be tested on the actual Linux,
PAM, OpenSSH and systemd installation; no such production verification is claimed here.

Both SSH hops require provisioned SHA256-hex pins. No TOFU, browser-controlled destination,
generic forwarding or password database. Each login attempt holds one shared password in
backend memory and reuses it only for these two configured, verified hosts. Password-method
authentication or narrowly recognized hidden password prompts may consume it; other hidden
prompts (OTP, passcode, menu selection) remain explicit student challenges. Phone MFA rounds,
including zero-input number matching, are preserved. Rejected passwords end the attempt;
there is no fallback retry or password retained for reconnection. Retained transports multiplex PTYs.

The attempt's password Buffer is overwritten and references discarded immediately when both
hosts authenticate (before exam admission), or on failure, cancellation, browser disconnection
during login or the 120-second whole-login timeout. Temporary Buffer copies are wiped after
ssh2 serializes them and also on cancellation. Browser input values and application answer
arrays clear immediately after transmission; backend parsed answer arrays and WebSocket
packets are cleared after use. SSH password options are never set on retained client config;
authentication handlers/listeners are detached on each hop's success and on attempt cleanup.
The ssh2 password method receives a temporary Buffer because its internal method object can
outlive authentication; that retained Buffer is zeroed after serialization.

JavaScript cleanup is **best-effort, not guaranteed erasure**. Immutable strings, JSON/parser,
React/browser internals, garbage-collected objects and SSH/TLS transport packets may leave
copies beyond application control. Mutable owned buffers/arrays are overwritten where practical;
no password is persisted, logged, recorded, placed in telemetry, URLs, environment variables
or command-line arguments. Authentication occurs before any exam capture.
The checked ssh2 patch exposes zero-prompt instructions through its existing callback without
changing its wire protocol. Challenge content stays text-only and in memory before capture.

Cookie sessions use HttpOnly, SameSite=Strict, and Secure in production. Mutations require
Origin and CSRF checks. WebSockets bind role, attempt, current in-memory page identity and
generation. Media and submissions are privately authorized; sensitive access is audited.
There are no URL tokens, terminal HTML insertion, remote runtime assets, OSC52 integration
or link-opening addons. CSP permits inline styles for WinBox positioning, no inline/eval scripts.

A root-approved UID/original-shell registry and compiled login gate precede personal profiles.
ForceCommand, PermitUserRC=no, forwarding policy and reviewed PAM/job restrictions address
alternate routes. Hashed one-use capabilities bind UID, attempt, pane, purpose and root sshd
PID/start/boot identity. The root command gate requires a pinned gateway Ed25519 signature, account/transport scope,
short expiry and a persisted one-use nonce; signed outbound HTTPS callbacks use a separate
pinned agent public key. There is no TCP control API or command polling. No arbitrary command operation is exposed to the gateway.

Work uses root-controlled systemd scopes and bubblewrap with isolated filesystems, network,
proc/dev/tmp and copied read-only shell preferences, excluding host home sockets. The watchdog,
agent and collector stay outside student cgroups. Freeze is confirmed before protected
collection. os.Root/O_NOFOLLOW, inode checks and count/size/depth limits govern traversal.
Hardlinks fail collection; symlinks/special entries are omitted with manifest records.
A protected archive is a separate private copy, not a chmod promise over live work.

Disclose issues privately to the deployment administrator. Exclude credentials and image bytes
from logs. Dependency updates require lockfiles, advisory checks, protocol/browser tests,
review of the ssh2 patch and a newly resolved Docker digest.

Automatic collection is driven by the persisted class-server deadline and independent
watchdog, including a cutoff pass that does not wait for the archive/state lock. Interactive
input is revoked immediately; SSH hangup is deferred until the frozen saved-file view is
protected. All recorded cgroup descendants freeze, UID writer containment is checked, and
new directory access is revoked through a safe descriptor. Unexpected writers or filesystem
failures retain account exclusion and never produce a successful receipt. Complete private
archive/manifest/checksum bundles publish atomically and are adopted after crash recovery,
never replaced by later live work. Gateway exports verify identity/checksum and publish
without overwriting existing artifacts. Submission retention is independent of monitoring.

Original exam interval restrictions are administrator-owned and independent of collection.
HELD remains after a successful early finish, across logout/reload/disconnect and restarts.
Ordinary access releases only after the original deadline (plus same-boot elapsed boundary)
and verified protected copy/termination. Static account shell authorization precedes student
startup; every SSH channel, including old/multiplexed transports, is gated. Approved recovery
only applies to unfinished locks and never changes the deadline. Missing initialized state
fails closed. Root-only audited emergency release requires secured work and termination and
is absent from student and gateway APIs. It never reopens an exam. Rollback cannot bypass a
hold. Cron/at, alternate PAM routes, user services/lingering and other enabled writer routes
must be denied/inventoried; machine checks supplement required disposable-host adversarial
signoff, and preflight fails without it. Restrictions are per UID and attempt; independent
administrator access must remain available.
