# Current management coverage audit

October26,2026. Current source/interface audit and local CLI correction; not deployed.
This inventories implemented workflows and actual gaps. It does not declare full
management or the broader TODO investigation complete.

## Confirmed discovery defect

`examctl help` hid the grant topic. `help management` still said unified grants
and source binding were missing; `web help` incorrectly listed independent empty
work and sandbox grants as pending. Three actual CLI process regressions fail on
that version. The corrected overview links `web grants help`; management/web help
describe current sources and practice, retain honest remaining gaps, and require
attested exact versions in the new-enrollment example. Help still works without
root/configuration and preserves operational/usage exit-code distinctions.

## Inspected supported interfaces

The gateway route handlers and signed AgentManagement dispatcher call the same
services. CLI help is exercised at the process entry, and the latest application
qualification includes compiled root CLI over real isolated TLS/restart. Each
feature document retains the boundaries of its operational tests.

| Management workflow | Discoverable supported CLI | Authority/limits |
| --- | --- | --- |
| Definitions/settings/finite practice window/retirement | `web exams list/show/create/update/native-review/reconcile-native/retire-preview/delete/archive/unarchive`; `web help` | Shared ExamDefinitions; exact revision/dependency review, durable retry/audit; legacy033 acknowledgement binds positive native/web history; unknown/live authority refuses |
| Roster/CSV/accommodations | `web students help` | Shared RosterManagement; reviewed import, explicit-edit provenance; issued snapshots unchanged |
| Initial, reviewed legacy/additional and practice grants | `web grants help` | Shared AttemptGrants/GrantIssuance; list/show/history/unused revise/revoke and reviewed preview/show/cancel/confirm; actual Begin starts time |
| Immutable source installation/attestation | `templates help`, `web templates help` | Local jobs/verification and signed metadata sync; no mutable fallback for exact grants |
| Attempts/current clocks/pending changes | `web attempts help`, `web clocks help` | Shared bounded inspection and reviewed clock intents; gateway acceptance differs from native application |
| Interruption review/continuation | `web interruptions help` | Exact generation/revision; approval is not execution permission |
| Alerts/delivery/manual reminders | `web alerts help` | Shared AlertManagement; current resolution, original-intent retry and no automatic escalation |
| Monitoring reads/media/export/deletion/purge | `web monitoring help` | Shared private reads and durable isolated purge; logical deletion differs from physical completion |
| Administrator metadata/creation | `web administrators help` | Agent authorization, strong-verifier retry, secret-safe input; no password reset/overwrite |
| Native attempts/panes | `help COMMAND` for start, pause, finish, cancel, cancel-absent, retry; `panes help` | Root native scope/exact targets; reports plus existing reconcile inspect/acknowledge timed-owner receipts, while manual closure preserves pending proof; not retained freeze |
| Native inspection/access/protection | `help COMMAND` for list, info, health, accounts, reconcile, override-access; `help collection`; `panes supervisor ATTEMPT` | Read-only inspection exposes optional registered page/transport/boot/authorization identity and exact lease-owner mismatch; observation grants no permission. Emergency override never an automatic shortcut |
| Protected submissions | `help COMMAND` for manifest, export, delete | Code inspection confirms bounded verification and checked durable audit before exporting bytes to the caller; new0600 output/no overwrite; deletion preserves history/holds/dependencies |
| Workspace inspection/holds/manual cleanup | `workspaces help` | Reviewed cleanup/status/retry/cancel, leases/all-directory sealing, exact-inode quarantine, durable history/archive pins; full native and guarded healthy-peer/NEW saved-restore qualification pass locally. Preview alone is not a deletion permit |
| Legacy saved-work grants | `help recovery-grants`, `web grants help`; explicit allowance edits via `web students` | Reviewed unused revoke-preview/revoke, then separate NEW issuance/source-sync; C17 preserves existing explicit unused-duration reconciliation; no consumed-history conversion |
| Native configuration/lifecycle | `config help`, `help agent` | Offline selected-file/key observation; lifecycle is separately authorized drained maintenance, not implicit apply |

Root protected export audit/output safety is ALREADY implemented in OpenExport
and the CLI; the older inventory's instruction to add it was stale. Do not redo
that capability. Browser login/logout and local desktop preferences remain
interactive; root management uses the agent identity instead of a browser session.
Incident JSON editing/transfer scripts remain unsupported management substitutes.

## Local completion and settled scope

C4 is implemented/tested locally: actual resource-limited root cleanup alongside
healthy signed SSH, lease-break/cancel/other-UID barriers, original-deadline
release and cleanup→NEW90-minute protected saved-work restore all pass. Exact
artifacts, state review and retained failures: workspace-cleanup-protocol.md.

