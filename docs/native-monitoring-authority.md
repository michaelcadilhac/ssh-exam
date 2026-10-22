# Native monitoring authority: local coordination increment

October 22, 2026. Private, **unused by runtime paths**. No new command, mode,
capability, lease, watchdog, freeze or recovery transition is enabled. This is
not the completed critical monitoring fix and is not deployed.

## Authority versus publication

`monitoring_authority.go` separates a per-attempt live decision from potentially
stalled storage. Its lock covers only bounded memory operations and trusted,
nonblocking clock/ownership predicates. No filesystem, network or worker callback
executes under it. A pending or failed publication retains only already-valid
authority; neither starts a new allowance nor proves misconduct. Expiry checks
use the current committed cutoff, not the snapshot associated with an old timer.

The constructor requires a one-use, non-JSON-restorable context seal. There is
deliberately no production factory for that seal yet: cached owner strings or a
positive-looking disk record cannot establish current root ownership. An initial
sequence-zero context is awaiting evidence, not permission for new-mode work.
Its first successful proof uses that proof's cutoff, never the longer bootstrap
interval. An already-active renewal cannot shorten independently valid authority.

Each internally issued challenge has a fresh process incarnation, increasing
counter and the original bounded native issue/expiry times. The existing signed
evidence verifier supplies the fixed candidate cutoff. One publication ticket is
pending at a time; exact retries preserve their original outcomes. Challenges and
unexpired receipts are bounded without evicting another owner or resetting the
sequence watermark. Worker bytes are copies, not mutable arbiter state.

A future authenticated publisher must acknowledge the actual durable bytes.
Wrong, expired, failed, foreign or superseded acknowledgements cannot extend
permission. Late completion after revocation cannot revive it. Verified policy,
authentication, operator and recording causes remain distinct and sticky; missing
replies alone are not such causes. Clock or ownership uncertainty revokes model
authority without inventing a deadline or alleging a student violation.

The model's `revoking` phase is intentionally **not** verified freeze/hold. Its
`ExecutionAuthorized` field is an internal model condition, not kernel proof or
a supported management response. Receipt lookup rechecks the model and is not a
passive read-only diagnostic. Existing `list/info --read-only` does not invoke it.

## Required next integration

1. Establish exclusive root actor ownership using a persistent lock inode and
   current process/boot identity. Verify actual trusted SSH/entry peers separately;
   a programming seal or caller PID is not that proof.
2. Publish small provisional records in a separately bounded metadata worker,
   never the bulk collection/template pool or a PTY-owning process. Authenticate
   scoped IPC acknowledgements; cancellation and late writes cannot undo live
   revocation. Disk records alone must never reconstruct positive permission.
3. Fence pending pane launches as well as existing writers. Register and close
   admission before acknowledging freeze; a missing unit is not proof if launch
   can still complete later.
4. Coordinate every input drain, verified all-UID-writer freeze and pinned PTY
   discard before reporting a retained hold. Use fresh **per-pane** input epochs
   at every pane creation, even when a UI reuses its pane UUID; an attempt-wide
   authorization epoch alone cannot fence delayed input from a previous pane.
5. Add actual signed native receipts, complete CLI/web status and the approved
   coverage-preserving recovery/clock transitions. Preserve genuine policy locks,
   actual authentication loss, account restrictions and authoritative deadlines.
6. Qualify real processes, storage/crash boundaries, privileged containment and
   browser/WASM/SSH interfaces together before any enablement. A stalled goroutine
   in a model test is not an actual filesystem-stall or process-isolation test.

Focused tests use real Ed25519 evidence verification but synthetic clocks and
ownership seals. Fourteen cases passed twenty race repeats (2.86s). The frozen
candidate then passed full native race/resource/namespace/compiler/default-size
checks (core166.49s/CLI8.29s), all383 app tests (82.09s), static build/vet and
typecheck. The six exact browser artifact hashes remain unchanged from H4a's
91-check run; no rebuild/client import occurred. These results do not qualify the
subsequent ownership/publisher increments or privileged retained mode.
The production initiating fault remains unproven. Deployment and temporary-agent
consolidation remain proposals only.
