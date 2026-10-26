# Begin status arriving before its reply

October25 local / October26 UTC,2026. Local candidate on92c75f5; not deployed.

## Defect and public workflow

Actual16-student qualification90359 failed at the fourth Begin: the web recorded
`Activation acknowledgment lost` and generation1 while the original activation
request was still awaiting its reply. The native status sender's prompt delivery
made this previously possible ordering visible. Large collection had not begun.
Source tracing and a deterministic student HTTP Begin → signed native event → SSH
activation reply regression reproduce the false pause on the old gateway. The
test delivers TWO signed ACTIVE callbacks before the original reply; no timeout
or clock change is needed. The old code also hides a subsequent real policy cause
behind its invented lost-acknowledgement reason. RED17208:2fail/1control pass,
15.37s; /tmp/ssh-exam-begin-callback-before-ack-red.log.

## Correction and state review before broad qualification

The existing student Begin route marks only its actual native activation dispatch
in flight. While that same local request is unresolved, ACTIVE/ACTIVATING status
does not establish that its reply was lost. Grant/identity/access checks still
run. The verified command reply commits the original interval and ACTIVE state;
callbacks do not grant input or independently publish a successful Begin. No new
durable state, credential, protocol, timeout, clock or admission permission exists.

The marker is process memory, bounded by existing attempt-busy/admission and
command lifetimes. It is removed before failed-request reconciliation and in
finally. Failure therefore still discovers and preserves a committed native start
as LOCKED at its original interval; retry cannot consume another allowance.
Restart forgets the marker, so reconciliation retains that same conservative
lost-reply rule. Genuine LOCKED, deadline/finalization and protected-completion
callbacks are never suppressed; a stale ACTIVE reply cannot overwrite them because
the existing commit requires PREPARING. Cancellation/retirement still require
their existing positive no-start proofs. No pending marker survives restart or
reserves an account independently of existing native attempt enforcement.

Focused58470 PASS3/15.81s through real local student SSH/HTTP and signed callbacks:
two early callbacks + successful reply remain ACTIVE/gen0/full original interval;
injected lost reply is positively reached, reconciles LOCKED and remains one
consumed grant after retry; genuine policy callback preserves its own reason and
generation. Types20782 PASS. Log begin-callback-before-ack-focus.log in /tmp.
Full build92953 PASS; initial88907 sandbox EPERM spawning installed Go is retained,
not a missing-tool error. Full app21529 PASS612/109files313.68s (2skipped).
Actual16/64 large36741 PASS8.7m/8.8m overall: all16 Begin/protected completion,
generation0/original90min/HELD; targeted collector crash/retry and byte-exact
exports pass, no bridge refusals. Rootg2x674kv independently preserved/inactive,
X7ZFRQ key absent. Exact output /tmp/ssh-exam-watchdog-begin-large-pass.updqg7ta.
Exact587-file current source manifest remains unchanged:
/tmp/ssh-exam-watchdog-begin-source-manifest.json, SHA256d93d2cb151bd5244de162433da5e9be845fbe28d89efd63a76afa8b1a6bd3fb0.
Native binaries/driver have not changed, so completed native race/root receipts
in watchdog-monitoring-evidence.md remain applicable separately.

## Operator guidance

An ACTIVE status arriving during the current Begin is normal ordering, not proof
of a lost reply. After an actual activation failure, inspect the existing attempt
and native `examctl info ATTEMPT`; preserve its UUID, consumed grant and original
interval. Do not delete the attempt, repeat native activation manually or grant
fresh time to hide an uncertain response. Recovery requires the existing supported
review workflow. This local fix changes no installed recovery procedure.
