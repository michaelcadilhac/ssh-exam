# Native class-server installation

Local pending CLI update: [examctl workflows](../docs/examctl-workflows.md)
documents command-specific help, actionable refusals and private non-overwriting
exports. Full gateway-management coverage is still under investigation; this is
not a deployment receipt. Use `examctl help` to discover current commands.

Critical monitoring groundwork is local only: private authority/ownership and a
bounded provisional-metadata publisher do not enable a lease, retained SSH or
recovery mode. No public command launches that publisher. Its internal root-only
worker entries and proposed exam-publish.slice are not manual operator workflows;
do not invoke/install them against current exams. Provisional files cannot restore
permission after restart. Full native-peer/admission/input/freeze/CLI/web
coordination and qualification remain required; see
[native publication status](../docs/native-monitoring-publication.md).

The local immutable catalog candidate provides `examctl templates help` for
validate/install/list/show/verify/jobs/clean. It uses a separate bounded
exam-template.slice, not student/collection slots. It is not deployed; optional
native exact-version readers exist but current gateway snapshots remain legacy
until confirmation/issuance work. Local results say `gateway_confirmed=false`. Do not
select catalog hashes as legacy dashboard template IDs. See
[the catalog operator guide](../docs/template-catalog.md) for exact retry, manual
failed-job cleanup, storage/resource bounds and pending qualification.

This directory independently installs the compiled account gate, root SSH command agent, independent
watchdog/reconciliation timer, collector and root tools. Target: Debian 12/13, Linux systemd/
cgroup v2, OpenSSH privilege separation and bubblewrap. **Privileged installation remains
untested on a real class host. Leave readiness flags false until the manual suite passes.**

The separately installed [browser SSH relay](relay/README.md) supplies a fixed,
ticket-authenticated WebSocket path to sshjump through csc-sys's existing HTTPS
endpoint. Production terminals use the browser SSH worker; authorization and
signed receipts pass through the webserver. It is independent of the exam agent and its installation
does not restart SSH or exam enforcement services.

## Explicit read-only incident diagnosis (local candidate, not deployed)

The local new-preflight candidate exposes preparation_pending in read-only
inspection. Pending readiness/home checks admit no workload, account setup,
workspace or Begin. An unstarted pending preparation can be deliberately cancelled
with `examctl cancel ATTEMPT --reason REASON`; late checks cannot revive it. A
crashed pending-readiness reservation expires without starting the exam. See
[preflight isolation](../docs/preflight-isolation.md); no production change.

Unflagged legacy `examctl list/info` initialize native state and may reconcile
eligible access. For a non-mutating investigation, the local candidate supports:

```sh
sudo examctl list --read-only --active --json
sudo examctl info ATTEMPT_UUID --read-only
sudo examctl info ATTEMPT_UUID --read-only --state /var/lib/exam-agent
```

The explicit flag avoids initialization/chmod, locks, reconciliation, audit/state
writes, key loading, network and subprocesses. `--state` bypasses config/keys;
otherwise only the protected config's state path is read. Scoped paginated JSON
distinguishes captured state from separate lease observations; neither proves live
SSH/monitoring, archive integrity, freeze or execution permission. Exit1 with JSON
means partial observation, not confirmed expiry/misconduct. Preserve records and
retry, never reconcile/repair merely to inspect. These flags are not installed in
production. See `examctl help info` and
[native read-only diagnostics](../docs/native-read-only-diagnostics.md).

## Prerequisites and recovery

Keep a separate root recovery SSH session throughout changes. Back up passwd, group, shells,
SSH configurations and affected PAM files. Never change the administrator shell/group or close
recovery access to test student denial. Use disposable course accounts first. Install Go 1.27.2,
bubblewrap, systemd, OpenSSH, Python 3, procps and ripgrep. cgroup v2 needs cpu/memory/pids/freezer.

There is no inbound agent TCP service, independent tunnel, or general command polling. Deadline timing checks are the scoped outbound exception. Commands
arrive over the student's authenticated SSH connection (`exam-control`, non-PTY, bounded
signed stdin frame). Root checks the gateway Ed25519 signature, audience, account, expiry,
durable nonce, peer UID and root sshd ancestry. Keep the gate before all personal startup.

The agent needs outbound HTTPS to the gateway for signed status and archive callbacks.
Generate two separate Ed25519 key pairs with `openssl genpkey -algorithm Ed25519`: gateway
command signing and class-agent callback signing. Export each public key using `openssl
pkey -pubout`; exchange only public keys through administrator-controlled provisioning.
For an institutional outbound proxy, configure HTTPS_PROXY/NO_PROXY in an administrator-owned
service environment; TLS still verifies the fixed gateway origin and redirects are refused.
Install gateway-signing.pub and callback.key under /etc/exam-agent; the callback private key
stays on the class host and the gateway private key stays on the web host. Set agent_id,
gateway_public_key, callback_url (fixed HTTPS origin), callback_key and optional callback_ca.
Root owns config/private keys 0600 in directory 0700. Never log or pass private keys or
student credentials as command-line arguments. Verify the matching web configuration.

## Build/install

From this directory:

    go test -race ./...
    sudo ./scripts/install

Installs root:root 0755 binaries: /usr/local/sbin/exam-agent and examctl,
 /usr/local/libexec/exam-login and /usr/local/bin/exam-info. Root-private config/state:
 /etc/exam-agent (0600 files) and /var/lib/exam-agent (0700).
Units install under /etc/systemd/system. The script does not auto-edit SSH/PAM, enable
incomplete services or enroll real accounts.

