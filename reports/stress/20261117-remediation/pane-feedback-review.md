# Pane-local feedback — Prof review

November 17, 2026 · Local candidate in `/tmp/ssh-exam-pane-feedback-b8f69ea`; not integrated into main or deployed at this review.

**Approved for this bounded local change.** Prof inspected the corrected desktop 1280×720 and narrow 375×900 refusal/unconfirmed screenshots, current source and final focused receipts. The notice no longer covers the existing terminal headers. No further actionable copy, accessibility or layout issue was found within this notice-and-recovery scope. No new fixture or test was launched by this review.

## What works

- The notice names the failed terminal and avoids a global modal or input cover. Healthy panes remain usable; Dismiss changes only local presentation.
- Known refusal says **“Terminal 3 could not open. You can use your other terminals. Choose New terminal to try again.”** It uses the existing explicit action rather than an automatic retry.
- Unconfirmed admission says **“Terminal 3 is unavailable. Keep this page open and ask your instructor for help.”** It does not offer retry guidance or invent a definite outcome. The pending pane remains disabled, including after a late acknowledgement. Explicit scoped Close and late-reply suppression remain.
- `role="alert"`, the visible Dismiss control and its **Dismiss terminal notice** accessible label are appropriate. Text wraps at 375px; no hashes, tokens or internal diagnostics appear in the notice.
- Only the fixed Go `admission-refused` or `channel-capacity` category on the exact open operation produces the scoped refusal boolean through worker IPC and `open_outcome`. Raw strings, timeouts and invalid proof remain unconfirmed. This is presentation/retry guidance, never execution permission or proof of native cleanup. Ownership incidents and independent monitoring covers retain their existing paths.

Current evidence: confirmed-refusal [desktop](../../../var/stress-remediation/20261117/pane-feedback-browser-6/terminal-readiness-a-refus-55f64-never-retries-automatically/refused-terminal-notice.png) / [375px](../../../var/stress-remediation/20261117/pane-feedback-browser-6/terminal-readiness-a-refus-55f64-never-retries-automatically/refused-terminal-notice-375.png), and unconfirmed [desktop](../../../var/stress-remediation/20261117/pane-feedback-browser-6/terminal-readiness-a-uncon-50de0-never-retries-automatically/unconfirmed-terminal-notice.png) / [375px](../../../var/stress-remediation/20261117/pane-feedback-browser-6/terminal-readiness-a-uncon-50de0-never-retries-automatically/unconfirmed-terminal-notice-375.png).

## Layout finding corrected and tested locally

The earlier [desktop](../../../var/stress-remediation/20261117/pane-feedback-browser-4/terminal-readiness-a-refus-55f64-never-retries-automatically/refused-terminal-notice.png) and [375px](../../../var/stress-remediation/20261117/pane-feedback-browser-4/terminal-readiness-a-refus-55f64-never-retries-automatically/refused-terminal-notice-375.png) screenshots showed the notice and wrapped toolbar covering existing window headers. Those observations remain retained; the corrected screenshots above show both healthy title bars below the notice.

The existing window-area `ResizeObserver` now also moves an ordinary window down when its y-position is above the area's new top. For a minimized window it updates only the stored ordinary y-position, preserving the visible minimized stack. This uses the existing resize/move handling and preserves x-position, dimensions, stacking order, pane identity and input state; it adds no layout abstraction.

The final focused cases assert both healthy title bars stay below the actual window-area top at desktop and 375px and after Dismiss or scoped Close. They verify the minimized stub stays put, restore through the real **Terminal 1 (minimized)** menu item, and send separately scoped input to both healthy panes. They retain no automatic open, an exact fresh pane identity on explicit New, pending-close/late-ack fencing, and unchanged clock/generation assertions.

## Existing verification and limits

[The final three focused browser cases passed](../../../var/stress-remediation/20261117/pane-feedback-browser-focused-6.log) in 9.055 seconds, zero skips, unexpected failures or flakes. The final [build](../../../var/stress-remediation/20261117/pane-feedback-build-5.log) and [typecheck](../../../var/stress-remediation/20261117/pane-feedback-typecheck-4.log) passed. The prior [failed attempt 5](../../../var/stress-remediation/20261117/pane-feedback-browser-focused-5.log) used the ordinary terminal label for a minimized terminal; its correction follows the observed menu label and does not change a product-refusal oracle. Earlier layering failures remain retained too.

The unchanged typed refusal and IPC logic retains its prior [40 interface/IPC checks](../../../var/stress-remediation/20261117/pane-feedback-interface-focused.log), [13 harness/unit checks](../../../var/stress-remediation/20261117/pane-feedback-refusal-stop.log), [encrypted Go gate/sibling-preservation checks](../../../var/stress-remediation/20261117/pane-feedback-native-focused.log) and [client-race pass](../../../var/stress-remediation/20261117/pane-feedback-client-race.log). These are reused evidence, not additional reruns after the layout-only follow-up.

The full-cohort harness now preserves a new refusal and native snapshot, then fails before the 90-minute peak; the separate explicit public retry test remains. No unknown admission is automatically replayed or reauthorized. This UI change does not diagnose the historical native refusal, qualify 70-student capacity, or establish a production release. Narrow screenshots evaluate this notice's layout, not complete mobile exam support. No institutional MFA, actual student account or external email was used.
