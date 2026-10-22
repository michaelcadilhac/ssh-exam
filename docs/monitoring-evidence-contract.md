# Unwired monitoring-evidence verification candidate (H2b/H3)

October 21, 2026. Internal local development only: **no command, HTTP callback,
browser route, watchdog, lease journal or thaw transition invokes this candidate**.
No new management operation, native capability or configuration switch enables
it. This is a building block for monitoring-liveness-plan.md, not the completed
false-lockout fix or a claim of preserved buffers/automatic recovery.

## What the verifier establishes

The proposed reply uses the existing gateway Ed25519 signing trust, with purpose
`monitoring-execution-evidence-v1`, exact audience and a native-generated request
challenge. A valid ordinary timing, management, status or SSH reply is not valid
monitoring evidence. Maximum decoded metadata is 4096 bytes; unknown, duplicate,
missing or null fields are rejected, including zero-valued required fields.
Neither rejection errors nor metadata carry passwords/MFA, private keys, raw page
secrets, image bytes, terminal contents or source paths.

The exact scope is attempt/exam/account/UID, hashed registered SSH transport,
native boot, opaque page and input epochs, generation and clock revision. These
must come from a trusted native request snapshot, never browser-supplied identity
or a caller-invented epoch. The current legacy implementation does not yet supply
the complete fenced epochs; do not fabricate them or enable the candidate early.

The gateway's positive complete-evidence decision must include a new bounded
sequence and the **age** of its oldest required fresh component. The native side
requires the same pending challenge/scope, sequence after its retained watermark,
unexpired existing authority and an unexpired current deadline. Positive parsing
and signature verification alone do not establish that the gateway actually had
complete coverage, a current authenticated transport or a verified native freeze.
Those are mandatory future caller/issuer responsibilities, not assumed facts.

## Freshness without cross-host wall-clock assumptions

Keep the existing maximum 15-second evidence window. The native request records
its own boot-monotonic issue instant and a request deadline at most five seconds
later. A signed gateway reply reports component age on the gateway's monotonic
clock, not an absolute remote expiry. Compute:

```text
candidate cutoff = min(native current deadline,
                       native request issue time + 15 seconds - evidence age)
```

Reject unless the reply arrives before that cutoff, its request expiry and the
previous native authority expiry. Charging the full native round trip is
conservative: neither slow receipt nor retry starts another fresh window, and
ordinary wall-clock skew cannot invent permission or a false evidence age. Bound
all arithmetic, including near-MaxInt64 native times. These five-second challenge
and fifteen-second evidence limits do not change any live timeout or grant.

The private verifier returns a `monitoringPermitCandidate`, not a state transition
or applied lease. It deliberately requires unexpired prior ACTIVE authority and
does not validate held recovery/thaw. Never invent a new prior-authority interval
to reuse this helper for a held attempt; that needs a separate purpose-bound
decision with verified C3 receipts, lineage and current complete coverage.
The caller must still atomically recheck current native identity,
registration, state, boot, generation, clock/deadline and current gate epochs;
durably bind/consume the exact request and sequence; and publish the original
fixed outcome. A changed proof under the same accepted challenge must not replace
the first receipt or refresh its allowance. Rechecking after publication must
prevent pause/finish/replacement from being undone. No expired or protected attempt
can be reopened through this protocol. C3 verified input/writer barriers and the
approved full coverage conditions remain prerequisites for any hold/thaw use.

## Source and qualification

The internal Go verifier is in `ssh-server/internal/core/monitoring_evidence.go`;
the matching strict, also unwired TypeScript contract is in
`packages/protocol/monitoring-evidence.ts`. Both consume one synthetic JSON fixture.
Canonical lowercase UUID shape intentionally accepts retained legacy version/
variant values; it does not silently impose a new RFC version rule on history.
Wire counters stay within exact JavaScript integer range and UIDs within the
bounded 32-bit range above low system IDs and below the invalid sentinel. This
does not replace actual account/peer verification. Sequence/revision zero
semantics are explicit, not defaults.

Focused native race tests cover signed purpose/audience/challenge and every owner
field, old/overflowing sequence, incomplete/expired/future evidence, original
cutoff on duplicate receipt, request/prior-authority/current deadline boundaries,
near-overflow arithmetic, altered signatures and malicious signed metadata. Three
TypeScript tests verify the same fixture and strict missing/null/unknown/bounds
rules. A short two-worker fuzz run passed 376 executions; this is limited parser
evidence, not an absolute no-fault guarantee or real network qualification.
All364 application tests/69 files pass (79.49s), full native race/resource/
namespace/compiler tests pass (core169.7s/CLI6.5s), static build/vet and application
typecheck/build pass. The printed JS/CSS/worker filenames were unchanged from the
91-check H2a/C2a4 run; WASM identity was not compared, so that run must not be
claimed to qualify the rebuilt WASM artifact. The new contracts are not imported
by the live client. These
are primitive-level checks, not alternate-path end-to-end qualification. See
todo-progress.md; no new browser runtime is imported.

## Unwired bounded coverage ledger candidate (H3b)

The new `apps/server/src/monitoring-evidence-ledger.ts` is also internal and unused
by live routes, signers, native commands or state transitions. Its opaque bindings
can be created only by a future trusted caller after authenticating the current
page/session and verifying the current native ACTIVE owner. A JSON body cannot
manufacture a binding. Actual JPEG/source/page/capture-challenge validation must
precede the `confirmValidatedFrame` call; a frame-sequence object alone does not
prove that this prerequisite happened. No current frame handler calls the ledger.