Edit /etc/exam-agent/agent.json for signature trust, callback origin, state, rootfs, templates, work base
and approved account mapping. Original shells support /bin/bash, /bin/zsh and /bin/sh.
The example account mapping is illustrative; root approval must resolve actual identities.

Only if deliberately using the legacy separate-rootfs mode, build a reviewed
toolchain root at /srv/exam-workspace/rootfs, for example using debootstrap
with the institution's package mirror, then install Bash/Zsh, coreutils, editors/compiler and
ncurses-term. Include /usr/local/bin/exam-info. It must contain no host homes/secrets/control
sockets, privileged hooks or future materials. Test chosen tools/TERM inside the actual sandbox.
Do not copy the live host root. Version the legacy rootfs and template installation
inputs. Normal-filesystem mode below instead uses rootfs=/ and the original installed
system, without building another root or reinstalling its packages.
The generic config/agent.example.json still illustrates legacy-rootfs paths;
install-host-filesystem explicitly proposes rootfs=/, host_filesystem=true and
reviewed private-path masks. Its default remains a dry run, not deployment authority.

### Normal server filesystem (deployed student environment)

Use `"host_filesystem": true` with `"rootfs": "/"`. The student receives a read-only
view of the normal server filesystem, including installed programs, libraries,
headers, modules, public configuration and documentation. No software allowlist or
second package installation is needed. The legacy separate `rootfs` mode remains
available for existing installations.

The actual student home is mounted read-only at its original `/home/...` path (or
`/home/student` for homes elsewhere). Shell/editor configuration is read normally;
application cache, data, history, runtime and editor state use disposable storage.
Other homes are hidden. `/work` is the writable attempt directory; `/materials` is
only the active exam's read-only material. `/tmp` and `/var/tmp` are private to the
attempt/phase. PID, network, IPC, UTS and cgroup namespaces remain isolated, `/proc`
and `/dev` are private, and `/sys` is hidden. Student capabilities remain zero.

Host service sockets need separate protection: read-only mounts still allow UNIX
socket connections. `/run`, agent configuration/state, protected storage and work
bases are hidden. Root-only `host_filesystem_hidden_paths` lists additional private
exam installation trees and site-specific service socket directories. Readiness and
every new pane check `/proc/net/unix` and reject uncovered host service sockets.
Sockets under ordinary `/var/run` aliases resolve to the hidden `/run`. A live host
socket in the student's home blocks admission; finish quiescing its owner first.
Do not enable new host services during exams without reviewing their socket paths.

After building the native binaries, stage a bundle containing `exam-agent`,
`examctl`, `exam-login`, `exam-info`, `enroll-accounts` and a `checksums.json` mapping
those names to SHA-256 values. On the class server run:

    sudo ./scripts/install-host-filesystem --bundle /path/to/bundle
    sudo ./scripts/install-host-filesystem --bundle /path/to/bundle --apply

The default is a dry run. Installation requires all exams and preflights drained,
account restrictions restored and no remaining workload cgroups. It stops admission
under the state lock, backs up binaries/configuration, installs the verified bundle,
records service socket exclusions, and removes the earlier per-toolchain mounts and
dependencies. No student account, sudo setting, deadline or submission is changed.
Failures restore the previous configuration, binaries, mounts and services. Successful
installation prints a root-private `/var/backups/ssh-exam/*-host-filesystem-*` backup
containing `files.json` and a qualification receipt. To roll back later, first drain
attempts and stop admission/watchdog/reconciliation; restore the numbered files using
`files.json` (remove paths recorded as null), reload systemd, restore any recorded
mount units parent first, then restart the services. Never restore old attempt state.

Qualify the installed environment without enrolling a real student:

    go test -c -o /tmp/exam-core.test ./internal/core
    sudo env EXAM_TOOLCHAIN_ROOTFS=/ EXAM_TOOLCHAIN_CONFIG=/etc/exam-agent/agent.json /tmp/exam-core.test -test.run '^TestInstalledStudentToolchain$' -test.v

The test uses an unused unprivileged UID and the real launcher to exercise GCC/G++,
GDB, Python, Java, editors, public commands, ordinary home reads, read-only home and
software, private temporary storage and zero capabilities. Also run it in a transient
service matching the agent's hardening settings. The administrator sandbox continues
using its unrestricted host environment.

The following rootfs-building instructions apply to the legacy separate-rootfs mode.

Pre-create the bind mount destinations before mounting the rootfs read-only:

    sudo install -d -m 0755 /srv/exam-workspace/rootfs/home/student /srv/exam-workspace/rootfs/work /srv/exam-workspace/rootfs/materials /srv/exam-workspace/rootfs/tmp /srv/exam-workspace/rootfs/var/tmp

Use the configured exam directory instead of /work if customized. Native readiness rejects
missing home/materials and temporary mount points (real directories, not symlinks); bubblewrap cannot create them inside the read-only tree.
Include /usr/bin/setpriv from util-linux in the rootfs. The root launcher creates private
mount, PID, network, IPC, UTS and cgroup namespaces, then the root-controlled setpriv drops
to the real account UID/GID, clears supplementary groups and all capability sets, and sets
no_new_privs before starting the shell. Preserve real UID ownership; a single-user namespace
mapping of the privileged launcher would make student-owned /work inaccessible.
The root service keeps NoNewPrivileges enabled and explicitly retains only SETUID, SETGID
and SETPCAP as ambient setup capabilities across exec. These must never reach student code;
verify real/effective/saved/filesystem UIDs, zero CapInh/Prm/Eff/Bnd/Amb and NoNewPrivs=1 in
an actual gated terminal during installation qualification.

    sudo install -d -m 0700 /var/lib/exam-agent/templates
    sudo cp -a examples/sample-exam /var/lib/exam-agent/templates/sample-exam
    sudo chown -R root:root /var/lib/exam-agent/templates

