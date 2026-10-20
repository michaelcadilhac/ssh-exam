# Fifteen-minute preflight timeout

Preflight now expires fifteen minutes after its initial preparation timestamp,
including connected background pages. The web default, native cutoff and student
messages use the new limit. Native and HTTP regressions explicitly verify that
passing five minutes no longer expires preparation and that the fifteen-minute
boundary does. Existing persisted preparation dates are retained; cancelled
preparations are not reopened. Reauthentication, restarts, capability cleanup,
account restoration and fresh login retain the existing behavior.

The timeout message preserves historical recorded durations rather than relabeling
old five-minute cancellations. The browser fixture ages preparations using the
shared timeout constant. The independent five-minute sandbox exam duration,
continuation approvals and bounded account-setup hold are unchanged.

Deployment uses the existing drained native/web upgrade with private backups and
matching image/binary hashes. Preserve attempt state, original/current deadlines,
monitoring and protected archives during installation or rollback. No schema or
production configuration change is required when `preflightIdleMs` is unset.
