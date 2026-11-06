# Disconnect review — November 6, 2026

Read-only production review at14:23Chicago, with scoped native follow-up. Current
runtimec62f0cc/imageConfig2ff55a02 and exact native loaded-role digests match the
last accepted release. Six started attempts since November4/open interruptions
were inspected (including attempts with earlier starts and new interruptions).
Six interruption histories were inspected. No unfinished attempts are present.
Production records, files, sessions, settings and services were unchanged.
Private evidence: var/incident-reports/disconnect-review.20261106/.

The answer to “all explained and fixed?” is **no**. Recovery bugs are explained
and fixed; the initiating transport/monitoring failures remain partly unexplained.
All latest student incidents precede the November6 timeout release. No student has
started a new attempt since then, so absence of newer failures is not live proof
that the timeout change solved them.

## Observed sequence, Chicago time November5

The first affected midterm attempt has three positively confirmed SSH-owner exits,
with initial interruptions at19:01:27,19:19:26 and19:42:40. The first two resumed;
the third ran into the separately confirmed claim/clock recovery defects. The
original attempt finished protected at its effective deadline,20:35:35. Later
web “SSH transport lost” events during unsuccessful recovery are not automatically
counted as new independently confirmed connection failures.

The instructor-authorized replacement started21:08:19 with its full60minutes.
Its two interruptions differ from the earlier sequence:

| Event | First interruption | Second interruption |
| --- | --- | --- |
| Native technical hold |21:37:15|21:44:11|
| Gateway receives hold |21:37:18|21:44:13|
| Gateway receives positive SSH-exit fact |21:37:32|21:44:54|
| Successful same-attempt resume |21:42:34|21:54:46|

Thus SSH loss followed the technical monitoring hold; it does not explain the
initial verification failure. The last screen reached the gateway18.409/14.747s
before those gateway hold notifications. In the second case, the gap between
screen arrivals was23.277s, with three further screen frames arriving before the
SSH-exit notification. This is consistent with the old15s evidence cutoff. It
cannot establish whether capture, browser scheduling, signed exchanges, upstream
network or another stage stalled, nor whether a longer budget would avoid both
incidents. Gateway image arrival alone is not proof of complete current native
monitoring/input authority. No images, terminal contents or submissions were read.

A second-page/takeover event at21:44:57 occurred after the second hold and SSH exit;
it cannot be the initiating cause of that interruption. The safety check must not
be bypassed or treated as proof of misconduct from these records. Final student
Finish at22:05:28 protected the replacement submission; its account hold released
at22:08:22. All reviewed native attempts are protected, with no retained native
error recorded. The earlier November4 lost-session case also ended with a protected
replacement submission, rather than an unresolved active attempt.

## Fixes actually deployed

- Fresh-SSH files-only resume on the SAME unfinished attempt, with unchanged
  timing/files/holds and fresh verification.
- Pending clock requests no longer block replacement-page claim. Exact verified
  SSH exit permits the no-work clock repair without requiring a dead supervisor.
- Failed live clock handover remains pending/retryable. Negative SSH-exit evidence
  can cross a clock-only revision of the same immutable lifetime. Positive work
  authority still requires current verification.
- Authenticated prompt clock delivery,60s operational evidence/relay waits,
  paused-countdown controls and configurable resume approval. These are regression/
  native/interface-qualified mechanisms, not a causal explanation for past drops.

Evidence: timer-controls-followup.md, files-only-resume.md and the current deployed
checkpoint; full840application checks and affected races/actual supervisor/browser
and matched installation evidence remain applicable. No unchanged suite was rerun
for this read-only review.

## Still open; do not claim fixed

1. **Root-cause diagnostics and stall qualification.** The relay discards the
   direction/result of both io.Copy operations; its ping timeout cancels the stream
   without recording the initiating cause. The browser SSH watcher discards Wait/
   keepalive errors, and browser operation forwarding returns only error:true.
   Native technical-hold audit generally records verification unavailable without
   the failed evidence/control dimension. Retrospective logs cannot recover that
   lost information. Current relay/nginx60s values and loaded digests are verified;
   existing logs do not prove which connection leg first failed. No relay/agent
   crash, restart or host OOM is established at the observed hold times. Kernel
   entries in the wider window concern a separate user program and do not match
   these holds. It is unjustified to blame the student network or rule out the
   relay, jump host, proxy or class host.
2. **A remaining15s startup wait.** browser-ssh/main_js.go connect still uses a
   15s context for WebSocket dial/ticket/relay-ready, despite the requested60s
   operational policy. Frozen source/image provenance proves it is shipped.
   This can reject a slow initial connection; it is not the established cause of
   an already-running SSH session ending. It is a confirmed outstanding correction.

Next bounded implementation: first add correlated, sanitized close-initiator /
copy-direction/ping/browser/pane failure categories and last verified authority
facts, without recording tickets, credentials, MFA answers, input or media. Correct
the relay bootstrap budget. Qualify >15s/<60s initial relay delay, true60s expiry,
short monitoring stalls, positive SSH close and retired-owner races through actual
browser/relay/student entry points. Logs and timeouts must never fabricate a
violation or weaken execution cutoffs. No new production change is authorized by
this review alone; any later deployment requires a new explicit instruction.
