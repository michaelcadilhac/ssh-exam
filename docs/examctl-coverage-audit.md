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
| Workspace inspection/holds/manual cleanup | `workspaces help` | Known metadata/holds and isolated dry-run; snapshot_clear is diagnostic. C4c candidate adds reviewed cleanup/status/retry/cancel, leases/all-directory sealing, exact-inode quarantine, durable receipt/history/archive pins; focused and broad native checks pass, guarded qualification pending |
| Legacy saved-work grants | `help recovery-grants`, `web grants help`; explicit allowance edits via `web students` | Reviewed unused revoke-preview/revoke, then separate NEW issuance/source-sync; C17 preserves existing explicit unused-duration reconciliation; no consumed-history conversion |
| Native configuration/lifecycle | `config help`, `help agent` | Offline selected-file/key observation; lifecycle is separately authorized drained maintenance, not implicit apply |

Root protected export audit/output safety is ALREADY implemented in OpenExport
and the CLI; the older inventory's instruction to add it was stale. Do not redo
that capability. Browser login/logout and local desktop preferences remain
interactive; root management uses the agent identity instead of a browser session.
Incident JSON editing/transfer scripts remain unsupported management substitutes.

## Necessary remaining integration gates

- **C4 workspace cleanup:** the integrated candidate now supplies reviewed
  quarantine/removal/status/retry/cancel, archive-pin/no-start integration and
  corrected exact-SIGKILL/storage/restore regressions through actual interfaces.
  Broad native checks pass; guarded multi-UID/resource/healthy-peer qualification remains.
  Manual/no-grace is settled; no unsafe switch/expiry shortcut. Exact state review
  and qualification scope: workspace-cleanup-protocol.md. C4 stays open.
- **Configuration writes:** show/validate does not install/apply. Agent/watchdog
  load configuration at startup; a new examctl invocation reads its selected
  file. A replacement alone cannot establish loaded-writer agreement. Need a
  reviewed exact candidate, closed admission/full drain/inventory, checked audit,
  matched-role activation and explicit authorized lifecycle actions, including
  independent practice owners and all canonical/temporary agents. No partial apply.
  Do not interpret this as a requirement to remotely edit every deployment file.
  The instructor prefers web administration for operational settings; CLI parity
  would use the existing authenticated API. SMTP/recipients, worker/recording/
  preflight limits and maintenance are concrete candidates to review. Origin,
  listen/storage paths, SSH endpoints/pins and key/relay paths remain deployment
  setup unless explicitly included. The repeated question about two examctl
  installations/remote file control was premature and is withdrawn; it is not an
  unanswered prerequisite for cleanup or existing management workflows.
- **Complete operator journey:** create/import/grant/clock/review, saved recovery
  and retirement have interface evidence; the combined journey still needs the
  remaining cleanup/configuration workflows. Help must guide to implemented
  commands and distinguish these exact gaps from deferred production checks.

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
