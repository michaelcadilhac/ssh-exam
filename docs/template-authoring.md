# Creating an exam template

This guide is for an instructor or a Codex instance preparing an exam for SSH Exam
Workspace. It describes the implemented template format and the handoff needed to
install an exam. Authoring a template does not require access to a production server.

## What a template is

A template is a directory on the **class SSH server**, normally csc-sys. It supplies
starter files and read-only exam materials. It is separate from the web dashboard's
exam record, which controls the name, enrollment, timing, webcam requirement and
terminal limit.

The dashboard's **Template ID** identifies the installed directory, not a database
record, an archive, or an exam ID. For example, `csc300-midterm-v1` selects:

```text
<agent templates directory>/csc300-midterm-v1/
├── work/
│   ├── README.txt
│   ├── main.c
│   └── public-tests/
└── materials/
    ├── WELCOME.txt
    └── questions.txt
```

The agent's `templates` setting in `/etc/exam-agent/agent.json` specifies the base
path; the example configuration uses `/var/lib/exam-agent/templates`. Both `work/`
and `materials/` must exist, even if empty. Template IDs contain 1–64 ASCII letters,
digits, underscores or hyphens: `^[a-zA-Z0-9_-]{1,64}$`.

| Author's directory | What the student receives |
| --- | --- |
| `work/` | A fresh writable copy in the configured exam directory, normally `/work`. All terminal panes for that attempt share it. |
| `materials/` | A read-only directory mounted at `/materials` during the timed exam. |

The local D1a implementation stages starter work privately during preflight, then
publishes it once at Begin; it is not deployed. Existing deployed activation may
copy at Begin. Neither workflow starts the clock during preflight or exposes
private starter work early. See private-workspace-staging.md. Opening additional terminals
or resuming an attempt does not reset the files. Practice terminals do not receive
exam starters or materials. Files in a template do not automatically run, and a
questions file does not automatically open. An optional `materials/WELCOME.txt`
is displayed automatically as described below. Include a short `work/README.txt`
pointing students to `/materials/questions.txt` and explaining how to begin.

Exam ID and Template ID can differ. Multiple exams may use the same template.
Changing dashboard settings does not install or upload a template.

## Before writing the exam

Establish these with the instructor:

- Course level, language, learning objectives and topics to assess.
- Duration and expected difficulty; reserve time for reading, debugging and saving.
- Permitted references and tools, and dependencies available in the exam environment.
- Desired question types, starter-code detail, public examples/tests and point allocation.
- Deliverables and grading criteria, including handling of incomplete solutions.
- Exam name/ID, versioned Template ID, start window and timezone, webcam policy and
  terminal limit if these should be part of the handoff.

State any remaining assumptions. Do not silently invent course requirements or a
production schedule. Separate pedagogical decisions from deployment settings.

## Student-facing content

### Terminal welcome

To display a welcome when each exam terminal opens, add `materials/WELCOME.txt`
to the template (visible as `/materials/WELCOME.txt` in the exam). There is no
hardcoded exam banner when this file is absent or empty. Practice terminals keep
their separate practice notice and never display exam materials.

The agent replaces these case-sensitive keywords in the displayed text:

| Keyword | Replacement |
| --- | --- |
| `[DEADLINE]` | The attempt's current authoritative deadline, formatted as a date and time with explicit Chicago timezone (`CST`/`CDT`). |
| `[USER]` | The student's account username. |
| `[EXAM-NAME]` | The configured exam display name (exam ID for legacy attempts without a name). |

For example:

```text
Welcome, [USER], to [EXAM-NAME].
Read /materials/questions.txt to begin.
Saved files in /work are collected automatically when time expires or you finish the exam.
Unsaved editor buffers are not included.
Deadline: [DEADLINE]
```

Substitution happens once per terminal opening, including additional panes and
authorized recovery. Clock changes are reflected in subsequently opened panes;
already printed text is not rewritten. The source file remains unchanged, and
`cat /materials/WELCOME.txt` shows its original placeholders. Unknown keywords
are left intact; replacement values are not recursively substituted.

Use a regular UTF-8 file, at most 64 KiB, normally root-owned and mode `0644`.
Symlinks, hard links and special entries are rejected. An invalid/unreadable
optional welcome is skipped and logged by the agent without blocking the exam.
LF and CRLF line endings both display correctly in the terminal.

### Questions and starters

Put the questions, constraints, input/output formats, examples and marking guidance
in `materials/questions.txt`, or similarly readable files. Plain UTF-8 text works in
`less`, `cat` and terminal editors. Markdown is fine if readable without a graphical
renderer. Do not require a web browser, external website, PDF viewer or network access
unless the deployment explicitly provides them.