See [Creating an exam template](../docs/template-authoring.md) for the complete authoring guide.
Templates contain work/ starters and materials/ read-only questions. Work initializes once at
activation; every later pane shares it. No /etc/profile changes or information hooks are needed.

An optional `materials/WELCOME.txt` is printed before the login shell in each
timed exam terminal. `[DEADLINE]`, `[USER]` and `[EXAM-NAME]` expand to the current
deadline (explicit Chicago timezone), account username and exam display name.
Missing/empty files produce no exam banner; practice keeps its own notice.
Use a regular UTF-8 file up to 64 KiB, without symlinks/hard links. Invalid files
are skipped with agent diagnostics. See the authoring guide for an example and
the exact substitution behavior; reading the source with `cat` does not expand it.

Preflight has a separate fifteen-minute limit from its initial preparation timestamp.
The local watchdog cancels an unstarted preparation at that limit even if its page
continues heartbeating or the webserver is unavailable. It stops practice workloads
and removes disposable state, then restores any temporary unstarted account setup.
Students may sign in again to obtain a fresh preflight. The timeout does not consume
exam time or cancel an exam whose start was already committed. Original/current exam
deadlines and access holds remain independent.

## Private temporary storage

Each attempt has writable, private `/tmp` and `/var/tmp`, shared across its terminal
panes. `TMPDIR=/tmp` is supplied to the initial shell. Both production bubblewrap
workloads and the explicit administrator test/sandbox launch path bind only that
attempt's directories; neither exposes the host's ordinary temporary files. Practice
uses a separate pair, so preflight scratch files do not carry into the timed exam.

Backing directories are disk-backed under
`<state>/temporary/<attempt>/{practice,exam}/{tmp,var-tmp}`. Parent directories are
agent-owned `0700`; mounted leaves are agent-owned sticky `1777`, applied explicitly
after creation so the agent's `0077` umask cannot make them unwritable. Students cannot
traverse the protected parent or replace a bind source. Source setup rejects links
and unsafe parents. Capacity comes from the agent state filesystem; leave free space
for temporary files as well as protected submissions. The collection size limit is
not a quota on temporary writes.

Temporary files survive closing/reopening panes, authorized pause/reconnection, and
agent restarts. They are excluded from submissions: save answers in the configured
exam directory. After verified collection and confirmed workload termination, the
agent removes temporary storage without following student links. Failed termination
retains it; cleanup failure keeps finalization recoverable and retries use the same
protected submission. Cancelled preflight cleanup is retried by reconciliation. This
is disposable attempt storage, not a guarantee of `/var/tmp` persistence after the
attempt or protection from disk/server failures.

On upgrade, drain existing attempts before replacing the native binaries. Ensure the
rootfs has real `/tmp`, `/var`, and `/var/tmp` directories before making it read-only;
readiness and `scripts/verify` reject missing or symlinked mount points. No new
configuration key or ordinary-account access-policy change is needed. A running
terminal's existing mount namespace is not changed in place.

## Account policy, SSH and PAM

Review config/sshd-exam.example.conf and config/pam/README.md. Match Group exam-managed applies
ForceCommand exam-dispatch, PermitUserRC=no, no forwarding/agent/X11/tunnels and MaxSessions 8.
Configure an external SFTP subsystem globally. Verify ForceCommand on every SSH listener and
subsystem. Hooks apply only while temporary exam-managed membership is present.
The compiled actual account shell runs before personal startup; EXAM_ID labels are not credentials.

Set `temporary_account_policy: true`. Keep `accounts` empty except explicit trusted administrator
sandbox exceptions. Web enrollment and signed SSH/NSS verification replace manual student
allowlists; do not run the legacy `enroll-accounts` script in this mode. Enrollment, sign-in
and practice leave ordinary shell, forwarding, local access and user services unchanged.

The student's explicit Begin exam confirmation journals the exact original policy, temporarily
sets the gate shell/SSSD override and exam-managed membership, and disables lingering. Existing
jobs or system services that cannot safely be isolated cause qualification to fail without
changing or deleting jobs. The browser automatically authenticates a new class transport using a short-lived,
attempt-specific certificate, retaining its jump connection and the same preflight.
Students are not asked for another password or phone approval. Opening another channel
on the bootstrap connection cannot start time or reveal material.
Setup expires after five minutes and the watchdog restores a provably unstarted account.

Actual exam activation terminates conflicting processes and commits the original deadline.
Finishing early does not restore the account. After both original/current deadlines and
verified secured collection/writer termination, the independent reconciler restores the
exact baseline and verifies effective NSS, SSH, groups and lingering before marking RELEASED.
Restoration failure stays visible/retryable; it never declares successful release. Normal
SSH/SFTP/commands/forwarding then work without the exam agent.

The fixed root helper `/usr/local/sbin/exam-account-policy` runs through systemd-run outside
the daemon's read-only filesystem namespace; no setuid binary or general account-control API
is installed. Keep root-private `state.json` and `account-policy/UID.json` recovery records.
Set the new `temporaryAccountPolicy` guard only after installation qualification, including
per-user SSSD override round trips without per-attempt global restarts where applicable.
See [temporary policy](../docs/account-admission-proposal.md) and
[recovery](../docs/recovery-runbook.md).

    sudo sshd -t
    sudo sshd -T -C user=student01,host=class.example.edu,addr=JUMP_HOST_IP
    sudo systemctl reload ssh
    sudo ./scripts/verify

