# Current local SSH-command/callback validation (2026-10-12)

The separate class-agent control API is removed. Commands run on authenticated student SSH
channels with pinned gateway signatures; authoritative deadline collection and access holds
remain local; signed status and archive callbacks have durable retries and deduplication.
Instructor stop UI/API is removed and local examctl controls replace it.

Validation on the local machine only:

- TypeScript typecheck and production build pass.
- 88 application unit/integration tests pass, including SSH password cleanup/MFA, callback
  signatures, duplicate/conflicting/stale events, original intervals, protected transfer,
  restart recovery, connection requirements and independent instructor approval.
- 12 browser tests pass: sandbox repeated runs/recovery, preflight and terminal input,
  window controls, roster operations, sign-out, recovery order and retained MFA messages.
- Native Go race suite passes, including new command ownership/transport/replay checks,
  continuation delivered at registration, early-finish original access hold, local admin
  controls, durable TLS callback outage/restart recovery and no idle HTTP requests. Existing
  writer/hostile filesystem/collection recovery and local OpenSSH denial tests also pass.
- 8 installation-checker tests pass. Both nginx templates validate locally with temporary
  certificates, writable temporary paths and unprivileged test ports.

These automated checks preceded deployment. The subsequent authorized deployment on
marco and csc-sys, actual SSH/callback checks, historical archive migration and preserved
qualification limits are recorded in [ssh-command-deployment.md](ssh-command-deployment.md).
Global agent stop/start actions were checked as service command plans, without stopping
local host services. See ssh-server/README.md for administrator commands and migration.

The following sections record earlier implementation/deployment tests and their historical
transport; they do not establish that the new architecture is installed on those hosts.

# Implementation test report

Run date: 2026-10-10. All SSH accounts/hosts used here were disposable local fixtures.
The original acceptance specification is [SPEC.md](../SPEC.md). Integration items requiring
real privileged hosts or permissions are listed in [compatibility.md](compatibility.md);
this report is not production approval.

## Automated verification

| Check | Result and coverage |
|---|---|
| TypeScript | `npm run typecheck` and `npm run build` pass; frontend and backend compiled |
| Unit/integration suite | 75 tests across eleven files: readable recovery validation, roster parsing including 10,000 rows, persistent state, monitoring authorization/deletion, canonical deadlines/lock generations, HTTP role/CSRF/Origin ownership, real loopback two-hop SSH and host-key rejection |
| Chromium browser suite | Ten scenarios: sign-in, individual/bulk enrollment and removal, instructor sign-out, terminal typing/window lifecycle, webcam numbering and pre-start sign-out, active input/paste denial/fullscreen-exit lock, active sign-out, and completed/locked sign-in explanations. Recovery checks include restore feedback, instructor authorization, and preservation of the original deadline. Capture and Keyboard Lock are simulated explicitly |
| Native suite | `go test -race ./...`: state, one-use admission/UID ownership and hostile filesystem collection tests. This does not execute privileged PAM/sshd/cgroup integration |
| Dependency audit | `npm audit`: zero reported vulnerabilities at verification time; exact transitive versions in package-lock.json |
| nginx | Syntax validation passes using temporary test certificates and runtime paths; production TLS operation untested |
| Backup/restore | Offline synthetic backup restored with newer monitoring and submission deletion records; both copies stay deleted |
| Demo startup | Compiled backend starts with documented disposable fixtures; live and development mTLS readiness endpoints pass |
| Load | 100 students, 100 jump and class transports, 400 panes, two synthetic JPEG streams per student; zero observed errors |

Load evidence is [load-report.json](load-report.json). The run lasted 14.38 seconds and
processed 990 measured requests with latency p50 19.60 ms, p95 45.33 ms, p99 69.11 ms.
590 images and 34,400 terminal-output bytes produced 150,371,310 private-storage bytes.
Hardware: i7-1365U, 12 logical CPUs, 33.28 GB RAM. Capture used 800×450 synthetic JPEGs
(208,906 bytes). Native privileged control and browser condition reports were simulated.
This short run validates a fixture target, not production capacity or image readability.

## Node 26 upgrade verification (2026-10-12)

Verified a clean locked installation on Arch Linux using `/usr/bin/node` 26.11.1 and
npm 12.2.0. Updated better-sqlite3 to 12.11.1 and Node types to 26.6.5. The SQLite
binary loads under module ABI 147, and argon2, sharp and ssh2 runtime checks pass.
The SQLite upgrade reads the existing six-attempt test database with integrity `ok`
and no foreign-key violations; a consistent metadata backup was retained before switching.

