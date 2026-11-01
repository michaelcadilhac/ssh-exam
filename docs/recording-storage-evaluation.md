# Monitoring storage evaluation

November 1, 2026. Local synthetic measurements only. No student media was read,
no production setting was changed, and no existing evidence was transcoded or
deleted. Evidence and reproducible scripts:
`var/collection-tests/recording-storage-evaluation._w2yxnuj/`.

## Recommendation

For live monitoring, retain independent JPEG frames and the five-second capture
schedule. The selected profile uses screen long edge 1280 at browser quality 0.50 and camera long edge
320 at quality 0.50: about **96.5 MiB per 90-minute synthetic attempt**, including
the existing thumbnails, versus 420 MiB for the previous profile. This is an
activity-level screen record; exact terminal output remains in terminal replay.
This is a workload estimate, not a quota. At 1600px, ordinary 20px source text remains readable in the rendered comparison;
at the selected 1280px, fine text loses more detail. Deliberately tiny 12px terminal
punctuation is unreliable after resizing. Do not describe resized screenshots as
preserving every original detail. The selected entropy stress case is about
233 MiB per 90 minutes, reinforcing that the estimate is not a fixed quota.

The instructor approved verified short video segments for completed attempts;
that implementation is in local qualification, with nothing deployed. The
whole-file synthetic 1280px VP9 screen plus 320px camera benchmark measured about **12 MiB** for the
same 90-minute schedule, or 16 MiB with stronger camera noise, before thumbnails.
Keeping every old 400px JPEG thumbnail would add another approximately 16 MiB,
so the approved implementation derives review images and thumbnails on demand.
These whole-file measurements are not a hard quota or a production measurement;
short independently verified segments have different overhead. A few megabytes
for every exam is not a supported guarantee. AV1 camera was
0.247 MiB; screen encoding exceeded its 90-second benchmark bound and is not
qualified.

## Method and limits

Installed Chromium 154.0.8037.97 generated an entirely synthetic 2560x1440 C/C++
editor and terminal, plus a 640x480 drawn camera scene with normal and stronger
seeded noise. Images were resized with browser Canvas and JPEG encoded using
`toDataURL`, matching the capture pathway. Each image result includes the current
server pipeline: Sharp width-400/no-upscale JPEG thumbnail. The nominal image
projection is 1080 samples per stream in 90 minutes; preflight, start and incident
samples add overhead. Metadata, terminal logs, filesystem allocation and release
backups are excluded.

Video measurements encode **1080 actual frames over 5400 seconds**, using 24
changing synthetic source frames repeated 45 times. Dense source text scrolls
every 20 seconds; the camera moves and has new noise. The repetition limits
workload diversity. Keyframes are at most 12 samples/60 seconds apart. Software
encoders use one thread. This is stored video from five-second samples, not a
continuous-motion recording. `ffprobe -count_frames` verifies counts and duration.
Timing numbers are local observations, not a capacity qualification; some
independent codec measurements overlapped.

All benchmark commands use existing installed software. Optional `tesseract` and
`cwebp` are absent; Sharp and Chromium provide the required image encoders. No
package installation was needed. Installed Sharp is 0.35.5/libvips 8.18.7.

## Independent JPEG frames

Both streams and their current thumbnails, projected to 90 minutes:

| Screen / camera profile | MiB | Reduction from old profile |
| --- | ---: | ---: |
| 2560 q0.75 / 640 q0.75 | 420.0 | baseline |
| 1920 q0.55 / 320 q0.50 | 185.4 | 55.9% |
| 1600 q0.55 / 320 q0.50 | 144.4 | 65.6% |
| 1280 q0.50 / 320 q0.50 | 96.5 | 77.0% |

A full random-color screen is a deliberate entropy stress case, not a typical
exam: at 1600 q0.55 it projects to about 487 MiB with the normal camera; at 1280
q0.50 about 233 MiB. The old 2560 q0.75 stress frame was 2,112,435 bytes, exceeding
the existing 1,500,000-byte upload bound. That bound was not relaxed.

