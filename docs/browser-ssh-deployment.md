# Browser SSH production rollout

Activated on 2026-10-13 Chicago time (2026-10-14 04:49 UTC).
Application and native agent source: `6233337`.
Production site: <https://ssh-exam.cadilhac.name>.

## Visible login/admission failure update, 2026-10-17

Deployed web source `10c1faf` at 2026-10-18 01:43 UTC (October 17, 20:43 Chicago).
An admission rejection after successful SSH now sends its public explanation before
closing the WebSocket. Unexplained socket closure also leaves a visible retryable
error. Fixed-stage audit entries exclude raw SSH details and skip closed-database
shutdown. The separate root-side account setup fix is pending explicit approval;
this web release does not make unconfigured class-server accounts exam-ready.

- Image: `ssh-exam-workspace:sign-in-error-10c1faf`, also `:1.0.0`.
- Image ID: `sha256:824b57dd359d650ba87d424fbdd212e17aee878c41bc19f711befbb8b9d07ed1`.
- Previous image: `ssh-exam-workspace:pre-sign-in-error-10c1faf`
  (`sha256:5e089a7686ca0729081723589f11d273d878c806793d97ecd2fc4fb606a4e5ca`).
- Backup: `/var/backups/ssh-exam/20261018T014327Z-sign-in-error-web-ffyeeomn`.

143 clean application tests, type checking, build and seven focused sign-in/browser
transition checks pass. Public JavaScript/CSS bytes match the tested build. The
cutover refused started/unresolved attempts and preserved all persistent row/config
fingerprints, schema 8 and unstarted preflight records. No class-server account policy,
agent, deadline or protected submission changed. Production readiness and notifications
pass; maintenance remains off. Rollback after started attempts drain: retag the previous
image as `:1.0.0` and restart, retaining current metadata and deadlines. Inspection
backups must not overwrite newer state; monitoring backups retain the 60-day policy.

## Enrollment/login identity and review completion, 2026-10-17

Deployed `69cef04` at 2026-10-18 01:20 UTC (October 17, 20:20 Chicago), then
`3fb9e74` at 01:23 UTC. Roster entry/import no longer consults an advertised account
registry: the live student SSH login verifies the account identity before admission.
The review fix publishes resume success only when its busy refresh has finished, so
Escape and Close review work immediately when success appears.

- Final image: `ssh-exam-workspace:review-3fb9e74`, also `:1.0.0`.
- Final image ID: `sha256:5e089a7686ca0729081723589f11d273d878c806793d97ecd2fc4fb606a4e5ca`.
- Final cutover backup: `/var/backups/ssh-exam/20261018T012304Z-review-web-xcypg43j`.
- Previous image: `ssh-exam-workspace:pre-review-3fb9e74`
  (`sha256:6f69a2182c4408f74b20b5bafc8bd92cdbb8ebd71d1f9fad4b1cb4230f137402`).
- Initial enrollment-fix image: `ssh-exam-workspace:enrollment-login-69cef04`.
- Initial backup: `/var/backups/ssh-exam/20261018T012016Z-enrollment-login-web-0da0uqdp`.
- Pre-enrollment-fix image: `ssh-exam-workspace:pre-enrollment-login-69cef04`
  (`sha256:4a4c6545bf58c5f91f67ea009399b53fc15e01d58e13b9dd1ba6ffcf60033c08`).

Both guarded restarts refused started/unresolved attempts and preserved all persistent
row/configuration fingerprints, schema 8 and unstarted preflight records. No SSH-server
agent, relay, account policy, administrator recovery access, deadline or protected archive
changed. Public and local readiness pass; notifications remain enabled and maintenance
off. Final public JavaScript/CSS bytes match the clean tested build.

