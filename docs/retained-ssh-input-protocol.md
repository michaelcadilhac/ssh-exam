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