Thumbnails are significant after shrinking originals: the normal 320px camera
JPEG was 4,103 bytes and its current thumbnail 4,239 bytes. A separately measured
256px/q55 thumbnail saves about 10 MiB per representative 90-minute pair. That
would be a separate presentation/storage change; this benchmark does not apply it.

## Alternative image encodings

Same synthetic image dimensions; codec quality numbers are not equivalent
between formats. The table reports originals, before thumbnails:

| Source | JPEG | WebP q60 | AVIF q50 | AVIF q35 |
| --- | ---: | ---: | ---: | ---: |
| Screen 1920 | 159,726 B (q0.55) | 127,522 B | 96,712 B | 58,430 B |
| Screen 1600 | 119,886 B (q0.55) | 99,108 B | 72,383 B | 46,623 B |
| Camera 320 | 4,103 B (q0.50) | 1,920 B | 2,334 B | 1,722 B |

At full 2560px, WebP lossless was 96,324 bytes for this structured synthetic
screen, retaining its original rendered pixels; JPEG q0.75 was 370,456 bytes.
This unusually compressible code scene does not establish a general lossless
saving for photographic content. Full-resolution WebP q60 was 212,556 bytes;
AVIF q50 was 147,319 bytes. Detailed CPU observations are in the JSON receipts.

