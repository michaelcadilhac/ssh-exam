# Critical monitoring-liveness redesign plan

Recorded October 21, 2026 (America/Chicago). Automatic technical-only recovery is
now approved under the conditions below; implementation and regression
qualification are in progress locally. No production mutation or deployment.
Student incident records remain outside the repository. This is the critical TODO priority before
nonessential feature expansion, not a claim that the investigation is complete.

## Requirement and evidence boundary

The instructor requires elimination of false positives caused by heartbeat design.
Treat these as separate requirements:

- While full fresh policy evidence and authenticated ownership remain verifiable
  through a supported path, control latency or a lost acknowledgement must not
  trigger a false violation, unnecessary safety hold, instructor-approval cycle,
  credential prompt, workload termination or editor-buffer loss.
- A timeout alone is not evidence of misconduct, lost capture, or a dead SSH
  transport. Record uncertainty and the observed failing stage accurately.
- If complete required monitoring genuinely cannot be verified, work must stop
  within the explicit security bound. Preserve viable SSH and editor buffers by
  C3's verified freeze, not by allowing unmonitored work. Such a technical hold is
  still an interruption and must not be advertised as an absence of disruption.

Arbitrary delay/partition cannot be distinguished perfectly from failure. Thus
zero interruptions under all network failures and fail-closed monitoring cannot
both be guaranteed. Eliminate known false-trigger mechanisms, define the supported
fault/latency envelope explicitly, and measure both false holds and violations.
Do not claim statistical tests prove an absolute guarantee outside that envelope.

Initial read-only inspection of the installed implementation confirmed:

- Images use independent HTTP uploads; browser monitoring uses a session WebSocket;
  signed execution renewal additionally crosses browser-SSH control/worker and a
  separate SSH command channel. Terminal-channel activity is not that round trip.
- The gateway chains session-message handlers and awaits native renewal before
  returning the heartbeat confirmation. Browser-SSH commands can wait 120 seconds;
  native execution permission lasts 15 seconds. One stalled exchange can hold up
  later processing/confirmation despite other healthy paths.
- Browser confirmation, control-socket detachment/rebind and worker-supervision
  timers independently affect recovery. Fixing only the gateway queue is not a
  complete solution. The existing snapshot-ordering fix must remain intact.
- Native renewals already have an independent per-attempt journal/lock, but that
  isolation does not prove the entire browser-to-native path is independent.

Successful HTTP captures during a renewal gap are verified evidence of a partial
failure, not proof of complete policy readiness. Fresh terminal bytes in that exact
gap were not established. The initiating fault is still unknown: do not present
queue blocking, a particular socket, or student behavior as its proven cause.

## Proposed protocol and state separation

### H1 reproduction and H2a contact-lane candidate (local, partial)

The new real HTTP/WebSocket/SSH regression reproduces the old serial handler:
fresh screen/webcam POSTs succeed and the authenticated SSH terminal channel
echoes a probe, but no monitoring confirmation arrives while one signed renewal
reply is deliberately held. The initial expected confirmation assertion fails on
the old handler. The SSH fixture uses a simulated shell/native policy, not actual
privileged freezer enforcement; this does not establish the production initiating
fault or complete H1's per-hop/native investigation.

The H2a candidate processes authenticated monitoring, focus and incident reports
independently of ordered terminal operations, with full schema/current socket and
page checks, handler-local snapshots and a bounded outstanding count. At most one
ordinary native renewal per attempt remains in flight. A distinct
`monitoring-contact` reply carries only attempt identity and a one-use socket
confirmation, never native permission/state. It does not bind a page, apply an
attempt snapshot or thaw/arm a paused workspace. Old clients ignore the new type
and continue to receive final state replies. Shutdown now drains bounded pending
session tasks after connection cancellation and before closing SQLite; the new
fault test exposed, then verified removal of, an unhandled closed-DB race.

Nine focused real-interface/race tests and all361 application tests pass locally.
Three browser checks verify contact cannot bind/thaw and real WASM SSH input
survives 17.5 seconds of lost final browser state confirmations while native
fixture renewals and HTTP uploads continue. Native policy is simulated in those
browser checks. All91 combined browser checks pass (11.2m), fresh full native
race/resource/namespace/compiler tests pass (core167.9s/CLI5.9s), and static native
build/vet plus application typecheck/build pass. These qualify H2a's narrow scope,
not alternate delivery or C3 containment.

