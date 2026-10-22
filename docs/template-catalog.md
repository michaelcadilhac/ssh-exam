# Immutable local template catalog

October 21, 2026: candidate local development, **not deployed**. This is the C2a2
foundation for fixed-at-issuance grants, not completed unified grants or their
migration. Current gateway-issued snapshots still use legacy template IDs. C2a3
now adds native-only optional exact-version readers. C2a4 additionally provides
signed metadata acknowledgement and read-only gateway inspection; no gateway
selection or grant issuance/migration is enabled. Native catalog
installation does not select a version, issue a grant, change an existing attempt,
or confirm availability to the gateway. Never enter a catalog hash as a legacy
dashboard Template ID.

## Signed gateway metadata acknowledgement (C2a4, local only)

After installing/verifying an exact version, use the root CLI on the class server:

```sh
sudo examctl templates sync NAME HASH --reason 'Reviewed exact installed source'
sudo examctl web templates list --name NAME
sudo examctl web templates show NAME HASH
```

Use `templates help` and `web templates help` for complete arguments/examples.
`sync` first verifies current local bytes in the separate bounded native worker,
then uses C1's existing outbound signed root-agent management channel. Explicit
named authorization is required for `templates.sync`, `templates.list` and
`templates.show`; an ordinary callback signature or browser-admin login does not
grant source-attestation authority. No new credential or inbound agent API.

The registry stores only the exact agent/name/hash, immutable logical counters,
first/latest native creation and attestation/acknowledgement timestamps, request
identity and metadata revision. No source paths, inventories, question bytes or
student credentials. Out-of-order observations cannot regress the retained row.
This is historical/as-of root evidence, **not** a live source probe, availability
lease, default selection or grant. Native full-byte verification before Begin
remains necessary. Ordinary definitions/enrollments still issue legacy snapshots.

Reuse `--request UUID` for a lost sync reply with identical intent. Exact retries
retain the original gateway acknowledgement, even after a restart; they do not
refresh its age. A new sync UUID explicitly refreshes the observation. Fresh
`web templates show` reads use a NEW read request; a cached receipt is not fresh
physical availability. A local verification failure sends no new attestation and
does not erase an older acknowledged row. The combined result distinguishes local
verification from gateway acknowledgement; neither means deployment or selection.

Administrators may inspect the same read-only metadata via **Administration →
Template catalog**. Lists default to 50 rows (maximum 200), with exact-name filter
and exclusive NAME@HASH cursor. These are live pages, not a consistent full export.
Details retain list navigation/focus and display times in the current device
timezone. The browser cannot upload/attest, select a default, delete or issue grants.
Signed CLI reply validators reject wrong scope, missing/extra/null fields,
inconsistent counters/cursors and invalid flags before printing any private output.
Reasons use 8..1000 UTF-8 bytes consistently across native/CLI/gateway validation.

Additive migration020 retains metadata without cascading through definitions,
grants, attempts or submissions; it rewrites none of them. Back up that registry
with the root native catalog, existing request/audit ledgers and normal state.
Rollback requires coordinated permission/config/browser/CLI compatibility; retain
rows and newer records rather than restoring an old database or deleting a source
to make an older writer work. No production migration or service change occurred.

Qualification includes real compiled CLI/local TLS/native verification/restart,
default-deny authorization/replay/idempotency, signed wrong-scope output refusal,
source corruption, shared admin reads, HTTP authority and four browser workflows.
The compiled CLI verifier test uses a synthetic manager adapter inside private
user/mount namespaces, not privileged system-manager qualification. Full361 app,
91 combined browser and fresh native race/resource/namespace/compiler checks pass
with the H2a contact candidate; see todo-progress.md. Unified grant selection and
privileged combined guest qualification remain open. Nothing is deployed.

October22 C2a5 adds a separate guarded template-catalog guest profile using the
actual root CLI/system manager and supplied slice, no adapter. The128MiB workflow
and exact retries/refusals/published-job cleanup pass with host/base preservation;
two final exact-artifact runs and full native compatibility pass. See template-guest-qualification.md
for exact artifacts, failed fixture evidence and narrow limits. This does not
qualify unified issuance or actual version-bound Begin. The earlier privilege
deferral above records that earlier checkpoint, not this new test's status.

## Supported workflow

Use `examctl templates help` or `examctl help templates`; help and syntax checks
need neither root nor configuration. Actual operations require real/effective
root on the class server and its protected `--config FILE` (default
`/etc/exam-agent/agent.json`). They work offline from the gateway. Do not use
private worker flags, JSON editing or an incident script as management interfaces.

1. Prepare a quiescent private package containing **only** `work/` and
   `materials/`. Keep solutions, hidden tests and credentials outside both.
2. Run `sudo examctl templates validate /private/package`. Review `info.hash` and
   the student-visible content. Validation is not installation or a writer freeze.
