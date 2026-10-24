# Root SSH lifetime at actual framed pane handoff

October23 local development, not deployed. Actual student entry: signed framed
pane admission → original exam-login Unix socket transfer → independent attempt
supervisor → closed exec release. Operator entry:
`sudo examctl panes supervisor ATTEMPT --state STATE` and `examctl help panes`.

The supervisor now obtains the student's PID/UID from SO_PEERCRED on the ORIGINAL
received socket, validates the installed entry/SSH monitor ancestry against the
registered transport and pins the root monitor's kernel pidfd. One matching
handle is retained per live timed cohort and closed after its last request
retires or the supervisor exits. New/foreign/unknown identities refuse before
exec; no JSON PID, stored owner string or observed timestamp substitutes for the
kernel check. Process stop or an unrelated command exit is not authentication
loss. The coordinator's own peer handle remains a separate check.

The CLI's optional `ssh_peer` field reports `pinned-live`, `exited`, `unknown` or
`closed`. It is diagnostic, not complete current ownership, monitoring permission,
writer freeze or a retained hold. Absence means legacy/unknown. No new control,
account reservation, durable authority or permission is introduced. Legacy raw
panes and ordinary practice retain their existing paths. Current policy pauses
still terminate; C3/C16/C9 remain incomplete and disabled.

The new actual refusal test also found that a128-byte owner acknowledgement
buffer discarded longer repair guidance. It now accepts the existing bounded
32KiB protocol message. Strict decoding, loaded-role/peer checks and closed exec
release remain. The first negative test checked initial pre-ACK readiness and
failed before reaching the pin; corrected to acknowledge readiness and await the
final handoff result, it positively reached the pin and reproduced lost guidance.
The final test verifies the specific refusal and unchanged interval/no ready pane.

State/proof-writer review: descriptor pinning and adoption occur outside global
metadata/storage locks; cohort comparison/adoption and removal share the attempt
mutex. Extra matching handles close immediately; the owned handle closes only
after the last timed request retires, including pending recorder handoffs. Missing
ready notices do not retire a live request. Clock revisions cannot rebind another
page/transport/generation while requests remain. No handle/positive authority is
reconstructed after restart, no pending record reserves an account, and read-only
inspection creates no directories or state. Existing durable closed-bootstrap
tracking/cleanup still handles refused handoffs. C16 factory/current ownership,
independent expiry, full input/writer barriers and epoch handover are still needed.

Final focused native race/actual entry/process checks PASS5.404s. The owned local
fixture replaces installed root SSH ancestry with the original socket peer's
real pidfd; this limitation is explicit. NEW guarded disposable root framed-owner
profile PASS10 with actual installed exam-login/root sshd, two shells, CLI pinned
status, same-pane epoch replacement, current legacy pause, protected collection
and deadline access restoration. Host binaries/configuration/authority and guest
base preservation PASS; evidence `/var/tmp/ssh-exam-overlay-g0rqzxvn`.

Exact code-only17-file60,676,012-byte bundle:
`var/collection-tests/live-ssh-pin-artifacts.gmwga14r`, remote private
`/var/tmp/ssh-exam-live-ssh-pin-upload.fvLrjA/bundle`; agent SHA256
`7b5b9d6ca5eaa486ebbdc835adb389662dbd7fb7d201e36372cd87cc4b980813`.
Native305-source manifest `/tmp/ssh-exam-live-ssh-pin-source.json`. No keys,
configuration, student data or submissions uploaded. Native builds and17 focused
Python wrapper checks pass; all35 Python checks and native vet pass. Full native
race/resource/userns/compiler/default-size qualification PASS core421.168s and
CLI30.268s, collected before committing. Logs have live-ssh-* names
under /tmp. Unchanged browser/client qualification is not proof for new native
bytes; the root profile above uses these exact new bytes.

The separate actual retained-policy RED is intentional:7 positive assertions,
then real CLI pause ends a pane; preservation passes. Its driver currently tests
freeze-only and does not qualify Continue/all-writer/async/input barriers. Keep
the critical TODO open. No installation, deployment or agent consolidation.
