# Current checkpoint — native hold email fixed locally; closure diagnostics next

November23 notification milestone: signed native LOCKED callbacks now atomically
record the interruption and its existing durable email episode. Gateway/native
overlap, replay/restart, student requests, explicit notification suppression and
successful recovery preserve one notice per interruption. No clock, hold,
authorization, SMTP retry or15-second notification-grace policy change.
53affected application tests (including actual synthetic SMTP),5notification
browser workflows, typecheck and server build pass. Old implementation fails the
new signed-callback regressions. [Plan/evidence](native-hold-alerts-and-disconnect-observability.md).
Private receipts: `var/native-hold-alerts/20261123/`.

Next authorized action: add bounded current-transport browser socket-close and
lifecycle diagnostics, plus useful proxy log timestamps, after the read-only
incident investigation found no initiating cause. coder/websocket1.8.15 maps
normal/going-away closes to EOF, losing the historical code. No production change
or email was sent. Do not stop after the notification increment; diagnostic work
remains authorized. No open policy question.

## Previous local milestone — one display

November23: opt-in **Require one display** is available in Exam settings and
`examctl web exams create|update --single-display on|off`. Existing exams default
off. Preflight/Start/resume need a positive Window Management API display check;
live topology changes use the existing shared15-second grace and pause typing.
Unsupported/denied/revoked verification is technical uncertainty. An authenticated
unknown notification immediately invalidates live facts/pending positives, with
fresh capture/current authorization required to restore work. Saved grants,
original clocks, historical attempts, holds and native proof/owner formats remain.

Validated local increment: focused protocol/readiness/ledger/HTTP tests, ordinary
and required-display SSH-to-Start, the actual native proof verifier, signed
management, CLI help/argument/reply race checks, typecheck/build,17student/policy/
grace browser cases and1mobile instructor setting case pass. Actual Chromium API
verifies its single headless display; topology/revocation cases use explicit API
fixtures. Physical multi-monitor/human consent acceptance and exact installation/
preservation/recovery qualification remain. [Scope/evidence](one-display-policy.md).
Private receipts/frozen inputs/images: `var/one-display/20261123/`.

This milestone is local only; no push, deployment or production policy change.
No open design question. Previous local commits c1482ef (pause choices/clock
refresh) and a2857a8 (FUTURE architecture evaluation) also remain local.
Last deployed runtime/controller remains df3c434, November22 on csc-sys;
[deployment/recovery](interruption-grace-release.md). Larger35/70capacity remains
unqualified. Do not reuse local functional evidence as release readiness.

Next action only on a new instruction: qualify a frozen matched web/CLI release,
including preservation/recovery and consenting synthetic physical-display/browser
acceptance before enabling for a class. No SQL/native-authority migration is
needed. Preserve ten pre-existing modified documentation PNGs, left unstaged.
