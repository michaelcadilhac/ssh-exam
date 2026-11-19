# Reusable capture decoders — local implementation plan

Instructor approval: bounded isolated workers per screen/camera stream, within
four host cores. No deployment, production change, native permission or schema
change. Main08ac3f0/class11 source and build remain frozen; development uses the
separate local decoder worktree recorded in the main checkpoint.

Runtime entry: authenticated binary capture upload → Monitoring.uploadedFrame →
CaptureVideoIngress.accept. Keep source/page/generation/settings/registered-owner
scope, challenge freshness, immutable packet lineage and publish/ACK semantics.
The decoder owns no signing key, file, database or execution permission.

1. Deliver reuse through the real authenticated HTTP entry. A worker belongs to
   one current physical source and exact ownership/prediction scope. Scope, chain
   or geometry change retires it. Failed publication keeps the last verified
   group and retires speculative decoder state; retry can reconstruct that exact
   prefix. Duplicate ACK recovery keeps original capture age. Acceptance: real
   sequential VP9 uploads reuse a PID; stale scope/packet, cancellation, crash and
   failed publish cannot publish or evict a newer owner's worker. Tests: focused
   real-codec HTTP, lifecycle and protocol regressions before broader checks.
2. Preserve isolation/bounds. Initially retain four in-flight decode slots,
  64 admitted source operations, five-second queue refusal, fifteen-second frame
   deadline, existing address/CPU/output limits and120-second retirement bound.
   Bound live/retiring workers as well as cached bytes; choose the finite process
   cap from a70-stream measurement before class qualification. One worker's
   SIGKILL or malformed input must leave peers, web process and native authority
   healthy. Reap all owned processes on close. No freshness/clock relaxation.
3. Qualify70 authored streams (35students),14uploads/s for60real seconds, under
   the same one-core/1GiB component bounds as the failed baseline. Record CPU,
   memory/pressure/events, latency, process count and exact cleanup. Then run
   affected application/type/build/browser checks with this worktree's own clock
   addon and rebuilt assets. Privileged native code is unchanged from08ac3f0.
4. Commit validated implementation locally. Merge into main only after class11
   ends and independent preservation/cleanup is verified; then prepare a fresh
   guarded co-location run. A component pass is not a class or deployment pass.

The local streaming probe confirms immediate frame output without lookahead:
about64–68ms for a cold first decode,4–10ms for subsequent authored frames. Both
initial and reconstructed-prefix cases exit0 and are reaped. This is a protocol
experiment, not throughput qualification. An initial unsupported `-vsync` option
was corrected to the installed FFmpeg's `-fps_mode passthrough`; failure retained.
Evidence: main profile/native-small-profile/reusable-decoder-probe2/.