`npm run typecheck`, `npm run build`, all **85 application tests across 13 files**,
and all **12 Chromium browser scenarios** pass on Node 26. Coverage includes shared-password
cleanup, MFA instruction preservation, host-key verification, automatic collection,
continuation, preflight reconnects and terminal interaction. `npm audit` reports zero
vulnerabilities for the upgraded lockfile. Testing exposed and fixed terminal housekeeping
races: delayed resize/close messages and terminal admission failure after finalization or
pause no longer place an error dialog over the submission receipt. Terminal input and new
open requests remain rejected when access is disabled.

The local webapp and independent test control relay were restarted with the system Node
binary; `/health/ready` returns ready in the existing administrator functional-test mode.
No temporary Node runtime is required. The pinned Docker image was updated to Node
26.11.1-bookworm-slim using its registry-verified manifest digest. Docker build/Compose
validation remains unavailable because the Docker daemon is not running. These checks
do not grant production host, browser-permission or institutional-service qualification.

## Reproduce

Use Node 26.x (verified 26.11.1), Go 1.27.2, npm and installed Chromium. Reinstall
dependencies with `npm ci` after a Node major-version change:

    npm ci
    npm run typecheck
    npm test
    npm run build
    npm run test:browser
    npm run test:load
    cd ssh-server
    GOCACHE=/tmp/exam-go-cache go test -race ./...
    mkdir -p bin
    for name in exam-agent exam-login examctl exam-info; do CGO_ENABLED=0 go build -trimpath -o bin/$name ./cmd/$name; done

Tests open loopback sockets. Browser tests default to `/usr/bin/chromium`; set CHROMIUM
for another installation. The load runner records its hardware and overwrites its report.
The reproducible ssh2 source patch is applied during npm installation and rejects unexpected
upstream source rather than silently skipping zero-prompt instruction handling.

## Handoff and limitations

Implemented components include the student workspace, retained SSH gateway, persistent
attempt/continuation state, private media and output recording, instructor roster/review,
protected archive retrieval, native gate/agent/watchdog/collector and deployment packaging.
Screenshots of the implemented interfaces are in [screenshots](screenshots/).

The production installation has not been performed. Docker build/Compose startup could not
be exercised because this environment lacks a running Docker daemon and Compose plugin.
No real institutional MFA, SMTP, browser permission or privileged containment claim is made.
Production configuration and native guard flags deliberately fail closed until signed off.
The frontend bundle currently exceeds Vite's 500 kB warning threshold (about 150 kB gzip).
There is one supported gateway instance; live SSH connections are not distributed or restored
from backup. Per-pane namespaces do not provide shared loopback services between terminals.

See [deployment](deployment.md) for exact startup/install commands, [architecture](architecture.md)
for schema migration and trust boundaries, and [recovery](recovery-runbook.md) for backups,
deletion tombstones, failed collection and rollback. Dependency versions are pinned in
[package.json](../package.json), the lockfile and Dockerfile; the native agent uses the Go
standard library only. Native production entry binaries must use CGO_ENABLED=0.

## Interface review

A Chromium regression review exercised Enter/Backspace in practice and active terminals,
minimize/restore, maximize/restore icon and accessible-label changes, rename, cancelled and
confirmed terminal close, reopen, sequential terminal names, Escape dismissal, dialog width
and overflow, webcam and no-webcam preflight steps, CSV paste/confirmation, individual student
addition/removal, and instructor/student sign-out. Screenshots include the terminal-close
dialog, student workspace and instructor roster.

Fixes include floating initial panes, conditional step numbering, separate visible enrollment
actions, collapsible CSV controls, modal focus containment/return, safe Escape handling,
terminal-control labels, capture-state indicators, and sign-out with persistent lock/deadline
semantics. SSH gate parsing now pauses post-admission output until the consumer attaches;
the disposable shell echoes input and accepts xterm's Enter and Backspace. Failed pane
admission removes the optimistic window. Student removal cannot change an active attempt
snapshot and is checked again before Begin. These checks use isolated fixture data; they
do not establish real browser permission or privileged host behavior.

The recovery dialog now displays each condition and immediate restore feedback. Missing
conditions and authorization produce readable messages. Completed attempts are identified
before requesting SSH passwords. The workspace has one toolbar; terminal title bars contain
snap and rename controls, and Tools contains clipboard/font controls and minimized terminals.

Preflight regressions cover incomplete connected preparation, disconnected expiry, reload
after expiry, sign-out before starting, retry with a fresh operation ID, cleanup of reservations
without live SSH after a gateway restart, and refusal to collect unstarted preparations.
Cancellation is reconciled with the class server before a reservation is retired; a remote
committed start becomes locked with its original deadline. Cancelled metadata is retained
in the audit log and monitoring deletion tombstones are preserved across retries.

