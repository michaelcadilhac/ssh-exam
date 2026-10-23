# Retained-workload barrier: implementation and qualification order

October22,2026. C3/C9 retained lockout/recovery and C10 live renewals are approved;
C11 authorizes developing/full qualification of stop-assisted freezing. This is
the next dependency plan, not a completed investigation, freeze implementation or
deployment. Current lockouts still terminate workloads and disconnect SSH.

## Inspected boundaries

- gate.go now hands ordinary PRACTICE sockets/PTYs/lifetime handles to one
  independent bounded supervisor per attempt, before the existing durable closed
  exec release. Actual two-pane shell memory survives whole coordinator-cgroup
  death. The supervisor never reads global metadata; actual Tick retires only
  positively gone ready practice records. Timed panes retain coordinator-owned
  recording: the initial thin-Engine recorder fallback was removed before broad
  qualification because it duplicated global state per student. Timed owner/
  event/restart integration is the next necessary integrated boundary, not a new
  unused helper chain. See terminal-supervision.md for full local evidence and
  state review. Root-role qualification, R2 epochs, C3/C9 remain open. The
  administrator host-service exception remains serialized.
- pane_admission.go already revokes unused tokens and rechecks current authority
  after an ACK; an old ACK cannot relaunch a closed pane. That is not closed
  admission by itself. The local closed bootstrap now supplies that fence for
  ordinary scope launches, not the full durable owner/input-epoch protocol.
- engine.freeze observes recorded cgroups, but missing units are treated as
  frozen/gone. That is insufficient while a root launch could still create one.
  Positive writer verification is separate from pending launch exclusion.
- uid_process.go pins group lifetime and includes zombie leaders with live
  workers. It does not enumerate/prove every thread stopped. proc task-directory
  views can become incomplete after main-thread exit; cgroup.threads must be
  inspected through pinned real kernel cgroup descriptors, with task/group/UID/
  lifetime checks. Do not add a newer thread-pidfd requirement or infer no writers
  from a missing proc view.
- Input framing, pane gate and pinned-PTY drain/discard are tested but unused.
  Their local receipts are not authenticated cross-process registrations or
  whole-attempt freeze/authorization. Root actor seal creation remains absent.
- browser-ssh/client/client.go uses one authenticated class Client for command
  and pane NewSession channels. A command exit/stall is not transport death.
  Initial protected handoff deliberately replaces that Client once and clears
  authentication references; retain that credential cleanup and distinguish
  this verified transition from a new owner or ordinary later reconnect.

## Dependency-ordered increments

| Increment | Acceptance | Required tests |
| --- | --- | --- |
| R1: kernel inventory and stop facts | Bounded pinned cgroup/thread observations include surviving dead-leader workers; unknown is never empty/stopped | Actual synthetic thread groups, exits/reuse, malformed/oversized/foreign views, denied/closed handles; no host UID-wide signals |
| R2: durable owner/epoch and closed launch admission | Exact root SSH peer/current registration plus durable one-use attempt/owner/input incarnation; no pending or new launch can escape a close | Actual root peer/process claims, crash/late reply, manager-start stall, simultaneous close/hold/deadline; no authority reconstructed from disk |
| R3: retained attempt supervisor (C12) | One bounded process owns its attempt's PTYs, decoders and input gates, outliving coordinator/collector failure; explicit role/epoch IPC and independently enforced expiry | Actual process death, EOF, stale/forged peer/frames, backpressure and leak/resource bounds; supported CLI/web inventory/close/status |
| R4: stop/freeze/discard barrier | Close admission, revoke every gate, confirm all drains, preserve original job stops, stop/verify writers, freeze every scope and discard old input before claiming hold | Actual background/deferred IO, foreground job control, Nano/available course editors/debuggers, dead leader, fork/thread/namespace/manager races and injected failures |
| R5: authorized thaw/recovery | Fresh per-pane input epochs/current same-owner complete coverage/unexpired interval; actual policy/auth loss retains its approval rules; C9 only under all prerequisites | Policy vs technical/gaps, old frames/acknowledgements, page/owner/restart and clock/deadline/collection races; no reopening/refund |
| R6: combined qualification | Actual browser/WASM/SSH/native interfaces and operator CLI/web agree; mixed versions refuse unsafe mode | Full application/native race/resource/build/browser and exact-artifact guarded guest matrix; measured class/pane capacity |

