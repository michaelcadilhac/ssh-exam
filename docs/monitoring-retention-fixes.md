# Monitoring deletion and retention correctness

October 21, 2026. Implemented/tested locally.
**Not deployed.** Monitoring CLI completeness and asynchronous/isolated purge
work remain open; these fixes add no management capability or deletion policy.

Two confirmed defects had executable failing regressions:

- Legacy transport recording callbacks did not check deletion tombstones and
  could recreate recording rows/files after deletion. They now share the durable
  tombstone fence already used by native recording batches and image uploads.
  Direct bounded replay also refuses deleted monitoring (410), even if orphan
  files remain after a failed physical purge.
- A real filesystem purge permission error escaped retention, stopped later
  attempts from being processed and could escape the hourly interval callback,
  terminating the gateway. Each attempt's failure is contained, later attempts
  continue, and committed tombstones remain the durable purge-retry inventory.
  Startup/interval inventory/database exceptions are also contained and logged.

Logs use `monitoring-retention-incomplete` plus a failed-attempt count, or
`monitoring-retention-unavailable`, without raw filesystem/database exceptions,
paths or student monitoring text. These are operational failure reports, never
successful physical-erasure receipts. Diagnose storage/permissions; do not erase
tombstones or restore old recordings to force a retry. Existing startup/hourly
retention retries retained tombstones after the cause is fixed. A metadata/audit
transaction failure leaves its original data authoritative for retry.

The 60-day policy and earlier explicit administrator confirmation are unchanged.
Protected submissions/manifests, historical attempt clocks/settings and account
restrictions are not changed. Manual deletion retains its existing failure/error
semantics. This increment does **not** make large recursive purges nonblocking,
add a durable worker/job UI, implement CLI export/deletion, retroactively erase
old audit/mail copies or promise physical secure disk erasure. Those boundaries
must be addressed explicitly in the subsequent shared monitoring workflow.

Seven focused tests pass, including a real filesystem permission failure and an
actual authenticated HTTP/session/health workflow surviving startup purge and
scheduled inventory failure with redacted logs. The full application suite passes
323 tests/57 files (62.2s); typecheck/build pass. All 81 combined browser/admin/
monitoring/real synthetic SSH/worker-fault/closure/timezone checks pass (10.5m).
Existing browser assets have the same hashes as C1f; generated documentation
screenshots are restored, not product changes. Fresh full native race/resource/
compiler/default-size opt-ins pass (core 105.1s); static build/vet and all three
Go-module race checks pass. No production installation/state was changed.

## Restored-orphan read follow-up

A further executable HTTP regression confirmed that the legacy full-image route
could return 200 for older image bytes/metadata restored alongside a retained
tombstone. The legacy aggregate review also exposed restored frame/recording/
incident metadata. All legacy media reads now check the ledger before filesystem
IO (410 for full image and thumbnail); aggregate review returns empty monitoring
with monitoringDeleted=true while retaining the independently protected manifest.
Private restored messages/bytes are not returned, and protected bytes remain
unchanged. This is enforcement of existing deletion policy, not a new retention
rule, physical erasure receipt or reason to delete historical attempts.

Sixteen focused actual CLI/TLS, HTTP and unit checks pass. The full working-tree
suite passes 332 tests/59 files (66.4s), including five separate still-unwired
purge-process tests. All 28 administrator/monitoring browser checks pass (2.0m),
typecheck/build and native race compatibility checks pass (unchanged core uses
valid cache). See monitoring-cli.md for the preceding combined 81-check result;
no fresh privileged-host result is claimed for this read-only follow-up.

No schema change. Keep consistent backups and deletion ledgers; do not restore
older monitoring into a running installation. An older gateway can again serve
restored orphan metadata/media despite the ledger, so downgrade needs a drained,
retention-consistent restore or compatible reader. No rollout is authorized.
The internal isolated purge boundary in monitoring-purge-isolation.md remains
unwired: existing synchronous purge, full CLI export/shared deletion intents and
durable scheduling still need implementation/qualification.

Subsequent local C1gb2 supersedes that unwired status: deletion, retention and
preflight retirement now enqueue durable OS-worker jobs without recursive purge
in the HTTP/lifecycle process. First deletion time is preserved and CLI show/web
review expose separate physical status. See monitoring-purge-isolation.md and
todo-progress.md for current validation/migration 017 and remaining shared CLI
deletion/export work. The historical synchronous failure evidence above is not
the current candidate's deletion contract; production remains unchanged.
