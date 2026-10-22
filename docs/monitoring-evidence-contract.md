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
or applied lease. The caller must still atomically recheck current native identity,
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
typecheck/build pass. Browser JS/CSS/WASM asset hashes are unchanged from the91-
check H2a/C2a4 run: the new contracts are not imported by the live client. These
are primitive-level checks, not alternate-path end-to-end qualification. See
todo-progress.md; no new browser runtime is imported.

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
