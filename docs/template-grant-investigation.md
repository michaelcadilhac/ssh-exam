# Template versions before unified grants

October 21, 2026. **Investigation in progress, not implemented or deployed.**
C2/C5/C7 already approve unified grants, settings/material/source fixed at
issuance, explicit unused revisions, finite independent Begin windows, effective
webcam preservation and new-attempt saved-work recovery. This source map/order
does not request approval for routine details or complete the investigation.

The instructor approved **enrollment/import** as initial ordinary grant issuance
on October 21. Save the initial settings copy immediately, not at first preflight;
later defaults/enrollment edits require explicit unused-grant revisions. This
settings snapshot is unrelated to the C3 SSH/process freeze. Enrollment/import
therefore needs a confirmed immutable material/source version and complete finite
Begin window; unavailable prerequisites must produce an actionable refusal rather
than a silently deferred or mutable grant. Additional grants remain fixed when
explicitly authorized. Migration of existing enrollments and exact catalog/claim
protocols remain engineering work; this decision alone completes no investigation
or implementation. Independent purge work continues.

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

Local C2a0 foundation now implements an **internal, unwired source inspector** in
template_source.go, not a catalog/CLI/installer/agent capability. It pins no-follow
package/work/material roots; refuses links, special files, nested mount IDs,
non-UTF-8 paths, unreadable materials and reserved root work metadata; enforces
declared file/combined-byte bounds, 10,000 entries per tree and depth 32. Ordinary
mode and second+nsec mtime plus streamed file hashes form a canonical domain-
separated fingerprint; physical inode/device/mount/ctime are race fences, not
version identity. Fingerprints alone are not published immutable versions.
Pre/post inventories reject observed source mutation, not guarantee an atomic FS
snapshot or verified freeze of hostile writers. The eventual worker must import
quiescent input and verify its own private copy before atomic publication.

Focused native race/userns tests pass, including unchanged source identity across
distinct physical copies, mode-sensitive hashes, links/FIFO/layout/readability,
after-read mutation with restored mtime, the 10,000-entry boundary/depth 32, real
same-device bind mounts and 128 MiB streaming without proportional allocation.
No existing reader or settings hash was changed. Full qualification is in
todo-progress.md; bounded worker/CLI installation, publication/crash recovery,
all-reader binding and catalog acknowledgement remain unimplemented. Do not
mark the catalog investigation complete from this primitive or the proposal below.

Further October 21 source findings (investigation remains open):

- Enrollment rows retain current duration/webcam overrides, but no issuance or
  enrollment timestamp/settings copy. Existing enroll-student audit contains only
  the username; mutable defaults cannot be reconstructed reliably. A separate
  migration question is awaiting the instructor: reviewed bulk issuance from
  current effective settings/unchanged windows plus an explicitly selected
  immutable version, or explicit selected reissuance before legacy unused rows
  become available. No original enrollment-time snapshot will be invented.
- copyPrivateTemplate makes copied directories 0700 and applies student ownership;
  it is not directly suitable for readable/searchable root-owned materials.
  The catalog must capture work/materials/WELCOME together while keeping their
  distinct permission semantics. Existing preparations/started records retain
  their recorded legacy settings/source behavior, not a silently substituted
  current catalog version.
- The existing collection protocol requires an actual persisted attempt UUID and
  owns attempt/collection slots. Catalog import must use its own bounded worker
  protocol/pool, not a fake attempt or a new heavy shared-state transaction.
- Source import needs pinned no-follow roots, regular/single-link files, bounded
  inventory, pre/post identity/ctime checks and streaming hashes. st_dev alone
  does not detect a same-filesystem bind mount: kernel fdinfo mnt_id identifies
  the containing mount. Use descriptor identity and test same-device bind mounts
  in a private user/mount namespace before claiming safe traversal. See the
  [kernel proc documentation](https://docs.kernel.org/filesystems/proc.html#proc-pid-fdinfo-fd-information-about-opened-file).
  These are implementation requirements, not completed tests/catalog code.

Proposed implementation increment: metadata/validation primitive first, then a
separate resource-bounded root worker and discoverable templates list/show/
validate/install. Publish an exact content-addressed version atomically without
overwriting old template directories or implicitly selecting the latest version
for existing grants. Bind every material/welcome/work reader only in the next
qualified increment. Do not mark this investigation complete from this proposal.

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
