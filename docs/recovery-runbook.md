# Recovery runbook

Never edit deadline state or remove account gates to resolve outages. Grant extra time only through audited instructor Reset clock or Extend time actions.

Local retained-monitoring candidate, **disabled/not deployed**: web/CLI interruption
inspection additionally reports `monitoring_mode`, `retained_hold` and
`monitoring_hold_kind`. These are observations, not a verified live freeze or
permission. A viable same-page v1 policy pause keeps SSH; authorize with the
existing `examctl web interruptions authorize`/web review workflow, then the
student explicitly chooses Continue. A `completing` notice means the native
operation was consumed but terminal agreement needs retry on that SAME page;
it does not require a new approval or add time. Consumed approval does not permit
fresh SSH sign-in. Unknown/unverified holds require inspection, never metadata
edits or optimistic thaw. Technical capture verification delays block input and
retry; a timeout alone is not policy loss. Preserve the original deadline/source/
history and credential cleanup. Full C3/C9/root qualification remains required;
there is no supported switch to enable an incomplete mode. Detailed current
evidence and open boundaries: live-monitoring-runtime.md. Existing installed
legacy behavior follows the procedures below.

October25 local gateway-routing candidate, also disabled/not deployed: keep the
same open page when its SSH remains viable across gateway process replacement.
Current-page binding and signed native owner verification can reconstruct routing
without another login, pane, grant or clock. Contradictory page/transport/clock
proof leaves input blocked while preserving SSH; a real policy hold still needs
its scoped instructor approval and explicit student Continue. Routing recovery
does not establish native monitoring continuity or cure a blind gap. Those native
and joined root/capacity gates remain open; do not use this candidate to change the
installed recovery procedure. Evidence: retained-gateway-restart.md.

- Network loss: input stops. Only the unchanged healthy in-memory page and retained SSH can
  recover within 15 seconds. Reload/lost SSH/longer outages need review.
- Attempt connection process failure: only that student loses SSH and is locked; the supervisor
  queues a contextual email and audit event. Approve continuation and require fresh SSH; do not
  reset the deadline or attempt to reuse a dead worker. Check the fixed cause/exit diagnostic.
  Intentional logout/finish is not a worker-failure alert.
- Gateway restart: SSH objects are gone. Persisted active attempts lock; independent lease
  freezes work and original deadline persists. Approve, reauthenticate with capture stopped,
  claim replacement page, restore conditions and Continue. Saved files persist; buffers may not.
- Activation timeout: reconcile the persisted UUID. A committed start recovers locked with
  the original deadline. Never create a new operation to get a fresh timer.
- Agent endpoint outage: stop lease renewal and keep local watchdog running. Restore trusted
  route/certificates and inspect native state. Network outage must not stop its independent timer.
- Reboot: reconcile/watchdog before admitting students; keep gates, files and outage records.
  Elapsed attempts cannot reopen. Process/SSH state is not restorable and total power loss
  cannot guarantee uninterrupted collection availability.
- Full disk/collection failure: keep exclusion, add protected capacity, inspect errors and retry.
  Do not chmod live work as a substitute for stable protection or silently accept omissions.
- Status-delivery failure: inspect the protected class-server archive with `examctl manifest`.
  Retry signed callbacks; archive bytes remain on csc-sys. Ordinary access still requires
  both original/current deadlines and verified protection/termination.
- Changed host key/expired certificate: obtain trusted replacements, update pins/trust and test.
  Never autoaccept a key to make login succeed.
- SMTP failure: inspect durable outbox and dashboard. Email does not guarantee prompt instructor
  response and the student's clock continues.
- Restore: stop gateway, stage a new private directory, merge current tombstones and expire
  recordings before serving. Delete restored sessions, lock prior active state and reconcile
  callback-reported canonical state. Preserve compatible old image/schema for rollback.

Root break-glass requires independently verified protected saved work, every writer killed,
an audited disposition and restored original settings. No remote force-unlock shortcut exists.
See ssh-server/README.md for recovery commands and safe uninstall.