Streaming input must yield one displayed image per uploaded packet. Validate
superframe indexing and display flags before feeding a reusable process; otherwise
extra decoded images could be attributed to a later request. The codec remains
responsible for full decoding. Primary format references:
[WebM VP9 header/superframe specification](https://downloads.webmproject.org/docs/vp9/vp9-bitstream_superframe-and-uncompressed-header_v1.0.pdf)
and [libvpx decoder](https://chromium.googlesource.com/webm/libvpx/%2B/refs/heads/main/vp9/decoder/vp9_decodeframe.c).

## Implemented locally; final qualification in progress

The authenticated upload path now reuses one isolated FFmpeg process within an
exact stream/owner scope. Four simultaneous decode slots,64 source operations,
5-second queue refusal,15-second frame deadline and all challenge/authority/
clock checks remain unchanged. Workers have the existing1GiB address-space,
8CPU-second,2MiB file and1,490,000-byte JPEG bounds, plus120-second lifetime.
All live/retiring processes count toward a16-process hard cap. Retention is at
most8 workers and a resolution-weighted budget:16MiB plus12bytes/pixel each,
no more than8 nominal1280×720 streams. Larger captures reduce that count.
Idle lower-resolution workers can yield to more expensive streams; equal-cost
active streams are not churned just to fill a cache. Overflow reconstructs the
verified prefix in a transient worker, reaped before publication. No new operator
setting, management capability or examctl command is introduced.

The first96-process proposal FAILED the unchanged1-core/1GiB component budget:
48 accepted uploads, memory throttling and subsequent bounded refusals. It was
not enabled. The intermediate20-warm/28-total budget passed840/840 uploads from70
streams over60.005 real seconds,43.268CPU seconds,p95 90ms/max440ms and784MiB
service peak, with zero memory-high/max/OOM events. Its exact process cleanup and
frozen source were independently checked. The initial launcher argument mistake
started no service and remains recorded. The final resolution-weighted20-worker variant also passed, but combining it
with the measured connection/native footprint left insufficient test RAM headroom.
The selected8-warm/16-total variant passed840/840 locally (394MiB peak, maximum
2.855s), then passed the same70-stream component in csc-sys's actual image as
UID65532/cap0/no-new-privs/no-network:840accepted,61.158s total,58.145CPU-seconds,
p95 948ms/max1515ms,342MiB service peak and zero memory-high/max/OOM events.
Exact children/units are stopped, configuration/authority hashes match. The first
host fixture failed before capture on traversal permission in its owned exported
sys/fs directory. Only that private parent mode was corrected; host cgroup modes
were not changed. Both receipts remain. This is not a full class/co-location pass.
Evidence: MAIN var/qualification35/profile-20261119T044302Z-8d3c93/
native-small-profile/reusable-decoder-benchmark-{1,2,3,final}/,
reusable-decoder-memory-1/, reusable-decoder-budget8/ and
host-decoder-component-{v2,v3}/; host-decoder-component-cleanup.json.

37 focused checks pass; an additional owning-Node SIGKILL regression also passes
with no orphan decoder (38focused cases total, including8worker cases). Typecheck/build pass. The final full application run passes985 cases with3
unrelated opt-in skips (450.58s); all10 affected real-WASM/browser cases pass3.1m.
Complete final source manifests and exact process cleanup are verified.10 real-WASM/browser capture scenarios
passed on the intermediate20-worker budget, including60seconds of actual VP9 and
128-kbit/s upload. Browser assets are byte-identical across the budget change. The final four
component modules match the actual-host tested bytes, and the final8-budget
browser run also passes. The earlier full app run passed983, failed1 stale diagnostic-script mock and
gated3. The corrected mock executes the real serialized script in a VM; its13
focused cases and the final full run pass. The failed receipt remains retained. These
include real authenticated publication failure/retry, late old-generation
publication, exact SIGKILL of the screen worker with the same student's camera
and session healthy, malformed multi-image packets, stopped-worker deadline and
shutdown, expiry/reconstruction, finite cache overflow and all12 decoded images
matching independent fresh decoding byte-for-byte. Original clocks/incidents
remain unchanged. No application restart is required to recover a worker.

## Lifecycle and preservation review

All worker/prediction state is volatile. Inspection uses existing private process
and refusal-stage diagnostics; no credentials or native execution authority enter
a worker. Publication owns the durable frame/receipt/ACK. Failure after decode
retires speculative process state while retaining only the last published prefix.
Retry can reconstruct that prefix; exact duplicate ACK recovery preserves original
capture age. Receipt prediction_sha256 continues to identify the canonical full
IVF prefix (header count equals accepted packet count), not OS pipe writes; the
streaming process receives a12-packet header and subsequent packets incrementally.
No evidence schema or historical receipt is rewritten.

A trusted username/source key retires the previous attempt/page/generation/
settings/owner context. Late completion cannot retire or commit into its successor.
A changed chain or geometry starts a new process. Queue cancellation and app
shutdown reject pending work, kill only owned live process groups and await reap.
No signal targets a PID after exit. Independent120-second expiry bounds a stream
that disappears without another request. Malformed framing, excess output, error
stderr, crash and timeout refuse that capture; peers remain independent. Nothing
reserves accounts, starts/refunds time, changes deadlines/holds, bypasses fresh
verification or classifies a decoder refusal as a student violation. No migration
or persistent intermediate state is added. Restart reconstructs no permission:
existing fresh capture/native authorization is still required.


Prof confirms the previous rendered wording/layout review remains applicable to
the unchanged UI assets. Class acceptance must still observe transparent JPEG
recovery without permission prompts/modals/Start replay, clearing sharing status,
accurate input-versus-countdown wording, peer isolation and fallback frequency.
No optional UI changes were identified. This is not a new class-performance pass.

Before the next class run, the stopped owned test slice still held669MiB of clean
unmapped cache/kernel memory with zero processes. A scoped reclaim reduced it to
7.2MiB; all files and authoritative state were preserved, and the original host
resource guard was not changed. No global/production cache or service was touched.
Receipt: native-small-profile/owned-empty-slice-reclaim.json.
