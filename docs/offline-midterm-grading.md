# Offline midterm grading

The locally tested [grade-midterm.zsh](../examples/grade-midterm.zsh) exports each
student's latest **started** attempt across `midterm` and `midterm-recovery`, runs
the supplied course grader, and writes `USERNAME,GRADE`. Run it on an instructor's
Docker machine; keep [grading-extract.py](../examples/grading-extract.py) beside it.
On October 29 the instructor authorized installation of the script/helper on
`csc-sys`, under `/usr/local/share/ssh-exam/examples/`, with this guide under
`/usr/local/share/ssh-exam/docs/`. These directories remain root-private. Only
files are installed: no service restart, package/image installation or grading
run is included. No real students have been graded by this workflow.

```zsh
# On csc-sys: inspect the installed command without running a grading job.
sudo zsh /usr/local/share/ssh-exam/examples/grade-midterm.zsh --help
```

```zsh
cd /path/to/ssh-exam
zsh examples/grade-midterm.zsh run csc-sys "$HOME/midterm-grades-20261029"
```

Choose a **new** output directory each time. The script refuses to overwrite an
existing run. Establish your normal SSH/MFA shared connection first: noninteractive
SSH and `sudo -n /usr/local/sbin/examctl` on the class server must work. The
controller uses the installed generic CLI exports and protected `examctl export
UUID`; it never requests passwords or runs submitted code on the class server.
Export performs its normal integrity verification and administrator audit.

Required local tools are zsh, Python 3, Docker, SSH, GNU timeout and coreutils.
The default local Docker socket is `/var/run/docker.sock`. The already-loaded
Linux amd64 image must provide GCC, Python 3, nm, awk, grep and timeout:

```text
golang:1.27.2-bookworm@sha256:55395706e9703db746cc507abfc4eb2aea75918f8a8024e4848e2cb81004f5ad
```

There are no automatic image pulls or package installations. `EXAM_GRADE_IMAGE`
may select another explicitly digest-pinned, separately qualified compiler image.
`EXAM_GRADE_DOCKER_HOST` may select another existing **local Unix socket**, such
as a rootless engine. Remote Docker contexts are not used; bind mounts refer to
the instructor machine's private files. Docker access is needed locally; the
controller itself does not need to run as root.

## Selection and grades

The population is the union of both rosters and historical attempt owners.
Complete paginated TSV exports are read with zsh; there is no JSON metadata parser.
For each username, the greatest positive start timestamp chooses the submission,
regardless of which of the two exams it belongs to. Unstarted preparations do not
replace submitted work. This selects the **latest**, rather than the best grade.

- No started attempt: **0**, as explicitly requested by the instructor.
- Successful grader: its earned points out of 100, including a legitimate zero.
- Unprotected/incomplete latest attempt, equal-time ambiguity, missing/corrupt
  export, unsafe archive, timeout or invalid grader output: **blank**, with the
  reason in `errors.tsv`. No fallback to an older attempt and no accidental zero.

`grades.csv` has exactly the header `USERNAME,GRADE`, followed by one sorted row
per username. Successful completion exits 0; per-student failures still publish
the complete CSV with blanks and exit 1. A global prerequisite failure can abort
before publishing a CSV. Inspect both the exit status and `errors.tsv` before
using the grades. These are candidate grades for instructor review; the script
does not import grades or modify student records.

Metadata is a recorded selection, not an atomic server snapshot. Run after the
relevant attempts have finished. An active latest attempt is reported as an error;
the script never collects live work, starts clocks or changes account restrictions.

## Supplied grader and isolation

Both definitions use the authored `sys1-midterm-a` materials. The script fetches
only `grade`, `scoring.tsv`, `include` and `tests` from
`/var/lib/exam-agent/templates/sys1-midterm-a/materials`. It requires this official
grader SHA256:

```text
8b90975bebbe6165cbf7c886c85d029109038201114ce8be3eca9456a98a7d50
```

