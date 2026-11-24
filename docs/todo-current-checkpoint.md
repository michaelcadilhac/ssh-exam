# Current checkpoint — native alerts and SSH close diagnostics complete locally

November 24: release preparation and deployment are now explicitly authorized.
The exact combined controller scope passes all 66 public-controller regressions;
CURRENT-data/image/CLI/nginx qualification is in progress with production online.
[Current release plan](display-alerts-release.md). Earlier blocked attempt follows.

Earlier November 24 push/deploy instruction: deployment stopped before maintenance.
The pending set includes the one-display server policy and matching examctl
flag, not just UI changes. `scripts/deploy-web-ui` has no registered reviewed
web/CLI scope for that combination, and no frozen matched image/CLI installation
and CURRENT-data recovery qualification exists for it. Reusing an older scope
or attesting unchanged backend/CLI would be false. Production remains unchanged;
no maintenance, service operation or student-record change was attempted.
The instructor explicitly authorized the existing public destination after
automatic approval review requested that clarification. Push to
`https://github.com/michaelcadilhac/ssh-exam` succeeded November 24 through
18b54b9, including functional tip bda731e and all earlier pending commits.
The audited 62 changed paths exclude data/key/environment/archive paths and
checked private-key/incident markers. Public HTTPS returned 200 during the
deployment check. Ten pre-existing documentation screenshot edits remain local
and unstaged. Public-push permission is resolved; release qualification remains
the deployment blocker. No guard was weakened.

Release-preparation milestone required before another cutover: register/review
the exact combined web/CLI policy transition, qualify its admin-only drain and
forward CURRENT-data recovery, freeze the matched image/CLI/nginx candidates,
and run exact-image startup/preservation/recovery. Keep one-display enforcement
off pending physical-display acceptance. This is a release blocker, not another
application feature or a request to approve routine local work.

November 23: native LOCKED callbacks now atomically record the interruption and
its durable notification. Gateway overlap, replay/restart, student requests,
explicit suppression and recovery preserve one notice per interruption.
Local notification commit: 2e8fd61. No clock, hold, approval or mail-policy change.

Read-only investigation found no initiating SSH cause. The byte adapter maps
normal/going-away closes to EOF, losing their original codes. New bounded browser
diagnostics retain socket code/cleanliness, deliberate close requests and page/
network observations; nginx candidates add safe timestamps and durations.
These hints never change enforcement or establish misconduct. Both milestones
are implemented/tested locally; no production changes or emails were sent.
[Scope, findings and operator inspection](native-hold-alerts-and-disconnect-observability.md).

Verification: 53 affected notification checks, 37 diagnostic/gateway checks,
5 notification browser checks and the final combined 22-browser cohort pass,
along with typecheck/build, native diagnostic races and actual nginx/TLS/reload/
privacy checks. All 62 frozen source/assets match; owned runners/listeners are
gone. Private receipts: `var/native-hold-alerts/20261123/` and
`var/ssh-close-diagnostics/20261123/`. No open decision or remaining task blocker.

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

Next release milestone: prepare a frozen matched release and
qualify preservation/recovery/reopening, including the nginx logging reload.
Physical-display/browser acceptance remains before enabling the one-display
policy for a class. No database/native-authority migration is needed for these
increments. Preserve ten pre-existing modified documentation PNGs, left unstaged.
