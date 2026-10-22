# Candidate qualification without modifying an installation

October 21, 2026. The instructor permits isolated csc-sys tests only when they
leave the current installation untouched and cannot interrupt exams. **No
deployment, production service action, account/configuration change or temporary
agent consolidation is authorized.** The earlier historical installed receipts
remain historical; the following is a new candidate test procedure.

The systemd 255 smoke test passed with a private network, read-only guest base,
volatile overlay, restricted capabilities and bounded resources. Its disposable
probe did not remain in the host or base guest and no test process/scope remained.
That is basic nspawn operation, not full candidate enforcement qualification.

## Isolated runner

`ssh-server/tests/overlay_qualification.py` is a root-only fixture runner, not an
installer. It requires a prepared, stopped private systemd guest whose guard
report explicitly labels it a private qualification fixture. Use Python without
`-O`; safety checks cannot be disabled. An advisory directory lock refuses a
second runner without writing the base. A running/mounted base is also refused.

Build the four candidate Go executables without installing them. Package them
with the exact FILES list in the runner and SHA256.json mapping every filename
to its digest; helper scripts, the collection slice and Python fixture sources
must come from the same source revision. Upload only into a new private temporary
directory. The runner checks exact manifest membership, regular single-link
bounded files and SHA-256 before copying into a fresh root-private test directory.
The login gate retains 0755, **not setuid**: peer credentials must be the actual
authenticated student. No student passwords, production keys or web credentials
are supplied to this runner.

```sh
# On the explicitly test-authorized host, never against a real student rootfs:
sudo python3 overlay_qualification.py \
  --guest /opt/ssh-exam-qualification/guest \
  --bundle /var/tmp/PRIVATE-CANDIDATE-UPLOAD --username examq
```

The sole host execution unit has a unique ssh-exam-qualification-UUID.service
identity, 1 GiB RAM, no swap, 512 tasks, 50% of one CPU, 15-minute runtime and
cgroup-wide bounded shutdown. Nspawn keeps that delegated unit, rather than
escaping its limits into a separate machine scope. It has private PID/mount/
network namespaces, no host network/veth, registration, settings import, journal
link or resolver/timezone bind. Its base is read-only below a disposable overlay.
Candidate files are read-only binds; only its new private output directory is
writable on the host. No host production paths are bound into the guest.

The runner enters only pinned guest namespace/root descriptors, not an unverified
or reused PID. It checks the unique input marker, test cgroup, nested PID 1 and
different mount/network/PID namespace identities before starting the guest-only
test service. Guest systemd owns the real SSH/PAM/cgroup/watchdog services, all
with the candidate artifacts. Tests may restart/change **only those disposable
guest services and synthetic guest accounts**, never the host installation.

Nspawn's default seccomp list rejects even the kernel's modes-zero adjtimex
query. The runner explicitly permits adjtimex/clock_adjtime but drops CAP_SYS_TIME;
the guest asserts that its capability bounding set cannot change the shared
clock. No clock-adjustment call or host NTP/configuration change is performed.
Do not replace the native synchronized-clock guard with a fixture override.

Production authority is inspected from bounded raw state read-only, never native
list/info/reconcile (which can write/reconcile). Live or unresolved attempts refuse
the run; new live work during the run aborts only the exact private test unit.
After exit, checks compare installed binary/config digests, every recorded host
attempt's interval/settings/protection/restriction authority, and base guest state,
accounts/configuration/candidate-target files. Legitimate concurrent host changes
are not silently reported unchanged. No production state is restored from a test
snapshot. Bounded private logs/results are retained for diagnosis; do not run
blanket workspace/archive cleanup as test artifact cleanup.

## Acceptance and current evidence

The updated Linux harness requires signed private workspace staging before Begin.
It verifies no start/current/original deadline or public work path, root-private
staging parents, receipt attempt/UID, exact directory inode publication and the
full allowance beginning only at Begin. This is ordinary starter staging, not
unified grants or saved-work migration qualification.

Local Python safety/helper tests pass; native uncached race/resource/default-size
qualification passes (core 105.1s), static build and vet pass. The initial overlay
runs exposed fixture defects: a regular wants-directory bind did not activate
the service; an incorrect setuid mode produced a root peer correctly refused by
the native guard; default nspawn seccomp rejected read-only clock verification.
Each run stopped its own container, preserved base/host evidence and was **not**
counted as passed qualification. Those runner defects are corrected without
relaxing account, clock, collection or deadline enforcement.

The full overlay run **passes all 39 assertions**: three handoff, two abandoned-
setup and 34 strict main assertions. This includes ordinary private staging,
real PAM/SSH route denial, detached writer termination, protected early finish,
restart/hold preservation, deadline access restoration, watchdog collection with
the gate stopped, unsafe link/FIFO omissions, hardlink failure preserving holds,
explicit repair/retry, immutable checksums and exact account restoration. The
container exited successfully; post-run installed binary/config/host-authority
and guest-base preservation checks passed. Private evidence is in
/var/tmp/ssh-exam-overlay-b9iptxja on csc-sys. Candidate exam-agent SHA-256 is
45e39c6c48c5ccc7965505d36ead76b8dbbfe8f640ecf3a3f900fc38d3a5f833
(native product source 7fdad62; no installed binary changed).