This is **not** the complete renewal/technical-hold fix: the long native-command
budget, clock-command interference, in-flight renewal ownership/recovery,
alternate evidence, native receipt/freshness/epoch rules, all-writer C3 containment
and technical-hold classification/thaw remain outstanding. If the native renewal
itself never arrives, the native lease can still expire. Contact receipts must
never conceal that fact. No production behavior has changed.

### Remaining protocol

H2b/H3 internal verification groundwork is now under local qualification, still
unwired: strict cross-language scoped metadata and native signed evidence/age
validation. Native request-monotonic time plus bounded gateway component age
charges full transit delay, rather than trusting remote wall-clock expiry or
minting a new window on reply/retry. It grants no work and does not implement the
missing issuer, coverage ledger, epochs, durable commit or hold/thaw. See
[monitoring-evidence-contract.md](monitoring-evidence-contract.md).

H3b also has an internal bounded evidence/coverage ledger candidate, not a live
issuer: required challenged components, immutable retry age, sticky actual-policy
loss, unchanged focus grace and a coverage identity that changes after unknown
gaps. The native candidate now rejects a replacement coverage identity. Initial
bootstrap is limited to unexpired ACTIVE authority with no consumed evidence;
never use it to thaw/reset a held context. Implicit owner/input/clock changes
refuse pending a verified transition protocol. Compiled private Go/Node proof
interoperability and22 focused cases pass; full383 app and native race/resource
qualification pass. Printed JS/CSS/worker filenames were unchanged, but WASM
identity against the prior browser run was not established. Fresh exact-artifact
browser qualification is required; this remains internal only.
This neither closes H3 nor supplies missing native journals/C3 barriers/routes.

H4a now adds private unused native/browser-Go framed-input codecs with a canonical
binary fixture and actual raw-PTY/encrypted-SSH checks. The existing32KiB UTF-8
worker cap is preserved, including large Unicode pastes. Decode is not permission:
root durable epochs, per-pane revocation/drain, all-writer freeze and input queue
discard, authenticated mode negotiation and held-recovery integration are still
required together. Current bridges remain raw; no capability enables retention.
See [retained-ssh-input-protocol.md](retained-ssh-input-protocol.md).

H4b adds only the unused local per-pane revocation/drain gate, with ten focused
cases passing ten race repeats and fresh full native/resource qualification.
Actual PTY backpressure and delayed partial old-epoch frames cannot falsely
acknowledge drain or reach a new epoch. A candidate stale-write-timer regression
was reproduced and fixed by checking current renewed authority. Drain remains
distinct from all-writer freeze/queue discard, and no live transition uses it.

1. **Browser contact:** acknowledge a valid current page's monitoring message
   promptly without waiting for SSH/collection/management work. This acknowledgement
   proves receipt only; it must never enable input, thaw workloads or extend a
   native execution lease. Preserve one-use socket confirmation and snapshot-order
   independence; an HTTP poll must not pretend the WebSocket itself is healthy.
2. **Policy evidence:** maintain bounded current readiness/coverage facts for the
   attempt, account, page, transport, boot and authorization/input epoch. Distinguish
   receipt time, capture time and confirmed native acceptance; use monotonic elapsed
   time where applicable. Fresh images or PTY bytes alone are insufficient. Define
   challenge/sequence/freshness checks before adding any alternate route.
3. **Execution renewal:** use a dedicated bounded per-attempt scheduler/fast path,
   outside the serial session queue and generic 120-second RPC budget. Coalesce
   pending updates to the newest valid evidence; bound in-flight work, queues,
   resources, retries and cancellation. Long commands, a stuck pane or another
   attempt's I/O must not block ingestion, renewal or watchdogs. A shorter timeout
   alone is not the fix. Validate a persistent control lane versus short-lived SSH
   command channels with real contention/fault tests before choosing the transport.
4. **Delivery/receipt recovery:** separate request sent, native lease committed,
   signed reply received and browser notified. Query/retry a scoped operation after
   a lost reply without restarting its freshness window or granting extra time.
   Idempotent duplicates return the original outcome, never a fresh authorization.
   Reject stale/out-of-order/forged or replacement-generation responses.
