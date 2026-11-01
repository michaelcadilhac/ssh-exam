# Monitoring inspection, private export and reviewed deletion

November 1 video-storage extension: implemented/tested locally, not deployed.
`monitoring show` adds conversion status and the CLI supports request/retry/pause
through the same authenticated management route as the website. Completed screen
and camera JPEGs may be replaced only after verified short video segments and
their frame mappings are durable. Capture times and exact terminal bytes remain.
The existing inspection/export/deletion features were subsequently deployed;
dated local-candidate descriptions below retain their original qualification
history. The new conversion/derived-export extension is not a production claim.

## Completed-recording video storage

```sh
sudo examctl web monitoring show ATTEMPT
sudo examctl web monitoring optimize ATTEMPT
sudo examctl web monitoring optimize-retry ATTEMPT
sudo examctl web monitoring optimize-cancel ATTEMPT
```

Both `monitoring.show` and `monitoring.optimize` must be explicitly authorized in
the gateway's agent management allowlist. Before sending a mutation, the CLI makes
a fresh signed show request, checks its attempt and typed status, and requires
`monitoring-optimization-v1`. An older or unavailable gateway refuses before the
optimization request is sent; do not bypass that check with direct database edits.
Web and CLI delegate to the same durable request helper.

Only retained, started, completed attempts with an end time are eligible. Request
queues eligible work; retry resumes it. Cancel leaves it paused and prevents later
publication by that request; already verified mapped segments remain. No command
stops a live capture or changes a clock, permission, account hold, protected
submission or the existing monitoring retention policy. The worker verifies the
replacement before deleting redundant JPEGs; a request receipt is not proof that
conversion or physical cleanup has completed.

Fresh show returns `optimization` with status `not-queued`, `pending`, `running`,
`retry`, `paused`, `complete`, `deleted` or `ineligible`, plus eligibility, frame/
segment progress, verification time and a bounded diagnostic code. Converted and
remaining frames sum to the retained frame count. `source_bytes` and `video_bytes`
describe the converted subset: they exclude remaining JPEGs, terminal recordings,
submissions and backups. They are not a measurement of total disk space freed or
confirmation that every old JPEG has been physically removed.

Keep the printed **Management request ID** and **Optimization intent ID** after
an unknown reply. Retry the same command/arguments with `--request` and `--intent`;
the latter defaults to the request ID. Exact intent retries acknowledge the earlier
request without requeuing work. A confirmed refusal requires deliberate new intent
after repair. Show is a fresh status read; the accepted mutation receipt contains
only its attempt, action and acceptance, never a cached claim of current progress.

Export still contains JPEG review frames and exact terminal files. Legacy frame
metadata keeps its eleven fields. A video-derived frame adds strict `provenance`
with encoding `vp9-webm-v1`, original `capture_sha256`/dimensions, segment UUID/hash,
frame index0..11 and the decoded RGB24-pixel hash. Its ordinary metadata `hash`
identifies the actual exported JPEG and width/height describe those derived
pixels; capture time, sequence and receive/monotonic values remain unchanged.
The original capture digest stays explicit and is never silently replaced in the
database. The CLI validates signed provenance and actual exported bytes; it cannot
independently reconstruct the deleted original JPEG from that digest.

The individual `monitoring image` response follows the same distinction. Its
`sha256` verifies the returned JPEG bytes. Derived responses include the strict
provenance object; the gateway checks its capture digest and original dimensions
against the retained frame record. A nonthumbnail response also includes the
derived image dimensions. Thumbnail provenance identifies the full decoded
source frame; its RGB24 hash is not a claim about the thumbnail's pixels. Legacy
image responses remain accepted without these additional fields. Invalid
provenance or dimensions refuse before the CLI writes private output.

An older strict export consumer safely refuses derived metadata and retains only
an incomplete output. Use the matched CLI; never combine old partial copies with
a new retry. New consumers accept legacy and derived frames in the same export,
with each frame's representation recorded. Existing scope/signature/watermark,
byte-prefix, private-output and deletion fences remain unchanged.

