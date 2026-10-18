# Temporary exam account isolation

Status: implemented locally; production installation must explicitly enable and qualify
`temporary_account_policy`. This supersedes permanent per-student shell overrides and
exam-managed membership. Normal sign-in and practice do not change account policy.
The per-UID transaction helper is `ssh-server/scripts/account-policy`, installed as
`/usr/local/sbin/exam-account-policy`. Ordinary student identities are discovered over
signed student SSH; the static `accounts` map is reserved for sandbox administrator
exceptions when temporary policy is enabled.

## Policy

Enrollment is the webserver's exam authorization list. There is no manually maintained
second student allowlist. Adding/importing a student, ordinary SSH sign-in and practice
preflight must not change that account's shell, groups, forwarding, PAM eligibility,
schedulers or lingering. A class-server account registry may retain historical identity
and audit information, but its mere presence cannot activate restrictions.

Temporary per-account changes apply only at the explicit transition into the exam.
After release, effective account policy must match its recorded pre-exam baseline:
ordinary SSH shells, remote commands, SFTP/SCP, forwarding and other ordinarily permitted
access work without an exam attempt or a running exam agent. Existing institutional
restrictions are preserved; the application cannot promise services the account never had.
No student remains exam-managed merely because they once took an exam.

For every started ordinary-student attempt, release requires ALL of:

- The immutable original deadline has elapsed, using the existing safe clock checks.
- The current committed deadline has elapsed as well, if extended beyond the original.
- The protected submission archive and manifest have been verified against their checksum.
- All exam writers have been stopped and cannot modify that protected submission.
- No other attempt or activation transaction holds the same account.

Finishing early collects immediately but does not restore account access. For example,
10:00 start / 11:30 original deadline / 10:40 finish means secured collection at 10:40
and ordinary access restoration no earlier than 11:30. A shortened clock cannot shorten
that original interval; an extension lengthens it. Collection failure, browser closure,
logout, loss of monitoring, maintenance and service restart never authorize release.
A completed attempt cannot reopen through instructor continuation. Ordinary students
in sandbox must not inherit a shortcut that bypasses these release predicates; the
explicit trusted-administrator testing exception is separate and unchanged.

## Activation and fresh SSH

1. Authenticate to both pinned hosts with the existing password/MFA flow. The root
   agent verifies the gateway's signed request, actual kernel peer UID, NSS identity,
   SSH ancestry, exam enrollment authorization, nonce/expiry and attempt ownership.
   Recognizing an account for signed commands does not change its account policy.
2. Run read-only qualification while the student practices: inspect the effective
   SSH/PAM/service/scheduler routes and whether temporary enforcement and exact
   restoration are supported. Reject unsupported isolation before starting time or
   revealing exam material. Never silently remove a student's jobs or account settings.
3. Following the student's explicit start/secure-access action, acquire a per-UID
   activation fence and durably record the complete baseline and a bounded activation
   transaction before any account change. Setup is not a timed attempt and has no
   released exam material. Installation/enrollment must not pre-gate students for days.
4. Apply temporary, root-controlled shell/gateway policy and exam-managed membership;
   suspend the supported alternate-entry/scheduler/user-service paths. Use a per-user
   SSSD shell override for directory accounts and the existing local shell mechanism
   for local accounts. Verify effective NSS and SSH policy and propagate per-user cache
   changes before admitting a protected transport. Do not change central directory
   records, password authentication, sshjump, global SSSD shell defaults or administrator
   accounts. Do not restart SSSD during individual student activation.
5. The bootstrap SSH transport predates this policy and is ineligible for exam access.
   Require fresh SSH authentication after the policy is effective, bound to this
   activation generation. The agent must prove the new transport is newer than the
   policy fence using root-owned SSH process identity/start information, rather than
   trusting a browser claim or opening another channel on an old connection. Revoke
   old admission tokens and neutralize all other pre-existing connections/processes.
6. Verify restored browser monitoring and the protected connection. Atomically commit
   start, original/current deadlines and HELD before releasing material; only this
   step starts the clock. Each later terminal channel still requires signed admission
   for this live transport, attempt, generation, pane and purpose.

The activation transition necessarily imposes a short, bounded setup restriction
before the timed exam starts. It must be identified in the UI, not mistaken for
ordinary practice. The start confirmation explains that ordinary server sessions and
background processes must end. Those terminated processes cannot be resurrected by
later restoring account settings; do not describe restoration as resuming their memory.

