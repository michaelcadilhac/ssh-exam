# Retained-SSH input fencing: staged local proposal

October21, implementation/qualification in progress locally, **not enabled or
deployed**. This supplies H4/C3 prerequisites for monitoring-liveness-plan.md.
Current raw/recorded bridges still use unconditional input io.Copy and policy
pauses still terminate workloads. Never claim buffer retention from a codec alone.

## Investigated boundary

Native shells/writers run in recorded nondelegated exam.slice scopes. Root-installed
SSH/entry stubs are separately protected in exam-entry.slice and verified by inode,
UID and root SSH ancestry; they are not arbitrary executable exemptions. Writer
verification scans real/effective/saved/filesystem UIDs, rejects uncontained writers
and freezes descendants. Retaining these viable trusted transports while freezing
the actual workload is structurally possible, but requires the entire C3 barrier.

Both raw and recorded PTY bridges currently copy input unconditionally, outside the
frozen workload. Browser-only disableStdin, a mutex around raw forwarding or flushing
one local buffer cannot identify pre-pause input delayed farther upstream. Do not
just remove terminate/Connection.close. Missing/failed verified containment stays
fail closed; original/current deadlines and policy locks remain authoritative.

## Input protocol candidate

Use explicitly negotiated framed input on each new-mode authorized exam pane,
not byte sniffing or an implicit fallback. Terminal output stays raw and the
recording policy stays output-only, never raw-key recording. The candidate binary
header is fixed-size, network-byte-order:

| Offset | Bytes | Meaning |
| --- | --- | --- |
|0|4|ASCII EXIN |
|4|1|Version1 |
|5|3|Reserved, all zero |
|8|32|Native input epoch (64 lowercase hex externally) |
|40|16|Pane UUID bytes |
|56|8|Positive sequence, maximum JavaScript exact integer |
|64|4|Payload length,0..32768 (existing WASM UTF-8 byte cap) |
|68|length|Unmodified terminal input bytes |

Decode/validate a complete bounded frame before any forwarding. Unknown version/
flags, oversized/truncated or malformed frames never become terminal bytes; no
error logs their payload. Empty input is a harmless no-op, not monitoring evidence
or renewed permission. The decoder is not a permission check: match native current
pane/epoch, monotonic nonreplayed sequence, live authorization and deadline under
the actual input/revocation barrier before writing. Bound queues/writes and make
cancellation/revocation independent of a blocked frame read or PTY write.

Stamp native epoch and pane sequence at **keypress capture before the first
asynchronous queue**, and carry them unchanged through JS, RPC/IPC, Go/WASM and
server-proxy input. Never relabel queued input with the latest epoch at dequeue or
worker send. Sequences are increasing, not necessarily consecutive: legitimate
local UI cancellation can drop an unsent frame. A new native epoch fences delayed
old frames, even if SSH/TCP delivers them after thaw; each pane needs independent
ordering and replay accounting. Do not replay queued input on reconnect.

The initial increment is an unused browser-Go encoder/native decoder plus a shared
canonical fixture. They change no live caller or advertised capability. Verify
binary control/UTF-8 bytes over actual SSH channels and a raw Linux PTY, boundaries,
fragmentation, truncation, invalid headers and bounded allocation before wiring.
These are protocol checks, not all-writer or queued-input containment qualification.

## Codec qualification (H4a, locally tested)

Focused browser-Go/native race checks pass, including actual encrypted SSH-channel
and raw Linux PTY transport. The decoder fuzz run passes176647 executions in10s
with two workers. All383 application checks/71files pass (82.03s); full native
race/resource/namespace/compiler tests pass (core163.9s/CLI6.0s), static build/vet
and application typecheck/build pass. All91 browser checks pass (11.2m) against
frozen assets. Generated screenshots are test artifacts, not an intentional UI
change. No existing runtime caller imports these codecs.

Exact SHA256 before and after the browser run (all unchanged):

```text
071ee17c59ff7c39d44eec6514def75ba15b627ef541f23431003e4a036a54ad ssh/client.wasm
0c949f4996f9a89698e4b5c586de32249c3b69b7baadb64d220073cc04acba14 ssh/wasm_exec.js
63e205e5b24038468520fa881658fea4b43fa06427795deba945d7db3e7bbf61 assets/index-CA-WsKBw.js
844d847ae1159366c2ba3c704226d3febf4c85ca32627eec927b8355e7e6880b assets/index-D7Mlutge.css
78b94231f09842ed9845b4c323fdcf35f0e67096ee92241424ac3347f434587b assets/ssh-worker-FM5arK7Q.js
f2d6a059ec50a65532c2f945100cfb2aa0955461f5375ce6473e09506e01d513 index.html
```

