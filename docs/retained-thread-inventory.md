# Retained-workload thread inventory — R1a local groundwork

October22,2026. Private unused C11 reader, not a writer-stop/freeze/hold receipt,
live retained-SSH mode or deployed change. The dependency plan is in
retained-workload-barrier-plan.md; the critical TODO remains open.

The next barrier cannot rely on leader state or a leader's task-directory listing:
an actual owned C fixture leaves its main thread Z while a surviving thread keeps
writing. The existing group pidfd correction already refuses to call that group
dead. R1a now supplies bounded direct cgroup thread membership through a pinned
real kernel cgroup2 directory, so the barrier can investigate every actual task.

The reader verifies cgroup2 filesystem and directory type while retaining the
descriptor, opens only `cgroup.threads` with no-follow/nonblocking/close-on-exec,
checks the opened kernel filesystem/type and reads at most49153 bytes. Decode
accepts at most4096 unique positive canonical32-bit IDs with a complete final
newline; malformed/partial/duplicate/oversized data refuses. Results are sorted.
It never writes controls, follows a caller path, repairs permissions or accepts
valid-looking ordinary text/FIFO as kernel membership. Closing or missing handles
is uncertainty, not an empty inventory.

This is **direct membership only**, not recursive descendant enumeration or a
globally atomic snapshot. Even an empty valid observation cannot prove a pending
launch will never appear. The eventual root caller must separately establish
scope ownership/identity, descendant/closed-admission coverage, per-task pinned
group/UID/start-time identity, current lifetime and verified stopped/frozen state.
Do not require newer thread-pidfd APIs or ignore dead-leader workers/unknown
views. No production authority factory or barrier uses this helper yet.

## Local evidence and remaining gates

Twenty final race repeats pass3.055s across canonical/bounded parsing, nil/closed/
fake kernel views and an actual owned user-manager scope with a live worker after
main-thread exit. The fixture compiles the existing known C probe, requires an
unprivileged developer and explicit compiler/user-systemd opt-ins, self-expires,
and has64MiB/swap0/16-task/10s controls. Cleanup targets only its exact new child
and scope; never signal or terminate the developer's UID. The actual surviving
TID remains in the pinned kernel inventory; the parent test is absent.
Two-worker bounded parser fuzz passes94815 executions10.069s. Static build/vet
pass; full native race/resource/namespace/compiler/default-size passes
core269.086s/CLI25.771s and all426 application tests in80 files pass93.15s.
All35 Python checks pass. Nine fresh browser/WASM SSH checks pass1.1m; all174
browser source/runtime hashes still match the frozen baseline.

Further R1b work must bracket task status/stat through retained proc descriptors,
validate canonical PID/TGID/all four UID values/start time against the live group
pidfd, and refuse unstable views. Stop facts must cover dead leaders, actual exit,
changed/reused threads, denied/closed handles and originally stopped/trace jobs.
Then combine with R2 closed launches, authenticated per-pane registration and R4
stop/freeze/input-discard; membership alone must never authorize thaw or cleanup.
Normal-root/hardened exact-artifact qualification remains idle-guard gated on
csc-sys; this reader has not been uploaded or installed. No deployment/signals on
production or temporary-agent consolidation is authorized/executed.

R1b is now a separate unused candidate under local qualification; see
retained-task-observations.md. It does not convert direct membership into a
complete scope/descendant/admission or freeze receipt.
