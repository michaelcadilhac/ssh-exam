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

## Measured components and short-test layout

An opt-in real-WASM sign-in profile uses a separate actual application process
and the compiled production connection worker. At0/1/4/8/16students, application
PSS was120/164/279/370/604MiB; the fixture stayed near144MiB. Individual compiled
workers used30–35MiB. These are Linux proportional-memory observations, not
container high-water marks or a substitute for active capture/terminal traffic.

The short co-location uses40candidate slots, a2GiB/two-CPU web bound, unchanged
3GiB/two-CPU native bound and bounded helpers, all nested in an owned4352MiB/no-swap
aggregate. It requires another1GiB of host headroom and stops the owned fixture
below that floor. The four-core host had5.55GiB available at the latest launch.
The real application runs as unused test UID65532, zero effective capabilities,
no-new-privileges and read-only root; generated keys/data alone are writable.
The extracted Node/dependencies/clock/codecs come from the installed immutable
image; no host package, production configuration or service changed. The future
production image retains UID10001 and its existing container restrictions.

Old native setup traces contain782operation events. Health median1.793s,
prepare-account-policy3.447s, activation3.832s and secureAccess5.304s identify
costly operations. Operations nest/overlap: do not sum these medians or attribute
them solely to network or disk. The short run will compare actual Start responses
in the co-located layout without changing freshness/durability/deadline policy.

Three preliminary attempts ended before student admission. Retained evidence
distinguishes a genuine Marco scratch-space refusal from owned fixture errors:
implicit systemd slice state, private code-directory modes, transient-unit
collection assumptions, and the attempted SSH forwarding path. Both direct TCP
and Unix forwarding requests were refused; server restrictions were not altered.
The selected private transport uses one existing SSH command, like the native
fixture, to carry opaque connections only to the two owned test ports. It has
finite queues/channels/lifetime and complete partial-write handling. Actual
loopback/pipe checks force short writes, multiplex two channels, transfer2MiB
through small source buffers and preserve half-closes. A real csc-sys2.18MiB
response with a delayed reader also passes and its process exits cleanly.

The failed one-request transport smoke was consumed by its own TCP readiness
probe. Non-consuming listener observation replaces that probe. An overly small
receive window exceeded an early fixture wait; the focused repeat retains the
large payload, forced short writes, small source buffer and delayed reader with
bounded receive buffering. Neither failure changes an exam timeout or authority.

The fourth attempt loaded all35welcome pages but its first synthetic sign-in
lost the connection worker before a password prompt. No clock/permission was
consumed. A focused same-namespace probe reproducedENOENTfrom Node fork while
the Node path existed: Docker export omits runtime devices, including/dev/null
needed by ignored worker stdio. Private standard device binds/tmp mounts restore
the runtime layout without exposing host storage/devices generally. The actual
compiled-worker IPC ping now passes as UID65532 before any guest allocation.
Attempt5has a separate actual-WASM password-prompt focus, collected before its
cohort may proceed. All prior failed attempts and preservation receipts remain.

Attempts5/6exposed a second observer-only defect: bare tsx inserted__name into
serialized browser source. The observer's Worker constructor threw after creating
the real worker, preventing ordinary sign-in control. Public asset hashes and
the initialized Go bridge were intact. Raw browser JavaScript avoids that loader
helper; the original observer fails an independent actual-tsx/VM control, the new
regression passes, and attempt7's real password prompt/worker-ready focus passes.
Only after collecting that focused pass was the cohort released. No credentials
were entered in the focus and no clock/permission was consumed by the failures.

Early ramp measurements separated helper anonymous memory from inactive file
cache. The helpers' finite allowance was calibrated768MiB→1GiBbefore any max/OOM
event; aggregate4352MiBand product web/native bounds stay unchanged. The full-load
peak must use the final uniform bounds. Preserve that calibration in the report;
do not imply the original helper bound qualified the whole ramp.