The earlier H2b/H3b record incorrectly inferred unchanged WASM from unchanged
printed JS/CSS/worker filenames. Those claims are corrected; their earlier browser
run qualified its then-built candidate, not an unmeasured rebuild. This fresh
run closes that qualification gap for the exact H4a artifact above. Rebuilds must
be compared/requalified, not silently assigned this result.

## Delivery/revocation controller design

The next private controller is per pane and starts revoked. It accepts only a
native-authorized epoch, pane, fixed deadline and bounded monotonic authority
cutoff. Every frame consumes its increasing sequence before the first byte is
written, including a partially written frame. Retries cannot replay a delivered
prefix. There is at most one in-flight frame and no internal input queue; the
decoder supplies the next frame only when that delivery has settled. A frame
received while revoked or from a prior epoch is discarded, never relabelled.

Do not hold the controller mutex or shared native state across a PTY write.
Revocation closes admission and cancels an in-flight delivery immediately, then
returns an opaque, controller/revision-bound drain receipt. An uncooperative
write may delay that receipt, not the revocation itself. A receipt is ready only
after the final write call has returned: returning from cancel, a timeout or a
successful freeze syscall is not proof that trusted bridges stopped forwarding.
Any write error revokes permission, preserves sequence consumption and reports a
static error without key bytes. The eventual production writer must be bounded
and cancellation-aware; an arbitrary blocking io.Writer does not meet that claim.

Arming a new epoch requires the current drain receipt, all registered pane
acknowledgements, verified all-writer freeze and a successful discard of unread
kernel/bridge input before thaw. Draining a controller alone proves neither
freeze nor queue discard. Signed native ownership/held-recovery authorization,
current complete coverage, deadline and fresh epoch checks remain separate
mandatory native transition prerequisites. An old acknowledgement or a fresh
frame cannot authorize that transition. Keep all-writer/admission registration
closed throughout; no newly created channel may escape the recorded barrier.

Renewal may extend only the same live epoch's cutoff within its fixed deadline,
using a previously verified native permit's original cutoff. It cannot recover
expired or revoked input, change a deadline, re-arm a sequence or start a new
fifteen-second allowance at receipt. Clock changes require explicit verified epoch
handover. Root process/gateway restart must not reconstruct positive authorization
from controller-local fields; root-owned durable state and replay fencing are
required before any live caller can use this primitive.

### Local controller candidate (unwired, H4b)

`ssh-server/internal/core/input_controller.go` implements only this local per-pane
barrier. No live bridge, attempt operation, lease consumer or capability calls it.
It starts revoked, bounds one in-flight frame/no queue, consumes sequences before
writing and gives an opaque current-revision drain which cannot be reused after
arming/revocation or on another controller. Arming requires a different epoch and
the supplied original permit cutoff; expired/revoked gates cannot self-renew.
Clock regressions and revision exhaustion fail closed. The clock callback is a
trusted, nonblocking boot-monotonic read, never a filesystem/network operation.

A failing regression exposed an early candidate bug: an in-flight write retained
its initial timeout even after valid renewal, creating a false revocation. The
corrected single watcher rechecks the current cutoff on timer delivery and uses a
bounded coalescing wake on renewal. It never treats an old timer as expiry proof.
This was a development-candidate defect, not evidence of that production cause.

Ten race-detector repeats cover ten controller cases, including an intentionally
uncooperative writer (immediate revoke but no false drain), current-cutoff renewal,
expiry, backwards clocks, stale/consumed/foreign receipts, replay and partial write
failure. Actual Linux PTY tests exercise cancellation under kernel backpressure
and parser→gate→PTY bytes: a partial old-epoch frame delayed until after new-epoch
arming is rejected, new input preserves binary/control/UTF-8 bytes and output is
independent of held input. The backpressure test deliberately does NOT arm again:
its unread kernel queue still exists. Drain is not input-flush/freeze proof. Full
native race/resource/namespace/compiler tests pass (core171.9s/CLI5.8s), static
build/vet pass and26 focused cross-language/HTTP/WS/SSH application checks pass
(11.60s). Browser artifacts remain hash-identical to H4a's91-check run. No
privileged all-writer, runtime negotiation or technical-hold qualification is
claimed.

### Cancellable pinned-PTY adapter candidate (H4c, unwired)

`input_pty.go` connects the local gate to a private cancellable PTY writer and
input-discard primitive, not a runtime admission/recording/hold path. It requires
an explicitly O_NONBLOCK Go-poller-supported master and its actual pinned slave.
TIOCGPTPEER obtains the peer without resolving a possibly different namespace's
`/dev/pts/NUMBER`; device/inode identity must match the provided descriptor. Both
descriptors must have the supported normal N_TTY discipline. Alternative line
disciplines are not qualified; tests do not autoload kernel modules on this host.
The unchanged legacy `openPTY()` still uses its original flags; a private helper
allows explicit flags for this future mode only. Never retrofit a live raw bridge.