It invokes the unmodified `/materials/grade --work /work`, whose final score is
`TOTAL: EARNED/100`. Submitted graders and Makefiles are never invoked. The supplied
grader compiles fixed source names using its supplied object files and rubric;
its GDB exercise checks the saved answer file, rather than launching GDB. Duplicate
or malformed totals fail instead of being accepted as grades. This preserves the
student-facing scoring rules; it adds no hidden tests or new grading policy.

Each submission is checksum-verified before a fresh, unprivileged container
extracts it. Extraction rejects traversal, links, special files and duplicate
names, strips privileged metadata, and limits files to 128 MiB and totals to
512 MiB. The protected collection manifest is excluded from the grading tree.
Only the current archive, trusted materials and extraction helper are mounted,
all read-only. The container has no network, a read-only root, dropped
capabilities, no-new-privileges, one CPU, 1 GiB memory with no swap, 128 processes,
and bounded writable tmpfs. No Docker socket, credentials, home directory, sibling
submission or live student workspace is mounted. Output is limited to 1 MiB.

Default execution timeout is 300 seconds per student, with an in-container timeout
and an independent bounded attached client. `EXAM_GRADE_SECONDS` accepts 1–3600.
Nonzero exit, OOM or timeout never becomes a zero grade. The exact owned container
must be removed and its absence verified before accepting a score.

For a deliberate future grader revision, inspect the authored materials and set
`EXAM_GRADE_MATERIALS` and `EXAM_GRADE_GRADER_SHA256` explicitly. Do not select a
student-edited grader or replace the expected hash merely to bypass a refusal.

## Reports and interrupted runs

The private output directory retains rosters, `attempts.tsv`, `selections.tsv`
(username/UUID/checksum/outcome), authored materials/digest, exact image ID, and
per-student archives, logs, engine state and cleanup receipts. Preserve it for
review under your submission-retention policy. Successful CSV publication is
atomic; partial output remains `.grades.partial` after interruption.

```zsh
zsh examples/grade-midterm.zsh cleanup "$HOME/midterm-grades-20261029"
```

Cleanup durably cancels that run and removes only containers with its exact run
identity. It preserves archives, reports and any completed CSV. The controller
checks cancellation before each student, after container creation, after execution
and before publishing results. A delayed create cannot start after cancellation.
INT/TERM attempt immediate owned cleanup; after controller death, use this command
to confirm absence before discarding the directory. Engine unavailability is an
unconfirmed cleanup, never evidence of absence. Rerun grading in a new directory;
there is no resume that mixes an old selection with fresh server metadata.

## Local verification

`EXAM_GRADING_DOCKER=1 npm test -- tests/integration/offline-grading.test.ts`
exercises the actual script, compiler and Docker isolation with synthetic archives
and mocked SSH transport. It covers newer recovery/midterm selection, zero absence,
failed exports, active latest work, ties, checksum mismatch, malicious archive
names, timeout, forged duplicate score output, live cancellation and cancellation
while create is blocked. Kernel container state and owned process death/absence
are checked, not just the controller's exit.

The cancellation test initially exposed publication of a CSV after external
cleanup. A durable cancellation marker and post-create/pre-publication checks fix
that gap; the regression also blocks Docker create before allowing the late reply.
The initial failed receipt is preserved in `initial-cancel-check.log` in the run
directory below. No native pending state, account reservation or execution grant
is added: all new state is private operator output, and cancelled runs require a
new directory rather than silently resuming stale metadata.

The actual supplied grader also returned the expected 0 and 20 points for private
synthetic submissions, plus zero for an absent submission. Existing affected
metadata/grant integration tests, native protected-export race regression,
typecheck and script/helper syntax checks accompany this workflow. SSH transport
is mocked for grading qualification; no real student archive was fetched or graded.
Evidence: `var/collection-tests/midterm-grading.9040z4q6`. Application/native/browser
runtime code is unchanged. The separately authorized script/helper installation
changes no application deployment, schema, account policy or running service.