That initial Q1 run used the base fixture's legacy minimal rootfs. A later Q2
run stopped as instructed when Python was absent **inside that student rootfs**.
Python was already installed in both the guest OS and production; production
already uses host_filesystem=true/rootfs=/. This was a fixture setup mistake,
not a production package gap. No individual-tool allowlist/install is required.

## Q2: normal filesystem and real worker death

The guest wrapper now changes **only its disposable overlay** to the deployed
normal-filesystem model: rootfs=/, all public installed software/readable system
files, read-only root and real home, writable private /work/application state,
and private endpoint/work-base masks. It briefly stops/restarts only guest test
services around this overlay-only configuration change. It inventories public
executables in the same guest root, not a separate minimal toolchain image.
The base guest's packages are not identical to production: **629** public
executables are checked, not the historical production inventory of 2,152.

Use the runner's `--profile worker-isolation` for two synthetic guest accounts
and actual SSH PTYs. The fixture kills only the exact supervised collector PID
after checking its argv, test unit and pidfd identity. No production fault switch
or process-name kill is introduced. The target must retain COLLECTION_FAILED,
its original interval and hold. A second student must retain live terminal IO,
fresh pane admission, signed renewals, owners/generation/current/original deadlines.
Explicit retry verifies every original byte in four 10 MiB random files against
the protected archive. Both accounts restore only at their unchanged deadlines.

The final Q2 run **passes all 11 assertions**, including real Python with SSL,
SQLite and ctypes libraries, the public command inventory, read-only root/home,
hidden agent/state/control endpoints, zero student capabilities and no-new-privileges.
There were 23 healthy renewals; maximum acknowledgement was **0.084501 seconds**.
Container exit and host/base preservation checks passed. Private evidence:
/var/tmp/ssh-exam-overlay-ld_bqclt. A preceding ten-assertion run also passed;
the final repeat adds the explicit filesystem/capability checks.

The full `--profile enforcement` then **passes all 39 assertions again in
normal-filesystem mode**, with successful container exit and unchanged installed
binaries/config/host authority/base. Evidence: /var/tmp/ssh-exam-overlay-6e8srork.
Earlier peer-key and collector-observer fixture failures were not counted as
passes. The collector can finish in about 130 ms; a 10 ms bounded observer replaced
the original 500 ms polling so fault injection actually hits the real worker.
An initial relative-path hypothesis was not a confirmed product defect.

All **40** local Python safety/policy/helper checks pass (25 test_*.py plus 15
installation-checker tests), including normal-root configuration/mask regression.
Native binaries remain the Q1 artifact above; only test harness/setup changed.
This closes the narrow real worker-death/healthy privileged PTY qualification gate,
not persistent-disk/default-size/concurrent capacity certification. Cross-namespace
cleanup proof, saved restore/each-boundary crash qualification, worst-case capacity
and institutional student MFA remain separate gates. No claim here enables C3
retained-buffer freeze, C4 deletion or deployment.

## Q3: actual SSH-owner lifetime (October22, partial prerequisite)

The `monitoring-owner` profile adds a separately compiled static Go test binary
to the exact candidate manifest: build with `CGO_ENABLED=0 go test -c -o
core-qualification.test ./internal/core`. It is read-only inside the test input
mount, never installed in a native command path. The profile repeats the narrow
test five times. It refuses non-nspawn/non-fixture contexts, requires the exact
synthetic examq identity and private input/output mounts, and never creates an
ACTIVE seal, attempt, lease or continuation authorization.

After normal-root setup, the wrapper stops **only the overlay's** agent. The test
recreates that guest's removed RuntimeDirectory if necessary and refuses an
existing guard socket. Authenticated loopback OpenSSH invokes the actual
installed exam-login inode. SO_PEERCRED identifies the synthetic account/entry;
the native helper validates and pins its actual root SSH monitor. Two refused
ordinary-command requests on the same multiplexed transport must keep the same
live pidfd identity. Wrong-account pinning refuses. Closing only the owned SSH
master must produce exact process-exit observations. No ordinary shell/home result
is supplied and no server process is signalled. The wrapper then starts only its
guest agent before shutdown.