Use a disposable account to test ordinary login, external SFTP, exec zsh/profile variants,
~/.ssh/rc, remote commands, internal-sftp, all forwarding/listeners, old connections/new
channels, cron/at/user services, concurrent admission, pre-existing writers and one-use
cross-transport replay. Binding depends on a root sshd [priv] ancestor and PID start time;
unsupported process layouts deny admission. Compilation alone does not validate these guards.

## Containment and deadline

Prepare closes ordinary admission. Activation kills conflicting sessions and unregistered UID
processes while preserving the verified gateway transport, requiring validated PAM placement.
Independent PTYs run in root-controlled systemd scopes under exam.slice. bubblewrap isolates
network/PID/mount/IPC/UTS and proc/dev/tmp, with writable /work and read-only
/materials. Normal-filesystem mode uses the original server root and actual home
read-only with the private-path masks described above. The following home snapshot
description applies to legacy separate-rootfs mode: HOME is a read-only configuration
snapshot at the student's usual `/home/...` path
(or `/home/student` for other layouts). It preserves Bash/Zsh, Emacs/Vim/Nano, `.config`,
`.local/share` and `.local/bin`, including safe internal dotfile links. Host sockets,
SSH/GPG stores and unrelated home documents are not exposed. The original home and its
permissions remain untouched. Writable cache/data/state/runtime and seeded Emacs/Vim
directories are disposable, shared across panes, and separate for practice/exam. Per-pane loopback is independent.

The gateway receives no root SSH credential or arbitrary-command agent operation.
Agent root privileges are needed for namespace/PTY/UID setup, cgroups, killing writers and
safe collection. ProtectSystem/ReadWritePaths constrain writes; PrivateUsers and
ProtectControlGroups are intentionally absent because they break required operations.

    sudo systemctl enable --now exam-deadline-watchdog.service exam-agent.service exam-reconcile.timer
    sudo examctl health
    sudo journalctl -u exam-agent -u exam-deadline-watchdog

The independent watchdog freezes lease loss and finalizes at canonical UTC deadline with a
same-boot monotonic guard. Review locks never pause time. Generation-bound continuation is
expiring/single-use; lease renewal cannot unlock it. Reconciliation catches missed work after
downtime. Reboot ends prior workloads, retains files and preserves exclusion. Total power/root
failure is not an availability guarantee.

## Collection, export and recovery

Local workspace-receipt safety candidate (not deployed) also rejects FIFO,
linked/public and ambiguous JSON workspace-ready receipts through pinned bounded
reads. Begin errors print exact read-only inspection and workspace-prepare help.
Preserve receipts, staged/student work, original intervals and sources; never
fabricate metadata, recopy changed source or restart time to bypass refusal.
Committed publication repair remains separate and cannot reopen an attempt.
See docs/workspace-receipt-safety.md for exact local/guest evidence and limits.

Local recovery-metadata safety candidate (not deployed) refuses unsafe/linked/
public/special or ambiguous legacy grant/consumption files before Begin and uses
bounded reads during publication retries. Do not remove markers, edit JSON,
choose starter files or release/restart an account to bypass refusal. Use the
printed exact `examctl recovery-grants --exam EXAM` and
`examctl info ATTEMPT --read-only` commands; preserve all source archives,
staging and original intervals. Native private catalog directories must be real
0700 owner-matched directories. Inspection is metadata, not fresh archive/live
permission proof. New unified issuance and declared expected-source compatibility
remain separate open work. See docs/recovery-metadata-safety.md.

Host work: /srv/exam-workspace/work/<opaque-attempt>/work, shown as the trusted agent
`exam_directory` setting (default /work). Provision that directory in the read-only rootfs. Only saved files are
collected. Students do not submit, upload or archive anything. The optional Finish exam button and
independent deadline watchdog use the same collector. Ordinary access remains blocked until
all scopes and their background descendants freeze and cgroup.events confirms it. The UID
process scan refuses uncontained writers; verified SSH/gate entry stubs are the only exceptions.
New directory access is revoked through a verified descriptor before collection. Existing
write descriptors are made safe by the writer barrier, not by directory permissions alone.
os.Root/O_NOFOLLOW/inode checks reject escapes, mounts, hardlinks and regular-file limit failures.
Symlinks/special entries are omitted with manifest records. The webserver suppresses
omission email for a routine Emacs `.#NAME` symlink only when the saved sibling `NAME`
is in the same submission. The omission remains in the manifest; all other omissions
and collection failures still alert. Limits: 10,000 entries, depth 32,
32 MiB per file, 64 MiB logical total including sparse files. Never silently truncate or execute.

A private staging directory is flushed and renamed as one complete archive/manifest/checksum
bundle under
/var/lib/exam-agent/submissions/<attempt>/. Manifests contain identity, template/settings,
fixed timestamps, completion reason, file hashes and omissions/outages. Archive checksum stays
outside the archive. The external manifest includes the archive checksum plus actual
completion, collection and protection timestamps; the effective expiration end remains the
confirmed current deadline, with the immutable original and reset history preserved. Signed status callbacks and `examctl manifest` provide this actual file inventory.
A crash after bundle publication but before state persistence adopts the verified bundle,
without reading or replacing live work. Damaged/incomplete bundles fail closed and require
root recovery; do not remove a secured bundle to force recollection. Grade in a separate sandbox, never by executing/unpacking in the app.
Access returns only after the original deadline has elapsed AND protection and workload termination are verified. Early completion keeps the account held. Archives stay on the SSH server. Signed status/manifest callbacks are independent of
student SSH; receipt delivery pending differs from collection failure, which retains exclusion.

    sudo examctl info ATTEMPT_UUID
