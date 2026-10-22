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