3. Run `sudo examctl templates install NAME /private/package --expected HASH
   --reason 'Reviewed immutable source package'`. Retain the request UUID printed
   on stderr before work begins; optionally specify `--request UUID` yourself.
4. Inspect `templates list`, `templates show NAME HASH` and `templates verify
   NAME HASH`. Show/list read metadata; verify streams the actual installed bytes.

Successful native catalog JSON includes explicit `verified`, `installed`,
`gateway_confirmed=false` and observation time. Only the separate explicit sync
workflow reports a signed timestamped gateway acknowledgement, never installation
alone or live availability. No `latest` selection, published-version deletion, student upload,
new listener or webserver filesystem copy exists. Exact `NAME` plus lowercase
64-hex `HASH` identifies a version. Changed bytes, ordinary mode or precise mtime
produce a different hash; old versions are never overwritten.

Validation rejects links (including hardlinks), special files, nested mount IDs,
invalid UTF-8 paths, unreadable/unsearchable materials, reserved root
`work/MANIFEST.json`, depth above 32 and more than 10,000 entries per tree. File
hashes are streamed. Metadata inventories bracket reads to reject observed
mutation; they do not guarantee an atomic snapshot of hostile concurrent writers.
Installation independently verifies its own exclusive private copy and reinspects
the source before publication. Stop author edits until that completes.

`--file-mib` defaults to 128 (1..4096); `--total-mib` defaults to 512
(file limit..16384), over **combined work and materials**. MiB means 1,048,576
bytes. These are import logical bounds, not live workspace quotas, edits to exam
collection settings, or a promise that every maximum-sized package fits resource/
runtime/storage budgets. Leave headroom for student files in separately issued
collection settings. Installation refuses detected tmpfs/ramfs native state;
preserve existing data and plan a drained storage migration, never move it live.

## Isolation and durable lifecycle

Management operations run in ordinary `examctl` child processes with private bounded
request/reply frames (16 KiB/128 KiB). The coordinator validates protocol identity,
action, exact target, counts, pagination and required policy flags before stdout.
Worker stderr and malformed/private payloads are never forwarded as results.
No Config, signing key, student password, source inventory or file contents enter
worker IPC. Only root-owned paths/settings needed for that operation are passed.

The separate supplied `exam-template.slice` must be loaded with at most
256 MiB aggregate memory, no swap and 32 tasks. Each transient worker also has
256 MiB/no swap/32 tasks, 120-second runtime, CPU quota 100%, nice 10, group-wide
kill and bounded shutdown. Missing/unbounded pool configuration refuses template
management; it does not stop the agent or refuse student admission. One persistent
owned 0600 single-link `worker.lock` flock serializes bulk validation/import/
verification/cleanup across coordinators. Metadata list/show/jobs bypass that
bulk flock but share the bounded slice. No template worker takes attempt locks,
collection slots, or loads/saves `state.json`; no bulk IO runs under `WithState`.
Kernel memory limits are enforcement controls, not mathematically exact peak-byte
ceilings or persistent disk quotas. Whole-host headroom remains necessary.

The root-private namespace is `<native state>/template-catalog/`:

- `versions/NAME/HASH/` holds atomically published `version.json` and private
  `content/{work,materials}`. File/directory flushes precede no-replace publication.
- `jobs/UUID/` retains a bounded intent receipt and, after an interrupted import,
  possibly private `publish/` scratch. No student/grant reader resolves jobs.
- `audit.ndjson` retains root identity, action, request/target and audited reason,
  not authored source paths or inventories. Concurrent appends are flocked and
  flushed. A partial failed append is preserved, with later complete records
  separated onto new lines; absence of a complete result is not success.

Never replace lock inodes or remove job/audit receipts to force a retry. Reasons
must be 8..1000 UTF-8 bytes; do not put credentials or student text in them. Root
is the authenticated actor; no human identity is inferred from environment.

## Lost reply, crash or refusal

Run `templates jobs` and `templates list`, then `templates verify NAME HASH`.
Pages default to 50, maximum 200; pass returned `next` as exclusive `--after`
(UUID for jobs, NAME@HASH for versions), retaining any `--name` filter. These are
live metadata pages, not a consistent full export or fresh byte verification.

Retry an installation with the **same** request UUID/name/hash/limits/reason.
The source path is not retained as permanent intent identity; the expected hash
binds content. If the exact published version exists, retry verifies/adopts it
without recollecting the now-mutable or missing source. Corrupt/missing installed
metadata/content refuses; no overwrite, implicit repair or mutable-source fallback.
Different arguments under a retained UUID conflict. A new request for an already
installed exact version also verifies it instead of copying again.

An interrupted private stage is never automatically adopted or recopied. Use:

```sh
sudo examctl templates clean JOB_UUID --confirm JOB_UUID \
  --reason 'Reviewed failed unpublished import only'
```