sudo examctl info --exam sandbox
    sudo examctl retry ATTEMPT_UUID --reason "Retry collection after fixing storage"
    sudo exam-agent -config /etc/exam-agent/agent.json -reconcile

For full disks add protected capacity before retrying. Restore watchdog before agent access.
For changed keys/expired HTTPS certificates or rotated signature keys install verified replacements and test/reconcile.
Keep failed archives/workload/account excluded; retry signed status delivery without recollecting mutable work.
Root break-glass requires independently protected saved files, killed writers, verified archive
and audited disposition before restoring recorded access. No remote force-unlock exists.

No automatic local submission deletion is configured. Retain local copies until the separate institutional retention policy permits removal. Monitoring is gateway-side. Back up state,
original mappings and archives consistently; editor buffers/SSH objects cannot be restored.

## Rollback

Collect/recover every guarded attempt and wait for its original deadline/access release first:

    sudo ./scripts/uninstall

It refuses unfinished/failed collection, early-completed held accounts, and missing administrator state, restores recorded shells/removes managed membership
and disables services while keeping archives/state. Restore backed-up SSH/PAM, remove the gate
from /etc/shells after no accounts use it, run sshd -t, reload SSH and test ordinary disposable
login/SFTP. Review any disabled job policy before restoring it. Keep root recovery until verified.

Collection errors persist in root-private state and audit records and emit journal messages.
The gateway queues instructor alerts on reconciliation; while it is unavailable, configure
institutional journal monitoring for independent class-server failure notifications.
The watchdog cuts off writers without any browser or gateway connection. Expiration collection waits for signed timing verification; unavailable verification leaves work frozen and retries until the gateway recovers.

The watchdog runs a read-only deadline cutoff independently of the archival/state flock.
Long compression or a stuck control request cannot postpone another attempt's freeze.
It reads the last atomically committed state, freezes expired cgroups and lets serialized
reconciliation collect them. One freeze error does not skip other due attempts.

## Original-interval account isolation

Attempt completion and access restriction are separate: root state.json records HELD,
RELEASED or OVERRIDDEN plus original deadline and hold/release timestamps. A 10:00 start,
10:40 finish and 11:30 deadline produces a protected submission at 10:40 while ordinary
SSH/commands/SFTP/SCP remain blocked until at least 11:30. No finished attempt can resume.
A locked unfinished attempt still uses instructor authorization and its original deadline.
The account gate checks every channel; stale practice/registration capabilities fail closed.

Activation closes ordinary admission, terminates old login/user-service sessions, scans all
four process UIDs and confirms no uncontained process survives, then durably commits the
hold/deadline in ACTIVATING before initializing material. Interrupted initialization needs
recovery. The static account shell and SSH ForceCommand run the gate before user startup.
Do not exempt localhost, variables, existing transports, remote commands or subsystems.

Install scripts/check-isolation as /usr/local/sbin/exam-check-isolation (scripts/install does
this). scripts/verify and native Ready execute it. It checks effective SSH settings in two
address contexts, gate shell/groups, AcceptEnv/RC/forwarding, alternate PAM denial, lingering,
queued cron/at work, system cron and loaded services running as managed accounts. This can
require removing queued jobs before exams. Keep a separate administrator session. Test every
actual listener/Match branch, system timer/job, enabled filesystem service and root code that
can switch to student UIDs; the automatic checker alone cannot certify arbitrary root code.
The four new readiness flags default false; existing signoffs must be repeated after upgrade.

Per-UID restrictions do not affect unrelated accounts. Missing/corrupt initialized state,
collection failure, damaged protected bundles or unconfirmed termination retain the hold.
The watchdog, CLI and local socket reconcile expired completed holds against the verified
protected bundle. Forward clock changes cannot release before same-boot elapsed time.
Submission deletion is rejected while a hold remains. Back up initialized, state.json,
config/UID mapping, manifests/archives and audit together; never replace state with an empty
map to regain access. Old completed records migrate conservatively to HELD until verified.

A deliberately separate root-only emergency operation releases an already protected,
terminated account before its deadline:

    sudo examctl -reason 'Emergency course account recovery approved by administrator' override-access ATTEMPT_UUID

The audit records UID/effective UID, sudo user, reason, original deadline and timestamp before
release; audit failure prevents release. This operation is absent from gateway HTTPS and
student socket APIs. It never resets time, overwrites work or permits exam continuation.
Unsecured attempts must be recovered/collected first. Inspect audit.ndjson after use.
Rollback refuses HELD accounts even when COMPLETED; reconcile release after the deadline or
perform this explicit safe override before uninstalling. Restore recorded shells and service
policies only after all outstanding holds have ended. Keep archives and their separate retention.

Adversarial tests run with `go test -race ./...`: real unprivileged disposable OpenSSH checks
remote commands/shell/SFTP/SCP, a retained ControlMaster connection and forged variables against
the peer-verified Unix account gate. The harness uses ForceCommand, not a replacement system
account; production pre-startup/PAM/cgroup/scheduler isolation requires the disposable managed-
account deployment matrix. Tests also cover original-interval holds, recovery, missing state,
protected-copy corruption, other UIDs and durable override failure.
# Trusted administrator functional testing

For the explicitly authorized, single-account test on `csc-sys`, follow
[the installation and rollback plan](../docs/full-exam-test.md). The separate
listener or explicitly installed root-owned gate command preserves ordinary administrator access. This mode reports
`production_ready=false`, labels submissions, and cannot qualify student isolation.


