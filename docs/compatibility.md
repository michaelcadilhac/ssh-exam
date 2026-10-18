# Compatibility and required operator signoff

Status on 2026-10-09: **development demonstration verified; production unqualified**.
No institutional accounts or hosts were contacted. Production readiness flags ship false.
Do not set them true based on fixture tests. Each requires evidence from the intended host,
browser and network, with an operator name, date and result retained alongside configuration.

## Node 26 runtime qualification (2026-10-12)

The application now targets Node 26.x, verified with system Node 26.11.1 and npm 12.2.0
on Arch Linux. The Node types are pinned to 26.6.5 and better-sqlite3 to 12.11.1.
A clean `npm ci` installs the SQLite binary for Node's module ABI 147; reusing the old
Node 24 binary (ABI 137) fails. Argon2, sharp and ssh2 also pass runtime checks.
The existing test database passes integrity and foreign-key checks under SQLite 3.53.2.

Node 26 is currently in its [Current release phase](https://nodejs.org/en/download/archive/v26.11.1).
This runtime qualification does not grant production deployment signoff. The Dockerfile
pins the official 26.11.1-bookworm-slim image by registry-verified manifest digest;
the container build remains untested because no Docker daemon is available here.

## Microsoft Edge qualification (2026-10-18)

Genuine Microsoft Edge 155.0.4283.62 on Linux passed native fullscreen,
Keyboard Lock and display capture, plus preflight with and without a webcam.
The browser WASM SSH flow passed fixture MFA, practice/active terminal input,
multiple panes and finishing. Network/recovery and window lifecycle checks passed;
two collection-failure simulation tests initially timed out and passed on a traced
rerun. No browser API overrides were used in the native capability tests.

This used an isolated X11 display, automated permission approval, a synthetic camera
and local SSH/MFA fixtures. It does not qualify Windows/macOS, physical camera/input
behavior or actual DePaul phone approval. Browser admission remains based on
capabilities and permissions, with actual grants checked during preflight; the Edge
name does not bypass those requirements.

## Deployment qualification

| Integration | Evidence here | Required qualification |
|---|---|---|
| DePaul jump-host number matching | Disposable ssh2 host, including zero-prompt instruction round | Real authorized login, cancellation, rejection, timeout and safe instruction display; **untested** |
| Separate class authentication, pins, four channels | Real loopback SSH transports; both host-key mismatch tests pass | Actual MaxSessions, forwarding policy and retained transport behavior |
| Ubuntu/systemd/cgroup v2 guard | Native state/collector, real localhost OpenSSH route tests and machine-check contract tests | Root install on disposable target; all ordinary-access bypass, process/job quiescence, transport survival and resource-limit checks in SPEC §22.2–22.3 |
| Fullscreen and Keyboard Lock | Chromium headless fullscreen; Keyboard Lock stub | Real Chrome/Edge/Chromium version and OS; separate user gestures, Escape, focus loss, application switching, keyboard layouts and editor shortcuts |
| Screen and webcam permissions | Synthetic video tracks in browser tests | Entire-display selection rejection for tab/window, track loss, webcam override, independent cadence, clear readable images and credentials excluded during approved authentication |
| Protected cutoff and recovery | Hostile filesystem collector tests | Background writer under real frozen cgroup, disk exhaustion, daemon/host restarts, export outage and restoration only after original deadline AND secured collection |
| HTTPS, nginx, Docker and systemd | nginx syntax with temporary certificates | Real certificate/WebSocket path, Compose build/start/stop, non-root private-volume permissions and systemd startup; Docker daemon unavailable here |
| Instructor alerts | Durable outbox implementation | Actual SMTP delivery, retry/coalescing, dashboard and desktop notifications; **untested** |
| Capacity | 100 disposable students, four panes each, synthetic media | Representative duration, editors/toolchain, real root control, readable capture resolutions and deployment hardware |

Manual signoff template: requirement; OS/browser/server versions; account and host identifiers
(no secrets); exact procedure; observed result; evidence location; operator; UTC date; pass/fail.
An unsigned row is untested. There are **no signed production manual passes** in this handoff.

The supported production target is the systemd Linux/cgroup v2 environment described in
[the native installation guide](../ssh-server/README.md). Native Go code has no external
modules. Browser permission behavior is intentionally a deployment gate, not inferred from
user-agent text or headless test success. A single shared loopback network namespace for all
panes is not provided: each pane has an isolated network namespace.

This workspace records the selected display, not every physical display. It cannot establish
physical supervision, identify all external devices, or guarantee prevention of cheating.

Original-interval access qualification must include early finish followed by shell/command,
SFTP/SCP, retained ordinary/multiplexed SSH, forged variables, reload/logout, agent/gateway
restart, detached open-descriptor writers, cron/at and system timer/service writers. Prove a
verified early submission still blocks ordinary access before the original deadline, failed
collection blocks beyond it, ordinary access returns after both conditions, finished recovery
fails, approved unfinished recovery keeps its deadline, other students/admins remain usable,
and root override/rollback preserve audit and safe disposition. The localhost OpenSSH harness
runs unprivileged with a test-only ForceCommand; it does not install the static account shell,
PAM or real cgroup policy. Those require root qualification on a disposable supported host.
