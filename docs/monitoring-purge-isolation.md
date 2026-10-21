# Monitoring purge process foundation — not yet wired

October 21, 2026. Local internal implementation/tests only; **not deployed and
not connected to production deletion/retention callers yet**. Monitoring.delete
and hourly cleanup still perform their existing synchronous purge. This boundary
does not complete C1gb, expose a new CLI workflow or fix blocking until durable
scheduling/shared interfaces are implemented and qualified.

MonitoringPurgeProcess requires a durable tombstone, validates the target and
runs one owned OS child per supervisor instance. Request/reply bounds are 4/8 KiB,
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

Five focused tests pass (about five seconds): actual SIGKILL/uncaught exception,
heap exhaustion, hang/timeout, wrong/oversized replies, success-then-failed exit;
unknown fields and well-formed forged success are also refused;
permission denial/retry; redirected roots/targets, subdirectory and real FIFO;
tombstone/busy/shutdown scope, protected bytes and healthy retry. Parent pulses
continue during faults. This is not real gateway SSH/CLI/job qualification.
Typecheck/build pass; full working-tree app suite passes 332/59 (66.4s), including
these five tests. Unchanged browser assets have C1ga's combined 81-check evidence.
No production purge child is launched.

Next: durable metadata-only jobs/restart claims/status, atomic logical deletion
and enqueue, bounded backlog/retry/backoff, remove all production/preflight/
retirement synchronous purge callers, and shared explicitly reviewed/audited/
idempotent web/examctl deletion with honest pending-versus-physical-complete status.
Jobs must survive deleted cancelled-preflight rows, like tombstones; no attempt
foreign-key cascade. Test actual gateway/healthy SSH during fatal/hung purge,
coordinator restart/lost reply, storage faults, stale confirmation and unchanged
protected history/holds. No grace, retention, account or clock policy change.
