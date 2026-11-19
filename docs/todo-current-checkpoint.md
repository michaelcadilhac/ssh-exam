# Current checkpoint — co-location failed; recovery fixes local

Authorized: Start/capture profiling, separate app/helper measurement, a short
35-student/140-terminal web/native co-location, and matched release preparation.
No push/deploy, production changes, actual students, institutional MFA, external
email or another90-minute run. Plan: [production qualification](production-qualification-35.md).
Evidence root: var/qualification35/profile-20261119T044302Z-8d3c93/.

## Current outcome

Follow-up: the missing separate-application Start/decoder diagnostics are now wired
and tested locally. See [profiling workflow](start-capture-profiling.md) for exact
entries, private log bounds, public refusal invariants, evidence and next measurement.
13focused cases, all25combined affected application cases and three real-WASM
browser cases pass, including an explicit Start/activation with a verified terminal.
Build/typecheck pass. Actual JSONL files survive fixture cleanup.
No new csc-sys profile or resource change has run. Old prepared image Configebb877aa
does not contain the new private backend stage labels; don't reuse it as a profiled
runtime. Native binaries and student policy remain unchanged.

Run9 FAILED:34students/136GCC/GDB panes completed setup; student35's Start reached
its60-second HTTP deadline. Native ACTIVE/original clock and web PREPARING were
recorded at immediate teardown. Later reconciliation was not observed. The full
35/140 workload,600-second peak and protected Finish were NOT reached.

658samples: aggregate current/lifetime3888.6/3915.1MiB under4352; web lifetime
1898.9MiB under2048; zero high/max/OOM events; minimum host available1973.2MiB.
CPU PSI maxima92.93% aggregate/89.59% native. Successful Start median/p95/max:
27.394/53.364/56.457s. No collection-headroom or sole-CPU-cause claim. Retained
capture errors:359video-unavailable409,18context409,9image-capacity400. Separate
child omitted stage timings; decoder-refusal reason remains uncertain.

[Prof report](../reports/stress/20261119T044302Z/report.md) and
[release/recovery proposal](pre-final-matched-release.md) are finalized locally.
No new class or remote test is running. Do not repeat the same ramp blindly.

## Implemented and tested locally

- `298276a`: decoder-context hint resets browser VP9 prediction on ownership changes.
 Actual-codec/HTTP red→green,959application checks/3gated skips,13affected browser
 cases, typecheck/build pass. This explains one fallback cause, not all load errors.
- `1ab9203`: lost/malformed Start reply observes existing authenticated status/WS;
 never replays Start or changes clocks. Same-generation ACTIVE still passes every
 activation guard; unknown keeps Start/sign-out disabled and hides practice cues.
 Prof approves the rendered desktop result. Six final focused and17affected UI
 cases,38authenticated grant-Begin scenarios, typecheck/build pass. An earlier
 28-case group supplies unchanged network coverage. Details: [Start recovery](start-response-recovery.md).
- Rebuilt WASM passes16real synthetic SSH sign-ins without attempts/clocks. Two
 actual setup refusal/retry cases pass. The first combined profile failed because
 its zero-worker baseline followed those two retained sign-ins; a fresh isolated
 profile passes. No account/history reset or native Go binary change.
- `505e4b8`/`7976745`/`fb51849`: bounded private transport/observer corrections; real
 delayed2.18MiB HTTP/IPC and3affected interfaces pass. Production timeouts unchanged.

Corrected private image Configebb877aa7a9b9956b8a73091335f7508c7c818e606a6d69e03ad3fb5a28baced
packages1ab9203UI; its build/WASM VCS metadata predates that commit(fb51849).
76backend modules are unchanged. Old Configbb436d26 had root-only public assets:
healthy API did not establish frontend usability. New generated-dist modes pass
normalUID10001readability and exact served hashes for all25assets. Actual final
image startup/CURRENT-data recovery passes63.405s/13signedpolls/41table contracts/
12negativecontrols, with no extra restart or snapshot/purge replacement. Private
container/keys/data cleanup passes. See release-image-final/ and
final-image-startup-recovery/command.log. New--assets-only qualification preserves
this boundary. Native physical installer/7SSH/live-policy/deadline checks already
pass for unchanged binaries. No SQL migration(schema37).

## Open question and exact next action

A question about a quieter CPU window/additional vCPUs is pending. Existing
approval permits resource increases if available; none was executed. No additional
RAM or production restart was requested. Stage observations and specific decoder
refusal labels are now verified locally. Next bind the updated private runtime
and obtain a bounded native profile under an established CPU/resource plan. Do not widen
freshness/timeouts, relax guards or diagnose from aggregate pressure alone.

Full co-location/Finish acceptance and actual csc Compose/nginx/external HTTPS/
CURRENT-recovery coverage remain release gates. Proposal:connectionWorkers40 in
EXAM_CONFIG JSON; installed32 unchanged. Matched native/web forward recovery is
prepared; preserve CURRENT data. NOT READY and no deployment instruction exists.
Temporary three-agent consolidation was completed earlier; preserve current roles.

## Preservation and prior baseline

Run9 native/base/host/config/authority, Marco/local cleanup and pre-edit source/
build preservation are FULL. Native/server PIDs0; ports3102/9444/9445 closed;
verified idle web/bridge sentinels stopped; observer ended. Receipts:co-location-9/
{independent-cleanup,generator-cleanup,input-preservation,final-sentinel-cleanup}.json.
All16documentation images unchanged; never stage the ten original dirty PNGs.
No package is missing. Commit only explicit source/docs paths, never all files.

Prior35/140/90-minute endurance PASSED on7fe9f3d with35protected exports/FULLcleanup;
it used a development-host gateway and does not qualify this co-location or70.
[Prior report](../reports/stress/20261118T190606Z/report.md). Earlier70-person OOM
stays failed. Native race/kernel/CLI/editor/timer/outage/collector evidence retains
its original unchanged-binary scope. Last recorded deployed baseline is November12
csc-sys activation/runtimeed09efc/schema37; see [csc-web-activation.md](csc-web-activation.md).
Do not restore the old Marco snapshot over CURRENT data. Separate local--all and
grading-helper follow-ups remain recorded in TODO; no new installation claim.
