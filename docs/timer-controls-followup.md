# Timer controls and sixty-second operational timeouts

Requested November 5, 2026. Development in progress. The timeout/delivery code and focused regressions are
implemented locally; final integration/recovery qualification is unfinished.
Nothing from this follow-up is deployed. Preserve the existing urgent-repair release and all
student history. Deployment may retain instructor sessions; it must preserve
student work and use a qualified recovery path.

## Dependency-ordered milestones

1. **Timeouts and immediate time changes.** Trace the student SSH/preflight,
   monitoring and clock delivery entry points. Use sixty-second operational
   timeouts consistently across the browser, gateway, native roles and relay;
   keep exam durations, polling intervals and resource lifetimes distinct.
   Deliver accepted clock increases promptly through the existing authenticated
   paths, including CLI requests. Report native confirmation accurately and
   preserve idempotence, original deadlines, holds and monitoring facts.
   Acceptance: public web/CLI regressions, delayed-transport boundaries, native
   clock races and authenticated outbound delivery/retry tests.
2. **Instructor timer pause and resume approval duration.** Confirm whether a
   paused countdown also freezes work, and whether the requested resume window is
   the validity of Allow resume. Implement durable, audited web and examctl
   controls using the agreed semantics. No automatic refunds or reopening
   completed attempts. Acceptance: pause/restart/resume and deadline races,
   expiry/no-expiry/revocation, fresh ownership/monitoring, browser controls and
   matching installed CLI workflows.
3. **Matched release and deployment.** Freeze exact web/native artifacts; run
   affected integration, native race/build and browser checks. Qualify migration,
   current-data recovery, admin-session-tolerant drain and reopening against the
   exact candidate. Deploy the qualified artifacts, verify public readiness and
   installed roles, and record elapsed time and remaining limitations.

## Approved decisions — November 6

- Explicit timer pause stops only the countdown: terminal work continues under
  normal monitoring. This intentionally permits untimed work while the instructor
  leaves the timer paused, superseding the prior non-pausable countdown policy.
- Customizable validity applies to Allow resume approval, including no expiry.
  Completion, revocation and the exam countdown still apply; this does not change
  the finite explicit window for starting a NEW attempt.

## Investigation

Clock management currently stages CLI intents without immediate delivery. Native
outbound deadline verification obtains pending changes only at expiry. Browser
delivery depends on the student's command transport. These are separate from
the already deployed claim/dead-SSH repair; a queued receipt is not proof of an
applied increase. Choose the smallest integrated delivery change after inspecting
the actual existing signed callback and timing protocol.

Verification and deployment receipts will be recorded here at milestone closure.

## Current local evidence and remaining qualification

Evidence directory: var/collection-tests/timer-controls.20261105a/. Full application
v2 run:817 pass/0 fail/3 opt-in skips; full native race run passes, as do relay and
browser-Go races, types/build,113 focused application checks and10 callback tests.
Actual6s TLS Begin receives its full allowance only at Start. Authenticated old
bootstrap/evidence purposes refuse; v2 identifies the60s interpretation explicitly.
The first browser run had14 passes/4 actual Start refusals because its synthetic
native server still capped capture validity at15s. That producer now uses the
shared60s bound. The corrected retained-control/SSH-cleanup run passed all5 cases;
all18 unique selected browser cases pass across the two runs.

The confirmation race was reproduced and fixed: a durable native clock record
can precede failed supervisor handover. clock_handover_pending keeps the request
in dispatch until an actual live acknowledgement; a same-revision signed callback
must carry identical history. The signed callback regression and opt-in actual
PTY/supervisor clock-live test pass, including failed handover and exact retry
without applying the increase twice. The earlier default native run skipped
systemd cases; handover-native-systemd.log is the actual opt-in receipt.

Verified SSH loss during that pending handover was separately reproduced in both
native and web entry points. The fix accepts an older clock revision only for a
negative exit proof of the exact same immutable SSH/page/input lifetime. It keeps
the actual observed owner and an unverified hold, never fabricates positive work
authority. Fresh authenticated saved-file continuation adopts the current clock
and clears pending handover only after the live authority confirms it. Both the
signed callback and actual PTY/supervisor recovery tests pass. The final full
application run passes all817 tests (3 opt-in skips). The affected actual native
supervisor matrix passes23 modes; its two expiry cases initially failed because
their test waits and fresh-command envelopes still assumed the old15s window.
Both now pass with real60s expiry, fresh signed retry and the ordinary5-minute
review approval. No production enforcement was weakened. See clock-exit-*,
native-expiry-60.log and native-pending-expiry-final.log.

