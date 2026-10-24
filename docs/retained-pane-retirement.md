# Closing one held pane without blocking its peers

October24,2026. Local candidate; installed retained admission remains OFF.
Entry: real framed SSH panes -> `examctl pause` -> reviewed `examctl panes close`
for one pane -> explicitly approved Continue of the surviving panes. The original
attempt, grant, allowance, deadlines and surviving buffers must remain unchanged.

## Reproduction and correction

The guarded root regression on validated1e274ad reproduced the defect: all pinned
target processes exited and the reviewed close removed its request/launch, but
the old hold still owned its process/cgroup handles. Continue then tried to resume
those retired objects and failed. Receipt:
`/tmp/ssh-exam-held-pane-closure-root-red.log`, exit1; FULL host/base preservation.
The old cgroup directory descriptor still reported link count2 after removal, so
neither its link count nor pathname absence is acceptable retirement evidence.

Hold capture now also pins the fixed core `cgroup.events` file through the owned
cgroup directory. Hold and Continue prune only positively exited whole-process
pidfds. A scope may be forgotten only after its request AND pending launch are
gone and its pinned core file positively reports no tasks, or the kernel reports
that same file deactivated. No missing pathname, read failure or request absence
alone proves that a writer is gone. All candidate retirements are checked before
any handle is closed. Unknown/live writers keep the hold unverified.

The kernel lifetime operation is a seek on the pinned kernfs file: a live empty
or changed file remains seekable; a deactivated file returns ENODEV. This was
checked against the [Linux kernfs implementation](https://github.com/torvalds/linux/blob/v6.8/fs/kernfs/file.c)
and the actual owned cgroup. The no-task observation uses the documented recursive
[cgroup.events populated field](https://docs.kernel.org/admin-guide/cgroup-v2.html).
Poll notifications are deliberately not used: both value changes and removal can
produce them. This is negative cleanup evidence, never execution permission or
authority to delete workspace/submission data.

A pane can close after a three-pane Continue intent was already prepared. Keep
that intent immutable, including its original nonce, owner, age and authorization.
Only the successful result is narrowed to the surviving panes' input epochs.
The root regression primes this cached intent through the actual signed entry,
requires explicit approval to remain unavailable, closes the extra held pane,
then requires approved Continue and positive private-buffer replies from both
original panes within the same preparation lifetime.

## State review before broad qualification

| Boundary | Required behavior |
| --- | --- |
| Pending/current pane | A request or launch retains the scope even when empty or deactivated. No admission or input gate is opened by cleanup. |
| Missing request but live writer | Refuse retirement and preserve every handle; actual populated scope/pidfd regression covers this case. |
| Closed pane | Require positive whole-process exit and pinned no-task/deactivation evidence. Validate the entire batch before closing handles. |
| Concurrent Continue reply | Prepared fields/maps remain immutable. A successful result contains only current streams; existing owner/nonce/current-stream checks still gate commit. |
| Cancellation/expiry/stale completion | Existing explicit approval, generation, nonce, original boot/wall deadlines and live-owner checks remain authoritative. Cleanup does not refresh any of them. |
| Restart | Added handles are process-owned/CLOEXEC, not persistent permission. A new supervisor cannot recover authority from disk. Existing coordinator recovery still requires the live verified supervisor. |
| Inspection/history | Existing pane snapshots, audited close and supervisor inspection remain supported. No schema/history/archive/account-hold change. |

## Verification so far

Focused actual-kernel retirement plus four affected monitored-entry/race cases
PASS22.378s. Requested/deactivated scope and closed-descriptor refusal PASS1.056s.
The strengthened populated-orphan/whole-process-exit guard PASS1.058s, including
refusal before killing only its owned helper and successful cleanup after the
same pinned process positively exits.43 Python tests PASS. These are focused
receipts. Fresh build/vet/syntax PASS.

The public root workflow now PASS35 assertions, including the cached three-pane
preparation, actual reviewed close, positive target pidfd exits and fresh approved
Continue with exactly the two surviving epochs/private buffers. Existing Nano,
partial-transition/coordinator recovery, linked async writes, recording fault,
protected collection, saved-source grant and original account-deadline checks
also pass. FULL installed binaries/config/authority and guest-base preservation.
Receipt: `/tmp/ssh-exam-held-pane-retirement-root.log`,60940 exit0; private
`/var/tmp/ssh-exam-overlay-bhlphs4h`. This is the agreed disposable nspawn guest,
not a deployment. Capture is explicitly synthetic.

Frozen bundle: `var/collection-tests/held-pane-retirement-artifacts.hetw2jvd`,
62,869,979bytes; remote private upload VYtUPq. Agent SHA256
`edf8e8e7b0f6b8262346b1b03d8898439a9a6891d0e81de357ae787f11e5b5b0`;
core test SHA256
`04a363d2cd1c0942609a05f889695d2fdddf234b654bd4b940a063710ed8d358`.
The earlier RED used unchanged1e274ad native bytes; these fresh hashes qualify
the fix. Final full native races/resources/userns/compiler/default-size suite
PASS core527.227s/CLI31.847s,51678 exit0; receipt
`/tmp/ssh-exam-held-pane-retirement-final-native.log`.

Gateway/browser runtime is unchanged; prior575 application/23 browser and18
affected HTTP checks remain relevant. Broader retained-mode release gates remain
open. No deployment or enabling is authorized by these results.
