# SSH Exam Workspace
## Implementation specification for Codex

**Version:** 1.0  
**Date:** October 9, 2026  
**Deliverable:** A deployable, self-hosted application, its class-server components, tests, and installation documentation.

## 1. Instructions to the implementing agent

Build the application described here. This is an implementation specification, not a request for a design mockup. Implement the student application, instructor dashboard, SSH connection manager, monitoring, protected submission collection, class-server enforcement, and deployment assets.

The web application must run in Docker. Provide a Dockerfile, Docker Compose configuration, a host nginx configuration, and a host systemd unit. Put everything installed on the **class SSH server** in a separate `ssh-server/` subfolder, including source code, configuration examples, service files, installation tools, and its own README.

Use the settled product decisions below. Implementation details not prescribed here may be chosen pragmatically, but document substantial decisions and do not silently replace server enforcement with browser-only checks. Development mocks are useful, but must be impossible to enable accidentally in production. Do not report institutional SSH compatibility or production security tests as passed unless they have actually been run.

Verify current library interfaces when implementing, pin dependency versions and container images, and include lockfiles. Links at the end identify primary documentation; they are starting points, not a requirement to install an unpinned latest release.

### Non-negotiable requirements

- One continuous timed attempt, normally **90 minutes**. No student-controlled pause or resume.
- Chrome/Chromium desktop browser, with successful capability and permission checks.
- One fullscreen browser workspace containing **floating terminal windows**, not browser popups or tabs.
- No tmux. Each terminal uses a separate SSH session channel on one retained connection to the class server.
- One initial two-hop SSH authentication sequence, including jump-host two-factor authentication. Creating terminals must not authenticate again.
- Screen snapshots approximately every five seconds. Webcam snapshots approximately every five seconds when required by the student's effective exam settings. No audio capture.
- An application-local clipboard only; no ordinary system-clipboard paste into the active exam workspace.
- Instructor-controlled recovery from policy interruptions, with the original deadline unchanged.
- Automatic, protected collection of the student's saved working directory on finish or expiration.
- Ordinary access to the class account must not provide an alternate way to work from exam start until the original deadline and secured collection, including after an early finish.
- Bulk username enrollment, including CSV import with a per-student webcam requirement.
- Monitoring-record deletion after 60 days, or earlier manually. Submission archives have a separate retention policy.

## 2. Product context and defaults

The instructor administers a programming exam on a Unix/Linux class server. Questions, tools, documentation, student files, and submission collection are server-side. The instructor has root access on that server. Students use their personal computers at home or supervised computers in person.

The known ordinary connection is:

```sh
ssh -J USERNAME@sshjump.depaul.edu USERNAME@csc-sys.cdm.depaul.edu
```

The user reports the following authentication flow: the jump host requests a password and displays a two-digit number to enter in an authentication app; after approval, the class server requests a password again, without a second two-factor challenge. Treat this as the required flow to support, not as a flow already tested by this project.

| Setting | Default or requirement |
|---|---|
| Jump host | `sshjump.depaul.edu`, port 22; configurable |
| Class host | `csc-sys.cdm.depaul.edu`, port 22; configurable |
| Username | Same on both hosts; taken from the enrolled username, not arbitrary connection parameters |
| Exam duration | 5,400 seconds; instructor may assign a duration override before an attempt |
| Availability | Configurable earliest start and latest start; potentially several days |
| Deadline | Start timestamp plus the effective duration; closing the start window does not shorten an already started attempt |
| Terminal limit | Four student terminal windows, configurable within the tested SSH/session limit |
| Screen capture | Required for every webapp attempt, including in-person attempts |
| Webcam capture | Exam default plus per-student override; optional when the effective requirement is false |
| Capture interval | 5 seconds for each required image stream |
| Heartbeat interval | 2 seconds |
| Limited network recovery | At most 15 seconds, subject to the conditions in Section 7 |
| Recording retention | 60 days after the attempt ends; earlier manual deletion supported |
| Submission retention | Separate control; no automatic deletion until explicitly configured |
| Instructor time display | `America/Chicago`; persist absolute timestamps in UTC |
| Student reference materials | Physical documents and documents available through the SSH terminals only |
| Notifications | Dashboard, opt-in desktop notification and sound, and configurable SMTP email |

Do not add a PDF viewer, general-purpose browser, note-upload system, automated grading, facial recognition, gaze scoring, AI misconduct scoring, or audio recording. Individual duration and webcam accommodations must not be visible to other students.

## 3. Security boundary and honest claims

This is a **monitored exam workspace**, not a tamper-proof browser or operating-system lockdown. A student controls the computer running the browser. Browser-generated focus reports and images are evidence supplied by that client, not remote attestation. The system cannot exclude another device, prove that all monitors are captured, or guarantee that an image source is a physical camera.

The browser must not claim to disable the student's internet connection. The class-server environment, however, must have its own externally enforced restrictions against using the server as an internet client or an alternate route to the exam files.

Chrome's Keyboard Lock API can improve terminal keyboard behavior, but cannot capture every operating-system-reserved shortcut or eliminate the browser's deliberate fullscreen escape route. Test actual keyboard behavior rather than relying on the browser name. [R1]

A focus or capture incident is not an automatic finding of misconduct. Record it and apply the access policy; the instructor interprets it.

Distinguish these guarantees in documentation:

1. **Server-enforced:** attempt identity, deadline, authorization, terminal access, protected collection, and class-server restrictions within the supported installation.
2. **Client-monitored:** fullscreen, focus, visibility, local clipboard behavior, and the image streams the browser supplies.
3. **Outside scope:** other devices, unobservable assistance, browser/OS compromise, or root compromise of a trusted server.

## 4. Architecture

```text
Student Chrome/Chromium
  ├─ Fullscreen workspace and floating xterm.js terminals
  ├─ Screen + optional webcam capture
  └─ HTTPS / authenticated WebSocket
                     │
Host nginx: TLS termination and reverse proxy
                     │
Docker: web application
  ├─ Student and instructor HTTP APIs
  ├─ Authentication and persistent attempt state
  ├─ Per-student SSH connection manager
  ├─ Monitoring ingestion, recordings, notifications
  ├─ SQLite metadata + private persistent file storage
  └─ Gateway-signed commands over authenticated student SSH channels
                     │
           Retained SSH connection to jump host
           Password + number-matching 2FA, once
                     │
           Forwarded TCP stream to class server
                     │
           Retained SSH connection to class server
           Shared password reused for pinned class server
             ├─ SSH session channel → terminal 1
             ├─ SSH session channel → terminal 2
             └─ SSH session channel → terminal 3, etc.

Class server: native, administrator-installed components
  ├─ Controlled session entry point and access guard
  ├─ Privileged, narrowly scoped exam agent
  ├─ Attempt process containment and local deadline enforcement
  ├─ Per-attempt working directory and read-only exam materials
  └─ Protected local submission archive + signed outbound status/archive callbacks
```

SSH supports multiple channels within one authenticated connection. Channel creation, pseudo-terminal allocation, resizing, and shell startup do not require new user authentication. The jump-host transport carries the class-server transport; retain both. [R2]

Use one backend application instance initially. It owns live SSH connections in memory. Persist all authoritative attempt metadata; never pretend that SSH connection objects survive process restart. Do not use a stateless/serverless deployment or multiple independent workers that compete for the same attempt. Future scaling is out of scope unless ownership and routing are explicitly implemented.

The class agent exposes **no TCP control listener**, independent control tunnel, or command queue to poll. The gateway sends bounded Ed25519-signed commands on non-PTY `exam-control` channels of the authenticated student SSH connection. The compiled account gate runs before student startup files and forwards each frame to the local root Unix socket. Root verifies the signature against its administrator-installed gateway public key, configured agent audience, account, short expiry, durable one-use nonce, kernel peer UID, and root sshd transport ancestry. Mutable attempt operations additionally require ownership and the currently registered transport. The gateway never receives root SSH credentials or retains student passwords for commands.

The agent persists the original start/deadline and access hold, and its independent local watchdog cuts off writers and collects work without any browser, gateway, or network. Agent-originated HTTPS POST callbacks report configuration/account registry on agent startup and subsequent attempt status changes, manifests, errors and access releases. Callbacks use a separate pinned Ed25519 agent identity; they never carry commands in responses. Events have durable sequence IDs, immutable payloads, replay/conflict checks and retries after outages/restarts. There is no idle command polling or heartbeat request. Lease renewals still travel through live student SSH.

After local protection, the agent also pushes the verified archive to the authenticated webserver callback endpoint for instructor downloads. Archive signatures bind agent, attempt and checksum; the webserver checks the receipt and complete-byte checksum before durable publication. Transfer retries read only the existing protected copy. The class-server original remains authoritative and has separate retention. The web dashboard can delete its download copy; deletion of the class-server original is a local root `examctl` operation.

## 5. Candidate libraries and implementation baseline

Prefer these components, subject to current API and compatibility verification. Do not build a terminal emulator, SSH implementation, CSV parser, or cryptographic protocol from scratch.

| Area | Candidate / baseline | Use |
|---|---|---|
| Frontend | TypeScript, React, Vite | Student workspace and instructor dashboard |
| Terminal | `@xterm/xterm`, `@xterm/addon-fit` | Rendering, selection, terminal geometry; no link-opening or system-clipboard addon [R3] |
| Floating windows | `winbox` / WinBox.js | Moving, resizing, maximizing, restoring, minimizing; customize controls and taskbar [R4] |
| Backend | Node.js 26.x, TypeScript, Fastify | HTTP APIs, validation, authentication, static frontend serving [R5] |
| WebSockets | `ws`, directly or via the supported Fastify integration | Terminal and control transport; validate every message |
| SSH | `ssh2` | Keyboard-interactive authentication, connection hopping, retained shell channels [R6] |
| Validation | Zod or Fastify JSON Schema | Explicit request/response and configuration schemas |
| Database | SQLite through `better-sqlite3` | Transactions, migrations, WAL on local persistent storage [R7] |
| CSV | `csv-parse`, `csv-stringify` | Streaming import, proper quoting, export, BOM handling [R8] |
| SMTP | Nodemailer | Backend email alerts with persistent retry/outbox logic [R9] |
| Admin password hashing | Maintained Argon2id implementation | Local administrator credentials; no default password |
| Class-server agent and launcher | Go, with standard libraries and narrowly scoped Linux bindings where needed | Compiled SSH gate, signed commands/callbacks, privileged supervision, safe collection |
| Unit/integration tests | Vitest or equivalent; Go tests for server components | State, protocol, imports, collection, failure recovery |
| Browser tests | Playwright plus a documented real-browser/manual suite | Workspace behavior and browser integration [R10] |

Self-host all runtime assets. Do not load scripts, fonts, telemetry, or window/terminal libraries from public CDNs. Keep browser terminal output separate from trusted DOM content; review xterm.js's security guidance. [R11]

WinBox's own fullscreen control must be disabled. Its maximize/restore controls are acceptable; the entire exam workspace, not an individual terminal, owns browser fullscreen. If adapting WinBox to the framework proves awkward, a small adapter around its DOM API is preferable to adding an unmaintained framework wrapper.

## 6. Student journey and authentication

### 6.1 Before an attempt

