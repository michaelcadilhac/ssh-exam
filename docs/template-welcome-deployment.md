# Template terminal welcomes

The class agent reads the administrator-controlled template file mounted as
`/materials/WELCOME.txt`, if present, for every timed terminal opening. It
replaces `[DEADLINE]`, `[USER]` and `[EXAM-NAME]` with current attempt metadata.
The deadline retains the explicit Chicago CST/CDT display used by the dashboard.
No fallback exam text is printed for missing/empty files. Practice retains its
own notice and never reads exam materials. Existing installed templates are not
modified by the binary update; add the file to a new template version to author
a welcome. The repository sample includes one.

Only a regular UTF-8 file up to 64 KiB is accepted; links and special entries
are rejected. A rejected optional file produces an agent diagnostic and audit
event without blocking an exam or logging its contents. Substitutions are single
pass, LF/CRLF are normalized for the raw terminal, and the source is not modified.
New panes/recovery use the latest deadline; previously printed text is static.

Welcome data travels only on the local agent-to-gate socket. The gate removes it
from the browser's machine-readable readiness line, preserving the existing
8 KiB limit and signed admission receipt. Text is printed after readiness and
before acknowledging the shell launch, preserving output order. No browser SSH,
MFA, credential handling, monitoring or account-enforcement policy changes.

## Validation

Native regression cases cover replacements/repeated tokens, nonrecursive exam
names, unknown tokens, missing/empty files, updated deadlines on additional
panes, CRLF, winter/summer and DST fall-back dates, and unsafe/oversized/non-UTF-8
entries. An actual gate subprocess with a PTY and a local fake agent tests no
banner, a custom banner and a maximum-size banner: the welcome stays outside
readiness, precedes the prompt, and Ctrl-C remains an interactive input byte.
This test does not contact DePaul or use production student accounts.

The full native race suite and `go vet ./...` pass. Focused welcome/PTY tests
also pass with `TZ=Pacific/Kiritimati` and as an unprivileged process on csc-sys
using the compiled Linux test executable and disposable fixtures.

## Deployment and rollback

Both `exam-agent` and `exam-login` must be updated together; the gate no longer
generates a hardcoded welcome. Use the guarded native upgrade after preflights,
timed exams and unresolved collection/access holds have drained. Preserve current
state, capabilities, deadlines, account-policy journals and protected submissions.
Do not restore an old state snapshot during rollback. Rollback to the matching
previous agent/login restores the old hardcoded banner. The web application
requires no image rebuild for the welcome alone. The accompanying five-minute
preflight timeout updates the web gateway and student message, so this combined
release also includes a drained web restart.

## Five-minute preflight expiry

The companion change persists the native preparation timestamp, expires even a
connected/background-heartbeating preflight after five minutes, and revokes its
capabilities/handoff before local cleanup. Admission, account setup and activation
check the deadline under the same lock as exam start. Started attempts retain
their full duration and access restrictions. Expired preflight callbacks notify
the page and close its SSH worker; a fresh sign-in can retire the cancelled
preparation after confirmed account restoration. No instructor approval is needed.

The four legacy preparations were confirmed unstarted and older than five minutes
using the webserver's stored preparation dates, then cancelled through audited
root-only `examctl` operations. Their recorded practice cgroups stopped; no timed
exam was cancelled. Current page heartbeats had kept two of them alive under the
former inactivity-only rule.

Validation: 268 application tests pass across 45 files, plus the native race suite
and focused expiry/restoration/restart tests. The real browser SSH fixture verifies
connected expiry, SSH/practice closure, explanatory text, no consumed exam time and
fresh login without approval. Existing shell/pane/logout regressions also pass.
The timeout dialog was visually inspected using synthetic student data.
