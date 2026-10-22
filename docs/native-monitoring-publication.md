# Native monitoring publication: next local increment

October22. In progress, not a live lease journal or enabled runtime workflow.
Nothing here deploys units or consolidates temporary agents.

The authority arbiter must not perform storage IO. The proposed tiny publisher
uses an independent bounded scope/pool, not collection/template slots or a
PTY-owning agent. It writes **provisional metadata only**: no attempt state,
deadline, account policy, submission, key, signed receipt or positive authority
can be restored from this file. The live arbiter alone accepts a current,
scope/hash-matched completion within its original cutoff.

The persistent attempt claim must survive coordinator death while a publisher
still has the inherited open-file description. Explicit LOCK_UN would release
that shared lock prematurely; close each holder instead. The private claim
candidate's actual subprocess/SIGKILL tests cover this boundary and unsafe
link/FIFO/mode/target refusals. It is not an SSH peer or ACTIVE-state verifier.

Do not assume an ordinary systemd transient service inherits arbitrary caller
descriptors. The selected next candidate uses `systemd-run --scope`, which runs
the command in the caller's execution environment rather than spawning it from
the manager ([systemd-run documentation](https://www.freedesktop.org/software/systemd/man/latest/systemd-run.html)).
Require actual inherited-descriptor tests on the supported target. A scope can
have its own runtime, OOM and resource bounds
([scope documentation](https://www.freedesktop.org/software/systemd/man/latest/systemd.scope.html));
require compatible systemd rather than silently dropping unsupported properties.

Before any live caller: bound one publisher per attempt and global capacity;
retain scope/attempt claims until every child exits; enforce memory/tasks/runtime
separately from trusted supervisors; bound IPC and strictly validate replies;
test actual process death, deadline, storage and late completion. A timeout cannot
become a misconduct finding or refresh authority. A stuck child must not block the
arbiter's cutoff. Publication and original receipts remain distinct from verified
all-writer freeze/input-discard/held recovery. Those coordinated prerequisites,
CLI/web diagnostics and privileged end-to-end qualification remain open.

## October22 local candidate and outstanding authority choice

The private publisher now has strict bounded request/reply metadata, pinned
private storage, immutable copied ticket bytes and atomic provisional publication.
Root-only worker entries in the ordinary binaries run without Engine/config/key
initialization. The parent checks its own protected executable inode and ancestors,
inherits attempt/global-slot/per-attempt-publisher claims, and discards worker
stderr. One ticket starts at most one child; a duplicate must not retire the
original pending publication. Two global slots and a separate 64MiB/16-task/2s
scope per worker bound failure. The proposed aggregate slice is256MiB/64tasks,
with headroom; nothing installs or starts it. A timeout returns without awaiting
an uninterruptible child; inherited locks remain held until it really exits.

Actual local subprocess SIGKILL/panic/exit, malformed replies, independent healthy
publication/cutoff and root-mapped compiled examctl/agent checks pass. Actual user
scopes preserve all three inherited claims and enforce memory.max64MiB,
swap.max0, pids.max16, oom.group1, OOM-kill and runtime-timeout. Tiny disposable
user/mount namespaces exercise real ENOSPC and a read-only bind view while
preserving protected synthetic bytes and the underlying host fixture. Existing
writable claims make remounting their own mount read-only EBUSY; the fixture uses
a fresh view rather than dropping ownership. These are not normal-root system-
manager/SSH/PAM/cgroup containment or production-capacity claims.

Removing the one-worker CAS made the concurrent-retry regression RED: the second
call retired the original pending operation. The mutant is removed. Test child
commands alone disable the race runtime's synthetic one-second exit delay; the
production two-second bound is unchanged. Full qualification is in todo-progress.md.

Frozen qualification passes: full native race/resource/namespace/compiler/default-
size (core170.74s/CLI8.31s), all383 application tests (80.35s), twenty process/unit
race repeats (15.19s), static build/vet/typecheck, slice verification and774 bounded
fuzz executions (11.01s). The existing parent exam.slice has a local systemd
CPUAccounting-deprecation warning; no new publisher-unit error. Exact browser
assets remain unchanged from H4a's91-check run; no rebuild or client import.

**Consequential choice asked, not yet answered:** mandatory disk sync on every
renewal can still create a technical hold during a storage stall despite complete
fresh monitoring. Recommended split: active renewals commit in the current
verified native actor without waiting for storage; deadlines, grants, owner/epoch
transitions and audit remain durable, and restart never restores positive work
permission from disk. Verified freeze/recovery remains mandatory. The alternative
is durable-per-renewal commit with its explicit availability cost. Do not enable
either incomplete model or quietly relax the15s evidence bound. The existing
private arbiter still models publication-before-acceptance pending this choice;
this worker can serve durable transitions regardless of the renewal choice.

Before wiring, also supply fair bounded scheduling/coalescing across owners and
measured admission capacity. Two nonblocking flock slots alone are not a fair
renewal scheduler: synchronized clients could repeatedly lose to the same winners.
Do not turn slot contention into a violation, invent a new allowance on dequeue,
or claim supported class size from these narrow process tests. All-writer freeze,
gate/epoch registration, actual peer ownership, CLI/web diagnostics and combined
retained-mode qualification remain open.
