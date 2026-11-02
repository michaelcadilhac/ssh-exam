# Recording storage and deployment efficiency

November1,2026. Runtime5163b20/schema37, matchedCLI and maintenance responses
are now deployed and online. Admissions reopened19:26:40 Chicago; conversion
released19:27:52 and processes historical recordings in the background. Native
services, authority/history and original policy are preserved. The full matched
rollout used an explicit fresh recovery pair plus verified existing media archive,
copying0media bytes. It exceeded the two-minute target; measured causes/fixes,
acceptance and compatible recovery: [deployment record](recording-storage-deployment.md).
The local benchmarks and original staged plan below retain their qualification context.

## Completed production cleanup

Four redundant full archives were compacted on marco. Their recorded SHA256
digests were checked; each replacement was read back, verified and fsynced before
the predecessor was removed. All153,627 monitoring files in each older archive
were byte-identical to members of the retained newest full backup. Older database
and configuration bytes remain in `configuration-and-unique-data.tar`, with a
private `compaction.json` identifying the retained media dependency. Old image
archives and database snapshots remain available.

Reclaimed54,138,255,360bytes (54.1GB decimal). Recognized release backups now use
15.84GB instead of69.98GB; the filesystem reports70.25GB free. The newest full
archive remains `/data/ssh-exam-backup-admin-editor-20261101-gj4gw2sy/`:
13,586,176,000bytes, SHA256
`16f222aa9f7c7408be4a06352910d473b21d2e7820ad8dc44503653cf9a40c6b`.
An independent post-cleanup read reverified all four reduced archives and web
readiness. Live records, recordings, services and configuration were untouched.

Executed compactor SHA256 is recorded in `cleanup-operation.json`; subsequent
local hardening verifies already-completed replacements on retry and uses explicit
refusals rather than optimization-sensitive assertions. Seven synthetic CLI/fault
tests pass. Production receipts:
`var/collection-tests/storage-release-efficiency.vu8pc_7d/cleanup-completion.json`.

## Local incremental backup workflow

`scripts/backup` now stores one immutable copy of each monitoring payload in a
private shared store. Completed snapshots contain ordinary files linked to that
store, never to live files. Changed source bytes create a new object; older
snapshots remain exact. Database snapshots use SQLite's backup API, including
committed WAL data, with explicit connection closure and a bounded backup wait.
Receipts and protected submissions retain their existing independent treatment.

Online `--warm-media DATA --shared-store STORE` prepares only monitoring objects;
it opens no database and claims no complete snapshot. The stopped snapshot's
`--require-warmed` refuses inside the store lock if any media would need copying,
including when a concurrent unused-object prune invalidates preparation. New bytes
are hashed; reused objects are checked against their recorded identities. Full
`--verify-backup SNAPSHOT` hashes every file outside the normal cutover window.
Snapshots publish atomically after durable file/directory writes. Partial work
does not become a completed backup.

`scripts/restore` fully verifies new-format snapshots before copying, detaches all
hard links, then applies the latest deletion ledger and existing locked-history
rules. `--prune-unused-objects STORE` previews reclamation after obsolete snapshots
are removed; `--apply-prune` only deletes objects with no snapshot links. An
interrupted prune's stale cache is safely rebuilt from live bytes on normal retry;
fast cutovers refuse it until media is warmed again. Fourteen actual synthetic CLI
tests cover these workflows, corruption, symlinks, publication, WAL, deletion and
retry, including schema37 video deletion and exclusion of only the codec's reserved
per-attempt scratch copies. Unknown directories and saved video clips are preserved;
a matching scratch name never exempts a symlink. Installer pause markers are not
data snapshots. The existing60-day monitoring retention is unchanged; snapshot retention
and deletion-ledger procedures still apply.

The first69,120-file sizing run exposed unnecessary fsync of duplicate temporary
copies and hit its300-second bound. Only newly published objects now require that
sync. The corrected run used16 synthetic students,69,120paths/283MB logical bytes
and64 distinct authored payloads, plus a50MiB SQLite database. `--require-warmed`
snapshots took6.609/9.311seconds, with0 new media objects and0 media bytes copied. This measures
metadata/hard-link cost, not production timing or a recording compression ratio.
The final source-bound receipt is `backup-sizing-qualified.json` in the cleanup/test
evidence directory, including the codec scratch exclusion.

## Recording choice

The locally implemented producer profile is1280-pixel screen long edge and320-pixel
webcam long edge, JPEG quality0.50, every5seconds. This is an activity-level visual
record; precise terminal text remains available in terminal replay. Focused real
browser/HTTP checks preserve original upload hashes, timing, retries and legacy
2560-pixel image reads. Representative90-minute screen/camera images and existing
thumbnails project to96.5MiB; a random-color screen stress case projects to233MiB.
These are image measurements, not a hard quota for terminal logs or submissions.
The unchanged terminal-recording limit remains separately configured.

