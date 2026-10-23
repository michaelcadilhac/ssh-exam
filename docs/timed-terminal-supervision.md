# Timed terminal ownership (C12b, tested locally; not deployed)

Local development, October 23, 2026. Integrated workflow and final corrected
source pass local qualification. Not deployed.
Retained-lockout/freeze/recovery mode remains disabled.

## Bounded workflow

Entry is the actual timed Engine.local Unix/SCM_RIGHTS/PTY pane, with existing
student open/close and native pane inspection/closure. Use the approved ONE
supervisor per user/attempt. Move trusted output recording into that process
without copying the global Engine, signing configuration, passwords or keys.
Preserve original intervals, current monitoring/containment and storage/privacy
limits. Independent C12b does not require settling C16's later live-arbiter
placement; it must not enable R2/C3/C9 behavior.

The new actual-entry regression is RED0.166s: two functioning timed panes still
have no independent recorded supervisor. The first regression proves
the ownership gap; it does not yet prove survival or final recording correctness.

The actual candidate now hands new timed BrowserSSH attempts to the independent
owner. Existing attempts lacking the native saved mode retain the legacy path;
there is no automatic mid-attempt migration. Trusted administrator host services
keep their serialized exception. The supervisor has eight fixed-role descriptors
(five existing terminal/lifetime descriptors plus private recording directory,
shared quota inode and private report directory). No global Engine/map/keys enter
it. Fresh Begin records the lifetime mode, without altering saved grant settings.

Focused actual gate tests pass for two panes/one owner, whole coordinator-cgroup
SIGKILL with the global state replaced by a FIFO, unchanged shell memory, durable
output/close, restarted Tick acknowledgement and original clocks/holds. The
compiled namespace-root reports CLI reads through the FIFO. Six real recording
fault races preserve retired generation/transport/pane authority and enforce
current/extended-current loss. Physical owner death contains an actual
HUP-ignoring writer. Transport EOF and deliberate display backpressure pass.

The initial backpressure test failed8.36s: capture waited on forwarding, which
blocked the shell before exit. Delivery now reads only the synced log prefix in
its own bounded64KiB loop; capture remains independent, subject to the unchanged
per-attempt recording quota. After verified scope exit, display delivery gets
two seconds; an undelivered suffix stays recorded and delivery_complete=false,
without a policy violation. All4096 burst rows plus the final marker survive.
The first CLI reconcile fixture incorrectly omitted BOOTTIME deadlines, making
its supposedly live attempt due and requiring an unavailable timing endpoint.
Correct the fixture's complete interval; do not disable timing verification.

## Durable-state review before first broad qualification

| State | Inspection, cancellation, restart and stale outcome |
| --- | --- |
| Reserved closed pane | Exact incarnation, original wall/BOOTTIME expiry, no exec from disk. At most16 unacknowledged timed proofs/attempt; same pane cannot overlap an unfinished recorder. Existing reviewed close/expiry revokes its gate and confirms scoped cleanup. |
| Owner bound before descriptor transfer | Persist verified boot/PID/start/owner epoch while the gate is CLOSED. Lost ready/setup cannot create unowned reports or reconstruct permission. Final release still rechecks the exact updated proof, live process, SSH/account and current authority. |
| Recording initialized | Private pinned scope/storage, original shared2GiB default quota, no raw-key recording. At most16 queued report/stage files; unsafe/full queue refuses before recorder/exec. It never deletes evidence for capacity. |
| Running | Sync output before making it deliverable; capture and backpressured display have independent loops. Actual transport EOF or workload exit causes exact-scope cleanup. Timeout/unknown notice does not prove lost ownership, no start or misconduct. |
| Fault pending | Stop input/contain only this exact old scope before publishing; canonical current generation/transport/start/account/registration/tracked incarnation decides enforcement. A stale fault audits without locking a replacement. Clock extensions do not excuse current recording loss. Cleanup uncertainty is pending status, never positive recording loss or a policy fault; retain tracking and retry actual scoped confirmation. |
| Producer final report | Publish atomic private bounded typed snapshot only after verified whole-scope cleanup and output/resize/input/delivery join. Recording, cleanup and delivery completion are separate. No report grants work permission or new time. |
| Owner physically exited | Kernel pidfd exit, or restart boot/PID/start mismatch, required; missing report/reply never suffices. A valid final report wins over later idle exit. If publication was lost, recover only an exact durable final log marker after producer death; otherwise preserve actual infrastructure failure/containment, not a student accusation. |
| Canonical acknowledgement | Reports read outside global state; exact proof/context/owner/version rechecked under state. A separate nonblocking attempt report claim serializes coordinator/watchdog consumers and owner-exit repair. Existing scope lifetime claim remains independent. Cleanup-unconfirmed transitions retain tracking and accept a later positive completion revision. |
| Final acknowledgement durable, file still present | Keep proof through report unlink and directory sync. Restart retries the exact acknowledged digest; never infer success from a missing canonical row. |
| File removed, proof still present | Only a previously durable final acknowledgement permits retiring its proof/unit after directory sync. Otherwise absence remains UNKNOWN. Concurrent close retains unacknowledged recording proof even after revoking/removing the execution unit. |
| Unsafe/mismatched/orphan/stage evidence | Read-only reports CLI exposes bounded partial status; reconciliation refuses contradictory contexts/revisions and never clears files to bypass capacity. Preserve/repair matching metadata/storage, retain original holds/deadlines. No force/drop workflow. A pending receipt is not an account permission/reservation or deadline extension. |

