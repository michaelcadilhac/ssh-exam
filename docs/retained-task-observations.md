# Retained-workload task identity and stop observations — R1b candidate

October22,2026. Private unused C11 groundwork following R1a commitd1b26d1.
Not a whole-group/UID freeze, closed admission, retained mode, cleanup permit or
deployed change. Current runtime lockout behavior is unchanged.

R1a supplies bounded direct cgroup thread IDs, including a surviving worker after
main-thread exit. R1b now reads each requested thread through a retained proc
directory, brackets it with the original group pidfd's positive lifetime and
group status, and compares both task snapshots' exact PID/TGID, all four UID
values and start ticks. Group identity/UID must remain unchanged. The numeric
thread directory is opened once, not resolved again between reads; a stale view
cannot silently become a reused task. No newer thread-pidfd kernel requirement,
numeric-PID signal fallback or executable-name exception is introduced.

Pinned proc directory/opened-file filesystem/type checks reject ordinary file
substitutes; only status/stat leaves are readable, with no-follow/nonblocking/
close-on-exec and16KiB/4KiB bounds. Canonical positive32-bit PID/TGID, four valid
UIDs, known distinct kernel states and positive64-bit start ticks are required.
Duplicate/missing/malformed/oversized/mismatched metadata refuses with a static
error, not private names or task payload. Close/missing/live-view uncertainty is
not an empty/stopped observation. Actual kernel UID transitions must be reviewed,
never explained away because one UID component still matches the student.

The result retains all four observed status/stat states rather than conflating
T (job stop), t (tracing stop), Z (individual zombie) or D (uninterruptible).
The group pidfd reports whole-group exit; one missing thread does not establish
group death. The caller must compare the retained identity across later phases,
recheck complete cgroup/descendant membership and establish closed launch/input
admission. These snapshots alone prove neither continuous quiescence nor that no
new thread/writer can appear. They send no signals and cannot authorize thaw.

## Local qualification so far

Initial ten race repeats pass2.006s. The actual owned user-scope/dead-leader fixture
now verifies the live worker's exact identity and all UID values, wrong-account
and other-group refusal, observed T states after signalling only its own pinned
group, preserved identity through its own continuation, and closed-group refusal.
Removing the expected-UID check makes that actual test RED0.109s; the mutant is
restored immediately in a finally block and is not part of the candidate.

The individual-thread-exit fixture initially could select the Go test process's
main kernel thread, leaving its leader visible instead of the intended vanished
worker (the first20-repeat run fails4.151s). It now explicitly retains that main
thread if selected and terminates only a different owned locked test thread.
No host process, account-wide signal or production state is involved. Twenty
corrected combined race repeats pass3.173s, including individual exit while the
original group remains alive, wrong-group/UID/closed views, parser bounds and
the real controlled stop/continue fixture. Two-worker metadata fuzz passes88319
executions11.017s. Full native race/resource/namespace/compiler/default-size
passes core286.609s/CLI27.791s; all426 application tests in80 files pass96.14s,
static build/vet and35 Python checks pass. All174 browser source/runtime hashes
remain unchanged from the fresh nine-check/1.1m R1a browser/WASM SSH run.

Root-normal hardened/privileged and arbitrary privileged per-thread credential
transition qualification remain open. These local synthetic cases are not actual
current-SSH/epoch/whole-writer or all-input proof. Full supervisor topology is
asked, not assumed, and normal-root qualification remains gated on csc-sys idle
eligibility (BUSY at18:36UTC). Nothing was uploaded, installed, deployed or
consolidated. See retained-workload-barrier-plan.md for dependent milestones.
