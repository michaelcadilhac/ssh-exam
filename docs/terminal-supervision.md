# Independent practice pane ownership (C12a; tested locally, not deployed)

This increment covers the ordinary **Practice terminal** through Engine.local and
existing signed/root `examctl panes list/show/close`. One independent bounded
supervisor per user/attempt owns all its practice sockets, PTYs and workload
lifetime handles. Timed panes retain the existing coordinator-owned recording
path. Trusted administrator host services retain their serialized exception.
C12 timed supervision, C3 retained lockouts/input epochs and C9 recovery are NOT
implemented or enabled by this increment.

The actual old entry loses shell memory/PTY on coordinator SIGKILL (RED0.081s).
The new workflow verifies the same memory-only value/process across whole
coordinator-cgroup SIGKILL in two panes sharing one supervisor. It also completes
while the synthetic global state file is a FIFO: the supervisor never loads or
writes global attempt metadata. The attempted timed recorder fallback was removed
during review because it would load global state inside every supervisor. Timed
supervision needs bounded coordinator-owned event/restart/owner integration, not
a private copy of the global Engine. That remains the next necessary dependency;
do not call the full C12 workflow complete from this practice increment.

## Runtime and state review (before broad qualification)

| Boundary/state | Owner and failure behavior |
| --- | --- |
| Closed pane reserved | Existing durable unique unit/capability fences; original wall/BOOTTIME expiry, never a new permit from disk |
| Supervisor startup | Private inherited listener/executable/lifetime claim/control; three-second setup agreement, no student exec; failed/orphan setup exits, empty owner idles out after30s |
| Descriptor handoff | Original accepted socket preserves student kernel peer; exact PTYs/pidfd/proc and root role/scope are verified before ready |
| Final release | Only the live coordinator rechecks current SSH/account/attempt/window/lease and durable one-use state, then permits the closed bootstrap |
| Reply ownership | Committed/refused/unknown notice selects the completion writer, not execution authority; lost notice cannot kill an already authorized shell or prove no start |
| Running practice | Supervisor is outside coordinator and student-workload kill domains; same original preflight timeout, signed close, Begin cleanup and account rules remain |
| Natural exit | Supervisor terminates/confirms its exact scope, reports on the original socket; live coordinator does scoped metadata backup cleanup |
| Coordinator death/completed pane | Supervisor does not touch global metadata; actual Tick retires only confirmed empty/gone current-boot ready supervised PRACTICE records, never timed/closed/legacy/unknown ones |
| Supervisor death | Live coordinator acts only on positive kernel pidfd exit, never timeout, and contains its exact owned scopes including HUP-ignoring writers; unconfirmed cleanup stays tracked |
| Unknown/failed cleanup | Preserve work/tracking/holds; inspect existing pane CLI. Neither missing replies nor metadata absence proves misconduct, new allowance or permission to work |

No new attempt reservation, grant, deadline, account-policy/credential retention,
archive or workspace-deletion operation exists. Superseded/expired authority and
late close still refuse at final release. Cgroup emptiness is not inferred from
an IO error. Ready practice reaping cannot start or reopen anything; original
preflight cancellation/expiry remains the bound. No protected file is removed.

Per supervisor:64MiB memory, zero swap,64 tasks, at most four admitted panes and16
bounded root IPC handlers; metadata packets at most32KiB. These are per-process
limits, NOT measured aggregate class capacity. Lifetime flock is separate from
the future metadata actor claim and cannot prevent coordinator replacement.
Private directories are0700; regular single-link claims/sockets0600, no following
the final component. No config, keys, passwords, signing authority or global
attempt map enters the supervisor. It accepts only the practice purpose.

The inherited listener's SO_PEERCRED names its creator, not its accepting child.
Actual sender SCM_CREDENTIALS, pinned loaded executable, pidfd, exact current scope
and live kernel resource bounds therefore authenticate supervisor agreement.
Claims/filenames alone are never permission. Root installed role requires real/
effective UID0 and the exact examterminal.slice scope. No configuration or
environment flag enables the test roles/guard replacements in installed code.

## Operator workflow and compatibility

`examctl panes show ATTEMPT PANE` adds captured `recorded_supervisors`; help
explicitly says this is NOT proof of current liveness/monitoring or retained
lockout support. Reviewed `panes close` remains exact-pane only, consistent with
student Close terminal. It can lose that pane's buffers; it never resets time or
releases account holds. No new browser-admin destructive action is introduced.

Future separately authorized drained installation includes the supplied
examterminal.slice. Health refuses an absent/unloaded resource-accounting slice;
actual pane startup still verifies its live64MiB/swap0/task64 kernel limits.
No service/unit is installed by local development. Match every native writer/
loaded role; do not downgrade a writer that drops pane/source/receipt fields.
Do not stop an old agent or supervisor while it may own needed PTYs. The proposed
three-agent consolidation and rollback gates remain in todo-rollout-plan.md.

## Focused evidence and limits

Three final focused native race repeats pass core5.310s/CLI4.252s: actual Unix/
SCM_RIGHTS/PTY entry, two-pane/one-owner whole coordinator-cgroup SIGKILL, physical
owner failure stopping an actual HUP-ignoring writer while another real synthetic
workflow retains its memory, FIFO/no-global-metadata completion, descriptor budget/
truncation closure, minimal protocol, actual Tick state fences and real compiled
namespace-root CLI/help. Timed-pane entry independently retains durable recording,
does not create a practice supervisor and preserves the original interval/holds.

Root SSH ancestry/root manager namespace/final student shell are replaced in owned
user-scope tests. The peer-failure test uses independent synthetic state roots
with one unprivileged Unix UID: it proves actual process/gate isolation, not real
multi-UID admission. Tick fixtures model metadata with no matching host scope;
full root installed-role/PAM/cgroup/hardening and exact-artifact guest qualification
remain pending. No earlier bundle's receipt qualifies this candidate.

The first candidate refused the inherited-listener creator as the wrong scope;
the kernel-sender handshake fixes it. A test diagnostic-buffer race and gone-scope
cleanup query were corrected without relaxing guards. Intermediate failed logs
are not passes. After focused completion and this review, full native race/
resource/namespace/compiler/default-size qualification passes core304.305s/
CLI39.164s;435 application checks in83 files pass108.19s;22 post-build Chromium/
WASM/SSH browser checks pass1.1m. Static native and app/WASM builds, vet, typecheck
and diff checks pass. Receipts: /tmp/ssh-exam-practice-supervision-{native,app,
build,browser,types}.log. No unchanged broad suite was rerun for documentation.

The unit verifier initially hit sandbox socket EPERM; retrying just that check
with local-test permissions passes. Local systemd warns that CPUAccounting is
removed/ignored; the compatibility setting is not a security boundary. Mandatory
memory/swap/task limits are verified from the live kernel at handoff. No unit is
installed by verification. The raw csc-sys guard remains BUSY, so exact new root
role/SSH/PAM/cgroup qualification is not attempted. No retained mode, automatic
recovery, production fix or deployment is claimed.
