# Retained mode after genuine SSH loss

October25,2026. Investigation under the already-approved C7 policy, NOT a delivered
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

## Approved recovery and remaining workflow

The existing gateway Continue selects consume-monitored-continuation for v1.
Native resumeMonitored requires the original registered page and supervisor's
existing held ownership. The legacy claim changes the page and transport without
a monitored ownership transition. Merely reusing that path would either refuse
or leave inconsistent identity; it must never downgrade to an unmonitored thaw.

The repeated policy dialog was unnecessary. C7 already authorizes securing the
original work and issuing a reviewed NEW saved-work grant with an allowance and
finite Begin window chosen by the instructor. In the clarification the instructor
correctly observed that this can also choose the old remaining allowance. New
time begins only at actual Begin; the old interval/restriction/history remains.
No automatic refund, reopening or account-hold release. Use existing CLI/web
issuance, durable source retention and protected-copy semantics; do not add a
second original-attempt ownership-transfer protocol as an unrequested prerequisite.

Approval is never inferred from elapsed time. Preserve viable SSH through mere
control outages. A whole-gateway restart while the actual
SSH transport is still alive is a separate same-session recovery case: fresh
signed scope verification is required; no cached disk metadata is permission.

## Integrated acceptance still required

The narrow inconsistent-identity refusal is implemented; preserve its regression
and legacy behavior. Join actual genuine SSH-loss containment, original work
protection and existing reviewed saved-work issuance/Begin through supported
web AND CLI guidance. Do not offer an original-attempt reconnect that native v1
deliberately refuses. A saved archive may be required before a new source grant
becomes usable; failed collection remains inspectable/retryable, never starter
fallback. This is integration of approved policy, not a pending design decision.
It does not itself close ownership/cleanup or the broader liveness investigation.

For the eventual combined qualification, join existing real WASM/HTTP/SSH/native
interfaces for ONE synthetic student before scaling to16/64. Preserve the current
private network, exact owned resource bounds, host/base preservation and busy
refusal. A real joined flow is the acceptance result; unused transport helpers or
separate component passes do not establish it. Whole-gateway restart and genuine
loss recovery must reach their supported final state, not stop after guidance.
