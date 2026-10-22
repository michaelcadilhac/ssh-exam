# Browser pane input lifetime

October22 local candidate; not deployed. This is a browser-queue correctness fix,
not native input epochs, SSH retention, a freeze or permission to thaw.

Source inspection and two RED regressions confirm that the old client checked
only a pane identifier, overall login/input epoch and readiness before forwarding
an asynchronous input chain. Closing the pane cleared readiness, but a replacement
with the same identifier could make it ready again before an old pending write
settled. The next old unsent chunk was then sent to the replacement. A late error
from the old chain could also emit a closure event for the replacement. This is
development evidence, not the initiating production heartbeat incident.

Each local queue now captures a private per-pane object before its first promise
continuation. Explicit close, worker-reported natural exit and logout invalidate
the object and remove that pane's chain. Both delivery and rejection check the
captured identity, in addition to the existing login/input epoch and readiness.
A replacement gets an independent chain, so a stalled retired write does not
block its fresh input or an unrelated pane. Nothing relabels an old chunk.

This fence covers bytes still queued in the browser only. It cannot recall bytes
already posted to the worker or written to SSH. Root-owned fresh per-pane packet
epochs, original-capture stamping across every queue, native revocation/drain,
kernel input discard, closed admission and verified all-writer freeze remain
mandatory for C3. The existing raw worker/native path is not advertised as safe
retained mode. No new management operation, permission or recovery policy exists.

## Qualification

Both old success/error cases fail with stale-unsent bytes on the original code.
Thirteen focused client/cleanup/Unicode tests pass after the fix. The worker-RPC
fixture also verifies natural exit, late rejection, an independently working pane,
fresh replacement input before the old write settles and logout cleanup.
All398 application tests/74files pass (80.82s), typecheck and gateway/WASM/native
clock build pass. All113 fresh frozen-artifact browser checks pass (12.7m),
including actual WASM SSH terminal/closure/recovery workflows and desktop/narrow
approval feedback. All nine recorded runtime hashes match before/after. Nine
generated documentation screenshots are restored to their verified baseline.
The prior approval-only111-case result is not assigned to this rebuild.

```text
7b3b052d57c18aa0151dd867c4f782ff6d4bd019b5e9dd89ac4cf889f9d7a9c3 ssh/client.wasm
0c949f4996f9a89698e4b5c586de32249c3b69b7baadb64d220073cc04acba14 ssh/wasm_exec.js
47846a50a226eeadeefa4a86e560a01678d2a15df78f47ec600cda052f53ff05 assets/index-CZfp66I2.js
362353c83ca36742290481a19b5165f770a97d2d9386383857fe7e9069df42f6 assets/index-CSQ9Rpbv.css
78b94231f09842ed9845b4c323fdcf35f0e67096ee92241424ac3347f434587b assets/ssh-worker-FM5arK7Q.js
c4e132f3b6fc84cde6f414bf0b13280e45b6e1d8ea2d12255919489cbf80451f index.html
f5fdffc871512222590fb7f7ad23de55cd831a95c10d111c925a39e2eea3c1a0 apps/server/native/monitoring_clock.node
4b58725bf6ddee8071fe73d03fc743140131b1204b6f01c84822f51303ca2875 apps/server/src/monitoring-clock.js
c7b6fbef97e0bebbbea59115d98ae3d638c0f8a1107cfe47bcffdde2625764de apps/server/src/monitoring-evidence-ledger.js
```

No migration or configuration change is required. A separately authorized future
drained rollout must pair browser/WASM versions and recheck real terminal input,
pane close/reopen and network recovery. Reversion loses this browser-only fence;
it must not alter clocks, grants, holds, submissions or monitoring retention.
