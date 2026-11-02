# Recording storage release — deployed and online

November1,2026 Chicago. The instructor explicitly authorized Push and deploy.
Runtime source5163b2045c78309d32453ea06e60d5ff2811baa0 is pushed and online
with additive schema37 and the matched class-server CLI. Admissions reopened at
19:26:40 Chicago (November2 01:26:40UTC); conversion was released at19:27:52.
No active exam was interrupted. Native services/configuration were preserved.

## Artifact and scope

Web image `ssh-exam-release:monitoring-video-cd96735a7ebb`, exported Config
`sha256:3e3ba8059ebbed6a90695655f09330a4e9d053d07fd84ebdff4b728ef828f0db`;
archive295,857,664bytes SHA256
`2f880e701c3f8ada3538b435cda2a2ae8fac1ad3c865caf198b3dc2a574fe381`.
All11 rootfs layers, all178 image source files and six active assets were verified.
The captured build head26e60cb and final release5163b20 have identical image
inputs; they are recorded independently, not falsely assigned identical Git heads.
The packaged WASM remains the earlier qualified pinned-compiler binary.

Installed examctl SHA256
`a6aaa2fee0b7adb5af8e54b1fa1eec36404c7ca76eb1d9ed5f7b4b4cb6f78742`.
Its dynamic loader and local help passed on csc-sys BEFORE atomic installation.
Prior CLI/config/state backup: `/var/backups/ssh-exam/recording-storage-cli-vap61hr8`.
The loaded source worker remains348d7567…; agent4007876, watchdog210730,
source-worker2256672 and relay893011 stayed running. All175 native histories,
configuration hashes and the existing consolidated service layout were preserved.
No temporary agent-service consolidation was repeated.

The only web configuration addition is explicit `monitoring.optimize` in the
existing agent management allowlist. Configuration ownership10001:10001/mode0400
was preserved. Only EXAM_IMAGE changes in the environment. The new generated nginx
normal site remains installed, providing readable503/Retry-After60 responses on
future gateway failures; main nginx configuration and unrelated sites are preserved.
Normal site SHA256 c02c148fdc0d811dcf5ddb690968ac8d45f6716873f99dcb6ca0bc3d8ce09793.

## Recovery set without another full recording copy

The first online shared-store warm was a poor preparation choice: about64objects/s
implied roughly40minutes to recopy recordings already backed up. Only that exact
owned process4149168 was interrupted via PIDFD SIGINT; its child and temporary
copy cleanup were verified. After final recovery verification,32972 unreferenced
duplicate objects /2,920,210,374bytes were removed through the supported prune CLI.
No live file, referenced snapshot object or retained archive was deleted.

The cutover instead uses an explicit **recovery pair**, not a fake completed
shared-store snapshot:

- Fresh stopped snapshot: `/data/ssh-exam-recording-update-20261101-en39vh5c/snapshot`.
  It contains a53,436,416-byte consistent database plus current receipts,
  submissions and small installation/configuration files;111 hashed members.
- Mandatory immutable media dependency:
  `/data/ssh-exam-backup-admin-editor-20261101-gj4gw2sy/web-data-config-before.tar`,
 13,586,176,000bytes, SHA256
 `16f222aa9f7c7408be4a06352910d473b21d2e7820ad8dc44503653cf9a40c6b`.

The archive was rehashed on marco in45.758seconds. One indexed header pass proved
all153627 monitoring members, exact nanosecond PAX ctime/mtime, type/size/owner/mode
and full membership. Current76642frame/281recording/110attempt rows and rowids
matched the baseline. Coverage was rechecked after the positive drain, before
snapshot and verification. The actual stopped snapshot copied **zero media bytes**.
Keep this archive: older compacted backups also depend on it. Do not remove or
rename it without replacing and verifying every dependency.

Recovery is manual and host-private. Verify the pair manifest and mandatory
archive digest. Assemble ONLY the baseline monitoring subtree plus the pair's
fresh metadata.sqlite/receipts/submissions into a NEW private data directory;
never overwrite fresh files with the tar's old database/configuration. Apply the
recorded private modes/runtime UID10001, then use existing scripts/restore with
the LATEST durable deletion ledger, and doctor/reconcile current class-server
state before reopening. The detailed recipe is in snapshot.json. Never restore
this historical database over newer live attempts, clocks, holds or deletions.
After JPEG removal, a JPEG-only b70a080 reader is unsuitable. Retain a qualified
video-capable image and CURRENT data; use compatible forward repair.

## Preservation, acceptance and timing

Fresh web/native guards found zero sessions, active exams, unresolved holds,
future started deadlines, pending transitions or workload owners before stop.
The instructor signed out normally; no session/record was cleared to pass guards.
Private037 rehearsal changed only four empty video tables/indexes and version37.
Strict running proof preserved all41 nonvolatile authority tables, original
attempt/grant rowids, prior audit and prior management request history. Fresh
signed native readiness and notification configuration passed. Conversion stayed
paused under an exact owned marker until public acceptance.

Two deployment-helper mistakes extended maintenance. The old nonce oracle
incorrectly required removals to expire before activation. Six old nonces
expired normally during startup; the corrected proof requires each removal to
be justified by a fully audited empty source-next poll's actual captured
request.created cutoff, preserving currently live nonces and all other checks.
Ten actual-schema regressions and seven controller cases pass. Separately,
nginx reload is asynchronous: an immediate public probe hit an old fenced worker.
A five-second retry permits only503/Retry-After60 while exact normal configuration
remains installed; every digest/other-status/identity failure remains definitive.
Five regressions cover it. The permanent tracked workflow suite passes27 cases.
No application/native enforcement was weakened or changed for these repairs.

The recorded fence/cutover interval including those repairs was560.739seconds
(9m21s), exceeding the instructor's two-minute expectation. Preparation also took
too long because the exact full migration driver and real cold-store cost had not
been settled before announcing local completion. These are process defects, not
a successful two-minute deployment claim. Future release readiness includes
actual migration/guard/reload rehearsal and measured recovery preparation before
cutover. Routine UI-only updates use the separate fast runbook; a cold data copy
must not be silently counted as a short deployment or rediscover a proven backup.

Actual public TLS/assets and four desktop/mobile student/instructor focus checks
pass with no sign-in submission, page errors or media capture. Both desktop and
mobile maintenance pages and retryable API503 JSON passed while fenced. One signed
monitoring.show of the EXISTING controlled synthetic attempt confirmed the new
capability and paused state after reopening; no real student's media was viewed,
no attempt/grant created, and no clock/hold changed. This is not new SSH/MFA/live
camera acceptance; unchanged enforcement retains its earlier qualification.

The owned pause was removed last. First production progress:48 verified segments,
563captures,42,961,555source bytes represented by3,971,250video bytes; health stayed
ready. Historical conversion continues in the background; the backlog is not
claimed finished. Old capture hashes/times and exact terminal replay remain;
lossy derivatives have separate verified provenance. Runtime deadlines, webcam
requirements, protected submissions and historical attempt policy are unchanged.

Evidence: `var/collection-tests/recording-storage-rollout.en39vh5c/completion.json`.
Private web stage: `/var/tmp/ssh-exam-recording-web-20261101-en39vh5c`;
class stage: `/var/tmp/ssh-exam-recording-class-20261101-en39vh5c`.
The full matched controller/adapters and original failed receipts remain there;
this first migration did not use the same-schema UI-only installer. No extra
restart is needed for the permanent operator-script fixes installed afterward.