The exact monitoring-timeouts-v2 installer scope includes the relay as a fifth
binary, its fixed nginx timeout snippet, and before/after loaded-role pins. It
preserves the relay's existing configuration, trust key and service definition;
it never copies the example configuration. Public operator tests pass18 native,
35 matched web and10 guard-bridge cases. The native test exercises stopped
proxy-validation refusal and same-candidate retry, protecting saved files and
trust material. These service controls are mocked; a real disposable installation
rehearsal and image/current-data recovery qualification remain REQUIRED.

The final full browser/WASM/server build passes. The restricted sandbox denied
the installed Go subprocess on the first build; the authorized local escalation
build passes. This was a permission boundary, not a missing package. The final
full native race suite passes (core273.172s); opt-in privileged cases remain
separately qualified, never inferred from the default suite.

No deployment readiness claim follows these first-increment results. The
approved controls' implementation and current verification follow below.

## Approved controls: current implementation increment

Resume validity is implemented locally with custom minutes/no-expiry, ordinary
five-minute default, durable exact retries, useful CLI flags and direct browser
controls. Native fresh SSH initially rejected the long validity due to its old
five-minute metadata cap. The actual registration regression reproduced that
refusal; the fix retains deadline/completion/generation/hold refusal and requires
fresh monitored Continue. UI/API14, actual root-CLI/TLS, browser3 and actual native
fresh-SSH tests pass. See current checkpoint for exact receipts.

Native countdown pause also passes actual signed-command/PTYS/supervisor testing
past an original one-minute deadline. It records paused time and remaining time
in existing clock revision history. A private runtime boot ceiling removes only
the countdown bound: positive capture/control evidence remains bounded by60s.
Resume binds native wall/boot application time and the saved remainder, preserving
original deadlines, request identity, shells and buffers. Web/student presentation,
authenticated admin HTTP, compiled root examctl/TLS/restart workflows and strict
scripting projections are implemented. Both expired unpaused timers and finished
protected submissions still refuse new timer changes.

All 28 opt-in actual supervisor/PTYS/user-systemd scenarios pass in
supervisor-timer-final.log (356.213s). This includes real work beyond the original
one-minute deadline, steady paused remainder, immediate adjustment, explicit
resume, and recording-failure hold despite a paused timer. Paused SSH loss then
fresh files-only continuation retains the pause, original interval, source and
account hold; an explicit countdown resume succeeds on the new live authority.
Its first failure was the synthetic SSH process's unchanged20s lifetime. Only
that short-grant test now uses a2min owned peer lifetime; an actual early peer
exit correctly revoked authority. Protected Finish after the old deadline keeps
the actual end instant, and restart cannot reopen its submission.

The server expiry sweep and retained-SSH gateway restore still compared the old
wall deadline directly. Focused regressions reproduced both refusals; both now
use authenticated effective timer state. All19 focused interface tests pass.
Full native races pass (core273.605s). The application run passed820 tests with
one migration-fixture mismatch: Store now also derives two zero timer fields.
The corrected fixture asserts both zeros and equality of every stored field;
its two cases pass. No schema migration is introduced.

Final browser qualification also found the confirmation helper's old15s bound
and its16-entry queue, which could evict an otherwise-valid60s heartbeat. It now
shares60s and retains at most64 outstanding confirmations. A focused one-minute
delayed-receipt regression passes, with unrelated/replayed/expired receipts still
refused. The broader browser run had82 passes and two timing-fixture failures.
Both corrected cases now pass: the real retained WASM test verifies no premature
reconnect and actual60s recovery; the paused-input test uses ONE real clock for
browser/server/socket replies and works past its actual one-minute deadline.
Virtual browser jumps had outrun asynchronous replies and manufactured an
unrelated coordination loss. All84 unique selected browser scenarios pass across
the broad/corrected runs. The full application suite is rerunning against the
final frozen runtime. Exact image/release readiness is still separate.

The actual four-file installer rehearsal passes in the guarded root guest. The
additional real relay/nginx rehearsal initially refused missing nginx scratch
directories. Its fixture now declares all temporary paths under private /run;
the host-installed nginx and libraries are reused read-only. No missing package
was installed and the prepared guest base/production remain unchanged. The
production guard checksum was also refreshed, with an unmocked checksum test.
The final real five-binary rehearsal passes, including stopped invalid-nginx
refusal, exact-candidate retry, actual proxy reload and preserved trust/config.
All seven real SSH/workspace/collection/original-deadline assertions pass, with
unchanged live installation/authority/base. An independent check confirms the
owned unit is inactive, MainPID0 and no owned processes remain. Receipts:
native-install-root-4.log and native-install-qualified.json. Exact image,
shipped-WASM joined controls and current-data recovery remain REQUIRED before
production fencing.
