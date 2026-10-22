# Concurrent default-size collections — local workload evidence, liveness open

October22,2026. Local synthetic sources only; no production install, student
record or service is changed. Three initial subsecond signed-inspection failures
are retained below. Later workload qualification does not complete C6/monitoring
or claim target-host capacity/no-false-hold behavior.

The new opt-in `TestConcurrentDefaultSizeCollectionsKeepHealthySignedControl`
starts two actual user-systemd collectors simultaneously with unchanged256MiB,
zero-swap,32-task and120-second per-worker controls and the existing two slots.
Each source has four separately hashed128MiB high-entropy files. Both archives
exceed512MiB and verify byte-for-byte; source attempts retain original intervals
and protected completed holds. Another attempt receives signed renewals every
500ms while signed inspection, registration and pane-capability issue/close run.
UID/SSH/writer guards are explicitly fake. This is not privileged SSH/PAM/PTY
qualification or proof of the host aggregate slice/capacity.

The first three measured runs preserve all submission and healthy-attempt checks
but FAIL the experiment's initial one-second signed-inspection assertion:

| Run | Renewals | Maximum renewal | Maximum signed inspection | Maximum no-fsync read-only |
| --- | ---: | ---: | ---: | ---: |
| Initial |35|2.633s|2.410s|not measured|
| Read-only diagnostic added |35|2.710s|2.498s|10.981ms|
| Runtime trace added |38|1.545s|1.414s|10.495ms|

Both read-only diagnostic runs have zero unavailable observations. Actual live
worker memory.max/swap.max/pids.max/oom.group values are checked; observed peaks
reach268435456/268439552 bytes, consistent with the documented kernel peak
measurement distinction. During these diagnostic runs no timeout, worker budget,
live lease or assertion was changed to make them pass. Existing single-collector IO qualification
uses a separate three-second renewal budget; its passing evidence does not make
this new subsecond signed-inspection experiment pass.

The last run's Go runtime trace identifies the longest signed inspection:
1.414467s total,1.218455s in file/directory fsync (1.101436s state file and
0.117019s directory), plus0.193108s in rename. The longest renewal is1.545054s,
including1.339564s fsync and0.202590s rename. Both signed paths deliberately
persist anti-replay state; the renewal uses a separate per-attempt journal rather
than the global state lock. This is direct evidence of synthetic storage-commit
latency, NOT evidence of the initiating production incident. Read-only diagnostics
avoid writes and cannot substitute for authenticated live authorization.

Trace artifacts are private under
`var/collection-tests/qualification-artifacts.qTDysU/`: the trace, derived syscall
profile and parsed event log. Logs are `/tmp/ssh-exam-concurrent-default-size.log`,
`/tmp/ssh-exam-concurrent-default-size-trace.log` and
`/tmp/ssh-exam-concurrent-default-size-profile.log`. No production process was
traced. SDK trace/pprof tools were built locally from the installed SDK source;
no package or global tool installation was changed.

## Criterion correction and subsequent evidence

The initial one-second signed-inspection criterion incorrectly treated a durable
anti-replay transaction like no-write diagnostics. Runtime profiling confirms
that distinction above. The test now applies the existing single-collector
three-second durable-IO workload budget to signed renewal, inspection and each
registration/pane issue/close operation. No-write diagnostics retain a one-second
bound and require at least three successful observations; separate controlled-
blocked-lock regressions retain their subsecond limits. Every signed inspection
also requires an unexpired healthy lease, not merely an ACTIVE state label.
This is an explicitly documented test-criterion change, NOT an implementation
fix for storage stalls, a runtime timeout increase or a no-false-positive claim.

Three final race repeats pass116.594s total (38.08/38.77/38.72s). Respectively:

| Run | Renewals | Max renewal | Max signed inspection | Max registration/pane | Max read-only | Successful/unavailable read-only |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
|1|35|2.154s|2.019s|14.901ms|11.580ms|69/0|
|2|41|571.820ms|586.547ms|30.134ms|144.769ms|81/0|
|3|42|988.971ms|987.534ms|18.070ms|13.107ms|87/0|

Both live workers and all bytes/holds/intervals/ownership checks pass each run.
An intervening full native race/resource/namespace/compiler/default-size suite
also passed with the initial stricter criterion (core242.620s/CLI23.556s); that
does not invalidate the three earlier storage-latency failures. Final-repeat log:
`/tmp/ssh-exam-concurrent-default-size-final.log`. Course-specific/debugger sizing,
actual privileged worst-case simultaneous workloads, target storage capacity and
coordinated critical monitoring/containment qualification remain OPEN.

Next: resolve the consequential C10 renewal-durability choice, then qualify the
coordinated native authority/journal/containment implementation. Do not delete
nonce commits or relax durable starts/deadlines/owner epochs/audit as an incidental
performance fix. Keep the false-positive and all-writer/input acceptance gates
unchanged. Retain the failed subsecond observations and criterion correction;
passing this disk-IO workload test is not an implemented liveness fix.
