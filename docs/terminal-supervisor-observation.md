# Live terminal-owner diagnostics (tested locally; not deployed)

`sudo examctl panes supervisor ATTEMPT --state /var/lib/exam-agent` queries the
existing private attempt supervisor without Engine initialization, global-state
reads/locks/repair, keys, audit writes, network TCP, manager commands or control
mutations. Omit --state to resolve the existing configured state directory
read-only; do not combine explicit --state and --config. Help/syntax needs neither
root nor configuration; actual use requires real/effective root.

This complements bounded offline `panes list/show`: those are captured native
metadata, while this command reports a root sender observed over a local Unix
socket. Neither is monitoring/SSH ownership, verified containment/resource state,
cleanup eligibility, a new clock or permission to work/resume. Missing/old-role/
changed/timed-out results are unavailable (exit1), NOT proof of death or misconduct.
Preserve records, inspect captured panes/help and repair the actual issue; never
clear state or restart a shared agent to force an observation. Exit2 is syntax;
exit0 is a complete diagnostic capture, not authorization.

## Fields and authentication

The observation-only versioned reply contains exact attempt/unit, actual reply
sender PID, current boot/capture time and bounded sorted attached unit metadata.
`attached_panes`/`attached_units` include startup handoffs and ending panes, not
proof student code is running. `reported_started_units` is only the subset for
which the coordinator's normal completion-ownership notice was received. Its
absence is UNKNOWN, not proof no clock/shell started. Its presence is neither a
durable Begin receipt nor monitoring/input permission. No raw keys/input, student
credentials, account names/transports, signing keys or global attempt map enters
the reply. The last-work timestamp is not refreshed by inspection.

Inherited-listener SO_PEERCRED identifies the creator, which may already be dead.
The client therefore enables SCM_CREDENTIALS before hello and authenticates the
actual reply's kernel owner UID/PID with a pidfd; payload PID/boot/attempt/unit,
counts, ordered unique units and reported-subset agreement must match. Unexpected
rights, truncation, duplicates, unknown/private fields or oversize refuse before
stdout. Received rights are owned/closed even on refusal. IPC connect/exchange has
a three-second bound; this is not a guarantee against every filesystem stall.

Installed servers require root at their existing private0600 socket in0700 state.
The new root-only metadata purpose accepts ZERO descriptors and no arbitrary
command/path. Unlike work handoff, metadata inspection need not be the identical
loaded exam-agent executable: root examctl is a separate binary and already owns
native inspection authority. This does NOT relax descriptor handoff's existing
loaded-agent/UID/exact-scope/resource/current-admission checks. A root metadata
sender/liveness observation is explicitly not operational role or exec proof.
No new public/inbound web control API or service listener is introduced.

## State/failure review before broad qualification

No durable state, reservation, permit, grant, pending management operation or
recovery transition is added. Existing handler/packet/pane bounds remain; queries
neither start workers/workloads nor alter deadlines, account holds, credentials,
submission protection/history or one-use consumption. No directory/file is
initialized on missing state. Failed reads/replies leave all these unchanged.

The supervisor's existing in-memory pane map now distinguishes attachment from
receipt of the normal startup notice; duplicate detection checks key presence,
not its boolean diagnostic value. A lost notice preserves UNKNOWN and cannot
destroy a possibly authorized shell, authorize execution or invent allowance.
Inspection cannot promote a notice or become heartbeat/thaw evidence. Only the
existing exact reviewed pane close/continuation workflows perform control.

## Current evidence and limits

The missing discoverable workflow is RED0.021s. Three final focused race repeats
pass core28.667s/CLI1.688s: actual compiled static CLI in an owned root-user
namespace, actual supervisor/private IPC after whole coordinator-cgroup death,
global state replaced by a FIFO, preserved original shell process/memory and
unchanged state/audit; actual supervisor refuses control-shaped and1/5-descriptor
inspection frames without leaks or changed panes. Actual IPC exercises valid,
wrong target/PID/boot/scope/count/subset, null/duplicate/oversize/private replies,
hello/reply rights and truncation, old-role EOF and positively reached live-sender
reply timeout. Compiled CLI also refuses private/wrong/rights/old/held replies
without stdout leaks. Every negative fixture proves it sent the intended reply.

The first negative fixture used testing.TempDir's nonprivate leaf permissions;
the unchanged0700 guard refused before connecting and the mock waited forever.
Only the verified owned test runner (no children) was stopped for a stack dump.
The fixture now explicitly creates private state and bounds Accept/completion.
A subsequent repeated death case killed between exec and startup notice; the
truthful UNKNOWN completion was NOT weakened. Committed-startup death tests now
positively observe both normal notices before kill. Failed receipts are retained
at /tmp/ssh-exam-supervisor-observation-{fixture-hang,startup-race}.log, not passes.

User-scope fixtures replace root SSH/PAM/manager namespace/final shell. Root-user
namespace and real kernel credential/descriptor tests do not qualify installed
normal-root admission, a different UID or protected production hardening. These
remain exact-artifact guarded guest work; the old bundle cannot qualify this
candidate. Timed C12/R2/C3/C9 and the critical monitoring fix remain open.

Full native race/resource/namespace/compiler/default-size qualification passes
core299.869s/CLI28.567s; static build/vet pass. A final CLI-only guidance improvement
adds the exact shell-quoted captured-only next command, tested with quotes in the
state path: three actual CLI/creator-death/help repeats pass core15.360s/CLI1.745s.
Full affected CLI repeat passes14.678s after that focused receipt was separately
read, and the final native build/vet/diff checks pass. No core runtime changed
after its full qualification. All runners finish. Receipts:
/tmp/ssh-exam-supervisor-observation-{red,acceptance,native,guidance,
cli-sequenced}.log.

One earlier guidance CLI repeat was launched in the same orchestration script
that collected focused output. Although that focused run had passed, the required
model review had not happened; its receipt is not the sequencing-gate evidence.
The separately reviewed fresh CLI repeat above corrects that process slip.
AGENTS.md explicitly requires ending the collection script before broad launch.

No app/browser/WASM source or artifact changes: prior435 app/22 browser/build/
typecheck and35 affected callback checks still cover those unchanged surfaces.
No redundant browser rebuild/rerun, upload, deployment or consolidation occurs.