For an explicitly instructor-approved separate recovery exam, a root administrator
can stage a one-use saved-work entitlement at
`STATE/recovery-preparations/EXAM/USERNAME.json` (root-owned directories 0700,
file 0600). The JSON fields are `exam`, `username`, `uid`, `duration` (seconds),
`source_attempt`, `checksum`, `created_at` (milliseconds) and `reason`. The source
must be a completed, checksum-verified protected submission of the same account.
Record the administrator approval in both audit trails, enroll the student in
the recovery exam with the exact duration, and set an appropriate open start
window. Do not pre-create a PREPARING attempt: ordinary sign-in creates it when
the student returns. Do not consume the entitlement at enrollment or preflight.
Actual Begin sets the full new interval and safely restores the source files;
abandoned preflight expiry does not consume the entitlement. The root-private
`.consumed` marker and persisted interval fence repeat starts across restarts.
Preserve the original submission, entitlement, consumption marker and attempt
history together during backup/restore. Never delete a marker to grant a retake;
use a distinct approved recovery exam and retain the audit history instead.
Existing original account restrictions still require their normal release
conditions, or an explicitly approved and audited root emergency handoff after
secured collection. This mechanism does not grant ordinary access by itself.

Local C17 candidate (not installed): if an UNUSED recovery allowance changes,
save the intended duration through web student settings or
`examctl web students settings EXAM USER --duration-minutes 75`. At the next
authenticated preflight the signed workflow changes ONLY the unused grant's
duration and revision provenance, preserving source/checksum/identity/creation/
reason. Inherit saves the default at edit time; editing exam defaults alone does
not authorize revision. Old mismatches without a recorded edit require explicitly
saving the intended duration again, not weakening the native duration check.
Inspect `examctl web students list EXAM` and `examctl recovery-grants --exam EXAM`.
The latter exposes applied and pending allowance revisions. Pending metadata
permits no work/clock; authenticated retry completes/supersedes it. Never hand-edit
or delete it. Prepared/consumed grants refuse revision; a provably unstarted
preparation must first be positively cancelled (see `examctl help cancel-absent`
for an exact web orphan absent from valid native authority). Uncertain starts
keep the original UUID for inspection, never an inferred refund. Existing timing,
holds and protected history remain authoritative. Retry preserves saved work and
receives the complete new interval only at actual Begin. Preserve migration022,
edit counters/source expectations/receipts and revised native metadata together
on backup/rollback; incompatible native readers refuse rather than ignore it.

Automatic collection recovery: the class agent checks committed bundles before live work.
A bundle published just before a crash is verified and adopted even if state.json still says
FINALIZING or protected=false. Never delete or overwrite a protected bundle to retry. Inspect
`examctl manifest ATTEMPT` and the checksum. Incomplete/corrupt bundles retain exclusion; preserve
them for root review and recover the original artifact from backup where possible. Failed
status callbacks retry immutable metadata, and the gateway preserves conflicting receipts
rather than replacing them. Actual collection times may follow the unchanged deadline after
an infrastructure outage. Submission retention remains separate from monitoring expiry.

Account restrictions are independent of completion. A successfully collected early attempt
stays HELD until its original deadline; browser logout, agent/gateway restarts and classroom
departure do not release it. COMPLETED never authorizes continuation. Inspect access_state,
access_held_at, access_released_at and original deadline with examctl. The dashboard displays
class-server state and last-check time; it does not decide release. A release verification
failure is alerted separately. Missing/corrupt initialized state is a recovery failure, not
an empty registry. Restore authoritative state and protected copies together; retain original
deadlines and restrictions. Do not remove the initialized marker or force an empty state.

A denied SSH connection can remain idle after its shell/command/SFTP/SCP channel is rejected. A completed, protected attempt records that denial against the kernel-verified transport. Restoration ignores only the live root-installed SSH daemon directly under that verified privileged monitor and without writable regular-file descriptors. The original/current deadlines still apply. Shells, background writers, nested processes, unrecorded transports and stale identities remain blockers. Collection and activation retain their stricter checks; no submission is recollected or replaced. Denial proofs survive agent restarts in root-private state and are omitted from callbacks.

“Account access release requires recovery” now identifies student, exam and attempt and says whether the submission is already secured. Its process error concerns restoration, not a new collection failure. Inspect the PID executable, UID, parent, cgroup and open descriptors; avoid dumping command lines or environment. Never kill an arbitrary PID from an old email without checking its current identity.

