# Full exam functional test on csc-sys

Prepared for mcadilha on Ubuntu 24.04.4 x86-64, 2026-10-11.
This is an explicitly requested trusted-administrator functional test. mcadilha has
NOPASSWD: ALL and is directory-managed. It cannot qualify production student isolation.
No local account/shell, directory override, sudo rule, main SSH configuration, PAM file or
existing user-session policy is changed. Ordinary SSH port 22 remains recovery access.

## Current status

Local full-exam app: http://localhost:3001, instructor dashboard /admin. Separate data and
TLS trust are under var/full-test. The existing port-3000 real MFA login test remains available.
The class agent has passed real-server checks; maintenance is disabled for this local profile.
Three exams are prepared: full-early and full-retest (5 minutes each), and full-deadline
(2 minutes); full-retest is the fresh enrollment after the first completed attempt. Webcam is off,
up to four panes, sample-exam materials and /work saved files. mcadilha is enrolled in both
exams with root-resolved UID 802250173 and GID 1089200513. Instructor account is copied from the
existing demo database, retaining its password. No actual SSH password is retained.

The server OS/account/SSH/PAM/firewall inspection was read-only. debootstrap was installed;
apt also encountered the host's pre-existing azuremonitoragent configuration failure. No
repair/upgrade of that unrelated package was attempted. The private reviewed install bundle
and checksum were uploaded to /home/mcadilha/server-install.tar.gz and server-install.sha256.
The persistent installation below was explicitly approved and completed. All four services
are active; native health reports ready=true, functional_test=true, production_ready=false.
Rootfs bootstrap requires the server's existing http_proxy/https_proxy setting pointing to
http://proxy.is.depaul.edu:3128/; signed Ubuntu Release metadata was verified. The first stalled
bootstrap tree was retained as /srv/exam-workspace/rootfs.first-bootstrap-incomplete.
The institutional jump host rejects forwarding to 2222 and 9443. A proposed root-owned
/usr/local/bin/exam-gateway wrapper for an explicit command on ordinary port 22 was separately
approved and installed. The local profile now uses port 22, preserving real phone MFA and
both configured host pins. Personal startup files are unchanged. After the requested account-access update, the root
configuration enables functional_host_access=true and uses the real /home/mcadilha. Authorized
terminals run as the normal account in tracked transient systemd services, using host NSS,
installed tools (including Emacs), supplementary groups and existing privileges. /work is
bound to the attempt directory; /materials remains read-only. The host session retains normal
home/filesystem/network access. This exception is rejected outside explicit functional mode.

## Approved root changes

- Verify/extract the bundle into root-private /opt/ssh-exam-functional-test.
- Install static exam-agent/examctl/exam-login/exam-info binaries, root machine checker,
  /etc/exam-agent configuration and test TLS server key, state under /var/lib/exam-agent,
  systemd agent/watchdog/reconciliation units and exam.slice. Installer adds the unused
  gate path to /etc/shells and creates exam-managed, without enrolling anyone.
- Build a separate Ubuntu noble minimal toolchain under /srv/exam-workspace/rootfs using
  signed Ubuntu repositories, with editors, GCC/Make, headers and terminal support; initialize
  sample starter/question templates. No live host root/homes/secrets are copied.
- Run a separate test sshd on TCP 2222 using existing verified host keys, PAM password
  authentication for the real directory account and AllowUsers mcadilha. ForceCommand invokes
  the native gate. Normal port 22 and the account's original /bin/bash remain unchanged.
- Run the native mTLS agent on TCP 9443. Add ONLY two UFW allow rules, source 10.192.202.4
  (the observed jump-host peer), destination ports 2222 and 9443, comment
  ssh-exam-functional-test. Do not change the default firewall or open these ports broadly.
- Enable exam-agent, independent exam-deadline-watchdog, exam-reconcile.timer and the separate
  exam-test-sshd service. Service restarts retain deadlines and protected submissions.

The single-account root configuration explicitly says functional_test_account=mcadilha and
sets a 48-hour new-admission expiration. Production guard flags remain false. Native health
says functional_test=true and production_ready=false. The development gateway must explicitly
opt in; production gateway/config rejects this mode. It skips ordinary-UID job quiescence and
uncontained writer verification for this trusted account, while still freezing/killing tracked
exam scopes and using the safe immutable collector. Normal administrator access can modify
work by sudo; therefore this is NOT an adversarial isolation test. Receipts/manifests and UI
label the test. Secure production testing still needs an unprivileged managed identity and
all SSH/PAM/scheduler/startup checks.

## Independent control connection

The proposed direct jump-host forwarding tunnel was tested and rejected by institutional
PermitOpen policy. Do not change that policy. The running local command-channel relay uses:

    node var/full-test/control-relay.mjs

It listens only on 127.0.0.1:19443 and pipes each connection through the authorized
`ssh csc-sys /usr/bin/nc 127.0.0.1 9443` command, independently of the student's connection.
The local HTTPS agent URL is https://127.0.0.1:19443 with the dedicated
30-day test CA/client certificates. Both TLS authentication and peer verification remain on.
The webapp student flow still uses the real jump-host password/phone MFA and reuses its shared
password for class authentication, on the existing class SSH port 22, with existing trusted
host pins. No fixture SSH host is used in this mcadilha configuration.

