# Gateway evidence clock and unknown-focus gaps

October22 local candidate, **not deployed or a live monitoring issuer**. The
private coverage ledger uses a checked Linux boot-elapsed reader instead of
performance.now. No existing attempt/deadline, callback, lease, account policy or
recovery mode is changed. Native all-writer/C3 coordination remains outstanding.

## Clock source and packaging

The tiny C Node-API addon calls CLOCK_BOOTTIME: unlike Linux CLOCK_MONOTONIC it
includes suspend ([Linux clock API](https://man7.org/linux/man-pages/man2/clock_gettime.2.html)).
It reads time only, never sets time, handles browser input, opens files or selects
a clock from configuration. Checked integer arithmetic rejects negative values,
invalid nanoseconds and values beyond exact JavaScript integers; output is
integer milliseconds. No wall time, performance/hrtime, coarse uptime, invented
zero or permissive fallback is used. Node-API8 uses the stable C interface rather
than private Node/V8/libuv APIs
([pinned Node documentation](https://raw.githubusercontent.com/nodejs/node/v26.12.0/doc/api/n-api.md)).

`npm run build:clock` compiles with GCC and Node-API development headers, producing
ignored native artifacts beside the source and in dist/apps/server/native. Build,
pretest and local predev invoke it; production Docker compiles its own binary
inside the pinned Linux Node build stage, never copies a host-compiled addon.
Use the Linux server/container build on other hosts. Runtime requires no compiler
or new privilege. Atomic replacement avoids truncating a mapped addon; do not
rebuild frozen artifacts during qualification.

The TypeScript reader validates the native API kind and every result, suppresses
private loader/syscall errors and returns typed unavailability without authorizing
anything. The ledger converts failed reads to technical clock uncertainty, not
a policy finding. Existing evidence freshness15s and focus grace20s are unchanged;
integer millisecond quantization is explicit. A later good reading must charge
the whole elapsed interval and cannot reconstruct a missing coverage identity.
No current route/signer/lease/thaw uses this ledger; addon presence alone is not
a native capability or readiness signoff.

## Confirmed candidate focus-classification bug

A RED regression started with complete monitoring and a reported blur, then
advanced past both the15s observation window and20s focus grace without further
observations. The old ledger labeled this policy-blocked even though monitoring
had become unknown before the focus grace elapsed. Time alone did not establish
continuous blur. This is a development-candidate defect, not a proven production
cause or an actual host-suspend test.

The candidate now distinguishes unverified focus history. It leaves work blocked
as a technical gap and does not restart an unfocused grace period. Fresh focused
policy plus complete challenged frames can establish a NEW coverage identity,
never repair the old interval; native matching of retained coverage still rejects
it, so no automatic recovery is granted. Genuine fullscreen/capture/keyboard loss
remains sticky. With continuously fresh monitoring, repeated blur still cannot
reset the20s cutoff. No monitoring enforcement or recovery approval is weakened.

## Qualification and remaining gates

Initial focused checks pass28 tests, including actual native reads, independent
coarse proc observation (test only), Node restart, invalid/native-loader errors,
exact C arithmetic under UBSan, the default ledger, signed compiled-Go
interoperability and stale-blur classification. A raw-error-path mutant fails the
typed clock regression; it is removed. No host clock or suspend was modified.
Full application/build/browser qualification passes:389 tests/72files (79.72s),
typecheck, complete build/packaged native load and all91 browser checks (11.4m).
Native race/resource/namespace/compiler/default-size compatibility also passes
(core172.99s/CLI7.29s). No actual-suspend/cross-host recovery is claimed.

Nine built artifact hashes were identical before/after the frozen browser run:

```text
8f46f8bc2a99ac72bc033cdeb8bbc8d93d98650d736f009bc049bbe10e6afa79 web/ssh/client.wasm
0c949f4996f9a89698e4b5c586de32249c3b69b7baadb64d220073cc04acba14 web/ssh/wasm_exec.js
63e205e5b24038468520fa881658fea4b43fa06427795deba945d7db3e7bbf61 web/assets/index-CA-WsKBw.js
844d847ae1159366c2ba3c704226d3febf4c85ca32627eec927b8355e7e6880b web/assets/index-D7Mlutge.css
78b94231f09842ed9845b4c323fdcf35f0e67096ee92241424ac3347f434587b web/assets/ssh-worker-FM5arK7Q.js
f2d6a059ec50a65532c2f945100cfb2aa0955461f5375ce6473e09506e01d513 web/index.html
f5fdffc871512222590fb7f7ad23de55cd831a95c10d111c925a39e2eea3c1a0 apps/server/native/monitoring_clock.node
4b58725bf6ddee8071fe73d03fc743140131b1204b6f01c84822f51303ca2875 apps/server/src/monitoring-clock.js
c7b6fbef97e0bebbbea59115d98ae3d638c0f8a1107cfe47bcffdde2625764de apps/server/src/monitoring-evidence-ledger.js
```

Paths are relative to dist. The rebuilt WASM differs from H4a because Go embeds
repository revision/dirty metadata even for unrelated server changes; unchanged
JS filenames alone are not qualification. This fresh run qualifies the exact
new binary above. Generated screenshots are restored to their verified clean
pre-run baseline, not an intentional UI change.

Container build is currently unverified: the Docker client is installed and its
only configured context is the local unix:///var/run/docker.sock, but that socket
does not exist. No remote context, daemon/service start or production host is used
as a substitute. Continue independent local qualification; report this packaging
gate until a local engine is available. Nothing is deployed or consolidated.