Root may additionally opt into `functional_host_access=true` for that single trusted
identity. It runs authorized panes as normal host user services in exam.slice, with the
real NSS home/shell, host-installed Emacs and other tools, supplementary groups, network
and existing account privileges. Only /work is collected; materials remain read-only.
Whole-service cgroups are tracked for closure, lock and collection. Never enable this for
production students. Configuration rejects this flag without the functional account, and
readiness verifies the configured home/shell against NSS. The root agent retains its
NoNewPrivileges=yes setting; these separate trusted user services retain ordinary privileges.

Every LOCKED pause now ends recorded workload scopes/services. Gateway closes both student
SSH connections. One generation-bound authorization permits a fresh SSH transport attach
and continuation; old transport identity or consumption without fresh attach is rejected.
Watchdog lease expiry applies the same policy. Saved files remain at the original deadline;
unsaved editor state is lost. The local deadline watchdog stays independent.


## Local examctl administration

Local health/readiness corrections (not deployed): `examctl help health` explains
outside-state observations, unavailable/busy versus permission and uncached Begin
guards. Configured-account NSS lookups share a five-second budget, bounded4KiB
stdout per account and250ms retained-pipe drain. A provider timeout/failure is
unavailable verification, not a confirmed account change or student violation.
Verify NSS and retry `examctl health`; inspect `examctl agent status` without
restarting active exams. These are not bounds on every filesystem/state/checker
operation or a host-wide probe/process limit. See docs/native-health-isolation.md
and docs/native-readiness-accounts.md for exact local/remaining guest evidence.

Local recovery-consumption candidate (not deployed): `examctl help
workspace-prepare` and `examctl help workspace-repair` explain writable supported
consumption storage, early unpublished probes and complete atomic no-replace
markers. Actual disk-full/read-only faults retain their IO category and the
original interval/hold. After restoring storage, repair only the existing private
publication, then explicitly secure it; never reset time, remove an ambiguous
marker or overwrite saved work. Existing malformed/foreign markers still refuse.
Matching consumed UUIDs also refuse when their original committed interval is
missing/inconsistent; preserve the records for diagnosis, never invent clocks.
The same36-byte UUID format is retained, but O_TMPFILE/own-procfd publication must
be qualified on the actual hardened target. See docs/recovery-consumption-atomicity.md
for current local tests and remaining gates, not a deployed fix.

The following local extraction correction distinguishes storage copy/sync/close
failures from saved-file hash mismatches. On ENOSPC/readonly staging failures,
verify/restore storage and retry the supported private preparation; the printed
refusal preserves the cause and unchanged-clock status. Do not replace a valid
protected source or remove a marker. See docs/recovery-storage-diagnostics.md;
this later artifact is not privileged-qualified or deployed.

Local pane-management candidate (not deployed): `examctl help panes` explains
bounded offline `panes list ATTEMPT`, `panes show ATTEMPT PANE` and reviewed
`panes close ATTEMPT PANE --revision SNAPSHOT --reason TEXT`. Reads never initialize,
reconcile, repair, load keys or contact services; `--state DIR` permits inspection
without config. Close needs real/effective root, the current exact pane revision
and8..1000 UTF-8 bytes of reason; audit must succeed before revocation/control.
It irreversibly terminates only that recorded pane/descendants (unsaved buffers
may be lost), not peers, clocks, account restrictions, grants or protected work.
After a lost reply inspect again, retaining the OLD reviewed revision; never
silently adopt a replacement. Legacy/startup-unverified scopes remain tracked and
refuse close rather than invent readiness. Matching native launchers and verified
drain are future compatibility prerequisites; no service change is authorized.
This is not C3 retained SSH or proof of cleanup eligibility. See
docs/native-pane-management.md for the full safety/qualification record.

The local configuration-inspection candidate works without initializing native
state or contacting a service: `examctl config show` reads selected metadata with
path redaction; `examctl config validate --config /private/staged-agent.json`
additionally checks bounded pinned keys/optional CAs. Use `examctl help config`.
Explicit --paths includes configured paths, never key material. An offline valid
candidate is NOT loaded configuration, enforcement readiness or work permission;
applied is always false and no apply/restart workflow is enabled. Preserve files,
keys, state and holds; use separately authorized drained maintenance for changes.
See docs/native-configuration-inspection.md for exact scope/current qualification.

All operations require root; help is available without privilege. Unflagged legacy
native workflows share watchdog state/locks and may reconcile during list/info.
The explicit local `--read-only` observation path takes no state lock or write;
see the incident workflow above. No separate HTTP API is installed. Use attempt
UUIDs to address an individual student's run.

```sh
sudo examctl list
sudo examctl list --active
sudo examctl list --active --exam sandbox
sudo examctl list --json
sudo examctl info ATTEMPT_UUID
sudo examctl health
sudo examctl accounts
sudo examctl start ATTEMPT_UUID --reason 'Operator activates prepared attempt'
sudo examctl pause ATTEMPT_UUID --reason 'Operator requests fresh monitored login'
sudo examctl stop ATTEMPT_UUID --reason 'Operator ends this attempt locally'
sudo examctl retry ATTEMPT_UUID --reason 'Storage issue corrected; retry protection'
sudo examctl cancel ATTEMPT_UUID --reason 'Abandoned preparation; never started'
sudo examctl manifest ATTEMPT_UUID
sudo examctl export ATTEMPT_UUID > submission.tar.gz
sudo examctl export-status ATTEMPT_UUID
sudo examctl pause-export ATTEMPT_UUID --reason 'Historical test archive retained locally during migration'
sudo examctl reconcile
sudo examctl agent status
sudo examctl agent stop
sudo examctl agent start
sudo examctl agent restart
```