“Preflight cleanup pending” means cancellation or its confirmation failed. The email and `preflight-cleanup-failed` audit record include the actual safe operational cause and failed stage. The webserver structured log uses `Preflight cleanup failed`; native cancellation rejections are also in the exam-agent journal as `preflight cancellation failed`. A disconnected student command path is not evidence of an agent outage. Automatic retry requires that student's authenticated SSH connection; alternatively inspect and cancel a provably unstarted preparation with local examctl. Lost replies that reconcile as cancelled do not send a pending alert; a committed start keeps its original timing and recovery policy. Identical retries are deduplicated. Unknown SSH error text is omitted to protect secrets; use the native journal for the corresponding agent-side failure.

For a secured and fully terminated attempt only, root can use:

    sudo examctl -reason 'Concrete emergency reason and administrator disposition' override-access ATTEMPT_UUID

The CLI durably audits before setting OVERRIDDEN. Gateway signing credentials and instructors'
continuation grants cannot invoke it. It does not reopen the attempt or change its deadline.
If protection/termination/audit cannot be verified, fix recovery first; override fails closed.
Uninstall/restore-accounts refuses an outstanding hold, including successful early collections.
Wait for both deadline and secured collection, reconcile, then roll back recorded settings.
Do not weaken SSH/PAM or managed group membership to troubleshoot a student lock.


New transport migration is local-source-only until explicitly installed. Preserve state and
protected submissions when replacing the old mTLS configuration with gateway/agent Ed25519
keys and a fixed outbound HTTPS callback origin. No 9443 listener remains. Keep the independent
watchdog and reconciliation timer active during gate service maintenance. Use `examctl list
--active`, `info ATTEMPT`, `retry ATTEMPT --reason ...`, and `stop ATTEMPT --reason ...` to control
one attempt. `examctl agent stop` does not stop the watchdog or cancel deadlines. Webserver
outage leaves receipts in durable local state; restoring HTTPS allows metadata retries.
Protected archives remain on the SSH server. Do not erase nonce/event state or reset a deadline as a rollback shortcut.
Unknown historical attempts are audited by callback ingestion; their originals remain available
through `examctl export` even when a fresh gateway database lacks their metadata.

## Reconciliation reports an existing submission conflict

SSH manifest replies and signed status callbacks use the same public collection snapshot.
The gateway compares manifest content with deterministic object-key ordering and excludes
only transient transport/resume, authorization, lease and terminal-unit bookkeeping.
Legacy manifests containing those fields remain readable and are never rewritten merely
to reconcile. Archive publication still requires identical bytes and the recorded checksum.
Changed identity, interval, saved-file inventory, collection timestamps or checksum remains
a conflict and must fail closed. Never delete an existing protected artifact to make login
or a repeat sandbox attempt succeed. The 2026-10-13 manifest reconciliation fix covers both
legacy reply formats and restart recovery while preserving the existing archive/manifest.


Timing verification recovery: root `examctl info ATTEMPT_UUID` includes original/current
deadlines, reset history/revision, `timing_pending_since`, and verified deadline/revision.
At expiry, failed HTTPS/signature/nonce validation leaves writers frozen and collection pending;
the independent watchdog retries at 30-second intervals. Restore the configured fixed HTTPS
origin, pinned signing trust and gateway metadata. Do not remove pending reset rows or rewrite
deadlines to force collection. A pending reset and its requested timestamp survive webserver
restart; root confirmation and saved collection permission survive agent restart. A reset may
extend an unfinished lock, but does not supply continuation approval or revive a submission.
A shorter effective clock never releases ordinary access before the immutable original deadline.

Upgrade the root agent and gateway together after draining active exams; new preflight and
clock-reset operations reject agents without `clock-reset`/`deadline-timing-check` capabilities.
Rollback must preserve migration 007 and clock reset/verification fields. Do not run an old
collector against attempts with pending or confirmed clock resets. Keep the independent
watchdog/gate enabled and preserve protected archives throughout recovery.


Focus grace: migration 008 records the first server-received focus loss. While an active
page stays visible/fullscreen with healthy capture and SSH, heartbeats/leases continue for
up to 20 seconds and the student sees a countdown. Returning before expiry clears it without
reauthentication; repeated blur reports and late returns cannot extend it. Expiry uses the
normal lock/disconnect/review flow, and continuation clears the old focus-loss timestamp.
Network loss still has its separate 15-second bound. A gateway restart still locks active
attempts; restoring the process is not a fresh focus grace period.


