# Temporary account policy validation — 2026-10-17

Release `3740e5f` is deployed on marco and csc-sys. Public HTTPS readiness reports
`ready: true`, `productionReady: true`, `maintenance: false`, notifications enabled.
The live class agent advertises temporary account policy, read-only home and disposable
application state. mcadilha retains its exact ordinary shell, groups and sudo access;
the explicit unrestricted administrator sandbox exception remains configured. Existing
exams, enrollments, identities, attempt timestamps and checksums were preserved.

## Automated checks

- 148 application tests across 30 files (release snapshot excluding unrelated edits) passed, including the new real SSH fixture/HTTP
  secure-access handoff: setup records no start/deadline, does not activate material,
  and checks authoritative readiness before closing the bootstrap connection.
- Additional dashboard presentation checks passed: secured submissions remain secured
  while failed/pending account restoration is shown separately and included in attention.
- All native Go tests passed with the race detector; `go vet ./...` passed. New cases
  cover original-deadline holds in ordinary sandbox, restoration failure/restart retry,
  unstarted expiry, uncertain starts, stale receipts, old/multiplexed transport refusal,
  read-only registration and slow helpers outside the global deadline/state lock.
- 13 Python helper tests passed: exact baseline restoration, SSSD override attribute
  round trips/absence, partial mutation/restoration, read-only qualification failure,
  concurrent per-UID ownership, missing baselines and deadline/override predicates.
- 13 Chromium transition checks passed: secure-access confirmation/fresh sign-in,
  preflight, sign-out, paused recovery, finishing, network loss, stale replies and
  active reload. No active exam screen appeared during secure-access reauthentication.
- Two additional Chromium tests passed, including the actual browser WASM SSH/relay
  path through setup, fresh password/MFA sign-in, unchanged attempt identity, no clock
  until Begin, terminal access and secured completion.
- Production web build and TypeScript checking passed.

## Real Linux/SSH qualification

Used only the existing private systemd-nspawn guest at
`/opt/ssh-exam-qualification/guest` on csc-sys. The guest's new disposable `examq`
account (UID 20001) has no sudo or trusted-administrator exception. Its private
network, home, SSH keys, callback fixture, account files and agent state are separate
from real host accounts. The historical guest archives were retained. All temporary
policies were verified NORMAL, the test account matched its original shell/groups/
lingering, and the guest was stopped after testing. Host mcadilha remained outside
exam-managed with its original normal shell.

The updated `ssh-server/tests/linux_qualification.py` passed all 25 main assertions:
normal SSH/SFTP without the exam daemon; unchanged initial registration; scheduled
writer rejection without deleting jobs; temporary alternate-entry denial; detached
writer termination; existing multiplexed connection denial; protected early finish
with original-deadline hold; direct SSH, remote command, forged variable, SCP/SFTP
and completed-attempt recovery denial; agent/watchdog restart; exact normal policy
restoration; local deadline collection with no browser/SSH and the gate daemon stopped;
unsafe symlink/FIFO omission; immutable archive recovery; collection failure remaining
held past the deadline; operator repair; and cancellation of unstarted setup.

Two additional `--setup-only` assertions passed with the final native candidate:

- Cancellation returned current NORMAL status and restored originally enabled lingering.
- After agent/watchdog restart, an expired unstarted setup was restored by the independent
  watchdog with the browser, student SSH and gate service absent. The test advanced only
  the disposable unstarted setup expiry; no started attempt deadline was edited.

The guest-only HTTPS callback/timing fixture uses verified agent signatures and signs
deadline decisions with its own fixture gateway key. It has no exam-control endpoint.
The original full suite exercised the existing timing-verification policy; timing
outage behavior remains covered by native/application timing tests.

## Actual directory-provider qualification

csc-sys is Ubuntu 24.04.4 with SSSD 2.9.4 and the dpu.depaul.edu AD domain. No
central-directory attributes were modified. One initial SSSD restart initialized local
overrides; all three subsequent apply/remove cycles propagated through NSS using only
per-user cache invalidation. The service PID remained 1377875 throughout those cycles.
The test used /usr/bin/bash, verified to resolve to the original /bin/bash binary.
Exact original shell, UID/GID, groups, override absence and sudo access were restored.

The enrolled ppanagop account passed read-only NSS, sudo, scheduled-job, service and
SSH/PAM isolation checks. No password, authentication key, group or shell for that
student was changed during qualification. The guest exercises actual non-privileged
student mutation and restoration; this is not a completed institutional student MFA
login and must not be represented as one.

Provider baseline backup:
`/var/backups/ssh-exam/20261018T040426Z-sssd-local-view-xeer_1c2` on csc-sys.
Keep mcadilha as the explicit administrator sandbox exception. Never substitute
historical permanent enrollment for temporary per-attempt policy.

## Production deployment receipt

- Web source: `3740e5f`; additive metadata migration 9. Runtime image:
  `ssh-exam-workspace:temporary-accounts-3740e5f`, also tagged `1.0.0` for the existing
  systemd/Compose service convention. Image digest:
  `sha256:76bcd07f62275d62e57fae63ad47834017350c13051674c7ab3099e8d00a5d79`.
- Native agent SHA-256:
  `50d5fafed0ceafc936fb7638232fce9f3447e6d2d45be180a7a0539a75d03ce0`.
  All four binaries plus the policy, isolation-check and signed bootstrap helpers were
  verified against the candidate checksums and installed root-owned. The rootfs has
  real `home`, `run` and `usr/local/bin` mount targets. Both agent services and the
  independent reconcile timer are active.
- `temporary_account_policy` and qualified `temporaryAccountPolicy` are enabled.
  The sole explicit account entry remains mcadilha with `sandbox_only: true`;
  students are discovered from verified SSH peers and approved by signed exam-scoped
  enrollment authorization. No permanent student allowlist or shell enrollment was added.
- ppanagop remains enrolled in `test`. Its existing UID 0 roster marker is intentional:
  successful signed SSH admission resolves the actual UID 1084959789. It was not
  replaced with an administrator-supplied identity during deployment.
- All 25 main Linux assertions and two setup-recovery assertions passed against the
  deployed candidate. The disposable guest's policy journals were verified NORMAL,
  all started holds released and its original account policy restored before stopping it.
- The real guest deadline test initially encountered an absent guest-only timing fixture;
  it correctly remained held. Starting the signed fixture recovered the protected
  collection, and the complete suite was rerun successfully. Production uses the
  existing authenticated outbound HTTPS callbacks, not that guest fixture.

Root-private recovery backups and receipts:

- marco: `/var/backups/ssh-exam/20261018T040313Z-temporary-account-migration-hocs_j5z`
- csc-sys native/config: `/var/backups/ssh-exam/20261018T041800Z-temporary-policy-z0hd6y82`
- csc-sys provider baseline: `/var/backups/ssh-exam/20261018T040426Z-sssd-local-view-xeer_1c2`

Never restore inspection state snapshots over newer attempt deadlines or secured
submissions. Once a temporary policy is active, use the recovery runbook and drain/
restore it before any binary rollback. Students must reload the site before retrying,
so their browser loads the matching secure-access/fresh-sign-in flow. A complete real
student phone-MFA login remains a student-performed check; no student credentials were
obtained or simulated during deployment.
