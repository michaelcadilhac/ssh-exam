# Current checkpoint — explicit pause choices complete locally

November23: the instructor attempt More menu now offers Pause until reconnect
and Pause indefinitely for a stopped student's running countdown, without a
checkbox dialog. Reuses the existing resume-on-work authorization; the countdown
restarts only after successful exam resumption, never login/setup/approval alone.
Working students retain direct pause. No native/backend/schema change.
Pending clock confirmations refresh promptly for at most15seconds, then return
to normal polling, including after failed HTTP replies. Native confirmation and
stale-data/input/clock safeguards remain authoritative.

Validated local increment:24affected HTTP/clock/automatic-resume/signed-dispatch
cases,14built-asset instructor browser workflows, typecheck and production build
pass. Original virtual-clock fixture failure is retained; its final test measures
real elapsed time. Mobile menu visually inspected; test images remain private.
No new native race, full-app, class-capacity or release-installation pass claimed.
[Scope and evidence](countdown-pause-choices.md).
Private receipts/source manifests: `var/countdown-pause-choices/20261123/`.
The local commit containing this checkpoint is the completed milestone; NOT pushed
or deployed. No open design decision. Production clocks/services were not modified
by this UI work. A separate fresh inspection found the student already ACTIVE
with his countdown running; no pause-mode correction was performed.

Last deployed runtime/controller remains df3c434, November22 on csc-sys, with
38external assets/41authority contracts verified, native PIDs/binaries unchanged
and88.325s guarded cutover. [Deployment/recovery](interruption-grace-release.md).
The fifteen-second interruption grace is deployed. Larger35/70capacity remains
unqualified. Recovery preserves CURRENT data and the original snapshot, using
same-candidate forward recovery; the old policy writer cannot reopen.

Next action only on a new instruction: qualify the exact new web release and its
installation/preservation/recovery path before push/deploy. No production change
is authorized by this checkpoint. Preserve submissions, history, deadlines, holds
and ten pre-existing modified documentation PNGs, which remain unstaged.
