# Terminal opening readiness

October26,2026. Implemented/tested locally; not deployed. Public entry: student
Begin or New terminal. A new pane now shows **Opening terminal** with disabled,
inert input until the actual backend `opened` acknowledgement arrives. Both
framed-native and explicit legacy acknowledgements are supported. Unsupported
protocols or malformed native epochs leave input blocked and identify a matching-
versions inspection for the operator. Closing/error handling remains the existing
bounded terminal-admission workflow. This creates no durable authority or account
reservation and changes no grant, clock, policy hold or native admission gate.

The joined SSH-loss qualification exposed a real readiness gap: a focusable xterm
accepted the first `p` before the native input context arrived. BrowserSSH safely
discarded that unscoped byte, so the synthetic shell received `rintf`; a later
printf worked. A following success marker alone did not prove that the preceding
file write succeeded. The test now reads back the exact saved bytes before
disconnecting. The UI prevents early editing rather than replaying unscoped keys
under a newly learned epoch. Existing input capture, sequence, generation and
native freeze/deadline enforcement remain authoritative.

`terminal-readiness.spec.ts` delays the actual open reply for legacy and framed
panes, asserts disabled input/no transmitted early bytes, then verifies that the
first transmitted character is `p` after acknowledgement. Both cases failed
against the old built UI (22890, `/tmp/ssh-exam-terminal-ready-red`). The rebuilt
candidate passes those two cases plus unsupported-protocol/invalid-epoch refusal
and no replay after a valid agreement (74310,4/7.5s,
`/tmp/ssh-exam-terminal-ready-controls`). Types and build pass; assets include
index-Ct7C0Uku. Affected actual-WASM/retained/gateway replacement/monitoring/
clipboard/transition browser16348 PASS55/5.9m with no skips
(`/tmp/ssh-exam-terminal-ready-browser-final`). Joined native recovery5797
PASS50.5s; its exact protected-file/clock/hold/preservation receipt is recorded
in retained-transport-recovery-plan.md. Native Go/module inputs and binaries are
unchanged; C9's full application/native/root/capacity evidence still applies.

The transition mock now emits the legacy `opened` acknowledgement the real
server already sends. Its optional delayed-open hook changes only test transport;
it supplies no native permission. A pane's DOM existence is not readiness: real
workflow tests wait for enabled input/acknowledged pane before typing and verify
saved bytes through the shell and protected export.