JPEG, WebP, AVIF, H264, VP9 and bounded AV1 results and limitations are in
[recording-storage-evaluation.md](recording-storage-evaluation.md). The selected
1280px VP9 screen plus320px camera videos measured12–16MiB for1080 samples over
90minutes, before thumbnails. Keeping every existing thumbnail adds about16MiB;
the implemented video reader therefore derives thumbnails on demand. The instructor
approved this lossy representation explicitly. Production conversion now runs under that approved policy; the original
pre-deployment measurements did not transcode any real student recording.

## Completed-recording conversion and review

The local gateway automatically queues retained, started, completed attempts after
the existing final-capture grace interval. It groups at most12 same-source,
same-dimension captures per VP9 segment. One separately bounded encoder and two
read slots are shared across coordinators through inherited file locks. The worker
validates original capture bytes, probes the output and decodes every frame before
replying. It owns no SQLite connection, original deletion or exam authority.

Schema37 adds segment/frame mappings, conversion jobs and exact request intents;
the original frame rows, hashes, dimensions, capture times and attempt history
remain unchanged. The coordinator publishes and syncs the clip, commits the
mapping, rechecks it, then awaits a separate worker's WAL→database→directory sync
before removing redundant JPEGs/thumbnails. SQLite WAL/NORMAL commit alone is
insufficient: see [SQLite synchronization](https://www.sqlite.org/pragma.html#pragma_synchronous)
and [WAL behavior](https://www.sqlite.org/wal.html). Sync descriptors are opened and
closed in the child PID to preserve the HTTP process's SQLite locks.

Review, individual-image reads and private export return ordinary JPEGs with an
explicit provenance object: original capture digest/dimensions, segment identity/
digest, frame index and decoded RGB24 hash. The returned JPEG hash identifies its
actual bytes. Nothing asserts that lossy reconstructed pixels or JPEG bytes match
the original upload. Capture timestamps, sequence and exact terminal replay remain.
Export decodes a segment once and uses bounded request-local buffers; no permanent
thumbnail library or extra export archive is created on the server.

The website's recording controls and `examctl web monitoring optimize`,
`optimize-retry`, `optimize-cancel` use the same durable intent helper; fresh
`monitoring show` reports current progress. CLI mutation needs explicit
`monitoring.optimize` authorization and a fresh gateway capability check. Pause
preserves verified segments; retry starts no clock and changes no account hold.
Retention tombstones fence all readers, queued work and cached export images;
isolated purge and offline restore both remove video mappings/files consistently.
See [monitoring CLI](monitoring-cli.md).

Crash/restart, canceled/stale replies, metadata or disk-sync failure, corrupt clips,
late final captures and orphan copied scratch all have refusal/repair coverage.
Originals remain until the replacement is durably verifiable. Technical failures
are conversion retry states, never student violations. Actual authenticated HTTP
tests hold the durability barrier and kill the codec while a separate synthetic
student continues uploading; health/capture stay responsive and both attempts'
deadlines, holds and notification state remain unchanged. Worker-only checks are
separate from this real gateway/CLI evidence.

## Local verification evidence

Focused suites pass:13 isolated codec/sync checks;13 queue/purge checks;32
consumer checks; actual compiled, root-mapped CLI→signed Node/TLS optimization,
export and reviewed deletion; affected CLI races/build/vet;14 backup/restore and7
archive-compaction checks. These cohorts overlap broader tests; do not sum them
into a larger unique total. The real HTTP crash/held-sync cases use a healthy
synthetic peer and verify unchanged authority, rather than treating a private
codec helper as the delivered workflow.

The final application run passed740 tests, with one stale schema-version oracle
and three existing opt-in skips. The oracle expected only migration36 after an old
fixture; the actual database correctly added37. Its explicit expected37 ledger row
and a test-only TypeScript annotation were corrected, then the full affected
migration/isolation cohort passed17 checks and global typecheck passed. All other
history comparisons remain exact. No production source correction was necessary;
no entirely-green full repeat is claimed after those test-only corrections.
The skipped monitoring root-CLI export case passes separately through the actual
Node/TLS/Go workflow; unrelated general root-management and bwrap-grading opt-ins
were not rerun. Full production build passes.

All46 selected browser cases pass against fresh assets with the public fixture
confirming real browser SSH/WASM mode. Canvas streams and failure-injection/admin
responses are synthetic where documented; this is not new live MFA/media or
privileged execution-host acceptance. Review/storage fits320px. Real isolated
nginx/TLS checks cover four configurations and24 Chromium renders; the final
fast-installer22-case harness uses actual SQLite/warm/snapshot/renderer paths but
explicitly mocks privileged service/Docker/native/drain transport. Its0.104s
cutover is not a production measurement.

Detailed source-bound receipts: `monitoring-video-export.Z025gQ/final-qualification.json`,
`monitoring-compaction-cli._fbt3403/completion.json`,
`nginx-maintenance.h6ahgg2n/completion.json`, and the root focused/sizing receipts
under `storage-release-efficiency.vu8pc_7d`, all beneath `var/collection-tests/`.
The unchanged execution protocol/enforcement retains its earlier native/kernel
qualification; no new privileged csc-sys run or capacity claim is inferred.

The actual FFmpeg-enabled image is
`ssh-exam-release:monitoring-video-cd96735a7ebb`, exported Config
`sha256:3e3ba8059ebbed6a90695655f09330a4e9d053d07fd84ebdff4b728ef828f0db`.
Its295,857,664-byte code-only archive has SHA256
`2f880e701c3f8ada3538b435cda2a2ae8fac1ad3c865caf198b3dc2a574fe381`;
the source engine's OCI ID is separately bound through Config and rootfs IDs.
Actual UID10001/read-only/no-network/512MiB startup checks cover schema37 restart
and36/35/24/11→37 migration, preserving old rows/rowids, settings, schema history,
protected work and the native boot clock. A previously encoded authored VP9 clip
must decode with its three recorded RGB24 hashes, default/thumbnail and batch
reads, provenance and cached/orphan deletion fences; there is no original-JPEG
fallback. Active non-WASM assets match the browser-qualified build; packaged
WASM retains the prior pinned compiler release with unchanged client sources.

One parallel smoke initially refused before startup because the test helper
reused a table-loop variable as its container name. Ownership labels prevented
cross-cleanup. Only the helper's container identity was corrected; affected and
parallel fixture runs were repeated, with original failure retained. No image,
application or preservation oracle changed. Exact source/image/fixture/cleanup
receipts are under `var/collection-tests/monitoring-video-release.k9whg_g9/`.

## Deployment and recovery policy — executed rollout recorded separately

This runtime change needs the full matched-release procedure, not the new UI-only
fast path: qualify the exact FFmpeg-enabled web image, schema36→37 migration,
archival clip decoder compatibility, both JPEG/video review and the matched CLI.
Retain a private current database/configuration snapshot, the shared immutable
media recovery set and a compatible image. Fence admissions and positively verify
web/native drain before any web stop; busy/uncertain means defer. Migration37 is
additive and rewrites no attempt/grant/deadline/hold. Deliberately add only the
required management operation to the existing class-agent allowlist.

Use the installer-owned background pause before warming/snapshotting, verify all
authority tables/history and exact public assets/readiness, then reopen and release
only that owned pause. The independently qualified maintenance configuration gives
clear503 website/API responses during the outage. Native execution agent,
watchdog, relay and saved-work worker need no restart for this release. The previous
temporary-agent consolidation is already deployed; preserve that state and keep
obsolete temporary units absent rather than repeating consolidation.

After original JPEG cleanup, the deployed JPEG-only b70a080 image cannot read the
new video evidence. Rollback must use a qualified video-capable compatible reader
and CURRENT database; prefer pausing conversion and forward repair. Never restore
an old database that discards new attempts, requests or deletion records. Keep the
retained legacy full backup until the new-format recovery set is independently
verified and a separate retention decision authorizes its removal.
For this first video release, recovery therefore uses the retained qualified
video image plus forward repair, rather than automatic fallback to b70a080.
Later UI-only releases can retain this compatible schema37 image for rollback.

For later same-schema UI changes, use [the fast UI runbook](fast-web-ui-deployment.md):
preload images and media online, then take only the database/small-file snapshot
while stopped. The target is under three minutes without relaxing any guard.
Current local storage timings and synthetic mocked orchestration support that
budget; production cutover time has not been measured with these new tools.

## Milestones and acceptance

1. **Remove redundant production backup payloads — complete in production.** Keep the newest verified full
   recovery archive. Compact older full archives only after checking their recorded
   digests; preserve old database/configuration snapshots and every file whose
   bytes are absent from the retained archive. Verify and durably save each
   replacement before removing its full predecessor. Exercise refusal, preservation
   and retry with synthetic archives, then report actual reclaimed space. Never
   modify live recordings, submissions, records or services.
2. **Reduce new recording storage — complete/tested locally.** Benchmark representative synthetic terminal
   and webcam captures using lower-resolution JPEG, WebP/AVIF and available temporal
   encodings. Preserve challenged monitoring cadence, capture timestamps, audit
   provenance, old recordings, review/export and purge. A 90-minute representative
   attempt must fit well below a few hundred MB; report measured image/terminal
   budgets and codec/readability tradeoffs. Qualify the actual capture-to-review
   workflow, failure isolation and old/new compatibility.
3. **Make backups incremental and UI deployments short — complete/tested locally.** Separate shared media
   backup from each release's database/configuration snapshot. Repeated snapshots
   must not copy unchanged media. Verify restoration and interrupted/corrupt
   snapshot refusal. Prebuild/prequalify assets; measure the guarded local UI
   cutover with a target below three minutes, without relaxing admission or
   historical-record preservation.
4. **Serve maintenance responses — complete/tested locally.** Provide a small readable website page and
   retryable API response while admission is fenced or the web upstream is
   unavailable. Qualify healthy/fenced/down cases with actual nginx and desktop/
   mobile browser checks. Preserve healthy finish/status/agent paths and unrelated
   sites; never hide a failed operation as success.

Existing uncommitted documentation screenshots are preserved. This work changes no
attempt allowance, deadline, account hold, evidence-retention duration or student
record. Historical deployment evidence remains in admin-editor-deployment.md.
