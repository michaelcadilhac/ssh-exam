# Native history scans and four-core CPU cost

November19, local development. The instructor requires optimization within four
csc-sys cores. No production installation, service, configuration, student record
or deadline has been changed. This is not a class-capacity or release-ready claim.

## Defect and implementation

The watchdog calls callback delivery every second. Previously, checking each
terminal-recording file's already-delivered offset entered `WithState`: reload
every attempt, apply normal transaction handling, hash public statuses, serialize
the entire state, fsync and replace it. Hundreds of acknowledged historical
recordings therefore caused hundreds of full writes per scan. Selecting callback,
access-release and recording-report candidates also made write transactions.

These four discovery paths now read atomically committed snapshots. No state or
execution authority is cached. `DeliverCallbacks` keeps its existing delivery
flock, twenty-event pass, retry/backoff and per-second scheduling. A recording
pass reads offsets once under that same delivery ownership. Every successful
upload still rechecks its exact durable offset and commits only the bytes sent;
failed requests retain their old offset for idempotent retry after restart.

Access candidates still pass the isolated collection worker's canonical fence,
protected-archive verification, writer termination and original-deadline policy
before any hold is released. Recording reports still recheck exact identity and
revision inside their original state transaction. Discovering a candidate grants
no permission or cleanup proof.

The independent one-second deadline cutoff, live monitoring, loaded-role observer,
collection cadence and actual mutation/error persistence semantics are unchanged.
There is no new setting, CLI command, schema, timer/freshness allowance, admission
state or intentional exam-policy change. Existing `examctl` inspection and
reconciliation workflows remain the management interfaces.

## Measurements

Synthetic history contains218 completed, released attempts with four acknowledged
recording files each. The real signed-HTTPS callback entry reproduced the defect.
On the development host, one old idle scan took6.835s and allocated5.81GB; five
new scans averaged13.671ms and7.08MB per scan. This is a component benchmark, not
a class latency distribution or production-host speed promise.

The actual `Engine.Watch` loop was also measured using synthetic history in owned
local user services: one-core quota,512MiB/no swap,128tasks, four Go schedulers,
three-second warmup and an eight-second measurement. CPU fell from0.519core to
0.079core, an84.7% reduction, passing the unchanged75% reduction target. Before/
after source manifests differ in only the four intended implementation files;
the same authored fixture and bounds were used. Both exact units are stopped.
The non-root fixture cannot verify installed native role agreement; it does not
qualify kernel containment or production co-location.

An earlier callback-only version achieved72.3%, failing that performance target.
That failed result remains. A copied baseline binary then lost its executable
mode before the next measurement: systemd refused it with203/EXEC before the
fixture ran. Its log and zero-PID/empty-cgroup proof remain. The mode was corrected;
no missing package or production operation was involved. A preliminary watchdog
investigation's teardown used context cancellation before its SIGTERM check; that
fixture failure is retained separately and is not a process-death qualification.

## Verification and next gate

Focused race checks pass real signed callback delivery, idle scans without a
canonical write or wait on a concurrent writer, malformed/missing authority,
failed upload plus restart retry, an append during upload, prompt callbacks after
idle, concurrent deadlines/slow cleanup and existing access/report checks.

The first broad native race run failed only on overlong Unix socket paths caused
by its private `TMPDIR` prefix. Both failed tests pass with the ordinary `/tmp`
root. The final full native/CLI race run passes: core278.113s and CLI7.366s, with
1,735 passing cases including subtests,137 gated skips and zero failures. Build/
vet pass. The matched-binary Marco→WASM→SSH→disposable csc-sys editor/hold/Continue/
protected-Finish workflow passes in104.043s command time. Independent native/host/
guest, Marco and local cleanup are FULL; source/build and all16 documentation-image
hashes are preserved. [Agent report](../reports/stress/20261119T194443Z/report.md).
Existing unchanged application/browser UI evidence applies only to its previous
scope; this is not a new class pass or a production change.

Raw evidence:
`var/qualification35/profile-20261119T044302Z-8d3c93/native-small-profile/idle-callback/`,
plus sibling `callback-native-race-final/` and `callback-native-interface/` under
the profile root. The actual native interface run is recorded in
`idle-callback/native-editor-run.json`. Each failed setup and benchmark remains.

Next: commit this coherent increment, then qualify the new artifacts in the
short35-student co-location workflow. Keep
the [preceding failure](../reports/stress/20261119T175624Z/report.md) intact. No new
full-class ramp should infer capacity from this small measurement.

Deployment remains separately authorized and qualified. This change needs no
data migration: original state, callback sequences and recording offsets remain
durable. A future release must install matched native roles, retain current-state
recovery coverage and verify fresh loaded-role agreement; an older compatible
reader must retain newer acknowledgements rather than restore an old snapshot.