This excludes bulk workers, verifies any already-published exact version, and
removes **only that known job's unpublished scratch**, with owner/link/type/
entry/depth/mount checks. Root, nested-directory and regular-file bind mounts
refuse without following them. A failure can leave partially cleaned private
scratch; preserve the error and inspect the same job. Installed versions and all
legacy sources, attempts, submissions, workspaces, deadlines and holds are outside
the deletion target. Retain receipts; use a **new** install UUID after cleanup.
Cleanup is manual, with no automatic grace-period expiry or background deletion.

A crash before the initial intent is saved appears as `unrecorded`, with no
invented name/hash/time. Cleanup accepts only an empty directory or verified
bounded private atomic-metadata scratch leaves. Unknown content trees, links,
mounts and special files refuse for diagnosis. It retains an
`unrecorded-cleaned` tombstone; reusing that UUID remains prohibited. Repeated
cleanup is safe. These job controls are **not** C4 workspace cleanup.

Exit status: 0 validated result/metadata or completed exact cleanup; 1 operational
refusal/failure; 2 syntax misuse. A worker crash, OOM, timeout, storage failure or
lost acknowledgement never changes student clocks, consumes an allowance,
reopens attempts, releases restrictions or restarts an exam service.

## Qualification and next dependency

Focused local race tests cover real child panic/exit/SIGKILL/hang/fatal allocation,
publication boundaries, strict malformed/scope/oversize replies, safe cleanup and
unchanged authority/protected sentinels. Private user/mount namespaces exercise
actual ENOSPC/read-only failures and root/nested/file bind cleanup refusals. Actual
local user-systemd tests enforce OOM/runtime failures independently of attempt
management. Compiled root-mapped CLI tests exercise validate/install/retry/list/
show/verify/jobs/clean and stdout-empty refusals with a **synthetic manager
interface**, not a claim of privileged system-manager qualification.

The separately authorized csc-sys guest qualification remains pending: a read-only
precheck found two live/unresolved host attempts, so its idle-host guard prohibits
starting the bounded test guest. No host services/configuration/accounts/state
were changed. Continue independent local work, not production reconciliation.
Full verification evidence is recorded in `todo-progress.md`.

Next: bounded authenticated catalog acknowledgement and gateway selection of the
optional native binding below, then gateway-owned grant issuance/claim/
Begin/revision and reviewed legacy migration. Those are not enabled by this CLI.
See `template-grant-investigation.md` and the future-only `todo-rollout-plan.md`.

## Optional native exact-version binding (C2a3 candidate)

Native `Settings.template_version` is an optional exact lowercase 64-hex hash;
`template` remains its name. Omitted fields retain byte-identical legacy settings
JSON/hashes, private receipts and protected history. A present hash means catalog
only: never mutable fallback or latest. Gateway definitions, enrollment and grants
do not yet expose/select this field; do not edit native JSON to simulate issuance.

Versioned staging verifies the whole work/materials package in the already
bounded **actual-attempt** staging worker, including when adopting retained private
work. The private receipt binds its source hash and complete settings hash. New
work copies the exact catalog starter; saved work keeps its protected-source
semantics independently of the material version. The old test-only initializer
refuses versioned inputs instead of providing a second mutable copier.

Before committing Begin, the root coordinator verifies actual catalog bytes in
a separate template worker, outside `WithState`; no policy change, clock or
allowance is committed on failure. It then rechecks ownership/generation/settings/
window and command expiry through existing fences. Ordinary exam-agent and
examctl support that private root-only worker entry; exam-login does not. A hung,
killed or panicking verifier cannot hold the shared state lock. Missing pool or
damaged version refuses; never restart a service, substitute source or refund time
to force Begin. Use `templates verify NAME HASH` and `info ATTEMPT` for diagnosis.

Normal and trusted-administrator material mounts and the bounded welcome reader
resolve the same recorded version on each new pane. Admission reads only bounded
metadata/directory identities, never streams a catalog while holding shared state.
Practice bypasses every catalog/material read, even if the recorded version is
missing. Missing explicit materials refuses actual panes, not an optional-banner
skip. Existing legacy attempts keep their exact old reader semantics. Native
capability `immutable-template-versions-v1` advertises support, not gateway
confirmation or a grant. Future gateway use must require matching native support.

Focused local signed stage/Begin/restart, author/new-version edits, legacy encoding,
corruption/missing/symlink/no-fallback, actual verifier kill/panic/hang, post-verify
snapshot races and private read-only bubblewrap material IO tests pass. The last
uses an existing private target because this workstation has no `/materials`;
it is not full privileged SSH/PAM/sandbox qualification. Full native/application/
browser regression status is in todo-progress.md. Privileged guest qualification
and grant/source selection remain open; C2a4 above adds signed metadata
acknowledgement, not current availability. These increments do not finish the wider
investigation or authorize deployment.