Local evidence: strict legacy/derived export checks, authenticated root-mapped
CLI/TLS lost-reply and request/retry/cancel workflow, mixed-version/no-mutation
refusals and the full affected CLI race suite pass. Exact receipts are in
`var/collection-tests/monitoring-compaction-cli._fbt3403`. This CLI evidence does
not substitute for the isolated codec/publication/deletion and website tests.

October 22, 2026. C1ga reads, C1gb2 durable isolated purge/status and C1gb3 reviewed
deletion are implemented/tested locally; **not deployed**. C1gc2's complete private
export is also implemented/tested locally. C1gb4 adds the read-only purge
inventory below, including retired preflights. Existing
60-day monitoring retention and independent protected-submission retention are
unchanged.

## Supported workflow

Start with `examctl web monitoring help`; help and syntax need no root/config.
Actual requests use root's existing Ed25519 agent identity, verified outbound
HTTPS and explicit default-deny `monitoring.show`, `monitoring.list` and
`monitoring.replay` read authorization, plus separate `monitoring.delete` for
deletion, `monitoring.image` for individual images and `monitoring.export` for
complete copies. No new listener, credential or
student authentication is introduced. Browser role/Origin/CSRF remain unchanged.

```sh
sudo examctl web monitoring show ATTEMPT
sudo examctl web monitoring list ATTEMPT --section frames --limit 50
sudo examctl web monitoring list ATTEMPT --section terminals
sudo examctl web monitoring replay ATTEMPT PANE --offset 0
sudo examctl web monitoring replay ATTEMPT PANE --offset 0 --output ./replay-batch.ndjson
sudo examctl web monitoring export ATTEMPT --output ./new-private-monitoring
sudo examctl web monitoring delete ATTEMPT --confirm USERNAME --revision HASH --reason 'Reviewed retention request'
```

Use attempt IDs from `examctl web attempts list EXAM`, not an exam ID; pane UUIDs
come from the terminals list. Show is gateway metadata/counts, not fresh native
protection verification. C1gb2 physicalPurge distinguishes pending/running/retry
from verified-absent at a recorded time for the current private directory only,
not backups or secure disk erasure. Use native `manifest` and
`export` for protected submissions; monitoring reads never modify clocks, holds,
continuation approval, protected bytes or receipts.

List returns whitelisted frame/terminal metadata, not image bytes, page hashes,
terminal text or arbitrary attempt settings. Default 50, maximum 200 entries.
Follow `next` with `--after NEXT --through THROUGH` from the first response.
The append-order SQLite watermark excludes subsequent captures; start a new list
to include them. This is not a chronological capture-time cursor. Retention may
erase the entire inventory and invalidates reads; it never resurrects old pages.

Replay returns at most 1 MiB of complete NDJSON events. Offsets/nextOffset are
UTF-8 **bytes**, not characters, timestamps or event counts; a nonzero cursor
must follow a newline. `more` means another full batch is available now.
`availableBytes` is the size observed on that same open file descriptor. A partial
last event is deferred, so nextOffset may be smaller even when more=false. Retry
the cursor when it completes; neither flag proves a live recording has ended.
Replay refuses nonregular, symlinked or multiply-linked leaf files, uses a
nonblocking/no-follow open and validates the descriptor before reading. IO errors
give storage/permission guidance without returning private paths. Bounded byte
reads are not a promise of process-isolated or nonblocking storage IO.

Default JSON includes scope and cursor progress. Explicit `--output -` streams
one NDJSON batch; a filename creates a new exclusive 0600 file, refusing existing
files and symlinks. It is **not a complete monitoring export**. Progress is printed
on stderr; inspect JSON for subsequent cursors. Failed writes can leave partial
output. Keep destinations and terminals private; no file is created automatically.
Signed reply target/pane/offset/byte length/page bounds are checked before any
private output is printed or a destination opened. Exit codes: 0 read, 1 refusal/
operational failure, 2 syntax; the gateway must be reachable.

