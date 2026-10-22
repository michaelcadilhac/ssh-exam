# Complete private monitoring export: local qualification

October22,2026. C1gc2 implemented/tested locally, not deployed. See monitoring-cli.md
for supported operator workflow, privacy, exact observation boundaries and retry.
This does not enable retained SSH, automatic recovery, grants or protected archive
transfer, and is not an OS/hardware storage-failure sandbox.

The actual compiled root-mapped CLI uses streaming TLS to the real application,
not a buffered mock reply. It copies multi-chunk raw terminal prefixes including
malformed binary tails, original/derived images, metadata/history and hash manifest.
Exact-request retry uses a NEW destination. Existing/racing destinations survive;
bad signed scope/file/digest, socket truncation and trailing data return exit1,
empty stdout and retained private INCOMPLETE output, never successful publication.
Output directories0700/files0600, clean EOF, checked sync and no-replace rename
are tested. Unit fault checkpoints cover payload/metadata/manifest/parent sync.
Late publication/durability failure can leave a final directory with UNCONFIRMED
status; an existing manifest alone is not a successful CLI receipt.

HTTP/descriptor tests cover original inventory retry watermarks, append exclusion,
observed prefix overwrite/truncation, oversized history refusal without truncation,
deleted/scoped identities, late tombstones before private/final signing, links,
hardlinks and real FIFOs. Actual socket abort retains the export owner until
descriptor cleanup. Uncertain close poisons the bounded slot and returns failure.
A deliberately ignored image-close-error mutant makes the HTTP regression RED;
restored before qualification. No mutant remains. Sensitive bytes/paths/errors
are absent from durable request receipts and safe failure packets.

Held export IO leaves an actual authenticated SSH pane and its existing transport,
signed renewal, new pane admission, HTTP screen/webcam uploads and health responsive
in the synthetic fixture. This is real SSH transport with simulated native shell/
policy, not privileged C3 freeze qualification. Scope/authority/clock/protected-byte
checks remain unchanged. Shared image-reader capacity is bounded at16, with one
actual export/cleanup owner. Fresh read authorization can be revoked independently.

Final complete application suite:414 checks/79files,85.99s, with actual root-mapped
CLI integration enabled. Focused expanded HTTP/TLS checks and five repeated native
export races pass. Full uncached native race/resource/namespace/compiler/default-size
suite passes core173.882s/CLI6.637s; static build/vet/typecheck and full native-clock/
WASM/web build pass. Formatting and git diff whitespace checks pass.

All113 combined browser checks pass together,12.8m, with EXAM_BROWSER_SSH=1:
admin/alerts/definitions/review, seven timezones, actual browser/WASM SSH,
isolation/cleanup/closure, template catalog, monitoring liveness, continuation
presentation, transitions and network-recovery faults. All140 source/runtime file
hashes match before/after. No web/runtime edit or rebuild occurs during that run;
nine generated documentation screenshots are restored to their verified clean
pre-run baseline. Key exact hashes:

```text
13bd0cd06fda837029a715204e392b1506b5934376dfdbd2383fea919e5b9348  apps/server/src/agent-management.ts
f6b2873f569715a34f6a39359468307ad5e18890138a5a5ba6574af4305c15d4  apps/server/src/agent.ts
481a3a1c989ca66c67c7f8f70a9fcc03d7589f0b21ba0e3935676379b6720a8d  apps/server/src/app.ts
21396c82494e24fdb149a13568972c9e81e740f34cbbf0df9ce11e2ca5d02068  apps/server/src/monitoring-export.ts
22333f918d63e5272159fc8413d99cccf13c01bd4cfd23b8510599c1bd68295f  apps/server/src/monitoring-management.ts
37995d2321dbe0a591eb31b469ace0a155d6130d9b9fa9b09a4b4bc4fdd6d62e  apps/server/src/monitoring-media.ts
f5fdffc871512222590fb7f7ad23de55cd831a95c10d111c925a39e2eea3c1a0  dist/apps/server/native/monitoring_clock.node
fa357062ae8eeb160115dfb5639692431a01d9afa5a18234587a4920be6c05ac  dist/apps/server/src/monitoring-export.js
c1559f5424ae1c9d1a18cf1acc23372d784d0cb03ce9c8101e196ba4d64e3c98  dist/apps/server/src/agent-management.js
0d545896ba6df5ef2d46466dbdec565f22069900f67e0b0cdb84985274ae2499  dist/apps/server/src/monitoring-media.js
bedbc7a7feb9f2b548af60de1b2101654d7b6bf8c7cd5cfd95ae805c98175ca4  dist/web/index.html
6da778d6c2b5b38e602d36655abac16c9c469b7d56acc4096bdc5430dec52da3  dist/web/assets/index-B-Xe19Kx.js
362353c83ca36742290481a19b5165f770a97d2d9386383857fe7e9069df42f6  dist/web/assets/index-CSQ9Rpbv.css
78b94231f09842ed9845b4c323fdcf35f0e67096ee92241424ac3347f434587b  dist/web/assets/ssh-worker-FM5arK7Q.js
2ec9b917f5f2ccb27b1e59fc65f59e822f9bd893e1c0ca745409033eeae1d385  dist/web/ssh/client.wasm
0c949f4996f9a89698e4b5c586de32249c3b69b7baadb64d220073cc04acba14  dist/web/ssh/wasm_exec.js
f77f584886bde8820838de434a0efdd3ee5eec3a51109182a6e2adcfcbd35135  packages/protocol/management.ts
070089ca2e6fa5496779eb5d13c8bdab3e51538fc0d06ce52b3245c0724bd64d  packages/protocol/monitoring-management.ts
d712173d17bc8ff0159747a5cb3eebe5c8a53da469b6c806547e19e3b72b8a93  packages/protocol/monitoring-export.ts
```

The previous image-only49-browser artifact is not silently assigned to this build;
the rebuilt WASM/JS above receive the fresh113-check run. No Docker image build is
claimed: the installed client has no local daemon socket. Deployment/migration/
rollback and temporary-agent consolidation remain proposals in todo-rollout-plan.md.
No production binary, service, configuration, student record or exam is changed.
