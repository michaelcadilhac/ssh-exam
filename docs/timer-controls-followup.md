# Timer controls and sixty-second operational timeouts

Requested November5,2026; deployed November6 at09:36:52UTC. The matched web/native
release is ONLINE and final acceptance passes. The qualified recovery below
preserved the running candidate, original snapshots, prepared controller and
current student history; its separate verifier follows the approved60s lifetime.

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
the broad/corrected runs. The final full application suite passes822 tests,
zero failures and three existing opt-in skips. Exact image/release readiness is
still separate.

The actual four-file installer rehearsal passes in the guarded root guest. The
additional real relay/nginx rehearsal initially refused missing nginx scratch
directories. Its fixture now declares all temporary paths under private /run;
the host-installed nginx and libraries are reused read-only. No missing package
was installed and the prepared guest base/production remain unchanged. The
checksum review initially confused the native guard producer with its read-only
bridge. The installer's original producer pin is correct and is restored; the
unmocked checksum test now compares the actual native-rollout-guard.py producer.
Never infer a hash's target merely from a similarly named guard file. This
controller-only correction does not change the qualified application/native
runtime, five-file installation flow or unchanged production guard.
The final real five-binary rehearsal passes, including stopped invalid-nginx
refusal, exact-candidate retry, actual proxy reload and preserved trust/config.
All seven real SSH/workspace/collection/original-deadline assertions pass, with
unchanged live installation/authority/base. An independent check confirms the
owned unit is inactive, MainPID0 and no owned processes remain. Receipts:
native-install-root-4.log and native-install-qualified.json. Exact image,
shipped-WASM joined controls and current-data recovery remain REQUIRED before
production fencing.

Exact first image passes schema37/history/media/native-clock smoke and real
startup/current-data forward recovery:63.04s,13 signed polls, expired nonce and
expired policy refusal, existing tombstone/due physical-purge recheck,11 mutation
refusals,41 preservation contracts and recovery of the already-running candidate
without replacing its snapshot. Local actual nginx/TLS/maintenance/browser and
proxy checks also pass, with owned processes/TLS keys cleaned.

The joined shipped-WASM/real-native timer+files-recovery test reached live
pause/edit/no-expiry authorization and found a real student rendering bug:
Workspace passed the no-expiry sentinel to Date formatting. RangeError unmounted
the page and stopped capture. The focused browser reproduced the empty page;
the fix prints "Approval does not expire" and preserves the mounted recovery
page/terminal without a browser error. Status copy no longer incorrectly claims
the countdown always runs. That UI correction requires a newly frozen image and
joined rerun; the first image is NOT eligible for deployment. Earlier queued
capture failures were this rendering crash, not missing camera evidence or a
native timer failure. Temporary timer instrumentation was removed before final
qualification; bounded response/browser diagnostics remain in the test.

## Frozen corrected release — locally qualified, not deployed

Runtime source5ed57ca2b8a79134207d81d32ca99e498e4b8e5d; image Config
1942b7f9311561fe6b8da50674abe80a3854673b0575a0e9f371f4f8e159df52.
Export8e45004bf7e47690c01472d781fd9a511a6b485ab8f2cc17840d86d81a23aa46,
295880704bytes. The corrected image was built once in25.92s. All eight shipped
assets, Config bytes and rootfs diff IDs are pinned independently of the source
engine's manifest identity. Native ELF files are unchanged from their qualified
build; original dirty documentation screenshots remain untouched.

Final same-schema/history/media smoke passes. Real startup/recovery passes in
63.07s with13 signed polls,41 preservation contracts,11 mutation refusals and no
replacement snapshot/additional start. The exact shipped browser/native journey
passes in50.2s: live pause and immediate95min saved remainder, no-expiry approval,
actual SSH loss and fresh files continuation preserving that pause, explicit
countdown resume and protected Finish on the SAME attempt. Real loaded roles
use no test readiness override. Independent guest checks confirm exact native
hashes, inactive unit/MainPID0/no owned processes and unchanged host/base.
See packaged-browser-native-final.log, packaged-browser-native-root.log and
packaged-browser-native-cleanup.json. The synthetic jump/MFA/media remain explicit
seams; this is not a new human production exam.

