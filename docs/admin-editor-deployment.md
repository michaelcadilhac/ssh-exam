# Admin editor release — deployed and online

November 1, 2026. The instructor explicitly authorized **Push and deploy**.
Source `b70a080ece03ea7f120f4dede9e95048f557b30b` is pushed and the matched
release image is installed. Strict preservation, native guards and public checks
pass. Original nginx bytes are restored and admissions are open, verified at
18:16:09 UTC. No live exam was interrupted.

## Scope and qualified artifact

This web-only release simplifies the personal attempt editor, shows saved values
before editing, keeps exact starting-file selections, removes unnecessary Reason
fields, replaces Refresh text with accessible arrow buttons, and fixes narrow
form layouts. The implementation and interface qualification are recorded in
[attempt-editor-simplification.md](attempt-editor-simplification.md).

The release leaves schema36, exam permissions, saved settings, original deadlines,
protected submissions, account restrictions and monitoring policy unchanged.
Neither `examctl` nor the class-server services are installed or restarted.

- Web tag: `ssh-exam-release:admin-editor-b70a080`.
- Exported image Config:
  `sha256:bffbfe1f1bfca3abc8eae6a8d34c9c708400fe370e2acfec87a506ff1bdb4533`.
- Source-engine OCI ID:
  `sha256:952040376468c6c054c154aa3aeff9231473d86ed6a984f7f160b39e1546cfb3`.
  Config and every uncompressed rootfs diff ID are checked independently.
- Image archive: 117,072,384 bytes; SHA256
  `2b31b51aef801824cc2055fee3b4d84c2ec09bc2d24d1de0a01f6269b722a6d7`.
- Prior production image: `ssh-exam-release:single-unused-f0c7e10`, Config
  `sha256:1caf63de6f9f8519f92956abfdb8ebfa04bbfa0bcf09f46506d32ff076a87bd6`.

All five non-WASM assets match the current browser-qualified bytes exactly:

| Packaged file | SHA256 |
| --- | --- |
| `index.html` | `379d92dfccfcc4f8d403aa8922d034d378e85e37476b05d8dfb32859277738d2` |
| `assets/index-C3jymdfM.js` | `a54be4043d5e4bf70732569b6317aa1708104a7dc1ff925f3118ed7dd31e88e9` |
| `assets/index-C5fVdo_w.css` | `64114d6b72239dfd632e948238f10423372c345ce8b7a65003ac3c442d7520cd` |
| `assets/ssh-worker-FM5arK7Q.js` | `78b94231f09842ed9845b4c323fdcf35f0e67096ee92241424ac3347f434587b` |
| `ssh/wasm_exec.js` | `0c949f4996f9a89698e4b5c586de32249c3b69b7baadb64d220073cc04acba14` |

Packaged `ssh/client.wasm` is
`49946ceb668225b40238e53208f81e14dbf7d1c7d3e95a56ad3106e490284dfb`,
the exact previously qualified release binary. Its source and pinned Docker
Go1.27.2 toolchain are unchanged. The development host's browser-qualified WASM
is `6d255449603be2e72e09f78d3a075c5fdbe772a62fa7188d0ac58537b8197d25`:
Go1.27.3 and embedded Git build metadata explain the recorded build difference;
the two binaries are not described as identical.

The release-image smoke check starts from populated schema36, verifies the same
schema-version rows, historical attempt and enrollment settings, checks that no
permissions were invented, checks the native boot clock, and serves the exact packaged assets
as UID10001. The existing container qualification helper's schema36 support was
verified separately; this is test tooling, not a database migration.

## Guards and execution status

Fresh read-only guards at 17:57:13 UTC found 110 web attempts and 175 native histories.
There were no unfinished exams, future deadlines, unresolved account restrictions,
active web sessions, pending reviews, clock requests or Begin operations. The
instructor signed out normally; records and session limits were not cleared to
pass the guard. The native agent4007876, watchdog210730, saved-work worker2256672
and relay893011 retain their pinned PIDs, configurations and loaded binaries.

Installed `examctl` remains `b9d061eb…`; the worker retains loaded binary
`348d7567…`. These independent identities are guarded without replacing either.

| Stage | Evidence and status |
| --- | --- |
| Source push and local image qualification | Complete; `image-qualification.json` |
| Code-only private staging | Complete; 16 files /117,122,078 bytes, all hashes verified; `web-stage.json` |
| Host image load and Config/rootfs verification | Complete; `marco-load-qualified-image.stdout`; no services changed |
| Fresh guards, admission fence and relevant nginx-worker drain | Complete; web guard at18:04:03UTC, native guard at18:04:25UTC; `marco-fence-admissions.stdout` |
| Complete private web/data/config/old-image backup | Verified at18:09:26UTC; `marco-full-backup.stdout` |
| File and directory fsync of verified backup | Complete; `marco-durable-backup.stdout` |
| Web activation and strict preservation/readiness | Verified at18:12:57UTC; `marco-activate-release.stdout` |
| Final native guard and gated public checks | Pass; native at18:14:31UTC, public TLS/assets at18:14:09UTC and four browser-focus cases |
| Fresh strict preservation before reopening | Pass at18:14:57UTC; `marco-final-preservation.stdout` |
| Original nginx restoration and open public checks | Complete; `marco-reopen-admissions.stdout`; public open checks pass at18:16:09UTC |

The verified staging directory on marco is
`/var/tmp/ssh-exam-admin-editor-web-20261101-8k46lex7`. Staging alone installs
nothing. The loaded image matches the pinned Config and all rootfs diff IDs.
The fresh pre-fence guards again confirmed 110 web attempts and 175 native histories
unchanged. The fence's original configuration backup is
`/var/backups/ssh-exam/admin-editor-20261101-8rf2ebu2`. Relevant old exam workers
are drained; any surviving old worker is qualified as handling an existing
unrelated HTTP/1 connection to port8181, preserving that connection.

