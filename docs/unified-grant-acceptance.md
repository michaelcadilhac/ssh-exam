# Unified grant authority, migration and acceptance

October26,2026. Current local implementation/evidence reconciliation. No production
migration, installation, account edit or deployment is authorized or performed.
This document specifies the unified-model investigation's acceptance; it does not
turn separate workspace cleanup/configuration or live rollout gates into passes.

## Authorities and synchronization

The gateway owns immutable issued grant revisions (settings, kind/order, exact
materials/work source, finite Begin window), reviewed issuance/revision/revocation,
claims/Begin intents and management audit. Initial settings are saved atomically
at enrollment/import. Defaults and later roster edits never rewrite an issued
grant. Explicit revision applies only to unused authority; extra windows may lie
outside definition defaults. Effective webcam stays fixed unless explicitly
overridden. Ordinary legacy uniqueness and historical attempts remain preserved.

The native class server owns the committed original/current interval, exact Unix
identity, one-use/start/publication evidence, workspace, protected collection and
independent original-deadline account restrictions. Fresh fixed-purpose Begin
must agree over authenticated outbound HTTPS with the exact gateway grant/claim/
intent. Outage, stale/revoked/revised authority or incompatible roles refuse before
new time/consumption. An uncertain committed reply retries the same intent; it
cannot choose a new interval or silently grant another allowance. Continue on an
existing attempt is a different protocol and never issues a second grant.

Saved sources also require durable native retention confirmation. Reviewed
issuance first produces inspectable/revocable PENDING_NATIVE authority; source-sync
verifies the exact student's protected archive/manifest/checksum and durably pins
it before acknowledgement permits AVAILABLE. No pending grant/preview/pin reserves
an account or starts a clock. Pin closure stops new consumers and releases only
after positive protected-completion/no-start evidence for every recorded consumer;
missing records or timeouts never release data. Staging is a private copy, never
the original archive/live folder. Current limits and archived source limits are
both enforced. Prepared/started history and unsaved process memory are not moved.

Native cancellation tombstones positively fence delayed absent/rejected prepares.
They preserve authoritative contradictions rather than trusting a missing row.
Uncertain cleanup is inspectable and retryable; arbitrary not-found/timeouts do
not authorize web retirement, a new claim or source deletion. Legacy allowance
reconciliation changes only explicitly authorized unused duration provenance;
identity/source/checksum/history are fixed. No automatic refund or reopening of
completed attempts exists. Signed exact purposes, role negotiation, UID/source
expectations and positive receipts prevent incompatible rollback from selecting
starter work. Root management uses the approved existing agent identity, named
default-deny authorization and checked audit, without student credentials.

## Reviewed migration and rollback proposal

1. Preserve current recovery until a deliberate replacement. Inventory gateway
   grants/claims/intents and native attempts, legacy grants/consumption/pending
   files, source pins, archives and original account restrictions. Resolve
   unknown/live/failed/pending authority through supported inspection/repair;
   absence or an elapsed timestamp is not evidence that it never started.
2. Only during a separately authorized verified full drain, take consistent
   private gateway DB/WAL and native/config/key/archive/audit backups. Qualify a
   private copy and matched roles first. Additive migrations023–033 preserve
   history; they do not invent old enrollment-time settings or delete active rows.
   New columns/fences are not permission to edit historical attempts.
3. New enrollment/import issues initial saved settings. Existing unused legacy
   enrollments receive only reviewed bulk NEW issuance from explicitly selected
   current settings, attested source and finite window. Practice uses its finite
   operator-configured window and fixed five-minute/no-webcam repeatable grants.
   Additional grants preserve their separate immutable order and work choice.
4. For an unused native recovery permission, use recovery-grants revoke-preview
   and exact reviewed revoke first; inspect the irreversible receipt. Then issue
   a separate reviewed NEW saved-work grant and source-sync. Failure leaves the
   student waiting; it cannot restore the cancelled permission. Preserve original
   bytes in the canonical cancellation envelope, source/archive and one-use history.
   Prepared/consumed/uncertain permissions are not eligible for that replacement.
5. Before retiring legacy definitions, use native-review/reconcile-native033 and
   a fresh shared retire-preview. Positive terminal native/web history requires
   archive; only genuinely unused definitions can be deleted. Never clear028's
   legacy fence, source expectations or native-only history by hand.
6. Post-install acceptance and any three-agent consolidation are future production
   operations, not local completion. Keep admission unavailable on mismatch and
   prefer compatible forward repair. A rollback must preserve newer tombstones,
   starts/claims/consumption, revisions, pins,033 acknowledgements and protected
   history; never unwrap cancellations or restore a pre-start snapshot. Detailed
   drain/install/migration/rollback/consolidation proposal: todo-rollout-plan.md.