## Walkthrough

The explicitly approved root systemd drop-in retains
`AmbientCapabilities=CAP_SETUID CAP_SETGID CAP_SETPCAP`; `NoNewPrivileges=yes`
remains enabled. These capabilities are needed only by the trusted launcher. The initial isolated
terminal test verified the student's actual UID/GID, all capability sets zero, and
NoNewPrivs=1 after setpriv. The subsequently requested unrestricted trusted-account profile
uses separate system-manager-created user services with NoNewPrivileges=no; the root agent
keeps NoNewPrivileges=yes. Production terminals retain the isolated setpriv launcher. The rootfs includes /usr/bin/setpriv and pre-created
/home/student, /work and /materials mount destinations. Private namespaces preserve actual
filesystem ownership; the launcher drops identity and capabilities before entering /work.

Real-server tests passed for typing, Ctrl-C, pane closure, a background writer, early finish,
immutable protected copies, denial of reopening a finished attempt, original deadline
retention, and independent deadline collection with the SSH connection closed and control
agent stopped. Restart and verified download also passed. See [test results](full-exam-test-results.md).
Real phone MFA remains a manual step in the following browser walkthrough.

1. Verify `sudo examctl health`: functional_test=true, ready=true, production_ready=false.
   Verify all four services; check a new ordinary `ssh csc-sys` still works.
2. Verify local /health/ready reaches the real native agent through mTLS and maintenance=false.
3. Instructor: sign into /admin as instructor using the existing local test password. Verify
   mcadilha is already in both rosters. Use a separate browser profile from the student.
4. Student: choose full-retest, sign in as mcadilha with the real SSH password and phone MFA.
   Complete preflight/display sharing/fullscreen/keyboard lock, practice typing/editor saves,
   then Begin. Confirm /work, read-only /materials, first floating terminal, extra panes.
5. Save `answer.txt`, run a small program/background writer, then Finish and confirm. The
   native scopes freeze, saved files are collected, scopes end, and the instructor downloads
   a checksum-verified archive and manifest. Exam-gateway admission remains held to the original
   deadline; ordinary port 22 remains available ONLY because this is administrator testing.
6. Wait until the original 5-minute deadline. Sign in for full-deadline, save another answer,
   and do not finish. At the 2-minute deadline, verify native automatic collection. Repeat
   with browser loss/instructor locking to exercise original-deadline behavior and recovery.
7. Inspect status and recovery independently using ordinary `ssh csc-sys` and sudo examctl.
   An unfinished locked attempt needs instructor authorization; a finished attempt cannot
   reopen. Do not reset or delete deadlines to retry: use a new exam enrollment/record.

## Cleanup and rollback

Finalize/recover any started attempts and wait for original deadlines/secured collection.
Keep state, audit, archive, manifest and test results; do not delete them with monitoring.
Cancel only unstarted preparation. Stop/disable exam-test-sshd when testing ends. Remove ONLY
its two exact UFW rules and close the local administrator control relay. Remove the test-only
/usr/local/bin/exam-gateway wrapper and setup-capabilities.conf service drop-in only after
all attempts are secured and their original intervals have elapsed. Do not restore or
rewrite normal SSH/PAM/account files: this functional installation never changed them.

Stop/disable exam-agent/watchdog/reconcile only when no workload or collection is outstanding.
Keep /var/lib/exam-agent and protected submissions until separately verified/exported retention
permits deletion. Remove the unused /etc/shells gate entry and empty managed group only after
checking no other account/deployment uses them. Native production uninstall assumes genuine
managed accounts and must not blindly remove membership from this unmodified directory user.

Temporary CA/client private keys remain on the local workstation; the bundle contains only
the server private key and public client CA. Files are private. Remove staging archives/extra
server-key copies after installation; never publish them or commit var/ to source control.

The verified jump host uses the hidden prompt “Entra Id Password.” This exact password
prompt is recognized for single-entry reuse; OTP/passcode and ambiguous prompts remain manual.
Generated isolated-home account/preference files now explicitly override the agent 0077 umask
with readable modes, correcting “I have no name” and unreadable preferences in production shells.

## Repeatable sandbox

Enter exam ID sandbox at localhost:3001. It is named by SANDBOX_EXAM_ID, runs for five
minutes, accepts successful SSH logins without manual enrollment, and has no start-window
check. Real host verification/password/phone MFA and class-agent account approval remain.
Restore required monitoring/fullscreen/keyboard conditions and Continue without instructor
approval. Re-login resumes the current unfinished run at its original deadline. After
secure completion, sign out/in for a new UUID/work directory; archives remain separate.
Normal exams retain their restrictions. The local database was backed up privately as
var/full-test/metadata-before-sandbox.sqlite before migration 005; rollback must preserve
all repeat submissions and cannot restore the older unique schema over new history.

## Unified pause recovery

Every pause disconnects both student SSH transports and ends tracked terminal processes.
Saved /work files and the original deadline remain; unsaved editor buffers are lost.
The instructor clicks Authorize resume once. Student clicks Reconnect SSH, authenticates
again, restores the page and capture/fullscreen/keyboard conditions, then continues using
that same grant. Sandbox uses the same flow with automatic approval. A merely reconnecting
WebSocket can still use the brief network grace only if no actual pause occurred.
