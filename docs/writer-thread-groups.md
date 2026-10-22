# Surviving thread groups — local correctness fix

October22,2026. The old UID/containment enumerators skip a leader whose /proc
state is Z/X. A real owned synthetic regression confirms the main thread can
exit while another thread retains shared descriptors and continues writing.
Do not assume process/thread death, incomplete /proc views and authentication
loss are equivalent. The old enumerator fails the regression; this is not an
established cause of either reported production incident. Nothing is deployed.

The primary [pthread_exit documentation](https://man7.org/linux/man-pages/man3/pthread_exit.3.html)
states that other threads/resources can survive a main-thread exit. The
[task-directory documentation](https://man7.org/linux/man-pages/man5/proc_pid_task.5.html)
warns that the leader's task view can become unavailable. A default process
[pidfd](https://man7.org/linux/man-pages/man2/pidfd_open.2.html) reports exit only
after the last thread, unlike a thread-specific pidfd. Confirm actual target-
kernel behavior; do not replace uncertain views with a false no-writer result.

The owned synthetic C fixture refuses root, creates one new private output,
exits its main thread, and writes from one remaining thread. It self-expires and
the parent kills/waits only its exact owned child. The regression checks a zombie
leader, live process pidfd and growing file before testing the existing UID
enumerator. The local regression never invokes UID-wide termination on the
developer's UID. Only its exact owned child is signalled, stopped/continued and
reaped; no real account, state, policy or exam is used.

## Candidate behavior and bounds

Writer/ordinary-session observation now opens a process pidfd before a pinned
proc directory, reads the four UID fields through that directory, and checks
the original pidfd after observation. A replaced numeric proc view cannot revive
an exited original handle. Last-thread exit, not leader Z/X, decides that a
group is dead. Ordinary termination retains that exact handle, rechecks the
pinned UID view, and uses pidfd_send_signal without resolving the PID again.
Genuinely dead/unreaped and reaped groups do not block collection forever;
stopped groups remain live. Missing executable/containment views of a live group
are not a no-writer exemption. Valid recorded cgroup containment and existing
strict SSH-entry/restoration exceptions remain; uncertainty refuses verification,
not a student-misconduct finding or permission to restore access.

Status/cgroup reads are bounded to16KiB/128KiB, and at most4096 matching groups
retain two handles each. Read/open/limit/poll uncertainty refuses rather than
inventing an empty inventory. Handles close on partial failures and all exits.
Readiness checks this process's actual pidfd_open/poll and no-signal signal0
operation. Unsupported/denied controls produce a kernel/procfs/security-policy
diagnostic and `examctl health` guidance, never an unsafe numeric-PID fallback.
The required combined API baseline is Linux5.3; the disposable fixture is6.8.
No kernel, syscall policy, installed configuration or service is changed.

This is still the managed-account leader-UID model, NOT an exhaustive inventory
of arbitrary privileged per-thread credential changes, namespace-held references,
kernel deferred IO or work delegated to another identity. Existing closed-admission,
nondelegated cgroup, account and scheduler controls remain prerequisites. Legacy
numeric root-monitor scope attachment is NOT claimed fully PID-race-free by this
change. Full C3 root ownership/admission/epoch/freeze and C4 usage/cleanup proof
remain open. No new retained mode, thaw, credential bypass or cleanup is enabled.

## Qualification

Ten race repeats cover all four UID fields, malformed/duplicate/missing fields,
invalid account IDs, live zombie-leader workers, stopped groups, truly dead
unreaped/reaped groups, closed/oversize/missing views, wrong-account no-signal and
exact pinned termination. Actual per-child seccomp faults deny pidfd_open,
pidfd_send_signal or ppoll and require actionable readiness refusal. Those
filters affect only the owned test child/thread, not parent/host/service policy.

The guarded writer-threads profile adds one static unprivileged C fixture to the
exact manifest. It copies that fixture ONLY into a new root-owned guest test
directory, because the input mount deliberately remains root-private. The initial
permission-failing fixture run is retained as NOT qualified at
/var/tmp/ssh-exam-overlay-fleu3xk5; host/base preservation passed. The corrected
profile passes five repeats at /var/tmp/ssh-exam-overlay-hhcx2a3g. Each checks
positive contained group/freezing, no frozen file growth, collection/restoration
refusal for an outside live worker, ignored cached-PID tampering with another
owned child, exact outside termination, resumed contained peer and fixed deadlines.
The earlier native candidate then passes40 real SSH/PAM/Begin/collection/hold/
watchdog/restart/restoration assertions at /var/tmp/ssh-exam-overlay-91d4m1f3,
including ordinary SSH launch of the worker before Begin. Host/base preservation
passes. This is bounded isolated qualification, not a whole-host capacity claim.

Final readiness-probe candidate writer profile again passes five repeats
0.40/0.17/0.11/0.19/0.11s at /var/tmp/ssh-exam-overlay-zh1yrwdx, preserving
host/base. The final candidate also passes all40 real SSH/PAM/Begin/protection/
hold/watchdog/restart/restoration assertions with host/base preservation at
/var/tmp/ssh-exam-overlay-wdgvovdn. Same-artifact worker isolation passes all11
assertions at /var/tmp/ssh-exam-overlay-dbi52qp6: real collector SIGKILL affects
only its target,23 healthy peer renewals/max0.0833635s, original/new SSH panes and
owners/generation/deadlines unchanged, exact40MiB retry and unchanged restoration
deadlines. Host/base preservation passes. Actual root CLI health/kernel no-swap
refusal/repair cycles pass3.87/2.92/2.90s with unchanged authority and host/base at
/var/tmp/ssh-exam-overlay-zke40le5. Exact final artifacts:

```text
03893d98ebf0ac6fdcd368cfb5334986f6f8bad1110bed3384d3e20e99911669  exam-agent
2b074cf47b06454c0411f087bc2d188e2f42d82ddc38ea576d76bb1dd7bc1fa2  examctl
ee5755ebd79766b779878902ad01aa6c2852ba93b7452d974bc722d6386a7ce9  core-qualification.test
bbf55994168de38738648484220011828b6fd61128980512f5689591502ed8eb  thread-leader-probe
```

All414 application checks/79files pass86.86s. Final full native race/resource/
namespace/compiler/default-size passes core175.114s/CLI8.024s; the preceding full
repeat passes core172.192s/CLI7.358s. Final focused native/denied-kernel/
host-refusal cases pass
ten repeats3.989s;33 Python checks and static build/vet pass. All140 web source/
runtime hashes match the prior113-browser/12.8m qualification exactly; no web
edit/rebuild is part of this increment. This writer correctness milestone is
implemented/tested locally; no broader TODO completion or deployment is claimed.

SIGSTOP also has documented dead-leader terminal caveats, so include this shape
in future C11 freeze qualification; the earlier Bash/Nano controls do not cover it.