A student opens the exam URL, selects or enters the enrolled username, and sees the permitted start window, effective duration, webcam requirement, monitoring notice, and exam rules. Do not expose another student's enrollment or settings.

Authenticate the student through the two-hop SSH flow. A typed username is not authentication. Confirm successful class-server authentication before granting the student an authenticated application session. There is no second student password database and no app-only login that substitutes for SSH authentication.

Authentication UI requirements:

- Display which host is authenticating, using configured trusted names.
- Support password authentication and multi-round keyboard-interactive authentication.
- Render server banners, prompt text, and keyboard-interactive instructions as **plain text**.
- Preserve the two-digit number-matching instruction prominently, including rounds with no input fields.
- Honor each prompt's echo flag. Never assume that the second factor is a six-digit OTP.
- When the protocol asks for zero responses, display its instruction and complete that protocol round correctly; do not invent a user input prompt.
- Handle approval delays, denial, timeout, cancellation, and repeated challenge rounds without retry storms.
- Collect the shared SSH password once per login sequence. Explain temporary backend-memory reuse only for the configured, host-key-verified jump and class hosts; preserve phone MFA and handle other prompts explicitly. Clear credentials after both hosts authenticate or upon failure, cancellation, browser disconnection during login or timeout. Never retain credentials for reconnection or retry rejected passwords.
- Apply bounded attempts and rate limits, with understandable error messages.

Keyboard-interactive authentication is a multi-round protocol with instructions and an array of prompts; `ssh2` exposes the relevant callback interface. [R6], [R12]

Validate **both** SSH host keys against administrator-provisioned pins/known-host data. An unknown or changed key blocks connection and generates an administrative diagnostic. No automatic acceptance or trust-on-first-use for students. Do not turn on legacy cryptography automatically when a connection fails.

Passwords, challenge answers, and authentication instructions must not enter screenshots, terminal recordings, request logs, tracing, database rows, disk queues, URLs, or error reports. Complete SSH authentication before beginning capture. Hold necessary credentials only for the authentication operation, clear references afterward, and never keep them to authenticate newly opened terminals. Document the limits of guaranteed memory erasure in managed runtimes.

### 6.2 Preflight, before questions or timing

After authentication, perform preflight without exposing exam material:

1. Check browser capabilities and the institutional SSH path, including enough session capacity.
2. Show the recording notice and verify a successful test image from every required stream.
3. Require an entire-display share, not a tab or application-window share.
4. Show camera framing preview when the webcam is required.
5. Provide a disposable terminal exercise with the actual editor/toolchain and important shortcuts, but no exam questions or hidden starter files.
6. Request fullscreen and Keyboard Lock through appropriate user gestures. Handle permission dialogs before arming exam interruption detection.
7. Verify root-agent readiness, storage capacity, roster membership, account restrictions, and availability.
8. Clearly warn that starting will end conflicting ordinary class-server sessions/processes and that unsaved work elsewhere on that server must be saved first.

Use separate buttons where browser user-activation requirements demand them; do not assume a long asynchronous setup chain retains activation. Do not request microphone access.

Preflight can be retried without consuming the attempt. Test images should remain ephemeral and be deleted when preflight is abandoned; if an initial image is retained with the attempt, disclose that and apply the monitoring retention policy. A disconnected preflight expires and closes its retained SSH transports after a configurable idle timeout, default ten minutes. Before activation, retry interrupted browser connections with bounded backoff; the active-exam 15-second recovery limit must not strand preflight. Only report connected after an acknowledged session bind. If SSH transports are lost, including after a gateway restart, report an authentication gap, stop capture and keyboard lock, and offer fresh SSH sign-in without instructor authorization. Explain that the exam has not started and no exam time has elapsed. Recheck preflight after fresh authentication; never retain credentials to reconnect. Active attempts retain their existing pause, authorization and original-deadline policy. Preflight terminals must have a distinct, narrowly authorized practice purpose and no access to exam templates or workspaces. Close their shell channels before activation while retaining the two authenticated SSH transports.

### 6.3 Begin exam

Use a deliberate **Begin exam** action. Before committing:

- The browser reports fullscreen, focus, visibility, Keyboard Lock readiness, and healthy required capture streams.
- Both SSH transports are authenticated and connected.
- The backend has accepted current test/initial frames.
- The class agent has prepared the workspace, admission controls, and process containment without revealing questions.
- The student has no other active attempt on this class account.

Beginning is an idempotent, durable operation involving the backend and class agent. The class agent commits the canonical start timestamp and deadline immediately before releasing exam material. The backend stores those returned values; it does not start an unrelated second timer.

Persist an operation/attempt identifier before making the remote activation request. After a timeout or lost response, query that operation instead of creating another attempt. A server-committed start remains started even if the browser never receives the acknowledgment. In that case, recover to a locked attempt with the original deadline, not to a fresh preflight.

Open the first terminal as a floating window. Show a trusted welcome message identifying the exam and the exact directory that will be collected. Starter-file initialization must happen once, never on every terminal login.

## 7. Attempt state, deadline, and interruptions

### 7.1 Persistent state machine

Implement explicit, transactionally checked states:

| State | Meaning |
|---|---|
| `PREPARING` | Resources reserved; no questions released and no timer committed |
| `ACTIVATING` (class server) | Original deadline/access hold committed; initialization has not yet completed; no workload admission or continuation |
| `ACTIVE` | Timer committed; authorized terminal interaction permitted |
| `LOCKED` | Instructor review required; all terminal interaction disabled; clock continues |
| `FINALIZING` | Access revoked; saved work being protected and packaged |
| `COMPLETED` | Protected submission exists; reason records student finish, expiration, or local administrator termination |
| `COLLECTION_FAILED` | Attempt ended, but protected collection requires recovery; never present this as successful submission |
| `CANCELLED_BEFORE_START` | Preparation failed or was abandoned before activation |

Connectivity is a separate attribute; a short connection grace is not a new attempt and never changes the deadline. A completed attempt cannot be reopened by a resume operation. Default to one attempt per enrollment. Any deliberately authorized replacement attempt is a new, audited record, not a reset or overwrite of the first.

Account-access restriction is a separate, administrator-controlled state: `HELD`, `RELEASED`, or `OVERRIDDEN`; the gateway may display `UNKNOWN` until it has inspected the class server. Persist `access_held_at`, `access_released_at`, override reason, and the immutable original deadline beside the attempt. `COMPLETED + HELD` is normal after an early finish. For example, an attempt begun at 10:00 with a deadline of 11:30 and finished at 10:40 is collected immediately, cannot reopen, and still blocks ordinary access until at least 11:30. Completion, browser logout, classroom departure, reload, disconnection, and either service restarting do not release that hold.

Release ordinary access only after BOTH the original deadline has elapsed and the protected archive/manifest/checksum are verified with workload termination confirmed. Use the same-boot monotonic guard as an additional release boundary to prevent a forward wall-clock adjustment from releasing early. Collection failure has no automatic unlock. Local export failure alone does not prevent eventual release once the original deadline and verified class-server protection requirements are met. Once released, later authorized retention deletion does not recreate the exam interval. Finished attempts remain closed even after ordinary access is released.

Enforce one reserved or access-held attempt per class-server UID, including across different exams. Use database constraints or an equivalent transactional guard in both the application and the server agent.

### 7.2 Timer semantics

The student sees remaining time and warnings at ten, five, and one minute. The clock is always visible and is based on the canonical server deadline, not a decrementing browser counter.

Locks, page reloads, lost network access, reauthentication, and instructor review **never pause or extend the clock**. Do not provide an ordinary extension button. Accommodated durations are set before starting and snapshotted into the attempt.

The class agent enforces expiration locally even if the browser, application, reverse proxy, SMTP, or callback network is unavailable. Use a persisted absolute deadline plus a monotonic elapsed-time guard during a boot; do not let a backward wall-clock adjustment grant extra time. Reconcile unfinished attempts on service and machine restart before reopening access.

### 7.3 Events requiring a lock

During an active attempt, any of these causes local blocking immediately when observed and a server lock as soon as the signal arrives:

- The workspace exits browser fullscreen.
- The browser window loses focus or the document becomes hidden.
- The required screen-share track ends, the shared surface changes to an unacceptable type, or screen-capture permission is lost.
- A required webcam track ends or sustained capture failure prevents new frames.
- Required images/status reports are absent beyond the permitted liveness threshold.
- The page is reloaded, replaced, or closed.
- Either SSH transport is lost.
- A second authenticated page/device for the same student tries to take over the attempt. An anonymous request or another student guessing a username must not be able to lock the attempt.

Do not lock because one terminal element loses focus to another, a window is moved/resized, an internal confirmation opens, or the student uses the application toolbar.

On a lock:

- Cover all terminal content and disable every input path, including queued input, paste, new-window requests, and hidden/minimized terminals.
- Revoke forwarding of terminal input and output at the gateway, not merely in the UI.
- Request a class-agent lock; freeze and terminate all recorded terminal workload cgroups. Automatically close both student SSH transports and invalidate the old transport for continuation. Saved files survive; unsaved editor buffers do not.
- Keep the independent local deadline/watchdog running. The student SSH transports are disconnected; no independent control transport exists.
- Stop screen/webcam capture for the required fresh authentication gap; restart it only after the replacement SSH transport and page have been attached. Record the gap.
- Record the trigger, timestamps, state, and capture availability. Request an incident image where possible, without claiming it depicts the newly focused app.
- Group correlated events into one incident while retaining their individual event records.

The class agent should use a short renewable execution lease in addition to the fixed deadline. Renew it only when the gateway is itself receiving timely client status and required uploads. If the lease expires, lock locally, terminate the recorded workloads and require a fresh SSH transport; a live gateway process must not keep renewing a stale student's lease indefinitely. A recovered lease alone must not unlock an instructor-review lock.

### 7.4 Limited automatic network recovery

Allow an active exam to resume automatically after WebSocket/network recovery for **at most 15 seconds**, measured from the last acknowledged healthy contact, only when all of these hold:

- The original page and its in-memory instance identity remain alive.
- The same authenticated SSH transports remain alive.
- There is no intervening fullscreen/focus/visibility/capture violation.
- Required capture continues into a bounded memory queue.
- The server still permits the limited recovery and no explicit lock has occurred.
- The deadline has not expired.

Show a reconnecting overlay, disable typing, and discard unsent terminal input rather than replaying keystrokes after recovery. Do not buffer an exam's worth of interaction offline. On successful recovery, upload queued monitoring frames with their original client sequence/timestamps and separate server receipt times.

The page-instance secret must not be stored in localStorage, sessionStorage, URLs, or persistent browser storage. A reload must not qualify as the same still-open page. This is a useful application rule, not anti-tampering attestation.

A connection failure beyond the grace, page reload/closure, SSH loss, or explicit policy violation during an active exam requires instructor authorization. There is no user-controlled reconnect-to-resume loophole. The browser may continue retrying its control connection with bounded backoff after the grace to receive the locked state and recovery controls; reconnecting that channel never unlocks an exam or restores terminal input. Preflight recovery before activation follows Section 5 and consumes no exam time.

### 7.5 Instructor-authorized continuation

The locked page shows the reason, remaining time, and **Request instructor review**, with a short message. Rate-limit duplicate requests. Restoring focus alone does not resume access.

