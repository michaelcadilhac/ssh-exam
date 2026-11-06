# Reducing student upload bandwidth

November6,2026. Investigation complete; implementation is proposed, not enabled.
No application source, production configuration, student data or services changed.
Last verified deployment is95c7798 (documentation checkpoint f48c41e).

Recommendation: first support binary uploads of the existing JPEGs, retaining
image bytes, quality, cadence and verification. Then qualify browser-side VP9
encoding of those same five-second observations, with binary JPEG fallback. The
second increment offers the substantial saving; a blanket WebP switch does not.

## Current path and measured alternatives

Capture in apps/web/src/capture.ts bounds screen long edge1280 and webcam320,
encodes JPEG quality0.50 every5seconds, and sends base64 in JSON through api.ts.
For current monitored attempts it obtains a challenge before each new sample.
monitoring.ts accepts bounded JPEG bytes, fully decodes, hashes and stores them;
readiness and live evidence retain the challenge's original monotonic age.
Completed-attempt server video conversion reduces storage, not this upload.

All rates below are decimal kB/s of image payload/body, not kilobits. They exclude
HTTP/TLS/TCP, challenges/control, terminal traffic, retries and extra samples.
Actual sustained traffic and short bursts therefore exceed these figures.

| Candidate | Code screen + ordinary camera kB/s | With noisy camera kB/s | Ordinary90min MB |
| --- | ---: | ---: | ---: |
| Current JPEG0.50/base64 |20.80|21.23|112.34|
| Same exact JPEG bytes/binary |15.60|15.92|84.25|
| Same JPEG/base64 JSON, gzip |14.05|14.42|75.87|
| JPEG0.35/binary, lower quality |12.71|12.83|68.64|
| WebP0.60/binary |13.99|14.51|75.52|
| WebP0.45/binary |12.44|12.65|67.16|
| WebP0.30/binary, lower quality |10.19|10.26|55.02|
| Browser VP9,20kbit/s screen +4kbit/s camera targets |3.39|3.93|18.32|
| Browser VP9,40kbit/s screen +8kbit/s camera targets |4.33|5.10|23.36|

Image codec quality numbers are not equivalent; this is not a matched-perceptual-
quality comparison. Binary alone saves25% of the base64 payload, not33%: base64
is approximately33% larger than its binary input. Gzip can also recover base64
overhead and JPEG redundancy, but the table measures Node gzip, not a qualified
browser compressed-request/gateway decompression implementation. Nginx response
compression does not by itself compress browser request bodies.

WebP0.60 saved only about10% beyond binary JPEG on this dense synthetic code
screen. On a random-color screen it was worse:70.65kB/s combined, versus41.65 for
binary JPEG and55.54 for current base64 JPEG. Even WebP0.30 used50.07kB/s there.
If independent codecs are later offered, retain a size-bounded JPEG option and
choose a smaller successfully encoded candidate rather than forcing WebP.
Canvas PNG was much larger here; random-color PNG exceeded the unchanged1.5MB
image limit and was deliberately excluded from the HTTP probe. No limit was raised.

## Method and limits

Evidence and self-contained local probes are in
var/collection-tests/upload-bandwidth.20261106/:
probe.mjs, synthetic-scenes.js, images.json, browser-support.json, video.mjs,
video.json, video/, cleanup.json and video-cleanup.json. The scene generator was
copied from the earlier authored recording-storage evaluation; no student media
was inspected. Chromium154.0.8037.97, installed Playwright, Sharp and FFmpeg were
used without installing packages. All browser requests stayed on an owned loopback
receiver; browser and listener cleanup receipts confirm both closed.

The image comparison encoded192samples:8frames ×4scenes ×6profiles, at current
dimensions. Every image was decoded and dimension-checked.23eligible first-frame
profiles were sent both as a binary body and base64 JSON to the private receiver,
which independently decoded and hashed the same bytes. One oversize PNG was not
uploaded. The initial probe incorrectly tried to parse its size refusal as a
success response; that fixture failure and its cleanup are retained separately.
It was corrected by respecting the current image-size limit, not raising it.

The browser VP9 experiment encoded144frames:24samples for each of3scenes at2rate
settings. Each sequence represents120seconds at0.2fps, with new synthetic frame
content, two keyframes and5-second timestamps. Encoding ran faster than real time;
this is not a90-minute live scheduling/network/thermal test. Each sample was flushed
immediately and had exactly one output before the next sample. All144frames were
decoded independently by FFmpeg/ffprobe with exact dimensions/counts. The maximum
observed encode/flush time was54.6ms on this development host, not a slow-laptop
guarantee. Ordinary and deliberately tiny text were visually compared with JPEG;
late prediction frames were also inspected. Tiny text remains limited by the
existing downscaling. This is no OCR/readability certification.

