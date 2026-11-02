# Synchronized recording review

November2,2026. Implemented and tested locally.
Not pushed or deployed. This supersedes the independent screenshot sliders.

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

Deployment is separate: this is an additive backend read endpoint plus matching
browser assets, not an unchanged-backend UI-only attestation. Freeze/qualify the
matched web release and its guarded cutover before deployment. Schema37 and the
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

