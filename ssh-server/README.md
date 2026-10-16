# Native class-server installation

This directory independently installs the compiled account gate, root SSH command agent, independent
watchdog/reconciliation timer, collector and root tools. Target: Debian 12/13, Linux systemd/
cgroup v2, OpenSSH privilege separation and bubblewrap. **Privileged installation remains
untested on a real class host. Leave readiness flags false until the manual suite passes.**

The separately installed [browser SSH relay](relay/README.md) supplies a fixed,
ticket-authenticated WebSocket path to sshjump through csc-sys's existing HTTPS
endpoint. Production terminals use the browser SSH worker; authorization and
signed receipts pass through the webserver. It is independent of the exam agent and its installation
does not restart SSH or exam enforcement services.

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

Build a reviewed toolchain root at /srv/exam-workspace/rootfs, for example using debootstrap
with the institution's package mirror, then install Bash/Zsh, coreutils, editors/compiler and
ncurses-term. Include /usr/local/bin/exam-info. It must contain no host homes/secrets/control
sockets, privileged hooks or future materials. Test chosen tools/TERM inside the actual sandbox.
Do not copy the live host root. Version the rootfs and template installation inputs.

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
subsystem. Outside attempts, the gate dispatches SSH_ORIGINAL_COMMAND through the recorded shell.
The compiled actual account shell runs before personal startup; EXAM_ID labels are not credentials.

Review each PAM stack. Skip pam_systemd only for managed SSH sessions so terminating ordinary
user sessions does not kill the retained transport. Deny course accounts' alternate local,
su/runuser, cron/at, display-manager and user-service routes; disable lingering and chsh.
Reject privileged groups/sudo/system cron tasks. Course forwarding/local jobs/user services
remain deliberately disabled during enrollment even outside exams. Ordinary SSH/commands and
supported external SFTP return only after the original deadline AND verified protection/termination.

Root approves existing accounts explicitly:

    sudo ./scripts/enroll-accounts student01 student02

Original UID/GID/home/shell mapping saves atomically before usermod sets the gate. Privileged
accounts/groups are rejected. CSV imports never create accounts or change hosts/paths/shells.
Restart the agent for registry changes only while drained.

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
network/PID/mount/IPC/UTS, separate toolchain root, proc/dev/tmp, writable /work and read-only
/materials. HOME contains read-only copies of approved shell/editor startup preferences,
excluding host sockets; home changes do not persist. Per-pane loopback is independent.

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

Host work: /srv/exam-workspace/work/<opaque-attempt>/work, shown as the trusted agent
`exam_directory` setting (default /work). Provision that directory in the read-only rootfs. Only saved files are
collected. Students do not submit, upload or archive anything. The optional Finish exam button and
independent deadline watchdog use the same collector. Ordinary access remains blocked until
all scopes and their background descendants freeze and cgroup.events confirms it. The UID
process scan refuses uncontained writers; verified SSH/gate entry stubs are the only exceptions.
New directory access is revoked through a verified descriptor before collection. Existing
write descriptors are made safe by the writer barrier, not by directory permissions alone.
os.Root/O_NOFOLLOW/inode checks reject escapes, mounts, hardlinks and regular-file limit failures.
Symlinks/special entries are omitted with manifest records. Limits: 10,000 entries, depth 32,
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

All commands require root. The shared gate, watchdog and CLI use one durable state and flock;
no separate HTTP API is installed. Use attempt UUIDs to address an individual student's run.

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