Twenty-two actual Tick/file cases cover missing live receipts, FIFO/symlink,
foreign owner/context and revision rollback, both final-ack crash boundaries,
cancelled closed startup, positive completed owner exit, lost publication with
verified final log, actual retired-owner loss, concurrent consumers and restart
after initially unconfirmed cleanup. Three final focused race repeats pass
core29.054s/CLI4.760s after the busy/cleanup-uncertainty follow-ups, including
the actual compiled root reconcile entry. This includes bounded expiry of a
positively cleaned CLOSED/unbound setup and refusal of a corrupted claim path
without creating a file outside its private directory. No recorder descriptors
can transfer before the verified owner is durable; ready exec has a later,
separate durable transaction. Orphan recording/report files are not deleted or
called complete by expiring an unattached bootstrap.

The final mutation-site audit reproduced two reviewed-close gaps (RED0.044s):
benign receipt acknowledgement changed the pane revision, and manual close after
durable final acknowledgement could erase its proof before report unlink. The
scope fingerprint now omits only receipt diagnostics; immutable owner/context/
incarnation and clock/source authority remain fenced. Every ordinary close/reap
retains bound recording proof, including acknowledged final proof. Only the
canonical consumer retires it after acknowledgement, report unlink and directory
sync. Legacy coordinator recording returns before these supervised mutations;
the other state writers drop units without dropping receipt proof. This completes
the scoped mutation-site review; no further runtime expansion belongs here.
Scope termination is replaced
only in this canonical-state matrix; the separate gate tests use real owned
user cgroups/PTYs. Regular kernel storage I/O may remain pending; the supervisor
is independently resource bounded, reads occur outside canonical state and no
timeout is converted to completion. This does not qualify the later live-memory
monitoring arbiter or uninterrupted work through arbitrary storage/network loss.

The first broad run failed one transport-EOF fixture (core377.133s; CLI26.229s
passed): an overlapping canonical consumer legitimately held the receipt claim.
The fixture incorrectly required an immediate successful reconcile. Busy is now
a distinct actionable refusal; compiled root CLI tests hold the actual claim and
verify evidence survives refusal, then release it and require acknowledgement.
The gate test retries ONLY that explicit busy disposition within two seconds and
still requires unchanged authority/complete canonical acknowledgement. Unsafe
reports remain failures. Review also corrected a final-delivery race: recheck the
synced prefix after output-exit notification before claiming nothing remains.
The real synthetic shell emits a final marker which must reach its outer PTY.
Final native qualification must use this corrected source; the earlier run is
retained as a failure and cannot qualify the changed artifact.

The next focused repetition exposed an intermittent peer recording/cleanup error;
15 diagnostic I/O repetitions pass51.075s without reproducing it, so its original
stage is not established. Source review independently confirmed a false-fault
path: temporary cleanup refusal was made sticky even after successful retry.
The actual gate now forces one initially unconfirmed scoped cleanup: RED1.362s,
then three corrected repetitions PASS5.237s with complete logs, healthy peer,
unchanged ACTIVE state/clocks/holds. Initial cleanup uncertainty stays pending;
only positive recording I/O failure or physical owner loss can supply that negative
evidence. Fixed bounded fault_stage diagnostics expose no terminal/credential
data through the root report CLI and audit; student replies keep a plain
infrastructure-error message. The original unexplained
intermittent receipt remains a retained failure, not silently relabelled a fixture.

Affected signed callback/authenticated SSH/recording-retention/liveness interfaces
pass56 tests in7files20.09s. Seventeen actual Chromium/WASM SSH liveness/cleanup/
clipboard/workspace checks pass1.3m. Client/application sources and artifacts are unchanged and
their prior exact hashes still match, including client.wasm; no unrelated app or
browser suite is repeated for private native corrections. The preceding full native
race/resource/namespace/compiler/default-size qualification of the c8d3e2 snapshot passes core388.721s/
CLI25.962s. Static native build/vet and diff/source-hash checks pass. Frozen native
source-manifest SHA256 is c8d3e2cd82528d1b1bf97e375a8d77eec2ec497954b444f9376280f969947259
(/tmp/ssh-exam-timed-supervision-qualified-source.sha256); it matches after tests.
Logs: /tmp/ssh-exam-timed-supervision-qualified-{native,build,vet}.log. That
run includes the reviewed-close corrections; the earlier396.651s/26.961s pass
predates them and is not their qualification. Original dirty screenshot
is preserved with its original SHA256. No remote access or installed-role test.

