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
