# Collection limits and storage — local implementation

October 21, 2026. Implemented/tested locally; **not deployed**. Final browser
interface regression is recorded in todo-progress.md; release gates remain open.
Do not execute a storage migration, service change or cleanup from this document.

## Policy and supported configuration

C6 intentionally changes new attempt defaults to **128 MiB per regular file and
512 MiB total logical regular-file contents**. One MiB is 1,048,576 bytes. Sparse
files count by logical length, not allocated blocks; compression does not reduce
the allowance. The 10,000-entry traversal limit (including directories) and depth
32 stay unchanged. Monitoring quotas and live workspace disk quotas are separate.
An exceeded limit fails collection without publishing a partial success or
silently dropping an answer; preserve the failed work and account restrictions.

Web exam settings and root CLI use the same revision-checked validation/audit:

```sh
sudo examctl web exams show midterm
sudo examctl web exams update midterm --revision HASH-FROM-SHOW --collection-file-mib 256 --collection-total-mib 1024 --reason 'Approved future artifact allowance'
```

`examctl web help` explains both flags, units, defaults and consequences. Integer
configuration ranges are 1..4096 MiB/file and 1..16384 MiB total, with total at
least per-file. These validation ceilings are **not qualified workload sizes**.
Larger allowances do not increase the 256 MiB/120-second worker bounds or reserve
disk space. Qualify actual course/compiler/debugger work, storage and concurrent
cutoffs before using any allowance in production. Sandbox keeps its fixed
five-minute/webcam/terminal policy but permits the same collection configuration.

## Immutable settings and historical compatibility

New preflight preparations explicitly snapshot both settings. Editing defaults
does not alter an existing preparation, started clock, hold, receipt or submission.
Current unified initial/additional/practice grants snapshot them at issuance;
saved-source/legacy grant migration remains open. Legacy snapshots with both
fields absent/zero retain **32/64 MiB**, not the
new defaults. Newly added zero-valued native scalar fields are omitted from JSON
so old private workspace settings hashes remain byte-compatible. Partially
specified or invalid native pairs fail closed. The matching gateway requires
`collection-limits-v1`; an old agent cannot quietly collect under old ceilings.

Collector, private template copy, protected verification and saved-work restore
use the immutable limits. A saved source must satisfy its own snapshot and its
separate target's snapshot. If a valid source exceeds the selected target, staging
refuses before Begin without consuming time/allowance or marking the source
corrupt. Select a compatible unused target explicitly; never rewrite a protected
source or reopen a completed attempt. Archive verification now permits compressed
size up to snapshot total plus 64 MiB metadata/compression overhead (legacy stays
128 MiB). This is not an additional logical-file allowance. Directory enumeration
is bounded before allocation; unsafe traversal rules remain enforced.

## Persistent storage and failure isolation

The real 512 MiB incompressible workload exposed a tmpfs-specific OOM: protected
output pages count against the writing worker's 256 MiB cgroup even though the
application streams its data. Two local tmpfs runs were killed at MemoryPeak
268,435,456 bytes. The shared process remained alive; the test did not qualify
tmpfs capacity. New production admission now refuses tmpfs/ramfs for configured
protected-state or workspace storage, with preserve/drained-migration guidance.
It does not move/delete existing data or disable recovery/collection of old work.
Rejecting known memory-backed filesystems does not certify the durability or
capacity of every other filesystem. Operators must independently verify durable
storage, backups, mount layout, free space and worst-case disk I/O/backlog.

Workers retain the existing per-process and aggregate systemd limits; do not
raise or remove them to hide an OOM. See collection-worker-isolation.md. Source,
archive, restored copy, private stages and backups can coexist; 512 MiB logical
allowance is not a 512 MiB storage reservation. Shared disks can still introduce
I/O latency, and real privileged SSH/PAM/PTYS plus simultaneous worst-case jobs
remain release gates. A bounded worker failure must retain recoverable work and
must not turn a failed collection into global monitoring loss.

