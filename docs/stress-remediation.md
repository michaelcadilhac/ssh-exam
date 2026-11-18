# Stress findings remediation — local development

Requested November 17: implement the suggestions in the manual stress report.
No push/deployment, production configuration or student-record changes authorized.
Preserve existing screenshots, failed receipts, deadlines, holds and monitoring.

## Dependency-ordered milestones

1. **Classroom startup.** Actual welcome/API routes admit 70 cold clients behind
   one NAT without consuming protected/API/password budgets. Keep bounded public
   read traffic and existing password/SSH-attempt controls. Acceptance: all actual
   bootstrap requests succeed; read abuse and password/admission abuse still
   refuse; no unauthorized attempt/session/email created. Focused HTTP/security
   regressions, then affected integration tests.
2. **Capture setup recovery.** Actual Share screen/Enable webcam workflows recover
   after a transient challenge/upload failure without a stale modal, extra media
   prompts, a started clock or consumed permission. Keep Start/input unavailable
   until verified capture is healthy. Test cancellation, stale completion and
   failed/current verification through browser and capture interfaces.
3. **Remaining Prof findings.** Separate bulk edit from cancellation, consistent
   Start dates labels, correct Add-student focus, ended connection status, concise
   source selection, visible known validation, neutral maintenance copy, countdown
   and sandbox explanations. Preserve unknown-operation reconciliation and source
   protection. Prof approves/reviews rendered desktop/narrow workflows; focused
   browser/security cases plus real nginx maintenance checks.
4. **Stable load environment and pane refusal.** Isolate only the owned Marco
   generator's network using installed facilities; never change global networking
   or unrelated jobs. Require several network-churn cycles of steady HTTP/HTTPS/
   WebSocket traffic before guest allocation. Capture and reproduce underlying
   pane refusal through actual public/native entries before changing admission.
   Prove exact owned namespace/process cleanup and host preservation.
5. **Capacity and final qualification.** Qualify a finite >=70-worker candidate
   with realistic combined web/native resources; keep installed configuration
   unchanged. Reuse unchanged evidence, run affected application/native races/
   builds/browser checks, then one fresh 70-student/280-pane/90-real-minute run
   and simultaneous protected submissions. Write a new agent-reviewed report.
   A failure triggers focused diagnosis/remediation, never blind repeated ramps.

The instructor confirmed that increasing the class-server VM resources is an
option if completed measurements require it. Keep sizing proposals separate from
actual production changes; the current qualification still uses guarded guests.

Endurance 7 passed the corrected full fleet reply, the 70-student / 280-terminal
GCC/GDB ramp and three peak samples through 140.125 seconds. Marco's exact owned
unit journal then confirmed an OOM kill at 21 GiB. All native, Marco, local and
observer cleanup and original preservation pass. The 90-minute endurance and
protected fleet completion remain unqualified. The pending resource question is
whether Marco can have at least 30 GiB available RAM or a larger generator host
can be used. A finite 25 GiB generator cap, 29 GiB startup requirement and unchanged
4 GiB live reserve are proposed for qualification after resources are available.
Current code still enforces a 21 GiB cap, 25 GiB startup requirement and 4 GiB
reserve. Do not repeat the expensive ramp with the same undersized generator.

The monitor discarded its rejected status, hiding which guard stopped the run;
systemd had also collected the final cgroup counters. The local correction retains
the redacted observation, stage and time, names each unchanged limit, emits a
receipt on existing stderr, and still stops its worker when file publication fails.
The actual cohort reader reports the refusal and journal guidance before parsing
healthy-only fields. Three focused Python checks, 11 actual-file reader checks,
typechecking and all 38 affected harness checks pass. A real two-context browser,
HTTP, WebSocket and media workflow followed by an authored service stop, monitor
publication and actual reader refusal also passes, with independent local/Marco
cleanup and unchanged product artifacts. Evidence:
var/stress-remediation/20261118/generator-refusal/.
This short case is a clean authored stop, not a new OOM test or full-class pass.
Its first local verifier confused exclusive binding with closing TCP state;
the existing qualified listener/reuse guard proves cleanup, preserving that error.

November18: endurance6 reached all70students/280verified GCC/GDB panes but failed
before peak when the private fleet-observation reply was truncated. Independent
native/Marco/local/observer cleanup and frozen-input checks pass. The private
bridge ignored partial unbuffered writes;3actual-socket regressions reproduce the
old defect and43bridge checks pass after correction. Actual native editor/Continue/
same-SSH/buffer/protected-finish acceptance of v17e passes91.771s, with FULL native/
local cleanup and unchanged inputs. Native binaries and production are
unchanged. CPU contention, callback timeouts and capture-verification fallback
responses remain separate findings; no70/90qualification is claimed.