## Shared service and retention

The admin summary and bounded entries endpoints use the same MonitoringManagement
validation/reader as root CLI. Existing browser terminal replay also uses it;
admin authentication remains required and responses remain no-store. The legacy
no-offset text endpoint returns only a complete single bounded batch. Larger or
partial recordings refuse with explicit incremental/reload guidance instead of
performing an unbounded read or silently truncating. The current browser already
uses offset-based replay. Unknown attempts/recordings return 404; deleted
monitoring 410; invalid byte boundaries/unavailable watermarks 409; malformed
syntax 400. No mutation becomes available via GET.

Unlike ordinary durable management snapshots, **all monitoring reads are
transient**. The permanent request outcome stores only id/transient and, for
list, section/watermark. It contains no inventories, terminal text or media.
An identical retry rereads retained data and rechecks tombstones, including after
gateway restart. Appended recording data may appear on the same-request retry;
this is deliberately not a permanent payload cache. A new request gets a new
inventory watermark. Each actual private read is audited under authenticated
agent/root or browser administrator, without storing replay text.

Existing operational audits/request metadata have their existing independent
retention; do not put student text into operator reasons. Deletion does not claim
that physical purge succeeded: failed purges remain tombstoned for retry. See
[monitoring-retention-fixes.md](monitoring-retention-fixes.md).

## One image through examctl (C1gc1, local candidate)

```sh
sudo examctl web monitoring list ATTEMPT --section frames
sudo examctl web monitoring image ATTEMPT FRAME --output ./new-private-frame.jpg
sudo examctl web monitoring image ATTEMPT FRAME --thumbnail --output ./new-private-thumb.jpg
```

FRAME is a listed frame UUID; it must belong to the named ATTEMPT. Separately
authorize `monitoring.image`; existing show/list/replay permissions do not imply
private image access. No gateway schema/configuration migration is performed by
this local implementation. Web review and root management use the same bounded
reader instance and combined sixteen-read capacity; reads yield outside SQLite.
The actual original JPEG is at most1,500,000 bytes; the derived thumbnail is at
most2MiB. Originals are checked against their stored upload digest. Legacy
thumbnails have no independent stored provenance hash; the signed response's
SHA256 is transfer integrity, not proof of fresh capture or monitoring readiness.

Default JSON contains scoped base64 bytes, length and digest. The CLI checks
attempt/frame/original-versus-thumbnail, canonical base64, bounds and digest
before ANY private stdout/file creation. Explicit output creates a new0600 file
and refuses an existing file or leaf symlink. `--output -` is binary stdout,
appropriate only for a deliberate private redirect, not a terminal. A failed
write may leave an incomplete private file. This is one image, not whole export.

Image reads use transient metadata-only durable receipts; exact retries reread
retained bytes even after restart. Pinned/no-follow private storage checks are
shared with web review. Deletion is rechecked after async IO and again immediately
before signing/publication, so an earlier cached receipt cannot replay deleted
bytes. Missing/wrong-attempt frames refuse without exposing another attempt;
link/FIFO/size/digest/storage errors give safe inspection guidance. Downloaded
copies are sensitive operator records: gateway deletion/expiry cannot erase
copies already downloaded. Apply institutional storage/retention rules separately.
Clocks, credentials, holds and protected submissions are unchanged.

Fifteen focused application/interface checks pass, including actual compiled
root-mapped CLI over real TLS, same-request/restart retry, original/thumbnail
bytes, exclusive output/symlink/deletion refusal, signed-but-wrong scope/variant/
digest before any output, shared web/root capacity with actual held descriptor
reads and responsive health. Disabling only the final publication fence makes
the deletion-race regression RED; the mutant is removed. Native help/syntax/
digest tests pass ten race repeats. Final qualification passes all400 application
tests/75files (81.46s), full native race/resource checks (core169.499s/CLI7.090s),
static build/vet/typecheck/build and all49 selected admin/review/actual-SSH browser
checks (3.5m). All18 frozen hashes match; documentation screenshots are unchanged.
See monitoring-image-qualification.md for that increment's exact evidence.
C1gc2's complete-copy workflow is below; see monitoring-export-plan.md for its
separate qualification status. No operation/configuration is deployed.