Chromium Canvas actually emits WebP, but requesting `image/avif` returned PNG.
The HTML standard permits PNG fallback for unsupported formats, so a MIME request
alone is not encoder support. AVIF here used installed Sharp, outside the browser
capture path. Silent PNG fallback must never enter a JPEG/WebP ingestion path.
See the [HTML Canvas standard](https://html.spec.whatwg.org/multipage/canvas.html#dom-canvas-todataurl-dev)
and [Sharp output options](https://sharp.pixelplumbing.com/api-output/).

## Temporal encodings

These are full 90-minute files, excluding per-frame thumbnails:

| Stream | H264 | VP9 |
| --- | ---: | ---: |
| Screen 2560 | 54.23 MiB (CRF23) | 42.83 MiB (CRF30) |
| Screen 1280 | 14.27 MiB (CRF28) | 11.28 MiB (CRF35) |
| Camera 320, normal noise | 5.98 MiB (CRF23) | 0.68 MiB (CRF30) |
| Camera 320, stronger noise | 22.02 MiB (CRF23) | 4.54 MiB (CRF30) |

H264 uses libx264/veryfast; VP9 uses libvpx-vp9/good/cpu-used6, CRF with zero
bitrate. The exact commands, file sizes, encode durations, frame counts and
rendered first frames are in `temporal-results.json` and
`temporal-low-results.json`. AV1/libaom cpu-used8/CRF35 encoded the 320px camera
to 258,838 bytes in 13 seconds. The 1280px screen exceeded the 90-second encode
bound and was stopped; its partial file is not a valid comparison result. Encoder options are documented by
[FFmpeg](https://ffmpeg.org/ffmpeg-codecs.html).

## Compatibility and safe integration boundaries

The immediate JPEG profile change preserves uploads, exact image hashes,
per-frame challenged freshness, media reads, exports, CLI workflows and old
recordings. It does not alter cadence, deadlines, retention or incident policy.

WebP is a smaller follow-up than video: accept explicit validated encoding,
retain exact incoming-byte hashes, persist encoding/MIME, and update original
and thumbnail readers, exports and CLI filenames. Historical JPEG rows must
remain readable. Do not transcode server-side and keep an old original hash.

Video is not a filename change. Current `frames.hash` is the exact uploaded JPEG
digest (`monitoring.ts`), media reads verify those bytes
(`monitoring-media.ts`), and export refuses a changed source
(`monitoring-export.ts`). Lossy video cannot replace old JPEG files while
satisfying that contract. Retaining both permanently would not save storage.

The approved archive policy retains original upload digests and capture times
as provenance, separately from each verified video digest and decoded RGB-frame
digest. Review/export JPEGs are derivatives, not a claim that reconstructed bytes
match an old upload digest. Publication, durable frame mapping and safe cleanup
must complete before original JPEG deletion. Completed-attempt conversion leaves
live JPEG verification, original deadlines, account restrictions, protected
submissions and historical attempts intact. Tombstones still prevent all access.

The worker handles at most 12 captures per segment, uses one encoder and two
independent read slots across coordinators, and verifies originals before encode.
It independently probes the VP9 output, decodes every frame, hashes decoded RGB,
and fsyncs video plus manifest before replying. Odd dimensions receive at most
one pixel of black padding on each odd edge rather than cropping the selected surface. Staging is
inside the existing attempt directory and the worker never recreates it or
unlinks an original. The coordinator owns publication/mapping/deletion policy.

SQLite WAL transactions use NORMAL synchronization, so a committed frame mapping
alone is not a durability barrier. Before original deletion, the coordinator must
verify the video, await the isolated worker’s `sync()` barrier, and recheck current
mapping/retention. The barrier opens only the pinned private data directory and
its owned, singly linked database/WAL files read-only, fsyncs WAL then database
then directory, and refuses replaced path/inode identities. It reads no SQL or
database contents. Crucially, those descriptors are opened and closed in the
child PID: closing an external database descriptor in the HTTP process could
release that process’s SQLite POSIX locks. Tests verify the fsync order, separate
PID, unchanged NORMAL/WAL policy, retained active SQLite lock, and refusal of
missing, redirected, shared or replaced files.

Thirteen isolated interface regressions pass against real Store/schema37, including
actual VP9 encoding and reading, twelve-frame batch reads, source/output corruption,
geometry mismatch, exact worker SIGKILL/timeout, pending shutdown, post-close
refusal and global slot limits. The new runtime Docker layer includes FFmpeg;
actual Debian FFmpeg 5.1.9 passes an isolated 512 MiB/one-CPU/no-network probe with
12 screen captures and full original/thumbnail batch decoding. The probe uses a
synthetic outer eligibility stub; real database/public workflow qualification is
separate. A full segment batch took 1.217 seconds at that cap, versus roughly
0.4 seconds for a single derived image before batching. Export uses segment batches
rather than launching one codec worker for each individual image. Compatibility
of decoded RGB digests must remain part of future codec upgrades.

Receipts: `video-with-sync.log`, `video-sync-focused-v2.log`, `codec-focused-cleanup.json`,
`codec-batch-runtime.log`, and `codec-batch-runtime-cleanup.json` in the evidence
directory above. Exact release-image qualification is now complete locally:
schema11/24/35/36 →37 and unchanged37 startup preserve historical rows/settings;
additive36/37 paths also preserve rowids. The authored synthetic4914-byte VP9
fixture decodes with its original three RGB24 hashes, using compiled Store and
MonitoringMedia, both JPEG forms and one segment batch. No original JPEG fallback
exists. A durable tombstone blocks buffered images and still-present orphan video,
and protected work remains unchanged. The helper’s retained36-image mode also
passes; this does not qualify a schema37→36 downgrade.

Release evidence: `var/collection-tests/monitoring-video-release.k9whg_g9/completion.json`.
The image is bound to exported Config
`sha256:3e3ba8059ebbed6a90695655f09330a4e9d053d07fd84ebdff4b728ef828f0db`
and its rootfs diff IDs; all five non-WASM assets equal the qualified host build,
and packaged WASM equals the prior independently qualified pinned-compiler bytes.
Actual runtime FFmpeg is5.1.9. These are local synthetic/container checks, not
production measurements or new institutional SSH/MFA/media/native-containment
qualification. Nothing from this storage work is deployed.

The current 60-day live retention and old full backup copies are independent of
codec choice; existing backup copies do not shrink when live images are purged.