Put editable starters, small input datasets, build files and deliberately public
tests under `work/`. Preserve any executable bit required by a starter script. Avoid
requiring students to change ownership or install software. Relative paths should
work after changing into the configured exam directory; `$EXAM_DIR` identifies it.
Students can use `cd "$EXAM_DIR"` if their personal shell setup changes directories.

Explain exactly which files students should save and how they can compile/run/check
them. Use the actual language and commands supported by the exam environment. A
successful command in the server's ordinary shell does not prove that the isolated
exam environment includes its dependencies. Production workloads normally have no
external network access and a separate toolchain filesystem; the template itself
cannot install packages or change that environment.

Include this notice, substituting the configured directory if it differs:

> Saved files in /work are collected automatically when time expires or you finish
> the exam. Unsaved editor buffers are not included.

There is no student submission command, upload, archive creation, or submission
script. **Finish exam** is optional and irreversible. Doing nothing still collects
saved files at the deadline. Only the configured working directory is collected;
files saved in the student's home, `/tmp`, `/var/tmp` or another directory are not a substitute.
Private `/tmp` and `/var/tmp` are writable and shared across the attempt's panes;
`TMPDIR=/tmp` is provided for compiler/editor scratch files. They are separate from
practice storage and are discarded after the attempt ends.
Do not describe signing out as submitting or resuming a finished attempt as possible.

Do not promise that student programs, tests or cleanup scripts run automatically at
start or collection: the template format has no such hooks. Public tests are run by
the student; instructor grading is a separate process.

## Files, permissions and collection limits

Use real directories and regular files. Do not use symbolic links, hard links, FIFOs,
sockets, device nodes, nested mounts or references to files outside the template.
The starter copier rejects symlinks and special files. Root owns the installed
source template; copied work becomes owned by the student's UID/GID. File permission
bits are copied, so starters must remain readable and editable by their new owner.
Materials need read/search permissions for the student: normally directories `0755`
and files `0644` under the agent's root-private template base directory.

Keep work small. The current collector has these limits, **separate from monitoring
recording limits**:

| Limit | Value |
| --- | --- |
| One regular file | New local default 128 MiB logical size; legacy snapshots 32 MiB |
| Total regular-file content | New local default 512 MiB logical size; legacy snapshots 64 MiB |
| Traversed directory entries | 10,000 |
| Directory nesting | 32 levels |

The C6 limits implementation is tested locally, **not deployed**. Each new exam
can explicitly configure its limits; issued/prepared settings and legacy bundles
retain their own bounds. Do not assume deployed exams received the new defaults.
See collection-limits.md for settings flags, frozen snapshots, process isolation
and remaining privileged/concurrent storage qualification. These are collection/
starter logical limits, not an increase in worker memory/time or live disk quotas.

Leave room for student-created output and binaries; do not require huge datasets or
build trees. Do not require symlinked output: collection omits symlinks and special
files, and rejects hard-linked regular files. Do not create a top-level
`work/MANIFEST.json`; that name is reserved for collection metadata. There are no
per-template collection-exclusion rules: ordinary starter files, public tests,
binaries and saved editor backups in the work tree are included.

Keep solutions, hidden tests, grading scripts, answer-bearing fixtures and private
rubrics **outside both student directories**. Never rely on dotfiles, root ownership
of a starter, file extensions, or disabled execute permissions to hide answers. Do
not place confidential instructor artifacts in a public repository.

## Deliverables for another instructor or installer

Prepare a package with this separation:

```text
exam-package/
├── template/
│   └── csc300-midterm-v1/
│       ├── work/
│       └── materials/
├── instructor/
│   ├── solution/
│   ├── tests/
│   ├── rubric.md
│   └── validation.md
├── exam-settings.json
└── README.md
```

Only `template/csc300-midterm-v1/` is installed as the student template.
`instructor/` stays private. The package README should identify the template version,
explain the layout, list dependency requirements and document installation/testing.

`exam-settings.json` is a handoff record, not a template manifest automatically loaded
by the agent or a dashboard file-import feature. If supplying it in the application's
exam schema, use these fields:

| Field | Meaning |
| --- | --- |
| `id` | Exam ID, with the same identifier syntax as Template ID. Reserve `sandbox` for the existing repeatable five-minute sandbox. |
| `name` | Display name, 1–120 characters. |
| `template` | Exact installed Template ID. |
| `duration` | Default seconds, 60–21,600; 5,400 means 90 minutes. Dashboard duration inputs use minutes. |
| `earliest`, `latest` | Instructor-approved start-window boundaries as integer Unix milliseconds; `latest > earliest`. Record the intended timezone in the package README. |
| `webcam` | Boolean default requirement. |
| `terminals` | Maximum simultaneous exam terminals, 1–4. |