## Queued after frozen endurance5: routine Start readiness contention

Three actual starts (students39/44/59) needed a fresh explicit Start after the native
health observation was busy. The driver verified native PREPARING/start0 and an
AVAILABLE permission before retrying; this is startup friction, not a violation
or a consumed clock. Native `health_observation.go` uses a no-wait per-Engine
mutex; its observation is never cached/reused as the actual admission guard.
Begin in app.ts performs separate health checks for handoff/template/legacy/
practice, then audits/reconciles failures and shows generic setup-failure copy.
Preflight already translates the exact busy response into concise409 copy.

Prof approved one short retry of ONLY the exact authenticated busy health command,
using fresh authorization/nonce within the original budget. Keep existing
“Preparing exam…” stable; no automatic activation/Start/authentication replay,
health caching, relaxed freshness or skipped admission checks. If still busy,
prefer inline in the existing confirmation: “The server is checking exam setup.
Wait a moment, then try again.” Make no global clock/grant claim; active/uncertain
prior outcomes retain the existing authoritative reconciliation/fenced path.

Implement only after the current frozen run finishes and cleanup is verified.
Acceptance: busy→healthy gives one student confirmation/one activation/two fresh
health nonces; persistent busy gives calm recovery/no activation; unrelated errors,
timeouts and unknown activation retain current handling. Changed page, settings,
window, transport or monitoring during the wait still refuse at final guards.
Cover template health after monitoring/handoff as well as legacy, practice and
preflight. Inspect actual helper signatures/intent-ledger ownership before edits;
do not infer that a metadata error proves global no-start. Required public route/
browser/native checks and later-artifact scope must be recorded separately from
the exact6a294e2 endurance run. This proposal was approved by Prof. The Begin-only health retry and guarded
inline busy response are implemented locally; focused verification is in progress.
Preflight keeps its existing one-observation/explicit-retry behavior. Nothing is
deployed.

## Progress

- Investigation: report/current code read; initial dirty files are the ten existing
  documentation screenshots. No production changes.
- Milestone 1 implemented/tested locally: three focused regressions, 16 affected
  HTTP/SSH/enrollment security checks, typecheck and the original 210-request
  baseline pass. No attempts, sessions or outbox rows created by the baseline.
  The first security fixture incorrectly expected a 404 before the authentication
  hook; its failure is retained and the existing protected route is now tested.
- Milestone 2 implemented/tested locally: 26 focused API/capture checks, current
  build/typecheck and two browser challenge/upload cancellation cases pass. One
  selected stream, no stale modal/incident/clock; cancellation releases late media.
- Milestone 3 implemented/tested locally: Prof reviewed desktop and 375px flows.
  Separate bulk cancellation, concise sources, date terms, initial focus, visible
  validation, completed connection status, sandbox/pause explanations and neutral
  maintenance copy are fixed. The affected suite passed 162 cases; three stale
  expectations were repaired and passed separately. Subsequent mobile validation,
  plural cancellation and 60-second focus-display regressions pass on rebuilt
  assets. Real local nginx/TLS maintenance checks pass. Original failed receipts
  and the separate follow-up results remain distinct.
- Milestone 4: the owned Marco browser now has an isolated private network
  namespace with private Unix-socket forwarding. A 190-second steady probe passed
  2,054 requests without failures across eight host interface-creation events;
  independent exact process/cgroup/tunnel cleanup passes. No host networking changed.
  Actual encrypted synthetic SSH reproduced eight-session exhaustion under
  concurrent commands. Bounded command concurrency/queueing reserves a live-renewal
  lane; 63 queued commands, exact queued cancellation and all four panes pass,
  as do browser-SSH races. This is a confirmed failure path, not proof of the cause
  of the old sanitized fourth-pane refusal.
- Earlier full application checks pass: 910 tests/three explicitly gated skips. Latest
  build and typecheck pass. Two native editor attempts were blocked before Start:
  the loopback-only namespace made Chromium report offline despite working HTTP.
  A separate real-browser check reproduced this. Exact fixture cleanup and zero
  clock/consumption evidence are retained. The corrected private namespace has
  only its closed veth pair and loopback, without host/external connectivity or
  navigator overrides. Its fresh real-online/HTTP/WebSocket/media smoke and
  190-second/2,054-request steady HTTPS check pass. Native editor and timer/files-only
  recovery then pass through the actual browser, SSH and root guest, with exact
  cleanup and FULL original preservation. An owned parallel port conflict is
  retained; its ordinary browser runner was gracefully interrupted and exact
  cleanup verified. One-/16-person phases share3100; only70-person mode on3102
  can overlap the ordinary suite.