An initial run failed because stopping the guest service removed its runtime
directory. It was not counted as authentication qualification. The repaired
single test passes in0.25s; host binary/config/attempt authority and guest-base
preservation checks pass. Evidence is /var/tmp/ssh-exam-overlay-9hf_p5ye on
csc-sys. Candidate exam-agent SHA256:
336acee1c34c661533d48e3de225fb70c3bdad36a3a6ab7adbefe814eac6bfcf.
Test binary SHA256:
e9764a19307a19ad8207006b2c25f80372a15a92684ee5d61cd95610ea75dd66.
The first five-repeat profile passes (0.23..0.29s each), preserving host/base
evidence in /var/tmp/ssh-exam-overlay-xkvs9bgs. The final test binary additionally
contains a negative host guard (20 local race repeats pass in1.20s) and again
passes all five guest repetitions (0.24..0.28s each), with preservation checks:
/var/tmp/ssh-exam-overlay-orunyydb. Final test binary SHA256:
b15664a0ba6744eab1860adfde998182ea99f7e2a8d945fc5f9637b6958bec55.
All26 local Python runner checks pass. Full local native product compatibility
passes (core173.28s/CLI6.35s), static build/vet pass; the added negative guard is
separately race-tested. No race-instrumented guest binary is claimed.

This closes only the positive actual-SSH pinning observation for that exact
fixture. A live pidfd is not current registration/page/input-epoch authority,
network viability, all-writer freeze, input discard, permission to thaw or C3
completion. No host installation/service/account/record is changed or deployed.

## Q4: cgroup/PTY prerequisite qualification (October22)

The same manifested test-only binary also supports `--profile monitoring-freeze`.
It does not replace the gate socket or stop its guest agent. Five repetitions
each perform three actual descendant freeze/UID-verification/input-discard/thaw
cycles, retaining a synthetic in-memory value and exact process handles while
stopping/resuming a background file writer. An uncontained same-UID process must
refuse verification. A deliberately skipped discard makes every repeat RED with
STALE input; removed before final qualification.

Final15-cycle qualification passes on kernel6.8.0-111-generic with unchanged host/
base evidence at /var/tmp/ssh-exam-overlay-3u8w6mlt. Test binary SHA256:
5ca1c283f4120f52abb638c817065ce7b4cd938a48cfc36e962f3beb4aacf7ba.
This is not actual editor/retained SSH, closed native admission, cross-process
epochs or recovery qualification. Empty basic/SQPOLL io_uring setup succeeds as
the synthetic UID; deferred IO must be tested, not presumed disabled. Detailed
faults, artifact evidence and limitations: native-freeze-qualification.md.

## Q5: deferred IO and actual editor investigation (October22)

The exact manifest additionally includes `asyncio-probe`, a static unprivileged C
fixture built from tests/asyncio_fixture.c using the installed compiler/Linux UAPI,
not installed in the guest or a new production dependency. Explicit profiles are
`monitoring-async-io`, `monitoring-async-io-stopped` and `monitoring-editor`; each
has its own exact test/opt-in guard and bounded wrapper/test runtime. None replaces
the gate socket or enables retention. Negative host probes cover every profile.

Ordinary cgroup-only freeze fails the unchanged linked-write compatibility gate
on the tested kernel. The separate owned-pidfd stop-before-freeze experiment
passes36 IO cases; actual interactive Bash/Nano passes ten repetitions, thirty
cycles, with positive in-editor buffer acknowledgement, exact later saved bytes,
foreground pgrp/shell survival, discarded stale input and an originally stopped
job still stopped. Final test SHA256:
0e205925fe9dfb762bcc9726247ba8be68d9fc1f083ea5d0142ab7360c49843d.
Host/base preservation passes; detailed failed controls, limitations and private
evidence paths are in native-async-io-investigation.md. This is neither a general
root stop/admission barrier nor actual retained-SSH qualification. No kernel,
syscall policy, host installation, account or record is changed.

## Surviving-thread writer regression (October22)

The exact manifest now also includes thread-leader-probe, a static unprivileged
pthread fixture with a15s self-expiry. The writer-threads profile repeats the
exact guarded test five times: root-private inputs remain private; only a new
root-owned guest test directory receives the executable. It proves leader Z
with live writers, valid recorded cgroup containment/freeze, outside-worker
collection/restoration refusal, exact pinned termination despite a deliberately
different owned cached PID, resumed contained peer and unchanged deadlines.
The first input-permission fixture failure is retained, not qualified. Final
five-repeat profile,40 full actual SSH/PAM/Begin/protection/hold/watchdog/restart
assertions and11 real worker-death/healthy-PTY/admission/renewal assertions pass
with host/base preservation. Exact hashes, evidence paths, bounds and limitations:
writer-thread-groups.md. This fixes a narrow UID/writer correctness gap; it does
not complete retained SSH, all-root admission, cross-namespace cleanup or
temporary-agent consolidation, and is not a production diagnosis/deployment.

The subsequent test-only `monitoring-thread-tty` profile extends the same bounded
unprivileged fixture with private-buffer terminal acknowledgements. Ten paired
repeats pass60 cgroup-only/stop-assisted cycles with the main thread dead and
foreground worker live, exact memory/foreground/shell preservation, original
stopped job unchanged and stale terminal input discarded. Host/base preservation
passes; evidence /var/tmp/ssh-exam-overlay-r_r9rril. Negative host probes cover
this profile too. Exact artifact hashes and unchanged limitations are in
native-async-io-investigation.md. No live signal/admission/retained-SSH policy is
enabled; the separate linked-IO compatibility failure remains a release blocker.