A fresh SSH login may require another password/MFA round. Existing password references
have already been discarded after authentication to both hosts; do not extend their
lifetime, automatically retry passwords, or silently retain them to mask this transition.
Explain the fresh sign-in before setup begins; no clock runs while it is completed.
The preflight button is “Secure exam access” until the fresh transport is verified.
The confirmation and sign-in notice explain the five-minute setup window. Then the
normal “Begin exam” starts time; password/MFA is never retained across these sign-ins.

## Abandoned or failed activation

Record a short server-side activation expiry, independent of browser contact. If setup
is cancelled, expires or fails while the agent can prove no timed start was committed
and no material was released, revoke all admissions, terminate preparation workloads
and restore the baseline automatically. The independent watchdog/reconciler must do
this without the browser or webserver, including after reboot.

If state is missing/corrupt or it is uncertain whether a start committed, keep the
account held, surface a recovery error and alert the instructor/administrator. Never
reset a started attempt's clock or classify it as abandoned preparation to unlock it.
A clearly pre-start failure should not leave an indefinitely gated account: retain a
restoration job and retry it, with visible failures and an administrator recovery path.

## Durable policy journal and restoration

Keep a root-owned per-UID, per-attempt policy transaction under
/var/lib/exam-agent/account-policy/, separate from the ordinary attempt/submission
state. Record original identity, original shell and full relevant SSSD override state
(including absence), exact pre-existing group memberships, lingering state, supported
scheduler/service settings, ownership, policy generation and each applied/restored
step. Capture only the affected account's configuration; do not copy SSSD credential
cache databases or passwords. Preserve unrelated pre-existing overrides and attributes.

Attempt policy states are APPLYING -> READY -> HELD -> RESTORE_PENDING -> NORMAL,
with APPLY_FAILED and RESTORE_FAILED. The separate OS journal also records RESTORING.
A per-account flock and generation fence serialize all apply/restore mutations. Submission state remains independent.
Use durable operation IDs and idempotent operations; partial application/restoration
and crashes at every step must be recoverable. Fence operations by UID and policy
version so a delayed restoration cannot undo a newer exam's restriction. Serialize
new activation with restoration and refuse conflicting holds.

Once release predicates hold, independently of the webserver:

1. Verify the immutable protected submission and workload termination again.
2. Durably authorize restoration for the current policy generation.
3. Undo only changes owned by this transaction. Restore the exact previous local shell
   or per-user SSSD override (delete only the exam-owned override when none existed).
   Restore original group membership and lingering state, and resume supported scheduler
   definitions/service eligibility. Never remove an unrelated override, grant a new
   privilege, or blindly replay missed jobs.
4. Refresh relevant per-user caches and verify effective NSS, SSH/PAM and scheduler
   policy against the baseline. Restore the ability to use ordinary forwarding,
   user services and local entry wherever previously permitted. Normal logins must
   no longer depend on the exam daemon after restoration.
5. Only after successful verification mark normal access restored and send an audited
   status callback. Submission completion/secured status alone must not mark access
   restored. Show RESTORE_PENDING/FAILED separately and retry unfinished steps.

Restoration errors cannot unlock before the release predicates. After release is
eligible, partial restoration still needs completion: report any rights not yet
restored rather than claiming the account is normal. The independent watchdog,
reconciliation timer and boot recovery must retry overdue restoration; agent restart
must load the durable policy journal before admitting conflicting activity.

Global SSH/PAM hooks and helper binaries may stay installed, but must be conditional
on an active per-account policy. Outside it they must preserve the original account
behavior and cannot require exam-agent availability. No persistent exam-managed
membership, shell override, forwarding ban, local-entry ban or disabled lingering is
left behind solely because the student took an exam. Test reboot and offline recovery
ordering against all installed entry routes. Preserve mcadilha administrator recovery
access throughout installation, activation, collection and restoration.

## Scheduled jobs and existing configuration

Temporary isolation is not permission to delete crontabs or queued at jobs. Inspect
all enabled mechanisms, including system services/timers and system cron acting as
the student UID. Suspend them only using a supported reversible mechanism with their
configuration preserved. Account for queued jobs that a scheduler might consume while
PAM denies execution; do not silently lose them. If safe suspension/restoration cannot
be demonstrated for an enabled route, fail qualification before exam activation and
identify the conflict. Existing jobs must not silently make the exam less isolated.

SSSD local-override support must be qualified at installation, including applying and
removing an override without restarting SSSD for each attempt. Any necessary one-time
service restart is a separate drained installation action. Pre-existing override
attributes require lossless round-trip support, otherwise refuse automatic activation
for that account without changing it.

