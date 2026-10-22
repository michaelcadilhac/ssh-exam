# Deferred IO across a temporary freeze: unqualified

October 22, 2026. Investigation only, not a completed C3/heartbeat fix or a
deployment receipt. Do not enable retained mode from these results. Nothing
below changes a kernel, syscall policy, installed service, attempt or deadline.

## Reproduction and acceptance

The existing guarded disposable-overlay runner exposes `--profile
monitoring-async-io`. Its manifested static `asyncio-probe` is an unprivileged C
test workload using Linux UAPI, not a production command or dependency on
liburing. It refuses root. The parent is a compiled Go test, requires the exact
private nspawn/input/output/guard markers and uses only newly owned scopes,
files, a private pipe and PTY. The host idle guard and unchanged host/base proof
remain mandatory; see [isolated qualification](isolated-native-qualification.md).

Each of three repeats compares twelve cases: pending pipe read linked to a
one-byte file write (basic and SQPOLL, ordinary and forced-worker dispatch), and
a two-second BOOTTIME timeout hard-linked to a write (basic and SQPOLL ordinary
dispatch), each unfrozen then frozen. Shared-ring accesses use C11 acquire/release
ordering. Readiness requires both submissions consumed and neither completion
observed. Every baseline must succeed before its paired freeze can be interpreted.

For a frozen case, confirm actual cgroup freeze and UID-tuple containment before
triggering the pipe or letting the timer expire. Observe the synthetic output
throughout the hold and recheck `cgroup.events` frozen1. Only then thaw that test
scope, collect exact CQEs and verify the original write completed unchanged.
SQ/CQ drop/overflow, absent readiness, inconclusive timer timing, output while
frozen, cancellation or failed resumption are failures, never silently skipped.

## First result: compatibility fails

Kernel signature read-only: `Ubuntu 6.8.0-111.111-generic 6.8.12`;
`kernel.io_uring_disabled` is0. No value was changed. Private evidence:
`/var/tmp/ssh-exam-overlay-h_ruyjs5`. Exact test artifact:
`29712638a5e8842d50cb1a8875235429d44483e378a5898d9ffdb6abfd0d919e`;
static C fixture:
`c27fc71b015be1630a20ab7654903ac4fd70a98d850e5400f7b5dee23bc85a30`.

All eighteen baselines succeed. No file change is observed in eighteen confirmed
frozen cases. However, all twelve ordinary-dispatch frozen cases cancel their
linked WRITE with `-ECANCELED` (-125), leaving the file empty, after the read
succeeds or timeout returns `-ETIME` (-62). All six forced-worker frozen pipe
cases preserve completion. No ring drops/overflows occur. Each repetition has
the same outcome; host/base preservation passes. This is a reproducible
compatibility failure, not proof that all asynchronous effects are contained or
that this caused the earlier production incident.

## Source investigation and controlled next step

