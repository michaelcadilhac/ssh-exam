# Implementation decisions

One Fastify instance owns live ssh2 objects; SQLite/WAL stores authoritative metadata and private
files hold media/archives. Local storage is required. No competing replicas or stateless workers.
Versioned migrations 001 through 008 are idempotently applied; 002 adds protected-copy and actual
completion/collection/protection timestamps without changing existing attempts. Settings snapshot at preparation; later roster edits do not change an attempt. Explicit instructor clock resets have separate durable intents and versioned root acknowledgments; they do not alter its original deadline.

Begin persists its opaque operation/attempt ID before signed SSH activation. The class agent commits
canonical millisecond UTC start/deadline before allowing material-bearing shells. Lost replies
reconcile the same ID and lock the original deadline. A renewable execution lease lasts at most
15 seconds and requires current page status plus accepted required images. Lease recovery alone
cannot unlock review locks. Single-use generation-bound continuation expires within five minutes
or the deadline. Page secrets remain in memory; replacement needs authorization.

The Go agent serializes remote/local/watchdog operations with flock and atomic fsynced state.
Its Unix gate verifies SO_PEERCRED and trusted process ancestry to a root privilege-separated
sshd ancestor, incorporating PID start ticks, UID and boot ID. Tokens are random and stored
hashed. Exact OpenSSH process layouts must pass the manual suite before readiness signoff.

Each pane gets an internal root-allocated PTY bridged to its SSH PTY with nonzero resize propagation.
systemd scopes place bubblewrap descendants in exam.slice; SSH, agent and watchdog stay outside.
The reviewed course policy skips pam_systemd placement for managed SSH transports and denies
alternate local/job/user-service paths. Ordinary SSH commands/external SFTP use recorded original
shells outside attempts. Forwarding stays disabled throughout course enrollment.

The deployed student environment uses the normal host filesystem read-only, with
writable per-attempt work and disposable application state, the actual home read-only,
private temporary storage and private proc/dev/network/PID/IPC/UTS/cgroup namespaces.
It hides other homes, sysfs, host service sockets and private agent/exam storage;
root-configured exclusions cover site-specific socket and private installation paths.
Readiness and every pane reject uncovered host UNIX sockets. All normally accessible
installed software/configuration remains available without a package allowlist.
The legacy separate-rootfs mode remains supported. /work persists and is collected; /materials is current read-only
exam material. Private `/tmp` and `/var/tmp` use separate root-controlled, disk-backed
per-attempt directories shared across panes, with separate practice/exam pairs and
`TMPDIR=/tmp`. They survive authorized reconnection/agent restart but are not collected.
After verified collection and workload termination (or confirmed preflight cancellation),
link-safe cleanup removes them. Parent directories are private `0700`; bound leaves
are root-owned sticky `1777`. The trusted administrator launch path binds the same
private temporary directories while retaining its existing home/access policy. Normal filesystem mode exposes the actual student home read-only; legacy rootfs mode
uses copied startup preferences. Neither exposes live home sockets or persists home edits. Per-pane network namespaces have no external
interface. Shared loopback between panes is not implemented. Debian/systemd/cgroup v2 is the
target; installed-environment qualification is recorded in `docs/toolchain-test-results.md`.

Collection checks frozen cgroup.events, traverses through os.Root without following symlinks,
and allows 10,000 entries, depth 32, 32 MiB per regular file and 64 MiB total logical bytes.
Hardlinks fail; symlinks/devices/FIFOs/sockets are explicitly omitted. Archives strip unsafe
ownership/mode metadata, include file hashes and a manifest, and publish an external archive
checksum only after completion. Ordinary access returns only after the original deadline AND verified protection and workload
termination. COMPLETED + HELD is a valid early-finish state. Export failure means protected locally/export pending; collection failure retains
account exclusion.

The browser samples real media tracks outside authentication. Six-frame source queues and byte
caps bound recovery. Focus loss gets a 20-second, server-enforced grace countdown while monitoring/leases continue; fullscreen exit and hidden documents still block immediately; internal window
changes preserve terminals. WinBox fullscreen is disabled and window bounds exclude the toolbar.
Internal clipboard uses selection and xterm bracketed paste without navigator.clipboard.
Automated canvas video and keyboard stubs exist only in the browser tests.

Connection handling is supervised by `connection-process.ts`, with one OS child process
(`connection-worker.ts`) per login/retained attempt connection. The child owns the existing
BrowserConnection or fallback SSH Connection; the HTTP process owns a bounded proxy and
persistent attempt authorization. Fatal child failures cannot escape as unhandled errors in
the shared HTTP process. A hung child is retired by a 10-second heartbeat watchdog; individual
supervisor RPCs are bounded to 125 seconds. Teardown rejects pending work, closes that browser's
transport, retires panes and requires the normal instructor-authorized fresh SSH recovery.
Lease failures are generation/connection scoped: a late failure cannot re-pause an already
locked attempt or a replacement authenticated connection. No automatic credential replay occurs; original deadlines and independent class-server
collection/access restrictions survive. Deliberate logout, finish and service shutdown do not
send failure alerts. Unexpected worker failure produces one durable email containing student,
exam, attempt and a fixed cause/exit code; stderr, exception messages and terminal data are not
logged or emailed. SMTP outages use the existing persistent outbox retry policy.