An independent [Prof review](production-qualification-35-review.md) reuses the
unchanged rendered UI and current regressions. Codec resets stay invisible;
Start responsiveness and capture observations still require the new measurements.

Marco scratch recovery removed329,137,360bytes of duplicate public Playwright
dependencies from40exactly identified stopped test directories. Unit/browser
absence, empty scopes, file ownership and all340dependency hashes per directory
were verified. Every marker, worker source, raw log and result remains; manifests
allow reconstruction. The unchanged3GiB scratch guard then passed.

## Frozen image and recovery evidence

Private candidate image engine5965a0b182861c116b9f20e1a3c67d1dc091dd6b242405564cfd195db566edae,
Configbb436d262fb8e0fbd1d71c401391bf21d245fa37e8dc074a15a4e1cee7029e3a
is bound to its streamed manifest/raw Config/rootfs layers. It reuses unchanged
runtime dependencies and native clock;76compiled modules match the co-location
fixture byte for byte. No schema change:37remains37.

The actual production-mode image passes63.68seconds of startup/current-data
recovery, including a real62-second publisher delay, expired signed poll,
13signed exchanges, due physical-purge recheck,41preserved tables and12negative
authority mutations. Recovery keeps the original snapshot/current ledger and
adds no restart. Its native installation and external proxy dispatch remain
explicit synthetic seams; it is not a complete matched production cutover proof.
The first startup test lost required group access to its synthetic config
directory under umask0077; explicit0750directory/0440files repair that fixture.
No product configuration or enforcement was relaxed; the image itself is unchanged.

## Partial ramp and orchestration correction

Run7 reached26complete four-terminal/GCC/GDB ramps and27successful Start replies.
It was deliberately stopped when projected ramp plus the required600-second peak
exceeded its3000-second wrapper. It remains partial/FAILED. All399samples are
retained: aggregate peak3496MiB, web1572MiB, native1173MiB and helpers718MiB;
zero memory-limit/OOM events. Successful Start median/p95/max21.075/41.924/44.021s.
The four-core host was CPU saturated; brief read-only attribution also found
unrelated user processes and the installed watchdog consuming CPU. None was
changed. These interval observations do not establish an independent watchdog bug.

Native/Marco cleanup and host/config/authority preservation pass. A first port-bind
check encountered TIME_WAIT, with no listener or live connection; read-only socket
state plus SO_REUSEADDR binding establishes closure without clearing sockets.
The next wrapper includes measured ramp,600-second peak, Finish and cleanup in
its finite outer lifetimes. It changes neither product timeouts nor acceptance,
resource caps, authoritative clocks or monitoring. Helpers use the already
calibrated1GiB allowance from startup. Preserve both failed and final receipts.

## Full-ramp failure retained: private observation deadline

Run8 reached all35students/140terminals and passed two healthy fleet samples
through77.978seconds at peak. The next read failed in the private HTTP child:
its generic10-second route timer was shorter than the native fleet reader180s
and browser190s. All35public failure snapshots remained ACTIVE with enabled
input, no navigation exit or pane refusal. Later LOCKED rows are after browser
teardown, not evidence of a live false-positive. The600-second peak and protected
Finish remain unqualified. Native/base/host/configuration/authority and Marco
cleanup pass; source/build stayed frozen until cleanup.

Retained708resource samples show aggregate run-window current maximum4312MiB
versus lifetime4343MiB under4352MiB; web1917MiB under2048MiB, native1566MiB and
helpers859MiB. All high/max/OOM counters remain zero; host minimum available
2111MiB. Those tight margins do not establish comfortable production headroom.
At the26-worker observation, PSS was about557MiB for workers,261MiB for the web
parent and53MiB for codecs; the larger cgroup charge included848MiB file cache,
mostly inactive. The first classifier counted the parent as a worker because its
arguments also include the worker URL; the corrected priority/receipt is retained.

