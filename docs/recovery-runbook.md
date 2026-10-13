# Recovery runbook

Never reset deadlines or remove account gates to resolve outages.

- Network loss: input stops. Only the unchanged healthy in-memory page and retained SSH can
  recover within 15 seconds. Reload/lost SSH/longer outages need review.
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
- Export failure: protected local copies permit ordinary access only after the original deadline and verified termination; downloads wait for checksum-
  verified export. Retry transfer, never recollect changed work.
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

Automatic collection recovery: the class agent checks committed bundles before live work.
A bundle published just before a crash is verified and adopted even if state.json still says
FINALIZING or protected=false. Never delete or overwrite a protected bundle to retry. Inspect
`examctl manifest ATTEMPT` and the checksum. Incomplete/corrupt bundles retain exclusion; preserve
them for root review and recover the original artifact from backup where possible. Failed
transfers retry the protected archive, and the gateway preserves conflicting local artifacts
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
outage leaves receipts/transfers in durable local state; restoring HTTPS allows retries from
protected copies. Do not erase nonce/event state or reset a deadline as a rollback shortcut.
Unknown historical attempts are audited by callback ingestion; their originals remain available
through `examctl export` even when a fresh gateway database lacks their metadata.
