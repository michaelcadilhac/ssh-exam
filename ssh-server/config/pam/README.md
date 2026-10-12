Target: Debian 12/13 with Linux, OpenSSH, systemd and cgroup v2. These changes require
local review: PAM stack structure varies. Keep an independent root recovery session.

Do not read per-user PAM environment files; use pam_env user_readenv=0. The gate
is built statically (CGO_ENABLED=0), and SSH must not accept arbitrary environment names.

1. In /etc/pam.d/sshd's session stack, skip pam_systemd for exam-managed accounts so
   loginctl terminate-user does not kill the retained gateway transport. Place this
   immediately before the single `session optional pam_systemd.so` invocation, including
   inside common-session if that is where it occurs:

   session [success=1 default=ignore] pam_succeed_if.so user ingroup exam-managed
   session optional pam_systemd.so

   The skip counts one PAM module. Do not copy it before an include with other modules.
2. Disable course accounts' alternate local/scheduled entry: in login, su, cron, atd,
   runuser and applicable display/login manager account stacks, before permissive modules:

   account requisite pam_succeed_if.so user notingroup exam-managed

   Inspect every installed entry service and user-systemd policy. Disable lingering for
   every managed user. Stop/reject course cron and at jobs; ensure the system crontab does
   not run jobs as them. Deny sudo, Docker, virtualization and service-management groups.
3. Prevent changing the gate shell: in /etc/pam.d/chsh:

   auth requisite pam_succeed_if.so user notingroup exam-managed

Outside exams ordinary SSH/file transfer works through the gate. Local login, user
services, forwarding and scheduled jobs are deliberately unavailable for managed course
accounts throughout enrollment. This is a course-account policy, not a claim of completely
unchanged Unix access. Remove these rules/group assignment on rollback after collecting.

Test cron, at, su, old channels, internal-sftp, all SSH listeners, preexisting process
handles, pam_systemd and original profile variants on a DISPOSABLE account. Guard flags
must stay false until these checks are performed. The repository does not auto-edit PAM.

Access restrictions survive early completion. Keep these rules and the static account shell
installed after collection: the root state gate allows ordinary SSH only after the original
deadline and verified protected collection/termination. The first non-comment rule in each
listed alternate-service PAM file must be the account deny rule; install/check explicit rules
for other enabled services as well. The machine checker cannot prove that arbitrary root code
never switches UIDs: inventory system cron/timers/services and all listeners, then run the
adversarial matrix before signing off `alternateServices` and `schedulerIsolation`.

Do not exempt existing authenticated or localhost SSH connections. Disable all forwarding
and apply ForceCommand to each channel; kill pre-existing UID processes at activation.
Do not remove managed group membership or restore account shells to solve a held exam.
