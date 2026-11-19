# 35-student production qualification — local/disposable work

Authorized after the completed November 18 endurance report: profile Start and
capture fallback, measure the application separately from test helpers, run a
short guarded web/native co-location check, and prepare a matched release and
rollback procedure. No push, deployment, production restart/configuration change,
student account/data, institutional MFA or external mail is authorized.

## Dependency-ordered milestones

1. **Start and capture profile; fix confirmed defects.** Public entries are student
   preflight, `POST /api/student/attempts/:id/begin`, challenged `/frames/binary`,
   and the actual native signed commands they invoke. Use the completed 35-person
   timings first, then bounded synthetic browser/native cases. Attribute wall
   time and per-process memory/CPU instead of charging the entire fixture to the
   application. Test owner/generation transitions of video prediction state before
   changing its behavior. Acceptance: a reproduced cause or explicitly uncertain
   attribution, focused public regressions for any fix, unchanged no-start,
   ownership, freshness, clock, hold and credential checks. Run affected interface,
   build/type and native race checks as required. Commit a validated increment.
2. **Short isolated co-location qualification.** Use Marco only for synthetic
   browsers and a guarded disposable csc-sys environment for the candidate web and
   native roles. Select finite worker/CPU/memory bounds from measured component
   growth with headroom before allocating 35 students/140 terminals. A busy host
   or insufficient resource guard means no test, never clearing records or relaxing
   the guard. Exercise real admission, monitored work, final input, simultaneous
   protected Finish/export, and exact cleanup. Target a ten-minute peak, not another
   90-minute run. Require original clocks/ownership, no unexpected lockouts or
   resource-limit/OOM events, all 35 protected exports and FULL host preservation.
3. **Matched release recommendation and recovery procedure.** Freeze tested web,
   native and CLI identities; reuse unchanged qualification at its exact scope.
   Prepare csc-sys-specific configuration/resource proposals and installation,
   migration, preservation, current-data recovery and reopening steps using the
   existing controllers. Identify any remaining unqualified gate explicitly.
   Do not install, fence production, restart a service, push or deploy.

## Current investigation

The preceding report passed 35/140/90 minutes with protected completion and FULL
cleanup. It used a development-host gateway with 96 connection slots, while the
installed web configuration has 32 slots and a 2-GiB/2-CPU bound. The development
parent's memory includes browser-test/fixture processes and is not the web process's
working set. Successful Start median/p95/max were 17.888/26.242/29.678 seconds;
66 initial video-to-JPEG refusals and one explicit Start retry were retained.

The decoder prediction state is keyed by attempt, page, generation, settings,
registered owner and source. The former browser encoder tracked only source.
A real-browser/codec regression reproduced an unnecessary fallback at an owner
change. The local correction adds an opaque context hint and starts a new keyframe;
server scope/freshness checks and unknown-ACK JPEG recovery remain unchanged.
Focused HTTP/browser checks, typecheck/build and 959 application checks pass (three
gated skips). All 13 affected browser checks pass, including real VP9, lost
acknowledgement recovery and a constrained 128-kbit/s upload. The changed candidate
has not repeated the 90-minute run or passed co-location. No production change.

Profile receipts: var/qualification35/profile-20261119T044302Z-8d3c93/.
The first browser runner failed before startup because its TMPDIR exceeded Unix
socket path limits; its corrected short private path reached the intended red
case. An HTTP assertion initially expected a non-public error-code field; it now
checks the actual refusal message. Both owned fixture errors remain recorded.

A read-only csc-sys inventory found 5.38 GiB available. The exact previous native
unit journal reports a 1.6-GiB completed-run peak, including collection. These are
planning observations, not a new co-location result. Application-only process
measurements must precede freezing the combined budgets.

The actual installed Docker application is running, with 32 connection slots,
2 GiB memory and two CPUs. Read-only inventory measured 201 MiB current / 351 MiB
historical peak, without memory-limit events. This is an idle production
observation, not an estimate of 35 active students. Its container swap limit is
unbounded in the cgroup projection; the disposable test will prohibit swap.

Evidence baseline: [completed agent report](../reports/stress/20261118T190606Z/report.md).