The instructor chooses **Authorize resume** in the authenticated dashboard. The dashboard has no stop/end action. Early administrator termination requires SSH administrator access to the class server and `examctl stop ATTEMPT --reason ...`; never kill the shared agent or deadline watchdog to stop one attempt. Authorization is stored at the gateway until fresh student SSH authentication. A signed registration command carries that single grant to the root agent, followed by transport attachment and consumption only after browser preflight is restored. Authorization is bound to the current incident/attempt generation, single-use, expires after five minutes or the deadline, and is auditable. Stale authorizations cannot override newer incidents.

One authorization covers fresh SSH authentication, transport/page replacement and continuation. After authorization, the student signs in again as the same identity, restores required capture/fullscreen/keyboard conditions and explicitly clicks **Continue exam**. Verify a current frame from every required source and current server state before new terminal access. The old deadline remains unchanged.

Every pause requires a new SSH login; there is no separate reauthentication approval and no same-transport continuation. Stop capture before displaying credentials and record the gap. The native agent rejects old SSH transport identities and consuming a continuation before a new transport attaches. End old shells on pause; saved files and the original deadline survive, while unsaved editor buffers are lost.

## 8. Floating-terminal workspace

Everything remains inside one browser page and its fullscreen root. No popups, new browser windows, iframes to arbitrary sites, or separate browser tabs.

Required controls:

- New terminal; move by title bar; resize by edges/corners.
- Maximize and restore; minimize to an internal taskbar.
- Bring to front and switch terminals by clicking or an accessible in-app control.
- Snap left, snap right, place two selected terminals side by side, and an optional arrange-all grid.
- Rename a window, for example `Questions`, `Editor`, or `Testing`.
- Reset layout so no window can remain lost offscreen.
- Close a terminal after an in-page confirmation. Closing a terminal is not finishing the exam.

Use familiar labels rather than requiring knowledge of tiling window managers. The first terminal starts as a floating window; creating another should produce a visible, usable window without hiding the timer or making the original window inaccessible. Constrain windows to the workspace. Provide minimum usable dimensions and adjustable terminal font size.

A toolbar outside the window manager's stacking area shows the clock, connection/capture status, terminal actions, and Finish exam when the attempt is active and SSH is available. A lock overlay must cover even maximized windows and cannot be dismissed through z-index manipulation by the application's own controls.

Layout actions preserve the xterm instance, SSH channel, working directory, and running process. A minimized terminal remains connected and its output is recorded. Bound scrollback and stream buffers to prevent unlimited memory growth.

When the container size changes, fit xterm, measure columns/rows, then send the SSH pseudo-terminal size change. Ignore zero-sized/minimized geometry, coalesce resize events, and refit on restore. Do not recreate a shell to resize it. [R2], [R3]

Supply pointer-accessible controls and usable keyboard navigation. Do not redefine ordinary terminal `Ctrl-C`, `Ctrl-D`, `Ctrl-Z`, Tab, or Escape as window-manager operations. Teach students that operating-system Alt-Tab/Command-Tab leaves the application and is not the way to switch these internal windows.

## 9. Fullscreen, keyboard handling, and internal clipboard

### 9.1 Fullscreen and keyboard handling

Request fullscreen on the root containing the toolbar, taskbar, windows, dialogs, and webcam/status widgets. Maximizing a terminal must never call the browser Fullscreen API.

Monitor `fullscreenchange`, top-level window focus/blur, and document visibility. Arm interruption detection only after the explicit start/continue handshake, not during setup permission dialogs. Do not create a general-purpose grace period that allows leaving the exam after it is active.

Feature-detect and request Keyboard Lock, including Escape. Test short Escape for terminal editors, the browser's deliberate escape gesture, control/meta combinations, non-US layouts, Dvorak, compose input, and input methods where applicable. Permission refusal or missing essential capabilities blocks starting with a clear diagnostic. Do not request Pointer Lock: students need a normal mouse pointer. [R1]

### 9.2 Application-local clipboard

Implement an in-memory, attempt-local text clipboard shared by the terminal windows:

- Right-click a terminal (or use Shift+F10/the menu key) for **Copy**, **Paste**, **Zoom in**, **Zoom out**, and **Reset zoom**. Any nonempty terminal selection automatically copies to this internal buffer; clearing the selection preserves the last copied text. Copy explicitly refreshes it. Ctrl+Shift+V pastes into the focused terminal through the terminal library, preventing native OS paste; locked/covered/disconnected terminals cannot copy or paste.
- **Paste** sends that buffer to the clicked terminal using the terminal library's paste facility so bracketed paste behavior is respected. Disable Copy without selection and Paste with an empty clipboard or blocked input.
- Keep clipboard/zoom actions in the context menu; the top bar contains a Terminals switcher instead of duplicate clipboard buttons or a text-size slider. Zoom is per pane and Reset zoom restores 15px. Fit and send updated SSH terminal dimensions after zoom. Clamp menus to the viewport, support arrow keys, dismiss on Escape/outside click, restore terminal focus, and close on exam lock, dialogs or completion. Optional shortcuts must not conflict with shell control keys.
- Block ordinary system paste routes into the active student interface, including context-menu paste, standard paste shortcuts, middle-click paste, drag/drop, and browser textarea fallback routes.
- Intercept copy behavior so it does not intentionally write exam text to the system clipboard. Do not read or overwrite the user's existing OS clipboard.
- Do not enable OSC 52 clipboard integration or other terminal control sequences that read/write the system clipboard.
- Do not enable auto-link opening, arbitrary URL handlers, terminal-triggered downloads, or file-transfer escape protocols.
- Clear the internal clipboard at attempt end; do not persist it through a reload. It need not be destroyed during a temporary lock, but may not be pasted while locked.

Clipboard restrictions apply to the active exam workspace. Do not unnecessarily disable password-manager paste in authentication forms or the instructor's CSV upload/paste controls. Keep these code paths separate. This is a best-effort browser interaction restriction, not a claim that a malicious client cannot inject text.

## 10. Screen, webcam, and terminal recording

### 10.1 Capture setup and timing

Use `getDisplayMedia({video: ..., audio: false})` for screen capture and `getUserMedia({video: ..., audio: false})` for the camera. The browser requires permission; screen sharing is chosen by the user. Inspect the selected track's settings and accept only an entire-display/`monitor` surface. Hints may improve the chooser, but do not assume they force a particular selection. [R13], [R14]

Where supported, exclude browser-tab sharing and surface switching, but validate the actual resulting stream. Ask the student to select the display containing the exam and to disconnect/avoid extra monitors as a stated exam rule. The application cannot prove there are no other displays. Do not silently crop away parts of the selected display.

Sample each required stream approximately every five seconds using video-to-canvas encoding, with independent queues. Request an extra image on incidents where possible. Capture actual media frames, not a DOM screenshot of the terminal page.

Default encoding: JPEG, configurable quality; full selected-display aspect ratio, up to 2,560 pixels on the long edge, with a readability check at preflight; webcam approximately 640 × 480 or a nearby supported size. Treat these as defaults to tune, not guarantees of fixed image size. Never stretch or silently substitute a black frame. Preview verifies screen-text readability and camera framing.

Timers are not exact. Track scheduling delays and missed intervals. Do not infer a dead capture merely because consecutive image hashes match: a legitimate display or webcam view may remain still. Use stream/track state and successful frame acquisition, while acknowledging the limitations of client evidence.

An explicitly ended required track locks immediately. For a sustained muted/stalled stream or missing uploads, use a bounded grace no longer than the 15-second liveness window; record gaps and do not let a heartbeat alone conceal them. A webcam that is merely dark or does not show a face is for instructor review, not automatic facial analysis.

### 10.2 Upload and storage

Frames must be uploaded over authenticated HTTPS with:

- Attempt ID and source (`screen` or `webcam`).
- Page-instance and per-source sequence number.
- Claimed client capture timestamp and monotonic offset.
- Server receipt timestamp, dimensions, encoding, and server-computed checksum.

The backend must validate ownership, state, size, encoding, and image dimensions; bound decoded image sizes and request concurrency. Use opaque storage IDs, not user-supplied paths. Make uploads idempotent by attempt/source/sequence; conflicting duplicates are rejected and logged. Mark delayed or missing frames honestly.

Use bounded memory buffering for the permitted network grace, not persistent browser storage. A sensible default is six frames per source, with a byte cap and explicit overflow handling. Current uploads should not be starved indefinitely by a backlog. Do not extend the grace by cycling queues or retrying forever.

Store files atomically on private persistent storage outside the public web root. Create thumbnails asynchronously for instructor review. Apply access authorization to originals, thumbnails, and exports. No public media URLs, unguarded nginx aliases, or access tokens in query strings.

Capture continues while locked when possible, and stops at end/expiration. Accept previously captured queued frames only during a bounded upload-drain period, default 30 seconds; label late receipt accurately and do not collect new post-exam images. Client timestamps are claims, not proof of pre-deadline acquisition.

### 10.3 Terminal recordings

Record each terminal's output bytes, resize events, lifecycle events, and monotonic timing on the gateway. Record decoded display output faithfully, including escape sequences in a replay-safe format. Also keep raw bytes where necessary for faithful reconstruction with explicit size limits.

Do not store raw keystrokes or authentication input. Echoed commands naturally appear in terminal output; password prompts without echo must not become keylogs. Recordings start only when the trusted setup hands off to the exam shell, not during SSH authentication or secret channel admission.

Provide instructor replay with terminal selection and timestamp navigation, synchronized to incident and image timestamps. Treat output as untrusted: render through a hardened terminal component, never inject it as HTML or execute URLs/escape-sequence side effects.

### 10.4 Retention

Delete screen images, webcam images, thumbnails, terminal recordings, and associated detailed monitoring payloads **60 days after the attempt ends**. Run an idempotent cleanup job at least daily and catch up after downtime. Permit earlier instructor deletion with confirmation and an audit record.

Deletion must cover originals, derived assets, exports cached by the application, and any duplicate application-managed copies. Document backup expiry and deletion tombstones so restoring a backup does not silently resurrect expired recordings. Do not promise physical secure erasure from arbitrary backup media or SSDs.

Keep submission archives and minimal grading/attempt metadata under their separate retention controls. Make this distinction explicit in the dashboard and privacy notice. Monitoring cleanup must not delete a submission by accident. Manual submission deletion is a separately labeled destructive operation.

## 11. Instructor dashboard, alerts, and recovery

Provide a separate authenticated instructor interface. Bootstrap the initial administrator through a CLI command that prompts securely for a password; do not ship default credentials. Store only a suitable password hash. Use distinct authorization rules for student and administrator endpoints.

### 11.1 Exam management

The instructor can create and configure exams, start windows, durations, usernames, webcam defaults/overrides, allowed terminal count, working/materials template identifiers, and notification destinations. Keep hostnames, service credentials, root-agent trust, and executable paths in administrator-controlled deployment/server configuration rather than student or arbitrary CSV fields.

Before a timed attempt starts, snapshot its effective settings. Changing an exam, roster, default webcam flag, or duration must not silently change an active attempt. Show which changes apply only to future attempts. An active webcam requirement cannot be disabled through an ordinary roster edit or import.

### 11.2 Live view

Show searchable, paginated roster/attempt rows with:

