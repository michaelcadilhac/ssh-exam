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
- Full application checks pass: 910 tests/three explicitly gated skips. Latest
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
- Current milestone:16/64 fault qualification, finite worker/shared-host sizing
  and new70×4×90-minute endurance. Installed32workers still fail the read-only gate.
- Decisions: none pending. Installation sizing will be recorded as a candidate
  until actual combined-capacity qualification, never represented as deployed.