The authenticated production walkthrough exercised a named disposable exam, single
entry, example download, invalid/replacement CSV preview and confirmation, real bulk
duration/webcam changes, menus/dialogs and read-only sandbox review. Temporary data
was removed with no attempts ever created, and all original rows matched the backup;
cleanup was audited. 141 clean application tests, type checking, production build,
17 admin/enrollment/transition browser checks and three fixture-SSH clock/MFA/recovery
checks passed; see [verification details](test-report.md#deployed-instructor-workflow-verification--2026-10-17).

Rollback after started attempts drain: retag `pre-review-3fb9e74` as `:1.0.0` and restart
to undo only the review fix. To roll back both changes use `pre-enrollment-login-69cef04`.
Keep current metadata and deadlines; new unresolved enrollments can verify at login on
subsequent forward deployment. Never restore an inspection backup over newer records.
Monitoring backups retain the existing 60-day policy; protected submissions stay on csc-sys.

## Instructor dashboard redesign, 2026-10-17

Deployed web source `57d4210` on marco at 23:51 UTC (18:51 Chicago time).
The compact exam toolbar, overview filters and grouped student/attempt roster are
live. Administration and row menus hold secondary actions; bulk edits use the
approved action-first selection mode. Review separates Monitoring, Activity and
Submission, with fresh status, deliberate recovery authorization and named deletion
confirmation. Exam settings are more compact and clarify the materials template.

- Image: `ssh-exam-workspace:admin-57d4210`, also tagged `:1.0.0`.
- Image ID: `sha256:4a4c6545bf58c5f91f67ea009399b53fc15e01d58e13b9dd1ba6ffcf60033c08`.
- Previous image: `ssh-exam-workspace:pre-admin-57d4210`
  (`sha256:e2433bf5af51f1d457d16109f3de8a61acb1fcdaa04b4cbc439d422f618b2855`).
- Consistent metadata/data and private configuration/trust/secrets backup:
  `/var/backups/ssh-exam/20261017T235135Z-admin-web-cd6k8cds` on marco.

The guarded cutover refused started/unresolved attempts and preserved unstarted
preflight records. All administrator, exam, enrollment, attempt, preview and
continuation row fingerprints matched before/after. Configuration, trust, service
and proxy fingerprints matched; schema remains 8 and no metadata migration was
needed. Only the web application restarted. The native class-server agent, relay,
account policy, deadlines, administrator recovery access and protected submissions
on csc-sys were untouched. Sandbox remains available and no submission archives
exist on marco. Local/public readiness confirms production-ready, notifications
enabled and maintenance disabled; the container is healthy.

Validation before release: 136 application tests, type checking, production build
and 54 browser scenarios verified across the complete run and focused reruns; see
[test details](test-report.md#instructor-interface-redesign--2026-10-17).
Public JavaScript and CSS bytes match the tested local build. The instructor-only
example endpoint rejects anonymous access. No production account/exam mutation or
real DePaul SSH/MFA login was used for these checks.

Rollback after started exams drain: retag the retained previous image as `:1.0.0`
and restart ssh-exam. Keep current data and deadlines; no schema reversal is needed.
The backup database is for inspection/recovery, never overwrite newer metadata.
Monitoring backups retain the existing 60-day deletion policy. Runtime mail sockets
were excluded from backup; protected submissions remain separate on csc-sys.

## Combined enrollment dialog update, 2026-10-17

Deployed web source `969fd87` on marco at 23:05 UTC (18:05 Chicago time).
The exam's Add student button now opens one dialog with One student and CSV file
choices. Upload validates automatically and requires explicit preview confirmation;
a downloadable example CSV is provided, with no paste editor or separate import
panel. Display names are removed from the interface and supported import/export/API
responses. Supported CSV columns are username, require_webcam and duration_minutes.

- Image: `ssh-exam-workspace:enrollment-969fd87`, also tagged `:1.0.0`.
- Image ID: `sha256:e2433bf5af51f1d457d16109f3de8a61acb1fcdaa04b4cbc439d422f618b2855`.
- Previous image: `ssh-exam-workspace:pre-enrollment-969fd87`.
- Consistent metadata/data and private configuration/trust/secrets backup:
  `/var/backups/ssh-exam/20261017T230535Z-enrollment-web-r0nbk5ca` on marco.

The guarded cutover refused started/unresolved exams and retained the unstarted
preflight record. Only the web application was restarted. All administrator, exam,
enrollment, attempt, preview and continuation row fingerprints matched before/after;
configuration, trust and service/proxy settings also matched. Schema remains 8: the
unused legacy name column is retained to preserve stored data and image rollback,
but application reads exclude it and new writes do not set it. No records/previews
were dropped. Native agent/login, relay, server account policy and protected archives
on csc-sys were not changed. No submission archives exist on marco. Public and local
readiness confirm production-ready, notifications enabled and maintenance disabled.

Validation: all 132 application tests, type checking, production build and four
focused browser scenarios passed. A fresh Chromium additionally loaded the deployed
public assets and verified the two-method dialog, example download, CSV preview and
confirmation, absent paste field/legacy name and Escape. These deployed UI checks
intercepted every API call with browser-local fixtures and performed no real exam or
account mutations; the actual new example endpoint separately rejected anonymous
access. No browser errors occurred. Existing screenshots were preserved.

Rollback after started exams drain: retag the retained previous image as `:1.0.0`
and restart ssh-exam. No schema reversal is needed; retain current data and deadlines.
The backup database is for inspection/recovery, never overwrite newer exam metadata.
Monitoring backups retain the existing 60-day deletion policy.

## Practice terminal welcome update, 2026-10-16

Installed `exam-login` from source `22039e8` on csc-sys at 2026-10-17
01:25 UTC (October 16 Chicago time). Newly opened practice terminals say
“Practice terminal. The exam clock has not started.” instead of `Deadline: 0`
and the timed-exam collection banner. The actual deadline state is unchanged.

This was an atomic replacement of the login display program only. The running
sandbox preflight and its practice terminal were preserved; no agent, watchdog,
relay or web service was restarted. Other native binaries retain `c6522a1` and
the web runtime retains `4a5610b`. The update held the agent state lock, refused
started/unresolved attempts and verified unchanged attempt state, deadlines,
configuration, trust keys, SSH/PAM/sudo policy and administrator identity.
All 15 protected archive checksums matched their manifests before installation
and remained unchanged afterward. Native and public production readiness pass;
all four class-server services remain active and maintenance remains disabled.

- Installed `exam-login` SHA256:
  `7fc296627f9bcb413f4c90df995057ea66dc397f0dcfd904173cd8755a4b2827`.
- Previous login binary and checksum:
  `/var/backups/ssh-exam/20261017T012551Z-welcome-22039e8-6n7f9l7g`.
- Validation: focused practice/timed welcome regressions, full native Go race
  suite and `go vet` passed. No real student login/MFA was initiated.
- Rollback: atomically restore only the backed-up `exam-login`; retain current
  agent state, deadlines and submissions. Existing terminals keep their running
  executable and already printed text until closed.

## Private temporary storage agent update, 2026-10-16

Installed native source `c6522a1` on csc-sys at 23:49 UTC. The web runtime remains
`4a5610b`; no web image, configuration, SSH/PAM/sudo rule, relay or account change
was needed. Each attempt now has separate writable `/tmp` and `/var/tmp`, shared
across its panes with `TMPDIR=/tmp`. Practice uses a separate pair. Both the
production sandbox and trusted administrator launch paths bind private directories.
Files remain available across pane closure, authorized recovery and agent restart,
are excluded from submissions, and are removed after verified protection and
confirmed workload termination. Cancellation cleanup is also reconciled.

The server was drained and already had real rootfs `/tmp`, `/var` and `/var/tmp`
mount points. The SHA-verified native upgrader backed up binaries/configuration and
preserved current state. All **15 protected archives** verified before and after;
attempts, original/current deadlines, configuration, keys, SSH/PAM/sudo policy and
administrator identity fingerprints were unchanged. Agent, independent watchdog,
reconciliation timer and SSH relay remain active; native and public readiness pass.

- Native backup: `/var/backups/ssh-exam/20261016T234921Z-browser-ssh-tvrg41xd`.
- Protected inspection baseline:
  `/var/backups/ssh-exam/private-temp-c6522a1-baseline.json`.
- Installed SHA256 checksums:

```text
a269230c9be9419fa11d463e83af4bfe7066cfaae0a232925138b10b4c53e2c7  exam-agent
dd9ea2edd39a689fdbb290f888af3bb7195b8b17820c260172028f115f83620b  exam-login
7c97afea5e3202d6a9364f5bf7070bd38d2f2b9608e4c964b9d8f418cea63e1f  examctl
55146cf6d1194c5ab07dbb1d4b233deecde595b041209c7f05300f64cfb1f673  exam-info
```

Validation: native Go race suite and `go vet` passed, including real local bubblewrap
mount checks. All **13 focused root checks on csc-sys** passed in disposable state,
including unprivileged UID 10001 writes, sticky-directory protection, actual systemd
host-launch mounts using nobody, cross-pane sharing, attempt/practice separation,
private-umask permissions, unsafe-link rejection, cleanup and retry protection.
These created no real exam, student SSH login/MFA exchange or student account. The installation
verifier's shell/Python syntax and documentation links were checked. The user's
modified screenshot was preserved.

Native rollback requires draining attempts and restoring only the saved binaries;
retain current state/deadlines/submissions. Old binaries do not manage these new
scratch directories: remove orphaned temporary storage only after confirming all
relevant workloads are stopped. Existing terminal mount namespaces never change in
place. See the class-server guide and recovery runbook for layout and permissions.

## Network recovery update, 2026-10-16

Deployed web source `4a5610b` (including `a9e48f0`) to marco at 23:32 UTC.
Both the workspace socket and browser SSH control connection must be acknowledged
before terminal input is enabled. Offline/disconnect events immediately cover the
workspace, invalidate queued input and require a new per-socket bind acknowledgment.
Unrelated HTTP/state replies cannot establish the connection; a late ACTIVE reply
cannot clear a local pause or renew an expired 15-second recovery grace. Grace uses
monotonic elapsed time and the last acknowledged healthy contact. A new interruption
or lost required condition while Begin/Continue is pending invalidates its delayed
activation reply.

An active-page reload stays in loading until an owned, CSRF-protected server request
locks the attempt, revokes its old page binding and disconnects SSH. It then opens the
recovery summary without showing sign-in, preflight or an active workspace in between.
This works even without a pagehide beacon. Repeated recovery requests preserve an
already granted instructor authorization; one grant plus fresh SSH/MFA and the normal
continue handshake is sufficient. Original timing is unchanged. Sandbox retains its
automatic-authorization exception; completed attempts cannot reopen.

- Current image: `ssh-exam-workspace:network-4a5610b`, also tagged `:1.0.0`.
- Image ID: `sha256:d80412d908ce24b3217f9c804f043788c4155ba8f83123a8720883d8a76a34ed`.
- Prior image retained as `ssh-exam-workspace:pre-network-4a5610b`.
- Consistent metadata and private configuration/trust/secrets backup:
  `/var/backups/ssh-exam/20261016T233220Z-network-web-9sw6k4do` on marco.

The guarded cutover verified no pending/active attempt and preserved fingerprints of
all administrator, exam, enrollment and attempt rows, plus configuration. Schema 8,
native agent, relay and server access policy are unchanged. No submission archives
exist on marco; protected copies remain on csc-sys. Roll back only the web image using
the retained prior tag after draining attempts; do not overwrite newer metadata.

Type checking, production build, all **130 application tests** and **43 browser SSH
scenarios** passed. Browser regressions observe every DOM commit and exercise real
fixture SSH/MFA, an open but unacknowledged reconnect, offline/online events, silent
connections, expired grace, queued input, delayed continuation and active reload with
one instructor authorization. Existing screenshots and the user's modified login
image were preserved. All **12 legacy transport transition/network scenarios** and
**12 post-cutover checks against the deployed bundle** also passed. The deployed
checks use browser-local API/WebSocket fixtures; no real student session, SSH/MFA
request, recording or exam was created. Both local and public readiness report healthy,
production-ready, notifications enabled and maintenance disabled.

## Workspace transition update, 2026-10-16

Deployed web source `bb24c17` (including `2619de5`) to marco on October 16
(21:21 UTC). Logout keeps its source screen/confirmation until acknowledgment;
instructor logout returns directly to `/admin` sign-in without a document reload.
Preflight and page restoration retain the summary and disable repeated actions
while pending. Fresh workspace connections say Connecting rather than Reconnecting.
A restored locked attempt mounts with its pause overlay already in place.
Continuation stays covered until acknowledged, and stale status replies cannot
restore an earlier page/state; fresh authoritative locks still apply.

Explicit Finish keeps a single collection view through HTTP completion, early
secured callbacks and sign-out. Old active replies cannot expose the workspace or
re-arm monitoring after Finish. Unconfirmed finish/sign-out failures remain
retryable in place; collection failure displays recovery rather than success.
Starting also retains its confirmation until acknowledgment, then opens the first
terminal after the dialog has actually unmounted.

- Image at that deployment: `ssh-exam-workspace:transitions-bb24c17`, also tagged `:1.0.0`.
- Image ID: `sha256:b01d201ec247aa5df73834d913abc9de77603dd9a3ca33bc4a0100959ca9bdf5`.
- Previous image retained as `ssh-exam-workspace:pre-transitions-bb24c17`.
- Consistent metadata and private configuration/trust/secrets backup:
  `/var/backups/ssh-exam/20261016T212155Z-transitions-web-ec1yw9f9` on marco.

No pending/active attempt was present at cutover. This is web-only: native agent,
relay, SSH policy, schema 8 and private configuration are unchanged. Fingerprint
comparisons verified administrator accounts, exams, enrollments, complete attempt
records and configuration were preserved. No submission archives exist on marco;
protected copies remain on csc-sys. The container is healthy; readiness reports
production-ready, notifications enabled and maintenance disabled.

Validation passed 126 application tests, all 35 browser SSH scenarios, six targeted
transition scenarios on the legacy fixture transport, type checking and production
build. Three old UI regressions reproduced on the previous frontend. Six scenarios
against the deployed bundle also passed with browser-local API/WebSocket fixtures:
no real account/session, SSH authentication, phone MFA, recording or exam was created.
The tests observe DOM commits across held responses, failures, retries, late polls,
early completion events and delayed sign-out. Existing screenshots, including the
user's modified login image, were preserved.

For web rollback, drain attempts and retag the retained prior image. No native or
schema rollback is needed; preserve all current metadata and protected submissions.
Never restore an inspection database over newer attempt state.

## Session transition update, 2026-10-16

Deployed web source `3c12fd4` to marco on October 16 (19:06 UTC).
The app resolves session identity, student exam details and public login
configuration before choosing a page. A confirmed 401 selects sign-in; other
startup failures offer retry without rendering an anonymous form. SSH completion
keeps its authentication panel visible until the session and exam details can be
committed together. Sent answers clear immediately; successful completion is not
posted twice when retrying exam-data loading. Sign-out retains SSH control long
enough for the existing agent cleanup to finish.

- Image at this update: `ssh-exam-workspace:session-3c12fd4`, then tagged `:1.0.0`.
- Image ID: `sha256:b44e95b2ae271b157c35c45f57c4db1830f3042d57f1fa578b4b0d82436b934d`.
- Previous image retained as `ssh-exam-workspace:pre-session-3c12fd4`.
- Consistent metadata and private configuration/trust/secrets backup:
  `/var/backups/ssh-exam/20261016T190657Z-session-web-sa1v5ji3` on marco.

No pending or active exam was present at cutover. This is a web-only change:
native binaries/configuration, relay, SSH access rules, schema 8 and submission
storage are unchanged. Fingerprints verified that administrator accounts, exams,
enrollments, complete attempt records and private web configuration were preserved.
No submission archive bytes exist on marco. The new container is healthy; readiness
reports production-ready, notifications enabled and maintenance disabled.

Validation passed type checking, production build, 126 application tests, all
29 browser SSH scenarios and five transition scenarios using the legacy fixture
transport. Delayed-response tests observe DOM commits to catch even brief form
flashes. Both original failures were reproduced with the previous frontend.
The new SSH test has its own fixture account, separate from focus-lock scenarios.
Existing screenshots, including the user's modified login image, were preserved.

Fresh Chromium checks against the deployed bundle exercised delayed administrator
session restoration and SSH-to-session handoff using browser-local response fixtures;
neither rendered an intermediate sign-in form or produced a browser error. They
created no real account/session, supplied no SSH credentials, requested no phone MFA
and started no exam. Both transitional layouts were visually inspected. Actual SSH,
MFA, terminal, recovery, finish and clock behavior is covered by the local fixtures.

A web rollback to the retained previous image does not require a native downgrade
or database restore. Drain attempts first and preserve current metadata; the earlier
coordinated-protocol and protected-submission rollback constraints still apply.

## Exam administration and server-only submissions update, 2026-10-16

Deployed application and native source `dd9819b` to marco and csc-sys on
October 16 (18:49 UTC). The user confirmed this is a trial instance with no
student work to interrupt. No started or unresolved exam was present. The
native upgrader cancelled one unstarted sandbox preflight; that browser must
sign in again. Database schema remains 8.

The release includes the exam-first dashboard, grouped student/attempt history,
individual and bulk future duration/webcam settings, reset and additive extension
controls, administrator creation, and fullscreen-visible action errors. CSV imports
change future enrollment settings; current-attempt clock actions use the dashboard.
The class agent advertises both `clock-extend` and `server-only-submissions`.
Archives remain on csc-sys; signed manifests/status and monitoring still return to
the webserver. The former archive upload endpoint returns 410 before reading its
body, and the web download route is absent (404).

- Image at this update: `ssh-exam-workspace:admin-dd9819b`, then tagged `:1.0.0`.
- Image ID: `sha256:f5dbe56d6018aeb049776044356a16a0f92e8dd74af6b7244c066703a7687c9a`.
- Previous image retained as `ssh-exam-workspace:pre-admin-dd9819b`.
- Consistent metadata and private configuration/trust/secrets backup:
  `/var/backups/ssh-exam/20261016T184848Z-admin-web-co00ad16` on marco.
- Native binary/configuration and state inspection backup:
  `/var/backups/ssh-exam/20261016T184922Z-browser-ssh-eg_9q1sl` on csc-sys.

The web backup deliberately excludes submission archive bytes and the runtime
SMTP socket. Before retiring legacy web archives, root `examctl manifest` verified
identity, checksum and protected storage on csc-sys. Three active web duplicates
and their three copies in the earlier clock/focus web backup were then removed;
protected authoritative submissions and web manifests/metadata were preserved.
The root-private `retired-web-archive-inventory.json` in this release's web backup
records all six exact paths, sizes and verified checksums. The earlier clock/focus
backup consequently no longer contains submission archive payloads. All 15
protected class-server submission bundles passed manifest verification afterward.

Installed native checksums:

```text
dacdda42ab5fcf38a6a4d09446974a743e5f4de45768a9188d225a8570881549  exam-agent
7f886341b96635be53995694d7175af9637444ca84907fd126dd320c1d4ae573  exam-login
ff779cb0debae49e268399fdc42d4aaec16fa5e0063b6552db42241fe5305697  examctl
9505b110a7ff1a892d87662199dad18a285f8d370a8bdf77b8ba17691d63a781  exam-info
```

Predeployment validation passed 126 application tests, all 24 browser SSH
scenarios, type checking, the production build and the full native Go race suite.
Live checks confirmed healthy web, agent, watchdog, reconciliation and relay
services; the new signed capabilities; maintenance disabled; production readiness;
and notifications ready. A fresh Chromium loaded both sign-in views and the new
admin assets with no browser errors. Unauthenticated administrator creation
returned 401, unsigned timing returned 403, retired downloads returned 404, and
archive uploads returned 410. No password, phone MFA approval or timed exam was
exercised during this rollout; interactive administration was covered by the local
browser suite.

Fingerprint comparisons confirmed that both administrator accounts, exams,
enrollments, all original/effective attempt intervals and checksums, and both
hosts' private configuration were preserved. Sandbox remains five minutes and
repeatable. A fresh ordinary mcadilha SSH connection retained its normal home,
`/bin/bash` and sudo access. Recording allowance remains 2048 MiB on both hosts.

Rollback must coordinate web and native protocol capabilities after draining
attempts. Preserve the server-only archive policy: do not re-enable archive uploads
or restore deleted web duplicates. Use a compatible release or a targeted fix if
an older release assumes downloadable archives. Retained images/binaries are
recovery inputs, not authority to overwrite current state. Never restore inspection
snapshots over newer submissions, clock requests, deadlines or access restrictions.
Keep the independent deadline/watchdog services running.

## Recording, clock reset and focus grace update, 2026-10-15

Deployed source `4f6e601` to marco and csc-sys on October 15 Chicago time
(October 16 UTC). The web database migrated from schema 6 to 8. No active or
unresolved exam/preflight was present during the coordinated upgrade.

The terminal recording allowance is explicitly configured to 2048 MiB per
attempt on both hosts. Instructor views show live presence and countdowns, with
a reset dialog prefilled with the exam's default duration. Resets preserve an
active student's terminal connection and also work while disconnected. Before
deadline collection, the agent obtains a signed timing decision; if unavailable,
it freezes writers and defers collection, retaining recoverability and access
restrictions. This adds no idle timing polling. Focus loss alone now displays a
20-second warning/countdown and permits recovery without instructor interaction
before expiry; other lock conditions keep their existing policy.

- Image at this update: `ssh-exam-workspace:clock-focus-4f6e601`, then tagged `:1.0.0`.
- Image ID: `sha256:ff0062bcdaae10816690b8ec2c4958d43c899c992648f2196d05b1fcc055f0bd`.
- Previous image: `ssh-exam-workspace:pre-clock-focus-4f6e601`.
- Web configuration, secrets and consistent data backup:
  `/var/backups/ssh-exam/20261016T034632Z-clock-focus-web-g2zflkm0`.
- Native binary/configuration and state inspection backup:
  `/var/backups/ssh-exam/20261016T034652Z-browser-ssh-0_dnxv50`.
- Native configuration before setting the recording allowance:
  `/var/backups/ssh-exam/20261016T034652Z-clock-focus-config-ocb7larf`.

Installed native checksums:

```text
972ef48d8a1fb4fb89a48d507822a860b45f0399c29eac16cf42a4509bb7e9c2  exam-agent
8714c9d9c9e9c973e4b4a33f948f4e4be55cb2b2fd792b730514026fb15c7b93  exam-login
e04b70a48b8579fcbde58aed179c0d754c24dd2a151a005e7bcd311d2434ecec  examctl
ce672a559f27ff1fda8347ea9baa4a577ce127fe39da81367a946718e3d4664f  exam-info
```

Predeployment validation passed 117 web/API tests, 21 browser-based SSH tests,
type checking, production build and the native Go race suite. Live checks
confirmed healthy web/agent/watchdog/reconciliation/relay services, signed agent
capabilities, maintenance disabled, production readiness and notifications ready.
A fresh browser loaded the new assets and both sign-in pages; an unsigned timing
request was rejected with HTTP 403. No password, phone MFA approval or timed exam
was exercised during this rollout.

Database comparisons verified that administrator accounts, exams, enrollments
and existing attempt intervals were preserved. Other configuration was unchanged.
Sandbox remains five minutes and available; fresh administrative SSH, the normal
mcadilha shell and sudo access were verified after installation.

Rollback must account for the new timing protocol and schema 7/8 state. The old
webserver cannot answer the agent's deadline timing check; rolling it back alone
can leave collection frozen and pending. Drain attempts and coordinate compatible
web/native versions under the recovery procedure. Preserve clock revisions,
original/effective deadlines, pending resets, current account restrictions and
protected copies; never restore an old state/database snapshot over newer work.

## Unsupported-browser view update, 2026-10-15

Web source `0ca6ada` omits the student form and its supporting login notices when
browser requirements are unavailable, retaining the compatibility message and
instructor sign-in link. The form also stays absent while compatibility checks
are pending. Build/type checking and seven focused browser scenarios passed.

- Image at this update: `ssh-exam-workspace:hidden-form-0ca6ada`, also tagged `:1.0.0`.
- Image ID: `sha256:a941a0fd41ae6acae6165bd4234be6deeda38c09e925a28c204523dd4f606a74`.
- Previous image: `ssh-exam-workspace:pre-hidden-form`.
- Web configuration/consistent metadata backup:
  `/var/backups/ssh-exam/20261015T164733Z-hidden-form-eohpeiog`.

## Browser compatibility update, 2026-10-14

Web source `44d7500` adds compatibility checks before student SSH authentication.
Missing fullscreen, screen sharing or keyboard lock, recognized embedding-policy
restrictions, insecure contexts and queryable denied permissions disable student
sign-in and preflight/reconnection controls. The form handler rechecks before any
authentication request, including forced submissions. Instructor sign-in remains
available. Loading the page does not request fullscreen or capture permissions;
actual permission grants remain part of preflight.

Verification covers 102 application tests and 17 browser scenarios, including
five incompatible/denied environments and a forced-submit guard. Independent
compatibility test clients use distinct fixture IPs so their extra visits do not
consume the existing student's anonymous rate-limit budget; production limits
are unchanged. Live Chromium checks confirmed supported sign-in is enabled,
missing keyboard lock disables student login before any authentication request,
instructor sign-in remains available, and production readiness is healthy.

- Image at this update: `ssh-exam-workspace:browser-check-44d7500`.
- Image ID: `sha256:e6e956a2cb900e7a5fe5edef32b3fad0769d0b5e43cf6e8f24141e065fa5a12b`.
- Previous image retained as `ssh-exam-workspace:pre-browser-check`.
- Web configuration/consistent metadata backup:
  `/var/backups/ssh-exam/20261014T160125Z-browser-check-6ek06er0`.

The native agent, exam state, account policy, signing keys and host pins were not
changed by this web-only update. Browser tests also wait for the reconnection
response before navigating, so the test does not cancel session revocation.

## Preflight and exit update, 2026-10-14

Application/native source for this update is `fc54019`. Preflight now describes trying
tools rather than starting work. Its toolbar omits administrator access-policy
details, the unexplained directory path and duplicate capture readiness. The
single active-exam exit is Finish exam: confirmation collects work and signs out
after protected completion. Preflight retains Sign out; pending/failed collection
stays visible. Administrator sandbox confirmations reflect its actual exception.

Practice files are now student-owned/readable/writable despite the root agent's
private umask. Additional panes preserve edits, older root-owned files are repaired
without replacing contents, and symlinks/hardlinks/special entries are rejected.

- Image: `ssh-exam-workspace:lean-fc54019`.
- Image ID: `sha256:4284a38b0675006d29b39d6a3243f468837952917f94ad41b3ffdcbe2ef6e1e6`.
- Previous browser-SSH image retained as `ssh-exam-workspace:pre-lean-preflight`.
- Web configuration/consistent metadata backup:
  `/var/backups/ssh-exam/20261014T154303Z-preflight-web-064pmq6m`.
- Native binary/config inspection backup:
  `/var/backups/ssh-exam/20261014T154052Z-browser-ssh-3b45_3o8`.

All 95 application tests, 12 browser scenarios, type checking/build and the native
agent race suite passed. Practice ownership/private-umask, preservation and unsafe
entry tests also ran successfully as root on csc-sys, including repair of an actual
root-owned fixture file. No timed attempt was interrupted; the guarded installer
cancelled an unfinished sandbox preflight before replacing the agent. Reload and
open a fresh preflight after this update. Existing administrator access, sandbox,
browser SSH, notifications and production readiness remain enabled.

The native checksums at this update were:

```text
715b9dd82e9a39171f808548d781680d349a0a6db89e835f107e78116931e030  exam-agent
a94f50cf3a7b99ec466bf66efe6e83b4f90262fd58d938bbf691798bfbbf3117  exam-login
22b76858def2a62dfd5df5ce899597267021f03f8c33a9448ed553372fbf3390  examctl
203c7f47c10362acdfdf0b93f12e1a7c85fd5b59dca623d64bd0db1583c9a3a8  exam-info
```

## Running architecture

SSH runs in the browser's dedicated Go/WASM worker. Its encrypted byte transport
is `wss://csc-sys.cdm.depaul.edu/ssh-exam/relay`, then the fixed institutional
route to sshjump. The browser authenticates sshjump, handles its phone MFA,
opens SSH forwarding to csc-sys, verifies that host's pin, and authenticates it
using the same temporary password. Terminal input/output and SSH credentials
do not pass through marco. The fixed relay and proxy route are described in
[the relay installation record](browser-ssh-relay-deployment.md).

Marco still serves the application and authorizes attempts/channels. Signed
commands travel through the authenticated student's SSH connection. Root-signed
receipts bind responses to the account, verified SSH transport, request nonce,
expiry and actual pane. The class agent records PTY output before forwarding it
and sends signed recording/status callbacks to marco. Screen/webcam capture
continues through the existing browser-to-webserver path. The agent's persisted
deadlines, collection and access restrictions remain independent of browser and
webserver availability.

The sandbox exam remains available, and mcadilha retains its administrator
shell and sudo access under the existing administrator sandbox exception.

## Initial browser SSH release and backups

Marco checkout is `/home/micha/src/ssh-exam`, linked from `/opt/ssh-exam`.
The existing systemd unit, nginx virtual host and port 3001 remain in use.
The Docker build produces the pinned Go/WASM client and matching runtime, so
no Go installation is needed on marco.

- Candidate image: `ssh-exam-workspace:browser-6233337`.
- Running service tag: `ssh-exam-workspace:1.0.0`.
- Initial image ID: `sha256:2f45b16d2307622531ae491a1929b5ec138458fd2495073662f5c5c3c1af002f`.
- Prior image retained as `ssh-exam-workspace:pre-browser-ssh`.
- Private config and consistent SQLite inspection backup:
  `/var/backups/ssh-exam/20261014T044930Z-browser-web-47ytvbix`.
- Initial rollout native binary/config inspection backup on csc-sys:
  `/var/backups/ssh-exam/20261014T043304Z-browser-ssh-7s_epme4`.

Only `browserSSH` was added to the private production configuration:

```json
{
  "relay": "wss://csc-sys.cdm.depaul.edu/ssh-exam/relay",
  "audience": "exam-ssh-relay-class"
}
```

Existing host pins, signing keys, notification settings, readiness signoff and
student/account policies were preserved. Private configuration and database
snapshots are not committed to Git.

The initial browser SSH release native checksums were:

```text
4bc704c8da137a9b3aab248fe462ca1c27a12102ec4bc6e0a4076bcee2dbee8b  exam-agent
e18c19f3b4db97ddde114d0b18ddbbb34161de30e85f19c063d0273cd06c666b  exam-login
0ffd1db269d457551e3d41d7e78af1fd86fd322bdd816198e8e2d6de4d10895f  examctl
14276ad674384ed694528e678238a87b961c87d032b563dcb2f8254fe504b926  exam-info
```

The guarded native upgrader was invoked with Python and a SHA-verified bundle.
It refused started/unresolved attempts, stopped command admission under the
state lock, and left the independent deadline watchdog running. An orphaned
practice workload from an old cancelled preflight was stopped by its recorded
cgroup; ordinary mcadilha sessions were preserved. Cancellation now cleans up
practice processes, and the local reconciliation tick retries that cleanup.

## Verification

- All 95 Vitest tests passed, including signed response binding, tampering,
  recording retries/conflicts and monitoring deletion tombstones.
- The Go SSH client race tests passed for shared-password authentication,
  phone MFA, explicit unknown prompts, host verification before credentials,
  rejection without password retries, multiple channels and credential cleanup.
- The native agent race suite passed, including authoritative recording failure,
  signed receipts, cancellation cleanup and existing collection/access tests.
- All 12 browser scenarios passed with real WASM SSH over a local relay and
  disposable SSH hosts, exercising MFA, terminals, capture,
  interruption/continuation and sandbox.
- Production `/health/ready` reports ready, production-ready, notifications
  enabled and maintenance disabled; `/api/login-test` reports browser SSH enabled.
- A fresh headless Chromium loaded the deployed worker, reached the real DePaul
  BlueKey password prompt for sandbox/mcadilha through the public relay, and
  cancelled successfully. The password field was empty throughout and removed
  after cancellation; no browser errors occurred.
- A gateway-signed registration through mcadilha's existing authorized SSH key
  produced a verified root-signed, transport-bound browser receipt from the
  installed class agent. It did not start an exam or use a student password.
- Installed hashes, class-agent/watchdog/reconciliation/relay services and
  mcadilha's normal shell/sudo access were checked after installation.

The live checks did not enter a password or approve phone MFA. Fixture MFA
coverage is not a claim that a human completed DePaul phone approval during
deployment. To exercise that final user path, reload the site, select `sandbox`,
sign in as `mcadilha`, and complete the ordinary DePaul prompt/phone flow.

## Updates and rollback

Normal web updates retain the existing conventions:

```sh
cd /opt/ssh-exam
git pull --ff-only
sudo docker compose --project-name ssh-exam --file docker-compose.yml build
sudo systemctl restart ssh-exam
```

The production environment selects port 3001. Preserve its private config,
trust files, secrets, data volumes and readiness settings. Native updates use
`python3 ssh-server/scripts/upgrade-prebuilt BUNDLE` as root on csc-sys after
started/unresolved attempts have drained; never overwrite live agent state with
an inspection snapshot.

For a web rollback, pause new starts and drain active attempts first. Stop the
web service, restore the matching private configuration from the web backup,
tag the retained prior image as `ssh-exam-workspace:1.0.0`, and restart the
service. The new agent remains compatible with the legacy backend SSH transport,
but releases using deadline timing checks also require a compatible timing
endpoint; see the coordinated rollback requirements above. Preserve all current
metadata, root recordings, deadlines and protected submissions.

Do not restore the SQLite or agent-state inspection backups as part of ordinary
rollback: doing so would discard newer attempt, restriction and submission state.
Leave the class deadline/watchdog services running. Removing the relay is only
appropriate after browser clients have drained and the legacy web transport has
been restored; follow the separate relay rollback instructions then.