Submission archives never upload to the webserver. `examctl export` retrieves a verified
protected copy locally; `export-status` reports SSH-server storage and any historical transfer
record. Legacy pause metadata remains readable. `resume-export` rejects attempts to re-enable
automatic transfers. Signed completion/status and monitoring callbacks continue independently.

Gateway monitoring is separate from protected submissions. The local candidate
`examctl web monitoring export ATTEMPT --output NEW_DIR` retrieves original/derived
captures, raw recording prefixes (including incomplete tails), metadata/history
and a hash manifest through the existing root-agent authenticated outbound HTTPS
route. It requires separate monitoring.export authorization and matching gateway/
CLI; it never uploads or copies protected archive bytes. Destination must be NEW
under a real private parent. Require exit0/confirmed:true, not just existing files;
failures retain explicitly incomplete/unconfirmed private output. Retry the printed
request UUID with another NEW destination. Downloaded monitoring has independent
operator retention and is not a protection/freeze/permission proof. See
docs/monitoring-cli.md and docs/monitoring-export-plan.md. Local only, not deployed.

`--active` means started and unfinished, including locked/finalizing/collection-failed.
The full list also shows preparations, completed submissions and their independent access holds.
`start` activates an already prepared attempt; it never creates an enrollment or resets time.
`stop`/`finish` collect the selected attempt now, retain the original hold, and never stop
other students or the shared daemon. Mutations require an administrator reason recorded in
root-private audit state. `delete` removes the protected original only after completion and
access release; archives have no automatic 60-day monitoring retention.

`agent stop` stops only the SSH command gate. The independent deadline watchdog and persistent
reconciliation timer keep running. Start/restart ensure those services are running before the
gate. Never kill the watchdog or erase state to end an exam. Gateway outage: collection and
account exclusion continue; status/archive callbacks remain durable and retry without idle
HTTP polling. Agent stop/restart closes interactive workloads through existing supervision
and execution leases; saved files persist and original deadlines do not change.

Before upgrading, drain attempts, back up state/work/archives/account mappings, install both
new gate and agent binaries, configure the two signature identities and outbound HTTPS,
update web configuration and verify signed callbacks plus fresh SSH commands. The old
listen/cert/key/ca/client_name configuration and inbound 9443 listener are removed. Close the
old firewall/tunnel only after confirming the new route. Roll back binaries/config together
with original state/deadlines; never restore a stale state over a later secured submission.

## Production administrator sandbox

An administrator can retain normal host access while the same agent enforces real student
exams. Set `sandbox_only: true` on that identity's root-owned account entry; keep its
original NSS home/shell and **do not** put it in `exam-managed`. It may be enrolled only
in the reserved `sandbox` exam. The server and cached signed roster registry both reject
ordinary-exam use. Its tracked host terminals preserve its home and administrator rights;
only their recorded workloads are stopped/collected. Attempts/manifests record
`administrator_sandbox: true`; the UI labels this explicit exception. Other account entries
use the strict student policy, including UID cleanup and original-deadline holds.

Remove the global `functional_test_account`, `functional_test_until` and
`functional_host_access` fields when transitioning to production. Do not remove or
rewrite old attempt/submission state. After draining, install the account policy with
`sudo scripts/install-account-policy --administrator ADMIN --apply` on the reviewed
Ubuntu/Debian PAM layout. The installer backs up changed files, validates SSH and verifies
that the administrator has no ForceCommand before reloading; it does not enroll students.
Run without `--apply` to inspect the proposed changes. Its conditional PAM rules preserve
non-managed users' session and environment behavior. Enroll actual course identities later
with the root account-approval procedure and repeat the machine checks before admissions.