All ten continuation browser cases pass, including the new no-expiry crash
regression. Native/authority/server sources are unchanged by the rendering fix;
their822 application/full-race/28actual-supervisor receipts still apply, with
focused continuation unit/type/build checks covering the final presentation.
Actual local nginx master/worker reload uses the production reopening predicate
and current normal/fenced templates: public reopening0.220s, master preserved,
owned processes and synthetic TLS keys removed. Maintenance/browser/ordinary
refusal paths also pass. Five-file native installer and current production guard
producer pins are distinct and correctly frozen.

The generated matched manifest validates against the real controller. Online
preparation must reuse verified current-image coverage/shared immutable media,
take fresh current snapshots and retain zero student/unfinished-attempt guards.
The explicitly authorized admin-only sign-out may be audited without asking
again. Native roles/relay and web must be installed together; rollback is
forward-only using the matched candidate with CURRENT data, never an old writer
or historical database restore. Unexpected post-fence errors get one30s read-only
diagnosis and qualified recovery, preserving the fence if unresolved.

## Held cutover and qualified proof-only recovery — November 6

The native cohort verified successfully; web startup then refused a legitimate
60-second signed request because the preservation verifier still expected at
most 30 seconds plus its one-second clock tolerance. The synthetic startup
producer had also retained its old 30-second default. This qualification gap
extended maintenance; it was not a student violation or an authority mutation.

The corrected verifier follows the real producer's 60-second bound, retaining
agent identity, original nonce/history/audit checks and justified pruning.
The regression fails against the old verifier; all34 preservation tests pass
with the correction. The unchanged controller's35 tests and five proof-repair
pin/refusal tests pass. Exact-image startup now uses real signed60-second
requests:63.06seconds,13polls,41preservation contracts,11mutation refusals,
and recovery of CURRENT data with no additional start or replaced snapshot.

scripts/deploy-web-ui-proof-repair pins the original controller and proof plus
the corrected proof in a separate private directory. It permits only status or
resume of this already-running, matched candidate; service/container replacement
is blocked. The original prepared inputs and database snapshot remain intact.
Evidence: proof-repair-image.log, proof-repair-matched-controllers.log,
proof-repair-focused.log and preservation-60-green.log in the evidence directory.
The proof-only recovery completed in16.38seconds and reopened the site at
09:36:52UTC. It preserved the existing container start time, original snapshot
SHA c73ea206109e415d41e1c4931002c6dd07a89f5b4645a028cd0ccbdc4d42425a,
all41authority tables, prior audit/management requests and21verified physical-purge
rechecks. Exact owned video pause is RELEASED. Public TLS/all8asset hashes,
readiness/notifications, all5installed binaries/4loaded roles, relay trust,
timer/no-expiry CLI help and an authenticated sandbox-definition read pass.
No student clock, permission or attempt was changed for acceptance.

Instruction-to-reopening elapsed4h42m08s, including development/qualification;
maintenance21m23.67s. Online preparation11.27s reused1047562391media bytes with
zero new media; fresh web snapshot122945536DBbytes+343358small bytes. Native
backup230666240bytes is retained with its checksum. This was not a fast UI-only
release. The production refusal exposed a fixture mismatch despite extensive
feature tests; future qualification must retain the actual60s producer case.
No unrelated tests or features were added after reopening.

Runtime source5ed57ca; qualification2926c6f; proof repair e9bfe5b. Recovery remains
forward-only using this matched cohort and CURRENT data. Never restore the
historical snapshot over newer student records or reopen an older native/web
writer. Original prepared inputs and proof stay unchanged in their stage;
separate root-private repair receipt pins all three verifier/controller hashes.
Evidence: public-acceptance.json, native-acceptance.json, web-acceptance.json,
proof-repair-resume-completion.json and the per-phase production receipts.