## Complete private copy (C1gc2, implemented/tested locally)

```sh
sudo examctl web monitoring show ATTEMPT
sudo examctl web monitoring export ATTEMPT --output /private/review/new-copy
# If a reply/copy was lost, retain the printed UUID but use another NEW directory:
sudo examctl web monitoring export ATTEMPT --request REQUEST_UUID --output /private/review/retry-copy
```

Use an existing real parent directory, without symlink components. The command
refuses existing destinations, stdout and unsafe/linked parents. It creates a
new0700 staging directory with0600 files: original JPEGs in frames/, derived
JPEGs in thumbnails/, exact raw recordings in terminals/, four metadata NDJSON
files, a files.ndjson hash/size index and manifest.json. Terminal copies include
incomplete/malformed binary tails; use replay for parsed complete events. Never
open arbitrary raw transcripts as executable content. The short success JSON
contains scope, counts, destination and manifest SHA256, not media or student text.

The existing fixed outbound HTTPS route streams purpose-signed packets. Each is
checked against the pinned gateway key, agent, request, fresh nonce, attempt,
sequence and bounded format before private output. Per-file offsets, lengths,
UUID-only names, hashes, section order and final inventory/counts are also checked.
An authenticated end packet alone is insufficient: clean stream EOF is required.
The command flushes files/metadata and publishes with no-replace rename only
after successful verification. It never overwrites another creator's destination.

Completion requires exit0 and confirmed:true. Do not infer it from a directory,
an individual manifest's complete field or some downloaded frames. An early
failure leaves a private ssh-exam-monitoring-UUID.incomplete directory and
INCOMPLETE marker; nothing is silently removed or combined on retry. A late
publication/sync/close failure may leave the requested final directory, possibly
without the marker: stderr explicitly says UNCONFIRMED, exit1 and no success
receipt. Preserve and inspect such output; do not treat it as a successful copy.
Do not delete protected submissions, holds, gateway tombstones or request records
to make an export retry succeed.

Inventory is append-watermarked at the original request; an exact request retry
keeps those watermarks/counts but rereads retained bytes. A NEW request includes
new inventory. Each recording copies its initial descriptor-pinned byte prefix,
excludes later appends and independently rereads/hashes that prefix before file
completion; observed overwrite/truncation refuses. A retry may observe a different
recording prefix. Attempt facts/history and source bytes are observed during the
copy, not a globally atomic exam snapshot, archive verification or work permission.
Retention/deletion invalidates both initial and retried reads; checks run after
asynchronous boundaries and immediately before each signed private publication.
Original image hashes check stored uploads; legacy thumbnail transfer hashes do
not establish independent capture provenance.

One stream/cleanup owner and the shared sixteen media-reader slots bound gateway
work. Source chunks are at most256KiB, signed event payloads4MiB and lines8MiB;
metadata is paginated, with oversize history refused rather than truncated.
Export has a30-minute overall budget and15-second network-read progress timeout,
not a student heartbeat/authorization timer; local output IO is not counted as
network silence. Capture/SSH/health remain independent. No server archive/private
payload cache is created. These async descriptor reads are NOT a process/hardware
storage-failure sandbox. Canceled IO retains ownership until actual cleanup;
uncertain close refuses reuse. For busy or cleanup errors inspect private gateway
diagnostics and current show; never clear state/restart production to bypass it.

Every export needs independent explicit monitoring.export authorization. Existing
browser authentication and review/deletion rules do not change. Private payloads
never enter durable management outcomes/audit; only inventory/request metadata
does. Gateway60-day deletion cannot erase previously downloaded copies. Store
exports privately and apply the institution's separate retention/backup policy.
This is monitoring only: protected archive bytes remain on the class server and
require the separate native manifest/export workflow. No schema, clocks, holds,
student credentials, continuation approval or protection policy is changed.