Login-only development tests cover the full HTTP/WebSocket authentication dialogue without
fixture enrollment, two-hop SSH with no shell or exam-agent admission, rejection of the mode
in production, disabled exam endpoints, and the separate login-success interface. The local
real-host profile uses existing known-hosts keys for the DePaul jump/class hosts; jump-host
reachability and key matching were checked without credentials. Institutional MFA and class
authentication still require the operator's interactive test.

SSH challenge regression tests retain number-matching instructions across empty follow-up
rounds, preserve pending password prompts/round IDs on informational notices, clear messages
when changing hosts or starting a fresh login, and prevent duplicate submissions. The actual
ssh2 fixture emits a number instruction followed by an empty keyboard-interactive round;
browser sign-in checks the number remains visible before class-host authentication. Host
messages remain ephemeral UI state; user answers are never added to the message history.

## Shared SSH password verification

The login now asks for one shared password and reuses it only for the two configured, pinned
hosts. Tests cover password-method and keyboard-interactive authentication, phone number
matching plus empty rounds, mixed password/hidden verification-code prompts, mismatched keys
before credential supply, rejected passwords and repeated password prompts without retries,
four panes on retained transports and fresh credential entry for a subsequent login.

Cleanup checks inspect overwritten buffers, dropped credential/dialogue references, detached
auth listeners and cleared SSH options before exam admission. Abort coverage includes failure,
explicit cancellation, whole-login timeout, late answers, browser disconnection and shutdown,
including a temporary password copy awaiting another MFA response. HTTP/WebSocket tests use
a synthetic per-test secret and check logs, public messages, all database tables and data files
for its absence. Browser checks confirm immediate input clearing after transmission, no
password in message history or URLs, and preserved number-matching text. JavaScript cleanup
is best-effort, not guaranteed erasure; [SECURITY.md](../SECURITY.md) explains runtime limits.

`npm run typecheck`, `npm test`, `npm run build`, and all ten Chromium scenarios passed for
this change. Institutional phone approval remains an interactive operator check.

## Automatic, transparent submission verification

Students save normally in the configured directory; no submission command, upload or archive
creation is required. Finish is optional and irreversible, with the same collection pipeline
as deadline expiration. Native race tests cover ACTIVE/LOCKED expiration without browser or
gateway, individual duration, early finish, concurrent finish/deadline requests, collection
and termination failures, restart recovery, publication-before-state-save crashes, immutable
verified bundles, incomplete/corrupt artifacts, configured directory labels and unsafe roots,
hardlinks, symlinks, FIFOs and sockets. A real helper with an open writable descriptor changes
its file continuously and is stopped before collection; its frozen content hash matches the
manifest. This injects a SIGSTOP barrier and does not claim production systemd/cgroup QA.

The watchdog's read-only cutoff pass is independent of the archive/state lock. Tests hold that
lock and verify cutoff still executes; one freeze failure must not skip other expired attempts.
A backward wall-clock condition cannot thaw an attempt after its monotonic deadline.

Gateway tests verify immediate input revocation, delayed SSH teardown until protection,
actual receipt timestamps, transferred file manifests, identity/checksum checks, immutable
local artifacts, transfer retries after restart without recollection, instructor failure
alerts, and separation from monitoring expiry. Migration 002 preserves existing deadlines
and works when reopening version-1 metadata. Chromium covers the visible automatic notice,
irreversible Finish confirmation and cancellation, secured receipt, and instructor-only
download. Type checking, build, 75 unit/integration tests and all ten Chromium scenarios pass.

Privileged real-host freeze/PAM/watchdog deployment and SMTP delivery remain manual
qualification requirements. Class-server failure state/audit/journal records survive gateway
outages; instructor delivery resumes on gateway reconciliation, with institutional journal
monitoring needed for independent alerts during a gateway outage.

The final capture-stop/status UI adjustment was rechecked with the complete early-finish
Chromium scenario after the full ten-scenario run. The local app was restarted with its
existing real-host login-only profile; this restart does not deploy native services to the
class host or claim production privileged qualification.

## Original-interval account restrictions (2026-10-10)

79 TypeScript tests across 11 files pass; 38 top-level native tests (including helpers) pass
with Go race detection; 7 machine-check contract tests pass; all 10 Chromium tests pass.
Typecheck, production web/server build and static native agent/login/CLI builds pass.
Logs: /tmp/ssh-exam-access-tests-final.log, /tmp/ssh-exam-native-access-tests-final.json,
/tmp/ssh-exam-access-browser.log and /tmp/ssh-exam-access-build-final.log.