## Reproducible local verification

Normal tests cover exact/exceeded logical limits, frozen identity/legacy encoding,
target/source mismatch before Begin and unchanged clocks/history. The real GCC
fixture retains both a roughly 40 MiB object and executable (about 84 MB total):
the legacy snapshot refuses without publishing; the new snapshot protects and
verifies all three files. Enable with `EXAM_COMPILER_WORKLOADS=1`.

For the real default-size test, select an existing private owned **disk-backed
synthetic scratch directory**, not a production path. The helper creates/removes
only fresh random children. Require at least 3 GiB free; a skip is not evidence.
From ssh-server, run the following as one command:

```sh
EXAM_COLLECTION_TEST_ROOT=/absolute/private/disk-test-scratch EXAM_LARGE_COLLECTION=1 go test -race ./internal/core -run '^TestLargeCollectionAndRestoreUserSystemd$' -count=1 -v
```

It runs four high-entropy 128 MiB files through actual user-systemd workers with
the unchanged 256 MiB/no-swap/32-task/120-second bounds, verifies the archive over
512 MiB and then restores a separate private copy with exact hashes. Concurrent
signed healthy renewals run in both phases, fresh registration is exercised, and
healthy generation/deadline plus unconsumed target are checked. A three-second
renewal budget is well below the 15-second enforcement lease; separate blocked-
lock regressions retain their sub-second checks. Actual live kernel memory/swap/
PID/group-OOM controls, peak observations and final unit results are checked.
Privileged writer hooks are explicitly fake:
this is real I/O/resource/process qualification, not installed root/PAM/PTYS proof.
Fixture creation is flushed before measurement, and test services do not use
RemainAfterExit (which would prevent systemd-run --wait from completing).

October22 also adds two simultaneous default-ceiling sources/collectors, exact
byte protection and live two-worker controls while a healthy signed renewal,
inspection, new registration and pane-capability issue/close remain usable.
Three final local race repeats pass116.594s. The three earlier subsecond signed-
inspection failures and traced fsync/rename delay are retained; the final test
uses the pre-existing3s durable-IO budget and a separate1s no-write diagnostic
bound. This changes a benchmark criterion, not runtime authority/timeouts or
resource bounds, and does not close critical liveness/C10. See
concurrent-collection-latency.md for all measurements and remaining privileged/
course-specific/capacity gates.

October21 measurement correction: a full repeat completed collection/restore
successfully but reported a peak of268,439,552 bytes, one4KiB page above the
configured268,435,456-byte limit. Linux explicitly permits transient usage above
memory.max; memory.peak records observed usage, not the configured ceiling. See
the [kernel memory controller specification](https://docs.kernel.org/admin-guide/cgroup-v2.html).
The test now requires actual live memory.max=268435456, memory.swap.max=0,
pids.max=32 and memory.oom.group=1 from that owned test service's cgroup, plus
finite positive peak observations and successful byte-verified collection/restore.
Unavailable/unbounded/altered controls fail; no arbitrary peak tolerance or higher
worker limit is introduced. Separate actual OOM/runtime-failure regressions remain
required. This changes a measurement assertion, not production resource policy;
peak/RSS and whole-host headroom must not be advertised as exact mathematical
guarantees. The initial failed run is not counted as a full pass.
The strengthened focused512MiB collection/restore repeat passes (37.2s), with
byte-exact hashes, healthy signed renewals and observed live controls in both
workers; a fresh full native race/resource/namespace/compiler/default-size run
then passes (core118.8s, CLI3.2s). No production service/configuration changed.

Final local evidence: 306 application tests/53 files, all three Go race suites,
native fault/systemd/namespace/CLI/compiler/default-size opt-ins, CGO-free build,
vet/typecheck/application build and 68 selected browser/interface/real synthetic
SSH checks pass. See todo-progress.md for timing and remaining release gates.
