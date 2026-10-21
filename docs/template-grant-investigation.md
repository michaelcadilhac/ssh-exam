# Template versions before unified grants

October 21, 2026. **Investigation in progress, not implemented or deployed.**
C2/C5/C7 already approve unified grants, settings/material/source fixed at
issuance, explicit unused revisions, finite independent Begin windows, effective
webcam preservation and new-attempt saved-work recovery. This source map/order
does not request approval for routine details or complete the investigation.

One newly identified consequential choice is awaiting the instructor: when the
first ordinary grant is issued/frozen. Recommended: first preflight, preserving
roster/import/default edits before preparation and freezing the issued grant
thereafter. Alternatives are enrollment/import (requires a confirmed material
version immediately) or explicit instructor issuance (adds a required management
step before ordinary Begin). Additional grants remain fixed when explicitly
authorized in every option. This refines issuance timing; it does not reopen the
approved fixed-at-issuance/revision policy. Independent purge work continues.

## Confirmed implementation constraints

- `migrations/005.sql` enforces ordinary_exam_once on exam/student, with sandbox
  excluded. Account_busy and the original-interval hold insertion trigger are
  separate. Dropping only ordinary_exam_once would permit additional rows without
  explicit allowance and is not the approved migration.
- Preflight in app.ts selects the latest exam/student row, snapshots mutable
  enrollment/default settings at preparation and rejects ordinary repeats. Begin
  checks that snapshot's window. Login/status/dashboard/callback paths must select
  the intended grant/attempt, not silently choose the latest row after migration.
- Native workspace_jobs.go selects a legacy recovery grant or Settings.Template.
  workspace_stage.go freezes starter **work** with an inventory hash in a private
  receipt before Begin. There is no immutable material/template catalog at issuance.
- sandbox_launch.go binds Templates/Settings.Template/materials per pane;
  functional_host.go does the same for administrator tests. welcome.go separately
  reads that current template's WELCOME.txt. A template-directory edit can change
  material/welcome views even after starter staging. All readers need one version.
- The bounded collection-worker protocol requires an attempt UUID and persisted
  snapshot before dispatch. Template installation/hashing must not masquerade as
  attempt collection or perform bulk IO under WithState.
- Native saved-work grants/markers are not gateway-owned. Existing read-only
  catalog/deletion fences do not migrate authority; C8 retirement must wait.

## Ordered increments and required acceptance

1. **Immutable native catalog and CLI.** Supported root-only templates list/show/
   validate/install, helpful errors and idempotent exact-content installation.
   Validate/import work and materials outside the global lock in a bounded OS
   worker, safe traversal/metadata and atomic flushed publication. Changed content
   creates a new version, never replaces an installed one. Preserve legacy readers
   until an explicit versioned snapshot exists. Do not introduce automatic catalog
   deletion or expose private templates to practice/status/outcomes. Test actual
   CLI, links/special files/mounts, concurrent source edits, large trees, process
   death, storage/resource/runtime failures and retry.
2. **All-reader version binding.** Optional version fields preserve byte-compatible
   historical settings/receipt hashes. Staging, normal/admin workload mounts,
   welcome and manifests resolve the exact recorded immutable version. Empty or
   saved work selects materials independently. Missing/damaged versions refuse
   before Begin, never fall back to mutable paths. Test aliases/content changed
   after issuance, restart/new panes and practice confidentiality; do not rewrite
   historical archives or silently change existing attempt semantics.
3. **Authenticated catalog visibility.** Existing signed outbound agent callbacks
   publish bounded version metadata/revision with durable acknowledgement. Root
   CLI distinguishes installed-local from gateway-confirmed; gateway issuance
   selects a confirmed version. No inbound class-server API or filesystem proxy.
   Web/CLI must show unavailable/stale versions and supported synchronization
   diagnosis without copying exam text into permanent metadata.
4. **Unified authority and claim/Begin.** Add grant/claim/intent records before
   relaxing ordinary uniqueness. Default ordinary allowance remains single-use.
   Explicit individual/bulk grants fix source/version, allowance, effective
   webcam/terminal/collection settings and independent finite Begin window with
   audited reason. Claim reserves preparation without consuming allowance/time.
   Bind native preparation/Begin to exact grant/revision/settings. Revoke/revise
   fences preparation and in-flight Begin; a lost reply is pending/uncertain, not
   proof of an unused grant. Reconcile a signed committed interval without another
   start/refund/reopen. Preserve account_busy, original/current holds, verified
   protected sources, omission review and shared CLI/web authorization/audit.
5. **Migration and retirement.** Inventory/migrate native legacy grants and markers
   with exact source/consumption history, preserving all UUIDs, deadlines and
   archives. Only then enable C8 unused-definition deletion/history archival.
   Never strand preparations/grants, cancel silently or run old binaries against
   new multi-attempt authority. Rollback cannot discard version/grant fields.

Final interface/crash matrix: two full 90-minute attempts under one exam from
saved work; empty/template starts; webcam inheritance/explicit override; an extra
window outside defaults; simultaneous claims; either server restarting/offline;
lost replies; revision/revoke versus Begin; failed collection/source deletion and
an outstanding old hold. No automatic refunds, marker resets, completed-attempt
reopen or production migration is authorized. Exact persisted manifests/worker
protocol, catalog acknowledgement and distributed Begin/revision reconciliation
remain engineering work, not investigated/tested merely because proposed here.
