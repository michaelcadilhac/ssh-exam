# Native hold alerts and SSH closure diagnostics

November23 local work in progress. No deployment or production mutation is
authorized. Private incident evidence stays outside Git under
`var/investigations/`.

## Bounded delivery plan

1. Reproduce the missing email through the authenticated native callback entry.
   Make new native interruptions use the existing durable interruption email
   episode, grace, contextual wording and recovery cancellation. Preserve
   gateway-first deduplication, review messages, restart/replay, generations,
   deadlines and holds. Acceptance: one actionable notice through local synthetic
   SMTP; no mail after prompt recovery, stale callback or repeated observation.
   Commit the validated alert fix locally.
2. Investigate the exact relay reference, native hold, nginx and host SSH logs
   around the closure, read-only. If the initiating browser/network action cannot
   be established, add bounded metadata to the existing diagnostic flow: browser
   socket close code/cleanliness, deliberate local close and page/network lifecycle
   observations, scoped to the current transport. No SSH/media/credential/error
   text, raw URLs or reusable tickets. Diagnostics must never grant/revoke work,
   trigger misconduct or change existing timeouts. Acceptance: privacy/schema,
   stale-socket/worker and actual browser/WASM closure interface regressions.
   Commit the validated diagnostics locally.
3. Run affected application, native race, type/build and built-browser checks at
   coherent boundaries. Document facts versus unknowns, operational inspection,
   tests and release limitations; update the current checkpoint and TODO. Stop
   at local completion; no push/deployment, production mail or service restart.

## Confirmed starting points

The investigated interruption came from a native technical hold following a real
SSH exit. The relay's first completed copy was browser-to-jump with EOF; native
authority still had about41seconds remaining. This was not the shared15-second
grace or authority freshness expiring. Browser focus had just been lost while
fullscreen, page visibility and both capture sources remained positive. Those
facts do not establish a physical/browser cause.

The web recorded the interruption and later instructor-approved resumption, but
created no alert episode or outbox row. `Lifecycle.lock` queues an interruption
email; the native LOCKED reconciliation path records history without that step.
No SMTP delivery was attempted. A later explicit student review request can
create a fallback notice, but none was recorded in this case.

## Alert fix — implemented/tested locally

Native LOCKED reconciliation now records the hold, interruption history, incident
and notification together. It shares the existing gateway incident/notice creator.
Callbacks, status polling and restart preserve one notice per interruption; later
student requests update the same episode. Existing explicit `notify:false` locks
remain suppressed because their incident is already recorded. A continuation
cancels pending mail; another generation may notify again. The existing15-second
notification grace and SMTP retry/Message-ID policy are unchanged. Paused countdown
wording is accurate. No deadline, hold, approval or execution rule changes.

The initial signed-callback regression fails against the old implementation for
both retained and legacy attempts. The fix passes53affected application tests,
including real local SMTP, restart/replay, gateway/native overlap, suppression,
continuation cancellation and injected outbox refusal/atomic retry. Typecheck and
server build pass. SMTP MIME soft wrapping and its existing five-second dispatcher
cadence are accounted for in the fixture; the original failed receipts are kept.
Private evidence: `var/native-hold-alerts/20261123/`. No production mail was sent.
Existing `examctl web alerts list/show/remind` and web Notifications cover the new
episodes without a new management API or command.
All5notification browser workflows pass using the prior, byte-verified unchanged
web build with the current local server. Source/native authority/CLI execution
formats are unchanged by this notification fix.

## Closure investigation — established limits

The exact student's sshd process logged session closure at22:28:00.566Chicago,
following the relay EOF and before the native technical hold. It logged no more
specific transport cause. No matching nginx error was found. Relay and agent
were running since earlier dates with zero service restarts. Nginx's existing
safe access format omits timestamps/durations, so it cannot establish the exact
historical WebSocket close request. No capture pixels or student files were read.

The installed coder/websocket1.8.15 byte adapter explicitly translates normal
close1000/going-away1001 into `io.EOF`. The historical relay EOF/close_code=-1
therefore cannot distinguish a normal WebSocket close from its original cause.
It is not evidence that the student caused the disconnect or that the network
failed. Additional diagnostics will retain the browser CloseEvent and deliberate
local closure/lifecycle context before that translation; no enforcement changes.
