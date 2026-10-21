# Attempt inspection and clock management

October 21, 2026. C1e implemented/tested locally; full evidence is recorded in
todo-progress.md. **Not deployed.** All tests use synthetic local records/keys.

## Supported CLI workflow

```sh
examctl web attempts help
examctl web clocks help
sudo examctl web attempts list midterm --view attention
sudo examctl web attempts show ATTEMPT
sudo examctl info ATTEMPT
sudo examctl web clocks reset ATTEMPT --minutes 90 --revision 0
sudo examctl web clocks extend ATTEMPT --minutes 5 --revision 1
sudo examctl web clocks show CLOCK_REQUEST_UUID
```

Gateway inspection requires named attempts.list/show authorization; clock
operations require their individual clocks.show/preview/reset/extend/batch
managementOperations. They reuse existing real/effective-root agent signing,
fixed pinned outbound HTTPS, purpose/audience/nonces and durable outcome records.
No browser cookie, new listener, polling command API, student password or local
unsynchronized clock editor is added. Native list/info still work offline and
show native history/recovery. Machine audit remains agent:ID:root, not SUDO_USER.

List scans bounded pages (100 default, maximum 200) by exam/username search/view,
including retained history. Filters match dashboard semantics; filtered pages can
be empty with a next cursor. Keep filters stable while paging; IDs sort by ID,
not start time. Show returns bounded current gateway metadata and frozen settings,
not fresh native verification. Page hashes, session material, student interruption/
review text, monitoring payloads and unbounded reset arrays are excluded from
permanent read caches. Full native reset history remains in examctl info. Current
presence is an observation, never execution permission. Use a new management
request ID for a fresh read; reusing one intentionally returns its old snapshot.

## Explicit time changes, not recovery grants

Minutes are whole 1..360. Reset chooses remaining time from the gateway's recorded
acceptance instant, not delayed native delivery. Extend/add add to the previous
committed deadline. Eligibility and requested_at now use one captured instant:
the previous code could cross the old deadline between two clock reads and create
an intent that native validation could never legally apply. A regression advances
Date.now across that exact boundary. Native original/current-deadline checks are
not weakened.

Only ACTIVE/LOCKED, unprotected, started attempts before their current deadline
can receive new changes. Current integer clock revision is required; do not use a
definition revision hash. Existing pending changes/operations conflict. A completed
or expired attempt cannot reopen. No automatic refund, continuation authorization,
new attempt, altered original interval/access hold or submission replacement
follows from a clock edit. Resume/SSH ownership and the issued settings snapshot
remain separate. Outage recovery still uses the approved new-grant model, not
clock resets as automatic compensation.

## Default resets and bulk operations

```sh
sudo examctl web clocks preview midterm --target UUID1:0 --target UUID2:1
# Review each returned target and expectedSeconds before changing time:
sudo examctl web clocks reset-default midterm --target UUID1:0:5400 --target UUID2:1:7200
sudo examctl web clocks add midterm --minutes 5 --target UUID1:0 --target UUID2:1
```

Bulk selection is explicit, 1..100 unique targets, scoped to the named exam.
Wrong-exam/duplicate selection rejects the entire batch before staging. Other
ineligibility is reported per target without undoing accepted siblings. There is
no implicit all-students edit. CLI exits 1 for partial failure while still printing
every result/request ID. Unknown/missing/duplicate/wrong-scope replies never imply
successful clock confirmation.

Reset-default is an intentional manual choice of each student's **current**
enrollment/exam allowance (sandbox remains five minutes), not a rewrite of the
original attempt/grant snapshot. Previously the web dialog displayed one amount
while submission recomputed a possibly edited default. New browser confirmations
carry the displayed expectedSeconds; CLI preview provides the same explicit
seconds for target specifications. A new intent refuses if the current default
changed after review, with fresh-review guidance. Preview reserves/consumes
nothing. Non-whole-minute defaults require a deliberate explicit minutes choice;
never round or rewrite them silently.

An already-issued child request retains its exact amount across later default
edits: retry checks the stored actor/attempt/revision/amount, not mutable defaults.
This is idempotent historical recognition, not another reset. Missing reviewed
amounts refuse: old browser clients must reload. Future settings edits alone
still change no running clock or issued settings.

## Pending versus confirmed, and safe retries

The signed envelope's outer confirmed=true means the **gateway operation** was
accepted. result.confirmed/status and each bulk result distinguish pending from
native-applied/confirmed; closed means the intent was not applied before finish.
Never interpret acceptance or an old cached reply as proof of the current native
deadline. Inspect fresh web clocks show CLOCK_REQUEST_UUID, web attempts show
ATTEMPT and native info. CLI validates target/child identity and explicit native
status, including complete per-target batch results, before reporting success.

Shared ClockControl.stage is synchronous: eligibility, exact intent, revision,
timestamp and audit commit without any SSH/network/systemd wait in SQLite.
ClockManagement shares bulk validation/staging with the browser. Individual web
resets retain their existing immediate delivery attempt outside the transaction;
bulk/root changes remain honestly pending for existing authenticated student SSH
heartbeat delivery or signed outbound deadline timing. The native watchdog still
freezes at its committed deadline and verifies timing before collection. Missing
transport is not permission to discard the request, reset its timestamp or write
beyond the last committed deadline.

Retain the printed management --request UUID after a lost reply and repeat the
same arguments. Single child intent defaults to it; bulk child UUIDv8 identifiers
are purpose-separated deterministic values of parent/attempt, not authentication
capabilities. Each target prints its requestID. To retry only selected failures
under a new parent, retain each child with --intent UUID (single) or :INTENT
(bulk), plus the same reviewed amount/revision. Do not add minutes again to
compensate for a missing acknowledgement. Changed arguments/actor with an existing
child conflict. An old applied intent can be recognized without changing its clock.

## Compatibility, verification and open gates

No new schema migration: preserve migration 007 clock requests/history, migration
013 management outcomes and every current deadline/hold. No historical rewrite
or native workspace/grant conversion occurs. Install matching gateway/browser/CLI
only in a separately authorized, verified drained window; not during this work.
Older browser payloads missing reviewed default amounts now refuse and require
reload. Conversely, an old gateway could discard an unknown expectedSeconds and
recompute a different default: never combine new confirmations with an old
gateway or treat that downgrade as preserving the fence. Keep compatible assets
and pending requests; repair forward if a downgrade cannot preserve authority.

Focused evidence includes actual compiled root-mapped examctl -> local TLS ->
gateway definition/roster/attempt/clock workflows, persistent pending retry after
gateway restart, signed native application callbacks, the existing signed timing
route, reset/extend/default preview/partial retry, unchanged original holds and
other attempt clocks, metadata redaction and failed-projection rollback. Native
clock-reset/extension/timing/race enforcement remains separately exercised in the
Go suite. Callback/native writer state in this HTTP fixture is synthetic, not an
installed privileged PAM/PTYS claim. Browser tests cover the fixed displayed
allowance during background changes and the existing seven-timezone workflow.
Full regression results and remaining privileged/unified-grant gates are in
todo-progress.md. Temporary-agent consolidation remains a proposal; do not deploy.
