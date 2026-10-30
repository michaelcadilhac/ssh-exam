# Midterm grading with bwrap

[grade-midterm.zsh](../examples/grade-midterm.zsh) exports each student's latest
**started** attempt across `midterm` and `midterm-recovery`, invokes the unchanged
supplied course grader in a lightweight bwrap sandbox, and writes `USERNAME,GRADE`.
Docker is not used or required. The instructor explicitly rejected that dependency;
the original Docker runner and its qualification are superseded by this version.

## Run on csc-sys

```zsh
sudo zsh /usr/local/share/ssh-exam/examples/grade-midterm.zsh run --local \
  /root/midterm-grades-20261029
```

Choose a **new** output directory. This creates private reports and grading copies;
it does not import grades or change student records. `--local` directly invokes the
installed root `examctl` and reads the authored materials on this machine. No SSH
connection back into the same server, new credentials, image or package is needed.
Review `grades.csv`, `errors.tsv` and the exit status before using the results.

The installed script, [grading-sandbox.py](../examples/grading-sandbox.py) and
[grading-extract.py](../examples/grading-extract.py) live together in
`/usr/local/share/ssh-exam/examples/`; the guide lives under `../docs/`.
Installation parents remain root-private. Script/help and the actual privileged
sandbox workflow are verified separately. No real student grading is performed
as part of installation or qualification.

Alternatively, run from a separate Linux machine with the same tools:

```zsh
zsh examples/grade-midterm.zsh run csc-sys "$HOME/midterm-grades-20261029"
```

That mode needs the usual working SSH/MFA shared connection and noninteractive
`sudo -n /usr/local/sbin/examctl` on csc-sys. Local non-root execution uses the
caller's systemd user manager; root execution uses the system manager. Missing
namespaces, bus or resource controllers fail rather than silently dropping limits.
Required installed tools: zsh, Python 3, bwrap, systemd-run/systemctl, x86-64 GCC,
nm, awk, grep, tar and coreutils. csc-sys already supplies these tools. No automatic
package installation or toolchain download occurs. The host compiler is used and
its version/hash, bwrap version/hash and runner hashes are recorded in `toolchain.txt`.

## Selection and grades

The population is the union of both rosters and historical attempt owners.
Complete paginated TSV exports are read with zsh; metadata needs no JSON parser.
For each username, the greatest positive start timestamp chooses the submission,
regardless of which exam it belongs to. Unstarted preparations do not replace
submitted work. This selects the **latest**, rather than the best grade.

- No started attempt: **0**, as explicitly requested by the instructor.
- Successful grader: its earned points out of 100, including a legitimate zero.
- Unprotected/incomplete latest attempt, equal-time ambiguity, missing/corrupt
  export, unsafe archive, timeout or invalid grader output: **blank**, with the
  reason in `errors.tsv`. No fallback to an older attempt or accidental zero.

`grades.csv` has exactly the header `USERNAME,GRADE` and one sorted row per
username. Completion exits 0; per-student failures publish the complete CSV with
blanks and exit 1. A global prerequisite/cleanup failure can abort before a CSV is
published. The grader's individual compilation/test failures retain its normal
scoring rules; sandbox/export failures do not become grades.

Metadata is a recorded selection, not an atomic server snapshot. Run after the
relevant attempts finish. Active latest work is an error. No live-work collection,
clock change, attempt grant or account-restriction change is performed. Protected
`examctl export UUID` retains its normal verification and administrator audit.

## Grader and lightweight isolation

Both definitions use authored `sys1-midterm-a` materials. Only `grade`,
`scoring.tsv`, `include` and `tests` are copied from
`/var/lib/exam-agent/templates/sys1-midterm-a/materials`. The official grader SHA256
must match:

```text
8b90975bebbe6165cbf7c886c85d029109038201114ce8be3eca9456a98a7d50
```

The unmodified `/materials/grade --work /work` compiles fixed source names with
the supplied object files and rubric. Its GDB exercise checks the saved answer
file. Submitted graders and Makefiles are never invoked. Exactly one final
`TOTAL: EARNED/100` is required; forged duplicate/malformed totals fail. No new
hidden tests or scoring policy are introduced.