5. **Alternate path:** investigate a bounded, purpose-specific monitoring evidence
   exchange over existing authenticated HTTPS and the agent's existing signed
   outbound callback trust, independent of the stalled SSH command/control lane.
   It may carry only complete fresh monitoring evidence and scoped renewal/status
   decisions, not arbitrary commands. No inbound agent API, credential replay,
   generic disconnected command polling or unconditional native self-renewal.
   Authenticate browser/page evidence and bind the native decision to its actual
   registered transport/boot/epoch. Duplicated paths cannot add permission or
   extend freshness. If this cannot be proven, do not enable the fallback.
6. **Technical uncertainty:** represent a suspected exchange failure separately
   from a confirmed policy violation and actual authentication/ownership loss.
   Reconcile alternate evidence/committed receipts within the remaining valid
   authorization; never grant an extra unmonitored grace period. If uncertainty
   outlasts that authorization, enter a verified technical safety hold. Preserve
   viable transport/shells/buffers and block all writers/input through C3. Failed
   containment remains fail closed, with an explicit operational fault.
7. **Recovery:** introduce the approved separate technical-hold transition only
   after its evidence and containment prerequisites pass. A late heartbeat or
   contact acknowledgement must not thaw a
   paused generation. Recheck complete readiness, identity/ownership, input epoch,
   policy history, current deadline and native freeze/receipt before any transition.
   Genuine policy locks keep their continuation rules; actual ownership loss keeps
   fresh-authentication requirements. Finalized attempts never reopen.

The exact protocol schema, deadline budgets and capability names are design work,
not approved implementation details. Keep the existing 15-second security bound
as the baseline; any requested bound change needs an explicit policy decision and
evidence, not a silent reliability workaround. Do not retain older authorization
past that bound merely because a contact reply, frame or keepalive arrived.

## Approved technical-hold recovery policy

Approved by the instructor October 21: automatically recover an infrastructure-only
technical hold **only**
when the system positively verifies the same authenticated ownership and complete,
uninterrupted authorized monitoring coverage, all current readiness, no actual
policy violation, no input from a retired epoch, and an unexpired attempt. Missing
coverage is not cured by a fresh frame or a reconnect. Treat an unproven gap as a
technical interruption requiring the existing explicit recovery/review policy,
without accusing the student. Requiring instructor approval after every positively
verified technical-only hold is not the selected policy.

This approval supplements C3's approved policy-lock thaw; actual policy violations
and authentication loss retain their existing recovery requirements. If uninterrupted
coverage cannot be established in a proposed protocol, mark automatic recovery
ineligible rather than quietly weakening the requirement. No automatic refund,
clock stop, deadline change or completed-attempt reopening is proposed. The
original/current deadline, protected-submission and account-hold rules remain.

## Dependency-ordered milestones and acceptance

| Milestone | Dependency | Required outcome and tests | Status |
| --- | --- | --- | --- |
| H1: reproduce and observe | Read-only investigation; synthetic environment | Red regression on the old code for a stalled renewal with healthy captures/PTYs; per-hop evidence identifies where progress stops; inventory every timeout/rebind path | Serial blockage reproduced; native/per-hop investigation and initiating fault still open |
| H2: isolate receipt and renewal | H1 | Bounded independent ingestion/acknowledgement/scheduler; scoped idempotent receipt recovery; no serial head-of-line blocking, fabricated native permission or stale-result transition | H2a contact/queue candidate locally tested; scheduler/receipt/native work open |
| H3: alternate evidence and recovery contract | H1/H2; approved technical-only recovery | Demonstrate a complete authenticated alternate path, precise freshness/coverage and expiry rules; outage classification, UI, deduplicated operational alerts and CLI/web parity | Recovery policy approved; transport details/implementation/qualification open |
| H4: nondestructive containment | H2/H3 plus C3 input-epoch/all-writer/liveness implementation | Freeze verified before claiming safe hold, trusted supervisors unfrozen, no queued input at thaw, viable shells/buffers retained; genuine locks and ownership loss remain enforced | C3 approved; coordinated implementation/qualification open |
| H5: combined release qualification | H1–H4 | Full fault matrix below, native race/build and application/browser integration; documented budgets, compatibility, rollout and rollback | Not started; no deployment authorization |

H1/H2 diagnostics and proof work proceed locally first. The recovery-policy
decision is no longer a blocker. Do not enable an incomplete hold/thaw protocol,
label a timeout as a
policy violation, or claim a short-term queue fix completes H3–H5. The previously
completed M2 deadline/intentional-action race fixes cover narrower cases and do
not close this item.

## Required regression and fault matrix