- Username, optional display name, and effective webcam requirement.
- Not started / active / reconnecting / locked / finalizing / completed / collection problem.
- Start time, immutable deadline, remaining time, and terminal count.
- Last screen image, last required webcam image, and the ages of both.
- Last heartbeat and current incidents.
- Protected-submission and export status.

Provide filters for at-home/webcam-required, in-person/webcam-not-required, active, attention needed, and completed. A dashboard connection dropping must produce a clear stale-data indicator, not a deceptively live display.

### 11.3 Notifications

Implement all three channels:

1. **Dashboard:** immediate incident badge, activity feed, and optional attention sound.
2. **Desktop notification:** requested through an instructor **Enable alerts** action. Show permission status and a test action. Do not claim it works with the dashboard closed; persistent web push is not required. Browser notifications require permission. [R15]
3. **SMTP email:** backend-generated independently of dashboard presence, with configured recipients, retry policy, and delivery/failure status. Use a durable outbox so a process restart does not lose alerts.

Send interruption alerts with username, exam, reason, time remaining at generation, and a link to the incident requiring normal administrator authentication. Never embed screenshots, passwords, one-use continuation credentials, or a link that performs an action on GET.

Coalesce correlated triggers into one incident. Send a follow-up when the student requests review, without allowing message flooding. Also alert on collection failure, recording-storage failure, class-agent loss, and submission-export failure. During widespread outages, group email summaries while retaining individual incident records.

SMTP configuration may be unavailable during development, but production readiness must prominently warn until notifications are configured and tested. Email does not guarantee an immediate instructor response. Student instructions must say the clock continues while review is pending.

### 11.4 Incident and submission review

An incident page shows its timeline, student message, current conditions, latest images with timestamps/gap indicators, and terminal replay around the event. Buttons implement the continuation protocol in Section 7, with confirmation for ending an attempt.

Support a private, authenticated submission download for each student and a bulk download for an exam. Show archive checksum, collection reason, source path label, protected-copy status, and any omitted/error entries. Never execute, render as active HTML, or unpack submitted programs in the application container for grading.

Every privileged change, continuation authorization, access to sensitive recordings, deletion, and submission download should be auditable. Do not write image bytes or credentials into the audit log.

## 12. Bulk roster import and per-student webcam settings

This is a required first-class dashboard feature, not a developer-only command.

### 12.1 Accepted input

Provide CSV upload and a large paste box. The paste box may accept CSV or an explicitly selected **one username per line** mode. Supply downloadable templates and export of the current roster.

The minimum CSV schema is:

```csv
username,require_webcam
student01,true
student02,false
student03,true
```

Also support these optional columns:

```csv
username,require_webcam,display_name,duration_minutes
student01,true,"Student One",90
student02,false,"Student Two",90
student03,,"Student Three",135
```

`require_webcam` is an explicit per-enrollment override:

| Value | Meaning |
|---|---|
| `true`, `yes`, `1` | Require webcam |
| `false`, `no`, `0` | Do not require webcam |
| Empty cell or `inherit` | Use the exam default |

Parse booleans case-insensitively, after trimming. Reject all other nonempty values. Do not interpret the string `false` as truthy. Internally store this as nullable boolean, distinct from the resolved effective boolean. The dashboard must show both the override and its effective result.

A missing optional column means **leave that field unchanged on an existing enrollment**, or inherit/default it for a new enrollment. An explicitly present empty `require_webcam` cell means clear that override and inherit. Apply the analogous, documented rule to an empty duration override. Blank display names clear an existing optional display name only when that column is explicitly present.

`duration_minutes`, when supplied, is a positive integer within configured administrative bounds; default is 90 minutes or the exam duration. Do not accept executable expressions or infer numbers with locale-dependent parsing.

### 12.2 Import behavior

Use an established CSV parser with UTF-8/BOM handling, quoted commas/newlines, CRLF/LF, explicit headers, and bounded record sizes. Do not implement CSV with `split(',')`. [R8]

Support at least 10,000 enrollment rows within a configurable 10 MiB upload limit, using streaming parsing and pagination/virtualization where needed. These are input limits, not a claim that the host can run 10,000 simultaneous exams.

The workflow is **Upload/paste → Validate → Preview → Confirm import → Result**:

- Preview added, changed, unchanged, duplicate, and invalid rows with original row numbers.
- Resolve account names against the class-server account registry/agent. Importing a roster must not create Unix accounts.
- Reject root, privileged/service identities, disallowed course identities, invalid usernames, NULs, path separators, and unsupported account mappings.
- Preserve actual account case/canonical identity; do not blindly lowercase usernames. Bind enrollment to the verified server identity/UID.
- Identical duplicate rows may collapse with a warning; conflicting duplicates are errors, never last-row-wins silently.
- Reject duplicate headers. Report unknown columns for correction or explicit mapping instead of quietly ignoring misspellings.
- Default to an all-or-nothing validated import. Errors block confirmation until corrected; provide an error report for download.
- Default action is **add/update**, not replace. Do not delete enrollments absent from a new CSV.
- Show a change summary, including how many students will require webcams, and require explicit confirmation.
- Make confirmed imports transactional and idempotent. Record administrator, time, file checksum, and counts, without retaining the raw uploaded file indefinitely.
- Refuse to change the effective settings of active attempts; flag those rows and explain that any permitted roster changes apply only to future attempts.
- Do not overwrite completed attempts or submissions when reimporting.

Support individual edits and bulk actions **Require webcam**, **Do not require webcam**, and **Inherit exam setting**, with the same active-attempt restrictions. An in-person/at-home label may be derived for filtering, but the effective requirement is determined by the actual webcam setting, not a guessed location.

Escape spreadsheet-formula-leading content appropriately on CSV exports and error reports. Render all uploaded values as text in the dashboard. Imports cannot set hosts, paths, shell commands, roles, passwords, or agent credentials.

## 13. SSH connection management and channel admission

Use `ssh2` directly rather than launching a fresh `ssh` subprocess for each terminal. Authenticate the jump connection, obtain a forwarded stream to the fixed class destination, and authenticate the second client over that stream. Retain both clients until the attempt ends or fails. Do not expose a general-purpose forwarding API to the browser. [R6]

For each new terminal:

1. Check the authenticated student, active attempt, current page ownership, deadline, and terminal limit.
2. Obtain authorization for a new pane from the class agent.
3. Open a new session channel with a PTY on the retained class connection.
4. Complete the trusted server-side admission/setup handshake before connecting it to xterm or recording its output.
5. Start the student's original login shell inside the controlled attempt environment.
6. Connect terminal data, resize messages, backpressure, and lifecycle events.

Use these labels in the resulting exam shell:

```text
TERM=xterm-256color
EXAM_ID=<configured exam identifier>
EXAM_ATTEMPT_ID=<opaque attempt identifier>
EXAM_PANE_ID=<opaque pane identifier>
EXAM_DIR=<absolute working directory to be collected>
EXAM_DEADLINE=<canonical UTC deadline>
```

Test `TERM` against the installed terminal database; never put the exam ID in `TERM`. The labels are convenient for shell setup and instructor scripts, **not credentials**. The agent computes or verifies them against the authenticated account and attempt. Unsetting or changing them cannot remove restrictions.

Admission must use a short-lived, one-use, backend/agent-authorized capability, bound to the verified account UID, attempt, pane, purpose, and the retained SSH transport. A random client-provided `EXAM_ID`, username, source IP, or browser identifier is not sufficient. The class connection's apparent source is the jump host, so IP allowlisting cannot identify the approved webapp connection.

Use a signed `exam-control` operation on the retained student SSH connection to issue pane capabilities and a root-verified local gate to redeem them. Verify local caller credentials using operating-system peer identity, not user-supplied UID fields. Validate the actual SSH connection/session relationship using trusted server-side process/connection information; prevent PID-reuse and cross-transport confusion.

Deliver secrets through a framed setup protocol hidden from the terminal, after the controlled gate is ready. Do not put admission secrets in browser messages, terminal input visible to the student, command-line arguments, logs, profiles, or long-lived environment variables. Pane admission uses one-use opaque tokens with agent-side state. Command authorization uses Ed25519 signatures over the exact base64-encoded UTF-8 JSON payload, checked with established cryptographic libraries; never reserialize payloads for signature verification. The compiled gate should protect its handshake from same-UID inspection where supported, and setup must occur before untrusted user code is run.

Registration/control channels must be bounded and counted separately from student windows. Configure and test enough class-server session capacity for four terminals plus control/setup overhead. OpenSSH's `MaxSessions` governs concurrent session channels; a value of one prevents this design. Provide a tested value such as eight, rather than assuming unlimited channels. [R16]

Backpressure is mandatory. Bound per-channel buffers, distinguish control messages from terminal bytes, preserve byte order, and do not let a terminal flooding stdout exhaust the entire application or prevent deadline/lock messages. A channel error closes or marks that pane; transport loss locks the whole attempt. Do not automatically create a new authenticated transport behind the student's back.

Closing the last terminal does not stop the clock or finish the exam. The student may create a new terminal while the attempt remains active. A minimized terminal counts toward the limit.

## 14. Class-server components and enforcement

### 14.1 Required target and division of privilege

The first supported server installation targets Linux with systemd and cgroup v2. Detect required capabilities during installation and preflight; document the tested distribution, kernel, OpenSSH, and systemd versions. A platform lacking required controls must not silently run in a weaker production mode.

Install a compiled, root-owned session gate/launcher and a root-owned exam agent. The launcher itself is not a general setuid-root shell. Its unprivileged entry path runs under the account identity established by SSH and talks to the narrowly scoped agent. The agent performs privileged setup, containment, deadline enforcement, and collection, then runs student code with the student's ordinary, unprivileged execution identity inside the controlled environment.

The webapp must not receive root SSH credentials, unrestricted sudo, write access to `/etc`, a host Docker socket, or arbitrary command execution in the agent. Its agent credential authorizes only defined exam operations for locally approved course accounts and templates.

### 14.2 Controlled entry before personal shell startup

Do not rely on student `.profile`, `.bash_profile`, `.bashrc`, or `.zshenv` for enforcement. Preserve them rather than editing or replacing them. Their purpose is the student's normal shell environment, which may execute another shell.

Install the controlled binary as the actual account entry-point shell, with the original shell recorded in a root-owned mapping. Protect that mapping and the shell assignment from student changes. The gate must execute before personal startup files and before any exam-specific shell handoff. An optional `/etc/profile.d/` helper may display information, but is not an authorization or deadline mechanism.

Do not assume a remote command or `ForceCommand` alone runs before personal shell startup: OpenSSH invokes commands through the configured login shell. Likewise, account-level `~/.ssh/rc` must not run before the controlled exam entry. Use appropriate root-owned SSH configuration and verify the complete invocation path. [R16], [R17]

After validating admission, preparing the pane, joining containment, and emitting the welcome information, execute the recorded original shell as a login shell with the appropriate argv convention. For example, Bash then handles its own startup-file selection; a personal Bash profile that executes Zsh still works. Do not manually source a Bash profile under a different shell or run the same profile twice.

Initialize the exam workspace once at activation. Each pane may display a welcome banner and set its initial working directory, but may not reset files, regenerate questions, or reset the clock. If the student's profile clears the screen or changes directories, provide a persistent workspace label in the web UI and a server-side `exam-info` command to redisplay the instructions and path. Personal shell behavior cannot undo the agent's restrictions.