Each export is checksum-verified before extraction. Extraction takes place inside
bwrap, rejects traversal, links, special files and duplicates, strips privileged
metadata, and bounds files to 128 MiB and totals to 512 MiB. The collection manifest
is excluded. Only the current archive, trusted materials, extractor and a narrow
read-only cancellation directory are mounted alongside read-only host software.
Home directories, host configuration, student storage, sockets and other jobs are
absent. Work/tmp are private bounded tmpfs (640/256 MiB). User, PID, network, mount,
IPC and other namespaces are private; capabilities are dropped, nested user
namespaces disabled, privileges cannot be gained, and no controlling terminal is
inherited. Root launches use a transient unprivileged DynamicUser; they never run
student programs as host root and create no permanent account records.

A uniquely named **transient** systemd unit bounds the whole process tree to
1 GiB RAM, no swap, 128 tasks, one CPU and 300 seconds by default. It is not a new
installed daemon or persistent service configuration. `EXAM_GRADE_SECONDS` accepts
1–3600. A trusted worker verifies its actual kernel memory/swap/task/CPU limits
before executing bwrap; unsupported or mismatched controls refuse execution.
Runtime expiry, OOM, cancellation and main-process exit remove descendants
through `KillMode=control-group`; controller death does not remove the independent
service deadline. Output is limited to 1 MiB. Cleanup must confirm the exact owned
unit is inactive and its cgroup is empty/removed before a score is accepted.

For an intentional future grader revision, inspect the authored package and set
`EXAM_GRADE_MATERIALS` and `EXAM_GRADE_GRADER_SHA256` explicitly. Never point these at
a student-edited grader or bypass an unexplained checksum refusal.

## Reports and cancellation

The output retains rosters, `attempts.tsv`, `selections.tsv` (username/UUID/checksum/
outcome), authored materials/digest, toolchain provenance, and per-user archives,
grading logs, exact sandbox command, exit/unit state and cleanup receipts.
`unit-state.txt` distinguishes systemd timeout/OOM/setup failures where available.
Treat exported copies according to the submission-retention policy. Successful
CSV publication is atomic; interrupted results remain `.grades.partial`.

```zsh
sudo zsh /usr/local/share/ssh-exam/examples/grade-midterm.zsh cleanup \
  /root/midterm-grades-20261029
```

Cleanup first writes a persistent cancellation marker, then stops only units
matching the recorded UUID, manager and description. Archives, reports and any
completed CSV remain. The sandbox checks that marker before extraction: even a
StartTransientUnit request delayed until after cleanup cannot run the grader.
Manager errors are unconfirmed cleanup, never proof of absence. After INT/TERM
or controller death use cleanup to confirm the owned jobs stopped. Rerun into a
new directory; there is no resume that mixes a previous selection with fresh
metadata. New cleanup deliberately refuses older Docker-run directories.

## Verification and rollback

`EXAM_GRADING_BWRAP=1 npm test -- tests/integration/offline-grading.test.ts` uses
actual bwrap, GCC and systemd/kernel resource controls with synthetic inputs and
mocked metadata/export transport. It covers latest selection in both exams,
null/zero preflights, absence zero, export/checksum/active/tie errors, unsafe
archives, timeout, forged totals, direct local mode, capabilities/filesystem/network
isolation, actual kernel limits, live cancellation, delayed startup cancellation
and exact controller SIGKILL followed by independent bounded process teardown.
An intentionally wrong kernel memory limit refuses before the grader executes.

Guarded disposable root qualification on csc-sys separately uses the actual course
grader, synthetic submissions/CLI and real DynamicUser/input mounts. It verifies
expected 0/20 and absent0, non-root credentials, private files/capabilities and live
memory/swap/task limits, with continuous host-idle checks and preserved installed
binaries/configuration/attempt authority. The first root run refused mount setup
because the bind separator was quoted; quoting each path component fixes it.
That failed receipt is retained, not counted as successful grading.
The broader run also exposed concurrent controller/manual cleanup finding an
already unloaded unit. A forced real stop race now verifies a fresh manager reply
and empty cgroup before accepting absence; unknown manager errors still refuse.
Final affected integration/root CLI/TLS checks pass all 21 cases, and typecheck,
shell/Python syntax and guarded root qualification pass.

Evidence and installed artifact receipts: `var/collection-tests/grading-bwrap.bop5j63c`.
The earlier Docker evidence remains historical. No application/native/browser
runtime or protocol changes are involved; their existing qualification still
applies. Installation updates only the grading example/helpers/guide, with exact
previous hashes and private backups. Rollback may restore only those matching
files; never restore older databases, native authority or student data. Prefer
forward repair because the earlier Docker version has a rejected dependency.
