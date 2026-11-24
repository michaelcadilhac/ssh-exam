# Native hold alerts and SSH closure diagnostics

November 23 implemented/tested locally; pushed and deployed November 24. See
[matched deployment, qualification and recovery](display-alerts-release.md).
Private incident evidence stays outside Git under
`var/investigations/` (private).

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
authority still had about 41 seconds remaining. This was not the shared 15-second
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
cancels pending mail; another generation may notify again. The existing 15-second
notification grace and SMTP retry/Message-ID policy are unchanged. Paused countdown
wording is accurate. No deadline, hold, approval or execution rule changes.

The initial signed-callback regression fails against the old implementation for
both retained and legacy attempts. The fix passes 53 affected application tests,
including real local SMTP, restart/replay, gateway/native overlap, suppression,
continuation cancellation and injected outbox refusal/atomic retry. Typecheck and
server build pass. SMTP MIME soft wrapping and its existing five-second dispatcher
cadence are accounted for in the fixture; the original failed receipts are kept.
Private evidence: `var/native-hold-alerts/20261123/`. No production mail was sent.
Existing `examctl web alerts list/show/remind` and web Notifications cover the new
episodes without a new management API or command.
All 5 notification browser workflows pass using the prior, byte-verified unchanged
web build with the current local server. Source/native authority/CLI execution
formats are unchanged by this notification fix.

## Closure investigation — established limits

The exact student's sshd process logged session closure at 22:28:00.566 Chicago,
following the relay EOF and before the native technical hold. It logged no more
specific transport cause. No matching nginx error was found. Relay and agent
were running since earlier dates with zero service restarts. Nginx's existing
safe access format omits timestamps/durations, so it cannot establish the exact
historical WebSocket close request. No capture pixels or student files were read.

The installed coder/websocket 1.8.15 byte adapter explicitly translates normal
close 1000/going-away 1001 into `io.EOF`. The historical relay EOF/close_code=-1
therefore cannot distinguish a normal WebSocket close from its original cause.
It is not evidence that the student caused the disconnect or that the network
failed. Additional diagnostics now retain the browser CloseEvent and deliberate
local closure/lifecycle context before that translation; no enforcement changes.

## Closure diagnostics — implemented/tested locally

The SSH worker installs a transparent observer around its native browser
WebSocket before Go starts. Only the exact selected relay URL/current connect
lifetime is observed; old sockets/retired workers cannot report against a
replacement. The observer preserves native constructor/close arguments and
errors. It captures CloseEvent code and `wasClean` before Go's byte adapter loses
them, socket error occurrence, and a deliberate WebSocket close call. It never
reads or reports data messages, close reason text, URLs, tickets or credentials.
The producer deduplicates and caps output at 12 events per connect lifetime.

The existing authenticated control/worker IPC carries these optional fields:
`close_code`, `was_clean`, `visible`, `focused`, `online`, `page_persisted`,
`close_intent`. Main-thread closure requests distinguish replacement, transport
loss, worker error, server-requested close, recovery expiry and sign-out. A
sign-out request is observed before the existing cleanup API; it does not close
SSH early or imply that the request succeeded. Page hiding/visibility and
online/offline events use the same diagnostic path. Snapshot booleans describe
the browser at reporting time; they are untrusted hints, never proof of a physical
network fault, student intent, monitoring compliance or misconduct.

The strict shared schema rejects raw/unknown fields. The gateway retains the
existing 32 ordinary diagnostic-key budget plus reserved deduplicated socket/client
close observations. Server-owned account/exam/attempt/relay-reference correlation
is unchanged. A failed diagnostic sink drops metadata without closing control,
terminating SSH, changing input authority or altering any timeout/deadline. There
is no extra probe, periodic request, service, permission, management action or
native authority/CLI wire change. Existing authority/hold code remains unchanged.

Both nginx site templates append ISO/millisecond time, connection ID, request
duration and upstream status/connect/duration to the existing safe access prefix.
Paths remain `$uri`; queries, cookies, authorization headers and request bodies
are not logged. This enables joining an error's connection number and the
relay/browser observation window without exposing a signed ticket. Existing
logs without those values cannot be repaired retrospectively.

Focused/gateway 37 checks pass, covering privacy, stale sockets/workers, duplicate/
bounded output, sink failures, original API errors and unchanged input authority.
All 5 actual WASM/browser close/lifecycle cases pass: close 1000, 1001, 4001 and abrupt
1006 reach the gateway through the real worker IPC with correct clean/unclean state,
correlation and no private close reason. Explicit lifecycle fixtures exercise the
real preflight handler/control path without starting or locking an attempt.
Typecheck/build and targeted native client/relay diagnostic race checks pass.
Actual local nginx/TLS tests pass for both templates, fenced/normal routing,
reload, timing-field output and query-secret exclusion, with cleanup receipts.
Private inputs/receipts: `var/ssh-close-diagnostics/20261123/`.
The final 22-case browser cohort passes: new close/lifecycle cases, actual
16-second/60-second relay startup boundaries, real WASM typing and grant Begin,
notification management and the complete existing interruption-grace cohort.
Test inputs and built public assets stayed frozen. All owned nginx/upstream,
browser/SSH fixture runners and listeners are checked for cleanup before closing
the milestone. No optional class stress or unrelated release work was added.

These are best-effort observations. A browser/process crash, abrupt power loss or
failure of every outbound channel can prevent their delivery. Missing diagnostics
do not establish a violation or a particular cause. Close 1000/1001 is not proof
that a human chose to leave. Raw browser reason strings remain deliberately absent.
No physical network/hardware failure or privileged native-kernel/capacity test is
claimed by these changes.

## Operator inspection and release boundary

Use the supported `examctl info ATTEMPT --read-only` for native recorded state,
`examctl web attempts show ATTEMPT` for the web view, and
`examctl web alerts list/show/remind` or Notifications for alert episodes. An alert
marked sent means SMTP accepted it, not confirmed inbox receipt. Do not run a test
email or a manual reminder without explicit authorization.

For closure details, inspect `ssh-transport-diagnostic` in the web service's
existing structured logs/audit and match its `relay_reference` to
`exam-ssh-relay.service`'s `reference`. Use bounded `journalctl --since/--until`
windows and the matching native hold/sshd process. New nginx `time`, `connection`,
`request_seconds` and upstream fields add proxy timing context. Keep raw diagnostic
evidence private; no submission/screen/terminal content is needed. A recorded
native ACTIVE or browser-positive flag alone is not live execution permission.

Release preparation must freeze the matched web image/worker/assets and rendered
nginx candidates, then qualify the existing preservation/recovery/reopening path.
There is no database migration or required native agent/relay/CLI replacement.
Install/reload only nginx's qualified site configuration during the authorized
cutover; do not restart SSH, the relay or native exam services for these changes.
Preserve current database/outbox/episodes, history and native state for rollback.
A compatible old web image reads the additive records but restores the native
notification gap and lacks new close diagnostics. Old nginx formatting loses
timing context. The separate November 24 instruction authorized the matched
cutover now recorded in the release document.