## Implementation and installation

- Replace the proposed permanent admission helper with a root-only temporary-policy
  helper offering bounded inspect/apply/restore/verify operations. No setuid helper,
  arbitrary shell command, arbitrary configuration path or generic remote control API.
- Change signed registration to recognize eligible NSS peers without altering their
  policy; introduce a scoped activation operation and fresh-transport generation check.
- Add the policy journal, safe account/config reload and per-UID fencing to the agent.
  Slow policy operations must not hold the shared attempt lock or delay other students'
  deadline cutoff. Bootstrap transport replacement must not depend on retained passwords.
- Integrate release with access.go: changing AccessState to RELEASED is insufficient.
  Invoke and verify actual policy restoration; retain pending/error state until complete.
- Extend independent watchdog/reconciliation/boot recovery for both abandoned setup
  and post-collection restoration. Preserve independent deadline enforcement.
- Update SSH/PAM checks to assert conditional restrictions and their removal. Revise
  the current blanket scheduler rejection/removal behavior for reversible isolation.
- Replace rollback's local-usermod assumption with exact local/SSSD baseline restoration.
  Uninstall must refuse unresolved started holds, preserve submissions and account-policy
  recovery jobs, and never restore an old attempt database or deadline.
- Show the secure-access transition/fresh sign-in and actual release/restoration state
  in the student UI, admin dashboard and examctl. Update design/install/recovery documents.

The root helper runs as a fixed transient systemd service, outside the daemon's
read-only filesystem namespace. The daemon does not gain a general writable `/etc`,
a setuid helper or a remote account-management API. The helper accepts only fixed
operations and validated account/attempt/generation arguments, reads root-private
committed state and verifies the protected archive before started-attempt restoration.
Slow OS work runs outside the shared attempt lock and independent deadline cutoff.

Scheduler support is deliberately conservative: existing user crontabs, pending at jobs,
system jobs and services running as the UID are rejected by read-only qualification.
They are never deleted, disabled or consumed by exam setup. Removing temporary managed
group membership restores eligibility for the globally conditional PAM rules. Other
enabled writer routes require operator qualification or must fail preflight.

Enable only after a drained migration: restore any historical permanent enrollment,
retain administrator sandbox entries, install helper/checker and new native binaries,
set `temporary_account_policy: true`, and qualify the `temporaryAccountPolicy` guard.
For directory users, qualify SSSD local views and apply/remove propagation without a
per-attempt SSSD restart. Initialization of SSSD local overrides may require a separate
one-time drained installation restart. Never set the guard based solely on local-user
tests; real directory-provider behavior needs installation verification.

`examctl stop ATTEMPT --reason ...` and `finish` collect immediately and retain holds.
`cancel` accepts only unstarted attempts, terminates practice and reconciles restoration.
`examctl reconcile` retries eligible restoration; `info` and `list` show policy state.
`examctl override-access ATTEMPT --reason ...` is root-only, durably audited and restores
actual policy after protected-copy/writer verification; it does not reopen exam access.
`examctl agent stop` leaves the independent deadline watchdog and reconciliation timer
running. Uninstall and native upgrade refuse unresolved journals; never roll back state.

## Acceptance tests

Verify no policy changes on enrollment, initial SSH login or ordinary practice. Test
unchanged normal SSH commands, shell startup, SFTP/SCP, forwarding, scheduled work and
user services before activation and after restoration, with the exam daemon stopped.
Compare exact pre/post account settings, local users and real directory-backed users,
including pre-existing overrides and initially enabled/disabled lingering.

Exercise wrong-account/UID/signature/nonce/replay requests, privileged account rejection,
concurrent activation, old/multiplexed transports, forged variables, startup-file bypass,
background writers and enabled schedulers. Prove a fresh protected connection is required
before material and that first-time setup never starts time or retains a password.

Test pre-start cancellation/timeout, agent/webserver failure and reboot at every policy
write; early finish followed by direct SSH/SFTP/remote commands before the original
deadline; shortened/extended clocks; failed collection; verified collection followed by
successful restoration; restore-step failure/retry; stale-generation restoration; and
no effect on other students or mcadilha. Verify protected submissions never change after
ordinary access returns. Monitoring retention must not delete policy recovery state or
submissions. Keep the audited administrator emergency override separate: it may deliberately
bypass a deadline only for secured/terminated work, and must restore policy explicitly
rather than merely setting an access flag.