Complete evidence combines every required challenged frame with challenged
fullscreen/visibility/keyboard/capture readiness and the existing focus grace.
Each component's server challenge issue time bounds its freshness: late receipt
does not refresh old observations. Inherited webcam requirements are fixed at
trusted registration, not supplied by a later heartbeat. Frame traffic alone
cannot replace missing/expired policy evidence. Focus grace is twenty seconds,
cannot restart on repeated blur reports and clips the remaining evidence budget.
Confirmed readiness loss is sticky for this owner, not automatically repaired by
later good messages. Retirement/replacement requires explicit trusted ownership;
new data cannot silently supersede the old binding or change webcam policy.

An uninterrupted overlapping complete-evidence interval has a random
`coverage_epoch`. A gap expires that identity; fresh complete observations after
the gap receive a NEW one, with an incremented gap counter. The strict shared
wire proof now includes that coverage identity, and native verification requires
the retained identity to match. Fresh frames cannot silently prove an unknown
earlier interval. Initial bootstrap may leave the expected identity empty only
when no evidence has yet been consumed (`after_sequence=0`), under native ACTIVE/
unexpired authority. It is never a held/thaw bootstrap or a way to reset a retained
watermark/coverage identity. The future caller must enforce this phase distinction.

Exact native challenge retries preserve their first immutable proof age/sequence,
not a newly sampled observation. A changed request conflicts, a request at least
five seconds old refuses, and a cached bootstrap proof cannot be returned as
current after coverage changed. That last case was reproduced by a failing ledger
regression before correction, even though the independent native transit-budget
check would also reject an expired permission. Untrusted errors do not echo scope
contents. Limits are explicit: default32 owners (maximum512), sixteen outstanding
browser challenges per owner and32 retained native receipts per owner. Capacity
failure never evicts another current student. Negative/backwards/nonfinite clocks
refuse; all enforcement/coverage accounting is monotonic, not wall-clock time.

The ledger is intentionally transient: process restart does not reconstruct
positive coverage from database/image timestamps. Durable native replay/receipt
and epoch commit remain separate work. Verified clock/input epoch handover must
also be designed explicitly: this candidate refuses implicit owner changes rather
than claiming it already preserves coverage across C3 freeze/thaw. Those are
required for the final automatic-recovery protocol, not optional follow-ups.

Focused checks now include18 ledger cases, three shared-contract cases and actual
Node-signed proofs through a compiled private Go test-binary interface. They cover
scope/signature rejection, original allowance after retry, expired requests and
coverage changes while all other native checks are held valid. A deterministic
five-minute model with two-second policy/five-second capture cadence, independent
sample delays up to700ms and another700ms native round trip records zero modelled
false holds within that stated envelope. This is not a real-network/privileged
availability guarantee. All 383 application tests/71 files pass (80.49s), fresh
native race/resource/namespace/compiler tests pass (core173.0s/CLI6.6s), static
build/vet and typecheck/build pass. The revised coverage-bound parser also passes
a separate two-worker 10-second fuzz run (268 executions). Printed JS/CSS/worker
filenames were unchanged; WASM identity was not established against the earlier
91-check run. A fresh exact-artifact browser qualification is required after
rebuilding. No live caller imports this ledger. This
does not qualify a production callback, native commit or held recovery.

Additional native source boundary identified: independent `Cutoff` freezes
deadlines; monitoring-expiry state reconciliation still occurs in `Tick` under
shared state. A future monitoring cutoff/hold needs an independent per-attempt
lease/revocation/input barrier. Blindly freezing from an old snapshot can race a
healthy renewal and strand ACTIVE work frozen, so do not wire such a shortcut.
Preserve the existing independent authoritative deadline cutoff throughout.

## Next dependencies before any enablement

1. Authenticated page-bound policy/capture challenge ingestion independent of the
   blocked session socket. Age must cover every required component, not just a
   fresh HTTP upload or keepalive; preserve focus grace and actual policy loss.
2. Bounded per-owner evidence/coverage ledger, original native challenge receipts,
   stable retry/restart and current-scope sequence handling. Missing coverage must
   stay explicit; never reconstruct historical coverage from a new frame.
3. Root-owned epoch assignment, current native registration/peer verification,
   durable replay/idempotency and independent lease commit/revocation fencing.
   Inspect legacy in-flight renewal interference across ownership/clock changes.
4. A purpose-specific bounded exchange using existing authenticated outbound
   agent HTTPS. No generic command polling, inbound agent API, cached credentials
   or unconditional native self-renewal. Verify fallback failure cannot delay
   another student's cutoff, normal renewal or collection.
5. C3/H4 all-writer verified freeze, input revocation/discard, retained viable
   SSH/PTYs and accurate technical-hold classification. Only then can the approved
   positively verified technical-only automatic recovery be implemented/enabled.
6. Actual browser/WebSocket/HTTP/WASM/native end-to-end fault injection, including
   native-committed/reply-lost, stale/replayed evidence, total partition, concurrent
   students, deadline/clock/reset/finish races and privileged containment tests.

No rollout is authorized. Any future separately authorized deployment must use
the drained mixed-version gates and temporary-agent consolidation/rollback plan
in todo-rollout-plan.md. Leave protected submissions, historical attempts, current/
original deadlines, restrictions and credentials untouched throughout development.