The temporary fence includes instructor sign-in and student admission;
finish, status and agent paths remain available. Exact corrected fence SHA256 is
`a34a93ef95fa9e7618bb6646f9cf2b934ce0055fd94b308d2abbbb3b275b47c6`.
Reopening restored pristine nginx SHA256
`1d9b11f5d88128ef58509bc740f23d1f1d55777410c7f12a82e9636ad50be787`
using reload only, preserving unrelated sites and connections.

## Required preservation and rollback

Before stopping the idle gateway, the guarded backup checked available capacity
on `/data`. The verified, durable root-private backup is
`/data/ssh-exam-backup-admin-editor-20261101-gj4gw2sy`. It contains the consistent
schema36 SQLite database with 110 unchanged historical attempts, complete
data/configuration archive, old-image export and original nginx files. The archive
is 13,586,176,000 bytes /153,827 members; SHA256
`16f222aa9f7c7408be4a06352910d473b21d2e7820ad8dc44503653cf9a40c6b`.
Verification completed at 18:09:26 UTC. All six backup files and the backup/staging
directories were fsynced; the durable receipt reports no production-record change.
Activation required this durable backup receipt and passed behind the admission
fence at 18:12:57 UTC. Fresh final preservation passed at 18:14:57 UTC before
reopening.

The running verifier proves unchanged database schema/indexes and all 37 durable
authority tables, including attempt/grant rowids, saved-file retention, prior
audit and prior management requests. All 110 historical attempts remain unchanged.
Six nonces already expired before activation were pruned; 13 fully audited empty
saved-work-worker polls account for the new operational history at activation.
Only those narrow operational changes are allowed. There is no migration delta
or intentional authenticated-management-read exception. Fresh signed native
roles and production readiness pass; only the `EXAM_IMAGE` environment line
changed, with application configuration preserved.
The fresh final check proves the same authority/schema/history preservation,
the same six expired nonces, and 36 fully audited empty worker polls in total.
The local preservation and operation checks pass 20 cases; 15 Python operation/test
files compile. Those checks qualify the scripts; the owning-host receipts above
establish the actual production preservation.

If repair is needed, retain the admission fence and prefer forward repair. A
rollback must freshly drain, back up current state, select the prior matched
schema36 web image, and verify CURRENT database/history/configuration and fresh
native readiness before reopening. Do not restore an older database, drop the
single-unused index, revive permission, or discard newer claims, deadlines, source
pins or audit. No class-server service restart or configuration change is needed.

Gated public checks verify TLS, readiness and all six exact packaged assets.
While fenced, admission endpoints returned503 and unauthenticated student GET
returned401. Real Chromium checks at1280/430px verify student and instructor initial focus,
immediate typing, stable later-field focus, reload and link navigation, with no
page errors or capability stubs. No credentials, authentication submission or
media capture occurred. The final native guard at18:14:31UTC proves all 175 native
histories, four service PIDs, configuration and installed/loaded CLI identities
unchanged. Conservative transient-helper guard refusals were retained and retried
after those helpers finished; no process was killed or refusal treated as a
student violation.

Production verification is read-only and creates no student exam, permission,
clock, alert or media session. After the exact original nginx configuration was
restored using reload only, public open checks at18:16:09UTC verified TLS,
readiness and all six assets again. GET probes to POST-only admission routes
returned404 rather than the fence's503; unauthenticated student GET remained401.
No authentication request was submitted.

## Deployment cost and possible improvement

The image is117 MB, but the complete private data/configuration backup is13.6 GB.
Copying and verifying that backup took about four minutes. Configuration checks
also use `tarfile.getmember` on the large archive, which scans its membership and
adds avoidable minutes before image selection and later verification. A future
deployment-tool improvement could retain separately verified small configuration
copies or a qualified archive-member index to avoid repeated scans while keeping
the full backup and strict preservation proof. These are optimization proposals;
the backup policy was not changed during this cutover.

A read-only metadata survey at18:19:23UTC explains the size: full screen JPEGs
11.45 GB, screen thumbnails0.76 GB, webcam originals/thumbnails0.93 GB, terminal
logs0.12 GB and database/receipts0.05 GB. The monitoring image totals for midterm
and midterm-recovery are12.96 GB, included in the totals above. There are50 started original midterms and8
recovery attempts; no student names, IDs or media contents were exported.
The five recognized full release-backup directories occupy69.98 GB; `/data`
reported16.11 GB available. This survey performed no deletion or policy change.

Capture produces independent JPEGs every5seconds per enabled source, with screen
requests up to2560×1440 and quality0.75. Each accepted frame has a separately
stored thumbnail; unchanged screen content is not deduplicated. Monitoring
expires60days after an attempt ends, through startup/hourly cleanup and isolated
physical purge. That mechanism does not rotate backup archives. A scalable backup
policy and recording representation need separate review; no reduction of evidence
or retention and no backup cleanup was performed in response to the survey.

Exact-payload duplicate counts are low:113 repeated screen images among55,035
and103 repeated webcam images among21,607 within the same attempts. These are
hashes of the actual JPEG bytes, so simple identical-file deduplication alone
would save little here. Incremental backups can still avoid copying the same
retained files for each release. Reducing live recording size would need a
separately qualified representation, such as temporal compression, or an explicit
capture-quality policy decision; no such change is part of this release.

Detailed sanitized receipts and local artifacts:
`var/collection-tests/admin-editor-rollout._ew85if9`. Existing documentation
screenshots remain preserved workspace data and are excluded from the release.
