# Inline student settings deployment

Deployed frontend revision **0362161** on 2026-10-18 UTC to
https://ssh-exam.cadilhac.name/.

Students' configured duration and webcam requirement can be edited in the table,
with Save, Cancel and Escape. Bulk setting actions remain available; existing
attempt settings and clocks are unchanged. Started attempts show their start date,
time and timezone. The word “future” was removed from interface text.

## Release and verification

- Image: `ssh-exam-workspace:inline-admin-0362161`, also tagged
  `ssh-exam-workspace:1.0.0` for the next ordinary gateway restart.
- Image SHA-256:
  `84a6874c6faa7ba81c643eef00435409a20d295b4c326c0f04698bb8dcd9a622`.
- JavaScript: `/assets/index-CCmzBwA2.js`.
- Styles: `/assets/index-8dIZ3cB9.css`.
- Public assets exactly match the tested local production build.
- Typecheck, production build, all 170 unit/integration tests and 19 related admin
  browser checks passed. Three additional browser checks loaded the deployed
  assets and used intercepted API fixtures to verify desktop/mobile editing and
  save failure recovery without changing production student data.
- Public readiness remains ready, production-ready and outside maintenance.

## Deployment without disconnecting students

A student preflight was open during deployment. The gateway was **not restarted**;
its container identity and start time were verified unchanged, as were the open
attempt's identity, state and timing. No student was logged out or cancelled.
The currently running backend image remains the previous `dfbe4e6793fe…` release;
this change has no backend, database, protocol or class-agent modifications.

The frontend is root-owned at
`/var/lib/ssh-exam/frontend/releases/0362161`, with a `current` symlink.
`/etc/nginx/servers.d/ssh-exam.conf` contains three temporary locations under the
comment `inline-admin frontend`:

- `/assets/` serves public build assets, retaining previous hashed assets for
  already-open clients, and falls back to the gateway for unknown assets.
- The named asset fallback proxies to the existing gateway.
- `/`, `/admin` and `/admin/` still proxy their HTML to the gateway, preserving its
  security headers, and substitute the two old entry asset names with this release's
  names. Conditional upstream HTML validators and compression are cleared so the
  replacement is reliable. API, media and websocket proxy paths are unchanged.

Nginx syntax was validated and nginx was gracefully reloaded. Public HTML, asset
checksums, previous assets, browser SSH WASM and CSP were verified afterward.
Class-server files, account access, deadlines, sandbox and notifications were not
changed.

## Next normal restart and rollback

**Completed:** the [recovery deployment](recovery-diagnostics-deployment.md) restarted
the drained gateway with the complete current image and removed these temporary
nginx locations on 2026-10-18. The following notes describe the historical overlay.

After draining student preflights and attempts, the normal documented systemd
restart will use the newly tagged image, which contains this frontend. Once that
image is running, remove the three temporary nginx locations, validate nginx and
reload it; the normal gateway serves the same assets directly. Unknown asset
fallback already allows subsequent releases to work, but the temporary locations
should be removed during that maintenance.

Backup and deployment receipt:
`/var/backups/ssh-exam/20261018T063358Z-inline-admin-keuimon7` on marco.
It contains the original nginx configuration and release/container details.
For immediate rollback, restore that nginx configuration (if no newer nginx edits
need preserving), validate and reload nginx, and retag the previous image as
`ssh-exam-workspace:1.0.0`. No gateway restart is needed for this immediate frontend
rollback. The previous image SHA is
`dfbe4e6793feb1d8673bf8e5a7a3936b080045f5f1ae0eccfe266b8d0d7465bb`.
Do not restore attempt databases or submission storage for a UI rollback.