Exam-first dashboard upgrade: install the native agent and webserver together after draining
attempts. Preserve queued timing changes and immutable original deadlines. Native
`server-only-submissions` is required for production preflight; `clock-extend` enables exact
additive changes. Bulk actions may partially fail; inspect each result and retry with the
same request IDs. Never manually add the minutes again to compensate for a lost response.
Changing future duration/webcam settings does not alter prepared or active attempt snapshots.
Web archive uploads return 410; download/delete routes are absent. Old local web archive
copies are inaccessible through the application but need deliberate operator retirement
after matching the root-protected copy/checksum and retention requirements. Keep backup
receipts (`receipts/`) and current deletion ledgers. Never delete class-server originals or
reset gates/deadlines to resolve an application upgrade.


## Private temporary storage

Attempt scratch files live under the agent's root-private
`<state>/temporary/<attempt>/{practice,exam}/{tmp,var-tmp}`, outside the collected work
and protected submission. Do not remove them while an attempt is active/locked or
workload termination is unconfirmed. They are shared by that attempt's panes and can
be needed after authorized reconnection. Reconciliation retries cancelled-preflight
cleanup; finalization retries cleanup only after the protected archive and workload
termination are verified, without recollecting. Inspect the agent's errors and state
filesystem capacity if cleanup fails. Never follow student-created links while doing
manual recovery. These files have no independent retention or backup guarantee.

Upgrading or rolling back mount behavior requires draining attempts: existing shell
namespaces do not acquire new mounts when the agent restarts. Retain current state,
original deadlines and submissions during binary rollback. Rootfs `/tmp`, `/var` and
`/var/tmp` must be real directories before enabling the new agent.

## Temporary account restoration

With `temporary_account_policy` enabled, inspect `examctl info ATTEMPT` for `policy_state`,
`policy_error`, `policy_expires` and the separate access/submission state. The original
baseline and per-step journal live in the root-private `account-policy/UID.json` under
the configured state directory. Preserve these files and `state.json` through upgrades,
reboots and monitoring cleanup; they are not subject to monitoring retention.

Use `examctl reconcile` to retry an expired unstarted setup or eligible post-deadline
restoration. Fix reported NSS, permission/cache or independent administrator-change
conflicts explicitly. Do not guess a shell, remove arbitrary SSSD overrides, replace the
journal, or mark access released by editing metadata. Missing initialized state or a
started-attempt baseline requires operator recovery and remains fail closed.

`examctl cancel ATTEMPT --reason "..."` rolls back only provably unstarted preparation.
`stop`/`finish` collect a started exam but retain its original/current deadline hold.
An emergency early account restoration requires root `examctl override-access ATTEMPT
--reason "..."`, a verified secured submission, confirmed stopped writers and a durable
audit. It restores the account rather than merely changing an access flag.

Do not stop the independent watchdog/timer or uninstall enforcement while any journal
is not NORMAL. The rollback helper refuses unresolved temporary policies. Submissions,
current state and recovery journals survive rollback; never restore an older database
over current deadlines or protected archives. After normal restoration, verify ordinary
SSH commands and file transfers with the exam gate daemon stopped.

## Automatic initial SSH handoff

Initial account setup uses one student password/MFA login and one preflight. The browser
keeps the jump connection, automatically replaces its class connection with an attempt-only
certificate, and discards the private key. Failure before protected registration/activation
must leave start/deadline unset; never bypass the new-monitor fence to recover it. Inspect
policy errors, the root-owned `exam-principals` helper, dedicated handoff CA/public key and
effective `TrustedUserCAKeys`/`AuthorizedPrincipalsCommand` settings. Do not log credentials.
The five-minute unstarted setup watchdog restores abandoned policy; `examctl cancel` is the
audited immediate alternative. A consumed/expired certificate cannot authenticate a second
transport or resume an active attempt. Actual paused-exam recovery retains the original
instructor authorization and fresh login policy. Keep the CA and helper in place while any
account journal is unresolved. Restore installation backups only after draining/restoring
policy and validating ordinary SSH access; never restore old attempt state snapshots.
