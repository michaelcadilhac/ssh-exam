# Paused student approval feedback

October22 local candidate; not deployed. This is presentation of the existing
continuation workflow, not C3 SSH retention or permission to work. Policy pauses
still use the legacy native disconnect/termination path until the coordinated
retained-mode barriers are implemented and qualified.

The student status read now obtains the attempt, operational continuation grant
and presentation metadata in one read transaction. The strict version1 metadata
is scoped to attempt, generation and continuation-review revision, with observed
server time, bounded expiry and `execution: false`. No administrator actor,
private history or reason is added to this metadata. Bounded interruption history
can explain an expired, used, replaced or revoked grant; it can never reconstruct
an approved grant when the operational row is absent. No native call, permission
change, new grant, audit mutation or deadline extension is performed by the read.

The page polls the existing status workflow every two seconds. It shows approval
without reload or a repeated review request; expiry remains explicit even if
later replies are delayed or the displayed clock moves backward. Attempt,
generation, review-revision and observation fences reject stale metadata. A new
interruption clears prior successful-continuation feedback. Malformed or unknown
metadata cannot grant input. Existing readiness, authentication, single-use
authorization and authoritative-deadline checks remain on manual Continue.

Students are told to restore missing monitoring/fullscreen/keyboard conditions
and choose Continue. Only an actual disconnected SSH path asks for Reconnect SSH.
The retained-path UI fixture tests wording and no automatic input/reauthentication;
it does **not** establish live retained SSH, buffer survival, verified freeze or
automatic technical recovery. The real gateway/WASM SSH fixture currently tests
the legacy disconnected path. Its account and exam are synthetic and isolated
from other browser scenarios.

No new administrator management operation is introduced. Existing shared
interruption inspection/authorization remains available in web administration and
`examctl web interruptions`; see interruption-management.md for the supported
commands and refusal/retry rules. Approval alone never thaws a native workload.

## Qualification

Five scoped unit cases, one authenticated HTTP workflow, all395 application checks
in74files (81.05s), typecheck/build and all111 expanded browser checks (12.5m)
pass locally. The first focused browser run found that a successful Continue
had no visible resumed confirmation after its overlay disappeared. The candidate
now uses a generation-scoped status separate from transient terminal messages;
the focused four-test repeat passes. A deliberately ignored approval DTO made
the real gateway/WASM browser test RED; the mutant was removed before the full
passing run. All six desktop/narrow and backward-time follow-up browser checks
pass (32.2s) against the same frozen artifacts, including both SSH presentation paths.
The real approval screenshot was inspected visually. The original approval/C3
TODO stays open.

The expanded run froze these exact runtime SHA256s (all unchanged before/after):

```text
9bdac72ec14aad85d0d7ece19ea7586570cf7c7d2ec0ab5929ca8fcba8793a2b ssh/client.wasm
0c949f4996f9a89698e4b5c586de32249c3b69b7baadb64d220073cc04acba14 ssh/wasm_exec.js
b34fc888809e492cb22ed8e27fe9be45d7a4b1f8bf614b7a8b9957dc8fa40e2c assets/index-DpXzc8ki.js
362353c83ca36742290481a19b5165f770a97d2d9386383857fe7e9069df42f6 assets/index-CSQ9Rpbv.css
78b94231f09842ed9845b4c323fdcf35f0e67096ee92241424ac3347f434587b assets/ssh-worker-FM5arK7Q.js
6351b1874a13234ae899446f1a95c4cc9c392a1938c154d6a852c0f07728aaf1 index.html
f5fdffc871512222590fb7f7ad23de55cd831a95c10d111c925a39e2eea3c1a0 apps/server/native/monitoring_clock.node
4b58725bf6ddee8071fe73d03fc743140131b1204b6f01c84822f51303ca2875 apps/server/src/monitoring-clock.js
c7b6fbef97e0bebbbea59115d98ae3d638c0f8a1107cfe47bcffdde2625764de apps/server/src/monitoring-evidence-ledger.js
```

The separate subsequent browser queued-input fence is not in these artifacts and
needs fresh build/browser qualification. Do not assign this result to a rebuild.

## Eventual rollout and rollback

No database migration or native capability is added by this presentation change.
It consumes the existing continuation revision (migration016). Older clients
ignore the additive metadata; newer clients never interpret its absence as work
permission. Do not deploy ahead of the instructor-authorized drained rollout.
The coordinated C3 rollout remains separate and mandatory before claiming
retained buffers. Reverting this candidate restores generic paused messaging;
it must not restore old database snapshots, consume/revoke grants or change
deadline/access state. No rollout or rollback has been executed.
