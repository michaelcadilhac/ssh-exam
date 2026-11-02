# Synchronized recording review

November2 loading-continuity follow-up: DEPLOYED at17:34:57 Chicago, source89bb35b.
Keep the last successfully decoded sample visible until its replacement is ready,
with the displayed sample's actual timestamp. Loading/errors overlay the preview;
its geometry stays stable through retries and changes in capture resolution. This
fix covers both JPEG replacement and video seeks/segment downloads. One in-memory
canvas per source retains at most1600×1200 pixels; native video/JPEG decoding and
existing request limits remain unchanged. No extra server decode, download cache
or stored derivative. Gap/hide/close/deletion zero the buffer; a gap is never filled
with a stale frame. The shared playback clock still waits for both sources.

Actual Chromium regressions verify retained pixels/timestamps and geometry while
responses/seeks are blocked, failed-image retry, resolution changes and cleanup.
Three focused cases and31 affected review workflows pass; final10 playback cases
pass after the gap-placeholder color correction. Full fixture types and final Vite
build pass; mobile/error and gap images inspected. All frozen inputs and owned
fixture cleanup/ports pass. The first fixture run attempted to seek beyond the old
range before Refresh had returned; it now awaits the public updated range. The
corrected old-UI reproducer fails at the missing retained image. A later fixture
assertion confused Retry's deliberate scrolling with a resize: pending-load checks
still assert the full rectangle, while post-click checks assert content dimensions.
Failure receipts remain. Evidence: var/collection-tests/replay-loading-continuity.20261102a/.
This changes only browser rendering; backend/native/CLI/enforcement are unchanged,
so no redundant native races or server suites were run for this fix. It shipped
with the status-copy change using the unchanged-contract UI scope, exact-image
qualification, normal guards and CURRENT-data recovery. Preservation/public checks
pass; no native restart. Deployment record: docs/ui-fixes-deployment.md.

November2,2026. Pushed and deployed at16:23:58 Chicago in source04fa394/schema37.
This supersedes the independent screenshot sliders. Exact-image preservation and
public checks pass; see docs/synchronized-review-deployment.md.

Review → Recordings has one Play/Pause button, speed selector and timeline for
both screen and webcam. The shared clock uses original capture timestamps, not
arrival order or encoded frame positions. Default speed is60×;1×,5×,10×,30×,
60× and125× are available. Each panel identifies the actual sample it displays.
Missing samples are explicit gaps: neither a future capture nor an image more
than one capture interval old is substituted. Play waits while either selected
sample is loading. Arrow keys seek five seconds; scrubbing pauses playback.

Completed converted captures use the existing VP9/WebM segments. Each browser
view holds only its current segment and decodes/seeks it locally, with offsets
mapped back to original timestamps. There is no per-frame server decoding on
this path, concatenated movie, new conversion job or persistent thumbnail cache.
The stored low-frame-rate captures are not continuous video. Live, old and partly
converted recordings retain JPEG support on the same shared clock. Live follows
the latest capture; pausing the attempt freezes the selected point, and resuming
never forces a reviewer out of history. Terminal replay stays opt-in and separate.

Changing review tabs, hiding the page, closing review or observing deletion stops
playback, aborts downloads and releases object URLs. Late completions cannot
repopulate a closed view. Retry is explicit when a clip is unavailable. Download
and decoder waits are bounded. The authenticated clip endpoint checks attempt
ownership, complete mapping, private descriptor paths, size, SHA256 and deletion
again after reading and immediately before publishing. Only two clip reads may
run concurrently, each at most32MiB; no codec runs in the HTTP process.

Capture metadata, original digests, deadlines, attempts, protected submissions and
retention authority remain unchanged. The existing CLI monitoring inventory/image/
export workflows retain their exact timestamps and provenance; no management
mutation or permission was added. No schema, native, credential or CLI migration.

Verification: focused real authenticated HTTP checks and timestamp/gap units pass;
36 affected media/conversion/export cases pass.63 Review/admin/theme/layout browser
cases pass, including actual Chromium VP9 decoding, paired seek/play/pause/speed,
uneven times, gaps, JPEG/video mixing, error retry, deletion, tab and close cleanup.
The final CSS changes prevent Speed-label wrapping and fix narrow Review tabs.
Seven targeted video/shared-live/mobile cases pass on fresh final assets, including
320px; prior63-case evidence remains separate. Full types/build and final Vite pass.
Evidence: var/collection-tests/synchronized-video-review.20261102a/.

This release is an additive backend read endpoint plus matching browser assets,
not an unchanged-backend UI-only attestation. Its exact matched image and guarded
cutover were qualified before production maintenance. Schema37 and the
native/CLI cohort remain unchanged. The previous reader remains compatible with
CURRENT data; rollback must retain that data and normal admission/backup guards,
never restore an older database. No production action is authorized by this file.
# November2 release scope

The synchronized reader uses the narrowly registered
`reviewed-web-read/synchronized-monitoring-playback-v1` installation scope.
It requires schema37, exact qualified source, unchanged installed/loaded CLI
digests and explicit CURRENT-data compatibility for the retained previous image.
It changes no native executable or service. The default UI-only scope remains
unchanged. Actual prepare/apply and failed-start/rollback/reopen tests preserve
all41 authority contracts; invalid scope/source/compatibility/cohort refuse
before a pause or service stop. All40 deployment interface tests pass.

