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

Current status: 861 application checks pass, with three normally gated real
CLI/export/bwrap entries passing separately. Harness 73 checks, native races,
16-client WASM sign-in and native editor/timer/recovery/collector-crash workflows
pass. Prof's rendered review is complete. The corrected full browser run completed
360 passed, three failed and five explicit skips. The failures remain recorded;
later rate-limit responses support the shared anonymous-budget finding. All three
relay scenarios and both local UI fixes pass in a separate fresh five-case run.
That does not convert the failed full run into a pass. Earlier fixture repairs
and recovery observations remain in the report; no backend timing fix is claimed.
The seventh rehearsal safely refused further load at22students/88terminals when
the generator's available RAM fell below768MiB. All22attempts were ACTIVE;
there is no70-student or90-minute pass. A larger generator decision is pending.
Independent functional/fault phases continue. The installed32-connection limit
is below the70-student target; the isolated candidate uses96 with compiled
connection workers. This is a test configuration, not a production change.
No maintenance action has been needed. The installed baseline remains
ed09efc/schema37; local source also includes previous unpushed CLI work.
The per-run report must name this distinction and retain all failed rehearsals.

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
Each phase freezes its source-input manifest; do not edit test/runner sources
while it runs. Raw command logs, failures and per-phase bundle identity are kept.
After each native phase, independently verify its exact owned unit is inactive
with MainPID0 and its private preservation receipt is unchanged. A wrapper exit
alone is insufficient. Never stop installed exam services as test cleanup.

The endurance uses a three-hour synthetic allowance so ramp-up can precede90full
minutes at peak without clock resets or weakened deadlines. This is a90-minute
peak-load endurance test, not70 exactly simultaneous90-minute countdown starts.
The70-person guest and its bridges have a finite180-minute lifetime to contain
the measured sequential ramp plus that peak;1/16-person bounds stay unchanged.
Both media streams are synthetic; the real application/browser WASM/SSH, private
native roles/PAM/cgroups, GCC/GDB, independent shell state, saved files, collection
and export interfaces are exercised. Four background writers per student create
continuous terminal output and saved work. Verify every student's exported marker
and all four saved writer files. Report captures/monitoring latencies and any hold.
The gateway runs locally, so production co-location capacity remains a separate
explicit limitation. Report actual resources rather than implying that a simulated
permission prompt proves real screen-sharing/fullscreen/keyboard behavior.