Final C1gc2 qualification:414 app checks/79files (85.99s), full native uncached
race/resource/namespace/compiler/default-size tests, static build/vet/typecheck/
build and113 fresh combined browser checks (12.8m) pass. All140 runtime/source
hashes match before/after; nine generated screenshots are restored to the verified
baseline. Actual TLS/root CLI, socket abort, held IO with real authenticated SSH/
signed renewals/capture and output/storage/protocol failures are covered. See
monitoring-export-qualification.md. This is local qualification, not deployment,
whole-host capacity certification or complete wider examctl management.

## Reviewed deletion (C1gb3 local candidate)

First run show and review the displayed student, attempt and deletionReview.
Only an ended attempt is eligible. Use its exact confirm username and revision
hash (not a clock/definition revision), with an operator reason of 8–1000
characters. Do not paste student monitoring or credentials into reasons. Web
review uses the same service, named confirmation, reason and captured revision.
Later polling cannot silently replace the reviewed target. Old boolean-only
clients refuse with reload/current-workflow guidance.

Deletion atomically records an audited metadata-only child intent, preserves the
first tombstone, scrubs review metadata and queues isolated purge. It permanently
blocks late callbacks. It never finishes an active attempt, releases account
restrictions, changes clocks or deletes protected submissions/receipts. A stale
review, wrong username or unfinished attempt refuses with inspection guidance.

Keep the printed --request UUID for a lost reply; --intent defaults to it.
An exact parent retry returns the original acceptance. To retry that same child
under a NEW parent, explicitly retain --intent and all original arguments. The
child record prevents requeue/resetting backoff even after restart or a new parent.
A cached acceptance is not current physical completion: use fresh show for job
status. Changed arguments under an existing intent refuse. After a confirmed
failure, inspect status/review and deliberately use a new intent for a new action;
a transient transactional failure can retry the same child under a new parent.
Browser retry keeps the exact sent reason/intent; cancellation requires reviewing
current metadata before a different request.

Migration 018 is additive and contains no media or attempt FK/cascade. Gateway
and native CLI must explicitly authorize monitoring.delete; read authorization
does not imply deletion authority. Preserve intent records, jobs and tombstones
through consistent backups/rollback. An old gateway lacks the shared contract;
old boolean-only UI must reload. Do not roll back to synchronous purge or discard
newer deletion records. No deployment or production migration has occurred.

## Purge job inventory (C1gb4 local candidate)

```sh
sudo examctl web monitoring purges --limit 50
sudo examctl web monitoring purges --status retry --limit 50
sudo examctl web monitoring purges --after LAST_ATTEMPT --limit 50
sudo examctl web monitoring purge-status ATTEMPT
```

These are read-only metadata commands, not instructions to delete anything.
They require separate monitoring.purges/monitoring.purge operation authorization.
List defaults to 50/max100 and returns an exclusive attempt-ID next cursor. Its
--after is an ID, unlike the numeric frame-list cursor. Unfiltered pages include
legacy tombstones awaiting job backfill (not-verified); stored-state filters are
pending/running/retry/verified-absent. Migration 019 adds the filter index. A
retired preparation's attempt metadata is null, not a reason to erase its durable
deletion/job. purge-status reads that ledger/job even when ordinary attempt show
no longer has an attempt row. Missing deletion records refuse, never authorize
filesystem removal or reconstruct historical authority.

The same bounded no-store administrator HTTP readers are available under
/api/admin/monitoring/purges and /api/admin/monitoring/purges/ATTEMPT. Payloads
contain whitelisted identity/status/timestamps/error codes, never monitoring text,
private paths, files or protected submission contents. Database/audit failures
refuse with private-diagnostic/retry guidance, not raw exceptions.