The real disposable unprivileged OpenSSH integration rejects shell, remote command, SFTP,
SCP protocol, forged variables and new channels on an authenticated ControlMaster after early
collection; working bytes remain unchanged. Native tests prove COMPLETED+HELD across reload/
new engine, original deadline preservation, other UID independence, completed recovery refusal,
stale practice/purpose/lease rejection, unfinished authorized recovery, verified deadline release,
forward-clock hold, missing/malformed state, corrupt protected artifacts and durable override
audit failure. Gateway tests preserve HELD after successful export/restart and only display
RELEASED after explicit class-server inspection; release verification failure alerts once.
SQLite reservations reject overlapping UID holds. Browser receipt explains the continued hold.
Machine-check contracts reject unsafe SSH gate/environment, writable/missing static gate,
lingering, alternate PAM admission, queued user cron, system cron and service UID writers.

The OpenSSH harness uses the existing unprivileged test account's ForceCommand and test-only
helper; it does not alter that account's shell or install PAM/systemd policy. Real pre-startup
static gate, all listener/Match branches, cron/at execution, system services/timers, actual UID
termination and cgroup freezing/reboots still require the documented disposable supported-host
qualification. Existing real detached-writer collector tests use a confirmed SIGSTOP barrier,
not a production cgroup. New production signoffs remain false; no native changes were deployed
to institutional hosts. The local app retains its real-host login-only development profile.

## Terminal context-menu update (2026-10-11)

Terminals now provide an accessible right-click/Shift+F10 menu with Copy, Paste,
Zoom in, Zoom out and Reset zoom. The shared clipboard stays attempt-local; no OS
clipboard access is introduced. Zoom applies to one pane and sends fitted SSH dimensions.
Duplicate toolbar clipboard controls and the global text-size slider were removed.

Build passed. Focused Chromium tests verified cross-pane selection copying/pasting,
both zoom directions/reset, keyboard opening/navigation, Escape/focus restoration,
empty clipboard disabling and disappearance on fullscreen lock. The existing practice
terminal window controls/rename/closure test also passed. Port 3001 was verified serving
new assets without restarting an active exam session.

Lean workspace update: removed the persistent collection/status rows and Rules button; retained collection information in the start confirmation and toolbar tooltip. Terminal errors remain visible in dismissible dialogs. Build and both focused terminal/recovery browser tests passed.

Student-dialog review: sign-out now explicitly confirms automatic collection while signed out; start/finish/close wording is consistent. Removed clipboard scope footer and moved technical receipt fields into collapsed details.

## Whole-interface leanness review (2026-10-12)

Reviewed student/instructor sign-in, password/MFA prompts, signed-in exam summary,
preflight, active terminals/context menu, recovery, start/finish/close/sign-out dialogs,
submission receipts, instructor attempt table/settings/roster/CSV import, alert setup,
recording review/replay, audit delivery and deletion controls. Removed the promotional
landing column and redundant eyebrows/footer/empty-state slogans. Kept browser/recording
consent, temporary password notice, deadlines, monitoring and failure/recovery facts.
Instructor alert setup and audit/collection/deletion details are expandable; downloads
are outside CSV import, replay panes have readable labels, and unnecessary pagination,
zero terminal counts, archived contact/countdown values and optional missing webcam text
are suppressed. Build passed and sign-in/dashboard screenshots were visually reviewed.

Final UI validation: nine browser scenarios passed in the full run; the login-only scenario passed its focused rerun after updating obsolete notice/footer assertions. All ten scenarios are validated. The running port-3001 instance was confirmed serving the compact interface without restarting an exam.

## Repeatable sandbox (2026-10-12)

Build passed; application suite 82 tests passed; native race suite passed with sandbox
secured-release/failure tests. All 11 browser scenarios are validated across the full
run and focused reruns, including automatic enrollment, five-minute duration, fullscreen
recovery, relogin with the original attempt/deadline, immediate repeat after early finish,
retained history, and a historical transfer retry preserving the new SSH connection.
Authentication form branches have distinct keys so cancelling cannot reuse a submit
button and accidentally begin another login.

The real server ran two consecutive sandbox attempts with an expired configured window
and a requested 90-second duration; the native agent correctly used 300 seconds, preserved
continuation deadlines, secured early collections and allowed immediate repeat. Both
protected archives remain checksum-verifiable. Native report: var/full-test/native-sandbox-report.json.

Attempt `7da38850-cda8-4d05-aca0-82c897bb2e6a` · SHA-256 `51cb954586c0710cef98e9485067c3adcfa0609f82515f383b72b8d2e08778bf`.

Attempt `ddb7355a-6866-43aa-a78b-b4e9d23badb5` · SHA-256 `0b87f4bf964cdcd586f21ba03a22eaf144dc5eeb5e6ab2cf0cf69292f601a16f`.

## Single authorization and compulsory fresh SSH after pause (2026-10-12)

One generation-bound resume grant now covers reauthentication, replacement transport/page
and continuation. Pause immediately closes both gateway SSH clients and stops capture.
The native agent terminates old workload cgroups, rejects reuse of their transport and
rejects consuming a grant without attaching a fresh transport. Watchdog pauses apply the
same rule. Intentional close cannot create another SSH-loss incident and revoke the grant.

