# Current examctl workflows

Local source update October 20, 2026; **not deployed**. Full web-management
coverage is not implemented yet; see the explicit inventory/decisions in
[todo-design-decisions.md](todo-design-decisions.md). The firm requirement is that
every supported management action has a supported CLI workflow, sharing authority,
validation, audit, revisions and idempotency with the web interface. No ad hoc
SQL/JSON edit or incident script is a supported replacement. Authentication for
gateway-owned CLI workflows remains decision C1.

Start with `examctl help`, then `examctl help COMMAND` or `COMMAND --help`.
Help runs without root or installed configuration. Unknown commands, missing or
extra targets, missing reasons, invalid flags and ambiguous filters explain the
relevant help before attempting root/configuration access. Actual native
operations remain root-only. Exit codes: 0 success, 1 operational refusal, 2 usage.
JSON timestamps are UTC milliseconds; durations are seconds. List displays UTC
RFC3339 deadlines unless `--json` is selected. `--config FILE` works before or
after a command. List filters never silently constrain a mutation targeting a UUID.

An ordinary local diagnosis starts with:

```sh
sudo examctl list --active
sudo examctl list --exam midterm --json
sudo examctl info ATTEMPT
```

`info` distinguishes state, original/current deadlines, protection, account/policy
restoration and errors. Refusals print these facts plus exact inspection and
reconciliation commands, retaining a nondefault configuration path. Collection
recovery requires fixing the stated cause before an audited `retry`; a protected
bundle must never be overwritten. `reconcile` handles eligible state across all
attempts and may perform due collection/timing checks/restoration; it is not a
read-only dry run.

Resources have separate workflows:

- `cancel ATTEMPT --reason ...`: only provably unstarted preparation.
- `stop` / `finish ATTEMPT --reason ...`: irreversible protected collection of a
  started attempt, retaining original/current interval restrictions.
- `delete ATTEMPT --reason ...`: destructive protected-submission retention action
  after COMPLETED and actual access/policy release; retains attempt history and
  never deletes an exam definition.
- `override-access`: a separate, approved root emergency operation requiring
  verified protection/termination and a durable concrete reason. Never automatic.

Read each command's own help for prerequisites and examples. Release cannot be
made eligible by changing a deadline, deleting a marker or removing enforcement.
Every remaining writer/restoration failure must be reconciled. Native offline
state is authoritative locally; it does not claim the gateway received a callback.

Protected retrieval is local, verified and durably audited before bytes are read
out. Export copies outside the global state lock, so a slow destination does not
block other students' deadlines:

```sh
sudo examctl manifest ATTEMPT
sudo examctl export ATTEMPT --output ./submission.tar.gz
```

The destination is a new 0600 file; existing files/symlinks are refused. I/O,
sync/close or audit failures report failure; inspect any partial destination
before retrying. Default export still emits binary tar.gz on stdout for existing
workflows, with errors on stderr. It never uploads archives to the gateway.

`agent status` inspects the shared gate. `agent stop/restart` can interrupt PTY
bridges and requires a fully drained authorized maintenance window; these actions
leave the independent watchdog/reconciler in place. Three live daemons may own
PTYs until the separately documented handoff consolidation. No service action
has been executed as part of this local development.

Process-level tests invoke the actual CLI entry point for every command's help,
usage errors, target/reason restrictions and unavailable configuration. Native
tests verify protected export, immutable bytes and refusal when audit persistence
fails. Full create/import/grant/clock/authorize workflows and real root-host
qualification remain pending; this document does not imply CLI completeness.
