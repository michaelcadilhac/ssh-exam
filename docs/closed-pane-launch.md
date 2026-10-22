# Closed pane launch (in development; not deployed)

## Bounded integrated milestone

Entry points: the actual `Engine.local` Unix/PTY pane-open request, signed
`close-pane`, and `examctl panes list/show/close`. Outcome: system-manager startup
must not own shared state, and a startup completing after close, cancellation,
expiry or launcher death must never execute student code. This is the launch
portion of R2, not completed owner/epoch registration, C12 supervision, retained
SSH, a verified freeze or automatic recovery.

Keep the already-qualified setup/ACK fences. Persist a unique, bounded, closed
startup observation before starting a trusted bootstrap. The bootstrap runs in
the target scope before bwrap/student code and waits on inherited private IPC.
After observing the exact live bootstrap and its scope, a short state transaction
rechecks the original current-peer/account/authority/expiry fences, durably records
activation and only then releases exec. EOF, timeout, invalid IPC and failed
persistence deny exec. No bootstrap or permission is reconstructed from disk.
Keep the trusted-administrator service exception serialized until it has an
equally qualified gate; it does not qualify production student isolation.

Use a nonblocking one-startup-per-Engine budget, not an unbounded parallel helper
pool. The existing terminal limit also counts pending units. Read-only pane
inspection must distinguish closed startup from observed activation; both signed
and reviewed CLI close cancel exactly the same pending incarnation. Expired or
orphaned startups must be cancellable and must not reserve capacity indefinitely.
Never discard unconfirmed running workload tracking to free a slot.

Required tests: actual Unix/SCM_RIGHTS/PTY entry with blocked startup and independent
signed inspection/close; actual inherited IPC/child exec positive and negative
controls; close/cancel/deadline/lease/owner/account/settings/capability races;
failed durable commits, process death/EOF, stale completion, expiry/restart and
descriptor/process bounds; discoverable CLI read/close/help; native races/build
and affected application/interface compatibility. Actual systemd descriptor and
scope behavior needs owned local user-scope checks and ultimately the guarded
disposable root guest. Mocked ancestry/manager facts are not privileged proof.

Stopping boundary: a locally integrated, qualified closed-launch workflow, with
remaining root-guest qualification stated honestly. Do not grow this into another
unused supervisor/authority helper chain or enable retained mode.

## State/failure review before broad qualification

The actual scope path now uses a private inherited SOCK_SEQPACKET pair and an
inherited descriptor for the already-loaded agent executable. The in-scope
bootstrap proves READY with kernel SCM_CREDENTIALS; the parent retains its pidfd,
checks the exact executable inode and cgroup again at release, and requires fresh
SSH ancestry/registration/account/attempt authority. No path-selected helper,
new listener, general root command API or stored positive permit is introduced.
Only bwrap can follow the installed bootstrap role; inherited control/self FDs
are closed before exec. The parent persists activation before writing the one
permit byte and closing IPC, then rechecks current cutoffs after the durable save.
The child requires that exact byte plus EOF and rechecks both clocks before exec.

| Observation | Inspection/control | Crash, expiry and stale completion |
| --- | --- | --- |
| Unused admission | Existing pending-token count; exact signed/reviewed close revokes | Original15s expiry; no reservation/work permission from retry |
| Closed startup | `closed_startups`, original `earliest_startup_expiry`, unique incarnation and reviewed revision | Consumed token cannot rebind after restart; original wall and checked CLOCK_BOOTTIME cutoffs bound the live bootstrap and watchdog reaping |
| Cancelled closed startup | `cancelled_startups`; shared close marks cancelled even if later cleanup refuses | Final exact proof/record checks deny release; retain unconfirmed scopes and diagnostic, never clear them to force a slot |
| Activated scope | Existing ready observation; distinct review revision from its closed stage | Durable before exec; no replay/reconstruction; failed IPC/late completion closes IPC and performs tracked exact-scope cleanup outside shared state |

The watchdog's actual Tick reaps expired/cancelled closed startups, preserving
tracking when kernel cleanup is unconfirmed. The owning attempt's original
deadline, hold, policy, preparation timeout and finalization still apply. No new
UID reservation, renewal, refund, continuation or automatic recovery exists.
Missing cgroups during a closed startup cannot become permission for a late
shell: the final current-state check and live IPC are mandatory. After release,
the positively observed bootstrap is already in the recorded nondelegated scope,
so the existing cutoff/termination can cover subsequent exec and descendants.

One startup per Engine is nonblocking; other controls do not queue on that guard.
This preserves the former per-process startup budget, not a measured host-wide
capacity across temporary agents. The administrator host-service exception still
uses the old serialized path. Metadata fsync, older termination/collection waits,
durable root ownership/epochs and C12's independent PTY supervisor remain open.
Do not report this as the completed heartbeat or retained-SSH solution.

Focused verification: the original actual Unix/PTY blocked-start regression is
RED1.027s. A fixture channel-close race was corrected with a one-use unblock and
joined runner. The first expanded CLI assertion reused a decoded nonempty map;
resetting that decode target corrected the fixture, not product state. Three
final focused race repeats pass core8.321s/CLI3.868s, including actual local
user-systemd inherited descriptors, pinned executable/kernel peer/lifetime,
synthetic post-permit shell IO, late close, durable one-use/stale/expiry fences and
actual compiled root-namespace CLI inspection/cancellation/help. Root ancestry,
production root cgroup prefix and final student isolation are explicitly replaced
in those owned-user-scope fixtures. The root installed bootstrap role itself still
requires fresh guarded disposable-guest qualification; the csc-sys guard is BUSY.
No guest, new upload or production action is attempted. Broad qualification follows.

Broad local qualification passes:429 application tests/81 files102.19s; full
native race/resource/namespace/compiler/default-size core297.370s/CLI27.937s;
static native build/vet and TypeScript typecheck. Eight Chromium/WASM/SSH lifecycle/
monitoring/error checks pass57.2s. The app/WASM build first received sandbox EPERM
from Node's Go subprocess (not command-not-found), then passes the authorized
local-test escalation. After that rebuild the same eight browser checks pass
again53.9s; no pre-build artifact receipt is substituted for the rebuilt WASM.
Logs: /tmp/ssh-exam-closed-launch-{native,app,browser,browser-rebuilt,
build,build-final}.log. The failed build log is retained, not called a pass.
The later fixture-only change explicitly joins the signed-control runner even
on a regression failure; it changes no runtime or qualified browser contract.
Ten actual Unix/PTY startup/close repeats pass2.536s. Additional test-only
qualification sends actual SIGKILL to the exact owned controller after its child
has verified READY: kernel EOF must deny orphan exec. It also checks FD3/4 are
closed before synthetic exec and reads live owned-scope memory/swap/task limits.
All those final IPC/crash/user-scope/PTY checks pass ten race repeats20.540s.
These extend the failure oracle, not runtime authority or the scope of root proof.
The20:56UTC pinned csc-sys guard remains BUSY. Root installed-role/SSH/PAM/cgroup
qualification of this artifact is still pending, not borrowed from older bundles.