C12 approved October22: one bounded supervisor per user/attempt, owning that
attempt's panes. This supersedes the proposed per-pane topology; do not use one
shared terminal supervisor across students. A supervisor failure may affect its
own attempt's panes, never unrelated attempts. Qualify memory/process capacity
with the approved grouping. Never automatically restart workloads or derive
positive permission from disk. No new service/unit is installed by this plan.

The eventual supervisor must live in its own independently bounded control scope,
outside both frozen student workloads and the coordinator service's kill/OOM
domain. Merely forking a child inside a KillMode=control-group agent service does
not survive that service restart. Before student code can run, positively verify
the supervisor's independent scope/peer and closed bootstrap handshake. Pending
scope assignment cannot release work. Keep the SSH entry/control descriptor and
PTY ownership alive without copying keys or retaining password/MFA callbacks.
Use inherited fixed-role descriptors and bounded authenticated local IPC, not
caller-selected file paths, arbitrary root commands or a new inbound network API.
The helper needs only measured necessary privileges; do not silently widen agent
capabilities, weaken NoNewPrivileges or install units to make a fixture pass.

The next integrated C12b boundary is the actual timed Engine.local pane, not
another observer/helper: move its trusted output recorder into the existing
attempt supervisor with only pinned recording storage/budget, never a global
Engine/config/keys. Canonical metadata needs bounded, incarnation/generation-bound
fault/exit reports which survive coordinator loss, with durable acknowledgement,
stale-completion refusal and supported pane CLI inspection/cancellation. A report
is not live monitoring authority or exec permission. Bound pending reports; refuse
new handoffs rather than silently dropping a fault or creating indefinite account
reservations. Preserve every recorded output/quota/privacy rule and original
deadline/hold. Qualify normal EOF, backpressure, abrupt transport/owner death,
recording/storage failure and restart through this real entry before claiming
timed C12 delivered. The separate stale-recorder-fault fix deliberately joins
only already-observed fault decisions; it does not establish a full raw-IO drain
or final-recording/close-ack contract (terminal-recording-faults.md). Do not fold
R2/C3/C9 enablement or unrelated grant work into this bounded lifetime milestone.

Keep actor and pane lifetime claims distinct. Existing provisional publishers
inherit the actor claim so a surviving writer excludes an overlapping owner;
retained pane supervisors must not inherit that same open-file description or
they would prevent replacement of a dead coordinator until their PTYs were
destroyed. Give panes their own persistent incarnation/lifetime claims and a
verified fail-closed owner-handover protocol. A still-running old metadata writer
may delay a safe actor transition; do not unlock/remove its claim to force it.
Retain buffers/SSH while reporting the actual pending transition.

Before any future new-mode Begin, verify actual loaded coordinator, independent
watchdog, gate and supervisor versions/roles, not only new files on disk or one
capability string. A stale old watchdog can read a stale disk lease and destroy
retained workloads even when the new live actor is healthy. Mixed loaded roles
must refuse enablement before time/material release; old root daemons do not
magically honor a new sidecar lock/field they never implemented. Include the
temporary handoff services in the future verified drain/version/consolidation
plan, and never assume arbitrary old root administration is a supported writer
against new-mode state. No service action is executed during local development.

## Barrier and failure rules

An accepted live proof is not a kernel hold receipt. A control timeout is not
misconduct. Keep root supervisors/verified SSH ownership outside frozen workloads;
cover all student writers and any root launch which could still exec student
code. Pending starters need a trusted closed admission/handshake gate, not an
assumption that a missing cgroup can never appear later. Preserve unconfirmed
tracking and refuse unsafe success; never drop it to free a terminal slot.

Record original job stops before sending the barrier's own SIGSTOP. Cover every
thread, not only leader state, and qualify shell notifications/foreground groups,
pending/concurrent job-control signals and trace/debugger stops. Thaw only what
this barrier actually stopped; never blindly SIGCONT the UID or a numeric PID.
Identity loss, a missing live view, unknown asynchronous writers or failed input
discard must not become a verified hold/thaw result. Failure handling must retain
the access hold and preserve work; any destructive containment fallback needs an
explicit operational failure, not a false promise of buffer retention.

Deadline/watchdog and root live authority must coordinate current cutoffs. An old
persisted lease or stale timer cannot override a newer verified live renewal.
At a real deadline, keep timing verification/collection and original/current
account restrictions; no stopped clock, automatic compensation or completed
attempt reopening. A coordinator restart begins unknown and requires the full
fresh verification/barrier/recovery protocol before work resumes.

