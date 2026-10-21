# Bounded monitoring inspection and replay

October 21, 2026. C1ga reads, C1gb2 durable isolated purge/status and C1gb3 reviewed
deletion are implemented/tested locally; **not deployed**. This is not complete
monitoring management: full export and retired-job inventory remain open. Existing
60-day monitoring retention and independent protected-submission retention are
unchanged.

## Supported workflow

Start with `examctl web monitoring help`; help and syntax need no root/config.
Actual requests use root's existing Ed25519 agent identity, verified outbound
HTTPS and explicit default-deny `monitoring.show`, `monitoring.list` and
`monitoring.replay` read authorization, plus separate `monitoring.delete` for
deletion. No new listener, credential or
student authentication is introduced. Browser role/Origin/CSRF remain unchanged.

```sh
sudo examctl web monitoring show ATTEMPT
sudo examctl web monitoring list ATTEMPT --section frames --limit 50
sudo examctl web monitoring list ATTEMPT --section terminals
sudo examctl web monitoring replay ATTEMPT PANE --offset 0
sudo examctl web monitoring replay ATTEMPT PANE --offset 0 --output ./replay-batch.ndjson
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

## Verification and future rollout

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