The upstream [2024 freezer task-work fix](https://cos.googlesource.com/third_party/kernel/+/840c6def242c53ca96af6c7f74063a91475c5a4a)
runs task work inside the freezer loop. CPU pause alone is therefore not evidence
that every kernel-side asynchronous effect is paused. The actual distro source
and full set of possible operations still require qualification.

The upstream [worker retry fix](https://git.zx2c4.com/linux-rng/commit/io_uring/io-wq.c?id=34c78b8610a9befdcc139d34a7c98365f018026d),
committed December4,2025, documents pending-signal worker creation exhausting
three retries and canceling requests. It changes restartable errors to unlimited
retry, while retaining the EAGAIN bound. This is consistent with this experiment,
not a trace proving its precise cancellation path or a tested kernel-upgrade fix.

A separate opt-in `--profile monitoring-async-io-stopped` experiment first sends
SIGSTOP through the exact, still-unreaped synthetic child's pidfd and confirms
its stopped state, then freezes the scope. It thaws before sending SIGCONT
through the same handle. All original acceptance assertions remain. This tests
one hypothesis only: it is not a closed all-writer admission barrier and does
not establish shell/editor/job-control compatibility. No stop signal is sent to
installed agents, host SSH or student processes. All36 cases pass (18 baselines,
18 frozen) in three repeats,10.25..10.69s each, preserving host/base state:
`/var/tmp/ssh-exam-overlay-_o_1lqf1`. Exact test artifact:
`989c61f83c729cc24d30a4e3b629b904339bb30165b067c366da42514641ff1c`;
the C fixture is unchanged. This narrow success does not certify a general
stop/admission protocol or require a new kernel.

The next `--profile monitoring-editor` fixture exercises an actual interactive
bash/nano terminal, rather than treating a Python string as an editor. It keeps
an original background job deliberately stopped, types an unsaved Nano buffer,
then performs three stop/freeze/old-input-discard/thaw cycles. Only processes
stopped by this experiment are continued, editor before shell. The editor must
retain its foreground process group; the original stopped job must not resume.
The test explicitly saves through Nano's Write Out and exits to the same shell,
checking exact saved bytes and no injected stale text. This is not retained SSH.

Initial editor runs exposed two fixture mistakes, not qualified passes: querying
the slave's foreground pgrp from an unrelated supervisor session (ENOTTY), and
sending Ctrl-J instead of the real Enter/Ctrl-M in Nano's raw prompt. The master
query now has an unfrozen baseline; the input now uses an actual Enter key. No
acceptance assertion was removed. Failed evidence remains
`/var/tmp/ssh-exam-overlay-89qganab` and
`/var/tmp/ssh-exam-overlay-itxet9jo`, with host/base preservation passing. A fresh
editor result is still required. A further mixed run (two passes, one empty save)
is also not qualified: `/var/tmp/ssh-exam-overlay-9gn05_mc`. The fixture now retains
unconsumed terminal output across reads, waits for the actual editor footer and
requires Nano's own cursor report before/after each hold. Terminal echo is not
buffer acknowledgement. Its initial expected position included the newline in
the cursor offset; actual Nano reports24/25 for24 typed bytes and its final
newline. That failed baseline is preserved at
`/var/tmp/ssh-exam-overlay-6i_jb5v0`; no freeze was interpreted from it.

The strengthened editor fixture passes three repeats, nine cycles (0.30..0.44s),
with exact saved bytes, original stopped job and foreground group intact;
host/base preservation passes: `/var/tmp/ssh-exam-overlay-58s5w_5d`. Test artifact:
`0e205925fe9dfb762bcc9726247ba8be68d9fc1f083ea5d0142ab7360c49843d`.
The final ten-repeat editor confirmation passes (0.21..0.43s), thirty cycles,
with host/base preservation: `/var/tmp/ssh-exam-overlay-sk3ag8z7`. The stopped IO
matrix also passes all36 cases on that same exact test artifact (10.25..10.85s
per repeat), preserving host/base state: `/var/tmp/ssh-exam-overlay-ztsu8i3o`.
The final cgroup-only comparison on that same artifact again fails all12 ordinary
frozen linked writes, with24 successful writes (18 baselines plus six forced
frozen cases), no observed file change during freeze, no drops/overflows and
unchanged host/base evidence: `/var/tmp/ssh-exam-overlay-0skckf9p`. Its exit1 is
an unqualified compatibility gate, not hidden or relabeled a passing freeze.
The separate stopped variant does not repair cgroup-only behavior.

Local compatibility passes the full uncached native race/resource/namespace/
compiler/default-size suite (core172.21s/CLI6.13s), static build/vet,30 Python
runner checks, all five opt-in profiles' host-refusal subprocess checks repeated
twenty times under the race detector (1.92s), and default-skip compilation.
The final static C rebuild is hash-identical. These are test-only source changes;
no browser/server runtime was changed or rebuilt. Prior398 application and113
exact-artifact browser checks are separate evidence, not newly rerun claims.

Do not hide failures by restricting io_uring, deleting cases, returning synthetic
success, changing the host kernel or weakening the unchanged-I/O assertion.
Selecting a minimum kernel, a workload-visible stop protocol or a syscall policy
requires concrete evidence and an explicit consequential design decision. Native
input epochs, closed admission, restart/unknown handling, complete monitoring and
actual retained SSH/editor qualification remain prerequisites even if this
particular matrix eventually passes.

The instructor has now been asked whether the eventual retained-mode design may
use application-visible SIGSTOP/SIGCONT while preserving originally stopped jobs,
or should require a separately qualified kernel baseline. That consequential
choice is awaiting a response; no stop-assisted runtime policy is adopted here.
