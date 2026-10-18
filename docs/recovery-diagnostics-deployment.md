# Activation diagnostics and preflight recovery deployment

Deployed revision **2994a39** on 2026-10-18 UTC to marco and csc-sys.
The public site is https://ssh-exam.cadilhac.name/.

## Behavior

- Activation errors identify connection/binding/acknowledgment, fullscreen,
  keyboard lock, visibility and required capture failures. Brief focus loss during
  activation receives the same 20-second grace as active work. Real interruptions
  still block input and require the established recovery authorization.
- The specific browser reason is recorded in incidents, gateway audit and warning
  logs. Server-side activation exceptions also have a dedicated audit/log event.
- A later same-generation class watchdog lock retains the initiating pause reason
  in the dashboard; its own reason is independently audited. Native lease expiry
  and server reboot now have distinct messages and native audit reasons.
- A cancelled, never-started preflight with no persisted policy generation is
  explicitly acknowledged as normal account policy. Reconciliation also repairs
  older cancelled records. Applied policies still require verified restoration;
  failed or unconfirmed restoration cannot bypass the retry guard.

The original exact browser condition in the reported incident cannot be recovered
retroactively; the previous generic activation message did not record it.

## Release

- Web image: `ssh-exam-workspace:recovery-2994a39`, also tagged as the normal
  systemd default `ssh-exam-workspace:1.0.0`.
- Image SHA-256:
  `926aea51dd5e9e18358726eed81a93a29633eaa0780bf5b5415e06d7473fc278`.
- Frontend: `/assets/index-CGJyHCia.js` and `/assets/index-8dIZ3cB9.css`.
- Native exam-agent SHA-256:
  `917efc308652cbfe5d2c872e91e6ec376c540039aeecb378b20568400ac8de2e`.
- The corresponding examctl, exam-login and exam-info binaries were also updated.
- The temporary inline-admin nginx frontend overlay was removed. The standard
  gateway now serves the frontend from the running release image again.

Both authoritative stores had no preparing, active, locked or unresolved attempts
before installation. The drained webserver was stopped for the native/web cutover.
No live exam was interrupted. Agent and watchdog services were restarted; the
existing reconciliation timer remains enabled. Public readiness reports ready and
production-ready, maintenance false and notifications enabled. Administrator
passwd/group records and unrestricted sudo were verified unchanged; sandbox remains
available. No SSH trust, MFA, relay, notification or account-policy configuration
was changed.

## Authorized student resets

The administrator-requested reset removed only the two affected `test` attempt rows
and their dependent database records, and revoked those students' `test` browser
sessions so they sign in afresh. Their enrollments/settings remain unchanged. Each
reset has a durable `reset-attempt` audit event. Original database/data backups retain
all prior monitoring and incident records; native attempt records and the secured
submission remain on csc-sys. Existing original deadlines, collection checksums and
protection state were verified unchanged by the native upgrade. Neither a later
working copy nor a replacement archive was created.

## Validation and recovery

Typecheck, production build and all **174** web unit/integration tests passed.
Fifteen recovery/transition browser checks passed; the real WASM SSH password/MFA
handoff test passed separately. Native tests, race checks and vet passed. Public
asset checksums and CSP were verified after installation. Two deployed-browser
checks passed using intercepted API fixtures to avoid production student mutations.

- Marco backup and receipt:
  `/var/backups/ssh-exam/20261018T185831Z-recovery-9x2bzugm`.
- Class backup and receipt:
  `/var/backups/ssh-exam/20261018T185842Z-recovery-lng_kq1e`.

Drain student sessions before software rollback. Restore prior native binaries and
restart the agent/watchdog, or retag the prior web image and restart the webserver.
Restoring the previous nginx file would re-enable the temporary frontend overlay;
that is unnecessary for an ordinary software rollback. Database/state backups are
for inspection and disaster recovery, not for overwriting newer attempts, deadlines
or secured submissions. Student resets need not be undone for a software rollback.