Outside an exam, dispatch to the original login shell and preserve ordinary interactive startup. Preserve ordinary remote-command and file-transfer behavior where supported by the declared installation, and test it. Any deliberate global SSH hardening change, such as disabling forwarding for managed course accounts, must be documented and included in rollback; do not claim it preserves every SSH feature unchanged.

### 14.3 Ordinary-access restriction

From preparation/admission closure until the original deadline AND secured collection, the student must not obtain an ordinary path to their account or exam files. Completion and access restriction are independent states. Admission closes during preparation; after terminating conflicting sessions, commit the authoritative start/deadline and `HELD` state durably before initializing/releasing exam material. Interrupted initialization is a recovery failure, not permission to restore access or reset the clock.

The installation must address:

- New interactive SSH shells, including those without exam environment variables.
- Remote commands and commands supplied with forged exam labels.
- SCP, SFTP, and `internal-sftp` paths that could otherwise bypass a shell hook.
- New channels on previously authenticated ordinary SSH connections.
- Existing shell/file-transfer sessions and processes with open writable handles.
- SSH forwarding, agent/X11 forwarding, tunnels, and alternate SSH listeners.
- Local/session entry routes, cron/at jobs, and user services that could start outside the attempt's containment.
- Attempts to change the account's configured shell or privileged enrollment state.

Use the account gate, appropriate SSH configuration/PAM hooks where needed, and process/namespace controls together. Do not use password locking alone: it does not revoke existing sessions or every alternative authentication method. Do not assume a shell wrapper intercepts internal subsystems or forwarding channels automatically.

The static root-installed login gate must be the account shell, so authorization happens before student startup files. `ForceCommand` applies to every SSH session channel, including new channels on existing authenticated/multiplexed transports; external SFTP/SCP/remote commands have no exception. Client `EXAM_ID`, origin/localhost, and browser flags convey no authority. Each exam channel additionally consumes a short-lived one-use capability bound to the registered live root-owned SSH transport, account, attempt, pane and purpose; consuming a stale practice or completed-attempt capability must fail.

At activation terminate existing login/user-service sessions and scan real/effective/saved/filesystem UIDs for uncontained processes, preserving only the verified gateway SSH transport. Include detached children and pre-existing writable descriptors; fail activation if cleanup cannot be confirmed. Disable user-service lingering and course-account cron/at/local/PAM routes, remove queued jobs, and inventory root/system scheduler entries, enabled services, additional SSH listeners, privileged groups and host sockets capable of acting as the UID. Root-managed arbitrary code cannot be inferred from client claims: record administrator signoff only after testing all enabled routes. Uncontrollable isolation is a preflight failure.

The installed root-owned machine checker checks effective SSH configuration for managed accounts (loopback and non-loopback contexts), gate shell/UID/groups, environment/RC/forwarding policy, alternate PAM entry denial, lingering, user crontabs and pending at jobs. The operator matrix must also cover every actual listener/Match branch, system jobs and other enabled services. New readiness guards `intervalAccessHold`, `allSessionChannels`, `alternateServices`, and `schedulerIsolation` default false. Production also requires the new agent capability and interval-access signoff. Missing/corrupt previously initialized administrator state must deny access, never be treated as no attempts.

During installation, identify access routes on the supported server and establish a course-account policy covering them. If a route cannot be controlled, the production readiness check must fail with a concrete diagnostic. Do not accept an undocumented, test-only exception that leaves an alternate exam path open.

Close admission first, then quiesce/terminate conflicting ordinary sessions and jobs before revealing questions. Keep the one registered gateway transport and required privileged supervisors alive; do not blindly kill every process with the UID and destroy the approved connection. Serialize admission and activation so a concurrent new login cannot race this operation.

Keep exclusion in force during active, locked, finalizing, failed, AND early-completed attempts. Do not restore ordinary access immediately on early completion. Restore it only after the original deadline has elapsed AND a verified protected copy exists with all workload processes terminated. A root-only emergency override may release an already secured/terminated account before the deadline with a durable administrator identity/reason audit; it never changes the deadline, replaces the submission, or reopens exam access. Do not expose this override to the student socket, student SSH command operations, or instructor continuation workflow. Reversing the exclusion must restore recorded state rather than guess the student's old shell or settings.

### 14.4 Containment of exam work

All exam shell processes and descendants must belong to an agent-controlled per-attempt process group/cgroup and filesystem/network environment. Each pane belongs to the same attempt context, with independent PTYs. The SSH transport, root agent, local deadline watchdog, and archival worker must remain outside the student workload's freeze/kill boundary.

Use root-controlled cgroup v2 and suitable systemd/namespace supervision. Student processes must not be able to migrate themselves out, delegate work to an unrestricted host user service, or leave an untracked daemon. Cgroup freezing and termination are useful primitives, but require correct descendant ownership and permissions. [R18]

Provide a per-attempt network namespace without external connectivity; a shared loopback within that attempt may be enabled for local programming exercises. Do not rely on removing `curl`, filtering command names, or a restricted shell. Prevent access to host service sockets that would provide an indirect network/process escape. No forwarded SSH agents, Docker sockets, host D-Bus/user-service sockets, or ambient privilege escalation.

Provide an isolated filesystem view with the required toolchain, read-only documentation/materials, the student's needed shell configuration, private temporary storage, and the persistent writable submission directory. Preserve shell preferences through a safe read-only or copy-on-write view of the student's own home; do not expose other students' work or all future exam templates. The implementation must document exactly which home changes persist and which do not.

This containment may use established systemd/namespace tooling on the class server; it does not require running the webapp itself with privileges. Use reviewed helpers for namespace/PTY setup instead of fragile ad hoc process tricks. Keep account identity, terminal job control, signals, and editor behavior correct.

At every pause, freeze then terminate the recorded workload, including editors and descendants, and disconnect both student SSH transports. Authorized continuation requires fresh SSH authentication under the same single-use grant; it creates new shells on the existing saved workspace. At finalization, freeze/stop as required to obtain a stable saved-file view, then terminate the workload without giving it a post-deadline opportunity to write more files.

### 14.5 Agent state and watchdog

Persist attempts, canonical deadlines, original account state, work paths, transport registration, pending collection/export jobs, and recovery information in root-private storage.

Provide operations with bounded typed schemas, not arbitrary shell commands:

```text
health / capabilities
resolve-course-accounts
prepare-attempt
activate-attempt
inspect-attempt / reconcile-operation
issue-channel-admission
lock-attempt
renew-execution-lease
authorize-continuation / consume-continuation
finalize-attempt
submission-status / export-submission
cleanup-expired-monitoring-copies, where applicable
```

Only the gateway's authenticated control identity may perform remote mutations; local student helpers receive only their narrowly scoped operations. Recheck account/attempt ownership server-side. Enforce idempotency and authorization per operation.

Run an independent local watchdog, restarted by systemd, that locks on expired execution leases and finalizes at deadlines. A read-only cutoff pass must freeze expired workloads independently of any archival/state lock, so one long collection cannot delay another deadline; one failed freeze must not skip other due attempts. A separate periodic reconciliation unit/timer must catch missed deadlines, unfinished collections, and agent restarts. No finite system can guarantee execution through a total machine/power failure: after recovery, preserve the already saved files, prevent renewed student access, collect them, and mark the outage in the manifest/audit record.

On agent/control failure, fail closed for exam access while preserving the local deadline and work. Provide a root-only status and recovery CLI with an audit trail and a carefully documented break-glass procedure. Agent restart must not blindly clear every active-account restriction.

## 15. Working directories and protected submission collection

### 15.1 File layout and initialization

Use opaque attempt IDs in filesystem paths and a root-controlled base, for example:

```text
/var/lib/exam-agent/                 # root-private state, templates, recovery data
/srv/exam-workspace/work/<attempt>/  # parent managed by root
    work/                           # student-writable collected directory
/var/lib/exam-agent/submissions/<attempt>/
    submission.tar.gz
    manifest.json
    archive.sha256
```

The exact path is configurable through trusted agent configuration. Students and CSV rows cannot choose arbitrary source/destination paths. A username is metadata, not a safe path component by itself.

Copy a configured, versioned starter template into a fresh per-attempt directory once. Make exam questions and reference materials read-only and available only when the attempt is activated. Keep hidden solutions, other variants, and future attempts inaccessible.

Display the configured collected directory as `EXAM_DIR` and in the toolbar. The student UI must say: **“Saved files in [directory] are collected automatically when time expires or you finish the exam.”** Show this explanation and the unsaved-buffer warning in the Begin exam confirmation and toolbar tooltip, without a permanent notice row. Keep the exam workspace lean: no Rules button or routine copy/rename status row; terminal errors use dismissible dialogs and recovery uses its existing overlay. Students work normally and save files; they must not run a submission command, upload files, create an archive, or perform any other submission task. Work elsewhere or unsaved editor buffers are not promised as submission content. Provide a safe `exam-info` helper; automatic deadline collection must not depend on a student running a submission command.

### 15.2 Finish and expiration

**Finish exam** is optional. Its confirmation must state that finishing is irreversible; confirming immediately revokes terminal input/access and triggers collection. Doing nothing triggers the same procedure at the authoritative class-server deadline, normally 90 minutes after Begin or the configured individual duration. Closed/disconnected/locked browsers and an unavailable webapp do not postpone collection. The independent privileged watchdog and persistent reconciliation service enforce this locally.

**Finish exam**, deadline expiration, and local administrator termination use the same idempotent finalization workflow, with different recorded reasons:

1. Atomically mark the attempt no longer interactive and revoke all input/new-channel/resume authorization.
2. Keep ordinary account access blocked.
3. Freeze all recorded nondelegated workload cgroups, including background jobs and descendants with open writable descriptors, and verify kernel freeze state. Check the student UID for uncontained writers; refuse collection and retain account exclusion if any exist. Revoke new directory access through the verified directory descriptor. Establish a stable saved-file view; terminal-shell closure or chmod alone is insufficient.
4. Capture a protected copy or filesystem snapshot under a root-controlled directory that the student cannot read/change through the exam environment.
5. Terminate the attempt workload safely. Do not send a signal sequence that permits additional post-deadline saving before the protected view is established.
6. Build and verify an archive of that protected view, with a manifest.
7. Mark the protected local copy ready independently of access restriction. Keep the account held until the original deadline has elapsed AND protected-copy verification and workload termination succeed. Early collection never shortens the account restriction.
8. Push the protected archive and signed receipt to private application storage through outbound HTTPS, verify its checksum, and expose it to the instructor.
9. Give the student a receipt/status, not an editable archive location. Stop monitoring and close transports as appropriate.

Do not define success as “the SSH connection closed.” Do not define a read-only pathname or chmod on a directory as sufficient if another process still has writable access to the same underlying files.

### 15.3 Safe collector requirements

Treat the working tree as hostile filesystem input. Implement and test collection defensively:

- Traverse beneath an already validated root directory using safe, directory-relative operations; reject escapes and unexpected mount crossings.
- Do not follow symlinks into arbitrary paths. Preserve symlinks as inert metadata/link entries or report their omission explicitly; never dereference them as root.
- Do not preserve unsafe absolute archive paths or `..` traversal entries. Document safe extraction guidance for graders.
- Handle hardlinks without using them as a way to read data outside the allowed tree; prevent later writes through another link from changing the protected copy.
- Skip/report sockets, FIFOs, devices, and other special entries without opening them or hanging.
- Bound file count, per-file size, total logical size, recursion depth, and archive work. Handle sparse files and changing directories safely.
- Do not run student scripts, hooks, `Makefile`s, compressors from their PATH, or arbitrary executable submissions during collection.
- Do not chown/chmod outside the verified tree through symlink traversal or recursive path races.
- Preserve enough regular-file metadata for grading, but do not preserve setuid bits, arbitrary ownership, or privileged filesystem metadata in the exported archive.
- Never silently truncate a submission or claim success after omitting unexpected regular files. Record omissions/errors and alert the instructor.

A privileged process may control the snapshot, but copying/archiving student data should use the narrowest readable view/privilege practical. Do not use a root `tar` invocation over unvalidated student-controlled paths as the complete solution.

### 15.4 Manifest and export

The manifest must include exam/template version, attempt ID, verified username/UID, effective duration and monitoring settings, source directory label, original start/deadline, effective end, actual writer-quiescence/completion (`completed_at`), collection (`collected`) and verified protection (`secured`) timestamps, completion reason, collection errors/omissions, regular-file inventory and hashes, and relevant infrastructure-outage information. At expiration, the effective end remains the original deadline; delayed recovery timestamps must record when collection actually happened.

The **archive checksum is computed after the archive is complete** and stored beside it, in application metadata, and in the receipt. Do not try to put an archive's own checksum inside itself. A manifest inside the archive can contain per-file hashes; the external manifest may additionally reference the completed archive checksum.

Serialize finalization across agent, watchdog, CLI and reconciliation processes with the persistent state lock. Build archive, manifest and checksum in a private staging directory, flush files and directories, then atomically publish the complete nonempty bundle. If a crash occurs after publication but before state persistence, verify and adopt the bundle without reading the working directory. Never overwrite a published submission, even if live files later change. Incomplete, damaged or mismatched existing artifacts require recovery and must not be silently replaced. Verify remote transfer checksums and manifest identity before enabling instructor downloads. Transfers must be retryable without recollecting an already mutable live directory. Keep the protected local copy until the verified export and local retention policy allow removal.

Distinguish `collection pending/failed`, `submission secured; workload cleanup requires recovery`, and `submission secured; export pending/ready`. Do not declare success without a verified protected copy. Persist collection errors and failure audit/journal events on the class server; the gateway queues instructor alerts and retries as soon as authenticated callbacks can be delivered. Transfer failures retry the existing protected bundle, never recollect live files. Keep submission archives and receipts outside the separate 60-day monitoring deletion policy.

Distinguish `protected locally, export pending` from `collection failed`. The first may permit ordinary access only after the original deadline and confirmed workload termination; the second keeps the account held until recovery succeeds, even beyond the original deadline. Disk-full, permission, hashing, or network errors must surface prominently and remain recoverable. Reserve/check storage before starting, but still handle mid-exam exhaustion.

## 16. APIs, authorization, and data model

Provide a versioned API and shared schemas. Suggested routes are illustrative names; preserve their semantics:

```text
Student
  POST /api/auth/ssh/start
  WS   /api/auth/ssh/dialogue
  GET  /api/student/exams/:examId
  POST /api/student/exams/:examId/preflight
  POST /api/student/exams/:examId/begin
  WS   /api/student/attempts/:attemptId/session
  POST /api/student/attempts/:attemptId/frames
  POST /api/student/attempts/:attemptId/review-request
  POST /api/student/attempts/:attemptId/continue
  POST /api/student/attempts/:attemptId/finish
  GET  /api/student/attempts/:attemptId/status

Instructor
  POST /api/admin/login
  POST /api/admin/logout
  GET/POST/PATCH /api/admin/exams/...
  POST /api/admin/exams/:examId/roster/import-preview
  POST /api/admin/exams/:examId/roster/import-confirm
  GET  /api/admin/exams/:examId/roster/export
  GET  /api/admin/attempts/...
  POST /api/admin/incidents/:incidentId/authorize-continuation
  POST /api/admin/attempts/:attemptId/end
  GET  /api/admin/attempts/:attemptId/recordings/...
  GET  /api/admin/attempts/:attemptId/submission
  POST /api/admin/attempts/:attemptId/delete-monitoring
  POST /api/admin/notifications/test
  WS   /api/admin/events
```

WebSocket messages must have a version/type and validated payload. Bind the connection to one authenticated principal and attempt. Include pane identifiers, sequence numbers, and generation checks where appropriate. Do not let a client open another student's pane by guessing an ID.

Use secure, HttpOnly cookies, appropriate SameSite settings, CSRF protection on mutations, and strict Origin validation for WebSockets. Do not put reusable authentication or agent tokens in URLs. Rate-limit login, roster uploads, review requests, connection creation, and oversized frame/terminal messages. Protect bulk downloads and every media route with instructor authorization.

Suggested metadata tables:

```text
administrators / admin_sessions
student_sessions
exams / exam_versions
enrollments
roster_import_previews / roster_import_audit
attempts / attempt_setting_snapshots
terminal_sessions
incidents / incident_events / continuation_authorizations
capture_metadata
terminal_recording_metadata
submissions / submission_files
notification_outbox
administrative_audit
idempotency_operations / cleanup_tombstones
```

Use foreign keys, migrations, indexes, and transactional state changes. Unique identifiers are not authorization. Store image/recording bytes on the filesystem, not as unbounded SQLite blobs. Keep database transactions short and use bounded application workers for CPU-heavy archival/review tasks, without blocking terminal traffic or deadline enforcement.

Redact secrets from structured logs and trace spans. Never serialize a live SSH client/options object, authentication callback arguments, request body containing passwords, or a session/capability token. Enforce the same policy in debug mode connected to real hosts.

## 17. Repository structure and required deliverables

Create at least this structure, adjusting internal source filenames as implementation requires:

```text
README.md
SPEC.md                              # this specification or a maintained equivalent
SECURITY.md
PRIVACY.md
package.json
<package-manager-lockfile>
Dockerfile
compose.yaml
.env.example
apps/
  web/
  server/
packages/
  protocol/
  config/
migrations/
scripts/
  bootstrap-admin
  doctor
  backup
  restore
examples/
  roster.csv
  roster-with-overrides.csv
  exam-config.example.json
deploy/
  README.md
  nginx/
    exam-workspace.conf.example
  systemd/
    exam-workspace.service
  secrets/README.md
ssh-server/
  README.md
  cmd/
    exam-agent/
    exam-login/
    examctl/
    exam-info/
  internal/
  go.mod
  go.sum                           # if external modules are used
  config/
    agent.example.yaml
    sshd-exam.example.conf
    pam/                           # only if used, with distro-specific guidance
    profile.d/                     # optional information hook, not enforcement
  systemd/
    exam-agent.service
    exam-deadline-watchdog.service
    exam-reconcile.service
    exam-reconcile.timer
  scripts/
    install
    verify
    enroll-accounts
    restore-accounts
    uninstall
  examples/
    sample-exam/
  tests/
tests/
  unit/
  integration/
  browser/
  fixtures/
    mock-jump-host/
    mock-class-host/
docs/
  architecture.md
  student-instructions.md
  instructor-operations.md
  deployment.md
  recovery-runbook.md
  test-report.md
  compatibility.md
```

Do not create empty files to satisfy the tree. Include working scripts and examples, executable permissions, configuration schemas, tests, and documentation. A profile directory is unnecessary if the implementation needs no profile changes; explain that explicitly in `ssh-server/README.md`.

## 18. Docker deployment

The application runs in Docker; the class-server agent is a separate native service on the class server. Nginx and the Compose-management systemd service run on the application host. Do not run systemd inside the application container.

The Dockerfile must use a multi-stage build, install locked dependencies, build the frontend/backend, include only required runtime assets, and run as a dedicated non-root UID/GID. Pin the supported Node.js 26 base image by version and digest; record the resolved tag/digest and upgrade procedure. Node 26.11.1 is the verified runtime and is in the Current release phase as of 2026-10-12. Runtime qualification does not replace production deployment signoff. Reinstall native dependencies for the new runtime rather than reusing Node 24 binaries. Do not bake secrets into image layers or build arguments.

The Compose configuration must include:

- One application instance, with frontend served by the backend or a clearly documented internal arrangement.
- An application port bound only to host loopback, such as `127.0.0.1:3000:3000`, for host nginx.
- Persistent local storage for SQLite and private monitoring/submission files; correct numeric ownership and restrictive permissions.
- Read-only configuration/trust data and secret files mounted separately.
- A read-only container root filesystem where practical, a writable temporary filesystem, dropped capabilities, `no-new-privileges`, process/resource limits, and an init/reaper.
- No privileged container, host PID namespace, Docker socket, or student-home mount.
- Health checks and a deliberate restart policy. A restarted container must reconcile and lock prior active attempts, not start them afresh.
- Sufficient bounded shutdown time to persist state and disconnect student SSH; local execution leases lock attempts and local deadlines collect work; never erase volumes on stop.
- Explicit logging rotation and storage-capacity checks.

Use Compose secrets/file mounts for SMTP credentials, session secrets, administrator bootstrap material where applicable, and the gateway command-signing key. Secret files still require host filesystem protection; Compose file secrets are not an encrypted secret-management service. [R19]

Document required outbound connectivity: configured SSH jump host, SMTP, DNS/time facilities as applicable. The container must not be a browser-controlled generic TCP proxy. Runtime internet access for CDN assets is unnecessary.

Development Compose profiles may include local mock SSH hosts and a mail sink. Do not run automated tests against the real institutional hosts without explicit operator action. Production startup must reject mock credentials, disabled host-key verification, or development authentication settings.

## 19. nginx configuration

Provide an actual, syntactically valid nginx example with clearly marked hostname/certificate placeholders and an installation guide. It must:

- Redirect HTTP to HTTPS, with documented certificate/ACME exceptions if used.
- Terminate TLS with institution-provided or otherwise valid certificates.
- Proxy HTTP and WebSocket traffic to the loopback-bound Docker application.
- Set the required WebSocket upgrade headers and use HTTP/1.1 to the upstream. [R20]
- Disable inappropriate proxy buffering for live event/WebSocket endpoints.
- Use configurable upload/time limits large enough for the documented image/CSV sizes but not unlimited.
- Set forwarding headers explicitly; the application trusts only the local reverse proxy.
- Avoid logging cookies, authentication payloads, secrets, or media query parameters.
- Serve no private recording/submission directory directly.
- Apply appropriate security headers without preventing fullscreen, display capture, or same-origin camera access.

