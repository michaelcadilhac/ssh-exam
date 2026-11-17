# Manual pre-final stress suite

This suite is run only on explicit instructor request, never by deployment.
Current development target:70 synthetic students/280 terminals and90 real minutes,
followed by simultaneous submission. No institutional MFA, actual student accounts
or outbound email. Use independent test keys, storage and loopback mail capture.
Production state, deadlines, services and submissions remain untouched.

## Dependency-ordered milestones

1. Extend the existing guarded disposable native/browser fixture to the explicitly
   selected70-student endurance mode; retain the existing1/16-student modes.
   Acceptance: bounded resources/lifetime, exact synthetic roster, idle/preservation
   guards, exact code-only bundle, loopback-only callbacks/mail, inspectable cleanup.
   Tests: runner/bridge safety contracts, fixture typecheck, short composed rehearsal.
2. Execute the actual browser/WASM/SSH/native fleet through sign-in, setup, four
   terminals,90-minute monitored work and simultaneous protected submission.
   Record ramp, latency, resource usage, unexpected interruptions and archive proof.
   Refusals/capacity failures remain failures; do not relax product enforcement.
3. Run application/integration, native race, build and the ordinary browser suite
   plus separate guarded native fault/recovery
   workflows. Prof independently evaluates rendered student/admin workflows, mobile
   layout, terminology and error recovery. Separate simulated boundaries explicitly.
4. An agent writes a dated report under reports/stress/RUN/ with results, limitations,
   UX findings, suggested solutions and severity. Preserve raw evidence privately
   under var/stress/RUN/. Commit coherent validated suite/docs locally; no push/deploy.

Current status:861application checks and three normally gated real CLI/export/
bwrap workflows pass for the unchanged application runtime. Native races,
86harness checks,16-client WASM sign-in and native editor/timer/recovery/
collector-crash workflows pass with independent cleanup/preservation. Full
browser2 completed360passes/threefailures/fiveskips; a separate fresh five-case
run passes without erasing the full-run failures. Prof reviewed28rendered screens.
No70-student/90-minute/protected-completion pass exists.

Marco is the approved generator. Earlier partial ramps/failures remain in the
agent report. Full6 was a deliberate early stop after35GCC/GDB students/140panes:
the measured2,183-task guest sample projected beyond its4096-task cap at70.
Exact private abort and native/Marco/local cleanup pass; host preservation FULL.
The70-person parent now has8192tasks, retaining3GiB/no-swap/2CPU/fourhours.
1/16-person modes and all actual student-policy limits are unchanged.30focused
overlay checks and all86harness12 contracts pass. Audited v13 changes only the
29,264-byte bootstrap;18other code files/guest manifest/native binaries are reused.
Actual8192-task kernel bounds were verified in full7.

Full7 failed after42.3min,38GCC/GDB students/152panes. The39th student received an
actual SSH pane-admission refusal on the fourth pane; all39 failure snapshots were
ACTIVE/gen0. Independent native/Marco/local cleanup and host preservation pass.
No70/90pass. All70welcome pages were preloaded and late main-frame navigation was0,
yet194network-change cancellations occurred. Small worker-initialization controls
recorded no errors; their absence does not diagnose the larger fleet failures.

The private observer now retains at most eight256-character errors for pane-open
RPCs, excluding authentication/MFA requests and tokens. A positively observed
ordinary terminal-admission refusal is recorded, including a private native
snapshot, before one public Close/New terminal retry. Fresh unchanged ACTIVE/gen0
ownership is required; pending opens, changed/held attempts and other errors are
never replayed. A second refusal stops that workflow. A recovered refusal remains
a final test failure and fails the independent endurance receipt validator. This
allows collecting endurance/recovery evidence without relabelling a flawed run
clean. No product permission, timer, grace or enforcement changes.
Qualification:37unit cases,14runner checks,14affected browser workflows and final
typecheck pass. The first UI-only fixture bypassed its declared page routing;
that failure is retained, and the corrected browser-fetch fixture passes. The
underlying real native refusal remains unproved until another observed event.