Every eventual management capability needs supported discoverable examctl and
matching web behavior, including cause/current epoch/owner, pending starters,
registered panes, drain/freeze failures and pending versus confirmed recovery.
Do not expose raw input, credentials or arbitrary root commands in diagnostics.
Keep old protocols unchanged until all prerequisites and combined tests pass.
All rollout/migration/rollback and temporary-agent consolidation remain proposals
in todo-rollout-plan.md; no deployment is authorized.

## October23 integration checkpoint and next usable outcome

The initial inventory above is historical: b850e8d now moves ordinary timed
recording into the same existing independent attempt supervisor, with bounded
durable incarnation-scoped reports and CLI inspection. The registered-owner
candidate additionally binds actual Begin/approved continuation to the signed
page/native transport/boot/generation/clock and fresh authorization identity,
through real closed release, supervisor cohort and pane receipt. It does not pin
the student's root SSH lifetime inside the supervisor or provide a live authority
seal, per-pane packet epochs, verified freeze or recovery. See the two feature
documents; do not count identity metadata as completing R2/R3.

C16 is settled: live monitoring/input authority runs INSIDE this one attempt
supervisor, isolated from recording IO. No extra authority daemon is approved or
needed. The next integration must produce the actual student policy-pause →
verified retained hold → instructor-approved Continue workflow, with the same
SSH transport, shells/editor buffers and original/current deadlines. Inspection
must agree through examctl pause/authorize/info/panes and the web paused page.
Automatic technical-only recovery remains separately gated on complete fresh
same-owner coverage; this increment must not claim it or relax genuine locks.

Before code, inspect the real Engine.local/handoff and root SSH pinning APIs, then
the actual lock/continuation/watchdog/clock/collection writers. Supervisor caller
identity currently pins the coordinator, not the student's root SSH monitor; the
transport hash in registered_owner is not a lifetime proof. Reuse verified kernel
handle APIs at the actual handoff; do not invent a context-seal factory from saved
strings. The current timed input method still forwards unframed bytes. Integrate
per-pane capture-time epochs across browser/IPC/WASM/native decoding and pinned
PTY delivery rather than adding another unused codec. Every new helper needs its
actual runtime caller in this workflow.

Necessary safety dependencies are closed admission/pending bootstrap exclusion,
current live owner and independently enforced expiry, input revocation/drain and
PTY discard, all-UID/all-thread stop-assisted freeze with original stop facts,
scope/peer proof and durable pending/confirmed failure states. No shared native
state lock may wait for a blocked recorder, freeze worker or storage publication;
no missing reply/unit can establish absence, permission or a verified hold.
Recording/collection remain independently bounded. Unsupported mixed loaded roles
must refuse new mode before clock/material release. Keep new mode disabled until
the combined workflow passes; default legacy enforcement remains intact.

Acceptance is observable through the actual CLI/web/student entry: two live panes
and unsaved editor state survive policy pause, all writers stop and stale framed/
kernel input never appears after approved continuation, while another synthetic
attempt keeps healthy SSH/control. Exercise delayed Begin/ACK/manager creation,
old commands/epochs/receipts, coordinator/owner/worker death, originally stopped
jobs/dead leaders/async IO, clock/deadline/collection transitions and failed freeze/
discard without false success. Qualify real privileged SSH/PAM/cgroup behavior in
the guarded disposable guest, with full application/native race/build/browser
checks at that integrated boundary. A busy/uncertain host guard is a remaining
qualification blocker, never permission to bypass it or enable partial retention.

## Pending-recording ownership correction (October23, local)

Inspection reproduced a concrete race through the existing supervisor attach
entry: its first accepted timed handoff could block in recorder initialization
before entering the initialized-stream map. A different page/transport/authorization
epoch or generation, or conversion of a pending legacy cohort, could then replace
its registered owner. The separate final root exec gate still rejected changed
authority; the supervisor metadata itself was not an admission-exclusion proof.

Bounded correction: enlist each accepted timed request under the supervisor mutex
before any storage/recorder IO, and use that complete pending/live cohort for owner
agreement. Retire only that exact request when its handler actually returns.
Allow monotonic clock-only changes for the same owner; reject rollback. Existing
examctl panes supervisor observation remains responsive during blocked IO and
includes pending attached units, without claiming they started or are authorized.
No new management action, capability, retained mode or positive authority is added.

Acceptance: actual local attach/SCM_RIGHTS/PTY/pidfd/executable checks reproduce the
five owner-replacement cases before the fix; all eight owner/clock cases pass
afterward, including positive same-owner clock advance and actual diagnostic IPC
while initialization is blocked. Test-owned cgroup identity replaces root/student
scope ancestry in that focused fixture; qualify current native artifacts separately
through the guarded real-root timed-owner/collector guest profiles. Review and run
focused actual admission/prestart-fault/root CLI checks before full native race/
resource/build qualification. Unchanged web/protocol artifacts retain prior evidence;
this correction does not implement the full pending-launch/freeze barrier.

