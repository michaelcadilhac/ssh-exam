# Current management coverage audit

October 23, 2026. Source/interface audit and local CLI correction; not deployed.
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
| Definitions/settings/finite practice window/retirement | `web exams list/show/create/update/retire-preview/delete/archive/unarchive`; `web help` | Shared ExamDefinitions; exact revision/dependency review, durable retry/audit; pre-existing native-unreconciled definitions refuse retirement |
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
| Workspace metadata/holds | `workspaces help` | Known-attempt metadata/holds only; no eligibility/deletion command enabled |
| Legacy saved-work grants | `help recovery-grants`; explicit allowance edits via `web students` | Read-only native catalog plus C17 preflight reconciliation, not unified create/revoke/migration |
| Native configuration/lifecycle | `config help`, `help agent` | Offline selected-file/key observation; lifecycle is separately authorized drained maintenance, not implicit apply |

Root protected export audit/output safety is ALREADY implemented in OpenExport
and the CLI; the older inventory's instruction to add it was stale. Do not redo
that capability. Browser login/logout and local desktop preferences remain
interactive; root management uses the agent identity instead of a browser session.
Incident JSON editing/transfer scripts remain unsupported management substitutes.

## Necessary remaining integration gates

- **C16 / retained authority:** complete timed ownership, input/loaded-role
  agreement, all-writer stop-assisted freeze and technical-hold recovery. Keep
  retained mode disabled until real end-to-end qualification; current lockouts
  still disconnect. This is not completed by existing private primitives.
- **C18 / saved-source authority:** durable native retention confirmation before
  usability is approved October23. Integration remains necessary: native deletion
  cannot yet see unused gateway saved-work references. No offline JSON writer bypass.
- **C8 / legacy retirement:** shared reviewed retirement now exists for newly
  lifecycle-tracked definitions, preserving all history.028 blocks ALL pre-existing
  definitions until supported native dependency reconciliation; missing web rows
  never prove native legacy authority absent. Known saved-work references and
  consumption lacking closed-attempt proof also refuse. No manual flag clearing.
- **C4 / workspace cleanup:** holds are supported, destructive cleanup is not.
  Require verified archive and complete writer/kernel/namespace-use proof through
  the containment work; manual/no-grace approval is settled. No unsafe delete
  switch or expiry-based release is a substitute.
- **Configuration writes:** show/validate does not install/apply. Agent/watchdog
  load configuration at startup; a new examctl invocation reads its selected
  file. A file replacement alone cannot establish agreement among loaded writers.
  The next integrated workflow needs a reviewed exact candidate, closed admission,
  full drain/inventory, checked audit, matched-role activation and explicit
  separately authorized lifecycle actions. Include independent practice owners
  and all three canonical/temporary agents. No partial apply is enabled here.
- **Complete operator journey and target qualification:** current create/import/
  grant/clock/review workflows have interface evidence; a single complete journey
  through saved recovery, retirement and cleanup awaits those implementations.
  Privileged exact-artifact SSH/PAM/cgroup/cross-namespace and simultaneous-load
  qualification still requires a positively safe disposable host. Last guard BUSY;
  no new remote operation or production consolidation is performed.

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
