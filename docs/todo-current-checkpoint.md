# Current checkpoint — stress remediation; durable test environment qualified

Local development, synthetic tests and local commits only. No push, deployment,
production configuration/student changes, institutional MFA or external email.
Preserve the ten original modified documentation PNGs; all 16 original image
hashes were unchanged. No package is missing. All owned guests and fixtures are
currently stopped.

Current product commit: **0d28ae1**, including the Prof-approved student setup-busy
message, stable public code and private audit. Two real WASM/signed synthetic SSH
workflows, seven affected HTTP tests, build and typecheck pass. Earlier local
fixes cover bootstrap budgets, capture recovery, SSH command/channel retirement,
technical proof v2 and pane-local feedback. The 16-student/64-terminal, 75-second
outage and fatal collection-worker workflows pass with preserved shells, clocks,
protected work and FULL original-host preservation. Details are in
[stress remediation](stress-remediation.md) and the linked feature documents.

The native core is unchanged since this exact v16 test bundle (19 files,
65,421,056 bytes):
`/var/tmp/ssh-exam-browser-native-upload.stress20261117T174000Z_v16_t6o567ec`.
Reuse it for unchanged native code; do not infer qualification from its name alone.

The latest endurance run **failed before peak at 61 students/244 terminals**.
The next student's Password wait expired at the driver's old 10-second default.
A healthy 16-second startup reproduced that driver defect; the corrected 60-second
wait passes focused tests. The actual long prompt delay remains unexplained.
Start responses reached 57.783 seconds. The final diagnostic snapshot had 26
ACTIVE/generation 0 replies and 35 unavailable reads; later LOCKED rows were
teardown. No pane refusal was captured. No 70-student/90-minute pass exists.
The exact `ujfqp3d8` guest and Marco/local processes are stopped, with independent
FULL preservation and cleanup receipts in `var/stress/20261117T174000Z/endurance-1/`.
The older native third-pane refusal remains unexplained. Production's 32-worker
ceiling, 2-GiB web budget and combined 4-CPU/~8-GiB capacity are still unqualified.

The ordinary browser run at f76aaf9 was interrupted after 156 successful cases,
without a final receipt; its recorded orphaned fixture was cleaned up. The first
durable 0d28ae1 runs then reported application **916 passes/one failure/three gated
skips**, and browser **96 passes/one failure**, followed by an owned controlled
stop: one interrupted test and 281 not run. Do not call these complete passes or
label the JSON's 282 skipped entries as gated skips. Exact cleanup and frozen
input receipts are in `var/stress-remediation/20261117/` under the corresponding
`application-complete-0d28ae1/` and `browser-complete-0d28ae1/` directories.

The two failures were traced to a runner setup mistake: the ordinary shell had
core limit zero, but the new user services allowed unlimited core dumps. Exact
unit metadata identifies the deliberate 32-/64-MiB heap workers' SIGABRT dumps
taking about 3.1/25.4 seconds, beyond their 1.5-/20-second assertions. No core memory
image was read. Corrected services with **LimitCORE=0** pass all 14 purge process,
restart and HTTP/SSH checks, and the complete five-fault browser isolation case
(127.835 seconds; intentional hang 59.948 seconds, heap failure 863 ms). Both
qualification units are stopped, cgroups empty, ports free and inputs unchanged.
Their directories are `purge-core0-qualification/` and `isolation-core0-qualification/`.
This explains those runner failures, not the historical native/endurance findings.

Uncommitted changes now contain per-fault diagnostics in two test files plus
AGENTS.md, the retrospective and accurate progress docs; product code remains
0d28ae1. Prof updated only the consolidated report (126 valid links). The new rule
requires a durable owned runner, matching effective limits and real fault/cleanup
qualification before broad tests; a print-only smoke is insufficient.

Next: commit this validated local increment, then freeze source and built inputs.
Run the complete application and real-WASM browser suites in uniquely named local
user services with LimitCORE=0, RemainAfterExit=yes, a two-hour runtime limit,
45-second stop limit, KillMode=control-group and UMask=0077. Pin PATH, locale,
commands, outputs and manifests. Use browser max-failures=1 to obtain failure
receipts promptly. Collect actual JSON results, stop only the exact owned units,
verify cleanup and compare inputs. Keep the 70-person test separate while local
RAM is tight; then run its guarded ramp, 90 real peak minutes and simultaneous
protected submission. No resource increase or deployment is authorized; no policy
decision blocks the current local tests.

## Deployed baseline

November12,19:25:21America/Chicago /November13,01:25:21UTC: public DNS/TLS and all
nine exact assets verified externally. Website runs solely on csc-sys; Marco is
fenced/stopped/disabled with originals retained. Instructor authorized activation
and confirmed the one DePaul SMTP test received exactly once.

Unchanged runtimeed09efc/schema37/Config1070db5eb056. Web service enabled,2CPU/2GiB/
no swap; user10001/read-only/capability boundaries preserved. App trusts only the
explicitly approved DePaul relay certificate; SMTP STARTTLS verification stays on.
Agent/watchdog/source-worker/reconciler and CLI use local authenticated HTTPS with
proxy bypass. SSH/relay unchanged; native control roles restarted for routing.
All147web attempts/217native histories and41table preservation checks pass,
including71strictly proved prior-tombstone physical absence rechecks. No histories,
deadlines, grants or holds reset. Recording-worker pause RELEASED; admissions OPEN.

Local commit a507592: classic/containerd deployment identity correction;53controller
and4stream regressions pass. Exact csc-sys startup/current-data recovery passes68.4s,
including62s real publisher wait,60s nonce expiry, purge and11mutation refusals.
16concurrent GCC/GDB jobs,64private PTYs and32VP9 sources pass bounded shared-host
sizing. Prior native16/64protocol qualification reused for unchanged binaries;
no new institutional SSH/MFA/media acceptance claimed. Actual mailTransport.verify,
CLI notification test/show, instructor inbox confirmation and public Chromium load/
first-field focus pass. Original16documentation screenshot hashes unchanged.

Own wrapper/fixture/Compose/PID-check errors and omitted reconciler routing were
corrected without repeating completed mutations or replacing the snapshot. All
90queued callbacks drained normally; no event was cleared/skipped. No idle guard or
restart was applied after reopening. No deployment action remains pending.

Details/recovery:docs/csc-web-activation.md; earlier import:docs/csc-web-import.md.
Private evidence:var/collection-tests/csc-web-activation.20261112/ and root stage
/var/tmp/ssh-exam-csc-activation-20261112-e7dedea8/. Preserve CURRENT data for any
future recovery; do not restore the old Marco or cold activation snapshot over it.

Separate follow-ups: future release plans need csc-sys paths/certificate/override
and external fence observation; known idle source-worker task:null diagnostic.
--all removal remains locally tested/unpushed/undeployed, installed CLI47bda3d
unchanged. Separate grading-helper installation remains pending. No source push.