If dates or policies have not been supplied, list them as pending in the handoff
instead of presenting an invalid or invented record as deployment-ready. Enrollment
and individual duration/webcam overrides are configured separately in the dashboard.

## Installation on the class server

A server administrator installs the finished template. Do not deploy or modify a
live exam merely because you were asked to draft its content. Confirm the configured
template base path and use a **new, unused versioned ID** for each revision.

For the example base path, run on the class server from the package directory:

```sh
TEMPLATE_ID=csc300-midterm-v1
TEMPLATE_BASE=/var/lib/exam-agent/templates
SOURCE="template/$TEMPLATE_ID"
DEST="$TEMPLATE_BASE/$TEMPLATE_ID"

test -d "$SOURCE/work" && test -d "$SOURCE/materials" || exit 1
# The output must be empty. Investigate any links or special files before copying.
find "$SOURCE" ! -type d ! -type f -print
find "$SOURCE" -type f -links +1 -print

sudo install -d -m 0700 "$TEMPLATE_BASE"
# Refuse to overwrite an installed version, including an empty directory or link.
sudo mkdir -m 0755 "$DEST" || exit 1
sudo cp -a "$SOURCE/." "$DEST/"
sudo chown -R root:root "$DEST"
sudo find "$DEST/materials" -type d -exec chmod 0755 {} +
sudo find "$DEST/materials" -type f -exec chmod 0644 {} +
```

Validate the source before copying; the `find` commands report problems, rather than
repairing or silently removing them. Preserve intended starter-file permissions and
verify the resulting tree. A failed or partial installation must be resolved before
selecting that ID for an exam. Adding a template normally needs no agent restart.

On the webserver, open **Instructor → New exam** or select an exam and open **Exam
settings**. Set its **Template ID** to the installed version and configure the exam
settings and roster. There is no dashboard template upload or template-build step.
No webserver filesystem copy is needed.

Never modify an installed template referenced by a preparing or active attempt.
Starter work is copied once, but materials are mounted from the installed source;
changing them can change what an existing student sees. Install `v2` separately and
use it for a new exam or future attempts. Retain versions needed by existing attempts.

## Validation before use

1. Read every student-visible file and check for answers, instructor comments,
   credentials, links and dependencies on author-local paths.
2. In a fresh writable copy, run exactly the documented student build/test commands
   using the intended exam toolchain. Check permissions and executable scripts.
3. Solve the exam independently from the starters. Run private tests against the
   solution, verify examples and score totals, and record a realistic completion time.
   Check edge cases and how partial credit is assigned.
4. After authorized installation, create a separate short test exam pointing at the
   new template. Check that practice reveals no questions/starters, Begin exposes the
   correct writable work and readable read-only materials, and multiple panes share
   the files. Do not overwrite the existing sandbox's template just to test a draft.
5. Save a recognizable answer, finish the test, and have an authorized server
   administrator inspect its protected manifest/archive with `examctl`. Confirm that
   saved answers are present and instructor-only files are absent. A separate test
   can exercise automatic collection at a short deadline. No student submission task
   should be needed, and no archive is downloaded from the web dashboard.

Record which checks ran and their results in `instructor/validation.md`. Distinguish
local content/toolchain checks from a real installed exam test; do not claim the latter
without running it. Report missing dependencies and outstanding instructor decisions.

## Suggested prompt for Codex

> Read `docs/template-authoring.md` in the SSH Exam Workspace repository. Help me
> author an exam for [course/language/topics], lasting [minutes], at [student level].
> Ask about missing pedagogical requirements and allowed tools/references. Produce
> a versioned template, student questions/starters, separate private solution/tests
> and rubric, a settings handoff, and a validation report in the layout specified by
> the guide. Validate the examples and solution. Submission must be fully automatic.
> Prepare the package for review; install or publish it only if I separately ask.

The existing minimal example is [sample-exam](../ssh-server/examples/sample-exam/).
See [instructor operations](instructor-operations.md) for dashboard actions and the
[class-server guide](../ssh-server/README.md) for installation and `examctl` operations.
Implementation references: [starter copying](../ssh-server/internal/core/engine.go),
[terminal mounts](../ssh-server/internal/core/gate.go),
[collection](../ssh-server/internal/core/collection.go), and
[exam settings schema](../packages/protocol/index.ts).
