# Native read-only incident observation

October22 locally implemented/tested candidate; **not installed or deployed**.
This is an H1/C1 diagnostic increment, not retained SSH, native verified freeze or
the completed monitoring-liveness fix. It changes no record, policy or deadline.

## Supported candidate workflow

Unflagged legacy `examctl list` and `info` instantiate the agent and may reconcile
eligible account access. `Engine.New` also creates/chmods the state directory.
Do not call those workflows a non-mutating investigation. The explicit new flag
bypasses agent initialization, key loading, locks, permission repair, audit writes,
reconciliation, network and subprocesses. It never applies a lease observation.
Root privilege is still required; help/syntax inspection needs neither root nor
configuration. This is a local root read, not gateway management authentication.

```sh
sudo examctl list --read-only --active --json
sudo examctl list --read-only --exam midterm --limit 50
sudo examctl list --read-only --exam midterm --limit 50 --after ATTEMPT
sudo examctl info ATTEMPT --read-only

# If configuration/keys are unavailable, use the known native state directory.
# This path matches the example install; use the actual configured directory.
sudo examctl info ATTEMPT --read-only --state /var/lib/exam-agent

# Or select a protected configuration; only its state path is read, not its keys.
sudo examctl --config /etc/exam-agent/agent.json info ATTEMPT --read-only
```

All examples refer to the local candidate, not the currently installed command.
Never combine explicit `--state` and `--config`, add `--reason` or combine a named
info target with filters/cursor/paging. Read-only output is always JSON, regardless
of the optional `--json` flag. `--limit` defaults50, maximum200; `--after` is an
exclusive UUID cursor with lexicographic UUID order. Each page is a NEW observation,
not a retained snapshot transaction; compare `state_sha256` and restart paging if
the captured state changed and a consistent inventory is required. Active means
started/unfinished and includes LOCKED, not connected or allowed to work. For a
host-idle qualification guard, active-only listing is insufficient: preparations,
pending timing/collection/policy, surviving transports/processes and other owners
must also be checked. This command never declares a host safe to modify.

## Meaning and failure handling

The result separately reports captured native attempt state, deadlines, generation/
clock revision, stored access/protection flags and the independently observed
legacy execution-lease journal. It includes observation timestamps and an exact
captured-state SHA256, not student work or archive hashes. It does not expose
transport/resume proofs, certificates/private keys, capability tokens, nonce maps,
unit names, filesystem paths from private receipts or arbitrary raw JSON. Attempt
identity/reason are private operator metadata, not suitable for public sharing.

The state file and each journal can change independently while reading. The CLI
does not lock them into one atomic current view. Account/transport/generation/boot
matching, unexpired timestamps and the existing15-second window are observations
against captured metadata only. A future timestamp is not proof of a valid commit,
same live SSH, complete current monitoring or work permission. `recorded_protected`
is not fresh archive-integrity verification. No observation is a verified native
freeze/discard receipt, automatic recovery or misconduct finding. Compare gateway
status with its own acknowledgement/source timestamps, not as identical live data.

| Result | Meaning | Next step |
| --- | --- | --- |
| Exit0, `complete=true` | Requested metadata was observed, including ordinary absent journals; **not** a healthy/authorized verdict | Interpret the explicit statuses and source times; preserve original/current deadlines |
| Exit1 with scoped JSON | Partial observation: invalid/unavailable lease metadata or unavailable current boot | Preserve records, inspect flags/statuses and retry the same read-only workflow; no expiry/violation is established |
| Exit1, empty stdout | Missing/unsafe/changing/malformed state/configuration, or absent target | Verify path/ownership and the chosen target with help/list; use `--state` when configuration is unavailable; do not initialize/reconcile or change permissions merely to inspect |
| Exit2 | Invalid syntax, target/filter combination or bounds | Follow the command-specific help; no root configuration or operation was invoked |

No new audit record is written by this explicitly zero-write local observation.
Any later mutating recovery remains a separate authorized, audited operation with
existing safeguards. Do not add time, clear holds, reset clocks, restore state,
terminate services or approve a continuation merely because a snapshot is partial.

## Read boundary and tests

The source pins an existing owner-matched private0700 directory and opens only
single-component children through native `openat` with NOFOLLOW, CLOEXEC, NONBLOCK
and NOATIME. It separately pins the private lease directory. Regular files must be
owner-matched0600. FIFO/device/directory/symlink inputs cannot become a blocking
read or an alternate source. There is no permission repair or missing-file
creation. State reads are capped64MiB, configuration/journals64KiB, JSON nesting64;
duplicate keys, missing/null required lease fields and malformed scope refuse.
Unknown future JSON fields are never printed generically. Reads recheck size and
mtime/ctime for in-place changes; an atomic replaced file remains its captured
version, not a promise that it is still current. Read bounds intentionally refuse
oversized records instead of risking the shared agent process; the CLI is separate.

Focused native race cases cover scope/paging, private-authority suppression,
unchanged bytes/modes/mtime/ctime/inventory, sparse oversized state, JSON bounds,
internal/external symlinks, FIFO/directory/unsafe mode refusal, absent/invalid
journals and explicit zero/null metadata. The actual compiled CLI is exercised
under an isolated root-mapped user namespace while the synthetic native state
lock remains held: configured/explicit paths work without keys, no state is
created/repaired/reconciled, partial observations retain scoped JSON/exit1 and
missing installations remain missing. Process-level help/error tests run without
configuration. Full native race/resource/namespace/compiler tests pass
(core168.0s/CLI9.2s), all383 application tests/71files pass (81.89s), static
build/vet/typecheck pass and bounded two-worker parser fuzz passes119353 executions
(10s requested,11.02s elapsed). All six exact browser artifacts remain unchanged
from H4a's91-check run, without rebuilding. No target-host privileged qualification
is claimed.

Durable input/lease/revocation journals, all-pane drain/freeze/discard diagnostics,
actual transport-owner liveness and CLI/web technical-hold recovery remain open in
[retained-ssh-input-protocol.md](retained-ssh-input-protocol.md). The initiating
production fault remains unproven. No production use or deployment is authorized.