Start median/p95/max27.016/59.399/59.881seconds, with four known-busy retries.
The439binary409fallback responses remain unattributed. They do not prove that all
refusals share the fixed ownership-context cause, CPU starvation or a violation.
The host/test CPU hierarchy uses default weights, no additional ancestor quota;
unrelated user/system workloads compete. None was altered.

The corrected complete transaction budgets are qualified through actual
authenticated HTTP/IPC: native180s plus cleanup20s, child205s, browser210s;
single reader10s/child15s/browser20s. Ordinary private routes retain10seconds.
A delayed2.18MiB reply passes both observations, old code fails the actual timeout
oracle, and three affected gateway/observer interfaces pass. Commits7976745 and
fb51849 change only private diagnostics; production authority remains unchanged.

## Run9: final Start timeout, no class pass

Run9 completed34students/136GCC/GDB terminals, then the35th Start ended without
an HTTP response at the production60-second limit. Its native row was ACTIVE with
the original real start/deadline and held account; the web row was still PREPARING
with no clock copied when the fixture immediately tore down. This is not proof
that reconciliation permanently fails. The driver did not observe its outcome.
The600-second peak, full35/140 workload and protected Finish were NOT reached.
Analysis, raw observations and both records are retained in co-location-9/.

All658resource samples are retained: aggregate observed maximum3888.6MiB versus
lifetime3915.1MiB under4352; web lifetime1898.9MiB under2048; native1468.7MiB;
helpers861.9MiB. All high/max/OOM counters were zero. Minimum host available
memory1973.2MiB. These ramp measurements do not qualify final collection headroom.
CPU pressure reached92.93% aggregate/89.59% native/72.82% web. Successful Start
median/p95/max27.394/53.364/56.457seconds. CPU contention is demonstrated; exact
per-stage attribution is not: the separate compiled application did not install
the parent fixture's nativeSetupTimings hook, and its stderr retained only a tail.
Do not claim those missing measurements exist or repeat the same class blindly.

Retained binary-error bodies narrow the capture investigation: run9 has359video
verification-unavailable409s,18replaced-context409s and9image-worker-capacity400s.
Run8 has427video-unavailable409s,11context409s and one409without a retained body.
The common video message merges prediction, queue and codec refusals, so it does
not establish which internal cause dominated. The same-runtime69ms decode probe
is not a load benchmark. The context fix does not resolve this remaining capacity
question or justify weaker freshness, unbounded workers or longer authority.

Release preparation also caught a separate private-image packaging error: local
build umask077 survived COPY, making public CSS/JS/WASM unreadable toUID10001.
The healthy API/startup proof did not test that boundary. The corrected generated
dist modes pass an actual normal-UID red→green check and25served-asset hashes;
the final image/current-data recovery passes63.405seconds/13signedpolls,41table
contracts and12negativecontrols with FULL owned cleanup. No production Dockerfile
or installation changed. Final UIcommit1ab9203 and rebuilt16-client WASM sign-in
pass are now packaged in Configebb877aa. Details/remaining deployment seams:
[matched release](pre-final-matched-release.md). This closes the packaging defect,
not the failed shared-host class-capacity boundary.

Native/base/Marco/local cleanup and original host/config/authority preservation
are FULL. Source/build were proved unchanged before edits. Exact native/main PIDs
were zero, listening/live sockets absent, and the only remaining web/bridge PIDs
were verified sleep sentinels; those were subsequently stopped too. No unrelated
process or production service was stopped. Raw data and final counters remain.

The confirmed student UI defect is corrected separately: see
[lost Start reply recovery](start-response-recovery.md). Six focused cases and
38authenticated grant-Begin cases pass; final affected browser results are recorded
there. This does not shorten Start or convert run9 into a pass. The missing stage
observations/refusal labels are now verified through the actual separate test
application, including an explicit Start. [Profiling workflow](start-capture-profiling.md).
Next: bind that updated runtime and collect a bounded native profile under an
established CPU/resource plan before another class run. The instructor was asked about CPU availability, not RAM or a
production restart. Local only; no push/deployment.