Unlike private-media reads, these metadata-only management request outcomes ARE
cached snapshots. Use a NEW --request for fresh status or each next page. An
observed timestamp is not new filesystem verification; inspect the job's verified
time/status and preserve tombstones. Live statuses/new IDs may move while paging;
restart a list when needed. Busy/retry jobs remain owned by durable scheduling,
and these reads never requeue/reset backoff or alter clocks/holds/history.

## Verification and future rollout

Final combined qualification: all84 administrator/real synthetic SSH/fault/
closure/timezone browser checks pass together (10.6m). Subsequent root-only
inventory audit-label fix passes the final full346/64 application repeat (71.8s),
including actual compiled CLI/TLS. Resource labels live in audit detail.target;
the request UUID remains the row target. The corrected regression was proved
failing against the old fallback, then passing. Typecheck/build/static native
build/vet/race compatibility pass; UI hashes unchanged. No production deployment.

C1gb4 inventory qualification: 346 app tests/64 files (72.4s), actual compiled
CLI/TLS/restart/pagination/cached-versus-fresh metadata, bounded authenticated
no-store HTTP, retired epoch-zero tombstone and index/privacy/failure tests pass.
Typecheck/build/static native build/vet/race compatibility pass. UI assets are
unchanged from C1gb3's31 admin/browser checks. Combined84-browser qualification
is tracked in todo-progress.md; not claimed complete here. The first inventory
fixture assumed an empty global retry backlog; it now preserves/pages real IDs.

C1gb3 final local qualification: 344 application tests/62 files (73.8s), actual
compiled CLI/TLS/restart/new-parent child retries/default-deny/audit and all 31
administrator/monitoring browser checks (2.1m) pass. Named/unfinished/stale refusal,
intent-write transaction rollback, private error redaction, exact retry without
job backoff reset and unchanged protected authority pass. Actual HTTP role/CSRF/
Origin checks and nine real purge faults beside healthy SSH/PTY/signed control
pass. Fresh full native race/resource/namespace/compiler/default-size opt-ins pass
(core108.1s); static build/vet/typecheck/build pass. UI index-BUxRZ6XW.js. The first
CLI run refused a synthetic COMPLETED row without ended-at; the fixture was fixed,
not eligibility. Prior 81-combined-browser evidence below predates this changed
UI and is not a new combined claim.

Focused unit/HTTP and actual compiled namespace-root CLI/local-TLS tests pass,
including paging, UTF-8 byte offsets, restart, transient receipts, appended data,
deleted retries, private exclusive output/symlink refusal, role and CSRF boundaries,
bounded legacy reads and unchanged authority. The first actual CLI run caught a
missing native operation allowlist entry; fixed before the passing repeat.
Actual FIFO/no-writer, symlink and multiply-linked replay regressions pass without
blocking or following the leaf. The first combined browser repeat passed 80/81;
its fault test's sixth login hit the unchanged five-starts/60-second protection.
The fixture now waits for that window, and the gateway gives actionable wait
guidance. The actual WebSocket regression and all 327 app tests pass; the fresh
combined browser repeat then passes **all 81 checks together (10.5m)**, including
all five actual fault recoveries, healthy synthetic SSH, monitoring deletion/
review, closure recovery and seven timezones. Full native race/resource/compiler/
default-size opt-ins pass (107.3s core), all three Go modules pass race checks,
static build/vet/typecheck and app/WASM build pass. Generated screenshots are
restored, not product changes. This is not complete monitoring management.
Full application/native race/build/browser repeats are recorded in todo-progress.md
when complete; no production qualification is inferred from these fixtures.

C1ga required no schema migration; C1gb2/3 add 017/018. A future separately
authorized rollout must pair gateway/
CLI and deliberately authorize only needed named read operations after safe
drain/backup. Older CLIs lack these workflows; old gateways refuse the operations.
Keep management receipts/tombstones across rollback. Downgrading restores the old
unbounded legacy text reader and loses these shared bounds; use incremental replay
and preserve deletion records. Temporary-agent consolidation remains only the
proposal in todo-rollout-plan.md and must not be executed as part of this work.