Exercise the real interfaces with synthetic identities and isolated state, not
only mocks or underlying functions. Reproduce failure before claiming a fix.

- Real browser session WebSocket, HTTP capture uploads/status and actual WASM SSH
  with a real PTY/native agent: stall one renewal command or reply while capture
  and PTY streams continue. Separate command-not-delivered from native-committed/
  reply-lost. Test receipt recovery both before and after the old lease boundary.
- Delay/drop/duplicate/reorder messages and acknowledgements; independently break
  monitoring WebSocket, browser control socket, SSH command channel, relay and
  callback path. Test half-open connections, backpressure, bounded reconnect and
  replay, retired sockets and HTTP snapshot overtaking. Within the declared
  supported envelope and with complete alternative evidence, assert zero false
  holds, policy incidents, forced approvals/MFA, terminated shells or lost buffers.
- Outside that envelope, prove a timely verified freeze without a false misconduct
  classification; never continue work on keepalives, stale coverage or frames
  alone. Test total partition, real capture/fullscreen/keyboard loss, actual SSH
  failure and page closure/reload, including hostile attempts to exploit fallback.
- Block generic commands, shared locks, disk I/O, frame encoding/uploads and PTY
  writes; exhaust SSH channel/queue limits; stall/kill/restart worker, gateway,
  native listener and watchdog in the fixture. Include concurrent attempts so
  one failure cannot expire another student's valid permission or deadline work.
- Assert both safety and availability at exact timeout boundaries, with monotonic
  versus wall-clock changes, event-loop/CPU scheduling delays and retry budgets.
  Use deterministic fault coordination plus randomized bounded stress; record
  maximum hop/renewal latency, queue depth, evidence age and technical holds.
- For C3, include actual background/descendant writers, raw and recorded PTY
  bridges, input delayed upstream, new/multiplexed channels/exec/SCP/SFTP, repeated
  hold/thaw, frozen editor buffers, freeze refusal and stale automatic/manual
  authorization. Work and queued input must not cross an unauthorized epoch.
- Race genuine policy/admin locks, cancellation/finish, current/original deadlines,
  queued clock changes, protected collection and older callbacks/receipts. Preserve
  signed deadline verification, immutable protected submissions, restrictions and
  credential cleanup. Never auto-refund, extend or reopen to hide an interruption.
- Exercise proposed supported examctl diagnostics with the compiled CLI and actual
  signed TLS gateway, plus matching browser admin/student views, actionable help,
  offline/pending status, authorization, audit and privacy. Any management action
  introduced for technical holds must have a shared discoverable CLI workflow;
  diagnostics must not secretly reconcile/mutate merely to inspect liveness.
- Run the appropriate full application/integration, native race/resource, static
  build/vet/typecheck and browser suites together on frozen candidate artifacts.
  Privileged freezer/PAM/channel tests require an isolated synthetic guest and
  the existing no-production-interference guard. No tests on live student state.

Per-hop diagnostics must be bounded and privacy-safe: attempt-scoped opaque
correlation/sequence and stage timestamps/result codes, not passwords/MFA, private
keys, reusable confirmation/capability values, screen bytes or terminal contents.
Audit timeout/uncertainty as such. Deduplicate operational alerts without hiding
an ongoing containment/monitoring outage or creating student-violation emails.

## Future rollout, migration and rollback proposal

No deployment is authorized. Before a separately authorized maintenance window,
finish H1–H5 and operator/design docs, back up native/gateway state and protected
archive identities, and validate a versioned capability handshake across browser,
gateway/worker, native gate/PTY owners and watchdog. Refuse partial enablement;
an old bridge/watchdog cannot claim verified retained-buffer or alternate-path
support. Never rewrite historical reasons or manufacture missing coverage facts.

Use read-only observation first to check hop budgets and false-trigger counters;
it does not authorize enabling new enforcement or collecting unnecessary media.
Cut over only when attempts and outstanding restrictions/PTY ownership are
verified drained. Include the already-required temporary agent-service
consolidation in that drained maintenance plan; do not restart old PTY owners or
consolidate during exams. Validate synthetic end-to-end sessions after cutover.

Rollback must preserve all newer attempts, protected archives, deadlines, holds,
input/authorization epochs, audit and pending clock intents. Disable new admission
and drain before rolling incompatible binaries/protocols back; never downgrade a
live watchdog or restore stale databases over newer student records. A later
deployment receipt must distinguish installed behavior from this local plan.
