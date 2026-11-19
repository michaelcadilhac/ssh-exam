# Start reply recovery — local, not deployed

Entry: the student's Start exam confirmation, after capture verification and the
single authenticated POST /api/student/attempts/:id/begin.

The35-student co-location run9 hit the existing60-second HTTP deadline on its
last student. Native time had started; the web row was still PREPARING at immediate
test teardown. This revealed a frontend defect: a generic transport-error dialog
could obscure an eventual successful start and leave the first terminal unopened.
The class run remains failed; its later reconciliation was not observed.

## Behavior and safety boundary

A lost or malformed reply keeps the confirmation busy and says “Checking whether
your exam started…”. It watches the existing authenticated status/WebSocket feed
for up to another60seconds. This is a bounded read-only observation, not a longer
HTTP request or new authority allowance. Start is never replayed.

Only an already ACTIVE attempt in the original generation proceeds through the
existing confirmActivation checks: unchanged connection epoch, fresh bind/control
confirmation, online status, fullscreen/keyboard/media/visibility and focus grace.
It then opens the first verified terminal, retaining the original start/deadline.
A canonical review, completion or changed generation cannot open terminals.

If still uncertain, the page says time may already be running and asks the student
to keep it open and contact the instructor. Closing that message does not enable
another Start or the pre-start Sign out control. PREPARING is not no-start proof.
Unmount cancels the owned request/observation. There is no durable intermediate
state, additional grant, management setting or migration. All native consumption,
reconciliation, deadlines, account holds and monitoring enforcement are unchanged.

Prof approved the flow and wording before implementation. Cancel is absent after
dispatch, since it cannot undo a start. Known HTTP refusals keep their existing
handling; EXAM_SETUP_BUSY requires the existing exact no-start proof before retry.

## Verification

Evidence root: var/qualification35/profile-20261119T044302Z-8d3c93/.

- start-reply-red reproduces the old generic-error behavior through the browser.
- start-reply-prof-six passes six public UI cases: successful late start, malformed
  JSON reply, canonical review, changed generation, changed connection, and bounded
  uncertainty. Each asserts exactly one Start; successful cases exercise actual
  xterm input, refused cases never open a terminal, and original clocks are retained.
  The unresolved case closes the warning and verifies Start/sign-out stay disabled.
- start-reply-http passes38actual authenticated grant-Begin scenarios, including
  native lost acknowledgements, callback races, consumption contradictions,
  stale capture, page/settings/window changes and busy-health refusal/retry.
- Typecheck and the current build pass. start-reply-prof-affected passes all17
  final Start/preflight/workspace cases. The earlier28-case group also passed;
  its11unchanged network cases remain scoped before the final practice-cue edit.
- final-wasm-signin-isolated passes16real-WASM SSH sign-ins with the rebuilt
  artifact and zero attempts/clocks. Two actual setup refusal/retry cases passed
  separately in final-wasm-browser. That combined profile's capacity check failed
  because its zero-worker baseline followed two retained setup sign-ins; the fresh
  isolated profile corrects the fixture ordering without resetting application state.

The UI fixture models server/native status and media. It does not newly qualify
privileged containment, physical media/MFA or full class capacity. No native Go bytes or
backend state machine changed; existing native race/kernel evidence is reused at
its original scope. Run9 input preservation was collected before this source edit.
Nothing is pushed or deployed. The former image Configbb436d26 contains the older
browser; final assets must be packaged and bound before deployment qualification.