Full8 also failed: seven students/28panes passed before the eighth setup displayed
Workspace error/Failed to fetch over the webcam control. A capture-challenge
request was cancelled; later samples succeeded but the modal remained. The clock
never started. All seven failure snapshots were ACTIVE/gen0; native/Marco/local
cleanup and original preservation pass. No further full-cohort retries were run.

The bounded steady-traffic diagnostic reproduced17network-change cancellations
without navigation or a native guest:14HTTPS and3HTTP in95seconds. They clustered
67–78ms after Marco logged new virtual interfaces, with further cancellations
following. Existing WebSockets stayed connected. This demonstrates generator-side
interference independent of page creation; it is not an error-free qualification
or proof of the cause of every historical error. Earlier short TLS/page controls
were temporally confounded and do not establish that ignored certificates caused
those failures. Neither preloading nor the small preflight fixes this instability.
Next remediation should isolate the generator's network and observe steady
traffic across several62-second cycles before allocating a native guest. No
global network configuration or unrelated job was changed. Details and suggested
fixes are in the agent report. The70-student/90-minute target remains unqualified.

Confirmed P1 baselines remain open:installed32workers<70; shared anonymous
180requests/minute bucket rejects30of210minimal cold loads. Isolated96workers
does not fix production or qualify co-location on the8GiB class server.
Production baseline remainsed09efc/schema37; no service/configuration/student
record changed, maintenance used, source pushed or release deployed.
Per-run report/raw receipts preserve all failed and controlled-stop evidence.

## Explicit entry point

Ask Codex to run this suite; it must arrange the independent Prof evaluation and
write the final report from the machine receipts and rendered review. Automated
completion alone is `AWAITING_AGENT_REVIEW`, never a full qualification claim.

Build a new code-only bundle locally with
`python3 scripts/build-stress-bundle.py var/stress/NEW-BUNDLE`. Audit its exact
manifest and upload those19files only to a NEW private
`/var/tmp/ssh-exam-browser-native-upload.NAME` on the authorized test host. No keys,
configuration, student records or submissions belong in an upload. Existing host
and guest-base idle/preservation checks must pass; never clear or relax them.

Run `npm run test:stress -- --native-bundle /var/tmp/ssh-exam-browser-native-upload.NAME`.
`--phase harness|build|installed-capacity|anonymous-burst|application|operator-integrations|native-race|browser-signin|browser-corners|native-editor|native-timer-recovery|native-recovery|native-collection|endurance`
and `--run-id RUN`
allow resuming an explicitly requested run while retaining every previous receipt.
Reuse the recorded bundle when its exact code hashes are unchanged; a new phase
alone does not require rebuilding or uploading the same native binaries.
The `--rehearsal` option uses30seconds at full70-person load to qualify the harness;
it cannot count as a90-minute pass and cannot be promoted under the same run ID.
The config is separate from default Playwright discovery and deployment scripts.

Use `--generator marco` with `--phase endurance` (or `all`) for the approved larger
generator. It transfers only the existing Playwright runtime and synthetic worker
to a fresh private Marco directory. Installed Node/Chromium run in an owned user
service:20GiB maximum RAM,18GiB high watermark, no swap,8CPU quota,4096tasks and a
four-hour lifetime. Fresh profiles, actual cgroup bounds, ancestor headroom and
loopback-only listeners are verified. Chromium shared pages use existing tmpfs
under the same memory cgroup;12GiB startup and4GiB live shared-memory headroom
are required, as well as the independent root-disk guard. Private SSH forwards carry browser traffic
to the local gateway/relay; no retired Marco exam service or production data is
changed. A two-context isolation/media/HTTP/WebSocket smoke precedes the guest.
Every run records worker identity, resource observations and exact-unit/browser/
tunnel cleanup. Unknown cleanup blocks another run. On interruption, independently
check the native guest and local fixture too: wrapper exit alone can leave them
active. Use only the qualified exact-stage private abort and verified owned local
fixture termination, then retain preservation/stop receipts before another run.
This topology includes an
intercontinental test-generator link; it does not certify co-located production
web/native capacity or campus latency.

