# Terminal Emacs clipboard deployment

Implementation revision **6559f71** was deployed on 2026-10-19 at 04:40 UTC
(October 18, 23:40 Chicago time).

## Behavior

The class server now loads the root-owned global configuration
`/etc/emacs/site-start.d/50terminal-clipboard.el`. It enables Emacs 29's built-in
per-terminal OSC 52 writer after xterm initialization, preserving other capability
discovery, native GUI behavior, user clipboard settings and normal bindings.
**C-w cuts** the region; **M-w copies** it. It does not enable clipboard queries.
New normal `emacs -nw` processes load it; existing processes must reload it or restart.
`-Q`/`--no-site-file` intentionally skip global startup. Ordinary SSH clients must
support and permit OSC 52 writes; multiplexer forwarding remains client configuration.

The exam accepts writes only into its attempt-local clipboard, shared between panes.
Ctrl+Shift+V and the terminal context-menu Paste use that buffer. It never reads or
writes the student's OS clipboard or responds to queries. Replay still discards
these sequences. Covered, locked and disconnected terminals cannot update/paste the
buffer. Invalid, noncanonical, oversized or non-UTF-8 writes are consumed without
changing the buffer. The decoded cap is 75,000 bytes. Large pastes use messages of
at most 16,000 UTF-16 code units without splitting surrogate pairs, rechecking input
authorization for each message. The clipboard is not separately persisted; OSC output
is still terminal output under the existing recording/retention policy.

The full read-only host view exposes the global configuration inside normal exam
namespaces; the existing Emacs application-state wrapper keeps site/user startup.
No namespace, student account, access restriction, native agent binary or service
configuration changed. Administrator sandbox behavior is preserved.

## Verification

- Production build and typecheck passed; **218 unit/integration tests passed**.
- **Three Emacs ERT tests passed**, covering terminal write-only setup, unchanged
  keybindings/capabilities/backends, GUI/opt-out behavior and idempotent hook loading.
- A real local `emacs -nw` process in a private PTY received C-w and emitted OSC 52;
  the browser parsed its complete terminal output and pasted the exact Unicode,
  multiline selection into a second exam terminal.
- **Three browser checks passed locally and three against the deployed frontend**:
  real Emacs cross-pane paste, large lossless paste, malformed writes/queries,
  no OS clipboard API calls, and covered/paused input blocking. Deployed checks
  intercepted API/socket fixtures and did not mutate production student records.
- A separate real SSH connection ran Emacs on csc-sys with the installed global
  configuration. C-w copied the exact Unicode test selection into an isolated
  Xvfb/xterm client system clipboard, with clipboard reads disabled. The user's
  desktop clipboard was not accessed.
- No live student MFA exam was started for these tests. Public readiness reports
  productionReady and notifications true, maintenance false. Systemd is active and
  the container is healthy. The public frontend checksum matches the tested build.

## Deployment and rollback

No preparing, active, locked or unresolved collection existed at web cutover;
activity was rechecked after stopping the service. Marco's normal checkout,
Compose build and systemd conventions were used with a consistent private backup
and rollback on startup failure. Existing data, credentials, sandbox, SMTP and
administrator access were preserved. No schema changes or student resets occurred.

- Image: `ssh-exam-workspace:terminal-clipboard-6559f71`, also tagged as the usual
  `ssh-exam-workspace:1.0.0` service default.
- Image SHA-256: `3ea2a00177ea12bdf889b4338eee7502b0901c758df6a94abed102ef64dfbf7d`.
- Frontend: `/assets/index-BuH3-CTW.js`, SHA-256
  `38bcaaea9b9c77e9dbfb7e9f2d706aea8f2358a4c7dc85bc3a5bfbf679e18803`.
- Marco backup/receipt:
  `/var/backups/ssh-exam/20261019T043950Z-terminal-clipboard-v_hlne1v`.
- Previous image SHA-256:
  `1eec4675e955a5cd2697df64c77320cbecc03fa4801c6b2618e98c49c26755ba`.
- csc-sys global file SHA-256:
  `bc3d4f6432d69da5ae27893d209f5412c2080cdbe6e10648baacb72046a51f47`.
- csc-sys private installation receipt:
  `/var/backups/ssh-exam/20261019T043736Z-terminal-clipboard-dhlhtzt0`.
  The global file was previously absent; its existing neighbors were untouched.

Web rollback: drain attempts, retag the previous image as the default and restart
ssh-exam. Preserve newer data and reload pages. Global-config rollback: remove the
single installed file (or restore a previously backed-up version), then reload or
restart affected Emacs processes. No SSH/agent restart is needed. Apply the normal
monitoring-backup expiration policy to private backups.
