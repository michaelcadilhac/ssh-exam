# Bounded monitoring image qualification

October22,2026; local only, not deployed. C1gc1 adds root `web monitoring image`
parity with web review; it is not whole-media export or OS-level IO isolation.
See monitoring-cli.md for the workflow/privacy/compatibility contract.

The missing-workflow decoder test is RED before implementation. Fifteen focused
shared-media/actual HTTP/compiled namespace-root CLI over TLS checks pass, including
restart/transient retries, private outputs, signed-but-mismatched targets/variants/
digests and capacity shared across web/root. Holding actual descriptor reads fills
the same16 slots while health remains responsive and SQLite is not held. Disabling
only the final signed-publication deletion fence makes its race test RED; removed.

Final full application suite:400 tests/75files,81.46s. Full native uncached
race/resource/namespace/compiler/default-size suite:core169.499s/CLI7.090s.
Static build/vet/typecheck and complete app/native-clock/WASM build pass. Native
image/help checks also pass ten race repeats; final native suite includes the
additional exclusive-output/link/refusal regression.

Frozen browser checks:all49 pass together,3.5m: admin-redesign, alert-management,
definition-management, monitoring-liveness, continuation-status and ssh-cleanup,
with EXAM_BROWSER_SSH=1. They exercise real synthetic gateway/WASM SSH where
applicable, not production/native C3 containment. All18 hashes below match before
and after; all nine documentation screenshot baselines stay unchanged. The rebuilt
WASM/JS differ from the earlier113-check artifact; those earlier results are not
silently assigned to this binary. Whole export needs its own later qualification.

```text
9c87892cf16ac8dec9a007f3e3a486b97fe9e2219ef62b7d2503a3f0ce29fc35  apps/server/src/agent-management.ts
481a3a1c989ca66c67c7f8f70a9fcc03d7589f0b21ba0e3935676379b6720a8d  apps/server/src/app.ts
4b760863989606e62f65dff282327742dfba489404735608613433b6a7c1a4a2  apps/server/src/monitoring-management.ts
f1c73627df24c0e1e096a299c0b20ad9db326c2c7719c046140ee1ab0214a9f2  apps/server/src/monitoring-media.ts
f5fdffc871512222590fb7f7ad23de55cd831a95c10d111c925a39e2eea3c1a0  dist/apps/server/native/monitoring_clock.node
4a3f76caa02a96d8732fadfa1837a9a3d1abb877e285490f01becc80d9b4b1cb  dist/apps/server/src/agent-management.js
4b58725bf6ddee8071fe73d03fc743140131b1204b6f01c84822f51303ca2875  dist/apps/server/src/monitoring-clock.js
c7b6fbef97e0bebbbea59115d98ae3d638c0f8a1107cfe47bcffdde2625764de  dist/apps/server/src/monitoring-evidence-ledger.js
369f7457e6883d5fec101bd1eb08f10601cec3895b8a712afe507bc694051161  dist/apps/server/src/monitoring-management.js
74ab2ea6f9691bc162299eb5cc043c473f4cf189b31afc94588960175a2e5a10  dist/apps/server/src/monitoring-media.js
0b960b87357e4c21b4fed59daca042018b06deeaef3ed683d4318a32697a3588  dist/web/assets/index-C4kMkl0M.js
362353c83ca36742290481a19b5165f770a97d2d9386383857fe7e9069df42f6  dist/web/assets/index-CSQ9Rpbv.css
78b94231f09842ed9845b4c323fdcf35f0e67096ee92241424ac3347f434587b  dist/web/assets/ssh-worker-FM5arK7Q.js
bee789fc082c3a07349b4c474423f904cbfb52073d579fee308b521acc2f7da2  dist/web/index.html
30a638ff43cfee6a9770bb5af3b05b930219f910b2c9f5fa1b5c98ddaba568cb  dist/web/ssh/client.wasm
0c949f4996f9a89698e4b5c586de32249c3b69b7baadb64d220073cc04acba14  dist/web/ssh/wasm_exec.js
39a0820b43d6ef0a329b0561244248be31d90d962ead68f77d58587580fe9fe0  packages/protocol/management.ts
42ee68cb12b4c66e0e5195690b692eabff5e56e89ca84cca2df3b70d77a87a9e  packages/protocol/monitoring-management.ts
```

No schema, credential, clock, deadline, account-hold, protected-submission or
retention policy is changed. A future paired gateway/CLI release would explicitly
authorize monitoring.image; old versions refuse. No Docker image build is claimed:
the installed client still has no local daemon socket. Deployment/migration/
rollback and temporary-agent consolidation remain proposals, not executed steps.

