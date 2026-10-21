# Bounded monitoring inspection and replay

October 21, 2026. C1ga is implemented/tested locally;
**not deployed**. This is metadata/terminal replay, not complete monitoring
management. Whole-media export, shared deletion intents/confirmation and durable
bounded OS-worker physical purge remain separate milestones. Existing 60-day
monitoring retention and protected-submission retention are unchanged.

## Supported workflow

Start with `examctl web monitoring help`; help and syntax need no root/config.
Actual requests use root's existing Ed25519 agent identity, verified outbound
HTTPS and explicit default-deny `monitoring.show`, `monitoring.list` and
`monitoring.replay` operation authorization. No new listener, credential or
student authentication is introduced. Browser role/Origin/CSRF remain unchanged.

```sh
sudo examctl web monitoring show ATTEMPT
sudo examctl web monitoring list ATTEMPT --section frames --limit 50
sudo examctl web monitoring list ATTEMPT --section terminals
sudo examctl web monitoring replay ATTEMPT PANE --offset 0
sudo examctl web monitoring replay ATTEMPT PANE --offset 0 --output ./replay-batch.ndjson
```

Use attempt IDs from `examctl web attempts list EXAM`, not an exam ID; pane UUIDs
come from the terminals list. Show is gateway metadata/counts, not fresh native
protection verification or proof of physical purge. Use native `manifest` and
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

## Verification and future rollout

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

No schema migration. A future separately authorized rollout must pair gateway/
CLI and deliberately authorize only needed named read operations after safe
drain/backup. Older CLIs lack these workflows; old gateways refuse the operations.
Keep management receipts/tombstones across rollback. Downgrading restores the old
unbounded legacy text reader and loses these shared bounds; use incremental replay
and preserve deletion records. Temporary-agent consolidation remains only the
proposal in todo-rollout-plan.md and must not be executed as part of this work.
