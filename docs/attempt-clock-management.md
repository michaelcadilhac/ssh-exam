# Attempt inspection and clock management

Current baseline: timer controls deployed November6 at09:36:52UTC. The optional
automatic countdown resume described below is implemented/tested locally only.
Historical C1e evidence remains in todo-progress.md. Tests use synthetic records
and keys; this follow-up changes no production records or installed services.

## Supported CLI workflow

November6 timer controls deployed at09:36:52UTC. The optional automatic
countdown resume below is a subsequent local change, not deployed. The instructor explicitly approved pausing only the countdown while
the student continues working under normal monitoring. Monitoring loss still
holds work; countdown pause neither thaws a hold nor authorizes SSH recovery.

```sh
sudo examctl web attempts show ATTEMPT
sudo examctl web clocks pause-timer ATTEMPT --revision CURRENT_REVISION
# If the student is stopped, optionally resume their countdown with their work:
sudo examctl web clocks pause-timer ATTEMPT --revision CURRENT_REVISION --resume-on-work
sudo examctl web clocks resume-timer ATTEMPT --revision CURRENT_REVISION
sudo examctl web interruptions authorize ATTEMPT --help
```

The admin attempt menu offers **Pause countdown** / **Resume countdown**. A
working student pauses directly. For a stopped student, the small pause dialog
offers **Automatically resume countdown when the student resumes work**, off by
default. The row then shows **Countdown resumes with student**.
The student sees **Countdown paused** and a fixed remaining time. Time changes
while paused change that saved remainder; countdown resume uses the original
request instant and native wall/boot binding, so retries never add time twice.
Original start/deadline and every clock revision remain in history. A completed
submission cannot be reopened. The ordinary current-deadline restriction below
uses this saved timer state for explicitly paused attempts.

**Allow resume** separately accepts **Resume within (minutes)** or **No approval
expiry**. The CLI accepts `--minutes N` or `--no-expiry`; omitting both retains
five minutes. No-expiry approval is represented internally as an exact bounded
integer, never as an execution lease or a new-attempt start window. Fresh SSH,
ownership, capture and native verification remain required; revocation and
completion invalidate the approval. Fresh files-only continuation preserves an
already-paused countdown until explicit countdown resume, or successful Resume
exam when automatic countdown resume was selected.

Both timer commands use existing `clocks.reset` authorization; resume approval
uses existing interruption authorization. No installation permission/configuration
change is required. Native `timer-clock-controls-v1` capability is mandatory.

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

## Automatic countdown resume (local follow-up)

The checkbox and `--resume-on-work` require a stopped (`LOCKED`) unfinished
attempt. They authorize one future clock change for that exact pause; they do
not allow access or change monitoring requirements. Sign-in, preflight, Allow
resume, failed native restoration and failed browser input acknowledgement leave
the countdown paused. The successful existing Resume exam workflow supplies the
recorded acceptance instant. The normal signed native clock path applies it.

The option stays in the existing durable clock intent. Successful continuation
is already durably audited. A causal audit cursor, generation and exact pause
intent exclude older events and superseded pauses, including equal timestamps.
This is independent of deletable monitoring history. Gateway restart, transport
failure and pending time edits retry the same resume request and preserve its
original acceptance instant; a delayed acknowledgement never starts a fresh full
allowance. No schema or native execution-protocol change is introduced.

Inspection: `web clocks show REQUEST` includes `intent.resume_on_work`;
`web attempts show ATTEMPT` includes `timer_resume_on_work`. The normal pending
versus confirmed distinction still applies. Manual **Resume countdown** starts
the timer immediately and ends the automatic wait. Finish/completion makes the
option unusable; a later manually paused countdown cannot inherit it. Changing
time while waiting changes the saved remainder, not the successful-resume time.
The existing root clock poll provides bounded restart recovery (100 candidates
per pass with a cursor); no account reservation or execution permission follows
from this metadata. Use matching updated web/CLI readers for the new metadata.

Local verification (November6): full application829pass/3existing opt-in skips,
22focused HTTP/Continue/restart/negative checks, full examctl race suite, affected
native core clock races, build/types and3desktop/mobile countdown browsers pass.
The CLI integration invokes the compiled root-mapped executable over local TLS.
The Continue integration uses actual HTTP, worker and SSH; native restoration and
browser input acknowledgement are explicit synthetic seams. Native execution
code/protocol is unchanged; its previous privileged qualification still applies.
No new privileged automatic-resume journey or release installation is claimed.

Evidence: var/collection-tests/timer-resume-on-work.20261106/. The initial full
run had828passes and one ordinary Begin timeout while browser startup overlapped;
that unchanged case passes alone in6.11seconds under its original15-second limit.
The full retry without browser/build competition passes in414.29seconds. Original
failed receipts are retained. Two focused fixture errors (missing signed health;
missing exam selection after reload) were corrected without changing enforcement.
Inspection, cancellation, restart, stale completion and admission were reviewed
before broad qualification; the option never reserves an account or thaws work.
The final source edit after qualification only corrects a delivery comment;
runtime behavior and test inputs remain unchanged.

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
bulk/root changes remain honestly pending until native confirmation. The native
watchdog now fetches already-authorized clock intents once per second over its
existing authenticated outbound HTTPS path, independently of student SSH and
without waiting for the old deadline. Signed requests/responses bind the agent,
nonce, expiry and bounded page; retries keep the original intent and amount.
A durable record with clock_handover_pending=true is not live confirmation.
The same request stays queued until the supervisor acknowledges its new clock,
including an identical-history callback at the same revision. The watchdog still
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

## Retained monitoring clock handover (local candidate, October24 UTC)

The instructor approved carrying unchanged still-fresh monitoring facts across
an explicit clock-only revision. The existing CLI/web clock request remains the
entry point. The native supervisor checks the same student/page/SSH/generation,
then the ordinary durable ClockReset precedes an atomic owner/deadline handover
for every pane and the independent shared cutoff. Original capture age, cutoff,
coverage, sequence, input epochs and shell/editor memory are preserved. Subsequent
proofs use the new clock revision. A clock edit supplies no fresh capture time.

A verified held attempt stays held through its adjustment and still needs explicit
finite approval and fresh Continue verification. Pending pane startup/resume or
unverified hold refuses the initial clock check with retry guidance. If the
durable adjustment succeeded but acknowledgement/handover is uncertain, inspect
the original request/native ClockResets and retry the SAME intent. Do not create
another extension as an acknowledgement retry. Expiry or a restart cannot restore
execution from saved metadata. Current and original access holds remain in force.

This passes full application/native race/resource, affected browser and fresh
guarded-root qualification locally; it is not deployed. Retained-mode
installed admission remains disabled pending the complete workflow. Detailed
receipts and limits: live-monitoring-runtime.md. No service action is authorized.
