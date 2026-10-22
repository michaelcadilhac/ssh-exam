# Disposable native freeze and PTY qualification

October22. Test-only C3 prerequisite, not deployed or enabled as a runtime mode.
This composes existing root cgroup/UID inspection with the unused local input
controller and pinned PTY discard. It creates no native attempt, grant, execution
lease or ACTIVE seal and changes no installed host service/configuration/record.

## Exact scope

Use the isolated runner's discoverable `--profile monitoring-freeze` with its exact
manifest and static core-qualification.test binary. The same nspawn/private-mount/
input-marker/exact-synthetic-account guard used by Q3 runs before any effects.
The profile does not replace a gate socket or stop its guest agent. Every workload
scope/file/UID is an owned fixture inside the disposable guest. Continuous host
idle checks, bounded resources and installed/base preservation still apply.

The root fixture owns an explicitly nonblocking PTY master, its pinned actual
slave and the controller outside a nondelegated exam.slice scope. The scope drops
all UID/GID/capabilities before running the guest's actual Python with an in-memory
string and a forked periodic file writer. The synthetic values are not an actual
editor or authenticated student shell. Scope resources are64MiB/no swap/16tasks/
30s inside the aggregate-bounded private guest.

Each test performs three complete cycles:

1. Confirm actual cgroup freeze and full UID-tuple containment; the descendant's
   file size must remain unchanged while frozen.
2. Put actual old bytes in the stopped reader's kernel PTY queue, revoke/drain
   the local controller and confirm pinned input discard. This deliberately models
   delivery completing before drain; it is not a live native admission protocol.
3. Arm a different synthetic local epoch under the same original cutoff/deadline;
   late old-epoch frames refuse. Thaw only this test scope and require exclusively
   FRESH input, the same in-memory value/PIDs and still-live exact pidfds.
4. Require the background writer to resume. No synthetic current/original deadline
   or attempt state may change. An owned extra same-UID process outside the recorded
   scope must make writer verification refuse.

Cleanup revokes the local gate and kills/stops only its unique owned test scope
and owned uncontained child, then removes its exact newly created guest fixture.
No process-name kill, host account cleanup or existing workspace deletion occurs.

## Evidence and limitations

The first run passes five repeats (0.56..0.80s),15 cycles. A deliberate TEST-ONLY
skipped-discard mutant then fails all five: the thawed reader receives STALE
instead of FRESH. That failed run still passes host/base preservation; evidence
/var/tmp/ssh-exam-overlay-xckp4pge. The mutant is removed; no runtime product
source was mutated.

Adding an IO-availability observation exposed a fixture ordering error: Python
forked after creating kernel IO helpers and emitted a multi-threaded-fork warning.
That run was not counted as qualified. The child is now forked before that probe;
no diagnostic is filtered. Final Q4 passes five repeats (0.54..0.72s),15 cycles,
on kernel6.8.0-111-generic, with successful host/base preservation. Evidence:
/var/tmp/ssh-exam-overlay-3u8w6mlt. Exact test artifact SHA256:
5ca1c283f4120f52abb638c817065ce7b4cd938a48cfc36e962f3beb4aacf7ba.
The shared-validator Q3 actual-SSH test also passes five repetitions on that
same artifact (0.23..0.35s), with host/base preservation evidence at
/var/tmp/ssh-exam-overlay-ue_wdjrm.
Candidate agent SHA256 remains
336acee1c34c661533d48e3de225fb70c3bdad36a3a6ab7adbefe814eac6bfcf.

Both basic and SQPOLL io_uring setup return errno0 as the dropped synthetic UID.
These empty setup/close probes establish **availability only**, not asynchronous
IO freeze behavior. No syscall is disabled/restricted and no kernel policy is
changed. Deferred IO, mmap/delayed writes and relevant worker/completion paths
need explicit qualification before all-writer containment can be claimed.
Q5 now finds a reproducible cgroup-only linked-write cancellation and separately
qualifies a narrow stop-before-freeze IO/editor experiment. See
native-async-io-investigation.md; do not infer a completed general barrier or
quietly disable the available syscall.

Local compatibility passes the full native race/resource/namespace/compiler/
default-size suite (core171.16s/CLI5.92s), static build/vet,27 Python safety tests
and20 negative host-guard race repeats (1.20s). The actual guest test is static,
not race-instrumented. Browser artifacts remain those of the separately qualified
113-check queued-input milestone; no browser import or rebuild occurs here.

This is not closed native admission, root page/pane epoch registration, durable
cross-process ownership/authority transitions, real editor/retained SSH survival,
technical-hold recovery or independent deadline integration. No capability enables
C3 and no legacy pause/termination behavior is removed. The critical TODO remains
open. Kernel confirmation alone also cannot authorize thaw or review recovery.

## Kernel contract used for investigation

The kernel's [cgroup-v2 interface](https://www.kernel.org/doc/html/v6.8/admin-guide/cgroup-v2.html)
requires completion confirmation, not merely a successful freeze-file write;
privileged task migrations remain possible and need closed native admission.
The v6.8 [freezer implementation](https://github.com/torvalds/linux/blob/v6.8/kernel/cgroup/freezer.c)
tracks task/descendant frozen counts. Its kernel-thread exception must not be
blindly applied to every IO helper: [IO thread creation](https://github.com/torvalds/linux/blob/v6.8/kernel/fork.c),
[SQPOLL](https://github.com/torvalds/linux/blob/v6.8/io_uring/sqpoll.c) and
[IO workers](https://github.com/torvalds/linux/blob/v6.8/io_uring/io-wq.c) have distinct
user-worker/signal paths. This is source-guided investigation, not proof that all
deferred filesystem effects stop or that such IO caused the production incident.
The exact distribution-patched kernel still needs the behavioral fault matrix.