- Earlier complete application evidence: 915 passes/three gated skips; three actual
  CLI/export/zsh-bwrap workflows pass separately. The 16/64 recovery and fatal
  collection-worker phases pass. Current milestone: complete browser verification,
  pressure diagnosis, shared-host sizing and a new 70×4×90-minute run. Installed
  32 workers still fail the read-only gate.
- No policy decision blocks the current local tests. Installation sizing stays a candidate
  until actual combined-capacity qualification, never represented as deployed.

## Current critical findings

Technical v2 now passes actual 16-student/64-terminal recovery after a 75-second
proof outage, preserving shells, deadlines, ownership and protected completion.
Concurrent collection also passes a fatal worker fault with continuing peers.
See [timing acceptance and evidence](technical-resume-timing.md). The historical
pre-outage refusal of a student's third pane is still unexplained; a later pass
does not establish its cause. Private bounded diagnostics are retained for new
failures. Prof-approved pane-local feedback is integrated, preserving healthy
input, unknown-admission fences and explicit manual New terminal behavior.

Endurance attempt 1 failed before peak at 61 students/244 terminals. The next
student remained on Connecting to the server when the driver's default 10-second
Password locator wait expired. A healthy, actual WASM/SSH startup with a 16-second
relay delay reproduced this exact premature refusal. The shared driver wait now
uses the existing 60-second operation budget and logs prompt latency, without
retrying authentication or changing production. Three real-browser cases pass:
delayed startup, actual 60-second expiry and correlated SSH loss. Forty-two
focused unit checks, 11 terminal-browser checks and typecheck pass. The cohort's
refusal observer also uses the current Terminal notice instead of the removed
global dialog. All failed evidence is preserved.

No 70-person peak or simultaneous submission result exists. Start responses grew
to 57.783 seconds; contention and resource sizing need investigation before another
long run. At failure, 26 public diagnostic reads reported ACTIVE/generation 0 and
35 were unavailable under their 3-second diagnostic bound; visible inputs were
enabled and no pane refusal was captured. Later LOCKED/generation 1 web rows belong
to teardown. Do not infer a connection-loss cause or an all-fleet state from these
different observations. Independent native, Marco and local cleanup passes, with
original host files/authority and frozen source/built inputs unchanged.

The next bounded milestone is the complete ordinary browser suite and pressure
diagnosis, then a new full run after focused evidence. Production remains unchanged:
32 workers and shared-host capacity are not qualified for the class target. Exact
running/cleanup state belongs in [the checkpoint](todo-current-checkpoint.md);
the [agent report](../reports/stress/20261117T174000Z/report.md) retains each scope.

The ordinary browser run on f76aaf9 was interrupted after 156 successful logged
cases of 377 declared; no final JSON or exit status was produced. Its exact
orphaned fixture received a verified-PID graceful shutdown; owned processes and
ports are gone and source/built inputs stayed unchanged. This is incomplete
verification, not a complete pass or an attributed product failure. A bounded
local user-service runner preserves durable output, but its initial print-only
smoke did not qualify actual crash behavior. The correction below is required.

Two endurance preflight refusals also exposed a raw operator-oriented native
readiness message to students. Prof approved the concise inline replacement:
“The server is checking exam setup. Wait a moment, then try again.” Only the
recognized busy-health condition on the student preflight route receives public
409/EXAM_SETUP_BUSY; the original detail is privately audited and CLI health is
unchanged. Two actual packaged-WASM/signed synthetic SSH/public-route browser
checks pass in 12.4 seconds: no attempt/permission/clock consumed, same sign-in,
private diagnostic retained, explicit healthy retry; a different error is not
misclassified. Seven affected HTTP checks, typecheck and build pass. The first
two regression setup failures (missing CSRF, fault identity dropped by a wrapper)
are retained separately; the third red run actually reproduced the raw message.

