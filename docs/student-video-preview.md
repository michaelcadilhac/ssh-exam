# Student webcam preview and floating windows

Implemented November24; pushed and deployed November25 as runtime96a323e,
controller6083777. [Deployment and recovery](student-video-preview-release.md).

## Scope and acceptance

The student entry points are Enable webcam, Start exam and Resume exam. The
camera preview belongs in setup. A floating browser picture-in-picture window
can steal document focus while the exam remains visible and fullscreen, creating
an avoidable interruption when a student moves the preview.

The bounded correction disables picture-in-picture on the preflight preview and
the detached screen/camera videos used for capture. Start and Resume close an
existing pop-out only when its video or MediaStream belongs to this workspace.
Closure precedes the Start/Continue request; Start still requires fresh challenged
capture. Closing a video window does not stop its tracks or recording.

If the browser refuses, leaves the window open or does not answer within two
seconds, the action stops with: “Close the floating video preview, click the exam
page, then try again.” No Start request is sent and no grant or clock is consumed.
An existing running countdown retains its existing timing during a failed Resume.
Unsupported picture-in-picture and unrelated media require no action. Cancellation
during closure cannot authorize a stopped workspace. There is no new durable
state, account reservation, background probe or management setting.

Acceptance requires prevention through the actual Chromium API, actual existing
pop-out closure before Start and Resume, a retryable refusal before any Start
request, continued camera uploads and the same start/deadline after resumption.
The existing interruption grace, capture recovery and webcam-off behavior must
continue to pass. No monitoring condition is ignored to make these tests pass.

## Browser limits and operation

The application never requests picture-in-picture. The browser may offer it for
an otherwise ordinary video element. `disablePictureInPicture` is a browser
request, and user configuration or extensions can override it. This correction
does not claim control over arbitrary operating-system windows or change the
existing focus/visibility policy. Preview movement is not evidence of misconduct.

The own-stream check also recognizes the preflight preview, which is a separate
video element from the internal capture video. Only those owned media are closed.
The close wait is a local UI bound, separate from unchanged 60-second transport
timeouts and authoritative deadlines. The existing 15-second interruption policy
is unchanged; see [interruption operation](interruption-grace.md).

There is no new operator setting or CLI capability. Existing `examctl web attempts
show ATTEMPT`, `examctl web interruptions show ATTEMPT` and `examctl info ATTEMPT
--read-only` remain the supported inspection workflows. Existing Allow resume
and the matching interruption authorization CLI retain their original rules.

Browser reference: [disablePictureInPicture and override limitations](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/disablePictureInPicture).

## Verification and release boundary

The initial focused unit run fails all nine new regressions against the old
implementation. The affected capture/setup/grace unit run passes 39 checks.
TypeScript checking, including the new browser fixtures, and the production
web/WASM/server build pass. The restricted sandbox initially refused spawning
the installed Go tool with EPERM; the authorized local build succeeds outside
that restriction. No package was missing or installed.

All three focused browser workflows pass against rebuilt assets. These use the
real Chromium Picture-in-Picture API, actual canvas MediaStreams and capture
encoding/upload, with synthetic accounts and mocked authority. An enabled
positive control really opens a native pop-out; the disabled preview refuses
specifically because `disablePictureInPicture` is present. No physical Windows
drag or privileged native freeze qualification is claimed.

The first browser run exposed two fixture errors: active legacy uploads use
`/frames` rather than only challenged-upload routes, and an ordinary paused exam
uses “Instructor review required” rather than the sandbox heading. The corrected
tests observe those actual interfaces, retain their original failed evidence and
do not change enforcement. The initial owned runner was verified empty with its
listener closed before retry.

All 14 related browser cases pass (1.6 minutes), including the three new cases,
the unchanged interruption grace/deadline/SSH-loss controls, preflight retry and
webcam-off behavior. Both real HTTP capture/hash/retry/readback cases pass.
All owned browser services have MainPID 0, empty/removed cgroups and the fixture
listener closed. Final receipts and per-test output are private under
`var/student-video-preview/20261124/`. Existing documentation PNGs are preserved.

Production acceptance passes47 external asset hashes,41 preservation contracts,
270 unchanged native histories, all native process identities and a signed CLI
read. Native code, schemas, grant settings and authority
wire formats do not change, so unrelated native races/class-capacity tests are
not repeated. Any future authorized release must freeze its web image/assets
and qualify the existing guarded deployment/preservation/recovery workflow. No
migration or native service restart was needed for this UI correction. Keep
CURRENT records, recordings, attempts, account holds and original deadlines.
