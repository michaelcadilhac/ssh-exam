# Exact template selection (implemented/tested locally; not deployed)

Actual workflow: root installs/verifies/syncs a catalog name/hash; an operator
selects it with `examctl web exams create/update --template-version HASH` or the
separate Immutable template hash field in Exam settings. The shared writer
requires the configured agent's exact historical attestation, never latest or a
mutable fallback. Source availability is still verified natively before Begin.
An explicit empty browser value / `--template-version legacy` changes only future
legacy defaults. Name edits do not silently clear a selected hash. Existing saved
preparations, intervals, holds, sources and submissions remain unchanged.

This connects the already-implemented native version consumer; it does not issue
enrollment-time grants, authorize another attempt or implement C15 outbound Begin.
No SQLite backfill/migration or deployment is performed.

## Implementation/acceptance boundary

- CLI definition replies must validate exact inner exam/settings, known fields,
  ranges/revisions and ordered bounded pages before output. Real root-namespace
  CLI/TLS regressions reproduce wrong-exam/private-field confirmed output RED0.071s.
  Outer signature authentication alone is not result/selection scope.
- Writes with a new version intent must refuse older gateways before mutation:
  a strict top-level root-management protocol marker and distinct versioned browser
  route prevent unknown create fields being silently stripped.
- Preflight checks loaded capabilities and exact signed native preparation/stage
  identity/source. Saved settings, not edited defaults, determine Begin. Repeat
  current page/settings/connection/monitoring/window fences after awaited checks.
- A distinct signed `activate-versioned-attempt` purpose makes older agents refuse
  before clock start. Current native code compares complete saved settings before
  OS checks and again afterward, then uses existing exact source verification and
  final snapshot/expiry fences. The root CLI's existing native `start ATTEMPT`
  still starts that recorded preparation through its exact native reader.
- Inspection, cancel, restart, stale completion and expiry use the existing
  preparation/intent mechanisms; no new pending reservation or disk-derived permit.
  Lost Begin replies are uncertain until reconciled, not automatic no-start proof.

Required tests: shared writer unknown/wrong-agent/name/hash and explicit legacy
selection; byte-compatible omitted legacy fields/sandbox normalization; actual
HTTP/signed root CLI/TLS create/update/retry/refusal; signed SSH preflight/Begin/
old-role/snapshot/page races; native exact byte staging/new purpose/settings and
deadline-preserving retry; browser create/edit/refusal and catalog-copy workflow;
affected broad application/native race/build/browser qualification.

## State and compatibility review (before broad qualification)

There is no new operation kind, reservation, grant, permit or schema migration.
Definitions and successful request receipts remain inspectable through the
existing CLI/web reads. A cancelled/expired preparation retains the existing
native cancellation, bounded cleanup and fresh-commit fences; selecting a new
default never revises it. Restart preserves its exact settings/hash but cannot
manufacture execution permission. A changed page/settings/connection/monitoring
or expired Begin window after awaited checks refuses before dispatch.

Historical catalog acknowledgement is not a source-retention lease. If an
operator removes or damages that native version, later staging/Begin refuses;
it never substitutes a different catalog version or mutable template. Existing
template deletion checks still protect native prepared/started references.
Gateway defaults alone are not grants or proof that a native deletion is safe.

New CLI version writes carry a top-level protocol marker, so an older strict
gateway rejects before mutation, including creates. The browser's distinct
versioned route is absent on older gateways and never falls back. A distinct
native Begin purpose is rejected by older agents even if cached/forged capability
metadata says otherwise. Existing legacy writes and recorded attempts remain
compatible. Loaded-role compatibility and actual source bytes must still be
qualified before a future drained rollout. No new source is selected implicitly.

Focused acceptance passes actual root-mapped CLI/TLS schema/target refusals,
signed gateway protocol-marker refusals, SSH/HTTP old-capability and snapshot
refusals, stale-page-during-Begin fencing and deadline-preserving native retries.
Ten browser definition/catalog checks pass; the separate actual built WASM SSH
preflight/Begin/terminal/Finish test also passes with complete exact settings and
no legacy-purpose fallback. These are interface tests, not privileged proof.

## Final local verification

Full native race/resource/namespace/compiler/default-size collection checks pass
core299.160s/CLI25.978s. All435 application tests/83 files pass101.94s, including
actual compiled namespace-root CLI → native verifier → local TLS/gateway/restart,
HTTP shared writer and signed SSH Begin. Static native build/vet, app/WASM build,
TypeScript typecheck and diff checks pass. The rebuilt assets pass16 Chromium
definition/catalog/exact-source student/SSH handoff/preflight checks46.7s.

The first broad application run had434 passes and one failure: an older real-CLI
fixture stored only id/name, not a valid exam definition. The new validator
correctly refused it. The fixture was corrected to a complete definition without
relaxing validation, the actual CLI workflow passed6.40s, then the full suite
passed. The failed receipt remains /tmp/ssh-exam-source-selection-app-final.log.
Other logs: /tmp/ssh-exam-source-selection-{app-corrected-final,native-final,
browser-final,build-final,types-final,real-cli-corrected}.log.

New native tests compare complete intent settings before OS checks and verify
actual immutable staging/Begin plus unchanged original interval on retry after
source removal. Local OS policy/UID/SSH guards are fixture-supplied; browser
shells/source attestation are synthetic. No claim of root installed-role/PAM or
all-reader guest qualification follows from these local checks. C12/epochs/full
C3, C15 unified Begin and enrollment-time grant issuance remain open. No existing
production source, definition, enrollment, attempt or student record is changed.

Privileged exact-artifact source/SSH/PAM/cgroup/hardening qualification remains
separate and blocked while csc-sys's pinned raw guard reports BUSY. No guest,
upload, service change, account/record mutation, deployment or consolidation.