State review: no new durable state. Pending requests cannot authorize exec, thaw,
change time or reserve an account; canonical closed-start expiry, cancellation,
tracking and deadline rules remain. Failed initialization retires its request only
after returning; blocked IO remains visibly pending, not falsely empty. A stale
request cannot replace the cohort or lower its clock. The supervisor state mutex
never waits for recorder IO. This addresses one confirmed defect discovered in the
critical retained workflow, not a substitute for integrating that workflow.

Qualification evidence for this correction:

- Initial regression RED0.102s and isolated Go-overlay mutation RED0.068s: five
  actual attach owner-replacement cases fail. The final oracle queries the real
  diagnostic IPC while storage initialization is held, not only private state.
  Eight owner/clock cases pass20 repetitions2.089s; focused real admission/fault/
  root CLI4.770s and final affected five repetitions7.169s pass.
- Four affected gateway checks pass7.25s; seven actual Chromium/WASM Begin/
  continuation checks pass58.3s. Existing web artifacts still match
  /tmp/ssh-exam-registered-owner-browser.sha256. No application/protocol/client
  source changed; unchanged broader application/browser evidence still applies.
  Native static CGO-disabled builds and vet pass;35 Python safety checks pass.
- Changed native candidate's timed-owner guest PASSES8 assertions, final wrapper
  exit0 and host/base preservation at /var/tmp/ssh-exam-overlay-4hff8wnu. Exact
  private bundle /var/tmp/ssh-exam-pending-owner-upload.ky0pwllm/bundle. This is
  legacy grantless BrowserSSH lifetime compatibility, not registered unified
  Begin, all-writer freeze or retained recovery qualification.
- Final collector guest PASSES12 assertions, final wrapper exit0 and host/base
  preservation at /var/tmp/ssh-exam-overlay-0pab0pyg. Exact private bundle
  /var/tmp/ssh-exam-pending-owner-final.a4gpwltc/bundle.24 healthy signed renewals,
  maximum0.092926s; same healthy supervisor/PTY/new pane/clock and byte-exact40MiB
  target retry; both account restrictions restore at original deadlines only.

Retained failed qualification: /var/tmp/ssh-exam-overlay-be67lr11 queried a new
supervisor after provisional EXAM-READY, before closed handoff. The corrected
fixture requires an actual shell response before observation. The next
/var/tmp/ssh-exam-overlay-4fyqd90r passed crash/healthy-owner checks but wrongly
treated a successful retry returning FINALIZING as secured completion. It now
waits for a positive read-only COMPLETED snapshot with unchanged interval, then
verifies the archive and exact bytes. Neither correction relaxes native permission,
protection or restoration. Both failed runs passed host/base preservation.

The first full native run402.865s had one fixture failure: the strict read-only
inventory refused while a canonical atomic replacement unlinked its opened
inode and changed ctime. The fixture now requires a positive coherent inventory
within one second, retrying only that explicit snapshot refusal. A persistent
refusal or incorrect pane count still fails. Final full native race/resource/
userns/compiler/default-size disk-backed IO qualification PASSES core394.808s;
CLI tests pass from the valid cache. Log /tmp/ssh-exam-pending-owner-native-final.log.
This was a separate run after focused completion, not inferred from the failed run.

Final545-file source manifest906f8098685209adb8c0d41bdc5d2b9691d5e84bd19e5536ea1033c89b6fce8a
is /tmp/ssh-exam-pending-owner-qualified-source.sha256. The timed guest's earlier
test/fixture source manifest64833ec0ab3f29f179ecf368845beb1bcf38c6e7abe32227efa22e2f94524384
is separately retained at /tmp/ssh-exam-pending-owner-timed-qualified-source.sha256.
Its native runtime binaries are identical to the final collector run. Immutable
artifact receipts are SHA256.timed-owner.json and SHA256.collector-owner.json in
var/collection-tests/pending-owner-artifacts.9l8f3xk0; original remote bundles retain
each exact file set. Agent SHA256b3299b99ae4d2186f1aa26b11799a42ca4eb012fd23c2f1fa5f89e327a1f5ac5;
final core test450e855ed403021b11aa23f41f06fabb8afa498ca76d38ac53b323ed674ab60f.
No deployment, production action, missing command or instructor approval request.