Build, native race tests, all 83 application tests (full run plus HTTP rerun), and all 11
browser tests passed. Browser checks verify normal and sandbox disconnect/relogin flows,
one instructor approval and unchanged deadlines. Real csc-sys check stopped the old scope,
rejected old-transport attach/continuation, attached a fresh SSH session under the same grant,
verified saved work and original deadline, and checksum-verified the resulting submission.

Real attempt `bc2cabcd-337e-49cb-b0bb-139574a32f40` · SHA-256 `7ca70574a983294402cbcbff7f07e339b6b57c82acb54b3ed6dd99d6fc97c02c`.


## Recording budgets and instructor clock control — 2026-10-15

- Web/API regression suite: **111 tests passed**; TypeScript check and production build passed.
- Browser-based SSH suite: **18 browser tests passed**, including two separate instructor/student browsers proving live presence, a ticking countdown, the exam-default reset value, Escape cancellation, preserved attempt/start/generation and continued terminal input after a reset. The same new scenario also passed with the legacy fixture transport.
- Native class-agent suite passed with Go's race detector. New coverage includes persistent/shared recording budgets and independent-pane concurrency; live and concurrent resets; immutable original access holds; restart/idempotency/stale receipts; signed HTTPS timing checks; disconnected extensions; unavailable verification freezing and deferring collection; subsequent collection; and a slow timing request not delaying other execution leases.
- Deadline timing uses a separate bounded worker path; cutoff and lease reconciliation never wait on HTTP. No idle timing HTTP polling is added.
- Source/configuration examples and design/operator/recovery documentation are updated. Defaults are 2048 MiB per attempt at both ends; no 64 MiB terminal recorder/receiver ceiling remains.
- Verification used local SSH, TLS and browser fixtures. The subsequent coordinated production deployment to marco and csc-sys is recorded in [the deployment log](browser-ssh-deployment.md).


## Focus grace — 2026-10-15

- Focus loss alone starts a visible 20-second amber warning/countdown. Returning in time clears it without changing the exam clock, attempt, SSH connections or continuation generation. Terminal input is blocked while unfocused; monitoring and lease renewal continue.
- Migration 008 stores the first server-received loss timestamp. Repeated blur/heartbeats do not restart it; a late return cannot evade expiry. The server timer enforces the lock independently of client incidents. Normal continuation clears the previous interval.
- Fullscreen exit, a hidden page, capture failures and the separate 15-second network bound retain their existing behavior. Begin/Continue still require focus.
- **117 web/API tests passed**, including six new unit cases; **21 browser-based SSH tests passed**, including real-time countdown/recovery, a focus loss longer than 15 seconds, repeated blur, server expiry with the client incident suppressed, and immediate fullscreen/visibility locks during grace.
- TypeScript check and production build passed. The warning was visually inspected at a desktop viewport; existing user screenshots were preserved. Verification used simulated focus/media with local SSH fixtures, not a physical dual-monitor qualification. The subsequent production deployment and live checks are recorded in [the deployment log](browser-ssh-deployment.md).


## Fullscreen workspace errors — 2026-10-15

Workspace action failures now use a dismissible dialog inside the fullscreen
workspace instead of the outer application banner. Keyboard Lock rejection
leaves readiness false, retains the browser diagnostic and explains retrying or
using standalone desktop Chrome/Chromium. Recovery continues to show its inline
feedback. The shared path also covers failed start/finish and capture actions.

The reported `lock() request could not be registered.` rejection was reproduced
against the previous build: the error appeared outside the fullscreen subtree.
The regression test now verifies immediate fullscreen visibility, blocked Begin,
Escape dismissal/focus restoration without exiting fullscreen, successful retry,
and a server-side Begin failure displayed in the same fullscreen error dialog.
The dialog screenshot was visually inspected. All 117 application tests and four
focused browser-SSH scenarios passed, including normal webcam preflight, active
fullscreen recovery and Finish exam. Type checking and production build passed.
Existing screenshots were preserved. The subsequent coordinated deployment is
recorded in [the deployment log](browser-ssh-deployment.md); tests simulate the embedded browser's rejection rather than granting capabilities
the host browser does not provide.


## Administrator creation — 2026-10-15

The instructor dashboard now has **Add administrator**, with a focused modal for
username, password and confirmation. Password fields clear immediately on submission
or mismatch and are discarded on cancellation. In-flight requests disable duplicate
submission and cancellation; server failures remain visible in the dialog. Success
identifies the created username. The new account has the same administrator permissions.

