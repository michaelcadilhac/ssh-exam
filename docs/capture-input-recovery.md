# Capture recovery and terminal input

October26,2026. Local browser correction; not deployed.

Student entry point: an ACTIVE negotiated-v1 workspace whose challenged capture
temporarily fails and then verifies successfully. The capture failure immediately
revoked BrowserSSH input. Recovery updated React state only. If rendering combined
the failed and healthy updates, the final rendered coverage/connection/attempt
values were unchanged, so the render effect never restored input. The workspace
looked healthy but fresh keys produced no echo indefinitely.

The healthy callback now reevaluates the same live input conditions in addition to
the render effect. It checks aggregate capture health, local policy lock, page
binding, online/control/socket state, acknowledgement age, network/focus conditions,
attempt state and current rendered coverage. It does not grant native execution,
change an interval, reconnect SSH, replay discarded keys or bypass pane epochs.
An already-rendered cover remains until its normal render clears it. There is no
new durable/intermediate state, migration, cancellation or expiry mechanism.

The real-WASM public regression in retained-restart.spec.ts delays only React's
null MessageChannel deliveries while actual capture/network/timers continue. One
screen challenge returns503; the next challenged screen upload returns200 before
rendering resumes. The original private shell text and authenticated connection
must accept a fresh suffix, with the same interval/generation/owner and no new SSH
authentication or terminal opening. The original code fails at that input oracle;
the correction passes14.6s/17.8s including fixture startup. An earlier fixture wait
incorrectly equalled Capture's five-second interval; its timeout is retained and
the wait now explicitly allows that one interval. The first selector matched no
tests and is not counted as verification.

Receipts: /tmp/ssh-exam-input-recovery-red-oracle.log and
/tmp/ssh-exam-input-recovery-green.log. Focus uses the frozen Docker076a5c1 WASM
1bea6f8ef01e81532d5fa8a7064047f93fd2fc729391bad6fe109b51193b3e40 and rebuilt
JavaScript. All20 affected real-WASM/process/transition browser checks pass3.5m;
19 focused unit checks, typecheck and browser build pass. Native code/protocol and
durable state are unchanged; earlier full application/native evidence still
applies to those inputs. New packaged-image/native class requalification passes:
all16 students/64 terminals, actual technical freeze/automatic recovery, fresh
shell input, original intervals/holds and independent protected submissions9.7m/
10.0m including setup. Exact image/133-source manifest and independent exit0/
host-base-authority-preserved/inactive guest receipt are in release-readiness.md.
This proves a client defect, not the initiating cause of the original
student incident or the unresolved earlier16th-login failure.
