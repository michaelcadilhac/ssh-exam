# Browser terminal cleanup crash and recovery feedback

Revision **d36b538** was deployed on 2026-10-19 at 04:50:06 UTC
(October 18, 23:50 Chicago time).

## Incident and fix

The mcadilha sandbox started at 04:42:09 UTC. Its first pause was a normal fullscreen
exit at 04:42:27. During transport shutdown, the backend rejected existing requests,
then called asynchronous per-pane close methods. Those methods created new browser
close requests after the pending-request map had been cleared. Their promises were
not awaited. An orphaned request timed out 120 seconds later, terminating Node;
Docker restarted it at 04:44:27. The attempt had resumed shortly before that crash,
so startup recovery paused it again. A retained successful-continuation message
incorrectly appeared alongside the newer pause reason. No deliberate deployment
restart occurred during that attempt.

Whole-connection shutdown now sends the browser close notification, rejects pending
operations, clears their timers and disposes pane state synchronously without issuing
new browser requests. Requests are rejected once shutdown begins. Individual pane
closure remains awaited and disposes local state even when remote closure fails;
repeated disposal emits close only once. Timeout errors name the operation without
including request arguments, terminal contents or credentials.

The UI clears recovery feedback for new incidents, new server pause generations and
authentication gaps. A restore operation cannot publish stale success after the
activation epoch changes; successful continuation does not retain an unnecessary
“Exam resumed” message. Startup recovery now explains that the exam webserver
restarted and asks for SSH reconnection, without inaccurately describing SSH objects
as residing in the gateway. All monitoring, authorization, deadline and access-hold
rules remain in effect.

The original sandbox completed through deadline collection at its unchanged five-minute
deadline. Production metadata confirms COMPLETED and a verified protected submission.
No attempt was reset, extended or deleted. Native class-server software/global Emacs
configuration required no changes or restarts for this fix.

## Validation

- Production build and typecheck passed; **221 unit/integration tests passed**.
- New server regressions use real BrowserPane objects, pending requests and fake
  timers advanced beyond the original 120-second crash window. They cover shutdown
  with open panes, pending-operation rejection, no leftover requests/timers,
  individual close failure and connection loss during an awaited pane close.
- **12 local browser checks passed**, covering socket/offline loss, missed and
  delayed monitoring acknowledgments, active reload, authorization races, new pause
  feedback/input blocking, and Emacs/internal clipboard regression checks.
- **Four checks against the deployed frontend passed**, using intercepted fixtures
  without changing production students: new pause after successful continuation,
  actual Emacs OSC output and cross-pane paste, large paste/query handling, and
  covered/locked clipboard blocking.
- Public readiness reports productionReady/notifications true and maintenance false.
  The service is active and its healthy replacement container has zero restarts.
  Public frontend and backend-module checksums match the tested local build.

## Deployment and rollback

Marco's existing checkout/Compose/systemd workflow was used. No preparing, activating,
active, locked or unresolved collection attempt was present before shutdown or at the
second check after stopping the service. An offline private data/configuration backup
was taken; automatic previous-image restoration was available on startup failure.
No schema migration, student reset, account change or configuration change occurred.

- Image: `ssh-exam-workspace:browser-cleanup-d36b538`, also tagged as the standard
  `ssh-exam-workspace:1.0.0` default.
- Image SHA-256:
  `937b1310d6c8ea4f2aace9b39b86ff8d80decc8a0869ab5277dc509de14cce1a`.
- Frontend: `/assets/index-UqixZm-O.js`, SHA-256
  `b654090d7f99eadc5b95db1e428c5686ec2ed585494848b9d88cb5de657815b9`.
- Browser SSH backend module SHA-256:
  `9eaa55540c88be5c1a0bea1118b8ece01e0d634bc822fe09008daec44a84025b`.
- Backup/receipt: `/var/backups/ssh-exam/20261019T044956Z-browser-cleanup-24mzrinx`.
- Previous image SHA-256:
  `3ea2a00177ea12bdf889b4338eee7502b0901c758df6a94abed102ef64dfbf7d`.

Rollback requires draining attempts before retagging/restarting the previous image;
it reintroduces the cleanup bug. Preserve newer data, monitoring and secured work.
Reload pages for the corrected frontend. Apply the normal monitoring-backup retention
policy to deployment backups.