`POST /api/admin/administrators` requires an administrator session, same-origin request
and CSRF token, limits request size/rate, validates bounded inputs, hashes with Argon2id
and atomically audits actor/target. Duplicate/concurrent requests return 409 and never
replace an existing account. Neither plaintext passwords nor hashes enter the response,
audit or request logs; request credential references are cleared after processing.
No schema migration is required. Initial CLI bootstrap remains available.

Type checking and production build passed. All **120 application tests passed**, including
role/CSRF/origin rejection, input validation, secret-free storage/logging, sign-in and
concurrent duplicate creation. Three focused browser-SSH scenarios passed: administrator
creation/cancellation/mismatch/duplicate/sign-in, existing instructor enrollment controls,
and the pending fullscreen-error regression. A held network request verified empty password
fields and disabled submission while waiting. The dialog was visually inspected; existing
screenshots were preserved. The subsequent coordinated deployment is recorded
in [the deployment log](browser-ssh-deployment.md).


## Exam-first administration and SSH-server-only submissions — 2026-10-16

Implemented the approved design: no automatic exam selection or exam data before selection;
one table groups every attempt beneath its student, including removed enrollments and students
without attempts. All counts/activity/monitoring stay scoped to the chosen exam. Student-level
pagination preserves complete groups and filtering preserves attempt numbers. Late dashboard
and monitoring replies cannot replace a newer exam/dialog. Bulk controls are expandable and
selection distinguishes future student settings from current attempt clocks.

Individual/bulk duration and webcam overrides change future attempts only. CSV retains
username/display_name/duration_minutes/require_webcam, with transactional preview/confirmation
and exam-default inheritance; it cannot run clock actions. Reset uses each student's allowance
or exam default; Extend time adds exact whole minutes to the committed deadline. Durable
per-attempt IDs/revisions preserve retry safety, pending/offline delivery and partial failures.
Original access holds, locked-state continuation and authenticated terminal connections remain
intact. A verified finish closes unapplied clock intents; retries never report those as applied.
Sandbox still starts with five minutes and preserves its existing repeat/recovery policy.

The native agent no longer uploads archives. Signed completion manifests/status and monitoring
continue; archives remain protected on the SSH server for local examctl retrieval. Legacy
archive uploads reject before parsing with 410; web download/delete routes are absent. Immutable
web receipts use receipts/, with backup support and comparison against legacy manifests. Existing
web archives/state were initially preserved for deliberate operator retirement after class-server
checksum verification. The subsequent deployment retired verified web duplicates while preserving
all protected class-server copies; see [the deployment log](browser-ssh-deployment.md). Automatic resume-export is rejected. Removed the
unused tar-stream download dependencies. Production preflight requires server-only-submissions;
additive changes require clock-extend. Coordinate both hosts' deployment after draining attempts.

Validation: **126 application tests passed**, **24 browser-SSH scenarios passed**, type checking
and production build passed, and the full native **Go race suite passed**. New coverage includes
exam isolation/grouped history, current/removed/no-attempt students, stale dashboard/review replies,
transactional future settings without snapshot changes, bulk partial outcomes, request conflicts,
exact live/offline extensions and restart, immutable original holds, finish-vs-clock races,
no archive reception/download/upload, signed receipt recovery and retained protected copies.
Two real browser instances verified reset/extension without losing terminal input. Browser tests
use local SSH/media fixtures, not a new institutional-host isolation qualification. Independent
admin-test clients use distinct fixture IPs to respect the unchanged five-login/minute limit.
The grouped interface was visually inspected; existing screenshots, including the user's modified
login image, were restored exactly after tests. The subsequent coordinated deployment to marco
and csc-sys and live readiness/storage checks are recorded in [the deployment log](browser-ssh-deployment.md).


## Stable session transitions — 2026-10-16

Initial page rendering now waits for the session, student exam details and public
login configuration before showing sign-in or authenticated content. Only a 401
selects anonymous sign-in; service failures retain an explicit retry view. Identity
and exam details commit together. The SSH panel and host messages remain visible
through completion/data loading, with sent credentials cleared and input removed.
Retrying failed exam loading does not repeat successful session completion. A
cancelled connection cannot later replace a newer login; sign-out invalidates the
old login callbacks only after its SSH cleanup request has completed.

Five new browser scenarios gate responses instead of relying on a short sleep and
observe every DOM commit to catch transient forms: administrator restoration at
both URLs; a student session/service failure and retry; anonymous startup with
late login-only configuration; and an SSH handoff with delayed completion, failed
exam loading, in-place retry and sign-out. The two reported regressions reproduced
on the previous frontend. The new SSH scenario uses a separate fixture account so
focus-lock history cannot change its expected destination.