## Scenario acceptance and actual entry points

| Required scenario | Observable result and existing evidence |
| --- | --- |
| Retake from reset template work | Reviewed additional-preview/issue-confirm fixes exact materials and independent template work; student fresh Begin commits its own full allowance. additional-grants.test.ts, grant-begin's additional-after-completed/source cases, native explicit-work/TLS/restart checks. |
| Saved-work recovery and chosen compensation | NEW saved grant plus source-sync; zero-clock preflight, copied verified files, full chosen allowance only at Begin. Actual root43 ninety-minute and public C7 twenty-minute replacement/protected export, with old holds/history unchanged. No old-clock repair/refund. |
| Second full ninety-minute attempt after exam end | Explicit independent finite extra window/settings, original protected history retained. additional-grants.test.ts and exact root43 saved-work full ninety-minute Begin; windows outside defaults are deliberate. |
| Empty work | Reviewed --work empty fixes empty initializer independently of materials. grant-begin additional-empty and native explicit-work signed staging/TLS/restart. |
| Abandoned/rejected preflight | Positive cancellation/no-start evidence, same unused authority retry, source unchanged; no start/consumption from failure. recovery-admission.test.ts, native rejected-preparation/cancellation/restart and actual CLI cancel-absent. |
| Simultaneous login/claims | Shared durable claim/intent and native one-use/UID fences refuse duplicates/rebinding. initial/additional grant tests, native concurrent/restart/one-use cases;16 simultaneous students/64 panes qualified independently. |
| Webserver unavailable | Fresh outbound Begin refuses before clock/consumption, with same-intent retry; already-started deadlines remain native. grant-begin outbound-unavailable/capture-stale cases and native fresh TLS reply/expiry checks. |
| Restart/lost confirmation | Immutable revision/preview/claim/intent retry, source pin known-record loss refusal, canonical original interval. Source-retention/issuance HTTP/CLI/TLS tests, actual saved-work cancellation exact retry, native signed Begin/restart tests. |
| Outstanding original account restriction | Extra permission never releases or overrides it. Native access/admission tests preserve the held interval; actual root/PUBLIC C7 preserves intervals/history and independent holds. The root ninety-minute source is positively RELEASED before its new Begin; that success is not permission to bypass a held source interval. |
| Recovery crash/storage fault | Actual child death at eight private/start/consumption/work/initialized boundaries, operator-first and watchdog-first; actual private ENOSPC/EROFS at eight storage stages, supported root-mapped CLI repair/refusal and healthy signed peer. Work/source/interval/one-use preserved. See workspace-publication-crash-qualification.md, recovery-consumption-atomicity.md and recovery-storage-diagnostics.md. |
| Ordinary/sandbox/legacy migration | Populated025/027 upgrade/restart/invalid-FK refusal tests preserve prior rows; reviewed unused bulk issuance invents no history; exact286 root/PUBLIC cancellation→NEW/source-sync proves supported handoff;033 image/schema24→33 and browser/CLI retirement preserve HELD/native-only history. |

The named TypeScript files are under tests/integration (migration tests under
tests/unit); native tests are in ssh-server/internal/core. Public workflows and
exact receipts: grant-workspace-sources.md, legacy-recovery-migration.md,
native-exam-reconciliation.md and retained-release-qualification.md. Full C8
qualification622 app checks includes the current gateway grant/migration scenarios.
Exact286 native qualification, root43/PUBLIC C7 and16/64 receipts qualify that
execution cohort, not newly built diagnostic binaries or production installation.

The crash/storage matrix uses actual kernel mounts/filesystem failures and real
compiled CLI/signed/watchdog entries; OS account/activation adapters in that matrix
are synthetic and explicitly do not qualify root PAM/cgroup enforcement. Separate
guarded installed-kernel/SSH/root/C7/healthy-peer qualification supplies those
boundaries. These are complementary tests, not a claim of simulated power loss or
every fault combination. Focused current-source reconciliation result is recorded
below; no unchanged broad application/browser rerun is needed for this
specification/help correction.

Current-source reconciliation PASS41.678s under native race: all eleven selected
top-level entries pass, no skips/failures. Includes signed initial/independent/
additional fresh TLS Begin and restart, rejected recovery cancellation/retry,
explicit allowance/publication/restart/source/purpose checks, both eight-stage
child-death orders and the eight real storage faults. Both namespace/compiled CLI
opt-ins are enabled. Receipt: /tmp/ssh-exam-grant-acceptance-reconciliation.jsonl.

Separate open gates: complete safe workspace deletion and configuration activation/
operator journey; focused legacy allowance installed-role compatibility acceptance
where still missing; and all deferred production inventory/drain/live camera/MFA/
alerts/rollout/consolidation. Their existence does not leave the unified authority,
migration rules or listed scenario specification undefined.
