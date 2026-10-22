# Per-attempt terminal recording isolation (tested locally; not deployed)

Actual timed Engine.local → Unix/PTY → root recorder shared Engine.monitorMu
across every attempt. A waiter on one attempt's external quota flock held that
global mutex, stalling a different attempt's output in the SAME coordinator.
The actual two-terminal regression is RED1.937s. Its earlier missing-home setup
failure is retained separately and is not defect evidence.

## Integrated change and state review

The existing timed bridge now constructs a recorder from only private storage,
validated byte budget and exact attempt/pane IDs; no Engine/global attempt map,
keys or credentials are retained in the recorder. Its per-recorder mutex and
cross-process per-attempt flock still serialize complete quota-check/append/sync
transactions. Remove only the unrelated global recording mutex.

Waiting for that attempt flock uses nonblocking probes and Go timers, not one
blocked OS thread per waiting pane. After acquiring it, admit at most16 concurrent
quota-scan/append/sync operations per native process. One blocked attempt cannot
consume those16 slots: siblings wait for its attempt flock before admission.
This bounds this data-plane IO concurrency, not all filesystem calls, aggregate
class capacity, disk scheduling or OS-level recording-fault isolation. Full timed
C12 lifetime/event/IO integration remains necessary and is not enabled here.
This fixes already-open recording streams; it does not claim cancellation of
every legacy startup filesystem operation or remove the separate closed-launch
serialization/resource rules. Uninterruptible storage/transport IO remains an
explicit full timed-owner qualification boundary, not concealed by this fix.

No durable/intermediate state, account reservation, grant, positive execution
permit, new management mutation or timeout-based violation is added. The existing
recording budget, no-output-before-durable-record rule, raw-key privacy and
current/retired-fault handling remain. Waiting never owns canonical attempt state;
deadlines, signed close, independent watchdogs and existing account holds remain
authoritative. A saturated/stalled filesystem is not evidence of misconduct or
permission to extend a lease. No automatic reopening, refund or protected-file
cleanup occurs. A process crash cannot restore permission from a recorder.

Operator interfaces are unchanged: inspect original interval/reason with `examctl
info ATTEMPT --read-only`, captured pane identities with `panes list/show`, and
use only the existing reviewed exact close/continuation procedures if necessary.
Do not restart a shared agent or remove its quota lock to make progress.16 is an
internal per-process IO bound, not an advertised supported class size or live
monitoring proof; no new operator configuration/CLI write is introduced.

## Actual-interface regression and limitations

Two separately scoped synthetic attempts use the same unprivileged Unix UID,
admitted from a deliberately constructed scheduler fixture, with one real local
coordinator/Engine, real inherited Unix/SCM_RIGHTS/PTYs and actual user scopes.
This does NOT qualify real multi-UID admission or authorize concurrent exams for
one account. Root SSH/PAM ancestry/manager namespace/final shell remain replaced.

After both real shells run, the test holds only the first attempt's real private
flock and positively observes its recorder entering that wait. The second pane
must retain the exact same memory/process response while the first remains
blocked; blocked output must not bypass recording. Upon release, the first shell
must retain its exact memory/process too. Both original/current intervals and
holds survive; trusted logs still contain output. Separate signed state controls
use another Engine against the same state; they are not claimed as actual SSH
command-channel qualification in that coordinator.

The child tightens the IO bound to ONE slot through test-only code. A flock
waiter must consume none, so taking admission before the flock fails the actual
healthy-terminal oracle. Installed code has no configuration/environment option
to select test roles/hooks or relax identity/containment.

The actual slot-order mutant takes admission before the held attempt flock;
the healthy-terminal oracle becomes RED2.940s. The mutant is restored. A separate
real-file/flock test saturates all16 production slots, positively observes its
writer owning the attempt lock without appending, returns one slot and verifies
actual append/sync plus returned capacity. It does not pretend a mocked pause is
an actual kernel fsync hang or a measurement of OS thread limits.

Three final focused native race repeats pass25.190s, covering both actual timed
recording streams, the16-slot bound, quota/default/restart/cross-process races,
stale/current recording faults and practice owner death/isolation. Full native
race/resource/namespace/compiler/default-size qualification passes
core295.622s/CLI25.171s; static build/vet and diff checks pass. All runners finish.
No application/
browser/WASM source or artifact changed; c69d35b's35 callback/SSH checks and the
preceding435-app/22-browser/build evidence cover those unchanged surfaces, not
this new native runtime. No redundant web rebuild/browser run is started.

Receipts: /tmp/ssh-exam-recording-isolation-{setup-failure,red,slot-order-mutant,
final-acceptance,native}.log. Earlier broad native receipts do not qualify this
new runtime. The pinned raw host guard is BUSY at23:30UTC October22; no new
privileged qualification is attempted.
No upload, service installation/restart, deployment or consolidation is performed.