The subsequent admission review forces the actual owner-ready/final-release
boundary. An initial benign report ACK invalidated the parent's CLOSED proof;
recording failure could wait behind the startup-notice read before containment.
Both cases are RED2.417s. Defer a benign initial ACK while the original closed
startup is live/unexpired; cancellation/expiry and final reports still reconcile.
Contain genuine recorder failure in its IO worker without waiting for that notice,
using only the exact verified scope and existing bounded cleanup. Three corrected
repetitions pass3.327s, preserving ACTIVE state/clocks/holds on pre-exec refusal.
Final corrected qualification now passes: three affected-workflow/native-pane/
compiled CLI repeats core31.621s/CLI3.076s, then complete native race/resource/
namespace/compiler/default-size core395.786s/CLI26.150s, static build/vet and
source/diff checks. Frozen source-manifest SHA256:
f21765cb6559bec851ca00f0beee1ae6e17ea93fca8e3ba135fa24b82bfcedac
(/tmp/ssh-exam-timed-supervision-admission-qualified-source.sha256), verified
after completion. Final logs use /tmp/ssh-exam-timed-supervision-admission-qualified-
{native,build,vet}.log. The earlier c8d3e2 manifest/pass is explicitly not the
corrected artifact. No qualification runner remains active. The process cause
and concrete preventive review are in development-retrospective.md and AGENTS.md.

## Operator workflow

Use examctl panes list/show and the existing reviewed exact panes close.
examctl panes reports ATTEMPT [--state DIR] reads bounded producer snapshots and
optional captured canonical pending proofs without initialization, keys, locks,
repair or subprocesses. canonical_available=false truthfully identifies unavailable
global state; producer reports remain inspectable. These are separate observations,
not an atomic view or current monitoring/exec authority. After storage repair,
examctl reconcile --config FILE applies the exact receipts, then durably retires
them. Unsafe/busy reconciliation is an actionable failure, not ok=true. Preserve
unknown files/old reviewed intent; do not delete them, restart agents or reset
clocks to force another pane. No new web destructive action is introduced.

## Necessary integrated changes

1. Extend the authenticated closed handoff for timed recording, using scoped
   pinned recording storage/budget and immutable native pane/authority identity.
   Practice keeps its existing minimal protocol. Recorder initialization must
   complete before releasing student exec; failed/late setup cannot release it.
2. Provide cancellable bounded PTY I/O within the owner. Preserve output-before-
   forwarding and no raw-key capture, shared per-attempt quota and resize/close
   recording. Normal EOF, transport loss and explicit close need an observed
   completion boundary; do not merely join the legacy blocking input goroutine.
3. Produce bounded incarnation/generation-bound fault/exit reports and reconcile
   them with canonical metadata after coordinator loss. A report is negative or
   completion evidence, never execution permission. Current faults retain the
   existing recording-failure containment; stale ones cannot lock a replacement.
   Positive completed cleanup/recording is required before retiring its tracking.
   Publish/acknowledgement/restart/expiry failures must stay inspectable and retryable.
4. Extend existing pane CLI inspection/close with truthful report status and a
   supported reconciliation path. Missing/unsafe reports are unknown, not success
   or student misconduct. A bounded full queue refuses another handoff rather
   than dropping a fault. Preserve all history, clocks and account holds.

These pieces belong to ONE integrated timed-pane milestone. Do not commit another
unwired journal/helper chain or spend broad suites on components without their
actual runtime caller. If their safety dependencies expand beyond this boundary,
reassess and report the concrete missing integration before adding more code.

## Required acceptance

Real local gate/PTY entry must show normal timed recording and its native pane
owner, two panes sharing one independent scope, coordinator whole-cgroup death,
unchanged shell memory/recorded output within existing execution authority, and
canonical restart/report acknowledgement. Test genuine current faults and stale
generation/transport/pane/clock-extension controls, source/report corruption,
close/EOF/backpressure, quota/disk/blocked-I/O failures and unrelated healthy peers.
Exercise supported compiled pane CLI inspection/reconciliation/closure. No timeout
alone may manufacture a fault, cleanup proof, new allowance or work permission.

Before broad qualification review every planned/attached/ready/report/ack state
for cancellation, crash/restart, expiry, stale completion, admission bypass and
indefinite reservation. Then run affected native races/build/CLI, appropriate app
and browser checks; privileged installed-role qualification remains separate and
requires a positively safe disposable host. No earlier remote bundle qualifies
new code. Preserve the original dirty screenshot and all production state.