The instructor explicitly chose to KEEP installation settings in configuration
files and finish existing management. No new web Settings, remote file editor or
activation subsystem is required. Native show/validate remains offline; it never
claims loaded agreement. Reviewed installation/full drain/matched-role activation
and temporary-agent consolidation remain separate production procedures, not
missing runtime management features. Existing web controls retain CLI parity.

The combined actual compiled-root-CLI→real gateway/TLS journey already exists in
tests/integration/agent-management.test.ts and its management fixture helpers.
It covers definitions/CSV/grants/clocks/reviews/alerts/admin/monitoring/retirement
with conflicts, partial/offline/restart retries and dangerous refusals. Current
focused run passes7.79s. Separate actual-root native collection/access/cleanup/
saved-restore acceptance supplies the privileged boundaries. Stale missing-work
help is now corrected and the management boxes are reconciled as implemented/tested
locally. Do not add duplicate features or tests from old historical pending prose.

Final bounded help correction is implemented/tested locally: actual process regression
reproduced stale missing-work claims, and management/web help now describes the
delivered cleanup/status/retry/cancel flow and explicitly file-based installation
scope. Exam-state SQL/JSON remains protected; offline validation is not loaded
agreement. Focused help/refusal/read-only/scoping races pass7.227s. One initial
test oracle incorrectly matched legitimate collection limits applying to future
settings snapshots; it is narrowed to the exact stale definitions-heading claim,
with the failure retained. No product snapshot policy was changed. Only command
help strings/tests change; core state/ownership/monitoring and application/browser
contracts are unchanged. Final full affected CLI races pass24.386s, actual compiled
CLI→real gateway/TLS journey passes7.81s and build/vet pass. Exact final18-file
45,716,855-byte code-only bundle0ec06626170a9de24a920f77e0c4a16e2d9e79bf773d18583b12f8ab980f1f8c
passes guarded real-root healthy-peer/collection-SIGKILL/lease-break/cancel/queued-
FD/cleanup/deadline release. Stagew9dm54_b independently preserves host/base/authority;
unique unit51ffcf319b0b48acbd291ab6422c432c is inactive/dead/MainPID0. No guest remains.
The final bundle's core-qualification.test is byte-identical to the full retained/
saved-restore cohort, and all core source inputs are unchanged; final root health/
SSH/cleanup checks use the rebuilt CLI and roles. All291 final native inputs match.
The297 recorded application/browser/image source inputs match the prior C17 receipt,
including its declared browser wait-fixture correction; this is reuse of unchanged
625-test/browser/image evidence, not a claim that those suites ran again.

Durable final receipts: MAIN var/collection-tests/todo-local-completion-evidence.0einctzi;
current artifact/source details and production boundary: todo-current-checkpoint.md.
All four management checkboxes and local regression acceptance are complete locally.
Only separately deferred production consolidation/live acceptance remain; no deploy.

C17 first-observation/fresh-Begin compatibility, retained liveness/SSH, C18 saved-source authority, cancel-first legacy replacement,
C8 native reconciliation and accepted16-student/64-pane qualification are complete
locally. See unified-grant-acceptance.md, legacy-recovery-migration.md,
native-exam-reconciliation.md and retained-release-qualification.md for exact
artifacts/seams. Do not reimplement them from older historical pending prose.
Production drain/backup/install/live camera/MFA/alerts and three-service
consolidation remain deferred by instruction. Existing receipts do not qualify
new native diagnostic artifacts or constitute production acceptance.

The current scope reconciliation is in todo-delivery-audit.md. Do not treat
completed per-worker isolation as unimplemented because class-capacity testing
is pending, or treat missing future features as a reason to redo existing help.

Detailed operator workflows: examctl-workflows.md. Decisions/source evidence:
todo-design-decisions.md, grant-workspace-sources.md and the current checkpoint.

## Verification

Three discovery entry regressions are RED0.011s, then focused discovery/all-command
help/syntax checks pass0.181s. Full CLI race/TLS/namespace tests pass15.259s; static
native build, vet, gofmt and diff checks pass. This change adds no durable state, command permission,
management mutation or runtime contract. Current application/native-core/client
evidence from4148022/f8738d2 remains applicable; do not rerun unchanged browser or
application suites merely for help wording. Logs:
/tmp/ssh-exam-management-help-discovery-{red,focused,cli-race,build,vet}.log.
All runners completed. No command was missing; nothing was pushed or deployed.

October26 discovery correction: actual process regression RED0.023s exposed stale
"saved-work migration pending" global help. All four first-time entry paths now
show cancel-first NEW/source-sync and native-review/reconcile-native; focused
process checks1.201s and full CLI/race/TLS/namespace suite19.499s PASS. No runtime
contract or app/browser changes, so unchanged622 app/C8/browser/286 kernel evidence
is retained within its original scope. Unified authority/scenario and existing
crash/storage acceptance reconciliation is in unified-grant-acceptance.md.