The first durable broad runs at 0d28ae1 failed: application 916 passes/one failure/
three gated skips; browser 96 passes/one isolation failure, followed by a controlled
stop with one interrupted test and 281 not run. Exact cleanup and unchanged inputs
are proved. The test services inherited unlimited core dumping instead of the
ordinary shell's zero limit. Exact-unit journal metadata identifies the deliberate
heap workers taking about 3.1 seconds and 25.4 seconds to finish dumps, exceeding
the existing 1.5-second and 20-second assertions. Core images were not opened.

The owned test services now explicitly use LimitCORE=0. Actual service-context
qualification passes all 14 purge process/jobs/HTTP checks and the complete
five-fault SSH/browser isolation workflow, preserving data and healthy peer work.
The intentional hang is detected at 59.948 seconds; heap failure at 863 ms. Both
units are stopped with unchanged source/built inputs and empty owned cgroups.
No production setting, timeout or acceptance criterion changed. Per-fault labels
and bounded state capture improve future diagnosis. AGENTS.md and the retrospective
require matching runtime limits and real fault qualification before broad tests.
Fresh corrected services pass the complete application suite (917 tests, three
gated skips) and ordinary browser suite (367 tests, 12 mode-gated skips), with
zero failures/flakes and exact cleanup/frozen-input receipts. A separate
independent-gateway 16-client sign-in passes. The gated gateway restart file is
being completed separately; these results do not qualify native-only paths or
the 70-person endurance. The complete independent-gateway restart file now passes
all nine cases (zero skips/failures/flakes, 123.628 seconds), including the eight
formerly gated paths and one overlapping ordinary case, with exact cleanup.

The first independent-gateway group passed seven cases, then failed during the
lost-policy-report test's initial setup. Its negative-frame fault was installed
before Start. The first correction reached Start but incorrectly required a
negative frame despite the real pending-policy guard suppressing sampling. Both
failed fixtures and exact cleanup are retained. The corrected focused test now
passes: a genuine lost socket report and first lost acknowledgement preserve
capture suppression for full sampling intervals through gateway replacement;
only the repeated genuine acknowledgement permits a fresh successful positive
capture. Production code is unchanged from 0d28ae1. The subsequent complete
nine-case file passes; fresh native single-student checks remain before the
large cohort. Current identities belong in the checkpoint.

## November18 endurance5 result and sizing next step

Exact6a294e2/v17d failed at61verified students/244terminals before the peak.
Student62 Start exceeded60s. Its native state remained PREPARING/start0/deadline0;
the web Begin intent is PENDING/unverified. No automatic replay follows an unknown
Start. FULL native/Marco/local/observer cleanup and unchanged inputs are proved in
var/stress-remediation/20261117/endurance-socket-qualified/completion.json.

At55students guest memory was2,461,192,192bytes/3785tasks, noOOM/task-limit events.
CPU pressure some avg10 reached89.92%; quota throttling was only83,727microseconds
across40323periods. The4-vCPU host was~98%busy at40. This establishes CPU contention,
not its external source or the exact Start-timeout cause. Marco peak19,528,949,760
bytes stayed below20GiB; teardown-current values are not peak measurements.
User permits resource growth;8vCPU/16GiB is proposed for the next sizing trial,
with no production resize/restart now. Before another ramp, add bounded synthetic
command timings and complete the independently confirmed healthBusy Start fix.

### Start contention implementation verification

The new signed-SSH/public-Begin regression fails against the old implementation
(one busy observation incorrectly aborts setup) and passes after the correction.
Seven helper checks and eight route checks pass, including two distinct signed
health nonces with one activation, persistent busy, prior pending intent, page/
settings/date changes and actual60s capture expiry. Initial fixture failures are
retained: immutable settings refused before a second signed command, and the
stale-capture test used an obsolete15s assumption. Their corrected oracles follow
the actual producer and unchanged60s boundary. Additional unavailable-reconciliation
and late-browser-reply checks are being completed before the milestone is qualified.
Private evidence:var/stress-remediation/20261118/start-health/.

The final endurance5 read-only web projection is retained in
var/stress/20261117T174000Z/endurance-5/target-web-start-state.json.

The Start-health milestone is now implemented/tested locally:16focused checks,
72affected application checks,7rendered browser cases, current build/typecheck
and actual native timer/SSH-loss recovery/protected finish pass. Prof approves
the rendered390px confirmation. Exact native-timer-recovery-5 passes82.856s
with FULL native/local cleanup and frozen inputs; samev17d native binaries,
local generator (unchanged Marco network evidence reused). No70/90pass or repair
of the separate class-load timeout is claimed. Evidence and cleanup receipts:
var/stress-remediation/20261118/start-health/. Native race evidence remains
applicable: no Go/native source or binary changed.