Rate targets are not hard caps: variable-rate encoding overshot some targets,
especially noisy camera content. The2-minute synthetic sequence does not establish
a guaranteed per-attempt size, real bandwidth ceiling or full class capacity.
The largest screen chunk was93,942bytes at the20kbit target and128,769 at40kbit;
camera peaks were9–28KB. Thus a lower average does not imply small bursts or prove
a4–6kB/s connection is sufficient. Keyframe delivery/backlog and the original
freshness cutoff must be exercised on a shaped slow link before recommending a
minimum connection speed. Do not conceal this by extending evidence age.
There is no random-color video stress, cross-browser/old-device qualification,
network-loss/restart/reordering test or authenticated monitoring integration yet.
The prior server-side VP9 storage estimate is not substituted for these browser
upload measurements. Wire metadata, container framing and authenticated retry
overhead must be measured during integration.

## Compatibility findings

The local Chromium supports the tested VP9/VP8/H264/AV1 VideoEncoder configurations;
only VP9 encode/decode was exercised. Requested AVIF canvas encoding actually
returned PNG. The [HTML Canvas standard](https://html.spec.whatwg.org/multipage/canvas.html#dom-canvas-toblob-dev)
allows this fallback: check actual MIME and validate decoder output, rather than
assuming a requested format is available. Use installed browser codecs first;
there is no evidence here for adding a large WASM encoder dependency.

The [WebCodecs specification](https://www.w3.org/TR/webcodecs/) provides per-frame
encoding, flushing and capability discovery but requires no particular codec.
Runtime detection, bounded queues and an exercised fallback are mandatory.
WebCodecs encoded chunks are not automatically playable video files. The private
probe wraps VP9 in IVF for independent verification; this is not a proposed new
public upload format or completed server ingestion contract.

Avoid replacing the capture loop with a normal continuous MediaRecorder stream:
it can record many more frames than the approved0.2fps observations. Its chunk
timer is not an evidence clock, and the [MediaStream Recording specification](https://www.w3.org/TR/mediastream-recording/#data-handling)
does not require individual chunks to be independently playable. This creates
additional delayed-output/recovery risks. Retain sample-level acceptance instead.

## Dependency-ordered implementation proposal

1. **Binary JPEG through the student capture entry.** Add a bounded authenticated
   binary-plus-metadata request while preserving the existing JSON path for old
   clients. Use asynchronous toBlob, validate actual JPEG MIME, preserve exact
   encoded bytes/digest and unchanged freshness/sequence/retry semantics. No
   codec, storage-schema, native-authority or exam policy change is needed.
   Acceptance: exact old/new hashes and decoded output; original challenge age
   on retry; cross-page/generation/deletion/expiry refusals; malformed/oversize
   bodies and limits; actual built student sharing/preflight/Start/resume; unchanged
   review/export and saved media; slow-uplink/retry measurement. Expect25% image
   payload savings without quality loss. No operator setting is required.
2. **Browser VP9 samples, integrated and qualified.** Negotiate capability before
   Start, use current dimensions and five-second observations with no audio,
   encode off the UI authority path, and deliver each sample immediately. Keep
   binary JPEG as the capability/recovery fallback. A practical initial target
   is roughly4–6kB/s including a small protocol allowance on representative code
   work, not a quota or minimum-link guarantee. Use isolated bounded server decode,
   acknowledge verified input, and reject unknown/missing/cross-scope references.
   Periodic keyframes plus immediate keyframe recovery must bound dependency state.
   Codec/init/retry/reset must be explicit; never leave a missing predecessor
   waiting indefinitely or replay a prior frame as a new observation.
   Acceptance: real authenticated capture→decode→evidence→native input workflow;
   original challenge-before-capture age preserved through encode/upload/decode;
   exact duplicate receipt without re-aging; packet loss/reordering/ACK loss,
   reload/worker restart/codec failure and JPEG recovery; one bad stream cannot
   crash or stall shared monitoring; terminal input remains correctly gated;
   stored hashes/provenance and old JPEG/VP9 review/export/deletion remain correct;
   browser/slow-device/actual60s-budget tests and approved16-student/64-terminal
   capacity. Measure actual wire rate, peak keyframes and visual quality before
   rollout. Native role changes are not assumed necessary without inspecting
   the finalized evidence interface.

Video creates a new live media dependency/verification path. The saved-video worker
does not already supply it. This investigation qualifies only the encoder size
opportunity; the implementation and release gates above remain open. No incomplete
video mechanism should be enabled on the strength of these measurements.

Do not get savings by lowering the five-second sampling cadence, cropping away
parts of the selected display, extending freshness, relaxing camera requirements
or treating repeated pixels as stale capture. Ordinary clocks/cursors also make
whole-image hash deduplication unreliable. Codec delta compression is preferable
to a separate custom tile/reference protocol for this first implementation.
All technical stalls remain verification problems, never new misconduct evidence;
no proposal changes clocks, account holds, protected submissions or history.
