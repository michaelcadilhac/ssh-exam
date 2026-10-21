# October 20 local qualification and remaining limits

All results below use synthetic local accounts and temporary storage. Nothing in
this report is a production deployment, capacity certification or real cgroup/
PAM/institutional MFA signoff. Historical production receipts are unchanged.

## Concurrent deadlines, cleanup and delayed callbacks

`TestConcurrentDeadlinesSlowCleanupAndCallbackBacklog` runs 16 native attempts:
12 healthy signed renewals, four simultaneous expired attempts, four real 4 MiB
incompressible protected archives, one blocked termination followed by an injected
termination refusal, and a deliberately stalled signed TLS callback. Privileged
writer freeze/termination is replaced by explicit test hooks only.

An observed race-enabled run measured maximum signed renewal acknowledgement
28.4 ms, maximum acknowledged lease age 515 ms, independent four-attempt cutoff
pass 4.5 ms, and shared inspection wait 511 ms. The injected wait is deliberate;
these values are observations, not performance service levels. All healthy
attempts remained ACTIVE. All four protected bundles verified, including the one
whose termination remained failed. Twenty-eight queued callback events drained
in sequence after delivery resumed and an engine restart, without replay or loss.

Important unresolved bottleneck: `Tick`/`finalize` still hold the shared state
lock during compression and termination. Regular inspection, admission, pending
timing and callback state transactions can wait, unlike independent signed
renewal and cutoff. This test demonstrates the wait rather than concealing it.
The next isolation design needs per-attempt operation locks, short durable
transition/publication transactions, version fences and a safe policy-lock order;
it must not simply move collection outside the lock without writer/source fences.
Qualify hung real systemd scopes, new admissions/reconnects, large backlogs and
process death together on a disposable privileged host before claiming completion.

Reproduce from `ssh-server`: `go test -race ./... -run
TestConcurrentDeadlinesSlowCleanupAndCallbackBacklog -count=1 -v` (one command).

## Application/SSH/media load

`tests/load.ts` now reports monitoring heartbeat acknowledgement percentiles,
uses a bounded acknowledgement drain, permits `LOAD_REPORT` without replacing the
historical report, and fails if students do not remain active or acknowledgements
are missing. Its older fixture lacked signed account resolution; the first run
correctly failed. The fixture now implements that existing identity workflow;
production identity checks were not changed or bypassed.

Passing command: `LOAD_STUDENTS=16 LOAD_SECONDS=10
LOAD_REPORT=/tmp/ssh-exam-load-20261020.json npm run test:load` (one command).
On a 12-thread i7-8700 / 16.5 GB Linux development host, 16 students kept 64 panes
and two capture streams each. All 16 remained ACTIVE with zero errors, 89
acknowledged heartbeats across all 16 students and no pending heartbeats/uploads
after drain. Observed heartbeat p50/p95/p99 were 257/690/761 ms; HTTP p95/p99 were
559/584 ms. Setup plus the ten-second steady run/drain took 18.0 s. This uses simulated privileged control and small
800×450 JPEGs; it is not a 100-student or native enforcement qualification.
The older tracked load-report.json remains an explicitly historical measurement.

## Compiler output versus collection limits

Current hard-coded limits remain 32 MiB/file, 64 MiB total logical bytes, 10,000
entries (including directories), and nesting depth 32. Recording quota is separate.
Opt-in `EXAM_COMPILER_WORKLOADS=1 go test -race ./internal/core -run
TestSyntheticCompilerCollectionWorkloads -count=1 -v` invokes the real local GCC
with `-g3 -O0`, retains both an object and linked executable in the synthetic work
tree, then exercises actual protected collection.

| Synthetic C workload | Source | Object | Executable | Total logical bytes | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| Empty main with debug metadata | 29 | 17,104 | 31,504 | 48,637 | Protected collection succeeds |
| 40 MiB initialized constant table | 121 | 41,960,768 | 41,974,808 | 83,935,697 | Fails per-file check; no partial bundle published |

The second deliberately small source is `const unsigned char
lookup[40*1024*1024] = {7};` plus a main reading the table. It demonstrates a
possible compiler-generated file, not evidence that actual course solutions need
40 MiB tables. Debugger core dumps and multiple build variants may add much more;
they were not measured here. Sparse logical-size rejection remains in the normal
regression suite. No answer is silently dropped to satisfy a limit.

C6 subsequently approved configurable per-exam defaults of 128 MiB/file and
512 MiB total, with unchanged entry/depth limits. These measurements predate that
implementation and do not qualify the new ceilings. Actual workload checks,
discoverable `examctl` preparation checks, storage reservations and worst-case
cutoff/collection/backlog tests remain necessary. The instructor also requires
fatal collection-worker crash isolation; returned-error/blocked-hook tests above
are not evidence of that. Retain fail-closed traversal and explicit repair on
exceeded limits. No runtime limit or deletion policy changed locally.

## Final automated checks for this local increment

296 unit/integration tests pass in 50 files, including actual SMTP rejection/
retry/restart, real SSH worker IPC and signed HTTP callback/host-key alert paths.
52 Chromium tests pass across admin redesign, interface and SSH cleanup suites;
desktop/mobile synthetic review images were inspected. Typecheck, gateway/WASM
build, native static build and native vet pass. All three Go modules pass race
checks; opt-in compiler measurements pass separately. The existing Vite large
bundle warning remains non-fatal. Generated documentation screenshots were
restored to their pre-test versions; no test artifacts were deployed.
