# Current checkpoint — approved reusable capture decoders

Keep csc-sys at FOUR cores. Local development/testing/commits only; no push,
deployment, production service/configuration/record change, actual student/MFA
or external email. Preserve ten original dirty PNGs. All remote tests stopped.

## Exact next action — isolated decoder checkout

Instructor approved bounded per-stream decoder workers, local only; do NOT
re-ask (questioncall_ece2ac40affb45ff8be847374968ab39). Runtime entry is authenticated
binary capture→Monitoring.uploadedFrame→CaptureVideoIngress.accept.
Feature checkout `/tmp/ssh-exam-decoder-d7e5bfb5`, branch
`codex/reusable-capture-decoders-d7e5bfb5`, base08ac3f0; node_modules symlinks to
MAIN's installed dependencies. Its AGENTS.md read; its own native clock pretest
built successfully. Main source/build have remained frozen. No feature code yet:
only docs/reusable-capture-decoders.md plan and a meaningful RED HTTP regression
in tests/integration/capture-video-upload.test.ts (expect same decoder PID across
three real authenticated uploads and zero processes after app close). Red receipt
/tmp/ssh-exam-decoder-red.log. Use npm test for its own clock pretest. Worktree
receipt P/native-small-profile/decoder-worktree.json.

NEXT implement bounded codec workers and integrate directly with accept and the
monitoring caller; then focused real HTTP/lifecycle/ownership/crash tests before
broad/resource/browser qualification. Keep four decode slots/64in-flight source
operations/5squeue/15sframe/original native authority windows. Strict process/RAM/
byte/CPU/lifetime caps; retire scope/chain/geometry changes. Failed publish keeps
last verified prefix, retires speculative worker, retry reconstructs it. No source
prediction crosses user/page/generation/settings/owner. ACK replay preserves age.
Use stable physical source key from trusted caller (username+screen/camera),
separate exact scope; never parse opaque auth ownership in codec. Consider a96
worker cap with bounded idle LRU retirement; choose/qualify from70-stream load.

Streaming feasibility PASS: P/native-small-profile/reusable-decoder-probe2/;
actual ffmpeg emits each JPEG without next input, cold64–68ms/warm4–10ms. Initial
and reconstructed-prefix cases exit0/reaped. An initial unsupported-vsync probe
is retained; installed option is -fps_mode passthrough. Preserve existing limits,
use -probesize32/-analyzeduration0/-fpsprobesize0/-flush_packets1 and a static
select=gte(n,bootstrapIndex) filter so cold prefix reconstruction emits only the
requested new frame. Each IVF packet must yield exactly ONE displayed image;
validate VP9 superframe/display-header framing, not only metadata. Primary WebM
spec/libvpx sources browsed (links in feature plan). A tiny header parser must not
replace full codec verification. Capture stderr boundedly for immediate codec
errors; do not wait15s on a malformed stream that remains open. Reject/reap crash,
extra output, bad dimensions, owner changes and late completion without affecting
peers. No production changes or class-capacity claim from a component pass.

## Main latest — class11 FAILED, cleanup FULL

[Agent report](../reports/stress/20261119T195353Z/report.md).
08ac3f0 reached34students/136GCC/GDB panes;35thStart hit60s. Native/web recovery
observed SAME ACTIVE/gen0/full4hinterval/workspace, not typing readiness. Peak/
protected Finish NOT reached. Successful HTTPStart median27.515/p9555.041/max59.624s;
23056accepted/32challenge/361decoder-queue/15image-capacity captures. No memory
high/max/OOM; observer maxgap5.054s. Independent native/host/config/authority/base,
Marco/local cleanup and source/build/all16image preservation FULL, privateports
3100/3102/9444/9445closed. Need stop completed local class/probe unit receipts
before another host test; all have already exited, remote roles fully stopped.
After cleanup unchanged installed watchdogPID2590477 uses0.946core, ordinary user
slice1.979cores. Neither touched. Candidate watchdog at25students sampled0.159core.
Class test includes old installed stack; don't equate it with future single-stack
production or blame every wait on one cause. No more blind class repeats.

## Validated local native increment

Commit08ac3f0 removes redundant full-state writes from four background read scans.
Actual mutations/fences untouched; no cache/schema/clock/policy change.
[Details](native-background-cost.md).218attempt/872file scan6.835s→13.671ms,
allocations5.81GB→7.08MB. Actual synthetic Watch0.519→0.079core (84.7%, passes75%
target). Focused plus full native/CLI races pass(core278.113s/CLI7.366s,1735cases
incl subtests/137gated skips/0failures), build/vet pass. Actual Marco→WASM→SSH→
disposable native editor/hold/Continue/protectedFinish PASS104.043s; FULL cleanup/
preservation. [Report](../reports/stress/20261119T194443Z/report.md). Not deployed.

P=`var/qualification35/profile-20261119T044302Z-8d3c93/`.
Main native manifest58f6f6016c97ab3b5f6e72f72324aaba7dfd22859d377618389210b38206df56;
private upload `/var/tmp/ssh-exam-browser-native-upload.idlecallback43bf55e02ef84279`.
Prior class10/probes/native failures remain documented. Main docs/checkpoint dirty
for this new report; feature branch changes must later be validated/committed and
merged locally. Do not discard user images or overwrite current checkpoint with
feature's older snapshot.

35co-location/installed32slots/csc-specific Compose/nginx/externalHTTPS/CURRENT
recovery/70capacity remain open. Prior35/90pass has different topology. Three-agent
consolidation completed earlier; do not repeat. No deployment authority.
