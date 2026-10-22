# Bounded configured-account readiness — local candidate

October22,2026. No deployment, account-policy mutation or ongoing-attempt
monitoring change. This follows the independent health/state isolation increment
in local commitd37463a; do not apply that binary's privileged receipts to this
later candidate.

## Confirmed fault and correction

Production readiness ran `/usr/bin/getent passwd NAME` for every explicitly
configured account without a timeout or output bound. An unresponsive provider
could retain readiness indefinitely; prepare/Begin callers are not all outside
the shared state lock. This is not proof of the reported incident's cause.

The actual statically compiled root CLI, inside a private user/mount namespace
with synthetic NSS/manager adapters, reproduces a lookup still waiting after
six seconds. The RED test releases only its own FIFO and joins the process;
host executables/accounts and the synthetic attempt's clocks/hold stay unchanged.

The candidate gives the whole configured-account lookup pass one five-second
context, rather than five seconds per account. It never dispatches another lookup
after that cutoff and does not accept a successful result arriving after it.
Each subprocess captures at most4096 stdout bytes, discards provider stderr and
rejects oversized output; a250ms WaitDelay bounds retained stdout/stderr pipes.
The writer deliberately does not expose ReaderFrom, which could bypass its cap.
This is not host-wide process-tree/resource containment or a bound on unrelated
filesystem, state, isolation-checker or kernel IO. Never advertise the entire
health workflow as having a five-second upper bound.

Current UID and managed-shell checks remain unchanged; sandbox still checks its
configured original home/shell. No successful identity is cached, stale account
mapping substituted, policy guard skipped or active grant/deadline changed. A
timeout/provider failure/oversized result reports **account lookup unavailable**
with `examctl health`/`examctl agent status` guidance, not an asserted changed
account or student violation. New admission remains refused when verification
is unavailable. This intentionally bounds admission/diagnostic availability;
it does not permit work without verified account restrictions.

## Acceptance and verification record

1. Actual CLI hung-provider regression RED on the original implementation6.67s.
2. Check unchanged managed/sandbox UID/home/shell acceptance/refusal, malformed
   rows, current lookup changes rather than cache, one shared deadline, late
   successful output, and provider-error privacy.
3. Run actual synthetic subprocesses for valid/oversized/hung/failed providers,
   proving oversized output reaches the bounded reader rather than merely timing
   out. Test children alone disable the race runtime's artificial exit sleep;
   a first fixture run hit that delay and is not PASS evidence.
4. Actual compiled namespace-root CLI must finish the held NSS observation with
   unavailable guidance within six seconds while independent state inspection
   stays below750ms; never claim the synthetic machine is production-ready.
   Preserve original attempt authority and host NSS/manager bytes.
5. Repeat native race/build/vet/application/Python compatibility, document the
   separately OPEN concurrent-collection latency experiment, and obtain new
   exact-artifact guarded guest evidence when the host is safely idle. Never
   reconcile/clear production state or reuse preceding binary receipts.

Two initial focused repeats pass (core3.115s/CLI13.696s), including actual valid/
oversized/hung/failed children and held NSS completions5.41/5.47s. A subsequent
late-success-cutoff case also passes in the full native race/resource/namespace/
compiler/default-size suite (core242.620s/CLI23.556s), including the new concurrent
load test without excluding its earlier failing criterion. All426 application
checks/80files pass91.33s, static builds/vet and35 Python checks pass. All174 frozen
browser source/runtime hashes match the preceding evidence, with no web rebuild.
Nine fresh real browser/WASM SSH monitoring/contact, handoff and cleanup checks
also pass1.2m; this separate synthetic browser harness is not a test of the new
native binary over privileged SSH.
The separate concurrent-load investigation retains its earlier failed runs and
does not close C10/critical liveness. New exact-artifact guarded guest evidence
remains pending; the16:48UTC boolean-only raw idle check reports BUSY. No guest or
production change was made by that check.
