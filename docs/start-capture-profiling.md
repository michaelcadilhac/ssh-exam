# Start and capture profiling — manual qualification only

This follow-up supplies the missing observations from the failed short co-location
run. It is not a performance fix or a new class-capacity pass. No production host,
configuration, record, email or institutional MFA is involved in its local checks.

The bounded milestone uses actual student preflight/Start commands and authenticated
`/api/student/attempts/:id/frames/binary` responses. Acceptance is useful metadata
from the actual separate application, unchanged public refusals/clocks/capture
recovery, and a bounded private sink that cannot change or replay an operation.

## Collected metadata

The separate test application now installs the existing native-operation timer.
It records the synthetic account, process/connection/operation sequence, fixed
operation name, start/completion/refusal and elapsed time. It excludes renewals,
command bodies, passwords, MFA answers, signed payloads and reply contents.

Video refusal objects carry a private stage: unavailable codec, closed service,
missing video, busy source, ingress capacity, prediction chain/limit, queue expiry,
or codec spawn/time/output/signal/exit. The student still receives the same generic
error and HTTP status. Private HTTP traces record that stage, response duration,
status and synthetic attempt ID. Image-worker capacity and challenge refusal are
separate categories. A stage identifies the refusal boundary, not necessarily the
underlying hardware, network or data cause.

No worker count, queue size, timeout, image limit, freshness, grant, hold or deadline
changes. Production adds no logger, polling endpoint or configuration setting.
The profile hooks and file writer exist only in test fixtures.

## Storage, recovery and inspection

The fixture's private data directory contains `qualification-profile.jsonl`, mode
0600. Each process records at most16,384rows; the file has an8MiB cumulative byte
budget. Complete prior records remain across an application restart, with PID
correlation. Symlinks, wrong ownership/modes, incomplete prior lines and full logs
cannot masquerade as a fresh healthy profile. Errors/full logs remain inspectable
through the fixture's read-only profile status; they never fail or replay work.
Descriptors close on normal shutdown or process exit.

The co-location readiness response includes profile version/support/path/health.
The class entry point requires fresh supported diagnostics before allocating its
cohort. This catches an old compiled backend/helper combination. Save the status
and log before fixture cleanup, and treat failed/truncated traces as incomplete
observations. Do not reset the log or relax the gate to obtain a clean run.

For a small local real-WASM check, build first, then run:

```sh
EXAM_BROWSER_SSH=1 EXAM_BROWSER_GATEWAY_PROCESS=1 \
EXAM_BROWSER_PROFILE_COMPILED=1 npm run test:browser -- \
  tests/browser/setup-health.spec.ts tests/browser/start-profile.spec.ts \
  --output var/setup-profile
```

Each test writes its actual `setup-profile.jsonl` or `start-profile.jsonl` before
the temporary fixture is removed. The list reporter alone does not preserve an
in-memory attachment. These are simulated SSH/native policies with real WASM/SSH
transport, not institutional authentication or privileged-kernel qualification.

## Verification and next measurement

Evidence root: var/qualification35/profile-20261119T044302Z-8d3c93/.
`diagnostic-stage-red` retains the missing-stage regression; an assertion-promise
warning was a test-fixture issue, corrected before the passing checks.
`diagnostic-final-focused2` passes13focused cases: real invalid-codec exit, missing
prediction, exact queue expiry, privacy, sink failure, restart append, symlink and
full/partial log boundaries. A first8MiB deep-comparison assertion exceeded its test
budget; native byte equality verifies the same complete file without widening it.

`diagnostic-public-capture` passes17cases including10authenticated upload/codec
interfaces: rejected frames/clocks stay unchanged and fresh JPEG recovery works.
`diagnostic-final-wasm` passes both real-WASM setup refusal/retry scenarios and
saves the traces. `diagnostic-profile-ack` passes the actual child HTTP/restart
case, preserving prior bytes and distinct process identities. It waits on the
producer's post-write counter: receiving a response does not establish completion
of the server's onResponse hook. Build/typecheck pass. All25combined affected
application cases pass in `diagnostic-final-application/command.log`.
`diagnostic-browser-final` passes all three real-WASM cases, including one explicit
Start, exactly one activation and its verified terminal/full300-second allowance.
Actual traces remain in per-test output. The first Start test read status before
preparation completed; awaiting the actual HTTP response corrected that fixture race.
Native binaries/race/kernel contracts are unchanged and retain their prior scope.

These local timings are not csc-sys measurements. Next obtain a bounded native
profile under an explicit CPU/resource plan; use operation/stage evidence before
choosing a performance change or repeating the full35-student peak. The prior
run9 failure remains failed. The former prepared image Configebb877aa does not
contain these new backend labels: compile and bind the updated test runtime before
using its profile-support gate. No push/deployment is authorized.

## Actual csc-sys diagnostic qualification

The single-student co-location path now exercises the same separate application,
real WASM/native SSH, protected Finish and restart recorder before a class ramp.
Its existing half-core/1GiB native defaults remain; only an explicit owned slice
accepts this mode, alongside the existing35-person mode. Wrong slices/profiles
and16-person co-location still refuse. All32 runner contracts and typecheck pass.

Actual normal-budget and two-core comparison workflows pass82.917/81.957seconds,
including forced/graceful application replacements, hold/Continue, editor and
archive preservation. Native-operation Start spans are14.085/10.487seconds;
CPU contributes but does not explain all latency. Both traces identify one
prediction-chain refusal followed by accepted uploads, without class-load codec
attribution. Full independent cleanup and frozen-input preservation pass.
[Agent measurement report](../reports/stress/20261119T173903Z/report.md).
No class-capacity or production-readiness claim follows; the exact next action is
the already-planned instrumented35-person short co-location under unchanged caps.
