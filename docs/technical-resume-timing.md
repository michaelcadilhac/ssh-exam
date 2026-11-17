# Technical recovery proof timing — qualified locally at16/64

The November17 native16 fault run reached64 verified panes, held all writers
during the planned75-second proof outage, then failed the recovery check: four
attempts were technically held again. Original clocks, live SSH and buffers were
preserved; this is not a student violation. Evidence and later observations are
kept in `var/stress/20261117T174000Z/native-recovery-4/`.

The native recovery operation caches a preparation nonce/timestamp for idempotence.
Its timestamp can predate a successful proof fetch by most of the60-second evidence
window. Both native acceptance paths currently derive the permit cutoff from that
old preparation timestamp, even when the web response used fresh challenged facts.
This is a source-supported cause to reproduce, not yet a proved explanation of
every extra hold. The web HTTP waiter also conservatively charges its whole wait;
do not remove that guard on speculation.

The local correction separates the stable recovery-operation nonce from a fresh,
one-use proof-exchange nonce and native BOOTTIME timestamp. The live supervisor
owns a bounded outstanding-exchange map. Each authenticated request/reply binds its
exchange nonce. Native verification charges the full matching round trip; replayed,
unknown, consumed or expired exchanges fail closed. Cached web proposals retain
their original cutoff and return only their remaining age allowance. An explicit
technical protocol revision must reject mixed roles before work can resume.

Concurrent proof requests pin that operation while a bounded exchange remains
live; a retry cannot replace its owner/input epochs during an in-flight commit.
A pre-transaction failure cancels only its own exchange through the existing
root-authenticated supervisor socket. A missing cancellation reply leaves at most
the original 60-second expiry, never permission to run. Once persistence is
attempted, cancellation is deliberately withheld because the durable transition
may already exist; existing reconciliation handles its outcome. At most eight
exchanges exist per held attempt. Unknown/stale cancellations cannot affect a
sibling, owner, hold, deadline or authority.

State review: exchanges exist only in live supervisor memory and confer no work
permission. Process restart loses them and requires fresh verification. Expiry
recovers their bounded capacity. Consumption is one-use; an already successful
operation remains idempotently queryable only through its still-live authority.
Canonical interrupted transitions retain existing inspection/retry/cancellation
and expiry behavior; no new durable pending state or account reservation exists.
Clock/owner changes still require the exact existing scoped transaction checks.
Cached web proposals retain their original identity, authorization and cutoff;
neither a new nonce nor a retry makes their challenged facts younger.

This changes no monitoring window, deadline, allowance, account hold, clock policy,
SSH ownership or recovery eligibility. No metadata can create execution authority.
The existing native live authority and verified freeze remain mandatory.

Interrupted canonical ACTIVE/resuming progress also reuses the same technical
operation while its proof is in flight. It cannot rotate the nonce/epochs beneath
another coordinator's unfinished supervisor commit. Reviewed recovery retains its
existing predecessor matching; wrong/expired technical operations still refuse.

Acceptance: reproduce the stale-preparation/late-fetch defect; verify fresh exchange
acceptance without extending cached cutoffs, replay/mismatch/expiry/cancellation,
concurrent callers, interrupted commit/retry and owner/clock changes. Exercise the
real HTTP producer and native consumer before broad races/build and a new guarded
native16 outage/recovery/protected-finish run. Preserve prior failures. No deployment.

Five native timing/replay/expiry/capacity/concurrency/scoped-cancel checks pass,
as do real Unix/PTY refusal checks with races. Two actual signed HTTP cases and58
affected application checks pass; typecheck/build and all-native races pass
(1709 test-pass/137 explicit-skip events,276.288s). These are scoped evidence,
not distinct feature counts. Reviewed test requests were corrected to omit the
technical-only field; earlier failed receipts remain.

The matched v16 candidate passes the actual16-student/64-terminal browser/WASM/
SSH/root workflow, including75seconds of proof-path outage, verified kernel holds,
automatic recovery at generation1, input into every original shell, preserved
variables/deadlines/SSH/supervisors/grants, and16 protected submissions. Scenario
9.1minutes; complete test command559.315s. Evidence:
var/stress/20261117T174000Z/native-recovery-6/; exact bundle manifest
beecb1a9f73fac36efde7c32be69ee42d42d51be5634cca1fb0989765ee53560.
Sixteen verified proof fetches took1143–3772ms; remaining native verification
allowances were51603–57346ms. Independent exact guest/local cleanup and FULL
host-file/authority preservation pass; source and built fingerprints are unchanged.

The separate v14 attempt failed BEFORE the outage:15students/60panes verified;
student16 remained ACTIVE/gen0 with two panes, and the third was refused by the
native gate. That is not another recovery-timing result and remains unexplained.
Private bounded agent-journal capture now preserves120lines/64KiB before teardown,
and the previously silent policy-refusal branch logs its cause.38 bridge checks
pass. Raw journals can contain the prepared base's older synthetic entries: filter
by the recorded phase start before diagnosis. Phase6 includes five current service
entries and no current refusal; it does not retroactively explain phase5.

No production change, push, deployment or70-person qualification is claimed.
The release needs matched web/native v2 roles; old technical-v1 roles refuse.
No schema migration is required. Stage/verify the matched artifacts before an
explicitly authorized drained installation; retain the prior matched artifacts
and current private state backups for compatible recovery. Never restore older
state over newer attempts or use a mixed-version rollout to reopen admissions.