Validation: **126 application tests**, **29 browser SSH tests**, and **five legacy
transport transition tests** passed; type checking and production build passed.
The full browser suite also verifies retained terminal input, sign-out, webcam,
preflight retries, fullscreen errors, MFA, finish, live clock actions and focus
policy. Existing screenshots and the user's modified login image were preserved.
The deployed bundle passed delayed-session and delayed-handoff browser checks with
local response fixtures and no real credentials/MFA/exam. Both transitional views
were visually inspected. Deployment/readiness/backups are recorded in
[the deployment log](browser-ssh-deployment.md).


## Workspace transitions — 2026-10-16

Audited logout, opening preflight, paused page restoration/continuation and Finish.
The source page or confirmation now stays visible through pending requests and
repeated actions are blocked. Instructor logout goes directly to instructor sign-in
in place. A locked workspace is covered from its first render, including before its
WebSocket bind acknowledgment. A fresh connection is labelled Connecting.

Collection stays visible through Finish acknowledgment, early secured callbacks and
sign-out, without an active-workspace or secured-receipt interlude. Unconfirmed finish
and failed logout are retryable in place; failed collection shows recovery, never
success. After confirmed Finish, late active snapshots cannot re-arm monitoring.
Status replies started before begin/continue/finish are ignored afterward; lower
clock/generation data and older snapshots cannot undo acknowledged transitions.
Fresh authoritative locks/timing changes still apply. Replaced or unmounted workspace
sockets cannot alter the new view. The first terminal is opened after the retained
start confirmation closes, preserving its floating window, focus and input behavior.

Six added browser scenarios hold requests and observe DOM commits across normal,
failed, retry and reordered responses. They cover administrator logout at the home
URL; delayed preflight/bind; pending preflight sign-out including Escape; immediate
pause coverage, failed continuation and late locked replies; delayed finish/secured
callbacks/logout retry; and unconfirmed finish followed by collection failure.
A heartbeat assertion verifies no false monitoring incident after Finish. Three
reported transitions failed with the previous frontend and pass with the fix.

Validation passed: **126 application tests**, **35 browser SSH scenarios**, **six
legacy transition scenarios**, type checking and production build. All **six checks
against the deployed bundle** passed using browser-local API/WebSocket fixtures;
these did not create real sessions, SSH logins, MFA requests, recordings or exams.
The existing suite still covers real fixture SSH, terminal input/first-window
behavior, pause/reauthentication, clock controls, fullscreen and focus policy.
Existing screenshots and the user's modified login image were preserved. Deployment
and recovery details are in [the deployment log](browser-ssh-deployment.md).


## Network loss and active reload — 2026-10-16

Terminal input now depends on acknowledged workspace and browser SSH control
connections, online state, healthy contact within the original recovery grace, and
the existing monitored/authorized attempt state. A socket opening or HTTP poll cannot
uncover the workspace. Offline/close events synchronously block dispatch and discard
queued and early-pane input. A fresh binding nonce ties the acknowledgment to the
current socket. Expired grace, local locks and a newer interruption during pending
Begin/Continue cannot be undone by a late ACTIVE response. Monotonic elapsed time
prevents wall-clock changes from extending recovery; closing SSH clears the old
recovery timer for a subsequent fresh login.

Reload recovery is explicit and server-side, independent of pagehide delivery. The
loading/retry view remains until the owned active attempt is locked, its old page
binding revoked and SSH disconnected. Original start/deadline remain unchanged.
Already locked retries preserve an existing instructor grant. A complete fixture SSH
exercise proves one approval, fresh shared-password/MFA authentication and continuation
restore the same attempt and working terminal. Sandbox keeps automatic approval.
Finished/finalizing/failed-collection attempts never reopen through this route.

New coverage includes both socket and offline-event recovery with input while the
replacement socket is open but unbound, wrong binding acknowledgments, grace expiry,
silent open sockets, late ACTIVE events, recovery-service errors/retries, active reload
without a beacon, and a second interruption during a delayed continuation. A real
browser SSH control-channel test retains the SSH worker but holds its bind response,
checks input remains blocked, then verifies fresh input works with no discarded input
replay. Unit tests independently verify early-pane and queued worker-input invalidation
and expired control acknowledgments. API tests cover CSRF/ownership, concurrent reload,
page revocation, original timing, grant-preserving retries and final-state protection.

Validation passed **130 application tests**, **43 browser SSH scenarios**, type
checking and the production build. Screen tests inspect DOM commits through held,
failed and reordered responses, rather than relying on a final screenshot. Existing
screenshots, including the user's modified login image, were preserved. See the
[deployment log](browser-ssh-deployment.md) for the web-only rollout and rollback.

All **12 targeted legacy transport scenarios** and **12 deployed-bundle scenarios**
also passed. Deployed checks used browser-local API/WebSocket fixtures and created no
real student sessions, SSH/MFA requests, recordings or exams. Public and local readiness
confirmed the healthy production instance with notifications enabled and maintenance
disabled. Persistent-row/configuration fingerprints matched across deployment; the
class-server agent and administrator access policy were unchanged.


