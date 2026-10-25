# Retained mode after genuine SSH loss

October25,2026. Investigation and pending policy decision, NOT a delivered
replacement workflow. Baseline ad828f5; local work only, no deployment. Installed
retained admission stays OFF.

## Confirmed correctness defect and bounded fix

Public entry: signed native `attach-transport`, called by the existing student
`/api/student/attempts/:id/claim` after fresh SSH and instructor authorization.
It changed a v1 attempt's Transport/ResumeTransport while RegisteredOwner still
identified its old transport. RED95802 reaches the actual signed command with a
valid original owner and current authorization: returned success, canonical
transport changed and currentRegisteredOwner became false. Log
/tmp/ssh-exam-retained-replacement-legacy-red.log. Synthetic canonical state is
used; this is not a real SSH/PAM or working reconnect qualification.

The candidate rejects the legacy purpose for v1 BEFORE any ownership/approval/
clock mutation. Existing legacy behavior is unchanged. Focus83773 PASS1.101s;
registered-owner/legacy continuation and clock focus34524 PASS9.673s under race.
Native CLI28068 PASS17.404s with namespace coverage enabled; vet8406 PASS.
Logs retained-replacement-{legacy,owner}-focus.log. This is a refusal safety fix,
not implementation of fresh-transport recovery. Native source has changed: do
not attribute ad828f5's frozen binary/root receipts to a rebuilt candidate.

## Why the complete flow needs a choice

The existing gateway Continue selects consume-monitored-continuation for v1.
Native resumeMonitored requires the original registered page and supervisor's
existing held ownership. The legacy claim changes the page and transport without
a monitored ownership transition. Merely reusing that path would either refuse
or leave inconsistent identity; it must never downgrade to an unmonitored thaw.

One policy dialog is pending; it asks about GENUINE transport loss, not latency:

- Recommended, consistent with the approved crash-recovery grant model: secure
  the original work and issue an explicitly reviewed NEW saved-work grant with
  the instructor's chosen allowance and finite Begin window. Preserve the old
  interval/restriction/history. No automatic refund or reopening. Existing
  CLI/web issuance, source pin and protected-copy semantics provide this model.
- Alternatively support remaining time on the original unfinished attempt using
  NEW authenticated SSH, current scoped approval and fresh native verification.
  Preserve its current deadline and consumed grant. This needs a distinct native
  ownership-transfer protocol and failure/retry qualification; old terminal
  buffers may be lost. Completed/protected attempts never reopen.

Neither approval is inferred from elapsed time. Both choices continue to preserve
viable SSH through mere control outages. A whole-gateway restart while the actual
SSH transport is still alive is a separate same-session recovery case: fresh
signed scope verification is required; no cached disk metadata is permission.

## Immediate plan while awaiting the decision

Finish the narrow refusal increment and preserve its reproduction/legacy tests.
Do independent already-approved TODO work while the question remains pending.
Do not implement either consequential policy by default or call this investigation
complete. The native legacy migration/retirement and dashboard/CLI work are
independent; scope the next one from todo-delivery-audit.md and actual code.

For the eventual combined qualification, join existing real WASM/HTTP/SSH/native
interfaces for ONE synthetic student before scaling to16/64. Preserve the current
private network, exact owned resource bounds, host/base preservation and busy
refusal. A real joined flow is the acceptance result; unused transport helpers or
separate component passes do not establish it. Whole-gateway restart and genuine
loss recovery must reach their supported final state, not stop after guidance.