Cancellation uses the poller's write deadline. Before write returns, stop or join
its cancellation callback and clear that deadline. Thus no old callback can poison
a later new-epoch write; the controller's drain covers the callback as well as the
final syscall. A discard reservation blocks arm without holding the controller
mutex over IO. Require the current already-drained receipt and separately verified
all-writer freeze/closed admissions before flushing; a failed discard permanently
refuses local arm until native containment is inspected. No timeout alone counts
as success. Static errors never print keys, fd paths or syscall contents.

Only this slave's unread INPUT is flushed, then TIOCINQ must report zero. Do not
flush terminal output or erase already-read application/editor buffers. A partially
typed canonical kernel line must be discarded even if it was not yet readable;
zero readable bytes by itself would not prove this. Kernel source inspection
must include the complete ioctl path: the top-level
[TCFLSH dispatch](https://raw.githubusercontent.com/torvalds/linux/master/drivers/tty/tty_io.c)
flushes pending buffers before the
[line-discipline helper](https://raw.githubusercontent.com/torvalds/linux/master/drivers/tty/tty_ioctl.c).
Looking at the latter alone incorrectly suggested a second flush; the full path
and actual backpressure tests did not support that inference. These source links
are upstream references, not a claim that another host runs the identical source.

Eight adapter cases exercise actual Linux PTYs on local7.2.6-arch2-1: blocking/
wrong/closed descriptor refusal, backpressure cancellation,20 sequential hold/
discard/new-epoch cycles without late deadline poisoning, raw/control/UTF-8 and
incomplete canonical input discard, output preservation, current/foreign/stale/
undrained receipts, failed discard refusal, independent revocation during a stalled
discard, and two panes with one genuinely backpressured while the other keeps its
epoch/cutoff/deadline and input. Combined with ten gate cases, all18 cases pass20
race repeats (15.91s). Final full native race/resource/namespace/compiler tests pass
(core170.3s/CLI6.4s), static build/vet and all383 application checks pass (82.82s).
Browser assets remain hash-identical to the91-check H4a run; no rebuild occurred.
These are unprivileged PTY tests,
not privileged cgroup freeze/SSH/PAM/namespace containment qualification. No live
bridge, attempt state, root journal, callback or capability calls the adapter.

## Next integration boundary: durable native coordination (not implemented)

The listener, retained PTY owners, independent watchdog and root examctl may be
different processes. A process-local map/mutex or the current shared state lock
cannot be the final barrier. Keep the existing independent deadline cutoff and
account restrictions throughout. The proposed next increment has these fences:

1. A root-private, per-attempt durable control journal and persistent lock inode
   bind full native owner/boot, generation, clock revision, page/input epochs,
   fixed deadline/current authority cutoff and every admitted pane/bridge owner.
   Register a pane before launch while admission is open; remove it only after
   verified scope/bridge cleanup. Record root bridge PID/start/boot identity, not
   merely a user-supplied PID or a transport hash string. Root-only coordination
   uses existing local IPC/private state, not a new network control listener.
2. Lease commit and monitoring cutoff share this per-attempt revocation lock.
   Re-read current authority under that lock before beginning revocation; never
   freeze an old state.json snapshot that raced a healthy renewal. Journal IO and
   lock acquisition are bounded; one attempt cannot block another's cutoff. Use
   checked integer boot-monotonic time, not the existing /proc float helper; charge
   suspend/clock anomalies explicitly and test timer-source/expiry interactions.
3. First durably close new admission/renewal and revoke the current input epoch.
   Notify all registered retained bridge owners, cancel writes and require exact
   controller/pane/revision drain acknowledgements. Independently freeze every
   recorded workload/descendant and verify all real/effective/saved/filesystem-UID
   writers; only verified trusted entry/SSH supervisors remain outside. Do not
   reuse finalization's permanent work ownership/mode change for a temporary hold.
4. With workload freeze and all input drains verified, discard every pinned PTY's
   unread kernel input. Publish a scoped freeze/discard receipt only after all
   confirmations, with unconfirmed/missing/dead owners as explicit faults. A
   successful systemctl exit, a vanished peer, an empty direct process list or a
   timeout is not proof. If freeze/discard cannot be verified, keep admission and
   input revoked and use the existing fail-closed containment escalation; report
   truthful process/buffer loss rather than claiming retention succeeded.
5. Distinguish technical uncertainty from confirmed policy-condition loss and
   authentication loss. Automatic technical recovery requires the approved same
   live authenticated owner, complete current evidence and uninterrupted coverage,
   verified current freeze/discard receipt, unexpired deadline and no overriding
   policy/authentication loss. Revalidate actual root sshd PID/start/boot ancestry;
   a gateway signature on a registered owner string alone is insufficient. Policy
   continuation still requires its explicit review/approval. Actual transport loss
   still needs fresh authentication. Never refund time or reopen a completed exam.
6. Resume is coordinated, not a direct `freeze(false)`: stage a fresh native input
   epoch behind closed gates, perform an explicit coverage-preserving gateway
   handover, commit bounded fresh authority, thaw/verify all writers and publish
   the signed resulting epoch/receipt before enabling browser input. Record the
   authorized-but-not-yet-confirmed thaw phase honestly; a partial thaw/failure
   revokes and refreezes every scope. Original/current deadlines and independent
   cutoffs continue to apply during each phase. No old frame or late reply can
   acquire the new epoch; no held ACTIVE-verifier bootstrap is fabricated.
7. Purpose-bound durable request/sequence receipts preserve the first original
   cutoff across duplicate/lost replies and root restart; they cannot refresh
   permission or reset a coverage watermark. Never silently change the legacy
   one-use signed-command replay contract. Missing/corrupt journal or unknown
   crash phase closes input/admission, never reconstructs positive authority.

Qualification must exercise the coordination between real processes, not just
reducers: renewal-versus-expiry, pane launch-versus-revoke, concurrent root CLI,
old/new watchdog, duplicate/reordered acknowledgements, bridge death/stall and
PID reuse, namespace-pinned descriptors, deadline/clock/finish races and crash at
each fsync/rename/receipt/thaw boundary. Prove another student's monitoring,
input/cutoff and collection stay independent. Add genuine policy/authentication
loss and gateway restart with no invented historical coverage or reused keys.
The local isolated root/system-manager guest remains required for full SSH/PAM/
cgroup qualification; unprivileged PTY tests do not replace it.

An explicit current-state/legacy-lease `list/info --read-only` CLI candidate is now
implemented/tested locally; see native-read-only-diagnostics.md. It proves no live owner,
new control-journal phase or verified freeze. Before enablement, extend these
discoverable diagnostics to the new native barrier and shared CLI/web status and
audited policy recovery. Show observation age, ownership,
authority cutoff/deadline, coverage, journal phase and which bridge/freeze/discard
confirmation is pending. Operational uncertainty must not appear as a misconduct
finding or a false successful thaw. Current commands/capabilities do not yet
provide the new barrier/recovery workflow; add complete help and actionable next
steps with runtime integration. Do not advertise unsupported operations as available.

## Coordinated milestones before enabling retained mode

1. Codec and shared byte fixture, including actual PTY/SSH transport checks.
2. Root-owned durable input/admission epochs and per-bridge gate/controller;
   independently revoke and acknowledge inflight writes and discard locked-period
   kernel/application queues. Do not hold shared native state across blocking IO.
3. Verify frozen workload/descendant state and all UID writers; retain only verified
   trusted SSH/PTY supervisors outside frozen scopes. A missing acknowledgement or
   freeze failure is an explicit operational fault, never optimistic success.
4. Authenticated mode/epoch negotiation in signed native pane receipts and every
   input hop, including the server-proxy fallback and recorded/raw bridge variants.
   Legacy raw clients cannot claim new-mode retention. Require matching versions
   before Begin/retained resume; provide actionable version/refusal guidance.
5. Purpose-bound technical-hold versus policy-lock transitions. A verified freeze
   receipt must fence epoch handover; preserve continuous monitoring coverage only
   through an explicit verified transition, not by retiring/recreating a ledger and
   inventing missing history. ACTIVE renewal evidence is not a held-thaw proof.
6. Complete CLI/web diagnostics, scope/generation/revision fences and honest
   ownership/liveness/approval status. A transport keepalive does not grant work.
7. Fault-injected browser/WASM/SSH/native integration and privileged guest tests:
   old input delayed in every upstream queue, blocked writes/reads, repeated holds,
   writer descendants/new channels/exec/SCP/SFTP, genuine policy loss, actual SSH
   failure, root/gateway/worker restart, current/original deadlines and collection.

No new mode is enabled until all relevant milestones pass together. Older bridges,
watchdogs and temporary live agent owners cannot provide the new protocol merely
because another component advertises it. A future separately authorized cutover
requires verified drain, version/capability agreement, state/receipt backups and
the proposed temporary-agent consolidation; never execute it during exams. Do not
roll old state writers over newer epochs or restore stale student records.