Use a top-level HTTP-context map such as:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
```

The proxy location must include the equivalent of:

```nginx
proxy_pass http://127.0.0.1:3000;
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection $connection_upgrade;
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
```

Implement application-level WebSocket ping/pong, for example every 20 seconds, with compatible idle timeouts such as 75 seconds. A proxy timeout is not the exam timer. Configure bulk submission-download timeouts separately if required.

Define and test a Content Security Policy with self-hosted scripts and restricted connections; do not solve library issues by enabling arbitrary remote script execution or `unsafe-eval`. Some window positioning may require inline styles; allow only the minimum style relaxation necessary and document it. Restrict framing and camera/fullscreen/display-capture permissions to the intended origin; disable microphone permission. Sensitive pages/media should have suitable no-store caching headers.

Include `nginx -t` validation instructions, certificate installation/renewal guidance, and reload/rollback commands. Do not assume the development Vite server is a production upstream.

## 20. systemd services

### 20.1 Application host

Provide `deploy/systemd/exam-workspace.service` that manages the Compose deployment. A suitable default is a oneshot unit with `RemainAfterExit=yes`, ordered after Docker and network readiness:

```ini
[Unit]
Description=SSH Exam Workspace Docker Compose deployment
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/exam-workspace
ExecStart=/usr/bin/docker compose --project-name exam-workspace up -d --no-build --wait --wait-timeout 120
ExecStop=/usr/bin/docker compose --project-name exam-workspace stop --timeout 45
TimeoutStartSec=180
TimeoutStopSec=90

