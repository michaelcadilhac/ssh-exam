# Installed qualification: 2026-10-12 (Chicago)

This records tests performed on `marco` and in a private Linux guest on `csc-sys`,
following the owner's authorization to use mcadilha without sudo for isolation tests.
No additional DePaul student identity was required. Notification delivery is qualified;
strict enforcement code was exercised with real SSH and cgroups. The existing **host**
mcadilha profile still deliberately preserves administrator access, so production
maintenance remains enabled. Guest results do not install account policy on the host.

## Instructor notifications

The deployed gateway uses marco's existing OpenSMTPD and DKIM signing/forwarding rules.
Its administrator-controlled configuration is `/opt/ssh-exam/deploy/config/config.json`:

```json
{"smtp":{"socket":"/run/mail/smtp.sock","from":"michael@cadilhac.name","to":["michael@cadilhac.name"]}}
```

Change `to` to configure one or more instructor recipients; this address is not hardcoded
in application code. Apply configuration changes during a drained gateway restart.

A locked, nologin host service identity `ssh-exam` (UID/GID 10001) owns the private
mode-0600 socket. The host socket forwards to a dedicated `127.0.0.1:2526` OpenSMTPD
listener, with `dkimsign` and the existing `DKIM_OUT` tag. It does not expose a remote
unauthenticated listener. The container mounts only the private socket directory.
Existing public mail listeners, the DePaul relay and TagMix were preserved.

The deployed application's test email was accepted with queue ID `9c09a0e2`; marco's
logs show Gmail acceptance after forwarding to the existing recipient alias. The owner
confirmed **Received**. A second labeled test intentionally disabled only the private
application socket: the alert remained pending after three failures and a webserver
restart, then was delivered after socket restoration (queue ID `9f66d288`). The durable
outbox row `qualification-alert-retry` is `sent`, with three prior failures. No mail
password was needed. SMTP acceptance and recipient confirmation are recorded separately.

## Strict class-side tests

A private systemd-nspawn guest was created under `/opt/ssh-exam-qualification` on csc-sys,
using Ubuntu 24.04, real OpenSSH/PAM, systemd, cgroup v2, cron/at and bubblewrap. It has
its own filesystem, process/network namespaces, home, keys, templates and state. Its
local mcadilha identity uses UID 802250173 and GID 1089200513, with **no sudo permissions**,
no administrator groups and the static exam gate shell. Its agent has **no functional-test
exception**. The real host's home, sudo rights, login shell, sessions and exam state were
not used or modified by these tests. The guest shares the synchronized host kernel clock;
its allowed adjtimex query uses modes zero and cannot change that clock.

The guest guard report is explicitly a test fixture, not a host deployment signoff.
[The root-only qualification harness](../ssh-server/tests/linux_qualification.py) refuses
non-fixture configurations. It requires a disposable, prepared systemd guest and its
root-only signing/client keys; do not run it against live student state.

All **21** assertions passed:

- Preflight rejects system cron writers and existing user crontabs; PAM rejects `su`.
- Activation terminates a detached pre-existing writer; old multiplexed SSH channels
  cannot run ordinary commands during the hold.
- An authorized terminal saves work and runs a detached background writer. Early finish
  secures the correct file, terminates both terminal and writer, and leaves access HELD
  until the unchanged original deadline.
- Ordinary remote commands, forged exam variables, SCP and SFTP fail after early finish.
  Fresh direct SSH and a fresh gateway-signed registration cannot reopen the finished exam.
- Agent and watchdog restart preserves the original hold. Ordinary access returns only
  after the original deadline and verified protected collection.
- With all SSH/browser connections absent and the gateway service stopped, the independent
  watchdog collects at the deadline. Saved data is present; outside symlinks and FIFOs are
  omitted. Restart preserves the same archive checksum.
- A hardlinked-file collection fails without claiming a protected submission. Access stays
  HELD after the deadline and after restart. An explicit administrator repair/retry secures
  the protected copy before releasing access.

The native Go race suite also passes, covering concurrent finalization, recovery,
background writers, unsafe paths, signed-command replay, callbacks and verified transfer.
All 13 installation-checker tests pass, including sudo's successful exit status for an
explicit denial, service template inspection, and guarded SSH PAM includes. The 90
application tests, typecheck and production build pass; this change does not alter UI.

## Fixes discovered

- Ubuntu sudo can exit zero when reporting that a user has no permissions. Enrollment
  and preflight now recognize only the explicit denial text; all ambiguous results fail.
- Uninstantiated systemd service templates cannot be inspected as active units. Inspect
  their declared identities separately; unresolved writer identities fail closed.
- No logind session is a valid initial state. Activation now distinguishes this from an
  inventory failure, and protects only trusted entry executables/transport monitors in a
  separate scope before terminating existing sessions. It verifies the scope move and
  root-installed executable inode, rather than trusting a pathname alone.
- Clock readiness uses a read-only kernel synchronization query, allowing a guest sharing
  a synchronized host clock while still failing closed on an unavailable/unsynchronized clock.
- SSH PAM includes are checked for the immediately preceding managed-account skip before
  pam_systemd, preventing an unauthorized user manager from starting before the gate.
- The mail proxy targets OpenSMTPD's raw loopback SMTP listener. Its administrative
  enqueue socket requires a separate protocol and cannot be used as a raw SMTP endpoint.

## Remaining installation distinction and recovery

The main host's mcadilha is still the owner's administrator account. Its explicitly
configured trusted functional profile retains ordinary access and sudo; it cannot enforce
student isolation. The main host's managed-account SSH/PAM/scheduler guard policy is not
installed for that account. Production gateways correctly reject this profile; maintenance
stays on. The qualified private guest supplies confidence in the isolation implementation
without pretending the real account has been restricted. No further student-account test
is required to reproduce these software checks. Actual production enrollment still requires
installing the documented account policy for the identities used in real exams.

SMTP and the previously verified SSH command/status callback readiness fields can be
signed off independently. Do not set `serverGuards` or other installation signoffs merely
because this private guest passed. Keep the existing instructor and repeatable sandbox.

The native update is drained and checks all historical attempts/holds before stopping
services. Root-private timestamped `*-qualification` backups under `/var/backups/ssh-exam`
contain prior binaries, configuration and state plus the deployed SHA-256/source manifest.
All 21 live historical attempt records and 12 protected archives are preserved. Restore
compatible binaries/configuration if needed, preserving newer state and archives; never
replace original deadlines with a stale backup. Notification configuration and OpenSMTPD
also have root-private `*-alerts` / `*-smtp` backups. Restore the dedicated listener and
socket units together; do not change unrelated mail listeners. The qualification guest can
be stopped independently without affecting the real account or deployed deadline services.
