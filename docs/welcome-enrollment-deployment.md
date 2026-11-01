# Welcome focus and enrollment-default deployment

October31,2026. Instructor explicitly authorized push and deployment. Preparing;
no new production service/configuration/student-record changes have occurred yet.

First-field focus already exists. Four focused browser cases pass: native direct
load, reload, student/instructor navigation and immediate typing, plus delayed
configuration for ordinary, login-test and instructor entry. Later-field edits keep
focus. No product change was needed; the new regression is included in the release.

This release also includes the qualified local clarity and enrollment-date changes
in ui-clarity-pass.md and enrollment-default-dates.md. Their application663/final15
browser/CLI-race/build evidence remains applicable to identical runtime inputs.
The exact release image still needs isolated startup/assets and packaged browser
qualification. Initial read-only production guards passed with no sessions or
pending reviews; fresh guards are required immediately before cutover.

Scope: matched web image and examctl only. Preserve agent/watchdog/relay/source
worker PIDs and loaded binaries, all configuration except the required image
selection, effective permissions/deadlines, history and protected submissions. The
source-worker implementation is unchanged; keep its loaded old CLI inode while
installing the new CLI atomically, explicitly verifying both expected hashes.
No source setup/grant, exam reopening, alert or student credential action is part
of acceptance. Check public focus without submitting credentials.

Procedure: qualify clean committed artifacts; push; stage pinned root-private
code-only bundles; fence new admission and prove a fresh full drain; take full
private host-only backups; install the matched image/CLI; verify history and fresh
signed readiness plus all assets/public focus before restoring original nginx.
Strict history verification precedes any intentional authenticated CLI read.
Rollback uses the same drain/backup, current database/media/history and previous
image/CLI; never restore an old database or delete consumed/review/nonce records.
Pending new CSV reviews must finish or expire before selecting an older reader.

Artifacts, hashes, guards, failures and receipts:
var/collection-tests/welcome-enrollment-rollout.9s70lhkv.