The runner creates a fresh private workspace `temporary` directory for each
endurance attempt and supplies it as TMPDIR. A real child-Node routing probe runs
before the guest. Require40GiB free before launch and8GiB live headroom: retained
raw synthetic recording data hit the development/tmp user quota at53starts.
No recording or enforcement failure is ignored to get a pass. Preserve failed
data and receipts; relocate only exact stopped test scratch after hash verification.

The installed-capacity phase reads only the installed connection-worker limit and
fails when it is below70. It never changes the installation to obtain a pass.
The anonymous-burst phase measures the real shared-IP rate budget with70minimal
public bootstrap sequences, without authenticating or creating attempts. A refusal
is a product capacity finding, not permission to reset or relax security limits.
The16-client real WASM sign-in cohort runs in its own fresh browser-signin phase;
browser-corners explicitly skips that cohort to avoid reusing an already exhausted
anonymous budget. That skip requires the separate phase's completed result.
The operator integrations explicitly enable existing root-mapped CLI management,
recording export and lightweight zsh/bwrap grading cases using synthetic files;
their default application-suite skips are not treated as passes.
Native recovery tests use16students/64terminals with a75-second proof-transport
outage, long enough to observe expiry of the existing60-second evidence window;
coordinator role PIDs must remain unchanged.
Native collection tests include concurrent508MiB collections, actual isolated
worker death and protected retry. These are separate from the70-person endurance.
The single-student native editor phase verifies retained shells/editor buffers
through actual holds and gateway replacement. Timer recovery verifies countdown
pause with continuing work, allowance increase, genuine SSH loss, reviewed
same-attempt restoration from files, no-expiry approval and protected completion.
The ordinary browser phase explicitly enables its real gateway-process restart
fixture; native-only skips are reported separately.
The Marco path runs both the existing HTTP/WebSocket/media smoke and
`tests/fixtures/stress-https-smoke.ts` before allocating a native guest. The
HTTPS check prepares13contexts and requires overlapping in-page traffic without
failures or late document navigation. Its deliberate navigation control is a
development-only negative check, never enabled by the normal runner. Existing
per-context synthetic-certificate handling is retained; no production trust store
or TLS setting changes.

Before the first sign-in, the endurance prepares all70real welcome pages with
media/bootstrap observers already installed. Four-second spacing preserves normal
anonymous limits; the separately failed cold-burst baseline remains failed.
The public attempt list must still be empty. Authentication/setup/work then use
the existing SPA pages, keeping document startup separate from measured work.
Own every context before page creation so partial warmup
is cleanable. The70-person native parent has8192tasks/3GiB/no-swap/2CPU/fourhours;
its actual kernel bounds are checked at startup. Smaller cohort bounds and all
native student-policy limits remain unchanged. These are isolated test budgets,
not measured production co-location capacity on the8GiB class server.

Each phase freezes its source-input manifest; do not edit test/runner sources
while it runs. Raw command logs, failures and per-phase bundle identity are kept.
After each native phase, independently verify its exact owned unit is inactive
with MainPID0 and its private preservation receipt is unchanged. A wrapper exit
alone is insufficient. Never stop installed exam services as test cleanup.

The endurance uses a four-hour synthetic allowance so ramp-up can precede90full
minutes at peak without clock resets or weakened deadlines. This is a90-minute
peak-load endurance test, not70 exactly simultaneous90-minute countdown starts.
The70-person guest/browser/bridges have finite240-minute lifetimes; the scenario
is bounded to235minutes. This covers the measured ramp,90-minute peak and exports
without resetting a clock. Earlier runs retain their three-hour settings;
1/16-person bounds stay unchanged.
Both media streams are synthetic; the real application/browser WASM/SSH, private
native roles/PAM/cgroups, GCC/GDB, independent shell state, saved files, collection
and export interfaces are exercised. Four background writers per student create
continuous terminal output and saved work. Verify every student's exported marker
and all four saved writer files. Report captures/monitoring latencies and any hold.
The gateway runs locally, so production co-location capacity remains a separate
explicit limitation. Report actual resources rather than implying that a simulated
permission prompt proves real screen-sharing/fullscreen/keyboard behavior.