## Private temporary directories — 2026-10-16

Added root-controlled per-attempt backing for `/tmp` and `/var/tmp`, shared across
panes but distinct for practice and the timed exam. Both launch modes bind the private
pair and set `TMPDIR=/tmp`. Sticky `1777` leaves are explicitly chmodded after creation
under the private agent umask; `0700` parents and no-follow directory checks prevent
student replacement of mount sources. Temporary files survive pane closure and agent
restart, stay outside the collected work tree and are removed only after confirmed
termination and secured collection, or confirmed preflight cancellation. Failed
termination preserves the data; cleanup retries cannot replace the protected archive.
Readiness/verifier checks require real rootfs mount directories; configured exam work
cannot overlap temporary mounts.

The native Go race suite passed (**141 test/subtest pass events** locally, with root-only
checks run separately); `go vet` passed. New tests cover shared/restarted backing,
attempt/practice separation, source links and permissions, path traversal, link-safe
cleanup, cancellation/reconciliation, protected-copy preservation after failed
termination, mount arguments, rootfs destinations and work-path collisions. Actual
local bubblewrap checks passed. All **13 focused root checks on csc-sys** passed,
including writes by UID 10001 without capabilities and real systemd host-launch
services as nobody. The fixtures used disposable directories, no account creation,
no real attempt, no student SSH/MFA and no changes to ordinary administrator access.

Native source `c6522a1` was installed through the drained SHA-verified upgrade path.
All 15 existing protected archives were verified before and after. Attempt/timing,
configuration/key/policy and administrator-identity fingerprints matched. All four
native/relay services stayed active after upgrade; native and public production
readiness passed. No frontend code or web image changed. Installation syntax and
Markdown links passed checks; the user's modified screenshot was preserved. Backup
and rollback details are in [the deployment log](browser-ssh-deployment.md).


## Practice terminal welcome — 2026-10-16

Preflight's unset server-side deadline now produces “Practice terminal. The exam
clock has not started.” instead of the timed-exam collection banner and
`Deadline: 0`. The admission reply uses an integer deadline, preserving its exact
value for timed exam messages. This changes terminal text only; starting the exam,
collection timing and the SSH admission protocol are unchanged.

Focused regressions check the absence of a deadline/collection claim during
practice and the presence of the deadline and automatic-collection notice during
a timed exam. The complete native Go race suite and `go vet` passed.

The welcome-only binary was installed on csc-sys without restarting services or
cancelling the open sandbox preflight. All 15 protected archives were checked
against their manifests and remained unchanged. Attempt state/deadlines, trust
configuration and administrator policy were preserved. Native and public
production readiness passed; see [the deployment log](browser-ssh-deployment.md).


## Combined enrollment dialog — 2026-10-17

The exam's Add student action now opens one dialog offering One student or CSV file.
CSV selection automatically validates the uploaded file and shows a preview before
confirmation; an authenticated example CSV download replaces the old combined
roster/template link. Removed the standalone import panel, paste editor, username-list
selector and unused paste-area styles. Display names are absent from the dashboard,
student/admin enrollment responses, previews, imports and exports. The supported CSV
columns are username, require_webcam and duration_minutes.

This is a non-destructive application change: schema 8, existing enrollment rows and
pending previews remain intact. The unused legacy database column is retained for
compatibility/rollback; application queries exclude it and new writes never set it.
An old preview whose stored enrollment snapshot includes that field must be validated
again, using the existing stale-preview check. No attempt settings, clocks or protected
submissions are changed by the interface update.

Validation: all **132 application tests**, type checking and production build passed.
Four focused browser scenarios passed: single add/remove and CSV confirmation, exam
scoping/grouped history, administrator creation, and the new combined-dialog flow.
The latter checks example download contents, no CSV textarea, automatic preview,
repeat selection, rejection of removed columns and oversized files, invalid-file
replacement clearing a previous valid preview, confirmed duration/webcam settings,
clean reopening and Escape with focus return. API coverage verifies role protection
and no legacy-name exposure while preserving stored records. CSV tests retain BOM,
quoted CRLF, 10,000-row streaming, inheritance, duplicate rejection, safe export and
round-trip settings coverage. Existing screenshots, including the user's modified
login image, were preserved; the new dialog screenshot is in Playwright's test output.

Deployed source `969fd87` on marco. All persistent administrator/exam/enrollment/
attempt/preview/continuation and configuration fingerprints matched across cutover,
with schema 8 unchanged. Public readiness passes with maintenance disabled. Chromium
also checked the deployed assets using browser-local API fixtures, with no real
mutations and no page errors. The actual example endpoint requires administrator
authentication. See [deployment and rollback details](browser-ssh-deployment.md).
