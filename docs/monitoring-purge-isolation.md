# Isolated monitoring purge and durable jobs

October 21, 2026. **Candidate local implementation, not deployed.** C1gb2 connects
manual deletion, 60-day retention and unstarted-preparation cleanup to durable
jobs and isolated workers. No recursive filesystem purge remains in those HTTP/
lifecycle callers. The subsequent C1gb3 increment now supplies shared reviewed/
idempotent web/root deletion intents; see monitoring-cli.md. Full export,
retired-job inventory and broader capacity qualification remain open.

MonitoringPurgeProcess requires a durable tombstone, validates the target and
runs one owned OS child per supervisor instance. A persistent private single-link
0600 monitoring-purge.lock inode also serializes workers across coordinators.
The parent validates a no-follow descriptor, then /usr/bin/flock --no-fork locks
that pinned inode via /proc/self/fd/3 and execs Node. The actual worker retains the
kernel lock until exit, even if its coordinator dies; never unlink/replace the
lock to bypass busy. Conflict refuses without starting another Node worker.
The runtime image explicitly includes util-linux; no production package was
installed. This assumes local filesystem flock semantics, not a distributed/NFS
lease or support for multiple independent gateways. Request/reply bounds are 4/8 KiB,
binding version, target and fresh nonce. Success needs an exact reply plus clean
exit and an independent asynchronous private-root/target-absence check. A forged
successful reply with retained files refuses. Stderr/fatal/private exceptions are discarded; only allowlisted error codes
escape. The child gets no SQL connection, agent key, network config or file bytes.
Environment is minimal, with a 32 MiB **V8 heap** limit and one runtime/threadpool
worker. This is not a hard RSS/cgroup limit or host/container OOM guarantee; size
the eventual aggregate gateway/connection/purge budget separately.

The Linux child pins private root/target directory descriptors with no-follow
opens and ownership/permission checks. A 32-entry buffer iterates only flat
entries; unlink uses the pinned descriptor. Symlinks and FIFOs are unlinked,
never opened/followed; unexpected directories refuse, never recurse into possible
mounts/protected trees. Before removing the empty target, verify the parent entry
still names the pinned inode. Saved work, protected submissions and receipts are
never inputs. Partial progress is possible; retry is idempotent. The worker never
changes tombstones or attempt authority.

An async child self-guard is nine seconds; the parent requests exact-child
SIGKILL at ten seconds. Stdin remains open for coordinator liveness; EOF retires
the child. Shutdown kills only the owned ChildProcess, never a name/PID scan.
Busy refuses overlap and retains its slot until process close. These ordinary
process bounds cannot promise termination of uninterruptible kernel IO or survival
of arbitrary shared OS/storage failures. No fatal catch-and-continue handler.

Seven focused tests pass (about five seconds): cross-coordinator busy/death/retry,
private lock inode persistence and redirected/shared/public/FIFO lock refusals;
actual SIGKILL/uncaught exception,
heap exhaustion, hang/timeout, wrong/oversized replies, success-then-failed exit;
unknown fields and well-formed forged success are also refused;
permission denial/retry; redirected roots/targets, subdirectory and real FIFO;
tombstone/busy/shutdown scope, protected bytes and healthy retry. Parent pulses
continue during faults. The lock follow-up passed full app 334/59 (66.3s),
typecheck/build; its browser assets were unchanged. A later path-normalization
repeat caught a Promise resolver/path-helper name collision before qualification;
the helper is now unambiguously named and real success/forged-success tests pass.
No production purge child has been launched.

## Durable scheduling and operator status

Migration 017 adds metadata-only monitoring_purges without an attempt foreign key:
retiring a confirmed cancelled preparation does not retire its deletion job.
Logical deletion atomically preserves the first tombstone time, scrubs monitoring
rows/text and enqueues; a failed enqueue rolls the entire transaction back. It
does no filesystem IO. Callbacks/replay/media remain tombstone-fenced immediately.
No old clock, original hold, protected submission or receipt is changed.

One scheduler launches at most one owned worker. Restart requeues unconfirmed
running claims; a surviving old worker keeps its kernel lock, and owner UUIDs
fence late replies. Worker/DB result failures leave durable retry metadata, never
an erasure receipt. Result-write failure is retried by that exact coordinator
claim on the next pass; it cannot overwrite a newer owner. Stable error codes
and redacted diagnostics contain no media, exception paths or worker stderr.
Busy retries after five seconds; other failures back off from ten seconds up to
one hour. The regular scheduler ticks once per second; retention/backfill batches
are at most 100 rows, with an indexed ledger cursor advanced only after commit.
Old ended attempts are tombstoned after the unchanged 60 days; a backlog continues
in bounded batches. No grace or automatic workspace/submission deletion is added.

`examctl web monitoring show ATTEMPT` and web review expose pending/running/retry/
verified-absent status, timestamps and safe retry guidance. Logical deletion is
not physical completion. Verified-absent means only that the current private
monitoring directory was absent at that timestamp, not secure disk erasure or
removal from backups/mail/audit. Successful jobs are rechecked hourly so restored
orphan files do not remain merely because an old job was marked done. Keep the
entire ledger and job table in consistent backups; never erase or replace locks
to bypass a failure. Fix permissions/capacity through normal operator procedures;
automatic retry resumes. Unexpected nested directories fail closed, not recursive
traversal. Retired-attempt job inventory CLI and shared manual retry remain open.

Focused tests cover real SQLite reopen, retired rows, transaction rollback,
backfill bounds, first timestamp, failed result writes and stale live-worker
ownership. Real HTTP/session + SSH/PTY + signed-control traffic survives nine
actual worker faults; a new pane remains usable and original healthy authority/
protected bytes remain unchanged. Older synchronous HTTP test assumptions and
synthetic hold/pane IDs were corrected before passing; no safeguards were relaxed.
Full app/CLI-TLS/typecheck/build/browser repeats are tracked in todo-progress.md.
Final C1gb2 repeat: 341 app tests/61 files (72.0s), actual compiled CLI/TLS status,
typecheck/build and all 28 administrator/monitoring browser checks (2.0m) pass.
Native race compatibility passes (CLI 3.3s; unchanged core cache). The broader
81-browser result predates the changed status UI; it is not a fresh combined run.

Runtime needs Linux/procfs and /usr/bin/flock (util-linux, explicit in Dockerfile
and doctor). Missing runtime fails purge closed; there is no synchronous fallback.
Do not downgrade to recursive synchronous deletion during active exams. Preserve
017, jobs and tombstones across a future separately authorized drained rollback;
an old gateway loses isolation/status and can block on IO. No migration, rollout
or temporary-agent consolidation has been executed.