Tailscale SSH embeds an SFTP server and is not covered solely by OpenSSH ForceCommand.
The machine checker inspects its current SSH policy and refuses any rule covering a managed
student identity or a wildcard. Administrator-only Tailscale access can stay enabled.
See [the upstream implementation](https://github.com/tailscale/tailscale/blob/main/ssh/tailssh/incubator.go).


## Recording limits and instructor clock resets

Set `terminal_recording_limit_mib` in root agent configuration and
`terminalRecordingLimitMiB` in gateway configuration to the same positive integer (MiB).
Both default to **2048**; permitted range is 1–1,048,576. Restart the services after changing
configuration. This is a shared per-attempt persisted NDJSON budget, including Base64 and
metadata across every pane. It excludes images and submissions, whose limits/retention are
unchanged. Capacity-plan protected storage for concurrent students and 60 days of monitoring.

Root state preserves `original_deadline`, current `deadline`, `clock_revision`, and immutable
`clock_resets` history. Instructor resets arrive on signed student SSH control channels while
connected. At the locally committed deadline, writers freeze independently of HTTP; the agent
then makes a signed HTTPS POST to `/api/agent/timing` before collection. A signed nonce-bound
reply delivers an outstanding reset or authorizes collection at that exact deadline/revision.
There is no general command polling or new inbound listener. Failed timing checks use a
5-second timeout, retry at 30-second intervals and leave collection explicitly pending and
access held; they do not package possibly superseded work. Original and current deadlines
must both elapse before ordinary access release. Shortened clocks retain the original hold.

Install updated agent/gateway as a coordinated upgrade after active exams drain. Verify
`examctl health` advertises `clock-reset` and `deadline-timing-check`, fixed outbound HTTPS and
both signing identities work, and test a disconnected reset/outage/recovery before signoff.
`examctl info ATTEMPT_UUID` shows timing verification and reset history. Restore gateway
availability/trust for pending timing decisions; never discard state or use an older collector
to bypass them. Already persisted collection permission permits restart recovery even if the
webserver subsequently disappears. Successful early Finish still collects immediately.

## Student configuration and application state

Create real rootfs `/home`, `/run` and `/usr/local/bin` directories; `scripts/verify`
and readiness reject missing/symlinked mount points. `/run` and `/home` are private
namespace views. Keep the normal toolchain and required editor packages in rootfs.

Root-only optional `home_config_paths` adds home-relative configuration dependencies,
for example `["dotfiles", "emacs-config", "shell-helpers"]`. Use it when startup code
loads custom paths beyond the standard configuration trees. Absolute paths, parent
traversal, reserved agent metadata, SSH/GPG stores and outside-home symlinks are rejected.
Configuration snapshots are limited to 256 MiB total, 32 MiB per regular file, 30,000
entries and depth 48. Oversized/unsafe/unreadable configuration fails preflight rather
than silently dropping settings. Home content is snapshotted once; changes made outside
preflight require a fresh preflight attempt to be incorporated.

`XDG_CONFIG_HOME` reads the configuration view; XDG cache/data/state/runtime and standard
shell/repl history variables point to disposable storage. `.cache`, `.local/share`,
`.local/state`, Emacs configuration directories and `.vim` are mounted onto seeded
private writable leaves. Copying to the home root or modifying startup files fails;
writes under those application leaves are temporary and never reach the real home.
Emacs and Vim launchers in the exam `/usr/local/bin` redirect their usual backup,
autosave and history locations while retaining normal user initialization. Other
local tools are retained through a read-only original-tool directory. Custom init
code that overrides state paths must use the supplied XDG paths; arbitrary writes
to protected locations remain errors.

Storage is `<state>/temporary/<attempt>/{practice,exam}/application`; original configuration
snapshots remain under root-private `<state>/homes/<attempt>`. Retain them through
collection/termination failures. Confirmed termination with secured collection or
pre-start cancellation removes both, without following student links. Nothing enters
the submission archive and no state/config changes are copied back to the real home.

The administrator sandbox bypasses configuration snapshotting, application redirects
and editor launchers. Its real HOME, configuration, tools and administrator access
remain unrestricted. Drain attempts for native upgrades; cancel old unstarted preflights
and reopen them to obtain the new snapshot format. No running pane is remounted in place.

### Automatic protected SSH handoff

Install `scripts/exam-principals` root-owned at `/usr/local/sbin/exam-principals`, then run
`scripts/install-handoff --administrator ADMIN` to review and add `--apply` to install.
This creates the separate root-only `/etc/exam-agent/handoff-ca` and its public key, a
`05-exam-handoff.conf` SSH drop-in, and `handoff_ca` in agent configuration. It preserves
ordinary authentication, SSSD authorized keys, administrator access and forwarding settings.
It refuses to overwrite an existing unrelated CA/principals command or weaken authentication.
The effective global SSH configuration must include this drop-in; run `scripts/verify`.

The worker sends only an ephemeral public key. `issue-ssh-handoff` requires a signed,
transport-bound request for the owner's unstarted READY attempt. The certificate expires
within 60 seconds, forces `exam-dispatch`, permits PTY only and has a generation-specific
principal. The root principals helper checks the exact certificate against the durable
policy journal and rejects expired, consumed, cancelled, started or restored grants.
Fresh signed registration consumes it once. The new root SSH monitor must be newer than
the policy fence; old sessions and writers are still neutralized before material release.
No password or MFA answer is retained or reused for the automatic replacement. The browser
worker clears the ephemeral private key after its one handshake; it cannot silently reconnect
an active exam. Keep the existing instructor-authorization policy for actual recovery.

### Global terminal Emacs clipboard

Install the tracked `emacs/50terminal-clipboard.el` root-owned, mode 0644 at
`/etc/emacs/site-start.d/50terminal-clipboard.el` (Ubuntu/Debian’s global site-start
loader). Back up an existing file first; do not leave an older same-name `.elc`,
which takes precedence. No agent, SSH or Emacs daemon restart is required for new
standalone Emacs processes. Existing Emacs processes need to load the file and run
`depaul-terminal-clipboard-setup` in their terminal frame, or restart Emacs.

Emacs 29’s built-in xterm backend sends OSC 52 on **C-w** (cut) and **M-w** (copy).
An ordinary SSH client terminal must allow OSC 52 writes for its system clipboard
to change. Clipboard queries are not enabled. Native GUI frames retain their normal
backend, other terminal capabilities are preserved, and a user can opt out with
`(setq depaul-terminal-clipboard-enabled nil)` in their init file. `-Q`/`--no-site-file`
intentionally skip global startup. Multiplexer OSC 52 forwarding remains the client’s
responsibility. User clipboard settings/customizations remain respected.

The exam’s read-only host filesystem includes this global configuration. Its Emacs
state wrapper preserves normal startup. The exam terminal accepts bounded OSC 52
writes into the existing attempt-local clipboard, shared between panes; it never
uses the computer’s clipboard or answers queries. Locked/covered/disconnected panes
and instructor replay cannot change that clipboard. Clipboard text is not separately
persisted; terminal recordings still contain terminal output under the existing policy.

Run `emacs -Q --batch -l ssh-server/emacs/terminal-clipboard-tests.el -f
ert-run-tests-batch-and-exit` from the repository root. The browser clipboard suite
also runs real `emacs -nw` in a disposable PTY (`emacs` and Python 3 required), then
checks its output through the actual exam terminal and cross-pane paste. It requires
no SSH credentials or system clipboard access. Rollback removes/restores the single
global file and reloads/restarts Emacs; it does not change student account settings.
