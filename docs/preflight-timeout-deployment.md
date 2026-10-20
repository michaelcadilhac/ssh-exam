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

## Deployment verification

Deployed revision `967e04e` on October 19, 2026, at 10:33 PM CDT
(`2026-10-20T03:33Z`). Live and locked/offline cutover guards confirmed no
preparing, timed, paused or unresolved attempts. No student was interrupted.

- Web image: `ssh-exam-workspace:preflight15-967e04e`, also normal `:1.0.0`.
- Image SHA-256: `ba313ce01870d45dac35f984a6cd2980b0deb0635ae06328124683dd5ea4f4cb`.
- Private web backup: `/var/backups/ssh-exam/20261020T033323Z-preflight15-61_qmu_1`.
- Native backup: `/var/backups/ssh-exam/20261020T033313Z-browser-ssh-kwbid470`.
- Installed exam-agent SHA-256: `753f56be2348efdfb220503d73c155cf34a8c159623641bd996eab197bf7cbba`.
- Installed exam-login SHA-256: `4dfce43cef2b09750ad1029d44eceaacc1be3c7a69130b80d4f52ffe9cc5d421`.
- Public JavaScript `/assets/index-w0oOBVJt.js` SHA-256:
  `594d3e2ea8771f7ba3a259293682e7e7269e1a4a5f95cbb13eeee5255f9850d0`.

Focused native race tests, ten API/cleanup tests, typecheck/build and the real
browser-SSH expiry/relogin fixture passed. The deployed public UI and compiled
timeout module match the tested build. Public readiness is production-ready,
maintenance false and notifications true. The web container is healthy, with
zero restarts; native agent/watchdog/relay are active with zero automatic restarts.

All 52 native attempt fingerprints and 22 web attempt states, starts, deadlines,
protection and checksums are unchanged. Native configuration is byte-for-byte
unchanged and the web timeout override is unset. Both administrators, sandbox and
mcadilha's unrestricted administrator sandbox and `/bin/bash` remain intact.