Each child has a 64 MiB V8 heap cap, reduced thread counts and Linux OOM preference above the
supervisor. IPC is bounded to 8 MiB per packet, 16 MiB queued in either direction and 64 pending
supervisor operations. `connectionWorkers` defaults to 32 (1–128); at capacity new logins are
refused while existing sessions remain intact. Compose permits 1,024 tasks for worker threads.
Increase memory/PID budgets before raising admission capacity. Process isolation contains
attempt connection failures; the host/container, HTTP APIs, metadata database, capture processing
and notification service remain shared infrastructure. It is not a malicious-code sandbox or
protection against a whole-host outage. Production exposes no fault-injection API; the deliberate
failure entrypoint and SMTP fixtures are only built/used by tests.

SSH login owns a clearable credential scope with a 120-second whole-sequence deadline. The
first verified password challenge collects one shared password, converted to a mutable Buffer.
Both destinations come exclusively from server configuration and both host keys must match
provisioned pins before credentials are supplied. Password auth uses a short-lived Buffer copy;
keyboard-interactive uses a strict password-prompt allowlist, and forwards every other prompt
to the student. There are no implicit OTP answers or retries after rejected credentials.
Cleanup wipes owned mutable copies, clears answer arrays/WebSocket packets, drops the dialogue
reference and detaches auth callbacks/options. It happens before exam-agent admission after
both hops authenticate, or on every abort path. The browser clears its inputs/answer arrays
after sending. SSH transports, rather than passwords, support additional panes. Immutable JS
strings and transport/runtime copies cannot be guaranteed erased; see [SECURITY.md](../SECURITY.md).

Automatic finalization uses the class agent's committed deadline, initially its individual duration. Instructor resets preserve the immutable original deadline and change the effective deadline through audited versioned operations.
The agent, watchdog and reconciliation CLI share the persisted flock, freeze all recorded
cgroups and verify student-UID writer containment before collecting. A verified directory
descriptor revokes new path access; cgroup freezing handles existing writable descriptors.
Archives, actual file manifests and checksums publish as one durable private bundle. Restart
recovery verifies/adopts a committed bundle before reading work, so a later copy cannot replace
it. The gateway revokes terminal input as soon as finalization starts, closes transports only
after protection to avoid premature hangup/save signals, and verifies manifest
identity and archive transfer checksums, and publishes private local artifacts without
overwriting existing files. Export retries fetch the protected bundle; they do not rerun
collection for an already secured attempt. Monitoring expiry never deletes submissions.

A separate read-only watchdog cutoff pass reads the atomically committed state without
waiting for the archival flock and freezes all expired cgroups, even while an earlier archive
is compressing. It never thaws or changes authoritative metadata. Serialized reconciliation
then finalizes the frozen work. One failed cutoff does not skip other expired attempts; the
same wall-clock/monotonic expiration guard rejects admissions and continuation.

Root class-server access_state is independent of attempt state. Activation commits HELD and
original deadline before material initialization (ACTIVATING); partial activation never frees
the account. Gate admission checks each session/channel before startup, including old SSH
connections; new registration/transport and continuation require an unfinished approved lock.
The local watchdog releases held completed accounts only against verified protected copies
and terminated workloads after both clock boundaries. The gateway keeps an inspected shadow
for its dashboard and never infers release from completion or local time. The root-only CLI's
safe audited override is not a gateway operation. Missing initialized state fails closed.


The independent control API is removed. Non-PTY `exam-control` channels carry exact-byte
Ed25519-signed JSON frames over student SSH. The root socket verifies UID/sshd ancestry,
configured audience, account, expiry, transport and a persistent nonce. Pane capabilities
remain random one-use tokens. Instructor grants stay at the gateway until fresh SSH sign-in.
The independent root watchdog persists collection/status events alongside state, then retries
signed outbound HTTPS callbacks. It never polls for general commands. At an expired local deadline it makes a signed outbound timing check for a pending instructor reset; unreachable timing verification freezes work and defers collection, with bounded retries. Callback event IDs/digests and
per-attempt sequence checkpoints survive webserver restart; stale events cannot reopen a run.
Archive upload receipts bind attempt/checksum, and publication refuses conflicting copies.
Root originals stay on csc-sys. The webserver's timer updates pending UI and detects stale
client contact; it does not issue disconnected collection requests. Administrator stop/recovery
is local through examctl, with the shared gate service separate from deadline supervision.

Recording quotas default to 2048 MiB per attempt at both ends (`terminalRecordingLimitMiB`
webserver / `terminal_recording_limit_mib` agent). They count on-disk NDJSON, including Base64
and metadata, across all panes and restarts. Root recorders share a flock; gateway retries
count only new bytes. Images and protected submissions are separate budgets.

Migration 007 preserves original deadlines and reset history and stores one outstanding reset
intent per attempt. Resets set an absolute deadline from the instructor's server timestamp,
never from retry time. Connected commands use retained student SSH and signed receipts;
disconnected changes arrive through `/api/agent/timing`, signed in both directions and bound
to nonce/agent/attempt/revision/deadline. The agent freezes first, persists a new deadline or
collection permission, and never waits on HTTP while holding the state lock. Cutoff uses a
separate timing flock to avoid freezing a superseded deadline during a reset. Unavailable
verification means collection pending, never submission secured. Ordinary access remains held
until max(original deadline, current deadline), protected collection and verified termination.
Dashboard roster/presence is attempt-specific; countdown uses server time and refreshes each second.

Migration 008 stores `focus_lost_at` from the server's first received blur report. Heartbeat
readiness permits focus=false only; Begin/Continue still require focus. Focus return before
20 seconds clears the warning and stored interval without changing clock/SSH/generation;
late returns and repeated blur reports cannot extend it. The server timer independently locks
expired focus grace. Resume clears the old interval. Network/capture/fullscreen/visibility
rules remain separate, and monitoring continues throughout the focus grace.
