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

All 39 local Python safety/policy/helper checks pass (24 test_*.py plus 15
installation-checker tests); new directory-lock/no-setuid/filter regressions
cover the final runner safety additions. This rootfs is a volatile small-work
fixture, not persistent-disk/default-size capacity certification.
Real collection-worker death while another real privileged PTY continues,
cross-namespace cleanup proof, saved restore, concurrent worst-case capacity and
institutional student MFA remain separate gates. No claim here enables C3
retained-buffer freeze, C4 deletion or deployment.
