# Accidental exam navigation protection

Requested November9,2026: implement, push and deploy. Browser controls remain
best-effort; this is protection from accidents, not a browser lockdown guarantee.

## Bounded delivery plan

1. Reproduce through the student workspace in Chromium with real Back/Forward
   input and browser navigation, using synthetic exam state. Add regressions.
2. Suppress Back/Forward mouse defaults while an attempt is unfinished; request
   the standard browser leave-page confirmation for reload/close/navigation.
   Acceptance: blocked input and choosing Stay preserve page, clock, terminal
   input and monitoring; intentional finish/sign-out work, and genuine
   fullscreen/capture loss still requires review. No history-trapping entries.
3. Build/typecheck and run affected browser workflows, then freeze the exact
   image. Reuse unchanged server/native qualification with source identity proof;
   qualify image/startup/CURRENT-data recovery using existing release runners.
4. Push and execute the existing guarded web-only deployment, preserving native
   roles, protected history and current backup coverage. Record maintenance and
   public reopening; no student interruption or weakened drain guard.

Implemented locally: window capture-phase handlers cancel only Back/Forward
buttons on pointer down/up, mouse down/up and auxiliary click. Pointer-up is
necessary when cancelling pointer-down suppresses compatible mouse events.
No history entries are inserted or rewritten. The browser-native beforeunload
confirmation covers unfinished setup, active/locked work and saving/failure;
completion/cancellation and component teardown remove its effect. Its handler
never reports an incident or mutates timing/authority. Existing pagehide,
fullscreen/capture loss and transport protections remain intact.

Fresh baseline failed for the absent leave confirmation; the first mouse test
also caught the missing pointer-up cancellation. Final five focused Chromium
cases pass, then15 affected workspace/wake/navigation cases pass. A real WASM
SSH/server test verifies cancelled reload retains the exact owner, generation,
start/deadline, fullscreen and working terminal input; accepted reload still
requires approved recovery. Media is synthetic; actual browser input, history,
fullscreen, confirmation and WASM/SSH paths are exercised. No physical mouse or
OS-remapped shortcut guarantee is claimed. Build/typecheck pass. Existing
deliberate-reload fixtures now explicitly accept the browser confirmation.

Release qualification in progress. Initial read-only production inventory found
two active attempts and three student sessions. No maintenance, restart, record
or session change is permitted until the full guard drains. Latest observed
deadline: November10,02:57:48Chicago. Preparation/push continue independently.
No new durable state, management setting or authorization protocol is introduced.
The existing fullscreen, hidden-page, focus-grace, capture and contact enforcement
remains authoritative. Merely attempting navigation must not report an incident.
Actual page departure retains the existing pagehide/disconnection protections.

The expanded cohort passed28 cases and exposed an older abandonment fixture's
25-second lock expectation, which predates the already-approved60-second
operational timeout. Its two real close/reload scenarios now pass with the actual
timeout constant (1.5minutes), including source ownership, saved files, old-token
refusal and repeated authorization. The older third serial2-minute process-health
case did not run in the failed cohort; it is unchanged and not claimed as new
evidence. No production timeout was shortened. A disabled reconnect control is
not clicked as a refusal oracle; the actual authenticated reauth400 is asserted.

Source identity proves apps/server, packages/protocol, browser WASM, native code,
migrations, runtime dependencies, Dockerfile and deployment controller unchanged
from79ecd97. Reuse its863 application checks, native races/kernel/capacity and
operator/nginx qualification. New browser workflows and exact-image checks
remain separate; no new native/service restart is part of this UI-only change.