## Private setup-stage timings (under qualification)

The existing native browser fixture now observes fixed health/setup/activation
operations through its existing onConnection hook. The existing private runner
stderr retains started/completed/failed markers and monotonic elapsed time. Only
synthetic examq identities are eligible;128operations/connection and256connections
bound records. No bodies, replies, error text, credentials or signed values are
logged. No new process, control service, authority or separate file writer exists.
Sink failure disables only the observer, not the operation. Times include the
existing worker/browser SSH/native round trip and diagnostic overhead; they do
not isolate native CPU cost by themselves. Independent-gateway mode is explicitly
unobserved; the normal local gateway used for endurance is observed.

Four focused checks cover exact call/result/refusal preservation, omitted private
payloads, sink failure, record bounds, excluded renewals and non-synthetic accounts.
Fixture typecheck passes. The updated cohort driver uses the new inline Start
confirmation, requires typed409 and exact native no-start/web AVAILABLE/no-intent
proof, and never retries an unknown Start. Actual16-person qualification is in
progress under var/stress-remediation/20261118/setup-timing/native-recovery/.

The observer and updated cohort driver now pass actual native-recovery-8:
16students/64original panes,75s proof outage, buffer/deadline recovery and16protected
submissions,591.676s; FULL native/local cleanup and unchanged inputs.352timing
events cover16synthetic users with paired outcomes. This16-mode run exercises
shells, not the70-mode GCC/GDB workload. Median/max whole-call times (ms): health
1090/1941, account preparation2276/3214, SSH handoff3177.5/4531, activation2450.5/3542.
No single stage explains the older class timeout at this smaller scale.

A fresh read of endurance5's889saved generator samples found13above its18GiB soft
limit, all during the final Start-failure minute (09:11:35.352–09:12:46.406UTC).
The20GiB hard cap was not reached. This is correlation, not proof of the timeout's
cause; memory.events and pressure were not retained. Linux documents memory.high
as a reclaim/throttle boundary even without OOM:
https://docs.kernel.org/admin-guide/cgroup-v2.html#memory-interface-files .
Investigate this harness limit before another long ramp, without changing student
authority or production resources. Receipt:endurance-5/generator-soft-limit-correlation.json.

The finite generator budget is now corrected locally: MemoryHigh=MemoryMax=20GiB,
with the hard maximum, no-swap,8CPU/4096task limits and independent host/ancestor/
shared-memory headroom unchanged. Read-only status now retains memory.events,
memory/CPU pressure, cpu.stat and pids.events before cgroup destruction.10focused
generator guards and24runner contracts pass; outer/remotePython compiles. Actual
private Marco smoke is running. This change removes the lower artificial soft
ceiling; it is not proof that the old timeout was caused solely by reclaim.

Actual Marco smoke2 passes two isolated contexts, real HTTP/WebSocket/media and
new kernel limit/pressure reads, with frozen inputs and independently verified
local/remote cleanup.11focused generator and24runner checks pass. The first smoke
passed browser work but exposed an idle SSH multiplex master retained inside the
completed local unit. Only its listener was stopped, preserving existing channels;
RPCs now explicitly prevent creating persistent masters while allowing an existing
operator connection to be reused. Smoke2 leaves MainPID0 and an empty owned scope.
This is a test-transport cleanup correction, not a production SSH change.
Evidence:var/stress-remediation/20261118/generator-memory/marco-smoke-2/completion.json.

The next instrumented full70/90-minute run can proceed on the unchanged4-vCPU/
roughly8-GiB class host; the optional larger-VM question remains open, not a blocker
to qualifying this focused generator correction. Full target and actual co-location
still need measurement. Do not attribute a pass/failure solely to the soft limit.

Before the class run, aligning old generator-memory samples with native student
checkpoints found5.136/7.796/12.337/15.416/16.205GiB at9/21/40/52/55students.
The trend approaches20GiB at70clients. The final test-generator budget is21GiB
soft=hard, with startup availability strengthened from24to25GiB and the live4GiB
floor unchanged. Native/student/production limits are unchanged. The20GiB smokes
remain historical qualification of those inputs, not proof of this final budget.
35final harness checks pass for21GiB. Actual short21GiB smoke passes with complete
local/remote cleanup and unchanged inputs. Only the two stopped
PASS-smoke remote directories were removed after token/owner/unit/browser/service
checks; local evidence remains. Qualify the final budget before the long ramp.
