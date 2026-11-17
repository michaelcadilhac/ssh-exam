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
- Current milestone: 2, capture setup recovery after transport cancellation.
- Decisions: none pending. Installation sizing will be recorded as a candidate
  until actual combined-capacity qualification, never represented as deployed.