[Install]
WantedBy=multi-user.target
```

This is a deployment template to validate against the chosen Compose version and actual Docker path. The container restart policy handles ongoing container restarts; the oneshot unit is not a process-health monitor. Provide actual health endpoints, dashboard alerts, and operational checks. Do not put `down -v` in service stop/restart commands.

Build/pull the tested image explicitly during deployment, not on every boot. Document enabling, starting, stopping, inspecting logs, upgrading outside active exams, and rolling back without destroying stored data. Use a drain/maintenance mode to prevent new starts during planned maintenance.

### 20.2 Class server

Provide separate native agent, watchdog, and reconciliation units under `ssh-server/systemd/`. Apply sensible hardening without removing the exact privileges required for account gating, namespaces, cgroups, and protected collection. Document why each retained privilege/write path is needed. Do not copy application-container restrictions blindly onto a service that must manage host processes.

Set explicit restart behavior, runtime/state directory ownership, logging, and ordering. A reconciliation timer must persist/catch up missed work after downtime. Test that killing the webapp and stopping the shared SSH gate service while the independent watchdog remains running do not grant time or expose the working directory through ordinary SSH.

## 21. Installation documentation and operational runbooks

The top-level README must take an operator from a clean checkout to a working local demonstration and then a production deployment. Include configuration values, commands, expected results, permissions, health checks, backup/restore, and troubleshooting.

`ssh-server/README.md` must be independently usable. It must document:

1. Supported server prerequisites, pre-startup SSH gate, gateway/agent signature keys, and agent outbound HTTPS callback route.
2. Building/installing binaries with exact destinations, owners, modes, and service files.
3. The root-owned course-account allowlist and original-shell mapping.
4. The exact SSH/PAM changes, their scope, and non-exam behavioral effects.
5. How personal shell startup still works and why personal profile edits are not the security boundary.
6. How to inspect rendered SSH configuration for a managed account, validate it with `sshd -t`, and test from a disposable account before enrollment.
7. How to keep a separate root recovery session and backups while changing SSH configuration; never recommend locking out the administrator to test student access.
8. Enrollment/provisioning versus roster import: CSV import does not create accounts or grant the agent authority over root/service users. Explain the local root approval needed for managed course accounts.
9. Sample exam/template installation, directory permissions, preparation, and welcome behavior.
10. Network/filesystem/process restrictions, pre-existing session handling, and class-agent capability admission.
11. Deadline, lock, continuation, collection, transfer, and account-restoration behavior.
12. Archive locations, protected-copy validation, download, and retention.
13. Recovery from container failure, agent failure, reboot, expired HTTPS certificates, rotated signature keys, changed SSH host keys, full disks, and incomplete archives.
14. Rollback/uninstall that restores recorded shells and SSH settings without deleting submissions or leaving students permanently blocked.
15. Explicit handling of any optional `/etc/profile` changes. If none are needed, state that clearly.

Provide a `doctor`/verification command that checks configuration, ownership, certificates, pinned SSH keys, class-agent capabilities, clock synchronization, storage, supported shell mappings, notification setup, forwarding/session limits, and presence of the required server guards. Tests needing student credentials must be opt-in and interactive, not an excuse to store passwords.

Provide student instructions covering the practice test, number-matching sign-in, capture selection, webcam requirement, physical/SSH-only references, internal clipboard, floating windows, save location, timer, interruption/review policy, and submission receipt. Explain that SSH authentication or browser/server failures may lose unsaved editor buffers and that the clock does not stop while waiting for help.

Backups must cover metadata and submission files consistently, protect credentials/media, and preserve retention deletion records. Document that active SSH sessions cannot be restored from a backup. Restoring a database must not restart an elapsed attempt or resurrect deleted monitoring indefinitely.

## 22. Required acceptance tests

Automate what is practical and provide a signed-off manual matrix for browser/OS/institutional behaviors that mocks cannot establish. A fake browser or fake camera test is not proof that real capture permissions or key grabbing work.

### 22.1 Authentication and multiplexing

- A mock jump host requests password, displays a two-digit number-matching instruction including a zero-prompt round, and waits for approval; a mock class host requests the same shared password, supplied by the backend without a second browser password entry.
- Exactly one initial authentication sequence per host occurs. Creating four terminals does not ask for credentials, trigger 2FA, or create another class-server transport.
- A host-key mismatch on either hop prevents login.
- Authentication failures, cancellations, timeouts, and instruction text containing HTML are handled safely.
- Passwords and admission tokens are absent from logs, persistent state, URLs, captures, and recordings.
- Class-server `MaxSessions`/forwarding limitations produce a clear preflight diagnostic.
- The real DePaul number-matching flow is explicitly recorded as tested or untested in the compatibility report; do not infer success from mock tests.

### 22.2 Startup and access control

- Early finish followed by direct SSH shell, remote command, SFTP, SCP, a new channel on a pre-existing ControlMaster connection, or forged exam variables cannot modify work. A successful early protected copy still holds ordinary access until the original deadline.
- Browser reload/logout and gateway/agent restart preserve the original hold; finished attempts cannot use instructor recovery. Unfinished authorized recovery preserves its deadline and monitored panes.
- Detached writers, scheduled jobs, unsafe enabled services and uncontained UID processes fail isolation/preflight; no impact on unrelated students or independent administrator access.
- Release requires both deadline boundaries and verified protection/termination. Missing/corrupt state/artifacts and failed overrides fail closed. Emergency override requires root and a durable reason/identity audit; rollback refuses an outstanding hold.


- Student `.profile` and `.bash_profile` variants, including `exec zsh`, skipped `.profile`, screen-clearing startup, and a different supported configured shell cannot run before controlled admission.
- Unsetting/forging `EXAM_ID` does not bypass the active-account restriction or reset time.
- One-use admission cannot be replayed on another channel, SSH transport, account, or attempt.
- `~/.ssh/rc`, remote commands, SCP/SFTP/internal-sftp, forwarding, existing sessions, and fresh channels on old connections cannot provide alternate access during the attempt.
- Pre-existing processes, scheduled jobs, and attempts to launch host user services cannot continue writing outside containment.
- New terminals get the existing files and deadline; starter files are never overwritten.
- Student processes cannot reach the internet from the class server, other students' work, future exam content, agent secrets, host control sockets, or protected submissions.
- Ordinary non-exam login and supported file transfer return only after BOTH the original deadline and verified protected collection/termination. Successful early collection still blocks ordinary access. Rollback refuses outstanding holds and restores recorded configuration only after release or audited root override.

### 22.3 Timing, interruption, and continuation

- Concurrent/double Begin requests create one attempt and one canonical deadline.
- Lost activation acknowledgment reconciles the existing attempt instead of granting a new timer.
- Browser clock changes, refresh, new terminals, reconnects, and locks do not extend the deadline.
- Switching internal windows never locks; application switching/fullscreen exit does.
- The local overlay and gateway both reject input, paste, terminal creation, and hidden-window input after a lock.
- A still-open page with healthy streams and retained SSH transports recovers within 15 seconds; a reload, expired grace, or lost SSH transport does not.
- Stale/new page instances cannot take over automatically. Queued input is not replayed after reconnect.
- Required capture cessation locks, while repeated identical valid images do not automatically imply cheating or a stalled track.
- Instructor approval alone does not activate an unready page; current fullscreen, streams, state, and deadline checks are required.
- Single-use/stale continuation authorizations and an approval racing expiration cannot restore ended access.
- The class-agent deadline and execution lease work when the application, browser, or callback network is stopped.
- The workload freezes without freezing the deadline watchdog, control plane, or SSH transport.

### 22.4 Workspace and clipboard

- Move, resize, minimize, maximize, restore, side-by-side, snap, rename, close, and layout reset preserve appropriate terminal state.
- The timer and lock overlay remain visible above all internal windows.
- PTY size reaches editors; minimizing never sends invalid zero dimensions or opens another shell.
- Escape, interrupt, suspend, EOF, editor shortcuts, non-US/Dvorak layouts, and supported input methods work in the tested Chrome/Chromium matrix.
- Internal clipboard works between terminals, including multiline bracketed paste, while ordinary paste/middle-click/drag-drop paths and OSC 52 integration are blocked in the active exam.
- Login/password-manager input and administrator CSV paste remain usable.
- Hostile terminal titles/output/URLs cannot execute script, navigate the browser, open another app, or alter clipboard policy.

### 22.5 Webcam, recording, and roster

- An exam default and `true`/`false`/inherit enrollment overrides resolve correctly; an explicit false is not mistaken for true.
- A required webcam blocks start without a valid image; a webcam-not-required student is not forced to grant camera permission.
- Screen and camera images arrive independently near the configured cadence, with correct sequence and capture/receipt metadata.
- Selected tab/window sharing is rejected; no claim is made that all displays are visible.
- Capture stops when the attempt ends; authorized authentication gaps do not record credentials.
- Wrong-user media access, path traversal, invalid images, oversized uploads, conflicting duplicate sequences, and uncontrolled queue growth are rejected.
- CSV tests cover 10,000 rows, BOM, CRLF, quoted names/newlines, missing/extra/duplicate headers, duplicate usernames, invalid booleans, empty/inherit values, privileged accounts, formula injection, and invalid durations.
- Import previews accurately show additions/changes, confirmation is transactional/idempotent, omitted rows are not deleted, and active attempt settings are unchanged.
- Manual deletion and simulated 60-day expiry remove all monitoring/thumbnail copies without deleting submissions; backup restoration honors deletion records.

### 22.6 Collection, deployment, and failures

- Student finish, expiration, and local administrator termination all create retrievable protected archives with matching checksums and correct manifests.
- Unsaved buffers are not falsely described as submitted; saved files remain available after browser loss.
- A background writer cannot change the protected result after cutoff or account restoration.
- Symlink escapes, hardlinks, path races, FIFOs, devices, sockets, sparse/huge files, unreadable files, disk exhaustion, and failed export produce safe, explicit outcomes.
- Retried finalization/export does not overwrite a valid submission or recollect altered live work.
- App/container and class-agent restarts preserve ended/locked state, deadlines, local archives, and original account restoration information.
- Docker build/Compose startup, nginx syntax, TLS/WebSocket operation, systemd startup/stop, health checks, volume permissions, and non-root application execution work from the documented commands.
- SMTP alerts retry safely, never include sensitive images or one-click unauthenticated actions, and dashboard/desktop notification state is accurate.
- A representative load test, default target 100 simultaneous students with up to four terminals and two image streams each, reports hardware, measured limits, storage use, and observed latency. This is a test target, not an unsupported capacity guarantee.

## 23. Implementation order and definition of done

Implement in vertical slices, keeping tests and deployment documentation current:

1. Local two-hop authentication fixture, retained SSH connection manager, one terminal, and real-host compatibility checklist.
2. Server entry gate, per-attempt state, containment, immutable timer, and protected collection; validate these before calling a browser demo an exam system.
3. Floating terminals and exact terminal/channel lifecycle.
4. Browser preflight, fullscreen/keyboard behavior, internal clipboard, capture, and lock/recovery state machine.
5. Instructor dashboard, bulk CSV enrollment/webcam overrides, incident review, notifications, and protected downloads.
6. Recording review, retention, operational recovery, nginx/systemd/Docker packaging, hardening, and load/manual tests.

A runnable development demonstration must use disposable accounts/fixtures and sample questions. Production readiness additionally requires the institutional authentication test, server guard verification, browser/OS matrix, protected-collection tests, and instructor alert test. Fail closed or clearly mark the deployment unready when one is missing; do not silently relax policies to make a demonstration pass.

An explicitly authorized trusted-administrator functional test may instead use a single privileged account through a separate SSH listener or an explicitly installed root-owned gate command on an existing permitted listener, while preserving ordinary administrator recovery access. This exception tests authentication, terminals, deadlines and collection; it does not qualify student isolation. Root configuration must name exactly one account and an admission expiration, health must report functional_test=true and production_ready=false, and production gateways must reject the mode. Label the UI and submission manifest accordingly. Existing attempts must remain recoverable after new-admission expiration. Do not alter the main SSH/PAM/account policy or claim protection against the administrator's ordinary processes or sudo access. See docs/full-exam-test.md for the scoped installation and rollback plan.

The final implementation handoff must include exact startup/test/install commands, screenshots of the implemented student/admin interfaces if available, migration and recovery instructions, dependency versions, and a test report distinguishing passing automated checks, passing manual checks, untested integration points, and known limitations. Do not state that this application prevents all cheating or reproduces physical supervision perfectly.

## 24. Primary technical references

These references support the protocol/API choices and implementation cautions. Product behavior, timeouts, defaults, and security requirements above are this project's specifications rather than promises made by those libraries.

[R1]: https://developer.chrome.com/docs/capabilities/web-apis/keyboard-lock "Chrome: Keyboard Lock API"
[R2]: https://www.rfc-editor.org/rfc/rfc4254.html "RFC 4254: SSH Connection Protocol"
[R3]: https://xtermjs.org/docs/guides/using-addons/ "xterm.js addons, including FitAddon"
[R4]: https://github.com/nextapps-de/winbox "WinBox official repository and API"
[R5]: https://fastify.dev/docs/latest/ "Fastify documentation"
[R6]: https://github.com/mscdex/ssh2 "ssh2 official repository: hopping, keyboard-interactive, channels, host verification"
[R7]: https://github.com/WiseLibs/better-sqlite3 "better-sqlite3 official repository"
[R8]: https://csv.js.org/parse/options/ "csv-parse options and validation controls"
[R9]: https://nodemailer.com/ "Nodemailer official documentation"
[R10]: https://playwright.dev/docs/test-configuration "Playwright test configuration"
[R11]: https://xtermjs.org/docs/guides/security/ "xterm.js security guidance"
[R12]: https://www.rfc-editor.org/rfc/rfc4256.html "RFC 4256: SSH keyboard-interactive authentication"
[R13]: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia "MDN: screen capture and permission constraints"
[R14]: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia "MDN: camera capture"
[R15]: https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API/Using_the_Notifications_API "MDN: browser notification permission and behavior"
[R16]: https://man.openbsd.org/sshd_config "OpenSSH server configuration"
[R17]: https://man.openbsd.org/sshd "OpenSSH session startup and command execution"
[R18]: https://docs.kernel.org/admin-guide/cgroup-v2.html "Linux kernel cgroup v2 documentation"
[R19]: https://docs.docker.com/compose/how-tos/use-secrets/ "Docker Compose secret-file handling"
[R20]: https://nginx.org/en/docs/http/websocket.html "nginx WebSocket proxying"

- [Chrome Keyboard Lock][R1]
- [SSH channels, PTYs, environment requests, and resize notifications][R2]
- [xterm.js addons][R3] and [security guidance][R11]
- [WinBox window management][R4]
- [Fastify][R5], [ssh2][R6], and [SQLite integration][R7]
- [CSV parsing][R8], [SMTP][R9], and [browser testing][R10]
- [SSH interactive authentication][R12] and [OpenSSH server configuration/startup][R16]
- [Screen capture][R13], [camera capture][R14], and [browser notifications][R15]
- [Linux cgroup v2][R18], [Compose secrets][R19], and [nginx WebSockets][R20]

For an explicitly requested unrestricted trusted-administrator functional test only, root may
set functional_host_access=true with the single configured test account. Authorized terminals
then use tracked transient systemd user services, real NSS/home, installed host tools and existing
account privileges. Bind the attempt directory at the configured exam path and materials
read-only. Continue recording, admission checks, original deadlines, whole-cgroup cutoff and
protected collection. This mode has no host-account isolation guarantee and cannot qualify
production; normal production terminals retain the isolated rootfs and irreversible capability
drop. The root agent itself retains NoNewPrivileges=yes. Generated production NSS and
preference files must remain student-readable despite the agent private umask.

Student dialog wording must consistently describe automatic collection: signing out or closing
panes does not prevent deadline collection; Finish exam triggers it immediately and irreversibly.
Use concise start/finish/sign-out confirmations, without suggesting a manual submission step.
Terminal context menus contain actions only, with no clipboard-scope footer. On student receipts,
keep the secured/pending/failed outcome visible and put checksum, attempt ID and transfer details
in a collapsed Submission details section. Instructor recovery details remain available.

Interface content must support an action, a decision, consent, or a visible operational state.
Remove promotional headings and duplicate labels. Student sign-in uses one compact form with
password-reuse and recording/browser requirements, without a hero column or repeated footer.
Keep authentication host identity and all MFA instructions visible. Combine duration/webcam
requirements and put the start window in expandable details. Workspace chrome shows exam,
connection/capture state, saved directory, timed deadline and available terminal controls;
preflight hides inactive timer/finish controls and empty terminal menus. Empty states provide
one actionable instruction. Recovery preserves the reason, clock, restoration controls and
instructor authorization. Receipts keep secured/pending/failed outcomes prominent.
Instructor views prioritize attempts, enrollment and exam settings. Collapse alert setup,
audit delivery, collection timestamps/checksums and destructive maintenance; preserve failure
indicators, account-access holds and all authorized recovery actions. Show pagination only
when needed, avoid repeating monitoring requirements and inactive contact/countdown values,
and keep submission downloads independent of CSV import. Terminal replay selectors use
readable terminal names; show missing webcam evidence only when webcam is required.

## Reserved sandbox exam

The exam ID is the string constant SANDBOX_EXAM_ID="sandbox" (SandboxExamID in the
native agent); ordinary exams have string IDs, so no numerical alias is needed. The
sandbox is a practice/test exception, never a graded exam: fixed 300-second duration,
no earliest/latest start check in either gateway or class agent, automatic enrollment
for successful real SSH identities approved by the class agent, and automatic continuation
and reauthentication grants. Host pins, real password/phone MFA, account approval,
monitoring readiness, same-identity/page ownership and generation/deadline checks remain.
A reconnect resumes an unfinished attempt with its original deadline; no instructor
interaction is needed. Ended attempts cannot resume. Each next run receives a new UUID,
working directory, manifest and protected archive; retain all submitted attempt history.
Only sandbox drops its original-interval hold after verified protected collection and
confirmed workload termination so an early finish can be followed immediately by another
run. Failed collection retains recovery and account holds. Ordinary exam holds and
single-attempt policy remain unchanged, including when requesting sandbox while a normal
exam restricts the same account. Use partial uniqueness for ordinary exam/student pairs
and retain the one-busy-attempt-per-UID guard. Historical transfer retries must operate on
that attempt's protected copy and never disconnect a subsequent sandbox connection.
UI hides start-window controls for sandbox, fixes duration, and uses Resume/Continue/Reconnect
without instructor-approval wording. Confirmations remain irreversible and collection automatic.

Pause implementation: intentional disconnect suppresses the old connection's loss callback so
it cannot create a second incident and revoke the just-issued grant. Bind new continuation
entitlement to the replacement transport and current generation. Native watchdog pauses
also clear entitlement and terminate workloads; cleanup failure stays locked. The instructor
has one Authorize resume control; sandbox supplies that same grant automatically. Required
monitoring/fullscreen restoration happens after fresh authentication, never around password
entry. The original clock and ordinary account restriction survive every step.


## Local administration and command/callback transport

`examctl` is a root-only class-server command. It uses the same persisted state and inter-process lock as the shared gate, watchdog and collector; it works while the SSH gate service is stopped. `list` shows all attempts, `list --active` shows started unfinished attempts (including locked/finalizing/failed), and `--exam EXAM` filters by exam ID. `info ATTEMPT` reports the original interval, submission/access states and recovery errors. `start` activates an already prepared attempt without changing an existing start/deadline; `pause` disconnects workloads; `stop`/`finish` collect immediately and retain the original access hold; `cancel` applies only before start; `retry` retries collection; `manifest`/`export` verify and retrieve protected artifacts; `delete` requires released access. Mutations require an audited administrator reason. `override-access` remains separately audited, root-only, and requires verified protection/termination.

`examctl agent start|stop|restart|status` manages only the shared SSH gate service. Start/restart also ensure the independent watchdog and reconciliation timer are running. Stop leaves both running and closes student gate access; it is not a way to cancel deadlines. Do not reset state, kill the watchdog, change account shells or restore access as an exam stop mechanism.

Student Finish requires an active retained SSH transport. A disconnected or locked student must complete authorized fresh SSH recovery before finishing early, or simply let the original deadline collect work. Instructors cannot stop attempts from the web dashboard. Local deadline cutoff runs every second, with lock-free freeze checks so HTTP deliveries or collection compression cannot delay another attempt's cutoff. A powered-off class server cannot execute collection at that instant; persistent reconciliation runs on return and access stays denied in the meantime.

Migration removes the old `listen/cert/key/ca/client_name` agent API settings and gateway `agent.url/ca/cert/key`. Configure `agent_id`, `gateway_public_key`, `callback_url`, `callback_key` (optional private `callback_ca`) on csc-sys, and matching gateway `agent.id/signingKey/callbackPublicKey`. Remove the old inbound 9443 firewall/tunnel after draining and verifying the new SSH command route. Preserve state/work/protected archives and original account recovery records. Dashboard readiness comes from signed registry/configuration callbacks; preflight rechecks current guards over the student's live SSH. No cached report substitutes for live preflight admission checks.

Production signoff requires `sshCommandTransport` and `statusCallbacks`, default false. Native
health advertises `signed-ssh-control` and `durable-status-callbacks`; gateway preflight checks
these alongside interval access and all-channel admission. Verify key ownership, signature
exchange, callback delivery/recovery and archive limits before marking those deployment
checks complete. Local simulated browser tests alone do not qualify privileged isolation.
